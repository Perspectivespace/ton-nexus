"""«Честность» (R1, теневой режим): журнал событий, затухание, лимиты, пороги проверки, тиры,
хуки из заданий (деньги не меняются), нормализация настроек, API только для владельца, миграция 026.

SQLite в памяти. Запуск из backend: python -m unittest tests.test_integrity
"""

import asyncio
import itertools
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import mock

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.models import BalanceHistory, IntegrityEvent, Task, TaskSubmission, User  # noqa: F401
from app.services import integrity as isvc
from app.services import integrity_rules as rules
from app.services import tasks as t_svc
from app.services.economy_admin import EconomyAdminError, get_setting_admin, set_setting

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
D = Decimal
UTC = timezone.utc
T0 = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
_TG = itertools.count(7000)


async def _env():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def run(coro_fn):
    async def main():
        engine, maker = await _env()
        try:
            async with maker() as s:
                await coro_fn(s)
        finally:
            await engine.dispose()

    asyncio.run(main())


async def _user(s, **kw):
    kw.setdefault("balance", D("0"))
    u = User(telegram_id=next(_TG), **kw)
    s.add(u)
    await s.flush()
    return u


async def _count(s, **where):
    q = select(func.count(IntegrityEvent.id))
    for k, v in where.items():
        q = q.where(getattr(IntegrityEvent, k) == v)
    return int((await s.execute(q)).scalar_one())


async def _published(s, *, slots=2, reward="0.1"):
    admin = await _user(s, is_admin=True)
    amb = await _user(s, balance=D("100"), is_ambassador=True)
    v = await t_svc.create_task(s, creator=amb, title="T", description="D", reward=D(reward), total_slots=slots)
    await t_svc.approve_task(s, task_id=v.id, actor=admin)
    await t_svc.publish_task(s, task_id=v.id, actor=amb)
    return admin, amb, v.id


async def _sub(s, task_id, worker=None):
    w = worker or await _user(s)
    sub = await t_svc.submit(s, user=w, task_id=task_id, proof_text="готово")
    return w, sub


