"""Реклама в городе (PR 1): тариф city_ads, расчёт цены в нанотонах, проверка текста и ссылок, занятость мест."""

from __future__ import annotations

import asyncio
import unittest
import warnings
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import city_ads as ads_api
from app.db.base import Base
from app.models import CityAd, CityAdDay, CityAdEvent, CityAdSpot, User  # noqa: F401
from app.services import city_ads as ads
from app.services.economy_admin import EconomyAdminError, set_setting
from app.services.economy_admin import SETTING_CATALOG
from app.services.economy_seed import DEFAULTS, seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
NANO = 10**9
TODAY = date(2026, 11, 7)
D = lambda n: TODAY + timedelta(days=n)  # noqa: E731


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
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(wrap())


_tg = [7000]


async def _user(s, level=3):
    _tg[0] += 1
    u = User(telegram_id=_tg[0], level=level, balance=Decimal("10"))
    s.add(u)
    await s.flush()
    return u


async def _book(s, user, spot_key, start, days, status="approved", **kw):
    spot = await s.scalar(select(CityAdSpot).where(CityAdSpot.key == spot_key))
    ad = CityAd(advertiser_id=user.id, spot_id=spot.id, format=spot.format, title=kw.get("title", "NEXUS"),
                color="cyan", status=status, start_day=start, end_day=start + timedelta(days=days - 1), days=days,
                price_day_nano=NANO, total_nano=NANO * days, body=kw.get("body"), link_url=kw.get("link_url"))
    s.add(ad)
    await s.flush()
    for i in range(days):
        s.add(CityAdDay(spot_id=spot.id, day=start + timedelta(days=i), ad_id=ad.id))
    await s.flush()
    return ad


class Config(unittest.TestCase):
    def test_defaults(self):
        cfg = ads.normalize(DEFAULTS["city_ads"][0])
        self.assertEqual(cfg["min_level"], 3)
        self.assertEqual((cfg["min_days"], cfg["max_days"]), (1, 30))
        self.assertEqual(cfg["spots"]["tower_line"]["price_day"], "1")
        self.assertEqual(cfg["spots"]["banner_sky"]["price_day"], "0.5")
        self.assertEqual(cfg["spots"]["neon_right"]["price_day"], "0.3")
        self.assertEqual(set(cfg["spots"]), set(ads.SPOT_KEYS))
        self.assertIn("city_ads", {c["key"] for c in SETTING_CATALOG})

    def test_fallbacks_and_rejects(self):
        # пусто → всё из значений по умолчанию; частично → остальное дополняется
        self.assertEqual(ads.normalize({}), ads.normalize(DEFAULTS["city_ads"][0]))
        cfg = ads.normalize({"min_level": 5, "spots": {"neon_left": {"price_day": "0,25"}}})
        self.assertEqual(cfg["min_level"], 5)
        self.assertEqual(cfg["spots"]["neon_left"], {"price_day": "0.25", "enabled": True})
        self.assertEqual(cfg["spots"]["tower_line"]["price_day"], "1")
        for bad in (
            [],
            {"what": 1},
            {"min_level": 0},
            {"min_level": True},
            {"min_days": 0},
            {"max_days": 31},
            {"min_days": 10, "max_days": 5},
            {"spots": {"moon": {"price_day": "1"}}},
            {"spots": {"neon_left": {"price_day": "0"}}},
            {"spots": {"neon_left": {"price_day": "-1"}}},
            {"spots": {"neon_left": {"price_day": "0.0000000001"}}},
            {"spots": {"neon_left": {"price_day": "1001"}}},
            {"spots": {"neon_left": {"enabled": "yes"}}},
            {"limits": {"neon": {"title_max": 0}}},
            {"limits": {"neon": {"title_max": 65}}},
            {"limits": {"neon": {"subtitle_max": 5}}},
            {"body_max": 5000},
        ):
            with self.assertRaises(ads.CityAdError, msg=repr(bad)):
                ads.normalize(bad)

    def test_owner_save_goes_through_normalize(self):
        async def body(s):
            with self.assertRaises(EconomyAdminError):
                await set_setting(s, key="city_ads", value={"max_days": 99})
            v = await set_setting(s, key="city_ads", value={"spots": {"tower_line": {"price_day": "2.5", "enabled": False}}})
            self.assertEqual(v.value["spots"]["tower_line"], {"price_day": "2.5", "enabled": False})
            cfg = await ads.load_config(s)
            self.assertFalse(cfg["spots"]["tower_line"]["enabled"])

        _run(body)

    def test_broken_stored_value_falls_back(self):
        async def body(s):
            from app.models import EconomySetting

            row = await s.scalar(select(EconomySetting).where(EconomySetting.key == "city_ads"))
            row.value_json = '{"min_level": "много"}'
            await s.flush()
            cfg = await ads.load_config(s)
            self.assertEqual(cfg, ads.normalize(DEFAULTS["city_ads"][0]))

        _run(body)


