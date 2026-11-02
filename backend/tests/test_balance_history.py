"""История баланса: виды операций, фильтры, страницы, статус вывода, незачисленные пополнения, API.

SQLite в памяти. Запуск из backend: python -m unittest tests.test_balance_history
"""

import json
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 — регистрирует таблицы
from app.db.base import Base
from app.models.balance import BalanceHistory
from app.models.deposit import TonDeposit
from app.models.economy import EconomySetting
from app.models.user import User
from app.models.withdraw import WithdrawRequest
from app.services import balance as balance_svc
from app.services import balance_history as bh
from app.services import withdraw as w_svc

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
warnings.filterwarnings("ignore", category=DeprecationWarning)
D = Decimal


class Base_(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite://")
        async with self.engine.begin() as c:
            await c.run_sync(Base.metadata.create_all)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.S() as s:
            s.add_all([User(telegram_id=1, balance=D("0")), User(telegram_id=2, balance=D("0"))])
            await s.commit()
            self.u1 = (await s.scalar(select(User).where(User.telegram_id == 1))).id
            self.u2 = (await s.scalar(select(User).where(User.telegram_id == 2))).id
        self.addAsyncCleanup(self.engine.dispose)

    async def credit(self, uid, amount, bt, **kw):
        async with self.S() as s:
            await balance_svc.credit(s, user_id=uid, amount=D(amount), balance_type=bt, **kw)
            await s.commit()

    async def debit(self, uid, amount, bt, **kw):
        async with self.S() as s:
            await balance_svc.debit(s, user_id=uid, amount=D(amount), balance_type=bt, **kw)
            await s.commit()

    async def page(self, uid=None, **kw):
        async with self.S() as s:
            return await bh.history(s, user_id=uid or self.u1, **kw)


class KindTests(unittest.TestCase):
    def test_kinds_and_groups(self):
        cases = {
            ("credit", "ton_deposit"): ("deposit", "deposits"),
            ("debit", "withdraw"): ("withdraw", "withdrawals"),
            ("credit", "withdraw"): ("withdraw_refund", "withdrawals"),
            ("credit", "tasks"): ("task_reward", "earnings"),
            ("debit", "tasks"): ("task_budget", "spending"),
            ("debit", "upgrade_burn"): ("upgrade", "spending"),
            ("credit", "tower_prize"): ("tower_prize", "earnings"),
            ("credit", "something_new"): ("credit", "earnings"),
            ("debit", None): ("debit", "spending"),
        }
        for (op, bt), (kind, group) in cases.items():
            k = bh.kind_of(op, bt)
            self.assertEqual((k, bh.group_of(k, op)), (kind, group), (op, bt))
            self.assertIn(k, bh.LABELS)


class HistoryTests(Base_):
    async def test_items_signs_and_filters(self):
        await self.credit(self.u1, "5", "ton_deposit", description="Пополнение TON", reference_type="ton_deposit")
        await self.credit(self.u1, "0.5", "daily", description="Daily day 1", reference_type="daily")
        await self.debit(self.u1, "1.25", "upgrade_burn", reference_type="miner")
        await self.credit(self.u1, "2", "tasks", description="Задание #7", reference_type="task_submission")
        await self.credit(self.u2, "9", "promo")  # чужое — не видно

        p = await self.page()
        self.assertEqual([i["kind"] for i in p.items], ["task_reward", "upgrade", "daily", "deposit"])
        self.assertEqual([i["amount"] for i in p.items], ["2", "-1.25", "0.5", "5"])
        self.assertEqual([i["balance_after"] for i in p.items], ["6.25", "4.25", "5.5", "5"])
        self.assertEqual(p.items[0]["detail"], "Задание #7")
        self.assertEqual(p.items[0]["label"], "Награда за задание")
        self.assertIsNone(p.next_cursor)

        kinds = lambda pg: [i["kind"] for i in pg.items]  # noqa: E731
        self.assertEqual(kinds(await self.page(flt="deposits")), ["deposit"])
        self.assertEqual(kinds(await self.page(flt="earnings")), ["task_reward", "daily"])
        self.assertEqual(kinds(await self.page(flt="spending")), ["upgrade"])
        self.assertEqual(kinds(await self.page(flt="withdrawals")), [])
        with self.assertRaises(ValueError):
            await self.page(flt="nope")

    async def test_pagination_by_cursor(self):
        for i in range(1, 8):
            await self.credit(self.u1, str(i), "miner")
        seen, cursor = [], None
        while True:
            p = await self.page(cursor=cursor, limit=3)
            seen += [i["amount"] for i in p.items]
            if p.next_cursor is None:
                break
            cursor = p.next_cursor
        self.assertEqual(seen, ["7", "6", "5", "4", "3", "2", "1"])

    async def test_withdraw_status_and_refund(self):
        await self.credit(self.u1, "10", "ton_deposit")
        async with self.S() as s:
            s.add(EconomySetting(key="withdraw", value_json=json.dumps({"min_ton": "1"})))
            await s.commit()
        async with self.S() as s:
            user = await s.get(User, self.u1)
            v = await w_svc.create_request(s, user=user, amount=D("3"), wallet_address="UQ" + "A" * 46)
            await s.commit()
        p = await self.page(flt="withdrawals")
        self.assertEqual(len(p.items), 1)
        it = p.items[0]
        self.assertEqual((it["kind"], it["amount"], it["status"], it["status_label"]), ("withdraw", "-3", "pending", "в обработке"))
        self.assertEqual(it["detail"], f"Заявка #{v.id}")

        async with self.S() as s:
            req = await s.get(WithdrawRequest, v.id)
            req.status = "rejected"
            await balance_svc.credit(s, user_id=self.u1, amount=D("3"), balance_type="withdraw",
                                     description=f"Отмена вывода #{v.id}", reference_type="withdraw", reference_id=v.id)
            await s.commit()
        p = await self.page(flt="withdrawals")
        self.assertEqual([i["kind"] for i in p.items], ["withdraw_refund", "withdraw"])
        self.assertEqual(p.items[1]["status_label"], "отклонено")
        self.assertEqual(p.items[0]["amount"], "3")

    async def test_legacy_hold_without_reference_matched_by_amount_and_time(self):
        await self.credit(self.u1, "10", "ton_deposit")
        await self.debit(self.u1, "2", "withdraw", reference_type="withdraw", reference_id=None)
        async with self.S() as s:
            s.add(WithdrawRequest(user_id=self.u1, amount=D("2"), wallet_address="UQx", status="paid"))
            s.add(WithdrawRequest(user_id=self.u1, amount=D("2"), wallet_address="UQx", status="pending",
                                  created_at=datetime.now(timezone.utc) - timedelta(days=3)))
            await s.commit()
        it = (await self.page(flt="withdrawals")).items[0]
        self.assertEqual((it["status"], it["status_label"]), ("paid", "выплачено"))

    async def test_pending_deposits_first_page_only(self):
        async with self.S() as s:
            s.add(TonDeposit(tx_hash="a" * 64, user_id=self.u1, amount_ton=D("0.05"), amount_nano=50_000_000,
                             status="below_min", utime=1_790_000_000))
            s.add(TonDeposit(tx_hash="b" * 64, user_id=None, amount_ton=D("1"), amount_nano=10**9, status="unmatched"))
            s.add(TonDeposit(tx_hash="c" * 64, user_id=self.u2, amount_ton=D("0.01"), amount_nano=10**7, status="below_min"))
            await s.commit()
        for i in range(3):
            await self.credit(self.u1, "1", "miner")
        p = await self.page(limit=2)
        self.assertEqual(len(p.pending), 1)
        self.assertEqual((p.pending[0]["kind"], p.pending[0]["amount"], p.pending[0]["status"]), ("deposit_pending", "0.05", "review"))
        self.assertEqual((await self.page(cursor=p.next_cursor, limit=2)).pending, [])
        self.assertEqual((await self.page(flt="spending")).pending, [])


class ApiTests(Base_):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        from app.api.deps import get_current_user
        from app.db.session import get_db
        from app.main import app

        async def _db():
            async with self.S() as s:
                yield s

        async def _user():
            async with self.S() as s:
                return await s.get(User, self.uid)

        self.uid = self.u1
        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = _user
        self.addCleanup(app.dependency_overrides.clear)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def test_endpoint_current_user_only(self):
        await self.credit(self.u1, "1.5", "promo", description="Промо X")
        await self.credit(self.u2, "7", "promo")
        r = await self.client.get("/api/v1/balance/history")
        self.assertEqual(r.status_code, 200, r.text)
        j = r.json()
        self.assertEqual([(i["kind"], i["amount"]) for i in j["items"]], [("promo", "1.5")])
        self.assertEqual(j["items"][0]["detail"], "X")
        self.assertEqual((j["next_cursor"], j["pending"]), (None, []))
        self.assertEqual((await self.client.get("/api/v1/balance/history", params={"filter": "x"})).status_code, 400)
        self.assertEqual((await self.client.get("/api/v1/balance/history", params={"limit": 500})).status_code, 422)
        self.assertEqual((await self.client.get("/api/v1/balance/history", params={"filter": "spending"})).json()["items"], [])


if __name__ == "__main__":
    unittest.main()