class CoreTest(unittest.TestCase):
    def test_new_user_defaults(self):
        async def body(s):
            u = await _user(s)
            await s.refresh(u)
            self.assertEqual((u.integrity, u.integrity_tier), (500, "neutral"))

        run(body)

    def test_idempotent(self):
        async def body(s):
            u = await _user(s)
            a = await isvc.record_event(s, user_id=u.id, event_type="submission_accepted",
                                        source_type="submission", source_id=1, now=T0)
            b = await isvc.record_event(s, user_id=u.id, event_type="submission_accepted",
                                        source_type="submission", source_id=1, now=T0)
            self.assertEqual(a.id, b.id)
            self.assertEqual(await _count(s), 1)
            self.assertEqual(u.integrity, 503)

        run(body)

    def test_daily_cap_msk(self):
        async def body(s):
            u = await _user(s)
            day = datetime(2026, 11, 10, 20, 59, tzinfo=UTC)  # 23:59 МСК
            evs = [await isvc.record_event(s, user_id=u.id, event_type="submission_accepted",
                                           source_type="submission", source_id=i, now=day - timedelta(hours=i))
                   for i in range(6)]
            self.assertEqual([e.delta for e in evs], [3, 3, 3, 3, 3, 0])
            nxt = await isvc.record_event(s, user_id=u.id, event_type="submission_accepted",
                                          source_type="submission", source_id=100,
                                          now=datetime(2026, 11, 10, 21, 1, tzinfo=UTC))  # 00:01 МСК
            self.assertEqual(nxt.delta, 3)

        run(body)

    def test_decay_and_fraud(self):
        async def body(s):
            u = await _user(s)
            await isvc.record_event(s, user_id=u.id, event_type="submission_rejected_low_quality",
                                    source_type="submission", source_id=1, now=T0)
            score, _ = await isvc.recompute(s, u.id, now=T0 + timedelta(days=90))
            self.assertEqual(score, 495)
            await isvc.void_event(s, event_id=1, actor=u, reason="тест", now=T0)
            admin = await _user(s, is_owner=True)
            ev = await isvc.adjust(s, user_id=u.id, actor=admin, reason="мошенник", fraud=True, now=T0)
            self.assertEqual((ev.event_type, ev.delta, ev.half_life_days, ev.status), ("fraud", -300, None, "applied"))
            score, tier = await isvc.recompute(s, u.id, now=T0 + timedelta(days=1000))
            self.assertEqual((score, tier), (200, "unfriendly"))

        run(body)

    def test_tiers_and_clamp(self):
        cases = {0: "hostile", 199: "hostile", 200: "unfriendly", 399: "unfriendly", 400: "neutral",
                 599: "neutral", 600: "friendly", 749: "friendly", 750: "honored", 849: "honored",
                 850: "revered", 949: "revered", 950: "exalted", 1000: "exalted"}
        for score, tier in cases.items():
            self.assertEqual(rules.tier_for(score), tier, score)

        async def body(s):
            u = await _user(s)
            owner = await _user(s, is_owner=True)
            await isvc.adjust(s, user_id=u.id, actor=owner, reason="вверх", delta=1000, now=T0)
            self.assertEqual((u.integrity, u.integrity_tier), (1000, "exalted"))
            await isvc.adjust(s, user_id=u.id, actor=owner, reason="вниз", delta=-1000, now=T0)
            await isvc.adjust(s, user_id=u.id, actor=owner, reason="вниз", delta=-1000, now=T0)
            self.assertEqual((u.integrity, u.integrity_tier), (0, "hostile"))

        run(body)

    def test_pending_review_confirm_void(self):
        async def body(s):
            u = await _user(s)
            owner = await _user(s, is_owner=True)
            ev = await isvc.record_event(s, user_id=u.id, event_type="submission_rejected_forged",
                                         source_type="submission", source_id=1, now=T0)
            self.assertEqual(ev.status, "pending_review")
            self.assertEqual(u.integrity, 500)
            await isvc.confirm_event(s, event_id=ev.id, actor=owner, now=T0)
            self.assertEqual(u.integrity, 440)
            with self.assertRaises(isvc.IntegrityActionError):
                await isvc.confirm_event(s, event_id=ev.id, actor=owner, now=T0)
            await isvc.void_event(s, event_id=ev.id, actor=owner, reason="ошибка", now=T0)
            self.assertEqual(u.integrity, 500)
            with self.assertRaises(isvc.IntegrityActionError):
                await isvc.void_event(s, event_id=ev.id, actor=owner, reason="ошибка", now=T0)
            big = await isvc.record_event(s, user_id=u.id, event_type="stars_chargeback",
                                          source_type="stars", source_id=9, now=T0)
            self.assertEqual(big.status, "pending_review")  # −100 ≤ −50

        run(body)

    def test_day_threshold(self):
        async def body(s):
            u = await _user(s)
            st = [(await isvc.record_event(s, user_id=u.id, event_type="submission_rejected_duplicate",
                                           source_type="submission", source_id=i, now=T0)).status
                  for i in range(6)]
            self.assertEqual(st, ["applied"] * 5 + ["pending_review"])  # −75, затем −90 ≤ −80
            self.assertEqual(u.integrity, 425)

        run(body)

    def test_disabled_writes_nothing(self):
        async def body(s):
            await set_setting(s, key="integrity_rules", value={"enabled": False})
            admin, amb, tid = await _published(s, slots=1)
            w, sub = await _sub(s, tid)
            await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=True)
            self.assertEqual(D(w.balance), D("0.1"))
            self.assertEqual(await _count(s), 0)

        run(body)

    def test_normalize(self):
        n = rules.normalize({"shadow_mode": False, "gates": {"enabled": True},
                             "weights": {"fraud": {"delta": -500, "half_life_days": 30}}})
        self.assertTrue(n["shadow_mode"])
        self.assertFalse(n["gates"]["enabled"])
        self.assertEqual(n["weights"]["fraud"], {"delta": -500, "half_life_days": 0})
        for bad in ({"weights": {"submission_accepted": {"delta": -3}}},
                    {"start": 1001},
                    {"tiers": [{"key": "neutral", "min": 0}]},
                    {"caps": {"accepted_per_day": 1.5}}):
            with self.assertRaises(rules.IntegrityRulesError, msg=str(bad)):
                rules.normalize(bad)

        async def body(s):
            with self.assertRaises(EconomyAdminError):
                await set_setting(s, key="integrity_rules", value={"weights": {"fraud": {"delta": 5}}})
            await set_setting(s, key="integrity_rules", value={"shadow_mode": False})
            view = await get_setting_admin(s, "integrity_rules")
            self.assertTrue(view.value["shadow_mode"])

        run(body)


