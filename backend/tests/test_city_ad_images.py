"""Картинка экрана на фасаде «Неон-рядов»: проверка и пережатие, лимиты, бронь, замена, модерация, доступ, очистка."""

from __future__ import annotations

import asyncio
import importlib.util
import io
import pathlib
import unittest
import warnings
from datetime import timedelta
from decimal import Decimal

from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import CityAd, CityAdImage, User  # noqa: F401
from app.services import city_ad_images as img_svc
from app.services import city_ads as ads
from app.services.economy_admin import set_setting
from app.services.economy_seed import seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
TODAY = ads.game_day()
D = lambda n: TODAY + timedelta(days=n)  # noqa: E731


def pic(fmt="PNG", size=(800, 600), color=(200, 40, 90), mode="RGB", **save) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, fmt, **save)
    return buf.getvalue()


def _run(fn):
    async def wrap():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with Session() as s:
                await seed_economy(s)
                await ads.ensure_spots(s)
                await s.commit()
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(wrap())


_tg = [31000]


async def _user(s, level=3, **kw):
    _tg[0] += 1
    u = User(telegram_id=_tg[0], level=level, balance=Decimal("50"), **kw)
    s.add(u)
    await s.commit()
    return u


CONTENT = ads.AdContent(title="PIXEL CAFE", subtitle="второй кофе в подарок", color="mint")


async def _book(s, u, image_id=None, spot="rows_facade"):
    content = CONTENT if spot == "rows_facade" else ads.AdContent(title="PIXEL", subtitle="кофе", color="mint")
    ad = await ads.book(s, user=u, spot_key=spot, start=D(1), days=3, content=content, district="rows",
                        image_id=image_id)
    await s.commit()
    return ad


