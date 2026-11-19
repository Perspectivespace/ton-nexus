"""Достижения: настройка, выдача ступеней, ручное подтверждение, «старт с нуля», рассылка, API, миграция 029.

Запуск из backend: python -m unittest tests.test_achievements
"""

import itertools
import json
import unittest
import warnings
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest import mock

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.models import AchievementAward, ArenaEntry, ArenaRoom, BalanceHistory, EconomySetting, Miner, Task, TaskSubmission, User
from app.models.tower import TowerGame
from app.services import achievement_rules as rules
from app.services import achievements as svc

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
_TG = itertools.count(71000)
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)


class RulesTest(unittest.TestCase):
    def test_defaults_are_valid_and_match_spec(self):
        d = rules.normalize(rules.defaults())
        self.assertEqual([t["at"] for t in d["branches"]["tasks"]["tiers"]], [10, 25, 50, 100, 250, 500, 1000, 2500, 5000])
        self.assertEqual([t["ton"] for t in d["branches"]["tasks"]["tiers"]][-1], "20")
        self.assertEqual([t["at"] for t in d["branches"]["miner"]["tiers"]], [5, 10, 25, 50, 75, 100, 120])
        self.assertEqual(len(d["branches"]["games"]["tiers"]), 10)
        self.assertEqual([t["at"] for t in d["branches"]["level"]["tiers"]][-1], 300)
        self.assertEqual([t["at"] for t in d["branches"]["ambassador"]["tiers"]], [1, 10, 50, 100, 300])
        self.assertTrue(d["retroactive"])
        self.assertIsNone(d["start_at"])
        self.assertEqual(d["manual_from_ton"], "10")

    def test_validation(self):
        v = rules.defaults()
        v["branches"]["tasks"]["tiers"].append({"at": 10, "ton": "1"})
        with self.assertRaises(rules.AchievementRulesError):
            rules.normalize(v)
        v = rules.defaults()
        v["branches"]["tasks"]["tiers"][0]["ton"] = "-1"
        with self.assertRaises(rules.AchievementRulesError):
            rules.normalize(v)
        v = rules.defaults()
        v["branches"]["ambassador"]["tiers"][0]["ton"] = "5"  # ветка без TON
        v["branches"]["tasks"]["tiers"][0]["ton"] = "0,05"
        v["branches"]["tasks"]["tiers"].reverse()
        out = rules.normalize(v)
        self.assertEqual(out["branches"]["ambassador"]["tiers"][0]["ton"], "0")
        self.assertEqual(out["branches"]["tasks"]["tiers"][0], {"at": 10, "ton": "0.05", "xp": 10, "enabled": True})

    def test_retroactive_switch_sets_and_keeps_start(self):
        v = {**rules.defaults(), "retroactive": False}
        out = rules.normalize(v, now=NOW)
        self.assertEqual(out["start_at"], NOW.isoformat())
        again = rules.normalize({**out}, prev=out, now=NOW + timedelta(days=3))
        self.assertEqual(again["start_at"], NOW.isoformat())
        self.assertIsNone(rules.normalize({**out, "retroactive": True})["start_at"])

    def test_metals(self):
        self.assertEqual([rules.metal(i, 9) for i in range(9)],
                         ["bronze", "bronze", "silver", "silver", "gold", "gold", "platinum", "platinum", "neon"])
        self.assertEqual([rules.metal(i, 5) for i in range(5)], list(rules.METALS))
        self.assertEqual(rules.metal(6, 7), "neon")

    def test_ton_str_has_no_exponent(self):
        self.assertEqual([svc.ton_str(Decimal(x)) for x in ("10", "20.00000000", "0.03", "0", "100")], ["10", "20", "0.03", "0", "100"])


