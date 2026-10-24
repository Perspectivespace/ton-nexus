"""Колесо удачи: розыгрыш по весам из настроек владельца, вес 0, запасные веса, шансы для экрана.

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import random
import unittest
from collections import Counter
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from app.services import prize_wheel as wheel
from app.services.economy_seed import DEFAULTS

SEED_CFG = DEFAULTS["prize_wheel"][0]


def _cfg(*weights):
    return {"free_spins_per_day": 1, "items": [{"id": f"s{i}", "label": f"S{i}", "weight": w} for i, w in enumerate(weights)]}


def _draw(cfg, n, seed=20261024):
    pairs, _ = wheel.effective_items(cfg)
    rng = random.Random(seed)
    return Counter(str(wheel._weighted_pick(pairs, rng)["id"]) for _ in range(n))


class DistributionTest(unittest.TestCase):
    def test_default_weights_match_chances(self):
        n = 60_000
        got = _draw(SEED_CFG, n)
        total = sum(i["weight"] for i in SEED_CFG["items"])
        for item in SEED_CFG["items"]:
            expected = item["weight"] / total
            self.assertAlmostEqual(got[item["id"]] / n, expected, delta=0.01, msg=item["id"])

    def test_owner_weights_are_used(self):
        n = 40_000
        got = _draw(_cfg(1, 3), n)
        self.assertAlmostEqual(got["s0"] / n, 0.25, delta=0.01)
        self.assertAlmostEqual(got["s1"] / n, 0.75, delta=0.01)

    def test_same_seed_same_sequence(self):
        self.assertEqual(_draw(SEED_CFG, 500, seed=7), _draw(SEED_CFG, 500, seed=7))


class ZeroWeightTest(unittest.TestCase):
    def test_zero_weight_never_drawn(self):
        got = _draw(_cfg(0, 5, 0, 1), 20_000)
        self.assertEqual(got["s0"], 0)
        self.assertEqual(got["s2"], 0)
        self.assertEqual(set(got), {"s1", "s3"})

    def test_zero_weight_first_even_at_r_zero(self):
        # раньше при r == 0 мог выпасть первый сектор с весом 0
        pairs, _ = wheel.effective_items(_cfg(0, 1))
        rng = mock.Mock(random=lambda: 0.0)
        self.assertEqual(wheel._weighted_pick(pairs, rng)["id"], "s1")

    def test_invalid_weight_counts_as_zero(self):
        cfg = _cfg(-3, "много", float("nan"), True, 2)
        pairs, source = wheel.effective_items(cfg)
        self.assertEqual(source, "settings")
        self.assertEqual([w for _, w in pairs], [0, 0, 0, 0, 2])
        self.assertEqual(set(_draw(cfg, 2_000)), {"s4"})

    def test_missing_weight_means_one(self):
        pairs, _ = wheel.effective_items({"items": [{"id": "a"}, {"id": "b", "weight": 3}]})
        self.assertEqual([w for _, w in pairs], [1, 3])

    def test_numeric_string_weight(self):
        pairs, _ = wheel.effective_items(_cfg("2", "6"))
        self.assertEqual([w for _, w in pairs], [2, 6])


class FallbackTest(unittest.TestCase):
    def _assert_default(self, cfg):
        with self.assertLogs("app.services.prize_wheel", level="WARNING"):
            pairs, source = wheel.effective_items(cfg)
        self.assertEqual(source, "default")
        self.assertEqual([i["id"] for i, _ in pairs], [i["id"] for i in SEED_CFG["items"]])
        self.assertEqual([w for _, w in pairs], [i["weight"] for i in SEED_CFG["items"]])

    def test_all_zero(self):
        self._assert_default(_cfg(0, 0, 0))

    def test_all_invalid(self):
        self._assert_default(_cfg("x", None, -1))

    def test_no_items(self):
        self._assert_default({"free_spins_per_day": 1})
        self._assert_default({"items": []})
        self._assert_default({"items": "сломано"})
        self._assert_default(None)


class SectorsViewTest(unittest.TestCase):
    def test_chances_from_settings(self):
        view = wheel.sectors_view(wheel.effective_items(_cfg(1, 2, 0, 1))[0])
        self.assertEqual([s["chance_pct"] for s in view], [25.0, 50.0, 0.0, 25.0])
        self.assertEqual(view[0]["label"], "S0")

    def test_default_chances_sum_to_100(self):
        view = wheel.sectors_view(wheel.effective_items(SEED_CFG)[0])
        self.assertEqual({s["id"]: s["chance_pct"] for s in view}["success_plus_5"], 8.0)
        self.assertAlmostEqual(sum(s["chance_pct"] for s in view), 100.0, delta=0.3)


class SpinUsesSettingsTest(unittest.TestCase):
    """spin() берёт веса из настроек владельца (а не из кода) и пишет понятный лог."""

    def _spin(self, cfg):
        async def fake_get_setting(_s, key):
            return cfg

        async def zero(*_a, **_k):
            return 0

        async def credit(*_a, **_k):
            return None

        session = SimpleNamespace(add=lambda *_: None, flush=mock.AsyncMock())
        user = SimpleNamespace(id=42, xp=0, focus_tokens=0, block_tokens=0, success_boost_bp=0, balance=Decimal("0"))
        with mock.patch.object(wheel, "get_setting", fake_get_setting), mock.patch.object(
            wheel, "_spins_today", zero
        ), mock.patch.object(wheel.balance_svc, "credit", credit):
            with self.assertLogs("app.services.prize_wheel", level="INFO") as logs:
                res = asyncio.run(wheel.spin(session, user=user))
        return res, user, logs.output

    def test_only_positive_sector_wins(self):
        cfg = {
            "free_spins_per_day": 3,
            "items": [
                {"id": "nothing", "label": "Пусто", "weight": 0},
                {"id": "focus_1", "label": "Фокус ×1", "weight": 5, "focus": 1},
            ],
        }
        for _ in range(20):
            res, user, logs = self._spin(cfg)
            self.assertEqual(res.item_id, "focus_1")
            self.assertEqual(user.focus_tokens, 1)
            self.assertEqual(res.free_spins_left_today, 2)
        self.assertTrue(any("item=focus_1" in l and "source=settings" in l for l in logs))

    def test_fallback_logged(self):
        _res, _user, logs = self._spin({"free_spins_per_day": 1, "items": [{"id": "nothing", "weight": 0}]})
        self.assertTrue(any("по весам по умолчанию" in l for l in logs))
        self.assertTrue(any("source=default" in l for l in logs))


if __name__ == "__main__":
    unittest.main()
