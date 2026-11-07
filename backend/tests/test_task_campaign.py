"""Кампания: только владелец, ручная награда, снимок комиссии/XP из тарифа, override, publish."""

from __future__ import annotations

import asyncio
import unittest
import warnings
from decimal import Decimal
from unittest import mock

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import tasks as tasks_api
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


async def _user(s, tg, *, balance="10", ambassador=False, admin=False, owner=False):
    u = User(telegram_id=tg, balance=D(balance), is_ambassador=ambassador, is_admin=admin, is_owner=owner)
    s.add(u)
    await s.flush()
    return u


def _run(coro_fn):
    async def wrap():
        engine, Session = await _env()
        try:
            async with Session() as s:
                await seed_economy(s)
                await coro_fn(s)
        finally:
            await engine.dispose()

    asyncio.run(wrap())


def _create(s, user, **kw):
    args = dict(
        creator=user, title="Кампания X", description="Условия по договорённости",
        reward=D("0.25"), total_slots=40, task_type="campaign",
    )
    args.update(kw)
    return t_svc.create_task(s, **args)


class CampaignPermissions(unittest.TestCase):
    def test_only_owner_creates(self):
        async def body(s):
            for i, flags in enumerate(({"admin": True}, {"ambassador": True}, {})):
                u = await _user(s, 300 + i, **flags)
                with self.assertRaises(t_svc.TaskPermissionError):
                    await _create(s, u)
            owner = await _user(s, 310, owner=True)
            v = await _create(s, owner)
            self.assertEqual(v.task_type, "campaign")
            self.assertEqual(v.status, "draft")

        _run(body)

    def test_api_maps_to_403(self):
        async def body(s):
            admin = await _user(s, 320, admin=True)
            req = tasks_api.TaskCreateBody(
                title="Кампания", description="Условия", reward=D("0.1"),
                total_slots=5, task_type="campaign",
            )
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.create_task(req, user=admin, db=s)
            self.assertEqual(cm.exception.status_code, 403)
            q = tasks_api.QuoteBody(task_type="campaign", total_slots=5, reward=D("0.1"))
            with self.assertRaises(HTTPException) as cm2:
                await tasks_api.quote_task(q, user=admin, db=s)
            self.assertEqual(cm2.exception.status_code, 403)

        _run(body)

    def test_admin_cannot_edit_campaign_or_switch_type(self):
        async def body(s):
            owner = await _user(s, 330, owner=True)
            admin = await _user(s, 331, admin=True)
            v = await _create(s, owner)
            with self.assertRaises(t_svc.TaskPermissionError):
                await t_svc.update_task(s, task_id=v.id, actor=admin, reward=D("1"))
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.update_task(s, task_id=v.id, actor=owner, task_type="manual_proof")
            m = await t_svc.create_task(
                s, creator=admin, title="abc", description="def ghi",
                reward=D("0.1"), total_slots=2, task_type="manual_proof",
            )
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.update_task(s, task_id=m.id, actor=admin, task_type="campaign")

        _run(body)