class Base_(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.addAsyncCleanup(self.engine.dispose)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

    async def user(self, s, **kw) -> User:
        u = User(telegram_id=next(_TG), balance=Decimal("0"), **kw)
        s.add(u)
        await s.flush()
        return u

    async def setting(self, s, **changes):
        v = {**rules.defaults(), **changes}
        s.add(EconomySetting(key=rules.KEY, value_json=json.dumps(v)))
        await s.flush()

    async def approved(self, s, user, n, when=NOW):
        author = await self.user(s)
        task = Task(creator_id=author.id, title="t", description="d", reward=Decimal("0.01"), total_slots=10000, status="active")
        s.add(task)
        await s.flush()
        for _ in range(n):
            s.add(TaskSubmission(task_id=task.id, user_id=user.id, status="approved", reviewed_at=when))
        await s.flush()


class CheckTest(Base_):
    async def test_tasks_branch_pays_once_with_xp(self):
        async with self.S() as s:
            u = await self.user(s)
            await self.approved(s, u, 26)
            new = await svc.check(s, u, now=NOW)
            self.assertEqual(sorted((a.branch, a.tier, a.status) for a in new), [("tasks", 10, "paid"), ("tasks", 25, "paid")])
            await s.commit()
            u = await s.get(User, u.id)
            self.assertEqual(Decimal(u.balance), Decimal("0.09"))
            self.assertEqual(u.xp, 30)  # 10 + 20 XP за две ступени
            hist = (await s.scalars(select(BalanceHistory).where(BalanceHistory.user_id == u.id))).all()
            self.assertEqual({h.balance_type for h in hist}, {"achievement"})
            self.assertEqual(await svc.check(s, u, now=NOW), [])  # повторно не выдаётся

    async def test_miner_level_and_badge_only_tier(self):
        async with self.S() as s:
            u = await self.user(s)
            s.add(Miner(user_id=u.id, power=3, capacity=3, acceleration=2, luck=1, stability=1))
            await s.flush()
            new = await svc.check(s, u, now=NOW)
            self.assertEqual(sorted((a.tier, str(Decimal(a.ton).normalize())) for a in new if a.branch == "miner"),
                             [(5, "0"), (10, "0.07")])

    async def test_games_count_only_real_participations(self):
        async with self.S() as s:
            u = await self.user(s)
            room = ArenaRoom(room_type="a4", seats=4, stake_nano=1, commission_bps=0, seed=1, seed_salt="s", seed_hash="h",
                             fill_deadline=NOW, status="finished")
            s.add(room)
            await s.flush()
            s.add(ArenaEntry(room_id=room.id, user_id=u.id, seat=0, status="lost"))
            room2 = ArenaRoom(room_type="a4", seats=4, stake_nano=1, commission_bps=0, seed=2, seed_salt="s", seed_hash="h",
                              fill_deadline=NOW, status="refunded")
            s.add(room2)
            await s.flush()
            s.add(ArenaEntry(room_id=room2.id, user_id=u.id, seat=None, status="refunded"))  # вышел до старта
            for score, status in ((120, "finished"), (0, "finished"), (90, "started"), (50, "rejected")):
                s.add(TowerGame(user_id=u.id, seed=1, game_day=date(2026, 11, 19), started_at=NOW, finished_at=NOW,
                                status=status, score=score))
            s.add(BalanceHistory(user_id=u.id, operation_type="credit", amount=Decimal("0"), balance_type="prize_wheel",
                                 balance_after=Decimal("0")))
            await s.flush()
            self.assertEqual(await svc.games_played(s, u.id), 3)  # бой + забег со счётом + колесо

    async def test_manual_approval_above_threshold(self):
        async with self.S() as s:
            await self.setting(s, manual_from_ton="0.06")
            owner = await self.user(s, is_owner=True)
            u = await self.user(s)
            await self.approved(s, u, 25)
            new = {a.tier: a for a in await svc.check(s, u, now=NOW)}
            self.assertEqual((new[10].status, new[25].status), ("paid", "pending"))
            await s.commit()
            self.assertEqual(Decimal((await s.get(User, u.id)).balance), Decimal("0.03"))
            summ = await svc.owner_summary(s)
            self.assertEqual((summ["paid_ton"], summ["pending_ton"], summ["counts"]["pending"]), ("0.03", "0.06", 1))
            self.assertEqual(summ["pending"][0]["tier"], 25)
            await svc.approve(s, award_id=new[25].id, actor=owner)
            await s.commit()
            self.assertEqual(Decimal((await s.get(User, u.id)).balance), Decimal("0.09"))
            with self.assertRaises(svc.AchievementError):
                await svc.reject(s, award_id=new[25].id, actor=owner)
            self.assertEqual((await svc.owner_summary(s))["paid_ton"], "0.09")

    async def test_low_integrity_goes_to_owner_when_enabled(self):
        async with self.S() as s:
            await self.setting(s, manual_low_integrity=True)
            u = await self.user(s, integrity_tier="hostile")
            await self.approved(s, u, 10)
            (a,) = await svc.check(s, u, now=NOW)
            self.assertEqual(a.status, "pending")

    async def test_banned_and_disabled(self):
        async with self.S() as s:
            u = await self.user(s, is_banned=True)
            await self.approved(s, u, 10)
            self.assertEqual(await svc.check(s, u, now=NOW), [])
        async with self.S() as s:
            v = rules.defaults()
            v["branches"]["tasks"]["tiers"][0]["enabled"] = False
            s.add(EconomySetting(key=rules.KEY, value_json=json.dumps(v)))
            u = await self.user(s)
            await self.approved(s, u, 10)
            self.assertEqual(await svc.check(s, u, now=NOW), [])

    async def test_start_from_zero(self):
        from app.services.economy_admin import set_setting

        async with self.S() as s:
            old = await self.user(s, level=12)
            s.add(Miner(user_id=old.id, power=5, capacity=5, acceleration=5, luck=5, stability=5))  # уровень майнера 25
            await self.approved(s, old, 12, when=NOW - timedelta(days=5))
            await s.flush()
            with mock.patch("app.services.achievement_rules.datetime") as dt:
                dt.now.return_value = NOW
                dt.fromisoformat = datetime.fromisoformat
                await set_setting(s, key=rules.KEY, value={**rules.defaults(), "retroactive": False})
            base = (await s.scalars(select(AchievementAward).where(AchievementAward.user_id == old.id))).all()
            self.assertEqual(sorted((a.branch, a.tier, a.status) for a in base),
                             [("level", 5, "baseline"), ("level", 10, "baseline"),
                              ("miner", 5, "baseline"), ("miner", 10, "baseline"), ("miner", 25, "baseline")])
            self.assertEqual(await svc.check(s, old, now=NOW), [])  # прошлые задания не считаются
            await self.approved(s, old, 10, when=NOW + timedelta(hours=1))
            new = await svc.check(s, old, now=NOW)
            self.assertEqual([(a.branch, a.tier, a.status) for a in new], [("tasks", 10, "paid")])
            view = await svc.player_view(s, old)
            lvl = next(b for b in view["branches"] if b["key"] == "level")
            self.assertTrue(lvl["tiers"][1]["done"])
            self.assertEqual(lvl["next"], {"at": 20, "left": 8})

    async def test_safe_check_swallows_errors(self):
        async with self.S() as s:
            u = await self.user(s)
            await self.approved(s, u, 10)
            with mock.patch.object(svc, "check", side_effect=RuntimeError("boom")), self.assertLogs(svc.log, "ERROR"):
                self.assertEqual(await svc.safe_check(s, u.id), [])
            self.assertEqual(len(await svc.safe_check(s, u.id)), 1)

    async def test_ambassador_badge_for_task_cards(self):
        async with self.S() as s:
            amb = await self.user(s, is_ambassador=True)
            for st, budget in (("active", "1"), ("completed", "1"), ("draft", "0"), ("cancelled", "1")):
                s.add(Task(creator_id=amb.id, title="t", description="d", reward=Decimal("0.1"), total_slots=10,
                           status=st, budget_locked=Decimal(budget)))
            await s.flush()
            self.assertEqual(await svc.tasks_placed(s, amb.id), 2)
            await svc.check(s, amb, now=NOW)
            b = await svc.badges_for(s, [amb.id, 999])
            self.assertEqual(b, {amb.id: {"branch": "ambassador", "tier": 1, "metal": "bronze", "index": 1, "of": 5}})
            await s.commit()
        # карточки заданий: значок автора в списке и в карточке
        from app.db.session import get_db
        from app.main import app

        async def _db():
            async with self.S() as s2:
                yield s2

        app.dependency_overrides[get_db] = _db
        self.addCleanup(app.dependency_overrides.clear)
        with mock.patch.object(settings, "debug", True):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
                h = {"X-Telegram-Init-Data": f"dev:{next(_TG)}"}
                items = (await c.get("/api/v1/tasks", headers=h)).json()
                self.assertTrue(items)
                self.assertTrue(all(i["creator_badge"]["tier"] == 1 for i in items))
                one = (await c.get(f"/api/v1/tasks/{items[0]['id']}", headers=h)).json()
                self.assertEqual(one["creator_badge"]["metal"], "bronze")


class WallTest(Base_):
    async def award(self, s, user, branch, tier, status="paid", when=NOW):
        s.add(AchievementAward(user_id=user.id, branch=branch, tier=tier, ton=Decimal("0"), xp=0, status=status, created_at=when))
        await s.flush()

    async def test_rarest_first_then_count(self):
        async with self.S() as s:
            a = await self.user(s, first_name="Ann")
            b = await self.user(s, username="bob")
            c = await self.user(s, first_name="Cid")
            d = await self.user(s)
            banned = await self.user(s, first_name="X", is_banned=True)
            for u in (a, b, c, d, banned):
                await self.award(s, u, "tasks", 10)
            await self.award(s, b, "tasks", 25)
            await self.award(s, c, "tasks", 25)
            await self.award(s, c, "games", 50)
            await self.award(s, a, "level", 300)  # одна у одного игрока — самая редкая
            await self.award(s, banned, "level", 300)  # забаненный не в счёт ни в редкости, ни на стене
            await self.award(s, d, "miner", 120, status="rejected")  # отклонённая не в счёт
            await self.award(s, d, "tasks", 50, status="pending")  # и ждущая подтверждения тоже
            await s.commit()
            out = await svc.wall(s, user_id=d.id)
        names = [(e["rank"], e["name"], e["count"], e["rarest"]["branch"], e["rarest"]["tier"], e["rarest"]["holders"]) for e in out["entries"]]
        self.assertEqual(names, [
            (1, "Ann", 2, "level", 300, 1),  # редкость равна — выше ступень старше в ветке (неон)
            (2, "Cid", 3, "games", 50, 1),
            (3, "bob", 2, "tasks", 25, 2),
            (4, None, 1, "tasks", 10, 4),
        ])
        self.assertEqual(out["entries"][0]["rarest"]["metal"], "neon")
        self.assertEqual(out["total_players"], 4)
        self.assertEqual(out["me"]["rank"], 4)
        self.assertTrue(out["entries"][3]["is_me"])

    async def test_limit_and_my_place_outside_top(self):
        async with self.S() as s:
            users = [await self.user(s, first_name=f"P{i}") for i in range(5)]
            for i, u in enumerate(users):
                await self.award(s, u, "tasks", 10, when=NOW + timedelta(minutes=i))
            await s.commit()
            out = await svc.wall(s, user_id=users[4].id, limit=2)
            none = await svc.wall(s, user_id=999999)
        self.assertEqual([e["name"] for e in out["entries"]], ["P0", "P1"])  # при равенстве — кто раньше
        self.assertEqual(out["me"]["rank"], 5)
        self.assertIsNone(none["me"])


class HookTest(Base_):
    async def test_accepting_tenth_submission_awards_tier(self):
        from app.services import tasks as tasks_svc

        async with self.S() as s:
            owner = await self.user(s, is_owner=True)
            u = await self.user(s)
            await self.approved(s, u, 9)
            task = Task(creator_id=owner.id, title="t", description="d", reward=Decimal("0.01"), total_slots=5,
                        status="active", budget_locked=Decimal("1"))
            s.add(task)
            await s.flush()
            sub = TaskSubmission(task_id=task.id, user_id=u.id, status="pending", proof_text="ok")
            s.add(sub)
            await s.flush()
            await tasks_svc.review_submission(s, actor=owner, submission_id=sub.id, approve=True)
            await s.commit()
            awards = (await s.scalars(select(AchievementAward).where(AchievementAward.user_id == u.id))).all()
            self.assertEqual([(a.branch, a.tier) for a in awards], [("tasks", 10)])
            self.assertEqual(Decimal((await s.get(User, u.id)).balance), Decimal("0.04"))  # 0.01 за задание + 0.03


class NotifyTest(Base_):
    async def test_one_message_per_player_in_their_language(self):
        async with self.S() as s:
            await self.setting(s, manual_from_ton="0.06")
            ru = await self.user(s, lang="ru")
            en = await self.user(s, language_code="en")
            await self.approved(s, ru, 25)
            await self.approved(s, en, 10)
            await svc.check(s, ru, now=NOW)
            await svc.check(s, en, now=NOW)
            await s.commit()
        sent = []

        async def send(chat, text):
            sent.append((chat, text))
            return True

        self.assertEqual(await svc.notify_once(self.S, send=send, now=NOW), 2)
        msgs = dict(sent)
        self.assertIn("Новые достижения", msgs[ru.telegram_id])
        self.assertIn("Задания: 10 — +0.03 TON на баланс, +10 XP", msgs[ru.telegram_id])
        self.assertIn("награда 0.06 TON ждёт подтверждения", msgs[ru.telegram_id])
        self.assertIn("Tasks: 10 — +0.03 TON to your balance", msgs[en.telegram_id])
        self.assertEqual(await svc.notify_once(self.S, send=send, now=NOW), 0)  # уже отправлено

    async def test_old_awards_are_not_sent(self):
        async with self.S() as s:
            u = await self.user(s)
            await self.approved(s, u, 10)
            await svc.check(s, u, now=NOW - timedelta(days=10))
            await s.commit()
        send = mock.AsyncMock(return_value=True)
        self.assertEqual(await svc.notify_once(self.S, send=send, now=NOW), 0)
        send.assert_not_called()


class ApiTest(Base_):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        from app.db.session import get_db
        from app.main import app

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

    async def test_player_flow_and_owner_guard(self):
        c = self.client
        async with self.S() as s:
            u = await self.user(s)
            await self.approved(s, u, 10)
            await s.commit()
        h = {"X-Telegram-Init-Data": f"dev:{u.telegram_id}"}
        r = await c.get("/api/v1/achievements/fresh", headers=h)
        items = r.json()["items"]
        self.assertEqual([(i["branch"], i["tier"], i["metal"]) for i in items], [("tasks", 10, "bronze")])
        r = await c.post("/api/v1/achievements/seen", json={"ids": [items[0]["id"]]}, headers=h)
        self.assertEqual(r.json(), {"seen": 1})
        self.assertEqual((await c.get("/api/v1/achievements/fresh", headers=h)).json()["items"], [])
        r = await c.get("/api/v1/achievements", headers=h)
        body = r.json()
        tasks = next(b for b in body["branches"] if b["key"] == "tasks")
        self.assertEqual((tasks["value"], tasks["next"]), (10, {"at": 25, "left": 15}))
        self.assertNotIn("ambassador", [b["key"] for b in body["branches"]])
        self.assertEqual(body["earned_ton"], "0.03")
        r = await c.put("/api/v1/achievements/pin", json={"branch": "tasks", "tier": 25}, headers=h)
        self.assertEqual(r.status_code, 404)
        r = await c.put("/api/v1/achievements/pin", json={"branch": "tasks", "tier": 10}, headers=h)
        self.assertEqual(r.json()["pin"]["metal"], "bronze")
        self.assertEqual((await c.get("/api/v1/achievements", headers=h)).json()["pin"]["tier"], 10)
        r = await c.put("/api/v1/achievements/pin", json={"branch": None}, headers=h)
        self.assertIsNone(r.json()["pin"])
        wall = (await c.get("/api/v1/achievements/wall", headers=h)).json()
        self.assertEqual((wall["total_players"], wall["me"]["rank"], wall["entries"][0]["is_me"]), (1, 1, True))
        self.assertEqual((await c.get("/api/v1/achievements/owner", headers=h)).status_code, 403)
        self.assertEqual((await c.post("/api/v1/achievements/owner/1/approve", headers=h)).status_code, 403)

    async def test_owner_settings_roundtrip_and_approve(self):
        c = self.client
        async with self.S() as s:
            owner = await self.user(s, is_owner=True)
            u = await self.user(s)
            await self.approved(s, u, 25)
            await s.commit()
        ho = {"X-Telegram-Init-Data": f"dev:{owner.telegram_id}"}
        r = await c.get("/api/v1/economy/settings/achievements", headers=ho)
        v = r.json()["value"]
        v["manual_from_ton"] = "0.05"
        r = await c.put("/api/v1/economy/settings/achievements", json={"value": v}, headers=ho)
        self.assertEqual(r.status_code, 200, r.text)
        bad = {**v, "manual_from_ton": "abc"}
        r = await c.put("/api/v1/economy/settings/achievements", json={"value": bad}, headers=ho)
        self.assertEqual(r.status_code, 400)
        await c.get("/api/v1/achievements/fresh", headers={"X-Telegram-Init-Data": f"dev:{u.telegram_id}"})
        summ = (await c.get("/api/v1/achievements/owner", headers=ho)).json()
        self.assertEqual(summ["counts"]["pending"], 1)
        aid = summ["pending"][0]["id"]
        self.assertEqual((await c.post(f"/api/v1/achievements/owner/{aid}/approve", headers=ho)).json()["status"], "paid")
        self.assertEqual((await c.post(f"/api/v1/achievements/owner/{aid}/reject", headers=ho)).status_code, 409)
        self.assertEqual((await c.get("/api/v1/achievements/owner", headers=ho)).json()["paid_ton"], "0.09")


class MigrationTest(unittest.TestCase):
    def test_029(self):
        import importlib.util
        import pathlib

        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "029_achievements.py"
        spec = importlib.util.spec_from_file_location("m029", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual((mod.revision, mod.down_revision), ("029", "028"))
        eng = sa.create_engine("sqlite://")
        with eng.begin() as conn:
            Base.metadata.create_all(conn)
            conn.execute(sa.text("DROP TABLE achievement_awards"))
            conn.execute(sa.text("ALTER TABLE users DROP COLUMN ach_pin"))

        def apply(fn):
            with eng.begin() as conn:
                with mock.patch.object(mod, "op", Operations(MigrationContext.configure(conn))):
                    fn()

        apply(mod.upgrade)
        apply(mod.upgrade)
        insp = sa.inspect(eng)
        self.assertIn("achievement_awards", insp.get_table_names())
        self.assertIn("ach_pin", [c["name"] for c in insp.get_columns("users")])
        apply(mod.downgrade)
        insp = sa.inspect(eng)
        self.assertNotIn("achievement_awards", insp.get_table_names())
        self.assertNotIn("ach_pin", [c["name"] for c in insp.get_columns("users")])