class HooksTest(unittest.TestCase):
    def test_review_reject_reasons_and_money_unchanged(self):
        async def body(s):
            admin, amb, tid = await _published(s, slots=3)
            w, sub = await _sub(s, tid)
            with self.assertRaises(t_svc.TaskError):
                await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=False,
                                              reject_reason="nope")
            with self.assertRaises(t_svc.TaskError):
                await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=False,
                                              reject_reason="other")
            await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=False,
                                          reject_reason="low_quality", note="размыто")
            self.assertEqual(sub.reject_reason, "low_quality")
            self.assertEqual(w.integrity, 490)
            # без кода (старый клиент): отказ проходит как «other», события нет
            w2, sub2 = await _sub(s, tid)
            await t_svc.review_submission(s, actor=admin, submission_id=sub2.id, approve=False)
            self.assertEqual(sub2.reject_reason, "other")
            self.assertEqual(await _count(s, user_id=w2.id), 0)
            # принятие: +3 и выплата как раньше
            w3, sub3 = await _sub(s, tid)
            await t_svc.review_submission(s, actor=admin, submission_id=sub3.id, approve=True)
            self.assertEqual(D(w3.balance), D("0.1"))
            hist = (await s.scalars(select(BalanceHistory).where(BalanceHistory.user_id == w3.id))).all()
            self.assertEqual([(D(h.amount), h.reference_type) for h in hist], [(D("0.1"), "task_submission")])
            self.assertEqual(w3.integrity, 503)

        run(body)

    def test_streak(self):
        async def body(s):
            admin, amb, tid = await _published(s, slots=30, reward="0.01")
            w = await _user(s)
            from app.models.task import Task as T

            async def one(approve):
                # каждая заявка — в своё задание (одна заявка на задание)
                v = await t_svc.create_task(s, creator=amb, title="X", description="D", reward=D("0.01"), total_slots=5)
                await t_svc.approve_task(s, task_id=v.id, actor=admin)
                await t_svc.publish_task(s, task_id=v.id, actor=amb)
                sub = await t_svc.submit(s, user=w, task_id=v.id, proof_text="ok")
                await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=approve,
                                              reject_reason=None if approve else "wrong_task")

            for _ in range(10):
                await one(True)
            self.assertEqual(await _count(s, user_id=w.id, event_type="submission_streak_10"), 1)
            await one(False)
            for _ in range(9):
                await one(True)
            self.assertEqual(await _count(s, user_id=w.id, event_type="submission_streak_10"), 1)
            await one(True)
            self.assertEqual(await _count(s, user_id=w.id, event_type="submission_streak_10"), 2)
            del T

        run(body)

    def test_slow_review_and_cap(self):
        async def body(s):
            admin, amb, tid = await _published(s, slots=8, reward="0.01")
            for i in range(7):
                w, sub = await _sub(s, tid)
                sub.created_at = datetime.now(UTC) - timedelta(hours=73)
                await s.flush()
                await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=True)
            slow = (await s.scalars(select(IntegrityEvent.delta).where(
                IntegrityEvent.user_id == amb.id, IntegrityEvent.event_type == "author_review_slow"))).all()
            self.assertEqual(sum(slow), -10)
            self.assertEqual(slow[:5], [-2] * 5)

        run(body)

    def test_author_events(self):
        async def body(s):
            admin, amb, tid = await _published(s, slots=1)
            self.assertEqual(await _count(s, user_id=amb.id, event_type="author_task_approved"), 1)
            w, sub = await _sub(s, tid)
            await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=True)
            self.assertEqual(await _count(s, user_id=amb.id, event_type="author_task_completed"), 1)
            v = await t_svc.create_task(s, creator=amb, title="плохое", description="D", reward=D("0.1"), total_slots=1)
            with self.assertRaises(t_svc.TaskError):
                await t_svc.reject_task(s, task_id=v.id, actor=admin, reject_reason="spam")
            await t_svc.reject_task(s, task_id=v.id, actor=admin, reject_reason="bad_task", note="мусор")
            self.assertEqual((await s.get(Task, v.id)).reject_reason, "bad_task")
            self.assertEqual(await _count(s, user_id=amb.id, event_type="author_task_rejected_bad"), 1)
            self.assertEqual(amb.integrity, 500 + 5 + 10 - 15)

        run(body)


