"""Бюджет задания: после публикации награду и места можно только повышать с доплатой,
возобновление с паузы не обходит оплату, выплаты не выходят за оплаченный бюджет.

Тесты на настоящей БД в памяти (SQLite) — проверяем деньги по журналу баланса.
Запуск из папки backend: python -m pytest -q tests/test_task_budget.py
"""

import asyncio
import unittest
import warnings
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import BalanceHistory, Task, TaskSubmission, User  # noqa: F401 — регистрирует все таблицы
from app.services import tasks as t_svc

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

D = Decimal
# Комиссия по умолчанию — 10% (task_platform_commission_bp = 1000).


async def _env():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _user(s, tg, *, balance="0", ambassador=False, admin=False):
    u = User(telegram_id=tg, balance=D(balance), is_ambassador=ambassador, is_admin=admin)
    s.add(u)
    await s.flush()
    return u


async def _published(s, *, creator_balance="10", reward="0.1", slots=2):
    admin = await _user(s, 1, admin=True)
    amb = await _user(s, 2, balance=creator_balance, ambassador=True)
    v = await t_svc.create_task(s, creator=amb, title="T", description="D", reward=D(reward), total_slots=slots)
    await t_svc.approve_task(s, task_id=v.id, actor=admin)
    await t_svc.publish_task(s, task_id=v.id, actor=amb)
    return admin, amb, v.id


async def _approve_worker(s, admin, task_id, tg):
    w = await _user(s, tg)
    sub = await t_svc.submit(s, user=w, task_id=task_id, proof_text="готово")
    await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=True)
    return w


def run(coro_fn):
    async def main():
        engine, maker = await _env()
        try:
            async with maker() as s:
                await coro_fn(s)
        finally:
            await engine.dispose()

    asyncio.run(main())


class NormalFlowTest(unittest.TestCase):
    def test_publish_charges_and_payouts_work(self):
        async def body(s):
            admin, amb, tid = await _published(s)
            self.assertEqual(D(amb.balance), D("9.78"))  # 0.2 + 10% комиссии
            w1 = await _approve_worker(s, admin, tid, 10)
            w2 = await _approve_worker(s, admin, tid, 11)
            self.assertEqual(D(w1.balance), D("0.1"))
            self.assertEqual(D(w2.balance), D("0.1"))
            task = await s.get(Task, tid)
            self.assertEqual(task.status, "completed")
            self.assertEqual(await t_svc.paid_out(s, tid), D("0.2"))

        run(body)

    def test_pause_resume_without_changes_is_free(self):
        async def body(s):
            admin, amb, tid = await _published(s)
            await t_svc.pause_task(s, task_id=tid, actor=admin)
            await t_svc.update_task(s, task_id=tid, actor=amb, title="Новое название")
            await t_svc.publish_task(s, task_id=tid, actor=admin)  # возобновляет админ
            self.assertEqual(D(amb.balance), D("9.78"))
            self.assertEqual((await s.get(Task, tid)).status, "active")

        run(body)

    def test_draft_edits_are_free(self):
        async def body(s):
            amb = await _user(s, 2, balance="1", ambassador=True)
            v = await t_svc.create_task(s, creator=amb, title="T", description="D", reward=D("0.1"), total_slots=2)
            await t_svc.update_task(s, task_id=v.id, actor=amb, reward=D("0.05"), total_slots=1)
            task = await s.get(Task, v.id)
            self.assertEqual((D(task.reward), task.total_slots), (D("0.05"), 1))
            self.assertEqual(D(amb.balance), D("1"))

        run(body)


