"""Партнёрская услуга: только владелец, покупка с баланса (нанотоны), идемпотентность, история, XP."""

from __future__ import annotations

import asyncio
import unittest
import warnings
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import tasks as tasks_api
from app.db.base import Base
from app.models import BalanceHistory, Task, TaskPurchase, User  # noqa: F401
from app.services import balance_history as bh
from app.services import task_tariff as tt
from app.services import tasks as t_svc
from app.services.economy_admin import set_setting
from app.services.economy_seed import seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
D = Decimal
NANO = 10**9


async def _env():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _user(s, tg, *, balance="10", ambassador=False, admin=False, owner=False, username=None):
    u = User(telegram_id=tg, balance=D(balance), is_ambassador=ambassador, is_admin=admin, is_owner=owner,
             username=username)
    s.add(u)
    await s.flush()
    return u


def _run(fn):
    async def wrap():
        engine, Session = await _env()
        try:
            async with Session() as s:
                await seed_economy(s)
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(wrap())


def _create(s, owner, partner_tg, **kw):
    args = dict(
        creator=owner, title="Купи стикеры", description="Набор стикеров партнёра",
        reward=D("1"), total_slots=100, task_type="partner", partner_telegram_id=partner_tg,
    )
    args.update(kw)
    return t_svc.create_task(s, **args)


async def _setup(s, *, price="1", buyer_balance="5", **kw):
    owner = await _user(s, 900, owner=True, balance="0")
    partner = await _user(s, 901, balance="0", username="sticker_shop")
    buyer = await _user(s, 902, balance=buyer_balance)
    v = await _create(s, owner, 901, reward=D(price), publish=True, **kw)
    return owner, partner, buyer, v


class PartnerPermissions(unittest.TestCase):
    def test_only_owner_creates_403(self):
        async def body(s):
            await _user(s, 901)
            for i, flags in enumerate(({"admin": True}, {"ambassador": True}, {})):
                u = await _user(s, 950 + i, **flags)
                with self.assertRaises(t_svc.TaskPermissionError):
                    await _create(s, u, 901)
                req = tasks_api.TaskCreateBody(title="Купи", description="Стикеры", reward=D("1"),
                                               total_slots=5, task_type="partner", partner_telegram_id=901)
                with self.assertRaises(HTTPException) as cm:
                    await tasks_api.create_task(req, user=u, db=s)
                self.assertEqual(cm.exception.status_code, 403)
                q = tasks_api.QuoteBody(task_type="partner", total_slots=1, reward=D("1"))
                with self.assertRaises(HTTPException) as cm2:
                    await tasks_api.quote_task(q, user=u, db=s)
                self.assertEqual(cm2.exception.status_code, 403)

        _run(body)

    def test_type_switch_and_admin_edit_close_blocked(self):
        async def body(s):
            owner, partner, buyer, v = await _setup(s)
            admin = await _user(s, 960, admin=True)
            with self.assertRaises(t_svc.TaskPermissionError):
                await t_svc.update_task(s, task_id=v.id, actor=admin, reward=D("2"))
            with self.assertRaises(t_svc.TaskPermissionError):
                await t_svc.pause_task(s, task_id=v.id, actor=admin)
            with self.assertRaises(t_svc.TaskPermissionError):
                await t_svc.close_task(s, task_id=v.id, actor=admin)
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.update_task(s, task_id=v.id, actor=owner, task_type="campaign")
            m = await t_svc.create_task(s, creator=admin, title="abc", description="def ghi",
                                        reward=D("0.1"), total_slots=2, task_type="manual_proof")
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.update_task(s, task_id=m.id, actor=owner, task_type="partner")

        _run(body)


