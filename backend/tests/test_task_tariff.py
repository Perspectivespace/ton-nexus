"""Тариф заданий по типам: normalize, quote_visit, quote_partner (нанотоны)."""

from __future__ import annotations

import asyncio
import unittest
from decimal import Decimal

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.services import task_tariff as tt
from app.services.economy_admin import EconomyAdminError, set_setting
from app.services.economy_seed import DEFAULTS


class NanoMath(unittest.TestCase):
    def test_roundtrip(self):
        cases = {
            "0.01": 10_000_000,
            "0.02": 20_000_000,
            "1": 1_000_000_000,
            "1.00000001": 1_000_000_010,
        }
        for s, nano in cases.items():
            n = tt.ton_to_nano(s)
            self.assertEqual(n, nano)
            self.assertEqual(tt.nano_to_ton(n), s)
            self.assertEqual(n % tt.LEDGER_QUANTUM_NANO, 0)

    def test_rejects_beyond_ledger(self):
        with self.assertRaisesRegex(tt.TaskTariffError, "8 знаков"):
            tt.ton_to_nano("0.000000001")
        with self.assertRaisesRegex(tt.TaskTariffError, "больше 0"):
            tt.ton_to_nano("0")


class Normalize(unittest.TestCase):
    def test_default_ok(self):
        out = tt.normalize(tt.DEFAULT)
        self.assertEqual(out["visit"]["reward"], "0.01")
        self.assertEqual(out["visit"]["commission_bp"], 1000)
        self.assertEqual(out["campaign"]["xp"], 10)
        self.assertEqual(out["partner"]["fee_bp"], 1000)
        self.assertNotIn("levels", out)
        self.assertNotIn("commission_bp", out)  # только внутри типов

    def test_requires_three_types(self):
        with self.assertRaisesRegex(tt.TaskTariffError, "нет типа"):
            tt.normalize({"visit": tt.DEFAULT["visit"], "campaign": tt.DEFAULT["campaign"]})

    def test_rejects_difficulty_levels(self):
        with self.assertRaisesRegex(tt.TaskTariffError, "лишние поля"):
            tt.normalize({**tt.DEFAULT, "levels": {"easy": {"reward": "0.01", "xp": 1}}})

    def test_visit_slots_order(self):
        v = {
            **tt.DEFAULT,
            "visit": {**tt.DEFAULT["visit"], "min_slots": 10, "max_slots": 5},
        }
        with self.assertRaisesRegex(tt.TaskTariffError, "min_slots"):
            tt.normalize(v)

    def test_set_setting_wires(self):
        async def run():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:")
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            Session = async_sessionmaker(engine, expire_on_commit=False)
            async with Session() as s:
                with self.assertRaises(EconomyAdminError):
                    await set_setting(s, key="task_tariff", value={"visit": tt.DEFAULT["visit"]})
                view = await set_setting(s, key="task_tariff", value=tt.DEFAULT)
                self.assertEqual(view.value["partner"]["fee_bp"], 1000)
            await engine.dispose()

        asyncio.run(run())

    def test_seed_has_key(self):
        self.assertIn("task_tariff", DEFAULTS)
        self.assertEqual(DEFAULTS["task_tariff"][0], tt.DEFAULT)


class QuoteVisit(unittest.TestCase):
    def test_100_completions_10pct(self):
        # 0.01 × 100 = 1 TON исполнителям; комиссия 0.1; заказчик 1.1
        q = tt.quote_visit(tt.DEFAULT, slots=100)
        self.assertEqual(q.reward_nano, 10_000_000)
        self.assertEqual(q.payout_nano, 1_000_000_000)
        self.assertEqual(q.commission_nano, 100_000_000)
        self.assertEqual(q.total_nano, 1_100_000_000)
        self.assertEqual(q.payout_nano + q.commission_nano, q.total_nano)
        self.assertEqual(q.reward, "0.01")
        self.assertEqual(q.payout, "1")
        self.assertEqual(q.commission, "0.1")
        self.assertEqual(q.total, "1.1")
        self.assertEqual(q.xp, 5)

    def test_matches_decimal_and_sum(self):
        for slots in (1, 7, 99, 1000):
            q = tt.quote_visit(tt.DEFAULT, slots=slots)
            payout = Decimal(q.reward) * slots
            expected = (payout * Decimal(q.commission_bp) / Decimal(10000)).quantize(Decimal("0.00000001"))
            self.assertEqual(Decimal(q.commission), expected)
            self.assertEqual(q.payout_nano + q.commission_nano, q.total_nano)
            self.assertEqual(Decimal(q.total), payout + expected)

    def test_rejects_bad_slots(self):
        with self.assertRaisesRegex(tt.TaskTariffError, "число выполнений"):
            tt.quote_visit(tt.DEFAULT, slots=0)


class QuotePartner(unittest.TestCase):
    def test_sale_10pct(self):
        # покупка 1 TON → fee 0.1, партнёр 0.9
        q = tt.quote_partner(tt.DEFAULT, amount="1")
        self.assertEqual(q.amount_nano, 1_000_000_000)
        self.assertEqual(q.fee_nano, 100_000_000)
        self.assertEqual(q.partner_gets_nano, 900_000_000)
        self.assertEqual(q.fee_nano + q.partner_gets_nano, q.amount_nano)
        self.assertEqual(q.amount, "1")
        self.assertEqual(q.fee, "0.1")
        self.assertEqual(q.partner_gets, "0.9")
        self.assertEqual(q.xp, 5)

    def test_sum_invariant_various(self):
        for amt in ("0.01", "0.05", "2.5", "100"):
            q = tt.quote_partner(tt.DEFAULT, amount=amt)
            self.assertEqual(q.fee_nano + q.partner_gets_nano, q.amount_nano)
            expected_fee = (Decimal(amt) * Decimal(1000) / Decimal(10000)).quantize(Decimal("0.00000001"))
            self.assertEqual(Decimal(q.fee), expected_fee)

    def test_rejects_zero(self):
        with self.assertRaisesRegex(tt.TaskTariffError, "больше 0"):
            tt.quote_partner(tt.DEFAULT, amount="0")


if __name__ == "__main__":
    unittest.main()
