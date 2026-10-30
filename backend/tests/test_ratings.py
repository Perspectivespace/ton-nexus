"""Рейтинги: журнал опыта, топ по уровню, топ исполнителей, «скоро» у друзей, условие друга, призы, API.

На SQLite в памяти. Запуск из backend: python -m unittest discover -s tests
"""

import asyncio
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import Task, TaskSubmission, TowerMonthlyBest, User, XpEvent
from app.services import levels
from app.services import ratings as rt
from app.services import tower_prizes as tp
from app.services.economy_admin import EconomyAdminError, set_setting
from app.services.economy_seed import DEFAULTS

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

UTC = timezone.utc
# 27 окт 2026, 12:00 МСК
NOW = datetime(2026, 10, 27, 9, 0, tzinfo=UTC)
# 30 сен 2026, 23:30 МСК — ещё сентябрь по Москве (а по UTC тоже 30-е)
SEPT = datetime(2026, 9, 30, 20, 30, tzinfo=UTC)
# 1 окт 2026, 00:30 МСК — уже октябрь по Москве, хотя по UTC ещё 30 сентября
OCT_EARLY = datetime(2026, 9, 30, 21, 30, tzinfo=UTC)


def run_db(fn):
    async def main():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as s:
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(main())


async def make_user(s, n, **kw) -> User:
    u = User(telegram_id=1000 + n, first_name=kw.pop("first_name", f"P{n}"), **kw)
    s.add(u)
    await s.flush()
    return u


async def make_task(s, creator) -> Task:
    t = Task(creator_id=creator.id, title="t", description="d", reward=Decimal("0.1"), total_slots=100, status="active")
    s.add(t)
    await s.flush()
    return t


async def approve(s, task, user, at, n=1, status="approved"):
    for i in range(n):
        s.add(TaskSubmission(task_id=task.id, user_id=user.id, status=status, reviewed_at=at + timedelta(seconds=i)))
    await s.flush()


ON = {**tp.DEFAULT, "enabled": True, "budget_ton": "10", "min_participants": 2, "base_places": 2, "ladder_max_places": 2}


class XpLogTest(unittest.TestCase):
    def test_add_xp_writes_event_with_source(self):
        async def body(s):
            u = await make_user(s, 1)
            await levels.add_xp(s, u, 40, "task", now=NOW)
            await levels.add_xp(s, u, 0, "daily", now=NOW)  # ноль не пишется
            await s.flush()
            rows = (await s.scalars(select(XpEvent))).all()
            self.assertEqual([(r.user_id, r.amount, r.source) for r in rows], [(u.id, 40, "task")])

        run_db(body)

    def test_add_xp_without_session_still_works(self):
        from types import SimpleNamespace
        from unittest import mock

        async def curve(_s, _k):
            return {"base": 100, "growth": 1.35}

        u = SimpleNamespace(xp=0, level=1, id=None)
        with mock.patch.object(levels, "get_setting", curve):
            self.assertEqual(asyncio.run(levels.add_xp(None, u, 120)), 1)


class LevelBoardTest(unittest.TestCase):
    def test_all_time_order_and_me(self):
        async def body(s):
            a = await make_user(s, 1, level=5, xp=10)
            b = await make_user(s, 2, level=5, xp=40)
            c = await make_user(s, 3, level=7, xp=0)
            d = await make_user(s, 4, level=5, xp=40)  # как b, но позже — ниже
            await make_user(s, 5, level=9, is_banned=True)
            out = await rt.board(s, kind="level", period=None, user_id=a.id, now=NOW)
            self.assertEqual(out["period"], "all")
            self.assertEqual(out["periods"], ["all"])  # без призов месяца нет
            self.assertEqual([e["name"] for e in out["entries"]], ["P3", "P2", "P4", "P1"])
            self.assertEqual(out["total_players"], 4)
            self.assertEqual(out["me"]["rank"], 4)
            # кривая по умолчанию: уровень 5 → нужно base*growth^4
            need = levels.xp_needed(DEFAULTS["xp_per_level"][0], 5)
            self.assertEqual(out["me"]["xp_to_next"], need - 10)
            self.assertIsNone(out["prize"])
            del b, c, d

        run_db(body)

    def test_month_period_needs_prizes_and_counts_xp_gain(self):
        async def body(s):
            a = await make_user(s, 1, level=10)
            b = await make_user(s, 2, level=2)
            s.add_all(
                [
                    XpEvent(user_id=a.id, amount=500, source="task", created_at=SEPT),  # сентябрь — не считается
                    XpEvent(user_id=a.id, amount=30, source="daily", created_at=OCT_EARLY),
                    XpEvent(user_id=b.id, amount=80, source="task", created_at=NOW - timedelta(days=1)),
                    XpEvent(user_id=b.id, amount=20, source="wheel", created_at=NOW - timedelta(hours=1)),
                ]
            )
            await s.flush()
            off = await rt.board(s, kind="level", period="month", user_id=a.id, now=NOW)
            self.assertEqual(off["period"], "all")  # призы выключены — месяца нет
            await set_setting(s, key="level_prizes", value=ON)
            out = await rt.board(s, kind="level", period="month", user_id=a.id, now=NOW)
            self.assertEqual(out["periods"], ["all", "month"])
            self.assertEqual([(e["name"], e["value"]) for e in out["entries"]], [("P2", 100), ("P1", 30)])
            self.assertEqual(out["me"], {"rank": 2, "value": 30, "next_rank": 1, "need": 71})
            self.assertEqual(out["prize"]["places"], 2)
            self.assertEqual(out["prize"]["budget_ton"], "10")
            self.assertEqual(out["prize"]["cutoff_value"], 30)

        run_db(body)


