"""Управление заданиями владельцем: отмена с возвратом, добавление выполнений, смена цены, журнал."""

from __future__ import annotations

import asyncio
import unittest
import warnings
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import tasks as tasks_api
from app.db.base import Base
from app.models import BalanceHistory, Task, TaskOwnerAction, User  # noqa: F401
from app.services import balance_history as bh
from app.services import task_owner as ow
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


_tg = [5000]


async def _user(s, *, balance="10", **flags):
    _tg[0] += 1
    u = User(telegram_id=_tg[0], balance=D(balance), **flags)
    s.add(u)
    await s.flush()
    return u


def _run(fn):
    async def wrap():
        engine, Session = await _env()
        try:
            async with Session() as s:
                await seed_economy(s)
                await set_setting(s, key="task_platform_commission_bp", value={"bp": 1000})
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(wrap())


async def _legacy(s, creator, *, reward="0.1", slots=10):
    v = await t_svc.create_task(s, creator=creator, title="Старое", description="Сделай и пришли скрин",
                                reward=D(reward), total_slots=slots, task_type="manual_proof", publish=True)
    return await s.get(Task, v.id)


async def _work(s, task, reviewer, *, approve: int = 0, pending: int = 0):
    subs = []
    for i in range(approve + pending):
        w = await _user(s, balance="0")
        sub = await t_svc.submit(s, user=w, task_id=task.id, proof_text="готово")
        subs.append(sub)
    for sub in subs[:approve]:
        await t_svc.review_submission(s, actor=reviewer, submission_id=sub.id, approve=True)
    return subs[approve:]


async def _net(s, task) -> int:
    return await ow.ledger_net_charged_nano(s, task)


class Permissions(unittest.TestCase):
    def test_non_owner_403(self):
        async def body(s):
            admin = await _user(s, is_admin=True)
            task = await _legacy(s, admin)
            tid = task.id
            for flags in ({"is_admin": True}, {"is_ambassador": True}, {}):
                u = await _user(s, **flags)
                await s.commit()
                uid = u.id
                u = await s.get(User, uid)
                task = await s.get(Task, tid)
                for call in (
                    lambda: ow.cancel_task(s, task_id=task.id, actor=u),
                    lambda: ow.add_slots(s, task_id=task.id, actor=u, count=1),
                    lambda: ow.set_price(s, task_id=task.id, actor=u, reward="0.2"),
                    lambda: ow.summary(s, task_id=task.id, actor=u),
                    lambda: ow.list_all(s, actor=u),
                ):
                    with self.assertRaises(t_svc.TaskPermissionError):
                        await call()
                with self.assertRaises(HTTPException) as cm:
                    await tasks_api.owner_cancel(task.id, user=u, db=s)
                self.assertEqual(cm.exception.status_code, 403)
            task = await s.get(Task, tid)
            self.assertEqual(task.status, "active")

        _run(body)


