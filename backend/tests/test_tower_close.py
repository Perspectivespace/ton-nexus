"""«Башня», PR 3б: закрытие месяца, замороженные итоги, выплата призов.

SQLite в памяти — всегда; параллельные закрытие и выплата — на Postgres, если задан TEST_PG_URL
(локальная пустая тестовая база: таблицы пересоздаются).
Запуск из backend: python -m unittest discover -s tests
"""

import asyncio
import os
import random
import unittest
import warnings
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import BalanceHistory, TowerGame, TowerMonth, TowerMonthlyBest, TowerMonthResult, User  # noqa: F401
from app.services import tower as tw
from app.services import tower_close as tc
from app.services import tower_prizes as tp

from tests.test_tower import play_taps, run_db

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

UTC = timezone.utc
OCT = date(2026, 10, 1)
# 27 окт 12:00 МСК — забеги; 2 ноя 12:00 МСК — октябрь уже закончился
PLAY = datetime(2026, 10, 27, 9, 0, tzinfo=UTC)
NOV = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
ON = {**tp.DEFAULT, "enabled": True, "budget_ton": "10"}
PLAN = (0, 0, 0, 60, 0)
PG_URL = os.environ.get("TEST_PG_URL")


async def set_prizes(s, value):
    from app.services.economy_admin import set_setting

    await set_setting(s, key=tp.KEY, value=value)
    await s.flush()


async def seed_month(s, n, *, games=5, booster_at=None, month=OCT, at=PLAY):
    """n игроков с лучшим счётом в месяце; у первых `games` — настоящий проверяемый забег."""
    users = []
    for i in range(n):
        u = User(telegram_id=5000 + i, first_name=f"P{i + 1}")
        s.add(u)
        await s.flush()
        users.append(u)
        t = at + timedelta(minutes=i)
        gid, score = None, max(1, 10 - i)
        if i < games:
            booster = "slow" if booster_at == i else None
            taps, res = play_taps(1000 + i, booster, PLAN)
            g = TowerGame(user_id=u.id, seed=1000 + i, booster=booster, game_day=t.date(), started_at=t,
                          finished_at=t + timedelta(milliseconds=taps[-1] + 500), status="finished",
                          score=res.score, height=res.height, taps=taps)
            s.add(g)
            await s.flush()
            gid, score = g.id, res.score
        s.add(TowerMonthlyBest(user_id=u.id, month=month, best_score=score, best_game_id=gid, achieved_at=t))
    await s.flush()
    return users


async def prize_rows(s, tm):
    return (await s.scalars(select(TowerMonthResult).where(TowerMonthResult.tower_month_id == tm.id,
                                                          TowerMonthResult.status != "none")
                            .order_by(TowerMonthResult.place))).all()


async def credits(s, user_id=None):
    q = select(func.count()).select_from(BalanceHistory).where(BalanceHistory.balance_type == "tower_prize")
    if user_id is not None:
        q = q.where(BalanceHistory.user_id == user_id)
    return await s.scalar(q)


