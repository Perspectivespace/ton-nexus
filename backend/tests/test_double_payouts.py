"""Двойные выплаты (A2) и одна заявка на вывод (A3).

Повторный запрос (два нажатия, два запроса подряд) не должен начислить второй раз:
ежедневка, колесо, сбор майнера, отклонение/одобрение вывода, вторая заявка на вывод.

Последовательные проверки идут на SQLite в памяти (всегда).
Параллельные проверки — на настоящем Postgres, только если задан TEST_PG_URL, например
  TEST_PG_URL=postgresql+asyncpg://test@127.0.0.1:54329/tonnexus_test python -m pytest -q tests/test_double_payouts.py
ВНИМАНИЕ: тест пересоздаёт все таблицы в этой базе — только локальная пустая тестовая база.
"""

import asyncio
import json
import os
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import BalanceHistory, DailyCheckIn, User, WithdrawRequest  # noqa: F401 — регистрирует таблицы
from app.models.economy import EconomySetting
from app.models.miner import Miner
from app.services import daily, miner as miner_svc, prize_wheel, withdraw

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

D = Decimal
WALLET = "UQ" + "A" * 46
WHEEL_CFG = {"free_spins_per_day": 1, "items": [{"id": "ton", "label": "0.01 TON", "weight": 1, "ton": "0.01"}]}
PG_URL = os.environ.get("TEST_PG_URL")


async def _seed(s, *, balance="0"):
    """Админ, игрок (с готовым к сбору майнером) и настройки колеса."""
    admin = User(telegram_id=1, balance=D("0"), is_admin=True)
    u = User(telegram_id=2, balance=D(balance))
    s.add_all([admin, u])
    await s.flush()
    now = datetime.now(timezone.utc)
    s.add(Miner(user_id=u.id, status="running",
                session_started_at=now - timedelta(hours=13), session_ends_at=now - timedelta(hours=1)))
    s.add(EconomySetting(key="prize_wheel", value_json=json.dumps(WHEEL_CFG)))
    await s.flush()
    return admin.id, u.id


async def _credits(s, user_id, balance_type):
    return await s.scalar(
        select(func.count()).select_from(BalanceHistory).where(
            BalanceHistory.user_id == user_id,
            BalanceHistory.balance_type == balance_type,
            BalanceHistory.operation_type == "credit",
        )
    )


def run_sqlite(fn):
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


class SequentialTest(unittest.TestCase):
    def test_daily_twice(self):
        async def body(s):
            _, uid = await _seed(s)
            u = await s.get(User, uid)
            r1 = await daily.claim_daily(s, user=u)
            r2 = await daily.claim_daily(s, user=u)
            self.assertFalse(r1.already_claimed)
            self.assertTrue(r2.already_claimed)
            n = await s.scalar(select(func.count()).select_from(DailyCheckIn).where(DailyCheckIn.user_id == uid))
            self.assertEqual(n, 1)
        run_sqlite(body)

    def test_wheel_twice(self):
        async def body(s):
            _, uid = await _seed(s)
            u = await s.get(User, uid)
            await prize_wheel.spin(s, user=u)
            with self.assertRaises(prize_wheel.WheelError):
                await prize_wheel.spin(s, user=u)
            self.assertEqual(D(u.balance), D("0.01"))
        run_sqlite(body)

    def test_miner_claim_twice(self):
        async def body(s):
            _, uid = await _seed(s)
            _, amount = await miner_svc.claim(s, uid)
            self.assertGreater(amount, 0)
            with self.assertRaises(miner_svc.MinerNotReadyError):
                await miner_svc.claim(s, uid)
            self.assertEqual(await _credits(s, uid, "miner"), 1)
        run_sqlite(body)

    def test_withdraw_reject_twice_refunds_once(self):
        async def body(s):
            aid, uid = await _seed(s, balance="1")
            admin, u = await s.get(User, aid), await s.get(User, uid)
            req = await withdraw.create_request(s, user=u, amount=D("0.5"), wallet_address=WALLET)
            self.assertEqual(D(u.balance), D("0.5"))
            await withdraw.review(s, actor=admin, request_id=req.id, approve=False)
            for approve in (False, True):
                with self.assertRaises(withdraw.WithdrawStateError):
                    await withdraw.review(s, actor=admin, request_id=req.id, approve=approve)
            self.assertEqual(D(u.balance), D("1"))
        run_sqlite(body)

    def test_withdraw_approve_twice(self):
        async def body(s):
            aid, uid = await _seed(s, balance="1")
            admin, u = await s.get(User, aid), await s.get(User, uid)
            req = await withdraw.create_request(s, user=u, amount=D("0.5"), wallet_address=WALLET)
            await withdraw.review(s, actor=admin, request_id=req.id, approve=True)
            for approve in (True, False):
                with self.assertRaises(withdraw.WithdrawStateError):
                    await withdraw.review(s, actor=admin, request_id=req.id, approve=approve)
            self.assertEqual(D(u.balance), D("0.5"))
        run_sqlite(body)

    def test_second_pending_withdraw_refused(self):
        async def body(s):
            _, uid = await _seed(s, balance="1")
            u = await s.get(User, uid)
            await withdraw.create_request(s, user=u, amount=D("0.3"), wallet_address=WALLET)
            with self.assertRaises(withdraw.WithdrawStateError):
                await withdraw.create_request(s, user=u, amount=D("0.3"), wallet_address=WALLET)
            self.assertEqual(D(u.balance), D("0.7"))
        run_sqlite(body)