class PriceMath(unittest.TestCase):
    def test_nanoton_exact(self):
        cfg = ads.normalize({"spots": {"neon_left": {"price_day": "0.1"}, "banner_sky": {"price_day": "0.33333333"}}})
        self.assertEqual(ads.price_nano(cfg, "neon_left", 3), (100_000_000, 300_000_000))  # без 0.30000000000000004
        self.assertEqual(ads.price_nano(cfg, "banner_sky", 30), (333_333_330, 9_999_999_900))
        self.assertEqual(ads.price_nano(cfg, "tower_line", 30), (NANO, 30 * NANO))

    def test_quote_price(self):
        async def body(s):
            u = await _user(s)
            q = await ads.quote(s, user=u, spot_key="tower_line", start=D(1), days=7, today=TODAY)
            self.assertEqual((q.price_day, q.total, q.total_nano), ("1", "7", 7 * NANO))
            self.assertEqual(q.end, D(7))
            q = await ads.quote(s, user=u, spot_key="neon_right", start=D(2), days=3, today=TODAY)
            self.assertEqual(q.total, "0.9")
            q = await ads.quote(s, user=u, spot_key="banner_street", start=D(1), days=30, today=TODAY)
            self.assertEqual(q.total, "15")

        _run(body)


class QuoteValidation(unittest.TestCase):
    def test_level_days_dates_spot(self):
        async def body(s):
            low = await _user(s, level=2)
            with self.assertRaises(ads.CityAdPermissionError):
                await ads.quote(s, user=low, spot_key="tower_line", start=D(1), days=1, today=TODAY)
            await set_setting(s, key="city_ads", value={"min_level": 2})
            q = await ads.quote(s, user=low, spot_key="tower_line", start=D(1), days=1, today=TODAY)
            self.assertTrue(q.available)
            u = await _user(s, level=10)
            for kw in (
                {"days": 0}, {"days": 31}, {"days": True},
                {"start": TODAY}, {"start": D(-3)}, {"start": D(ads.MAX_AHEAD_DAYS + 1)},
                {"spot_key": "moon"},
            ):
                args = {"spot_key": "tower_line", "start": D(1), "days": 1} | kw
                with self.assertRaises(ads.CityAdError, msg=repr(kw)):
                    await ads.quote(s, user=u, today=TODAY, **args)
            await set_setting(s, key="city_ads", value={"min_days": 3, "max_days": 7, "spots": {"neon_left": {"price_day": "0.3", "enabled": False}}})
            with self.assertRaises(ads.CityAdError):
                await ads.quote(s, user=u, spot_key="tower_line", start=D(1), days=2, today=TODAY)
            with self.assertRaises(ads.CityAdError):
                await ads.quote(s, user=u, spot_key="tower_line", start=D(1), days=8, today=TODAY)
            with self.assertRaises(ads.CityAdError):  # место снято с продажи
                await ads.quote(s, user=u, spot_key="neon_left", start=D(1), days=3, today=TODAY)
            spot = await s.scalar(select(CityAdSpot).where(CityAdSpot.key == "neon_right"))
            spot.enabled = False  # технический выключатель
            await s.flush()
            with self.assertRaises(ads.CityAdError):
                await ads.quote(s, user=u, spot_key="neon_right", start=D(1), days=3, today=TODAY)

        _run(body)

    def test_api_codes(self):
        async def body(s):
            low = await _user(s, level=1)
            u = await _user(s, level=3)
            await s.commit()
            with self.assertRaises(HTTPException) as cm:
                await ads_api.city_ads_quote(ads_api.QuoteBody(spot="tower_line", start=D(1), days=1), user=low, db=s)
            self.assertEqual(cm.exception.status_code, 403)
            with self.assertRaises(HTTPException) as cm:
                await ads_api.city_ads_quote(
                    ads_api.QuoteBody(spot="tower_line", start=ads.game_day() + timedelta(days=5), days=1, link_url="https://bit.ly/x"), user=u, db=s)
            self.assertEqual(cm.exception.status_code, 400)
            self.assertIn("сокращатели", cm.exception.detail)
            out = await ads_api.city_ads_quote(
                ads_api.QuoteBody(spot="banner_sky", start=ads.game_day() + timedelta(days=2), days=2, title=" SKY  TRAM ",
                                  subtitle="next 4 min", link_url="t.me/ton_nexus", color="Magenta"), user=u, db=s)
            self.assertEqual(out.total, "1")
            self.assertEqual(out.content.title, "SKY TRAM")
            self.assertEqual(out.content.link_url, "https://t.me/ton_nexus")
            self.assertEqual(out.content.link_kind, "telegram")
            self.assertEqual(out.content.color, "magenta")

        _run(body)

    def test_text_limits(self):
        cfg = ads.normalize({})
        V = ads.validate_content
        C = ads.AdContent
        self.assertEqual(V(cfg, "neon", C(title="TON NEXUS 24")).title, "TON NEXUS 24")
        with self.assertRaises(ads.CityAdError):
            V(cfg, "neon", C(title="Х" * 13))
        self.assertEqual(len(V(cfg, "line", C(title="Ж" * 60)).title), 60)
        with self.assertRaises(ads.CityAdError):
            V(cfg, "line", C(title="Ж" * 61))
        with self.assertRaises(ads.CityAdError):
            V(cfg, "banner", C(title="SKY", subtitle="x" * 19))
        with self.assertRaises(ads.CityAdError):  # подпись только у баннера
            V(cfg, "neon", C(title="SKY", subtitle="x"))
        with self.assertRaises(ads.CityAdError):
            V(cfg, "line", C(title="a\u202eb"))  # символы управления направлением текста
        with self.assertRaises(ads.CityAdError):
            V(cfg, "line", C(body="б" * 501))
        self.assertEqual(V(cfg, "line", C(body="строка 1\r\nстрока 2")).body, "строка 1\nстрока 2")
        with self.assertRaises(ads.CityAdError):
            V(cfg, "line", C(title="x", color="#ff0000"))
        with self.assertRaises(ads.CityAdError):  # полная проверка перед бронью: текст и цвет обязательны
            V(cfg, "line", C(body="x"), partial=False)
        full = V(cfg, "banner", C(title="SKY", subtitle="", color="cyan"), partial=False)
        self.assertEqual((full.title, full.color, full.subtitle), ("SKY", "cyan", None))