class CampaignCreate(unittest.TestCase):
    def test_manual_price_and_tariff_defaults_snapshot(self):
        async def body(s):
            owner = await _user(s, 400, owner=True)
            v = await _create(s, owner, target_url="t.me/botmaker")
            task = await s.get(Task, v.id)
            self.assertEqual(D(task.reward), D("0.25"))
            self.assertEqual(task.commission_bp, tt.DEFAULT["campaign"]["commission_bp"])
            self.assertEqual(task.xp_reward, tt.DEFAULT["campaign"]["xp"])
            self.assertEqual(task.target_url, "https://t.me/botmaker")
            # смена тарифа после создания не трогает снимок
            new = {**tt.DEFAULT, "campaign": {"commission_bp": 3000, "xp": 77}}
            await set_setting(s, key="task_tariff", value=new)
            task = await s.get(Task, v.id)
            self.assertEqual(task.commission_bp, 1000)
            # а новое задание берёт новый тариф
            v2 = await _create(s, owner)
            t2 = await s.get(Task, v2.id)
            self.assertEqual((t2.commission_bp, t2.xp_reward), (3000, 77))

        _run(body)

    def test_url_optional_and_override(self):
        async def body(s):
            owner = await _user(s, 401, owner=True)
            v = await _create(s, owner, commission_bp=0, xp_reward=42)
            task = await s.get(Task, v.id)
            self.assertIsNone(task.target_url)
            self.assertEqual((task.commission_bp, task.xp_reward), (0, 42))

        _run(body)

    def test_validation(self):
        async def body(s):
            owner = await _user(s, 402, owner=True)
            bad = [
                dict(reward=None),
                dict(reward=D("0")),
                dict(reward=D("-1")),
                dict(reward=D("0.000000001")),  # 9 знаков
                dict(reward=D("100.00000001")),  # > потолка
                dict(commission_bp=10001),
                dict(commission_bp=-1),
                dict(total_slots=0),
                dict(total_slots=10001),
                dict(target_url="ftp://x"),
            ]
            for kw in bad:
                with self.subTest(kw=kw), self.assertRaises(t_svc.TaskError):
                    await _create(s, owner, **kw)
            v = await _create(s, owner, reward=D("0.12345678"))
            self.assertEqual(v.reward, D("0.12345678"))

        _run(body)


class CampaignPublish(unittest.TestCase):
    def test_publish_math_to_nanoton(self):
        async def body(s):
            await set_setting(s, key="task_platform_commission_bp", value={"bp": 5000})
            owner = await _user(s, 500, balance="100", owner=True)
            v = await _create(s, owner, reward=D("0.12345678"), total_slots=7, commission_bp=1234, publish=True)
            self.assertEqual(v.status, "active")
            task = await s.get(Task, v.id)
            q = tt.quote_campaign(tt.DEFAULT, reward="0.12345678", slots=7, commission_bp=1234)
            self.assertEqual(q.payout_nano + q.commission_nano, q.total_nano)
            self.assertEqual(D(task.budget_locked), D(q.total))
            self.assertEqual(D(task.reward) * 7 + D(q.commission), D(task.budget_locked))
            await s.refresh(owner)
            self.assertEqual(D(owner.balance), D("100") - D(q.total))

        _run(body)

    def test_quote_endpoint_for_owner(self):
        async def body(s):
            owner = await _user(s, 501, owner=True)
            out = await tasks_api.quote_task(
                tasks_api.QuoteBody(task_type="campaign", total_slots=100, reward=D("0.05")),
                user=owner, db=s,
            )
            self.assertEqual(out.task_type, "campaign")
            self.assertEqual((out.payout, out.commission, out.total), (D("5"), D("0.5"), D("5.5")))
            self.assertEqual(out.xp, 10)
            out2 = await tasks_api.quote_task(
                tasks_api.QuoteBody(task_type="campaign", total_slots=100, reward=D("0.05"), commission_bp=0),
                user=owner, db=s,
            )
            self.assertEqual(out2.total, D("5"))
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.quote_task(
                    tasks_api.QuoteBody(task_type="campaign", total_slots=1, reward=D("0.0000000001")),
                    user=owner, db=s,
                )
            self.assertEqual(cm.exception.status_code, 400)

        _run(body)


class CampaignQuoteMath(unittest.TestCase):
    def test_floor_to_quantum(self):
        q = tt.quote_campaign(tt.DEFAULT, reward="0.00000001", slots=3, commission_bp=3333)
        self.assertEqual(q.payout_nano, 30)
        self.assertEqual(q.commission_nano % tt.LEDGER_QUANTUM_NANO, 0)
        self.assertEqual(q.payout_nano + q.commission_nano, q.total_nano)


if __name__ == "__main__":
    unittest.main()