class CloseTest(unittest.TestCase):
    def setUp(self):
        tc.reset_cache()

    def test_close_is_idempotent_and_frozen(self):
        async def body(s):
            await set_prizes(s, ON)
            users = await seed_month(s, 12)
            tm, fresh = await tc.close_month(s, OCT, now=NOV)
            self.assertTrue(fresh)
            self.assertEqual((tm.status, tm.reason, tm.total_players, tm.participants, tm.places), ("payout", None, 12, 12, 3))
            rows = await prize_rows(s, tm)
            self.assertEqual([r.place for r in rows], [1, 2, 3])
            self.assertEqual([r.user_id for r in rows], [u.id for u in users[:3]])
            self.assertTrue(all(r.status == "pending" for r in rows), [(r.status, r.note) for r in rows])
            self.assertEqual(sum(Decimal(r.amount) for r in rows), Decimal(tm.planned_ton))
            self.assertLessEqual(Decimal(tm.planned_ton), Decimal(tm.budget_ton))
            self.assertEqual(tm.prize_cfg["settings"]["budget_ton"], "10")
            # повтор — та же строка, итоги не дублируются; смена настроек прошлый месяц не трогает
            await set_prizes(s, {**ON, "budget_ton": "50"})
            tm2, fresh2 = await tc.close_month(s, OCT, now=NOV)
            self.assertFalse(fresh2)
            self.assertEqual(tm2.id, tm.id)
            self.assertEqual(Decimal(tm2.budget_ton), Decimal("10"))
            n = await s.scalar(select(func.count()).select_from(TowerMonthResult))
            self.assertEqual(n, 12)
            self.assertEqual(await tc.ensure_closed(s, NOV), [])
            self.assertEqual(await s.scalar(select(func.count()).select_from(TowerMonth)), 1)

        run_db(body)

    def test_lazy_close_on_first_request_after_month_end(self):
        async def body(s):
            await set_prizes(s, ON)
            await seed_month(s, 12)
            self.assertEqual(await tc.ensure_closed(s, PLAY), [])  # октябрь ещё идёт
            self.assertEqual(await s.scalar(select(func.count()).select_from(TowerMonth)), 0)
            with self.assertRaises(tw.TowerError) as cm:
                await tc.close_month(s, OCT, now=PLAY)
            self.assertEqual(cm.exception.code, "month_open")
            tc.reset_cache()
            self.assertEqual(await tc.ensure_closed(s, NOV), [OCT])
            self.assertEqual(await tc.ensure_closed(s, NOV), [])

        run_db(body)

    def test_fewer_than_min_participants_no_prizes(self):
        async def body(s):
            await set_prizes(s, ON)
            await seed_month(s, 9)
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            self.assertEqual((tm.status, tm.reason, tm.places), ("no_prizes", "few_participants", 0))
            self.assertEqual(Decimal(tm.planned_ton), 0)
            self.assertEqual(len(await prize_rows(s, tm)), 0)
            # итоги сохранены, но без призов
            self.assertEqual(await s.scalar(select(func.count()).select_from(TowerMonthResult)), 9)
            lb = await tw.leaderboard(s, user_id=1, month=OCT, now=NOV)
            self.assertTrue(lb["closed"])
            self.assertIsNone(lb["prizes"])
            self.assertEqual(lb["close_reason"], "few_participants")
            self.assertTrue(all("prize_status" not in e for e in lb["entries"]))

        run_db(body)

    def test_disabled_no_prizes(self):
        async def body(s):
            await set_prizes(s, {**ON, "enabled": False})
            await seed_month(s, 12)
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            self.assertEqual((tm.status, tm.reason), ("no_prizes", "disabled"))
            self.assertEqual(Decimal(tm.budget_ton), 0)

        run_db(body)

    def test_booster_game_counts_and_is_verified(self):
        async def body(s):
            await set_prizes(s, ON)
            users = await seed_month(s, 12, booster_at=0)
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            rows = await prize_rows(s, tm)
            self.assertEqual(rows[0].user_id, users[0].id)
            self.assertEqual(rows[0].status, "pending")
            g = await s.get(TowerGame, rows[0].game_id)
            self.assertEqual(g.booster, "slow")

        run_db(body)

    def test_failed_replay_is_flagged_and_not_payable(self):
        async def body(s):
            await set_prizes(s, ON)
            users = await seed_month(s, 12)
            owner = users[-1]
            # подменённый журнал у 2-го места: проигрывание не даст записанный счёт
            best = await s.scalar(select(TowerMonthlyBest).where(TowerMonthlyBest.user_id == users[1].id))
            g = await s.get(TowerGame, best.best_game_id)
            g.taps = list(g.taps[:2])
            # у 3-го места забег пропал
            b3 = await s.scalar(select(TowerMonthlyBest).where(TowerMonthlyBest.user_id == users[2].id))
            b3.best_game_id = None
            await s.flush()
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            r1, r2, r3 = await prize_rows(s, tm)
            self.assertEqual((r1.status, r2.status, r3.status), ("pending", "flagged", "flagged"))
            self.assertEqual((r2.note, r3.note), ("replay_mismatch", "no_game"))
            with self.assertRaises(tw.TowerError) as cm:
                await tc.pay_result(s, result_id=r2.id, by=owner.id, now=NOV)
            self.assertEqual(cm.exception.code, "flagged")
            done = await tc.pay_all(s, month_id=tm.id, by=owner.id, now=NOV)
            self.assertEqual(done, {"paid": 1, "voided": 0, "already": 0})
            self.assertEqual(await credits(s), 1)
            self.assertEqual(tm.status, "payout")  # ещё два на проверке
            # владелец проверил: 2-е одобрил (→ можно платить), 3-е аннулировал
            await tc.approve_result(s, result_id=r2.id, by=owner.id, now=NOV)
            await tc.void_result(s, result_id=r3.id, by=owner.id, now=NOV)
            self.assertEqual(await tc.pay_result(s, result_id=r2.id, by=owner.id, now=NOV), "paid")
            self.assertEqual(tm.status, "settled")
            # аннулированный не переходит дальше и не тратится
            self.assertEqual(Decimal(tm.paid_ton), Decimal(r1.amount) + Decimal(r2.amount))
            self.assertLess(Decimal(tm.paid_ton), Decimal(tm.planned_ton))
            with self.assertRaises(tw.TowerError):
                await tc.void_result(s, result_id=r1.id, by=owner.id, now=NOV)  # выплаченный не аннулируется

        run_db(body)

    def test_payout_exactly_once(self):
        async def body(s):
            await set_prizes(s, ON)
            users = await seed_month(s, 12)
            owner = users[-1]
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            r1 = (await prize_rows(s, tm))[0]
            bal0 = Decimal(users[0].balance or 0)
            self.assertEqual(await tc.pay_result(s, result_id=r1.id, by=owner.id, now=NOV), "paid")
            self.assertEqual(await tc.pay_result(s, result_id=r1.id, by=owner.id, now=NOV), "already")
            done = await tc.pay_all(s, month_id=tm.id, by=owner.id, now=NOV)
            self.assertEqual(done["paid"], 2)
            self.assertEqual((await tc.pay_all(s, month_id=tm.id, by=owner.id, now=NOV))["paid"], 0)
            self.assertEqual(await credits(s, users[0].id), 1)
            self.assertEqual(await credits(s), 3)
            u = await s.scalar(select(User).where(User.id == users[0].id).execution_options(populate_existing=True))
            self.assertEqual(Decimal(u.balance) - bal0, Decimal(r1.amount))
            h = await s.get(BalanceHistory, r1.balance_history_id)
            self.assertEqual((h.reference_type, h.reference_id, h.balance_type), ("tower_month_result", r1.id, "tower_prize"))
            self.assertEqual((r1.status, r1.paid_by), ("paid", owner.id))
            self.assertEqual(tm.status, "settled")
            self.assertEqual(Decimal(tm.paid_ton), Decimal(tm.planned_ton))

        run_db(body)

    def test_budget_never_exceeded(self):
        async def body(s):
            await set_prizes(s, ON)
            users = await seed_month(s, 12)
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            rows = await prize_rows(s, tm)
            # бюджет «урезан» (порча данных): выплата, которая вышла бы за него, отказывает
            tm.budget_ton = Decimal(rows[0].amount) + Decimal(rows[1].amount) - Decimal("0.0001")
            await s.flush()
            self.assertEqual(await tc.pay_result(s, result_id=rows[0].id, by=users[-1].id, now=NOV), "paid")
            with self.assertRaises(tw.TowerError) as cm:
                await tc.pay_result(s, result_id=rows[1].id, by=users[-1].id, now=NOV)
            self.assertEqual(cm.exception.code, "over_budget")
            self.assertLessEqual(Decimal(tm.paid_ton), Decimal(tm.budget_ton))

        run_db(body)

    def test_plan_total_never_exceeds_budget(self):
        rnd = random.Random(7)
        for _ in range(300):
            cfg = tp.normalize({**ON, "budget_ton": str(Decimal(rnd.randint(30, 500000)) / 100),
                                "min_prize_ton": "0.0001", "places_percent": rnd.randint(0, 100),
                                "extra_place_every": rnd.randint(0, 50)})
            p = tp.plan(cfg, rnd.randint(10, 5000))
            total = sum(Decimal(g["ton"]) * (g["to_place"] - g["from_place"] + 1) for g in p["prizes"])
            self.assertLessEqual(total, Decimal(cfg["budget_ton"]))

    def test_ban_voids_prize_places_do_not_shift(self):
        async def body(s):
            await set_prizes(s, ON)
            users = await seed_month(s, 12)
            owner = users[-1]
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            r1, r2, r3 = await prize_rows(s, tm)
            users[0].is_banned = True
            await s.flush()
            self.assertEqual(await tc.pay_result(s, result_id=r1.id, by=owner.id, now=NOV), "voided")
            self.assertEqual((r1.status, r1.note), ("voided", "banned"))
            users[1].is_banned = True
            await s.flush()
            done = await tc.pay_all(s, month_id=tm.id, by=owner.id, now=NOV)
            self.assertEqual(done, {"paid": 1, "voided": 1, "already": 0})
            self.assertEqual(await credits(s), 1)
            self.assertEqual(await credits(s, users[2].id), 1)
            # места на месте: 3-е место получило приз 3-го места, а не 1-го
            self.assertEqual((r3.place, Decimal(tm.paid_ton)), (3, Decimal(r3.amount)))
            lb = await tw.leaderboard(s, user_id=users[2].id, month=OCT, now=NOV)
            self.assertEqual([e["rank"] for e in lb["entries"][:3]], [1, 2, 3])
            self.assertEqual([e.get("prize_status") for e in lb["entries"][:4]], ["voided", "voided", "paid", None])
            self.assertEqual((lb["me"]["rank"], lb["me"]["prize_status"]), (3, "paid"))

        run_db(body)

    def test_ban_sweep_before_payout(self):
        async def body(s):
            await set_prizes(s, ON)
            users = await seed_month(s, 12)
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            users[2].is_banned = True
            await s.flush()
            self.assertEqual(await tc.void_banned(s, NOV), 1)
            r3 = (await prize_rows(s, tm))[2]
            self.assertEqual((r3.status, r3.note), ("voided", "banned"))

        run_db(body)

    def test_closed_board_shows_status_and_server_time(self):
        async def body(s):
            await set_prizes(s, ON)
            users = await seed_month(s, 12)
            tm, _ = await tc.close_month(s, OCT, now=NOV)
            r1 = (await prize_rows(s, tm))[0]
            await tc.pay_result(s, result_id=r1.id, by=users[-1].id, now=NOV)
            lb = await tw.leaderboard(s, user_id=users[5].id, month=OCT, now=NOV)
            self.assertTrue(lb["closed"])
            self.assertEqual(lb["server_time"], NOV.isoformat())
            self.assertEqual([e.get("prize_status") for e in lb["entries"][:4]], ["paid", "awaiting", "awaiting", None])
            self.assertEqual(lb["entries"][0]["prize_ton"], r1.amount and tp.ton_str(Decimal(r1.amount)))
            self.assertEqual(lb["me"], {"rank": 6, "score": lb["entries"][5]["score"]})
            self.assertEqual(lb["prize_places"], 3)
            self.assertEqual(len(lb["prizes"]), 3)
            # текущий месяц — живой топ с часами сервера
            cur = await tw.leaderboard(s, user_id=users[5].id, now=NOV)
            self.assertFalse(cur.get("closed", False))
            self.assertEqual(cur["server_time"], NOV.isoformat())

        run_db(body)