class Links(unittest.TestCase):
    def test_allowed(self):
        n = ads.normalize_link
        self.assertIsNone(n(""))
        self.assertIsNone(n(None))
        self.assertEqual(n("https://example.com/promo?a=1#x"), "https://example.com/promo?a=1#x")
        self.assertEqual(n("https://Example.COM"), "https://example.com")
        self.assertEqual(n("https://example.com:443/a"), "https://example.com/a")
        self.assertEqual(n("t.me/ton_nexus"), "https://t.me/ton_nexus")
        self.assertEqual(n("https://telegram.me/ton_nexus"), "https://t.me/ton_nexus")
        self.assertEqual(n("https://пример.рф/"), "https://xn--e1afmkfd.xn--p1ai/")
        self.assertEqual(ads.link_kind("https://t.me/x"), "telegram")
        self.assertEqual(ads.link_kind("https://example.com"), "web")

    def test_rejected(self):
        for bad in (
            "http://example.com",
            "ftp://example.com",
            "javascript:alert(1)",
            "data:text/html,hi",
            "tg://resolve?domain=x",
            "example.com",
            "//example.com",
            "https://user:pass@example.com",
            "https://example.com@evil.com",
            "https://example.com:8443/",
            "https://203.0.113.5/",
            "https://[2001:db8::1]/",
            "https://localhost/",
            "https://bit.ly/abc",
            "https://www.bit.ly/abc",
            "https://clck.ru/abc",
            "https://vk.cc/abc",
            "https://t.co/abc",
            "https://t.me/",
            "https://exa mple.com",
            "https://example.com/" + "a" * 600,
        ):
            with self.assertRaises(ads.CityAdError, msg=bad):
                ads.normalize_link(bad)