@unittest.skipUnless(PG_URL, "нет TEST_PG_URL — параллельные тесты на Postgres пропущены")
class PostgresConcurrencyTest(unittest.TestCase):
    """Два одновременных запроса в разных сессиях (как два HTTP-запроса): проходит ровно один."""

    def _race(self, *, balance="0", setup=None, op, expected_errors, check):
        async def main():
            engine = create_async_engine(PG_URL, pool_size=5)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
            maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
            try:
                async with maker() as s:
                    ids = await _seed(s, balance=balance)
                    if setup:
                        ids = ids + (await setup(s, *ids),)
                    await s.commit()

                async def one():
                    async with maker() as s:
                        try:
                            await op(s, *ids)
                            await s.commit()
                            return "ok"
                        except expected_errors:
                            await s.rollback()
                            return "refused"

                results = await asyncio.gather(*(one() for _ in range(4)))
                self.assertEqual(results.count("ok"), 1, results)
                async with maker() as s:
                    await check(s, *ids)
            finally:
                await engine.dispose()

        asyncio.run(main())

    def test_daily(self):
        async def op(s, _aid, uid):
            r = await daily.claim_daily(s, user=await s.get(User, uid))
            if r.already_claimed:
                raise LookupError

        async def check(s, _aid, uid):
            self.assertEqual(await _credits(s, uid, "daily"), 1)

        self._race(op=op, expected_errors=(LookupError,), check=check)

    def test_wheel(self):
        async def op(s, _aid, uid):
            await prize_wheel.spin(s, user=await s.get(User, uid))

        async def check(s, _aid, uid):
            self.assertEqual(D((await s.get(User, uid)).balance), D("0.01"))

        self._race(op=op, expected_errors=(prize_wheel.WheelError,), check=check)

    def test_miner_claim(self):
        async def op(s, _aid, uid):
            await miner_svc.claim(s, uid)

        async def check(s, _aid, uid):
            self.assertEqual(await _credits(s, uid, "miner"), 1)

        self._race(op=op, expected_errors=(miner_svc.MinerNotReadyError,), check=check)

    def test_withdraw_reject(self):
        async def setup(s, _aid, uid):
            req = await withdraw.create_request(s, user=await s.get(User, uid), amount=D("0.5"), wallet_address=WALLET)
            return req.id

        async def op(s, aid, _uid, rid):
            await withdraw.review(s, actor=await s.get(User, aid), request_id=rid, approve=False)

        async def check(s, _aid, uid, _rid):
            self.assertEqual(D((await s.get(User, uid)).balance), D("1"))

        self._race(balance="1", setup=setup, op=op, expected_errors=(withdraw.WithdrawStateError,), check=check)

    def test_withdraw_one_pending(self):
        async def op(s, _aid, uid):
            await withdraw.create_request(s, user=await s.get(User, uid), amount=D("0.3"), wallet_address=WALLET)

        async def check(s, _aid, uid):
            n = await s.scalar(select(func.count()).select_from(WithdrawRequest).where(WithdrawRequest.user_id == uid))
            self.assertEqual(n, 1)
            self.assertEqual(D((await s.get(User, uid)).balance), D("0.7"))

        self._race(balance="1", op=op, expected_errors=(withdraw.WithdrawStateError,), check=check)


if __name__ == "__main__":
    unittest.main()