class Process(unittest.TestCase):
    def test_png_jpeg_webp_become_webp_of_fixed_size(self):
        for fmt, mime in (("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
            with self.subTest(fmt):
                out, w, h = img_svc.process(pic(fmt, (1200, 700)), mime)
                self.assertEqual((w, h), (img_svc.OUT_W, img_svc.OUT_H))
                self.assertEqual(out[:4], b"RIFF")
                self.assertEqual(out[8:12], b"WEBP")
                im = Image.open(io.BytesIO(out))
                self.assertEqual((im.format, im.size), ("WEBP", (640, 520)))
                self.assertLess(len(out), 60_000)

    def test_metadata_is_gone(self):
        src = Image.new("RGB", (800, 600), (10, 120, 200))
        exif = Image.Exif()
        exif[0x010E] = "SECRET-DESCRIPTION"  # ImageDescription
        exif[0x8825] = {2: (55.0, 45.0, 0.0)}  # GPS
        buf = io.BytesIO()
        src.save(buf, "JPEG", exif=exif, comment=b"SECRET-COMMENT")
        data = buf.getvalue()
        self.assertIn(b"SECRET-DESCRIPTION", data)
        out, _, _ = img_svc.process(data, "image/jpeg")
        for marker in (b"SECRET", b"Exif", b"XMP", b"ICCP", b"GPS"):
            self.assertNotIn(marker, out)

    def test_disguised_tail_does_not_survive(self):
        data = pic("PNG") + b"PK\x03\x04" + b"<script>alert(1)</script>" * 20
        out, _, _ = img_svc.process(data, "image/png")
        self.assertNotIn(b"PK\x03\x04", out)
        self.assertNotIn(b"<script>", out)

    def test_rejects(self):
        cases = {
            "текст": (b"hello world, not an image", None),
            "gif": (pic("GIF"), "image/gif"),
            "svg": (b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', "image/svg+xml"),
            "битый png": (b"\x89PNG\r\n\x1a\n" + b"\x00" * 200, "image/png"),
            "тип не совпадает": (pic("JPEG"), "image/png"),
            "маленькая": (pic("PNG", (200, 150)), "image/png"),
            "пусто": (b"", "image/png"),
        }
        for name, (data, declared) in cases.items():
            with self.subTest(name), self.assertRaises(img_svc.ImageError):
                img_svc.process(data, declared)

    def test_size_cap_and_pixel_bomb(self):
        with self.assertRaises(img_svc.ImageTooLarge):
            img_svc.process(b"\x89PNG\r\n\x1a\n" + b"\x00" * (img_svc.MAX_BYTES + 1), "image/png")
        bomb = pic("PNG", (7000, 7000), 0, mode="1")  # 49 Мп, файл маленький
        self.assertLess(len(bomb), img_svc.MAX_BYTES)
        with self.assertRaisesRegex(img_svc.ImageError, "пикселям"):
            img_svc.process(bomb, "image/png")

    def test_transparent_parts_become_dark_screen(self):
        out, _, _ = img_svc.process(pic("PNG", (800, 600), (255, 255, 255, 0), mode="RGBA"), "image/png")
        r, g, b = Image.open(io.BytesIO(out)).convert("RGB").getpixel((320, 260))
        self.assertLess(r + g + b, 80)

    def test_orientation_from_exif_is_applied(self):
        # портрет, записанный боком (Orientation = 6): верх картинки красный
        src = Image.new("RGB", (900, 600), (0, 0, 255))
        src.paste((255, 0, 0), (0, 0, 300, 600))  # левая треть — красная, после поворота на 90° по часовой — верх
        exif = Image.Exif()
        exif[0x0112] = 6
        buf = io.BytesIO()
        src.save(buf, "JPEG", exif=exif, quality=95)
        out, _, _ = img_svc.process(buf.getvalue(), "image/jpeg")
        im = Image.open(io.BytesIO(out)).convert("RGB")
        top, bottom = im.getpixel((320, 5)), im.getpixel((320, 515))
        self.assertGreater(top[0], 150)
        self.assertGreater(bottom[2], 150)


class Flow(unittest.TestCase):
    def test_upload_limits_and_level(self):
        async def body(s):
            low = await _user(s, level=1)
            await img_svc.store_upload(s, user=low, data=pic(), declared="image/png")  # по умолчанию — любой уровень
            await set_setting(s, key="city_ads", value={"min_level": 3})
            with self.assertRaises(img_svc.ImageForbidden):
                await img_svc.store_upload(s, user=low, data=pic(), declared="image/png")
            # в час — не больше UPLOADS_PER_HOUR, даже если картинки сразу прикладывать к объявлению
            v = await _user(s)
            ad = await _book(s, v)
            for _ in range(img_svc.UPLOADS_PER_HOUR):
                im = await img_svc.store_upload(s, user=v, data=pic(), declared="image/png")
                await img_svc.attach(s, user=v, image_id=im.id, ad=ad)
            with self.assertRaisesRegex(img_svc.ImageRateLimited, "через час"):
                await img_svc.store_upload(s, user=v, data=pic(), declared="image/png")
            # через час — снова можно
            later = img_svc._now() + timedelta(hours=1, minutes=1)
            await img_svc.store_upload(s, user=v, data=pic(), declared="image/png", now=later)

        _run(body)

    def test_book_with_image_moderation_and_public_access(self):
        async def body(s):
            u, owner, other = await _user(s), await _user(s, is_owner=True), await _user(s)
            im = await img_svc.store_upload(s, user=u, data=pic(), declared="image/png")
            ad = await _book(s, u, image_id=im.id)
            self.assertEqual((await s.get(CityAdImage, im.id)).ad_id, ad.id)
            # до одобрения: игрокам не видно ни в витрине, ни по адресу; автору и владельцу — да
            self.assertIsNone(await img_svc.read_public(s, im.key, today=D(1)))
            self.assertEqual((await img_svc.read_private(s, im.key, actor=u))[:4], b"RIFF")
            self.assertEqual((await img_svc.read_private(s, im.key, actor=owner))[:4], b"RIFF")
            with self.assertRaises(img_svc.ImageForbidden):
                await img_svc.read_private(s, im.key, actor=other)
            await ads.approve(s, owner=owner, ad_id=ad.id, today=TODAY)
            await s.commit()
            self.assertEqual((await img_svc.read_public(s, im.key, today=D(1)))[:4], b"RIFF")
            board = await ads.board(s, today=D(1), district="rows")
            fac = next(x for x in board["spots"] if x["key"] == "rows_facade")
            self.assertEqual(fac["ad"]["image_url"], f"/api/v1/city-ads/images/{im.key}.webp")
            # закончилось — снова не видно
            self.assertIsNone(await img_svc.read_public(s, im.key, today=D(5)))

        _run(body)

    def test_replace_sends_back_to_moderation_remove_does_not(self):
        async def body(s):
            u, owner = await _user(s), await _user(s, is_owner=True)
            ad = await _book(s, u)
            await ads.approve(s, owner=owner, ad_id=ad.id, today=TODAY)
            await s.commit()
            im = await img_svc.store_upload(s, user=u, data=pic(), declared="image/png")
            ad = await img_svc.set_image(s, user=u, ad_id=ad.id, image_id=im.id, today=D(1))
            await s.commit()
            self.assertEqual(ad.status, "pending")
            self.assertIsNotNone(ad.image_changed_at)
            board = await ads.board(s, today=D(1), district="rows")
            self.assertIsNone(next(x for x in board["spots"] if x["key"] == "rows_facade")["ad"])
            self.assertIsNone(await img_svc.read_public(s, im.key, today=D(1)))
            await ads.approve(s, owner=owner, ad_id=ad.id, today=D(1))
            await s.commit()
            # вторая замена: прежняя картинка отвязана и пропадает для игроков сразу
            im2 = await img_svc.store_upload(s, user=u, data=pic(color=(0, 200, 0)), declared="image/png")
            await img_svc.set_image(s, user=u, ad_id=ad.id, image_id=im2.id, today=D(1))
            await ads.approve(s, owner=owner, ad_id=ad.id, today=D(1))
            await s.commit()
            self.assertIsNone((await s.get(CityAdImage, im.id)).ad_id)
            self.assertIsNone(await img_svc.read_public(s, im.key, today=D(1)))
            self.assertIsNotNone(await img_svc.read_public(s, im2.key, today=D(1)))
            # убрать картинку — объявление остаётся одобренным, экран снова только с текстом
            ad = await img_svc.set_image(s, user=u, ad_id=ad.id, image_id=None, today=D(1))
            await s.commit()
            self.assertEqual(ad.status, "approved")
            board = await ads.board(s, today=D(1), district="rows")
            self.assertIsNone(next(x for x in board["spots"] if x["key"] == "rows_facade")["ad"]["image_url"])

        _run(body)

    def test_wrong_image_or_spot_charges_nothing(self):
        async def body(s):
            u, other = await _user(s), await _user(s)
            theirs = await img_svc.store_upload(s, user=other, data=pic(), declared="image/png")
            await s.commit()
            uid = u.id
            with self.assertRaisesRegex(ads.CityAdError, "не найдена"):
                await _book(s, u, image_id=theirs.id)
            await s.rollback()
            u = await s.get(User, uid)
            mine = await img_svc.store_upload(s, user=u, data=pic(), declared="image/png")
            await s.commit()
            mine_id = mine.id
            with self.assertRaisesRegex(ads.CityAdError, "только для экрана"):
                await _book(s, u, image_id=mine_id, spot="rows_banner")
            await s.rollback()
            u = await s.get(User, uid)
            self.assertEqual(Decimal(u.balance), Decimal("50"))
            self.assertEqual(await s.scalar(select(func.count(CityAd.id))), 0)
            # уже приложенную картинку второй раз не приложить
            await _book(s, u, image_id=mine_id)
            with self.assertRaisesRegex(ads.CityAdError, "не найдена"):
                await ads.book(s, user=u, spot_key="rows_facade", start=D(10), days=1, content=CONTENT,
                               district="rows", image_id=mine_id)
            await s.rollback()
            u = await s.get(User, uid)
            # картинку не к экрану не поменять
            banner = await _book(s, u, spot="rows_banner")
            fresh = await img_svc.store_upload(s, user=u, data=pic(), declared="image/png")
            with self.assertRaisesRegex(ads.CityAdError, "только для экрана"):
                await img_svc.set_image(s, user=u, ad_id=banner.id, image_id=fresh.id, today=D(1))

        _run(body)

    def test_purge(self):
        async def body(s):
            u = await _user(s)
            stale = await img_svc.store_upload(s, user=u, data=pic(), declared="image/png",
                                               now=img_svc._now() - timedelta(hours=2))
            fresh = await img_svc.store_upload(s, user=u, data=pic(), declared="image/png")
            used = await img_svc.store_upload(s, user=u, data=pic(), declared="image/png")
            await _book(s, u, image_id=used.id)
            ids = (stale.id, fresh.id, used.id)
            # просроченную загрузку к брони уже не приложить
            with self.assertRaisesRegex(ads.CityAdError, "не найдена"):
                await ads.book(s, user=u, spot_key="rows_facade", start=D(10), days=1, content=CONTENT,
                               district="rows", image_id=ids[0])
            await s.rollback()
            n = await img_svc.purge_once(s)
            await s.commit()
            self.assertEqual(n, 1)
            left = set((await s.execute(select(CityAdImage.id))).scalars())
            self.assertEqual(left, {ids[1], ids[2]})

        _run(body)


class Migration(unittest.TestCase):
    def test_022_up_and_down(self):
        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "022_city_ad_images.py"
        spec = importlib.util.spec_from_file_location("mig_022", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual((mod.revision, mod.down_revision), ("022", "021"))
        engine = sa.create_engine("sqlite://")
        with engine.begin() as conn:
            conn.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            conn.execute(sa.text("CREATE TABLE city_ads (id INTEGER PRIMARY KEY, title VARCHAR(64))"))
            ops = Operations(MigrationContext.configure(conn))
            mod.op = ops
            mod.upgrade()
            insp = sa.inspect(conn)
            self.assertIn("image_changed_at", {c["name"] for c in insp.get_columns("city_ads")})
            cols = {c["name"] for c in insp.get_columns("city_ad_images")}
            self.assertEqual(
                cols, {"id", "key", "owner_id", "ad_id", "data", "size", "width", "height", "sha256", "created_at"}
            )
            model_cols = {c.name for c in CityAdImage.__table__.columns}
            self.assertEqual(cols, model_cols)
            mod.downgrade()
            insp = sa.inspect(conn)
            self.assertNotIn("city_ad_images", insp.get_table_names())
            self.assertNotIn("image_changed_at", {c["name"] for c in insp.get_columns("city_ads")})


if __name__ == "__main__":
    unittest.main()