class PartnerCreate(unittest.TestCase):
    def test_snapshot_and_validation(self):
        async def body(s):
            owner = await _user(s, 900, owner=True)
            await _user(s, 901)
            v = await _create(s, owner, 901)
            task = await s.get(Task, v.id)
            self.assertEqual((task.commission_bp, task.xp_reward), (1000, 5))
            self.assertEqual(D(task.reward), D("1"))
            self.assertEqual(task.budget_locked, 0)
            bad = [
                dict(partner_tg=None), dict(partner_tg=12345),  # нет партнёра
                dict(reward=None), dict(reward=D("0")), dict(reward=D("0.000000001")),
                dict(reward=D("100.00000001")), dict(commission_bp=10001), dict(total_slots=0),
                dict(xp_reward=-1),
            ]
            for kw in bad:
                ptg = kw.pop("partner_tg", 901)
                with self.subTest(kw=kw, ptg=ptg), self.assertRaises(t_svc.TaskError):
                    await _create(s, owner, ptg, **kw)
            v2 = await _create(s, owner, 901, commission_bp=0, xp_reward=0)
            t2 = await s.get(Task, v2.id)
            self.assertEqual((t2.commission_bp, t2.xp_reward), (0, 0))

        _run(body)

    def test_owner_settings_fallback_and_snapshot(self):
        async def body(s):
            owner = await _user(s, 900, owner=True)
            await _user(s, 901)
            # тариф не объект → DEFAULT (10%)
            await set_setting(s, key="task_tariff", value={**tt.DEFAULT, "partner": {"fee_bp": 2500, "xp": 7}})
            v = await _create(s, owner, 901)
            t1 = await s.get(Task, v.id)
            self.assertEqual((t1.commission_bp, t1.xp_reward), (2500, 7))
            await set_setting(s, key="task_tariff", value=tt.DEFAULT)
            t1 = await s.get(Task, v.id)
            self.assertEqual(t1.commission_bp, 2500)  # снимок не меняется

        _run(body)

    def test_publish_charges_nobody(self):
        async def body(s):
            owner, partner, buyer, v = await _setup(s)
            self.assertEqual(v.status, "active")
            await s.refresh(owner)
            self.assertEqual(D(owner.balance), D("0"))

        _run(body)