class ExploitTest(unittest.TestCase):
    def test_pause_raise_resume_charges_difference(self):
        async def body(s):
            admin, amb, tid = await _published(s)
            await _approve_worker(s, admin, tid, 10)  # 1 место занято, осталось 1
            await t_svc.pause_task(s, task_id=tid, actor=admin)
            # награда 0.1 → 0.5 и места 2 → 4: незанятые 1×0.1 → 3×0.5 = +1.4, комиссия 0.14
            await t_svc.update_task(s, task_id=tid, actor=amb, reward=D("0.5"), total_slots=4)
            self.assertEqual(D(amb.balance), D("9.78") - D("1.54"))
            task = await s.get(Task, tid)
            self.assertEqual(D(task.budget_locked), D("0.22") + D("1.54"))
            await t_svc.publish_task(s, task_id=tid, actor=admin)  # возобновляет админ
            for tg in (11, 12, 13):
                await _approve_worker(s, admin, tid, tg)
            self.assertEqual(await t_svc.paid_out(s, tid), D("1.6"))
            self.assertLessEqual(await t_svc.paid_out(s, tid), D(task.budget_locked))

        run(body)

    def test_raise_refused_without_money(self):
        async def body(s):
            admin, amb, tid = await _published(s, creator_balance="0.22")
            await t_svc.pause_task(s, task_id=tid, actor=admin)
            with self.assertRaises(t_svc.TaskBudgetError) as cm:
                await t_svc.update_task(s, task_id=tid, actor=amb, reward=D("1"))
            self.assertIn("Недостаточно TON", str(cm.exception))
            self.assertIn("1.98", str(cm.exception))  # 2×0.9 + 10%

        run(body)

    def test_raise_slots_while_active_charges(self):
        async def body(s):
            admin, amb, tid = await _published(s)
            await t_svc.update_task(s, task_id=tid, actor=admin, total_slots=5)  # админ правит активное
            self.assertEqual(D(amb.balance), D("9.78") - D("0.33"))
            task = await s.get(Task, tid)
            self.assertEqual(task.total_slots, 5)
            self.assertEqual(task.status, "active")

        run(body)

    def test_decrease_after_publish_refused(self):
        async def body(s):
            admin, amb, tid = await _published(s)
            await t_svc.pause_task(s, task_id=tid, actor=admin)
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.update_task(s, task_id=tid, actor=amb, reward=D("0.05"))
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.update_task(s, task_id=tid, actor=amb, total_slots=1)
            self.assertEqual(D(amb.balance), D("9.78"))

        run(body)

    def test_payout_beyond_budget_refused(self):
        async def body(s):
            # Задание, раздутое старой дырой: мест больше, чем оплачено.
            admin, amb, tid = await _published(s)
            task = await s.get(Task, tid)
            task.total_slots = 5
            await s.flush()
            for tg in (10, 11):
                await _approve_worker(s, admin, tid, tg)
            w = await _user(s, 12)
            sub = await t_svc.submit(s, user=w, task_id=tid, proof_text="готово")
            with self.assertRaises(t_svc.TaskBudgetError) as cm:
                await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=True)
            self.assertIn("Бюджет задания исчерпан", str(cm.exception))
            self.assertEqual(D(w.balance), D("0"))
            self.assertEqual((await s.get(TaskSubmission, sub.id)).status, "pending")
            self.assertEqual(await t_svc.paid_out(s, tid), D("0.2"))

        run(body)

    def test_resume_of_underfunded_task_refused(self):
        async def body(s):
            admin, amb, tid = await _published(s)
            await t_svc.pause_task(s, task_id=tid, actor=admin)
            task = await s.get(Task, tid)
            task.reward = D("1")  # как будто награду подняли до исправления
            await s.flush()
            with self.assertRaises(t_svc.TaskBudgetError):
                await t_svc.publish_task(s, task_id=tid, actor=admin)  # возобновляет админ
            self.assertEqual((await s.get(Task, tid)).status, "paused")

        run(body)

    def test_second_review_of_same_submission_refused(self):
        async def body(s):
            admin, amb, tid = await _published(s)
            w = await _user(s, 10)
            sub = await t_svc.submit(s, user=w, task_id=tid, proof_text="готово")
            await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=True)
            with self.assertRaises(t_svc.TaskStateError):
                await t_svc.review_submission(s, actor=admin, submission_id=sub.id, approve=True)
            self.assertEqual(D(w.balance), D("0.1"))
            rows = (await s.scalars(select(BalanceHistory).where(BalanceHistory.user_id == w.id))).all()
            self.assertEqual(len(rows), 1)

        run(body)


if __name__ == "__main__":
    unittest.main()
