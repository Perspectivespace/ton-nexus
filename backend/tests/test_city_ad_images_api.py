"""Картинка экрана на фасаде — HTTP: загрузка (сырые байты), бронь с картинкой, публичная и закрытая выдача,
замена через PUT и очередь модерации владельца."""

from __future__ import annotations

import io
import itertools
import unittest
import warnings
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import httpx
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.models import User
from app.services import city_ad_images as img_svc
from app.services import city_ads as ads
from app.services.economy_admin import set_setting
from app.services.economy_seed import seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
_TG = itertools.count(41000)
TOMORROW = (ads.game_day() + timedelta(days=1)).isoformat()


def png(size=(900, 700), color=(30, 200, 160)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


class ImagesApi(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.db.session import get_db
        from app.main import app

        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.addAsyncCleanup(self.engine.dispose)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)
        async with self.S() as s:
            await seed_economy(s)
            await ads.ensure_spots(s)
            await s.commit()

        async def _db():
            async with self.S() as s:
                yield s

        app.dependency_overrides[get_db] = _db
        self.addCleanup(app.dependency_overrides.clear)
        p = mock.patch.object(settings, "debug", True)
        p.start()
        self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def user(self, **kw) -> int:
        tg = next(_TG)
        async with self.S() as s:
            s.add(User(telegram_id=tg, balance=Decimal("50"), level=kw.pop("level", 3), **kw))
            await s.commit()
        return tg

    @staticmethod
    def h(tg: int, **extra) -> dict:
        return {"X-Telegram-Init-Data": f"dev:{tg}", **extra}

    async def upload(self, tg, data=None, ctype="image/png"):
        return await self.client.post("/api/v1/city-ads/images", content=png() if data is None else data,
                                      headers=self.h(tg, **{"Content-Type": ctype}))

    async def test_full_flow(self):
        buyer, owner, other = await self.user(), await self.user(is_owner=True), await self.user()
        r = await self.upload(buyer)
        self.assertEqual(r.status_code, 201, r.text)
        up = r.json()
        self.assertEqual((up["width"], up["height"]), (640, 520))
        self.assertRegex(up["preview_url"], r"^/api/v1/city-ads/images/[0-9a-f]{32}/private$")
        key = up["preview_url"].split("/")[-2]
        # превью — автору; чужому — нет; без входа — нет
        r = await self.client.get(up["preview_url"], headers=self.h(buyer))
        self.assertEqual((r.status_code, r.headers["content-type"], r.content[:4]), (200, "image/webp", b"RIFF"))
        self.assertEqual(r.headers["cache-control"], "no-store, private")
        self.assertEqual(r.headers["x-content-type-options"], "nosniff")
        self.assertEqual((await self.client.get(up["preview_url"], headers=self.h(other))).status_code, 403)
        with mock.patch.object(settings, "debug", False):
            self.assertEqual((await self.client.get(up["preview_url"])).status_code, 401)
        # бронь с картинкой
        r = await self.client.post("/api/v1/city-ads", headers=self.h(buyer), json={
            "spot": "rows_facade", "district": "rows", "start": TOMORROW, "days": 2,
            "title": "PIXEL CAFE", "subtitle": "второй кофе", "color": "mint", "image_id": up["id"],
        })
        self.assertEqual(r.status_code, 201, r.text)
        ad = r.json()
        self.assertEqual(ad["image_url"], up["preview_url"])
        # до одобрения — не публично
        self.assertEqual((await self.client.get(f"/api/v1/city-ads/images/{key}.webp")).status_code, 404)
        # владелец видит картинку в очереди
        r = await self.client.get("/api/v1/city-ads/moderation", headers=self.h(owner))
        item = next(i for i in r.json()["items"] if i["id"] == ad["id"])
        self.assertEqual(item["image_url"], up["preview_url"])
        self.assertEqual((await self.client.get(item["image_url"], headers=self.h(owner))).status_code, 200)
        r = await self.client.post(f"/api/v1/city-ads/{ad['id']}/approve", headers=self.h(owner))
        self.assertEqual(r.status_code, 200, r.text)
        r = await self.client.get(f"/api/v1/city-ads/images/{key}.webp")
        self.assertEqual((r.status_code, r.content[:4]), (200, b"RIFF"))
        self.assertEqual(r.headers["cache-control"], "public, max-age=3600")
        # «Мои объявления» — с картинкой
        mine = (await self.client.get("/api/v1/city-ads/mine", headers=self.h(buyer))).json()
        self.assertEqual(mine[0]["image_url"], up["preview_url"])
        # замена — снова на проверку
        up2 = (await self.upload(buyer, png(color=(220, 60, 60)))).json()
        r = await self.client.put(f"/api/v1/city-ads/{ad['id']}/image", headers=self.h(buyer), json={"image_id": up2["id"]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "pending")
        self.assertEqual(r.json()["image_url"], up2["preview_url"])
        self.assertEqual((await self.client.get(f"/api/v1/city-ads/images/{key}.webp")).status_code, 404)
        # чужое объявление не поменять
        up3 = (await self.upload(other)).json()
        r = await self.client.put(f"/api/v1/city-ads/{ad['id']}/image", headers=self.h(other), json={"image_id": up3["id"]})
        self.assertEqual(r.status_code, 404)

    async def test_upload_errors(self):
        buyer = await self.user()
        r = await self.upload(buyer, b"not an image at all", "image/png")
        self.assertEqual(r.status_code, 400)
        buf = io.BytesIO()
        Image.new("RGB", (900, 700)).save(buf, "GIF")
        self.assertEqual((await self.upload(buyer, buf.getvalue(), "image/gif")).status_code, 400)
        self.assertEqual((await self.upload(buyer, png(), "image/jpeg")).status_code, 400)  # тип не совпадает
        big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (img_svc.MAX_BYTES + 10)
        self.assertEqual((await self.upload(buyer, big)).status_code, 413)
        low = await self.user(level=1)
        self.assertEqual((await self.upload(low)).status_code, 201)  # по умолчанию — любой уровень
        async with self.S() as s:
            await set_setting(s, key="city_ads", value={"min_level": 3})  # порог поднял владелец
            await s.commit()
        self.assertEqual((await self.upload(low)).status_code, 403)
        self.assertEqual((await self.client.get("/api/v1/city-ads/images/NOT-A-KEY.webp")).status_code, 422)
        with mock.patch.object(img_svc, "available", return_value=False):
            self.assertEqual((await self.upload(buyer)).status_code, 503)
            board = (await self.client.get("/api/v1/city-ads?district=rows")).json()
            self.assertFalse(board["image_upload"])

    async def test_rate_limit(self):
        buyer = await self.user()
        with mock.patch.object(img_svc, "UPLOADS_PER_HOUR", 3):
            for _ in range(3):
                self.assertEqual((await self.upload(buyer)).status_code, 201)
            r = await self.upload(buyer)
        self.assertEqual(r.status_code, 429)
        self.assertIn("через час", r.json()["detail"])


if __name__ == "__main__":
    unittest.main()