class AdminApiTest(unittest.TestCase):
    def test_owner_only_and_flow(self):
        from app.api.deps import get_current_user
        from app.core.config import settings
        from app.db.session import get_db
        from app.main import app

        async def main():
            tc.reset_cache()
            engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
            async with maker() as s:
                await set_prizes(s, ON)
                # реальные часы: берём заведомо прошедший сентябрь
                users = await seed_month(s, 12, month=date(2026, 9, 1), at=datetime(2026, 9, 20, 9, 0, tzinfo=UTC))
                await s.commit()
                ids = [u.id for u in users]
            who = {"id": ids[0]}

            async def db_dep():
                async with maker() as session:
                    yield session

            async def user_dep():
                async with maker() as session:
                    return await session.get(User, who["id"])

            old_owner = settings.telegram_owner_ids
            settings.telegram_owner_ids = "5011"  # users[11]
            app.dependency_overrides[get_db] = db_dep
            app.dependency_overrides[get_current_user] = user_dep
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
                    self.assertEqual((await c.get("/api/v1/tower/admin/prizes")).status_code, 403)
                    self.assertEqual((await c.post("/api/v1/tower/admin/prizes/close", json={})).status_code, 403)
                    who["id"] = ids[11]
                    r = await c.get("/api/v1/tower/admin/prizes")
                    self.assertEqual(r.status_code, 200, r.text)
                    self.assertEqual(r.json()["unclosed"], ["2026-09"])  # просмотр сам не закрывает
                    r = await c.post("/api/v1/tower/admin/prizes/close", json={"month": "2026-09"})
                    self.assertEqual(r.status_code, 200, r.text)
                    d = r.json()
                    self.assertEqual((d["done"], d["unclosed"]), ({"closed": 1}, []))
                    m = d["months"][0]
                    self.assertEqual((m["month"], m["status"], m["places"], m["closed_auto"]), ("2026-09", "payout", 3, False))
                    self.assertEqual(m["counts"]["pending"], 3)
                    r = await c.post("/api/v1/tower/admin/prizes/close", json={"month": "2026-09"})
                    self.assertEqual(r.json()["done"], {"closed": 0})
                    cur = tw.month_of().strftime("%Y-%m")
                    r = await c.post("/api/v1/tower/admin/prizes/close", json={"month": cur})
                    self.assertEqual(r.status_code, 409)
                    rid = m["results"][0]["id"]
                    r = await c.post(f"/api/v1/tower/admin/prizes/results/{rid}/pay")
                    self.assertEqual(r.json()["months"][0]["results"][0]["status"], "paid")
                    r = await c.post(f"/api/v1/tower/admin/prizes/results/{rid}/pay")
                    self.assertEqual(r.status_code, 200)
                    r = await c.post(f"/api/v1/tower/admin/prizes/months/{m['id']}/pay-all")
                    d = r.json()
                    self.assertEqual(d["done"], {"paid": 2, "voided": 0, "already": 0})
                    self.assertEqual((d["months"][0]["status"], d["months"][0]["paid_ton"]), ("settled", m["planned_ton"]))
                    r = await c.post(f"/api/v1/tower/admin/prizes/results/{rid}/void")
                    self.assertEqual(r.status_code, 409)
                    self.assertEqual((await c.post("/api/v1/tower/admin/prizes/results/999/pay")).status_code, 404)
                    # игроку прошлый месяц — из итогов, со статусами
                    who["id"] = ids[0]
                    r = await c.get("/api/v1/tower/leaderboard", params={"month": "2026-09"})
                    lb = r.json()
                    self.assertTrue(lb["closed"])
                    self.assertEqual(lb["entries"][0]["prize_status"], "paid")
                    self.assertIn("server_time", (await c.get("/api/v1/tower/me")).json())
                async with maker() as s:
                    self.assertEqual(await credits(s), 3)
            finally:
                settings.telegram_owner_ids = old_owner
                app.dependency_overrides.clear()
                await engine.dispose()

        asyncio.run(main())


