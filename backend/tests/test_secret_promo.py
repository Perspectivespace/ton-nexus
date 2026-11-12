"""Секретный промокод в «Прогулке»: расписание (границы случайности), окно ввода, одна активация, гонки,
исчерпание, конец срока, выключение, ограничение перебора и то, что расписание не уходит наружу через API."""

from __future__ import annotations

import asyncio
import itertools
import os
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from unittest import mock

import httpx
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.models import BalanceHistory, PromoCode, PromoRedemption, User
from app.models.secret_promo import SecretPromoAppearance, SecretPromoCampaign, SecretPromoClaim
from app.services import promo as promo_svc
from app.services import secret_promo as svc

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
PG_URL = os.environ.get("TEST_PG_URL")
_TG = itertools.count(52000)
START = datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc)


def _run(fn):
    async def main():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as s:
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(main())


async def _user(s, **kw) -> User:
    u = User(telegram_id=next(_TG), balance=D("0"), level=1, **kw)
    s.add(u)
    await s.flush()
    return u


async def _campaign(s, owner, *, code="NEON-42", reward="0.5", max_uses=10, days=3, per_day=4, now=None, slot=None):
    """Кампания; slot=(сдвиг начала от настоящего «сейчас», минут, локация) — заменить расписание одним появлением."""
    camp = await svc.create_campaign(s, actor=owner, code=code, reward_ton=reward, max_uses=max_uses, days=days, per_day=per_day, now=now)
    if slot is not None:
        start = datetime.now(timezone.utc) + timedelta(minutes=slot[0])
        await s.execute(delete(SecretPromoAppearance).where(SecretPromoAppearance.campaign_id == camp.id))
        s.add(SecretPromoAppearance(campaign_id=camp.id, district=slot[2], starts_at=start, ends_at=start + timedelta(minutes=slot[1])))
        await s.flush()
        camp.slot = (start, start + timedelta(minutes=slot[1]))  # type: ignore[attr-defined]
    return camp


def _at(t: datetime):
    return mock.patch.object(svc, "_now", return_value=t)


