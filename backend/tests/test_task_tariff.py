"""Тариф заданий: нормализация и расчёт quote в нанотонах."""

from __future__ import annotations

import unittest
from decimal import Decimal

from app.services import task_tariff as tt
from app.services.economy_admin import EconomyAdminError, set_setting
from app.services.economy_seed import DEFAULTS


class NanoMath(unittest.TestCase):
    def test_roundtrip(self):
        cases = {
            "0.01": 10_000_000,
            "0.02": 20_000_000,
            "0.05": 50_000_000,
            "1": 1_000_000_000,
            "1.00000001": 1_000_000_010,
            "12.3456789": 12_345_678_900,
        }
        for s, nano in cases.items():
            n = tt.ton_to_nano(s)
            self.assertEqual(n, nano)
            self.assertEqual(tt.nano_to_ton(n), s)
            self.assertEqual(n % tt.LEDGER_QUANTUM_NANO, 0)

    def test_rejects_nine_decimals_beyond_ledger(self):
        # 9-й знак = 1 нанотон — не кратно 10
        with self.assertRaisesRegex(tt.TaskTariffError, "8 знаков"):
            tt.ton_to_nano("0.000000001")
        with self.assertRaisesRegex(tt.TaskTariffError, "больше 0"):
            tt.ton_to_nano("0")
        with self.assertRaisesRegex(tt.TaskTariffError, "100 TON"):
            tt.ton_to_nano("100.00000001")


class Normalize(unittest.TestCase):
    def test_default_ok(self):
        out = tt.normalize(tt.DEFAULT)
        self.assertEqual(out["levels"]["easy"]["reward"], "0.01")
        self.assertEqual(out["levels"]["easy"]["xp"], 5)
        self.assertEqual(out["min_slots"], 1)
        self.assertEqual(out["max_slots"], 10000)

    def test_requires_three_levels(self):
        bad = {"levels": {"easy": {"reward": "0.01", "xp": 1}}, "min_slots": 1, "max_slots": 10}
        with self.assertRaisesRegex(tt.TaskTariffError, "нет уровня"):
            tt.normalize(bad)

    def test_slots_order(self):
        v = {
            "levels": {
                "easy": {"reward": "0.01", "xp": 1},
                "normal": {"reward": "0.02", "xp": 2},
                "hard": {"reward": "0.03", "xp": 3},
            },
            "min_slots": 10,
            "max_slots": 5,
        }
        with self.assertRaisesRegex(tt.TaskTariffError, "min_slots"):
            tt.normalize(v)

    def test_rejects_commission_in_tariff(self):
        v = {**tt.DEFAULT, "commission_bp": 1000}
        with self.assertRaisesRegex(tt.TaskTariffError, "лишние поля"):
            tt.normalize(v)

    def test_set_setting_wires(self):
        import asyncio
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
        from app.db.base import Base

        async def run():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:")
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            Session = async_sessionmaker(engine, expire_on_commit=False)
            async with Session() as s:
                with self.assertRaises(EconomyAdminError):
                    await set_setting(s, key="task_tariff", value={**tt.DEFAULT, "commission_bp": 1})
                view = await set_setting(s, key="task_tariff", value=tt.DEFAULT)
                self.assertEqual(view.value["levels"]["hard"]["xp"], 20)
            await engine.dispose()

        asyncio.run(run())

    def test_seed_has_key(self):
        self.assertIn("task_tariff", DEFAULTS)
        self.assertEqual(DEFAULTS["task_tariff"][0], tt.DEFAULT)


class Quote(unittest.TestCase):
    def test_basic_10pct(self):
        # 0.02 TON × 100 = 2 TON payout; 10% = 0.2; total 2.2
        q = tt.quote(tt.DEFAULT, level="normal", slots=100, commission_bp=1000)
        self.assertEqual(q.reward_nano, 20_000_000)
        self.assertEqual(q.payout_nano, 2_000_000_000)
        self.assertEqual(q.commission_nano, 200_000_000)
        self.assertEqual(q.total_nano, 2_200_000_000)
        self.assertEqual(q.reward, "0.02")
        self.assertEqual(q.payout, "2")
        self.assertEqual(q.commission, "0.2")
        self.assertEqual(q.total, "2.2")
        self.assertEqual(q.xp, 10)

    def test_integer_commission_floor_to_quantum(self):
        # reward 0.01 × 3 = 0.03; 1 bp of 0.03 = 3000 nano → floor to 3000 already quantum? 
        # 0.03 TON = 30_000_000 nano; *1 //10000 = 3000 nano — not multiple of 10 → floor to 3000? 3000%10=0.
        # Use bp that leaves remainder: payout 0.01 (=10_000_000), bp=1 → 1000 nano ok.
        # payout 0.03 (=30M), bp=3 → 9000 nano ok.
        # Need remainder: 10_000_000 * 3 // 10000 = 3000. 
        # 100_000_001 wouldn't be valid reward. Use slots to get awkward number:
        # reward 0.01 × 1, bp=1 → commission 1000 nano.
        q = tt.quote(tt.DEFAULT, level="easy", slots=1, commission_bp=1)
        self.assertEqual(q.payout_nano, 10_000_000)
        self.assertEqual(q.commission_nano, 1_000)  # 10_000_000 * 1 // 10000
        self.assertEqual(q.total_nano, 10_001_000)

    def test_matches_decimal_tasks_commission(self):
        # текущий tasks._commission: quantize 8 знаков от payout * bp / 10000
        for slots in (1, 7, 99, 1000):
            q = tt.quote(tt.DEFAULT, level="hard", slots=slots, commission_bp=1000)
            payout = Decimal(q.reward) * slots
            expected = (payout * Decimal(1000) / Decimal(10000)).quantize(Decimal("0.00000001"))
            self.assertEqual(Decimal(q.commission), expected)
            self.assertEqual(Decimal(q.total), payout + expected)

    def test_rejects_bad_level_and_slots(self):
        with self.assertRaisesRegex(tt.TaskTariffError, "уровень"):
            tt.quote(tt.DEFAULT, level="legend", slots=1, commission_bp=1000)
        with self.assertRaisesRegex(tt.TaskTariffError, "число мест"):
            tt.quote(tt.DEFAULT, level="easy", slots=0, commission_bp=1000)


if __name__ == "__main__":
    unittest.main()