@unittest.skipUnless(PG_URL, "нужен TEST_PG_URL (локальная пустая тестовая база Postgres: таблицы пересоздаются)")
class PostgresCloseTest(unittest.TestCase):
    def _run(self, fn):
        async def main():
            engine = create_async_engine(PG_URL)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
            maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
            try:
                await fn(maker)
            finally:
                await engine.dispose()

        tc.reset_cache()
        asyncio.run(main())

    def test_parallel_close_gives_one_result_set(self):
        async def body(maker):
            async with maker() as s:
                await set_prizes(s, ON)
                await seed_month(s, 12)
                await s.commit()

            async def one():
                async with maker() as s:
                    _, fresh = await tc.close_month(s, OCT, now=NOV)
                    await s.commit()
                    return fresh

            got = await asyncio.gather(*[one() for _ in range(8)])
            self.assertEqual(sum(got), 1)
            async with maker() as s:
                self.assertEqual(await s.scalar(select(func.count()).select_from(TowerMonth)), 1)
                self.assertEqual(await s.scalar(select(func.count()).select_from(TowerMonthResult)), 12)

        self._run(body)

    def test_parallel_payout_credits_once(self):
        async def body(maker):
            async with maker() as s:
                await set_prizes(s, ON)
                users = await seed_month(s, 12)
                tm, _ = await tc.close_month(s, OCT, now=NOV)
                await s.commit()
                rows = await prize_rows(s, tm)
                rid, tid, owner = rows[0].id, tm.id, users[-1].id
                planned = Decimal(tm.planned_ton)

            async def pay_one():
                async with maker() as s:
                    out = await tc.pay_result(s, result_id=rid, by=owner, now=NOV)
                    await s.commit()
                    return out

            async def pay_all():
                async with maker() as s:
                    out = await tc.pay_all(s, month_id=tid, by=owner, now=NOV)
                    await s.commit()
                    return out

            await asyncio.gather(*[pay_one() for _ in range(6)], *[pay_all() for _ in range(4)])
            async with maker() as s:
                self.assertEqual(await credits(s), 3)
                tm = await s.get(TowerMonth, tid)
                self.assertEqual(Decimal(tm.paid_ton), planned)
                self.assertLessEqual(Decimal(tm.paid_ton), Decimal(tm.budget_ton))
                total = await s.scalar(select(func.sum(BalanceHistory.amount)).where(BalanceHistory.balance_type == "tower_prize"))
                self.assertEqual(Decimal(total), planned)

        self._run(body)