class Availability(unittest.TestCase):
    def test_unique_spot_day(self):
        async def body(s):
            u = await _user(s)
            await _book(s, u, "tower_line", D(3), 2)
            spot = await s.scalar(select(CityAdSpot).where(CityAdSpot.key == "tower_line"))
            other = await _book(s, u, "neon_left", D(3), 1)  # другое место в тот же день — можно
            await s.commit()
            s.add(CityAdDay(spot_id=spot.id, day=D(4), ad_id=other.id))
            with self.assertRaises(IntegrityError):
                await s.flush()
            await s.rollback()

        _run(body)

    def test_occupied_and_next_free(self):
        async def body(s):
            u = await _user(s)
            await _book(s, u, "tower_line", D(3), 3)  # 3..5
            await _book(s, u, "tower_line", D(8), 2, status="pending")  # 8..9 тоже держит дни
            await _book(s, u, "tower_line", D(6), 1, status="rejected")  # отклонённое дни не держит
            await _book(s, u, "neon_left", D(1), 30)
            q = await ads.quote(s, user=u, spot_key="tower_line", start=D(1), days=2, today=TODAY)
            self.assertTrue(q.available)
            self.assertEqual(q.next_free, D(1))
            q = await ads.quote(s, user=u, spot_key="tower_line", start=D(2), days=3, today=TODAY)
            self.assertFalse(q.available)
            self.assertEqual(q.occupied, [D(3), D(4)])
            self.assertEqual(q.next_free, D(10))  # 6..7 — только 2 суток, затем 8..9 заняты
            q = await ads.quote(s, user=u, spot_key="tower_line", start=D(2), days=2, today=TODAY)
            self.assertEqual(q.next_free, D(6))
            self.assertEqual(q.busy, [D(3), D(4), D(5), D(8), D(9)])
            self.assertEqual((q.earliest, q.latest), (D(1), D(ads.MAX_AHEAD_DAYS)))
            q = await ads.quote(s, user=u, spot_key="neon_left", start=D(1), days=1, today=TODAY)
            self.assertEqual(q.next_free, D(31))

        _run(body)

    def test_next_free_limits(self):
        busy = {D(i) for i in range(1, 92)}
        self.assertIsNone(ads.next_free_start(busy, frm=D(1), latest=D(90), days=1))
        self.assertEqual(ads.next_free_start(set(), frm=D(90), latest=D(90), days=30), D(90))


class Board(unittest.TestCase):
    def test_board_today_only_approved(self):
        async def body(s):
            u = await _user(s)
            await _book(s, u, "tower_line", TODAY, 2, title="TON NEXUS · NEW", body="Подробности", link_url="https://t.me/x")
            await _book(s, u, "neon_left", TODAY, 1, status="pending")
            await _book(s, u, "banner_sky", D(-3), 2)  # вчера закончилось
            await s.commit()
            resp = Response()
            data = await ads_api.city_ads_board(resp, db=s)
            self.assertIn("public", resp.headers["cache-control"])
            spots = {x["key"]: x for x in data["spots"]}
            self.assertEqual(list(spots), list(ads.SPOT_KEYS))
            self.assertEqual(data["day"], ads.game_day().isoformat())
            if data["day"] == TODAY.isoformat():
                self.assertEqual(spots["tower_line"]["ad"]["title"], "TON NEXUS · NEW")
                self.assertEqual(spots["tower_line"]["ad"]["link_kind"], "telegram")
            board = await ads.board(s, today=TODAY)
            spots = {x["key"]: x for x in board["spots"]}
            self.assertEqual(spots["tower_line"]["ad"]["until"], D(1).isoformat())
            self.assertNotIn("advertiser_id", spots["tower_line"]["ad"])
            self.assertIsNone(spots["neon_left"]["ad"])
            self.assertIsNone(spots["banner_sky"]["ad"])
            self.assertEqual(spots["tower_line"]["price_day"], "1")
            self.assertTrue(spots["neon_right"]["on_sale"])
            self.assertEqual(board["palette"]["cyan"], "#2BF5FF")

        _run(body)

    def test_ensure_spots_idempotent(self):
        async def body(s):
            self.assertEqual(await ads.ensure_spots(s), 0)
            rows = (await s.execute(select(CityAdSpot.key, CityAdSpot.format).order_by(CityAdSpot.sort))).all()
            self.assertEqual([tuple(r) for r in rows], [(k, f) for k, f, _, _ in ads.SPOTS])

        _run(body)


if __name__ == "__main__":
    unittest.main()
