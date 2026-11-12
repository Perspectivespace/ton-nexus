"""Районы города (PR 1 районов): район у места, цена по типу места и своя цена места, экран на фасаде,
витрина/расчёт/бронь принимают район. PR 6: места «Неон-рядов» и «Порта» продаются (миграция 021),
владелец может снять любое с продажи."""

from __future__ import annotations

import asyncio
import importlib.util
import pathlib
import unittest
import warnings
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException, Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import city_ads as ads_api
from app.db.base import Base
from app.models import CityAd, CityAdDay, CityAdEvent, CityAdSpot, User  # noqa: F401
from app.services import city_ads as ads
from app.services.economy_admin import set_setting
from app.services.economy_seed import DEFAULTS, seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
NANO = 10**9
TODAY = date(2026, 11, 9)
D = lambda n: TODAY + timedelta(days=n)  # noqa: E731
CENTRE = ("tower_line", "banner_sky", "banner_street", "neon_left", "neon_right")
ROWS = ("rows_facade", "rows_line", "rows_neon", "rows_banner")
PORT = ("port_line", "port_banner_cargo", "port_banner_tram", "port_neon")
# так выглядела настройка city_ads до районов (её хранит действующая база)
OLD_SETTING = {
    "min_level": 3,
    "min_days": 1,
    "max_days": 30,
    "body_max": 500,
    "spots": {
        "tower_line": {"price_day": "1", "enabled": True},
        "banner_sky": {"price_day": "0.5", "enabled": True},
        "banner_street": {"price_day": "0.5", "enabled": True},
        "neon_left": {"price_day": "0.3", "enabled": True},
        "neon_right": {"price_day": "0.3", "enabled": True},
    },
    "limits": {"line": {"title_max": 60}, "banner": {"title_max": 14, "subtitle_max": 18}, "neon": {"title_max": 12}},
}


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


_tg = [12000]


async def _user(s, level=3, balance="10"):
    _tg[0] += 1
    u = User(telegram_id=_tg[0], level=level, balance=Decimal(balance))
    s.add(u)
    await s.commit()
    return u


async def _sell(s, *keys, **extra):
    spots = {k: {"enabled": True} for k in keys}
    await set_setting(s, key="city_ads", value={"spots": spots, **extra})
    await s.commit()