class Cancel(unittest.TestCase):
    def test_full_refund_and_idempotent(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            admin = await _user(s, balance="10", is_admin=True)
            v = await t_svc.create_task(s, creator=admin, title="Переход", description="Открой сайт",
                                        reward=None, total_slots=100, task_type="visit",
                                        target_url="https://example.com", publish=True)
            await s.refresh(admin)
            self.assertEqual(D(admin.balance), D("8.9"))
            r = await ow.cancel_task(s, task_id=v.id, actor=owner)
            self.assertEqual(r.creator_delta_nano, -1_100_000_000)
            await s.refresh(admin)
            self.assertEqual(D(admin.balance), D("10"))
            task = await s.get(Task, v.id)
            self.assertEqual(task.status, "cancelled")
            self.assertEqual(await _net(s, task), 0)
            n_rows = await s.scalar(select(func.count(BalanceHistory.id)))
            r2 = await ow.cancel_task(s, task_id=v.id, actor=owner)
            self.assertTrue(r2.already)
            self.assertEqual(await s.scalar(select(func.count(BalanceHistory.id))), n_rows)
            row = (await s.execute(select(BalanceHistory).where(BalanceHistory.balance_type == "task_refund"))).scalar_one()
            self.assertEqual(bh.kind_of(row.operation_type, row.balance_type), "task_refund")
            self.assertEqual(bh.LABELS["task_refund"], "Возврат бюджета задания")
            self.assertIn("отменено владельцем", row.description)
            log = (await s.execute(select(TaskOwnerAction))).scalars().all()
            self.assertEqual([(a.action, a.actor_id, a.creator_delta_nano) for a in log],
                             [("cancel", owner.id, -1_100_000_000)])

        _run(body)

    def test_pending_reserved_then_reviewed(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            admin = await _user(s, balance="10", is_admin=True)
            task = await _legacy(s, admin)  # 0.1 × 10 + 10% = 1.1
            pend = await _work(s, task, admin, approve=3, pending=2)
            r = await ow.cancel_task(s, task_id=task.id, actor=owner)
            # свободно 10 − 3 − 2 = 5 мест: 0.5 + 0.05
            self.assertEqual(r.creator_delta_nano, -550_000_000)
            # заявка на проверке оплачивается из резерва
            await t_svc.review_submission(s, actor=admin, submission_id=pend[0].id, approve=True)
            # отклонённая — резерв возвращается создателю: 0.1 + 0.01
            await t_svc.review_submission(s, actor=admin, submission_id=pend[1].id, approve=False,
                                          reject_reason="low_quality")
            await s.refresh(task)
            self.assertEqual(task.status, "cancelled")
            await s.refresh(admin)
            self.assertEqual(D(admin.balance), D("10") - D("1.1") + D("0.55") + D("0.11"))
            # создатель заплатил ровно выплаты 4 × 0.1 + комиссию 10%
            self.assertEqual(await _net(s, task), 440_000_000)
            self.assertEqual(ow.to_nano(await t_svc.paid_out(s, task.id)), 400_000_000)
            self.assertEqual(task.creator_payout_nano, 400_000_000)
            self.assertEqual(task.creator_commission_nano, 40_000_000)

        _run(body)

    def test_legacy_fallback_never_exceeds_charged(self):
        async def body(s):
            await set_setting(s, key="task_platform_commission_bp", value={"bp": 3333})
            owner = await _user(s, is_owner=True)
            admin = await _user(s, balance="10", is_admin=True)
            task = await _legacy(s, admin, reward="0.33333333", slots=7)
            # старое задание: разбивки нет, комиссия из task_platform_commission_bp
            task.creator_payout_nano = task.creator_commission_nano = task.platform_payout_nano = None
            self.assertIsNone(task.commission_bp)
            charged = await _net(s, task)
            await _work(s, task, admin, approve=2)
            r = await ow.cancel_task(s, task_id=task.id, actor=owner)
            refund = -r.creator_delta_nano
            paid = ow.to_nano(await t_svc.paid_out(s, task.id))
            self.assertGreater(refund, 0)
            self.assertLessEqual(refund + paid, charged)
            self.assertGreaterEqual(await _net(s, task), paid)

        _run(body)

    def test_unfunded_and_partner(self):
        async def body(s):
            owner = await _user(s, is_owner=True, balance="0")
            draft = await t_svc.create_task(s, creator=owner, title="Черновик", description="без денег",
                                            reward=D("1"), total_slots=3, task_type="manual_proof")
            r = await ow.cancel_task(s, task_id=draft.id, actor=owner)
            self.assertEqual(r.creator_delta_nano, 0)
            self.assertEqual(r.task.status, "cancelled")
            partner = await _user(s)
            p = await t_svc.create_task(s, creator=owner, title="Купи стикеры", description="набор",
                                        reward=D("1"), total_slots=5, task_type="partner",
                                        partner_telegram_id=partner.telegram_id, publish=True)
            r = await ow.cancel_task(s, task_id=p.id, actor=owner)
            self.assertEqual((r.task.status, r.creator_delta_nano), ("closed", 0))
            self.assertTrue((await ow.cancel_task(s, task_id=p.id, actor=owner)).already)
            self.assertEqual(await s.scalar(select(func.count(BalanceHistory.id))), 0)

        _run(body)


class AddSlots(unittest.TestCase):
    def test_charge_free_and_insufficient(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            admin = await _user(s, balance="1.1", is_admin=True)
            task = await _legacy(s, admin)  # баланс 0
            with self.assertRaises(t_svc.TaskBudgetError):
                await ow.add_slots(s, task_id=task.id, actor=owner, count=5, mode="charge")
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.owner_add_slots(task.id, tasks_api.AddSlotsBody(count=5), user=owner, db=s)
            self.assertEqual(cm.exception.status_code, 402)

        _run(body)

    def test_charge_then_free_then_cancel_returns_only_creator_money(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            admin = await _user(s, balance="10", is_admin=True)
            task = await _legacy(s, admin)  # 1.1
            r = await ow.add_slots(s, task_id=task.id, actor=owner, count=5, mode="charge")
            self.assertEqual(r.creator_delta_nano, 550_000_000)  # 0.5 + 0.05
            r = await ow.add_slots(s, task_id=task.id, actor=owner, count=5, mode="free")
            self.assertEqual((r.creator_delta_nano, r.platform_delta_nano), (0, 500_000_000))
            await s.refresh(task)
            self.assertEqual(task.total_slots, 20)
            self.assertEqual(await _net(s, task), 1_650_000_000)
            # 12 выполнений: деньги создателя (15 мест) тратятся первыми
            await _work(s, task, admin, approve=12)
            r = await ow.cancel_task(s, task_id=task.id, actor=owner)
            # создателю: 3 места × 0.1 + 10%; платформенные 5 мест не возвращаются
            self.assertEqual(r.creator_delta_nano, -330_000_000)
            self.assertEqual(await _net(s, task), 1_320_000_000)  # 1.2 выплат + 0.12 комиссии

        _run(body)


class Price(unittest.TestCase):
    def test_increase_and_decrease_modes(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            admin = await _user(s, balance="10", is_admin=True)
            task = await _legacy(s, admin)  # 0.1 × 10
            await _work(s, task, admin, approve=4)
            # рост на 0.05 × 6 оставшихся = 0.3 + 0.03 с создателя
            r = await ow.set_price(s, task_id=task.id, actor=owner, reward="0.15", mode="creator")
            self.assertEqual(r.creator_delta_nano, 330_000_000)
            # ещё +0.05 × 6 за счёт платформы
            r = await ow.set_price(s, task_id=task.id, actor=owner, reward="0.2", mode="absorb")
            self.assertEqual((r.creator_delta_nano, r.platform_delta_nano), (0, 300_000_000))
            # снижение до 0.1: сначала освобождаются деньги платформы (0.3), затем создателя 0.3 + 0.03
            r = await ow.set_price(s, task_id=task.id, actor=owner, reward="0.1", mode="creator")
            self.assertEqual((r.creator_delta_nano, r.platform_delta_nano), (-330_000_000, -300_000_000))
            await s.refresh(task)
            self.assertEqual(D(task.reward), D("0.1"))
            self.assertEqual(task.platform_payout_nano, 0)
            # снижение до 0.05 с absorb: 0.05 × 6 = 0.3 остаётся платформе
            r = await ow.set_price(s, task_id=task.id, actor=owner, reward="0.05", mode="absorb")
            self.assertEqual((r.creator_delta_nano, r.platform_delta_nano), (0, -300_000_000))
            # пул ровно покрывает оставшиеся 6 мест по новой цене
            await s.refresh(task)
            paid = ow.to_nano(await t_svc.paid_out(s, task.id))
            pool = task.creator_payout_nano + task.platform_payout_nano
            self.assertEqual(pool - paid, 6 * 50_000_000)
            # выплаты идут по новой цене
            await _work(s, task, admin, approve=1)
            self.assertEqual(ow.to_nano(await t_svc.paid_out(s, task.id)), paid + 50_000_000)
            with self.assertRaises(t_svc.TaskError):
                await ow.set_price(s, task_id=task.id, actor=owner, reward="0.000000001")
            with self.assertRaises(t_svc.TaskError):
                await ow.set_price(s, task_id=task.id, actor=owner, reward="101")

        _run(body)

    def test_summary_and_list(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            admin = await _user(s, balance="10", is_admin=True)
            task = await _legacy(s, admin)
            await _work(s, task, admin, approve=2, pending=1)
            sm = await ow.summary(s, task_id=task.id, actor=owner)
            self.assertEqual(sm.pending, 1)
            self.assertEqual(sm.charged_nano, 1_100_000_000)
            self.assertEqual(sm.refundable_nano, 770_000_000)  # 7 свободных × 0.1 + 10%
            out = await tasks_api.owner_summary(task.id, user=owner, db=s)
            self.assertEqual(out.refundable, D("0.77"))
            lst = await ow.list_all(s, actor=owner)
            self.assertEqual([t.id for t in lst], [task.id])

        _run(body)


if __name__ == "__main__":
    unittest.main()