class Schedule(unittest.TestCase):
    def test_bounds_any_hour_all_districts(self):
        slots = svc.draw_schedule(START, 30, 24)
        self.assertEqual(len(slots), 720)
        hours = set()
        for sl in slots:
            d = (sl.starts_at - START) // svc.DAY
            self.assertTrue(0 <= d < 30)
            self.assertLessEqual(sl.ends_at, START + (d + 1) * svc.DAY)  # целиком внутри своих суток
            self.assertTrue(svc.MIN_SECONDS <= (sl.ends_at - sl.starts_at).total_seconds() <= svc.MAX_SECONDS)
            self.assertIn(sl.district, svc.DISTRICTS)
            hours.add(sl.starts_at.hour)
        self.assertEqual({sl.district for sl in slots}, set(svc.DISTRICTS))
        self.assertGreaterEqual(len(hours), 20)  # любое время суток, и ночью тоже
        per_day = [sum(1 for sl in slots if (sl.starts_at - START) // svc.DAY == d) for d in range(30)]
        self.assertEqual(set(per_day), {24})

    def test_extremes(self):
        lo = svc.draw_schedule(START, 1, 1, randbelow=lambda n: 0)[0]
        self.assertEqual((lo.starts_at, (lo.ends_at - lo.starts_at).total_seconds(), lo.district), (START, 180, "centre"))
        hi = svc.draw_schedule(START, 1, 1, randbelow=lambda n: n - 1)[0]
        self.assertEqual((hi.ends_at, (hi.ends_at - hi.starts_at).total_seconds(), hi.district), (START + svc.DAY, 600, "port"))

    def test_uses_csprng(self):
        with mock.patch.object(svc.secrets, "randbelow", wraps=svc.secrets.randbelow) as rb:
            svc.draw_schedule(START, 2, 3)
        self.assertEqual(rb.call_count, 2 * 3 * 3)  # длительность, время, локация

    def test_create_validates_and_owner_only(self):
        async def body(s):
            owner, player = await _user(s, is_owner=True), await _user(s)
            with self.assertRaises(svc.SecretPromoPermissionError):
                await _campaign(s, player)
            for kw in ({"code": "ab"}, {"code": "ПРИВЕТ"}, {"reward": "0"}, {"reward": "1001"}, {"max_uses": 0}, {"days": 0},
                       {"days": 61}, {"per_day": 0}, {"per_day": 25}):
                with self.subTest(kw=kw), self.assertRaises(svc.SecretPromoError):
                    await _campaign(s, owner, **kw)
            camp = await _campaign(s, owner, days=2, per_day=5)
            self.assertEqual(await s.scalar(select(func.count()).select_from(SecretPromoAppearance).where(SecretPromoAppearance.campaign_id == camp.id)), 10)
            promo = await s.get(PromoCode, camp.promo_id)
            self.assertEqual((promo.code, promo.reward_ton, promo.max_uses, promo.reward_xp), ("NEON-42", D("0.5"), 10, 0))
            with self.assertRaises(svc.SecretPromoError):  # код занят
                await _campaign(s, owner)

        _run(body)


class Window(unittest.TestCase):
    def test_visible_only_in_place_and_time_entry_until_grace(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            a, b, c = await _user(s), await _user(s), await _user(s)
            camp = await _campaign(s, owner, slot=(-1, 5, "rows"))
            t0, t1 = camp.slot
            with _at(t0 - timedelta(seconds=1)):
                self.assertIsNone(await svc.visible_code(s, user=a, district="rows"))
                with self.assertRaises(promo_svc.PromoInvalid):
                    await promo_svc.redeem(s, user=a, code="neon-42")
            with _at(t0 + timedelta(minutes=2)):
                self.assertEqual(await svc.visible_code(s, user=a, district="rows"), "NEON-42")
                self.assertIsNone(await svc.visible_code(s, user=a, district="centre"))
                self.assertIsNone(await svc.visible_code(s, user=a, district="moon"))
                r = await promo_svc.redeem(s, user=a, code=" neon-42 ")
                self.assertEqual(r.reward_ton, D("0.5"))
                self.assertIsNone(await svc.visible_code(s, user=a, district="rows"))  # активировал — больше не видит
            with _at(t1 + svc.GRACE - timedelta(seconds=1)):
                self.assertIsNone(await svc.visible_code(s, user=b, district="rows"))  # уже не виден…
                await promo_svc.redeem(s, user=b, code="NEON-42")  # …но ввести ещё можно
            with _at(t1 + svc.GRACE + timedelta(seconds=1)):
                with self.assertRaises(promo_svc.PromoInvalid) as late:
                    await promo_svc.redeem(s, user=c, code="NEON-42")
                with self.assertRaises(promo_svc.PromoInvalid) as unknown:
                    await promo_svc.redeem(s, user=c, code="NO-SUCH")
                self.assertEqual(str(late.exception), str(unknown.exception))  # ответ не выдаёт время
            await s.refresh(a)
            self.assertEqual(D(a.balance), D("0.5"))
            rows = (await s.execute(select(BalanceHistory).where(BalanceHistory.user_id == a.id))).scalars().all()
            self.assertEqual([(h.operation_type, h.balance_type, h.reference_type, h.amount) for h in rows], [("credit", "promo", "promo", D("0.5"))])

        _run(body)

    def test_once_per_player_and_race_backstops(self):
        async def body(s):
            owner, a, b = await _user(s, is_owner=True), await _user(s), await _user(s)
            camp = await _campaign(s, owner, max_uses=2, slot=(-1, 5, "port"))
            aid, bid, camp_id = a.id, b.id, camp.id
            await promo_svc.redeem(s, user=a, code="NEON-42")
            await s.commit()
            with self.assertRaisesRegex(promo_svc.PromoError, "already"):
                await promo_svc.redeem(s, user=a, code="NEON-42")
            await s.rollback()
            # гонка: второй ввод прошёл проверку «уже вводил» до записи первого — ловит уникальный ключ активации
            await s.execute(delete(PromoRedemption).where(PromoRedemption.user_id == aid))
            await s.commit()
            with self.assertRaisesRegex(promo_svc.PromoError, "already"):
                await promo_svc.redeem(s, user=await s.get(User, aid), code="NEON-42")
            await s.rollback()
            self.assertEqual(D((await s.get(User, aid)).balance), D("0.5"))
            self.assertEqual(await s.scalar(select(func.count()).select_from(SecretPromoClaim)), 1)
            # гонка за последнюю активацию: пока b проверял, другой ввод забрал её — условный UPDATE не пускает
            real = svc.in_window

            async def taken(session, c, now=None):
                await session.execute(text("UPDATE promo_codes SET used_count = max_uses"))
                return await real(session, c, now)

            with mock.patch.object(svc, "in_window", side_effect=taken):
                with self.assertRaisesRegex(promo_svc.PromoError, "fully used"):
                    await promo_svc.redeem(s, user=await s.get(User, bid), code="NEON-42")
            await s.rollback()
            self.assertEqual(D((await s.get(User, bid)).balance), D("0"))
            self.assertEqual(camp_id, (await s.scalar(select(SecretPromoCampaign.id))))

        _run(body)

    def test_exhausted_finished_disabled_stop_appearing(self):
        async def body(s):
            owner, a, b = await _user(s, is_owner=True), await _user(s), await _user(s)
            camp = await _campaign(s, owner, max_uses=1, slot=(-1, 5, "centre"))
            await promo_svc.redeem(s, user=a, code="NEON-42")
            await s.commit()
            camp_id, bid = camp.id, b.id
            self.assertIsNone(await svc.visible_code(s, user=b, district="centre"))  # активации кончились
            with self.assertRaisesRegex(promo_svc.PromoError, "fully used"):
                await promo_svc.redeem(s, user=b, code="NEON-42")
            await s.rollback()
            b = await s.get(User, bid)
            owner = await s.scalar(select(User).where(User.is_owner.is_(True)))
            # конец срока: кампания на 1 день, заведённая 2 дня назад
            old = await _campaign(s, owner, code="OLD-1", days=1, now=datetime.now(timezone.utc) - timedelta(days=2))
            for d in svc.DISTRICTS:
                self.assertIsNone(await svc.visible_code(s, user=b, district=d))
            # выключение владельцем
            live = await _campaign(s, owner, code="LIVE-2", slot=(-1, 5, "rows"))
            self.assertEqual(await svc.visible_code(s, user=b, district="rows"), "LIVE-2")
            with self.assertRaises(svc.SecretPromoPermissionError):
                await svc.disable(s, actor=b, campaign_id=live.id)
            await svc.disable(s, actor=owner, campaign_id=live.id)
            self.assertIsNone(await svc.visible_code(s, user=b, district="rows"))
            with self.assertRaises(promo_svc.PromoInvalid):
                await promo_svc.redeem(s, user=b, code="LIVE-2")
            stats = {c.code: c for c in await svc.list_campaigns(s, actor=owner)}
            self.assertEqual({k: v.status for k, v in stats.items()}, {"NEON-42": "exhausted", "OLD-1": "finished", "LIVE-2": "disabled"})
            self.assertEqual((stats["NEON-42"].used_count, stats["NEON-42"].max_uses), (1, 1))
            self.assertEqual((stats["OLD-1"].appearances_total, stats["OLD-1"].appearances_done), (4, 4))
            self.assertEqual(camp_id, stats["NEON-42"].id)
            self.assertEqual(old.days, 1)

        _run(body)


class Api(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.db.session import get_db
        from app.main import app

        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.addAsyncCleanup(self.engine.dispose)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

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
            s.add(User(telegram_id=tg, balance=D("0"), level=1, **kw))
            await s.commit()
        return tg

    @staticmethod
    def h(tg: int) -> dict:
        return {"X-Telegram-Init-Data": f"dev:{tg}"}

    async def test_owner_admin_and_no_schedule_leak(self):
        owner, player = await self.user(is_owner=True), await self.user()
        body = {"code": "glow-77", "reward_ton": "0.25", "max_uses": 50, "days": 2, "per_day": 6}
        self.assertEqual((await self.client.post("/api/v1/owner/secret-promos", headers=self.h(player), json=body)).status_code, 403)
        self.assertEqual((await self.client.get("/api/v1/owner/secret-promos", headers=self.h(player))).status_code, 403)
        r = await self.client.post("/api/v1/owner/secret-promos", headers=self.h(owner), json=body)
        self.assertEqual(r.status_code, 201, r.text)
        item = r.json()
        self.assertEqual((item["code"], item["reward_ton"], item["appearances_total"], item["status"]), ("GLOW-77", "0.25", 12, "active"))
        keys = {"id", "code", "reward_ton", "max_uses", "used_count", "days", "per_day", "appearances_total", "appearances_done",
                "status", "created_at", "ends_at"}
        self.assertEqual(set(item), keys)  # ни времени, ни мест появлений
        self.assertEqual((await self.client.post("/api/v1/owner/secret-promos", headers=self.h(owner), json={**body, "days": 0})).status_code, 400)
        # одно появление — сейчас, в «Порту»
        async with self.S() as s:
            camp = await s.scalar(select(SecretPromoCampaign))
            times = [(a.starts_at, a.ends_at) for a in (await s.scalars(select(SecretPromoAppearance))).all()]
            now = datetime.now(timezone.utc)
            s.add(SecretPromoAppearance(campaign_id=camp.id, district="port", starts_at=now - timedelta(minutes=1), ends_at=now + timedelta(minutes=4)))
            await s.commit()
        texts = []
        for d in ("centre", "rows", "port", "moon"):
            r = await self.client.get(f"/api/v1/city/signal?district={d}", headers=self.h(player))
            self.assertEqual(r.status_code, 200)
            self.assertEqual(set(r.json()), {"code"})
            texts.append(r.text)
        self.assertEqual(r.json(), {"code": None})
        self.assertEqual(json_code(texts[2]), "GLOW-77")
        lst = await self.client.get("/api/v1/owner/secret-promos", headers=self.h(owner))
        texts += [lst.text, (await self.client.get("/openapi.json")).text]
        for st, en in times:  # расписание не встречается ни в одном ответе
            for t in (st, en):
                stamp = t.replace(tzinfo=None).isoformat(timespec="seconds")
                for body_text in texts:
                    self.assertNotIn(stamp, body_text)
        schema = (await self.client.get("/openapi.json")).json()["components"]["schemas"]
        self.assertEqual(set(schema["SignalOut"]["properties"]), {"code"})
        self.assertEqual(set(schema["CampaignOut"]["properties"]), keys)
        # общий список промокодов — без секретных
        promo_list = (await self.client.get("/api/v1/promo/list", headers=self.h(owner))).json()
        self.assertNotIn("GLOW-77", [p["code"] for p in promo_list])
        # активация и выключение
        r = await self.client.post("/api/v1/promo/redeem", headers=self.h(player), json={"code": "glow-77"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(D(r.json()["reward_ton"]), D("0.25"))
        r = await self.client.post(f"/api/v1/owner/secret-promos/{camp.id}/disable", headers=self.h(owner))
        self.assertEqual((r.status_code, r.json()["status"], r.json()["used_count"]), (200, "disabled", 1))
        self.assertEqual((await self.client.post("/api/v1/owner/secret-promos/999/disable", headers=self.h(owner))).status_code, 404)

    async def test_wrong_attempts_rate_limited(self):
        owner, player = await self.user(is_owner=True), await self.user()
        async with self.S() as s:
            o = await s.scalar(select(User).where(User.telegram_id == owner))
            await _campaign(s, o, slot=(-1, 5, "rows"))
            await s.commit()
        for i in range(svc.FAIL_LIMIT):
            r = await self.client.post("/api/v1/promo/redeem", headers=self.h(player), json={"code": f"WRONG-{i}"})
            self.assertEqual(r.status_code, 400)
        r = await self.client.post("/api/v1/promo/redeem", headers=self.h(player), json={"code": "NEON-42"})
        self.assertEqual(r.status_code, 429)  # даже верный код — после серии неверных
        async with self.S() as s:
            self.assertEqual(D((await s.scalar(select(User).where(User.telegram_id == player))).balance), D("0"))
        # другой игрок не задет; через окно — снова можно
        other = await self.user()
        self.assertEqual((await self.client.post("/api/v1/promo/redeem", headers=self.h(other), json={"code": "NEON-42"})).status_code, 200)
        later = datetime.now(timezone.utc) + svc.FAIL_WINDOW + timedelta(seconds=5)
        with mock.patch.object(svc, "_now", return_value=later):
            self.assertFalse(await self._limited(player, later))

    async def _limited(self, tg, now):
        async with self.S() as s:
            u = await s.scalar(select(User).where(User.telegram_id == tg))
            return await svc.too_many_failures(s, u.id, now)


class Migration(unittest.TestCase):
    def test_024_matches_models_and_rolls_back(self):
        import importlib.util
        import pathlib

        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "024_secret_promo.py"
        spec = importlib.util.spec_from_file_location("mig_024", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual((mod.revision, mod.down_revision), ("024", "023"))
        new = ("secret_promo_campaigns", "secret_promo_appearances", "secret_promo_claims", "promo_failed_attempts")
        engine = sa.create_engine("sqlite://")
        Base.metadata.create_all(engine, tables=[t for n, t in Base.metadata.tables.items() if n not in new])

        def run(fn):
            with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
                fn()

        run(mod.upgrade)
        insp = sa.inspect(engine)
        for name in new:
            self.assertEqual({c["name"] for c in insp.get_columns(name)}, set(Base.metadata.tables[name].columns.keys()), name)
        self.assertEqual(
            {tuple(u["column_names"]) for u in insp.get_unique_constraints("secret_promo_claims")}, {("campaign_id", "user_id")}
        )
        run(mod.downgrade)
        self.assertFalse(set(new) & set(sa.inspect(engine).get_table_names()))


def json_code(t: str):
    import json

    return json.loads(t)["code"]


@unittest.skipUnless(PG_URL, "нет TEST_PG_URL — гонка активаций на Postgres пропущена")
class PostgresRace(unittest.TestCase):
    """Одновременные вводы в разных сессиях: один игрок — одно начисление; лимит активаций не превышается."""

    def test_race(self):
        async def main():
            engine = create_async_engine(PG_URL, pool_size=10)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
            maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
            try:
                async with maker() as s:
                    owner = await _user(s, is_owner=True)
                    players = [await _user(s) for _ in range(5)]
                    await _campaign(s, owner, max_uses=3, slot=(-1, 5, "rows"))
                    await s.commit()
                    ids = [p.id for p in players]

                async def one(uid):
                    async with maker() as s:
                        try:
                            await promo_svc.redeem(s, user=await s.get(User, uid), code="NEON-42")
                            await s.commit()
                            return "ok"
                        except promo_svc.PromoError:
                            await s.rollback()
                            return "refused"

                same = await asyncio.gather(*(one(ids[0]) for _ in range(4)))
                self.assertEqual(same.count("ok"), 1, same)
                many = await asyncio.gather(*(one(uid) for uid in ids[1:]))
                self.assertEqual(many.count("ok"), 2, many)  # всего 3 активации
                async with maker() as s:
                    self.assertEqual(await s.scalar(select(PromoCode.used_count)), 3)
                    credits = await s.scalar(select(func.count()).select_from(BalanceHistory).where(BalanceHistory.balance_type == "promo"))
                    self.assertEqual(credits, 3)
            finally:
                await engine.dispose()

        asyncio.run(main())


if __name__ == "__main__":
    unittest.main()
