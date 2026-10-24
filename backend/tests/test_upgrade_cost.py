"""Цена прогона усиления: формула и то, что прогон и показ цены используют одну функцию.

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from app.services import miner as miner_svc
from app.services import upgrade as upgrade_svc
from app.services import upgrade_cost as cost_svc
from app.services.economy_seed import DEFAULTS


def _miner(levels=(1, 1, 1, 1, 1)):
    p, c, a, l, s = levels
    return SimpleNamespace(power=p, capacity=c, acceleration=a, luck=l, stability=s)


class ComputeCostTest(unittest.TestCase):
    def test_start_levels_cost_base(self):
        self.assertEqual(cost_svc.compute_upgrade_cost(Decimal("0.05"), Decimal("0.01"), 5), Decimal("0.05"))

    def test_each_level_above_five_adds_scale(self):
        self.assertEqual(cost_svc.compute_upgrade_cost(Decimal("0.05"), Decimal("0.01"), 10), Decimal("0.10"))

    def test_never_below_base(self):
        self.assertEqual(cost_svc.compute_upgrade_cost(Decimal("0.05"), Decimal("0.01"), 0), Decimal("0.05"))

    def test_quantized_to_8_places(self):
        v = cost_svc.compute_upgrade_cost(Decimal("0.1"), Decimal("0.000000001"), 6)
        self.assertEqual(v, Decimal("0.10000000"))
        self.assertEqual(v.as_tuple().exponent, -8)


class UpgradeCostSettingsTest(unittest.TestCase):
    def _run(self, settings, miner):
        async def fake_get_setting(_session, key):
            return settings[key]

        with mock.patch.object(cost_svc, "get_setting", fake_get_setting):
            return asyncio.run(cost_svc.upgrade_cost(None, miner))

    def test_uses_default_settings(self):
        settings = {k: v[0] for k, v in DEFAULTS.items()}
        self.assertEqual(self._run(settings, _miner((3, 2, 2, 1, 2))), Decimal("0.10000000"))

    def test_follows_owner_settings(self):
        settings = {"upgrade_base_cost": {"ton": "0.2"}, "upgrade_cost_scale": {"per_total_levels": "0.05"}}
        self.assertEqual(self._run(settings, _miner((2, 1, 1, 1, 1))), Decimal("0.25000000"))


class SameFunctionTest(unittest.TestCase):
    def test_run_and_preview_share_one_function(self):
        self.assertIs(upgrade_svc.upgrade_cost, cost_svc.upgrade_cost)
        self.assertIs(miner_svc.upgrade_cost, cost_svc.upgrade_cost)


if __name__ == "__main__":
    unittest.main()