class ApiTest(unittest.IsolatedAsyncioTestCase):
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

    async def _u(self, **kw):
        async with self.S() as s:
            u = await _user(s, **kw)
            await s.commit()
            return u.id, u.telegram_id

    @staticmethod
    def h(tg):
        return {"X-Telegram-Init-Data": f"dev:{tg}"}

    async def test_owner_only_and_adjust(self):
        uid, utg = await self._u()
        oid, otg = await self._u(is_owner=True)
        c = self.client
        calls = [("get", "/api/v1/integrity/summary", None), ("get", f"/api/v1/integrity/users/{uid}", None),
                 ("post", f"/api/v1/integrity/users/{uid}/recompute", None),
                 ("post", f"/api/v1/integrity/users/{uid}/adjust", {"delta": 5, "reason": "тест"}),
                 ("get", "/api/v1/integrity/review", None), ("post", "/api/v1/integrity/events/1/confirm", None),
                 ("post", "/api/v1/integrity/events/1/void", {"reason": "тест"})]
        for m, url, js in calls:
            r = await c.request(m, url, json=js, headers=self.h(utg))
            self.assertEqual(r.status_code, 403, url)
        r = await c.post(f"/api/v1/integrity/users/{uid}/adjust", json={"delta": 5}, headers=self.h(otg))
        self.assertIn(r.status_code, (400, 422))
        r = await c.post(f"/api/v1/integrity/users/{uid}/adjust", json={"delta": 5, "reason": "за помощь"},
                         headers=self.h(otg))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["event"]["event_type"], r.json()["integrity"]), ("manual_adjust", 505))
        r = await c.get(f"/api/v1/integrity/users/{uid}", headers=self.h(otg))
        self.assertEqual((r.json()["integrity"], r.json()["tier"], len(r.json()["events"])), (505, "neutral", 1))
        r = await c.get("/api/v1/integrity/summary", headers=self.h(otg))
        self.assertEqual(r.json()["tiers"]["neutral"], 2)
        r = await c.post("/api/v1/integrity/events/1/confirm", headers=self.h(otg))
        self.assertEqual(r.status_code, 400)
        # /me не отдаёт счёт
        r = await c.get("/api/v1/me", headers=self.h(utg))
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("integrity", r.text)


class MigrationTest(unittest.TestCase):
    def test_026_idempotent_up_down(self):
        """026 поверх схемы без «Честности»: up, повторный up ничего не ломает, down убирает."""
        import importlib.util
        import pathlib

        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "026_integrity_core.py"
        spec = importlib.util.spec_from_file_location("m026", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        eng = sa.create_engine("sqlite://")
        with eng.begin() as conn:
            Base.metadata.create_all(conn)
            conn.execute(sa.text("DROP TABLE integrity_events"))
            for t, c in (("users", "integrity"), ("users", "integrity_tier"), ("users", "integrity_updated_at"),
                         ("tasks", "reject_reason"), ("tasks", "min_integrity"), ("task_submissions", "reject_reason")):
                conn.execute(sa.text(f"ALTER TABLE {t} DROP COLUMN {c}"))

        def apply(fn):
            with eng.begin() as conn:
                ctx = MigrationContext.configure(conn)
                with mock.patch.object(mod, "op", Operations(ctx)):
                    fn()

        apply(mod.upgrade)
        apply(mod.upgrade)
        insp = sa.inspect(eng)
        self.assertIn("integrity_events", insp.get_table_names())
        self.assertIn("integrity", [c["name"] for c in insp.get_columns("users")])
        apply(mod.downgrade)
        insp = sa.inspect(eng)
        self.assertNotIn("integrity_events", insp.get_table_names())
        self.assertNotIn("integrity", [c["name"] for c in insp.get_columns("users")])
        self.assertNotIn("reject_reason", [c["name"] for c in insp.get_columns("task_submissions")])


if __name__ == "__main__":
    unittest.main()
