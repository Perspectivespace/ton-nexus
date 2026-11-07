"""Visit-задания: тариф → снимок reward/xp/commission_bp, publish charge, quote."""

from __future__ import annotations

import asyncio
import unittest
import warnings
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import BalanceHistory, Task, User  # noqa: F401
from app.services import task_tariff as tt
from app.services import tasks as t_svc
from app.services.economy_admin import set_setting
from app.services.economy_seed import seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
D = Decimal


async def _env():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _user(s, tg, *, balance="10", ambassador=False, admin=False):
    u = User(telegram_id=tg, balance=D(balance), is_ambassador=ambassador, is_admin=admin)
    s.add(u)
    await s.flush()
    return u


class VisitCreate(unittest.TestCase):
    def test_regular_user_creates_visit_from_tariff_ignoring_client_price(self):
        async def run():
            engine, Session = await _env()
            async with Session() as s:
                await seed_economy(s)
                user = await _user(s, 101, balance="5")  # не амбассадор
                view = await t_svc.create_task(
                    s,
                    creator=user,
                    title="Зайди на сайт",
                    description="Открой ссылку и пришли скрин",
                    reward=D("9.99"),  # клиент врёт — игнор
                    total_slots=100,
                    task_type="visit",
                    target_url="https://example.com/x",
                    xp_reward=999,
                )
                self.assertEqual(view.task_type, "visit")
                self.assertEqual(view.reward, D("0.01"))
                self.assertEqual(view.xp_reward, 5)
                self.assertEqual(view.status, "pending_approval")
                task = await s.get(Task, view.id)
                self.assertEqual(task.commission_bp, 1000)
                self.assertEqual(task.target_url, "https://example.com/x")
            await engine.dispose()

        asyncio.run(run())

    def test_requires_url_and_slot_limits(self):
        async def run():
            engine, Session = await _env()
            async with Session() as s:
                await seed_economy(s)
                user = await _user(s, 102, ambassador=True)
                with self.assertRaisesRegex(t_svc.TaskError, "ссылка"):
                    await t_svc.create_task(
                        s, creator=user, title="abc", description="def ghi",
                        reward=None, total_slots=10, task_type="visit", target_url=None,
                    )
                with self.assertRaisesRegex(t_svc.TaskError, "число выполнений"):
                    await t_svc.create_task(
                        s, creator=user, title="abc", description="def ghi",
                        reward=None, total_slots=0, task_type="visit",
                        target_url="https://t.me/channel",
                    )
            await engine.dispose()

        asyncio.run(run())

    def test_tme_url_normalized(self):
        async def run():
            engine, Session = await _env()
            async with Session() as s:
                await seed_economy(s)
                u = await _user(s, 103, ambassador=True)
                v = await t_svc.create_task(
                    s, creator=u, title="abc", description="def ghi",
                    reward=None, total_slots=1, task_type="visit", target_url="t.me/foo",
                )
                self.assertTrue(v.target_url.startswith("https://t.me/"))
            await engine.dispose()

        asyncio.run(run())


class VisitPublish(unittest.TestCase):
    def test_charge_uses_snapshotted_commission_not_platform_key(self):
        async def run():
            engine, Session = await _env()
            async with Session() as s:
                await seed_economy(s)
                # платформенный ключ другой — не должен влиять на visit
                await set_setting(s, key="task_platform_commission_bp", value={"bp": 5000})
                admin = await _user(s, 201, balance="10", admin=True)
                v = await t_svc.create_task(
                    s, creator=admin, title="abc", description="def ghi",
                    reward=None, total_slots=100, task_type="visit",
                    target_url="https://example.com", publish=True,
                )
                self.assertEqual(v.status, "active")
                task = await s.get(Task, v.id)
                # 0.01×100=1 + 10%=0.1 → 1.1; не 50%
                self.assertEqual(D(task.budget_locked), D("1.1"))
                q = tt.quote_visit(tt.DEFAULT, slots=100)
                self.assertEqual(D(task.budget_locked), D(q.total))
                self.assertEqual(D(task.reward) * task.total_slots + D(q.commission), D(task.budget_locked))
                # баланс: 10 − 1.1
                await s.refresh(admin)
                self.assertEqual(D(admin.balance), D("8.9"))
            await engine.dispose()

        asyncio.run(run())

    def test_tariff_change_after_create_does_not_change_snapshot(self):
        async def run():
            engine, Session = await _env()
            async with Session() as s:
                await seed_economy(s)
                admin = await _user(s, 202, balance="20", admin=True)
                v = await t_svc.create_task(
                    s, creator=admin, title="abc", description="def ghi",
                    reward=None, total_slots=10, task_type="visit",
                    target_url="https://example.com",
                )
                # меняем тариф: дороже и другая комиссия
                new_tariff = {
                    "visit": {
                        "reward": "0.05",
                        "commission_bp": 2000,
                        "xp": 50,
                        "min_slots": 1,
                        "max_slots": 10000,
                    },
                    "campaign": tt.DEFAULT["campaign"],
                    "partner": tt.DEFAULT["partner"],
                }
                await set_setting(s, key="task_tariff", value=new_tariff)
                pub = await t_svc.publish_task(s, task_id=v.id, actor=admin)
                task = await s.get(Task, pub.id)
                # снимок: 0.01 × 10 + 10% = 0.11
                self.assertEqual(D(task.reward), D("0.01"))
                self.assertEqual(task.xp_reward, 5)
                self.assertEqual(task.commission_bp, 1000)
                self.assertEqual(D(task.budget_locked), D("0.11"))
            await engine.dispose()

        asyncio.run(run())

    def test_legacy_manual_still_uses_platform_commission(self):
        async def run():
            engine, Session = await _env()
            async with Session() as s:
                await seed_economy(s)
                await set_setting(s, key="task_platform_commission_bp", value={"bp": 1000})
                admin = await _user(s, 203, balance="10", admin=True)
                v = await t_svc.create_task(
                    s, creator=admin, title="abc", description="def ghi",
                    reward=D("0.1"), total_slots=2, task_type="manual_proof", publish=True,
                )
                task = await s.get(Task, v.id)
                self.assertIsNone(task.commission_bp)
                # 0.2 + 10% = 0.22
                self.assertEqual(D(task.budget_locked), D("0.22"))
            await engine.dispose()

        asyncio.run(run())


class QuoteMath(unittest.TestCase):
    def test_quote_matches_service(self):
        q = tt.quote_visit(tt.DEFAULT, slots=100)
        self.assertEqual(q.payout_nano + q.commission_nano, q.total_nano)
        self.assertEqual(q.total, "1.1")


if __name__ == "__main__":
    unittest.main()