class PartnerBuy(unittest.TestCase):
    def test_money_moves_exactly(self):
        async def body(s):
            # 0.33333333 × 33.33% — проверяем округление вниз до кванта, остаток партнёру
            owner, partner, buyer, v = await _setup(s, price="0.33333333", commission_bp=3333)
            r = await t_svc.buy_partner(s, buyer=buyer, task_id=v.id)
            self.assertFalse(r.already)
            p = r.purchase
            self.assertEqual(p.amount_nano, 333_333_330)
            raw = 333_333_330 * 3333 // 10_000
            self.assertEqual(p.fee_nano, raw - raw % 10)
            self.assertEqual(p.amount_nano, p.partner_nano + p.fee_nano)
            await s.refresh(buyer)
            await s.refresh(partner)
            self.assertEqual(D(buyer.balance), D("5") - D("0.33333333"))
            self.assertEqual(D(partner.balance) * NANO, p.partner_nano)
            self.assertEqual(await t_svc.partner_revenue_nano(s), p.fee_nano)
            # debit == credit + fee по журналу
            rows = (await s.execute(select(BalanceHistory).where(BalanceHistory.reference_type == "task_purchase"))).scalars().all()
            debit = sum(D(r.amount) for r in rows if r.operation_type == "debit")
            credit = sum(D(r.amount) for r in rows if r.operation_type == "credit")
            self.assertEqual(debit * NANO, credit * NANO + p.fee_nano)
            # подписи
            kinds = {r.operation_type: (bh.kind_of(r.operation_type, r.balance_type), r.description) for r in rows}
            self.assertEqual(kinds["debit"][0], "partner_purchase")
            self.assertIn("Покупка «Купи стикеры»", kinds["debit"][1])
            self.assertEqual(kinds["credit"][0], "partner_sale")
            self.assertIn("комиссия платформы", kinds["credit"][1])
            self.assertEqual(bh.LABELS["partner_purchase"], "Покупка партнёрской услуги")
            # XP покупателю и место занято
            await s.refresh(buyer)
            self.assertTrue(buyer.xp > 0 or buyer.level > 1)
            task = await s.get(Task, v.id)
            self.assertEqual(task.filled_slots, 1)

        _run(body)

    def test_insufficient_balance_changes_nothing(self):
        async def body(s):
            owner, partner, buyer, v = await _setup(s, price="1", buyer_balance="0.5")
            await s.commit()
            with self.assertRaisesRegex(t_svc.TaskBudgetError, "Недостаточно TON"):
                await t_svc.buy_partner(s, buyer=buyer, task_id=v.id)
            await s.rollback()
            await s.refresh(buyer)
            self.assertEqual(D(buyer.balance), D("0.5"))
            self.assertEqual(await s.scalar(select(TaskPurchase.id)), None)
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.buy_task(v.id, user=buyer, db=s)
            self.assertEqual(cm.exception.status_code, 402)

        _run(body)

    def test_double_purchase_is_idempotent(self):
        async def body(s):
            owner, partner, buyer, v = await _setup(s)
            out1 = await tasks_api.buy_task(v.id, user=buyer, db=s)
            out2 = await tasks_api.buy_task(v.id, user=buyer, db=s)
            self.assertFalse(out1.already)
            self.assertTrue(out2.already)
            self.assertEqual(out1.purchase_id, out2.purchase_id)
            self.assertEqual((out1.amount, out1.fee, out1.partner_gets), (D("1"), D("0.1"), D("0.9")))
            await s.refresh(buyer)
            await s.refresh(partner)
            self.assertEqual(D(buyer.balance), D("4"))
            self.assertEqual(D(partner.balance), D("0.9"))
            rows = (await s.execute(select(BalanceHistory).where(BalanceHistory.reference_type == "task_purchase"))).scalars().all()
            self.assertEqual(len(rows), 2)
            task = await s.get(Task, v.id)
            self.assertEqual(task.filled_slots, 1)
            # TaskOut для покупателя
            out = await tasks_api.get_task(v.id, user=buyer, db=s)
            self.assertTrue(out.purchased)
            self.assertEqual(out.partner_name, "@sticker_shop")

        _run(body)

    def test_unique_constraint_backstop(self):
        async def body(s):
            owner, partner, buyer, v = await _setup(s)
            s.add(TaskPurchase(task_id=v.id, buyer_id=buyer.id, partner_id=partner.id,
                               amount_nano=1, fee_nano=0, partner_nano=1, fee_bp=0))
            await s.flush()
            with self.assertRaises(Exception):
                s.add(TaskPurchase(task_id=v.id, buyer_id=buyer.id, partner_id=partner.id,
                                   amount_nano=1, fee_nano=0, partner_nano=1, fee_bp=0))
                await s.flush()

        _run(body)

    def test_rules(self):
        async def body(s):
            owner, partner, buyer, v = await _setup(s, total_slots=1)
            with self.assertRaisesRegex(t_svc.TaskError, "свою"):
                await t_svc.buy_partner(s, buyer=partner, task_id=v.id)
            with self.assertRaisesRegex(t_svc.TaskError, "Купить"):
                await t_svc.submit(s, user=buyer, task_id=v.id, proof_text="x")
            await t_svc.buy_partner(s, buyer=buyer, task_id=v.id)
            task = await s.get(Task, v.id)
            self.assertEqual(task.status, "completed")
            other = await _user(s, 903, balance="5")
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.buy_partner(s, buyer=other, task_id=v.id)
            # владелец добавляет продажи → пауза → публикация → можно купить
            await t_svc.update_task(s, task_id=v.id, actor=owner, total_slots=5, reward=D("2"))
            await t_svc.publish_task(s, task_id=v.id, actor=owner)
            r = await t_svc.buy_partner(s, buyer=other, task_id=v.id)
            self.assertEqual(r.purchase.amount_nano, 2 * NANO)
            # закрыта → купить нельзя
            await t_svc.close_task(s, task_id=v.id, actor=owner)
            third = await _user(s, 904, balance="5")
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.buy_partner(s, buyer=third, task_id=v.id)

        _run(body)

    def test_quote_partner_endpoint(self):
        async def body(s):
            owner = await _user(s, 900, owner=True)
            out = await tasks_api.quote_task(
                tasks_api.QuoteBody(task_type="partner", total_slots=1, reward=D("2.5")), user=owner, db=s)
            self.assertEqual((out.total, out.commission, out.payout), (D("2.5"), D("0.25"), D("2.25")))

        _run(body)


if __name__ == "__main__":
    unittest.main()