def _migration(name: str):
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / name
    spec = importlib.util.spec_from_file_location(f"mig_{name[:3]}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Spots(unittest.TestCase):
    def test_spot_list(self):
        self.assertEqual(ads.district_keys("centre"), CENTRE)
        self.assertEqual(ads.district_keys("rows"), ROWS)
        self.assertEqual(ads.district_keys("port"), PORT)
        fmt = {k: f for k, f, _, _ in ads.SPOTS}
        self.assertEqual([fmt[k] for k in ROWS], ["facade_screen", "line", "neon", "banner"])
        self.assertEqual([fmt[k] for k in PORT], ["line", "banner", "banner", "neon"])
        self.assertEqual(sum(1 for f in fmt.values() if f == "facade_screen"), 1)  # экран — только в «Неон-рядах»
        self.assertEqual(ads.FORMAT_RU["facade_screen"], "Экран на фасаде")

    def test_migration_copy_matches_code(self):
        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "020_city_districts.py"
        spec = importlib.util.spec_from_file_location("mig020", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual((mod.revision, mod.down_revision), ("020", "019"))
        code = {k: (f, t, srt, ads.SPOT_DISTRICT[k]) for k, f, t, srt in ads.SPOTS if ads.SPOT_DISTRICT[k] != "centre"}
        self.assertEqual({k: (f, t, srt, d) for k, f, t, srt, d in mod.NEW_SPOTS}, code)

    def test_migration_021_puts_district_spots_on_sale(self):
        import json

        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        from app.models import EconomySetting

        mod = _migration("021_city_districts_on_sale.py")
        self.assertEqual((mod.revision, mod.down_revision), ("021", "020"))
        self.assertEqual(mod.DISTRICT_SPOTS, ROWS + PORT)
        self.assertEqual(mod.PRICES, DEFAULTS["city_ads"][0]["prices"])
        self.assertEqual(mod.FACADE_LIMITS, DEFAULTS["city_ads"][0]["limits"]["facade_screen"])
        # действующая база: настройка до районов (свои цены Центра, одно место снято) и после PR 1 (места выключены)
        old = json.loads(json.dumps(OLD_SETTING))
        old["spots"]["neon_left"] = {"price_day": "0.25", "enabled": False}
        pr1 = json.loads(json.dumps(DEFAULTS["city_ads"][0]))
        for k in ROWS + PORT:
            pr1["spots"][k] = {"enabled": False}
        pr1["spots"]["port_neon"] = {"price_day": "0.7", "enabled": False}
        for name, value in (("old", old), ("pr1", pr1)):
            with self.subTest(name):
                engine = sa.create_engine("sqlite://")
                EconomySetting.__table__.create(engine)
                with engine.begin() as conn:
                    conn.execute(
                        sa.insert(EconomySetting.__table__).values(key="city_ads", value_json=json.dumps(value, ensure_ascii=False))
                    )
                    conn.execute(sa.insert(EconomySetting.__table__).values(key="other", value_json='{"x": 1}'))

                def run(fn):
                    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
                        fn()

                def stored(key="city_ads"):
                    with engine.connect() as conn:
                        return json.loads(conn.scalar(sa.text("SELECT value_json FROM economy_settings WHERE key = :k"), {"k": key}))

                run(mod.upgrade)
                got = stored()
                cfg = ads.normalize(got)  # результат — допустимая настройка
                for k in ROWS + PORT:
                    self.assertTrue(cfg["spots"][k]["enabled"], k)
                for k in CENTRE:  # Центр — как было
                    self.assertEqual(got["spots"][k], value["spots"][k])
                self.assertEqual((got["min_level"], got["max_days"]), (value["min_level"], value["max_days"]))
                self.assertEqual(ads.spot_price_day(cfg, "rows_facade"), "1.5")
                if name == "pr1":
                    self.assertEqual(got["spots"]["port_neon"], {"price_day": "0.7", "enabled": True})  # своя цена цела
                self.assertEqual(stored("other"), {"x": 1})
                run(mod.upgrade)  # повторный запуск ничего не ломает
                self.assertEqual(stored(), got)
                run(mod.downgrade)
                down = stored()
                self.assertFalse(any(down["spots"][k]["enabled"] for k in ROWS + PORT))
                self.assertEqual({k: down["spots"][k] for k in CENTRE}, {k: value["spots"][k] for k in CENTRE})

    def test_migration_021_without_setting_row(self):
        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        from app.models import EconomySetting

        mod = _migration("021_city_districts_on_sale.py")
        engine = sa.create_engine("sqlite://")
        EconomySetting.__table__.create(engine)
        with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
        with engine.connect() as conn:
            self.assertEqual(conn.scalar(sa.text("SELECT count(*) FROM economy_settings")), 0)

    def test_migration_023_any_level(self):
        import json

        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        from app.models import EconomySetting

        mod = _migration("023_city_ads_any_level.py")
        self.assertEqual((mod.revision, mod.down_revision), ("023", "022"))
        self.assertEqual(mod.NEW_DEFAULT, DEFAULTS["city_ads"][0]["min_level"])
        # прежний порог по умолчанию → 1; свой порог владельца (5) не трогается; без поля — считается прежним
        no_field = {k: v for k, v in OLD_SETTING.items() if k != "min_level"}
        for name, value, up, down in (
            ("default", OLD_SETTING, 1, 3),
            ("owner", {**OLD_SETTING, "min_level": 5}, 5, 5),
            ("no_field", no_field, 1, 3),
        ):
            with self.subTest(name):
                engine = sa.create_engine("sqlite://")
                EconomySetting.__table__.create(engine)
                with engine.begin() as conn:
                    conn.execute(sa.insert(EconomySetting.__table__).values(key="city_ads", value_json=json.dumps(value, ensure_ascii=False)))
                    conn.execute(sa.insert(EconomySetting.__table__).values(key="other", value_json='{"min_level": 3}'))

                def run(fn):
                    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
                        fn()

                def stored(key="city_ads"):
                    with engine.connect() as conn:
                        return json.loads(conn.scalar(sa.text("SELECT value_json FROM economy_settings WHERE key = :k"), {"k": key}))

                run(mod.upgrade)
                got = stored()
                self.assertEqual(ads.normalize(got)["min_level"], up)
                self.assertEqual({k: v for k, v in got.items() if k != "min_level"}, {k: v for k, v in value.items() if k != "min_level"})
                self.assertEqual(stored("other"), {"min_level": 3})
                run(mod.upgrade)  # повторный запуск ничего не меняет
                self.assertEqual(stored(), got)
                run(mod.downgrade)
                self.assertEqual(ads.normalize(stored())["min_level"], down)
        # нет строки настройки — ничего не делается
        engine = sa.create_engine("sqlite://")
        EconomySetting.__table__.create(engine)
        with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
        with engine.connect() as conn:
            self.assertEqual(conn.scalar(sa.text("SELECT count(*) FROM economy_settings")), 0)

    def test_ensure_spots_sets_district(self):
        async def body(s):
            rows = (await s.execute(select(CityAdSpot.key, CityAdSpot.district, CityAdSpot.enabled))).all()
            got = {k: (d, e) for k, d, e in rows}
            self.assertEqual(len(got), 13)
            for k in CENTRE:
                self.assertEqual(got[k], ("centre", True))
            for k in ROWS:
                self.assertEqual(got[k][0], "rows")
            for k in PORT:
                self.assertEqual(got[k][0], "port")
            self.assertEqual(await ads.ensure_spots(s), 0)

        _run(body)


class Pricing(unittest.TestCase):
    def test_defaults(self):
        cfg = ads.normalize(DEFAULTS["city_ads"][0])
        self.assertEqual(
            {f: p["price_day"] for f, p in cfg["prices"].items()},
            {"line": "1", "banner": "0.5", "neon": "0.3", "facade_screen": "1.5"},
        )
        # Центр — прежние цены; районы — по типу места
        self.assertEqual([ads.spot_price_day(cfg, k) for k in CENTRE], ["1", "0.5", "0.5", "0.3", "0.3"])
        self.assertEqual([ads.spot_price_day(cfg, k) for k in ROWS], ["1.5", "1", "0.3", "0.5"])
        self.assertEqual([ads.spot_price_day(cfg, k) for k in PORT], ["1", "0.5", "0.5", "0.3"])
        self.assertEqual(ads.price_nano(cfg, "rows_facade", 7), (1_500_000_000, 10_500_000_000))
        # места районов продаются (PR 6); цена — по типу места
        for k in ROWS + PORT:
            self.assertEqual(cfg["spots"][k], {"enabled": True})
        self.assertEqual(cfg["limits"]["facade_screen"], {"title_max": 24, "subtitle_max": 32})

    def test_old_setting_back_compat(self):
        cfg = ads.normalize(OLD_SETTING)
        self.assertEqual(cfg["spots"]["tower_line"], {"price_day": "1", "enabled": True})
        self.assertEqual(cfg["spots"]["neon_right"], {"price_day": "0.3", "enabled": True})
        self.assertEqual(cfg["spots"]["rows_facade"], {"enabled": True})
        self.assertEqual(cfg["prices"]["facade_screen"]["price_day"], "1.5")
        self.assertEqual(ads.normalize(cfg), cfg)  # повторная нормализация ничего не меняет

    def test_type_price_and_override(self):
        cfg = ads.normalize(
            {
                "prices": {"banner": {"price_day": "0.6"}, "facade_screen": {"price_day": "2"}},
                "spots": {"port_neon": {"price_day": "0,7"}, "banner_street": {"price_day": ""}},
            }
        )
        self.assertEqual(ads.spot_price_day(cfg, "port_banner_cargo"), "0.6")  # цена типа
        self.assertEqual(ads.spot_price_day(cfg, "banner_sky"), "0.5")  # у места Центра своя цена
        self.assertEqual(ads.spot_price_day(cfg, "banner_street"), "0.6")  # своя цена убрана → цена типа
        self.assertEqual(ads.spot_price_day(cfg, "port_neon"), "0.7")  # своя цена места
        self.assertEqual(ads.spot_price_day(cfg, "rows_facade"), "2")
        self.assertEqual(cfg["spots"]["port_neon"], {"price_day": "0.7", "enabled": True})

    def test_bad_values(self):
        for bad in (
            {"prices": {"moon": {"price_day": "1"}}},
            {"prices": {"line": {"price_day": "0"}}},
            {"prices": {"line": {"price_day": "1001"}}},
            {"prices": {"line": {"price": "1"}}},
            {"prices": {"line": "1"}},
            {"prices": []},
            {"spots": {"rows_facade": {"price_day": "-1"}}},
            {"spots": {"rows_facade": {"enabled": "yes"}}},
        ):
            with self.subTest(bad=bad), self.assertRaises(ads.CityAdError):
                ads.normalize(bad)


class Board(unittest.TestCase):
    def test_default_is_centre(self):
        async def body(s):
            data = await ads_api.city_ads_board(Response(), db=s)
            self.assertEqual([x["key"] for x in data["spots"]], list(CENTRE))
            self.assertEqual({x["district"] for x in data["spots"]}, {"centre"})
            self.assertEqual(data["district"], "centre")
            self.assertEqual(data["prices"]["facade_screen"], "1.5")

        _run(body)

    def test_districts(self):
        async def body(s):
            rows = await ads_api.city_ads_board(Response(), db=s, district="rows")
            spots = {x["key"]: x for x in rows["spots"]}
            self.assertEqual(list(spots), list(ROWS))
            self.assertEqual(spots["rows_facade"]["format"], "facade_screen")
            self.assertEqual(spots["rows_facade"]["price_day"], "1.5")
            self.assertTrue(all(x["on_sale"] for x in rows["spots"]))
            self.assertEqual(spots["rows_facade"]["title"], "Экран на фасаде рынка")
            port = await ads_api.city_ads_board(Response(), db=s, district="port")
            self.assertEqual([x["key"] for x in port["spots"]], list(PORT))
            every = await ads_api.city_ads_board(Response(), db=s, district="all")
            self.assertEqual(len(every["spots"]), 13)
            with self.assertRaises(HTTPException) as e:
                await ads_api.city_ads_board(Response(), db=s, district="moon")
            self.assertEqual(e.exception.status_code, 400)

        _run(body)


class QuoteAndBook(unittest.TestCase):
    def test_on_sale_and_owner_can_switch_off(self):
        async def body(s):
            u = await _user(s)
            for k in ROWS + PORT:  # по умолчанию все места районов продаются
                with self.subTest(k=k):
                    q = await ads.quote(s, user=u, spot_key=k, start=D(1), days=1, today=TODAY, district=ads.SPOT_DISTRICT[k])
                    self.assertEqual(q.district, ads.SPOT_DISTRICT[k])
            q = await ads.quote(s, user=u, spot_key="rows_facade", start=D(1), days=3, today=TODAY, district="rows")
            self.assertEqual((q.district, q.format, q.price_day, q.total), ("rows", "facade_screen", "1.5", "4.5"))
            # владелец снимает место с продажи — купить нельзя, витрина показывает «не продаётся»
            await set_setting(s, key="city_ads", value={"spots": {"port_neon": {"enabled": False}}})
            await s.commit()
            with self.assertRaises(ads.CityAdError):
                await ads.quote(s, user=u, spot_key="port_neon", start=D(1), days=1, today=TODAY, district="port")
            port = await ads_api.city_ads_board(Response(), db=s, district="port")
            self.assertEqual({x["key"]: x["on_sale"] for x in port["spots"]}["port_neon"], False)

        _run(body)

    def test_level_needed(self):
        async def body(s):
            first = await _user(s, level=1)
            q = await ads.quote(s, user=first, spot_key="rows_line", start=D(1), days=1, today=TODAY, district="rows")
            self.assertTrue(q.available)  # районы — тоже с любого уровня
            await set_setting(s, key="city_ads", value={"min_level": 3})
            u = await _user(s, level=2)
            with self.assertRaises(ads.CityAdPermissionError):
                await ads.quote(s, user=u, spot_key="rows_line", start=D(1), days=1, today=TODAY, district="rows")

        _run(body)

    def test_district_must_match(self):
        async def body(s):
            u = await _user(s)
            await _sell(s, "port_line")
            with self.assertRaises(ads.CityAdError):
                await ads.quote(s, user=u, spot_key="port_line", start=D(1), days=1, today=TODAY, district="rows")
            with self.assertRaises(ads.CityAdError):
                await ads.quote(s, user=u, spot_key="tower_line", start=D(1), days=1, today=TODAY, district="moon")
            q = await ads.quote(s, user=u, spot_key="tower_line", start=D(1), days=1, today=TODAY, district="centre")
            self.assertEqual((q.district, q.price_day), ("centre", "1"))
            q = await ads.quote(s, user=u, spot_key="port_line", start=D(1), days=1, today=TODAY)  # без района — как раньше
            self.assertEqual(q.district, "port")

        _run(body)

    def test_book_facade_screen(self):
        async def body(s):
            u = await _user(s)
            await _sell(s, "rows_facade", "rows_neon")
            c = ads.AdContent(title="PIXEL CAFE", subtitle="второй кофе в подарок", color="amber")
            ad = await ads.book(s, user=u, spot_key="rows_facade", start=D(1), days=2, content=c, today=TODAY, district="rows")
            await s.commit()
            self.assertEqual((ad.format, ad.price_day_nano, ad.paid_nano), ("facade_screen", 1_500_000_000, 3_000_000_000))
            self.assertEqual(ad.subtitle, "второй кофе в подарок")
            await s.refresh(u)
            self.assertEqual(Decimal(u.balance), Decimal("7"))
            with self.assertRaises(ads.CityAdError):  # подпись — только у баннера и экрана
                await ads.book(
                    s, user=u, spot_key="rows_neon", start=D(1), days=1, today=TODAY,
                    content=ads.AdContent(title="NEON", subtitle="нет", color="cyan"),
                )
            with self.assertRaises(ads.CityAdError):  # заголовок экрана — до 24 символов
                await ads.quote(
                    s, user=u, spot_key="rows_facade", start=D(5), days=1, today=TODAY, strict=True,
                    content=ads.AdContent(title="Ж" * 25, color="cyan"),
                )

        _run(body)

    def test_api_district(self):
        async def body(s):
            u = await _user(s)
            await _sell(s, "port_banner_tram")
            with self.assertRaises(ValidationError):
                ads_api.QuoteBody(spot="port_banner_tram", start=D(1), days=1, district="moon")
            with self.assertRaises(ValidationError):
                ads_api.BookBody(spot="port_banner_tram", start=D(1), days=1, title="X", color="cyan", district="moon")
            self.assertIsNone(ads_api.QuoteBody(spot="tower_line", start=D(1), days=1).district)
            bb = ads_api.BookBody(
                spot="port_banner_tram", start=ads.game_day() + timedelta(days=1), days=1, title="TRAM", color="cyan",
                district="port",
            )
            out = await ads_api.city_ads_book(bb, user=u, db=s)
            self.assertEqual((out.spot, out.district, out.price_day), ("port_banner_tram", "port", "0.5"))
            mine = await ads_api.city_ads_mine(user=u, db=s)
            self.assertEqual([(a.spot, a.district) for a in mine], [("port_banner_tram", "port")])
            self.assertEqual(mine[0].spot_title, "Голо-баннер на станции трамвая")
            with self.assertRaises(HTTPException) as e:
                await ads_api.city_ads_book(
                    ads_api.BookBody(
                        spot="port_banner_tram", start=ads.game_day() + timedelta(days=2), days=1, title="TRAM",
                        color="cyan", district="rows",
                    ),
                    user=u, db=s,
                )
            self.assertEqual(e.exception.status_code, 400)

        _run(body)


if __name__ == "__main__":
    unittest.main()