class TasksBoardTest(unittest.TestCase):
    def test_month_and_all_time(self):
        async def body(s):
            owner = await make_user(s, 0)
            t = await make_task(s, owner)
            a = await make_user(s, 1)
            b = await make_user(s, 2)
            c = await make_user(s, 3)
            await approve(s, t, a, SEPT, 5)  # сентябрь
            await approve(s, t, a, OCT_EARLY, 2)  # октябрь по Москве
            await approve(s, t, b, NOW - timedelta(days=3), 3)
            await approve(s, t, c, NOW - timedelta(days=5), 2)  # 2, как у a, но позже (a — 1 октября) — ниже
            await approve(s, t, c, NOW, 4, status="rejected")
            await approve(s, t, c, NOW, 1, status="pending")
            m = await rt.board(s, kind="tasks", period=None, user_id=a.id, now=NOW)
            self.assertEqual(m["period"], "month")
            self.assertEqual(m["periods"], ["month", "all"])
            self.assertEqual([(e["name"], e["value"]) for e in m["entries"]], [("P2", 3), ("P1", 2), ("P3", 2)])
            self.assertEqual(m["me"], {"rank": 2, "value": 2, "next_rank": 1, "need": 2})
            m3 = await rt.board(s, kind="tasks", period="month", user_id=c.id, now=NOW)
            self.assertEqual(m3["me"], {"rank": 3, "value": 2, "next_rank": 2, "need": 1})
            self.assertEqual(m["month"], "2026-10")
            al = await rt.board(s, kind="tasks", period="all", user_id=a.id, now=NOW)
            self.assertEqual([(e["name"], e["value"]) for e in al["entries"]], [("P1", 7), ("P2", 3), ("P3", 2)])
            self.assertEqual(al["me"], {"rank": 1, "value": 7})
            nobody = await rt.board(s, kind="tasks", period="month", user_id=owner.id, now=NOW)
            self.assertIsNone(nobody["me"])
            self.assertEqual(nobody["total_players"], 3)

        run_db(body)

    def test_banned_hidden_and_prize_plan(self):
        async def body(s):
            owner = await make_user(s, 0)
            t = await make_task(s, owner)
            users = [await make_user(s, i) for i in range(1, 5)]
            for i, u in enumerate(users):
                await approve(s, t, u, NOW - timedelta(days=1), i + 1)
            users[3].is_banned = True
            await s.flush()
            await set_setting(s, key="tasks_prizes", value={**ON, "min_score": 2})
            m = await rt.board(s, kind="tasks", period="month", user_id=users[0].id, now=NOW)
            self.assertEqual([e["value"] for e in m["entries"]], [3, 2, 1])
            p = m["prize"]
            self.assertEqual((p["participants"], p["min_score"], p["places"]), (2, 2, 2))
            self.assertEqual(sum(Decimal(g["ton"]) * (g["to_place"] - g["from_place"] + 1) for g in p["prizes"]) <= 10, True)
            # всё время — без призов
            self.assertIsNone((await rt.board(s, kind="tasks", period="all", user_id=users[0].id, now=NOW))["prize"])

        run_db(body)


class FriendsTest(unittest.TestCase):
    def test_friends_soon_with_rule(self):
        async def body(s):
            u = await make_user(s, 1)
            out = await rt.board(s, kind="friends", period=None, user_id=u.id, now=NOW)
            self.assertTrue(out["soon"])
            self.assertEqual(out["entries"], [])
            self.assertEqual(out["rule"], {"min_level": 3, "min_tasks": 20, "need_both": False})
            await set_setting(s, key="friend_rule", value={"min_level": 5, "min_tasks": 0, "need_both": True})
            out = await rt.board(s, kind="friends", period="all", user_id=u.id, now=NOW)
            self.assertEqual(out["rule"], {"min_level": 5, "min_tasks": 0, "need_both": True})

        run_db(body)

    def test_rule_validation(self):
        n = rt.normalize_friend_rule
        self.assertEqual(n({}), rt.FRIEND_DEFAULT)
        self.assertEqual(n({"min_level": 1})["min_level"], 0)  # 1-й уровень у всех = выключено
        for bad in ({"min_level": -1}, {"min_tasks": 1.5}, {"need_both": 1}, {"foo": 1}, [], {"min_level": True}):
            with self.assertRaises(rt.RatingError):
                n(bad)

    def test_qualifies(self):
        q = rt.friend_qualifies
        r = {"min_level": 3, "min_tasks": 20, "need_both": False}
        self.assertTrue(q(r, level=3, approved_tasks=0))
        self.assertTrue(q(r, level=1, approved_tasks=20))
        self.assertFalse(q(r, level=2, approved_tasks=19))
        both = {**r, "need_both": True}
        self.assertFalse(q(both, level=3, approved_tasks=19))
        self.assertTrue(q(both, level=3, approved_tasks=20))
        self.assertTrue(q({**r, "min_tasks": 0}, level=3, approved_tasks=0))
        self.assertFalse(q({**both, "min_tasks": 0}, level=2, approved_tasks=100))
        self.assertTrue(q({"min_level": 0, "min_tasks": 0, "need_both": True}, level=1, approved_tasks=0))


class SettingsTest(unittest.TestCase):
    def test_defaults_disabled_and_same_model(self):
        for k in rt.PRIZE_KEYS.values():
            self.assertEqual(DEFAULTS[k][0], tp.DEFAULT)
            self.assertFalse(DEFAULTS[k][0]["enabled"])
        self.assertEqual(DEFAULTS["friend_rule"][0], rt.FRIEND_DEFAULT)
        from app.services.economy_admin import SETTING_CATALOG

        groups = {c["key"]: c["group"] for c in SETTING_CATALOG}
        for k in [*rt.PRIZE_KEYS.values(), "friend_rule"]:
            self.assertEqual(groups[k], "ratings")

    def test_set_setting_validates(self):
        async def body(s):
            with self.assertRaisesRegex(EconomyAdminError, "бюджет"):
                await set_setting(s, key="tasks_prizes", value={**tp.DEFAULT, "enabled": True})
            with self.assertRaisesRegex(EconomyAdminError, "level_prizes: лишние поля"):
                await set_setting(s, key="level_prizes", value={**tp.DEFAULT, "x": 1})
            with self.assertRaisesRegex(EconomyAdminError, "min_tasks"):
                await set_setting(s, key="friend_rule", value={"min_tasks": -3})
            v = await set_setting(s, key="friends_prizes", value={**ON, "budget_ton": "5.50"})
            self.assertEqual(v.value["budget_ton"], "5.5")

        run_db(body)


class SummaryApiTest(unittest.TestCase):
    def test_api(self):
        from app.api.deps import get_current_user
        from app.db.session import get_db
        from app.main import app

        async def main():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
            from app.services import tower as tw

            async with maker() as s:
                me = await make_user(s, 1, first_name="Сергей", level=4)
                other = await make_user(s, 2, first_name="Аня", level=6)
                t = await make_task(s, other)
                now = datetime.now(UTC)
                await approve(s, t, me, now - timedelta(minutes=5), 2)
                s.add(TowerMonthlyBest(user_id=me.id, month=tw.month_of(now), best_score=40, achieved_at=now))
                await s.commit()
                me_id = me.id

            async def db_dep():
                async with maker() as session:
                    yield session

            async def user_dep():
                async with maker() as session:
                    return await session.get(User, me_id)

            app.dependency_overrides[get_db] = db_dep
            app.dependency_overrides[get_current_user] = user_dep
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
                    r = await c.get("/api/v1/ratings/summary")
                    self.assertEqual(r.status_code, 200, r.text)
                    j = r.json()
                    self.assertEqual((j["level"]["rank"], j["level"]["total"]), (2, 2))
                    self.assertEqual((j["tasks"]["rank"], j["tasks"]["value"], j["tasks"]["total"]), (1, 2, 1))
                    self.assertEqual((j["tower"]["rank"], j["tower"]["value"]), (1, 40))
                    self.assertTrue(j["friends"]["soon"])
                    self.assertEqual(j["friend_rule"]["min_tasks"], 20)
                    self.assertEqual(j["prizes"], {"level": False, "tasks": False, "friends": False, "tower": False})

                    r = await c.get("/api/v1/ratings/level")
                    self.assertEqual(r.status_code, 200, r.text)
                    self.assertEqual([e["name"] for e in r.json()["entries"]], ["Аня", "Сергей"])
                    r = await c.get("/api/v1/ratings/tasks?period=all")
                    self.assertEqual(r.json()["entries"][0]["is_me"], True)
                    r = await c.get("/api/v1/ratings/friends")
                    self.assertTrue(r.json()["soon"])
                    self.assertEqual((await c.get("/api/v1/ratings/nope")).status_code, 404)
                    self.assertEqual((await c.get("/api/v1/ratings/tasks?period=week")).status_code, 400)
            finally:
                app.dependency_overrides.clear()
                await engine.dispose()

        asyncio.run(main())


if __name__ == "__main__":
    unittest.main()
