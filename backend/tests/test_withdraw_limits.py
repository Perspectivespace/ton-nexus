"""Условия вывода для формы: минимум отдаётся тем же правилом, что проверяет заявка.

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from app.services import withdraw as w_svc


def _setting(value):
    return mock.patch.object(w_svc, "get_setting", mock.AsyncMock(return_value={"ton": value}))


class LimitsTest(unittest.TestCase):
    def test_min_from_settings(self):
        with _setting("0.5"):
            self.assertEqual(asyncio.run(w_svc.min_withdraw(object())), Decimal("0.5"))

    def test_endpoint_returns_min(self):
        from app.api import withdraw as api
        with _setting("0.2"):
            out = asyncio.run(api.withdraw_limits(user=SimpleNamespace(id=1), db=object()))
        self.assertEqual(out.min_ton, Decimal("0.2"))

    def test_request_below_min_rejected_with_same_value(self):
        user = SimpleNamespace(id=1, is_banned=False)
        with _setting("0.5"):
            with self.assertRaises(w_svc.WithdrawError) as cm:
                asyncio.run(w_svc.create_request(object(), user=user, amount=Decimal("0.4"), wallet_address="UQ" + "a" * 46))
        self.assertIn("0.5", str(cm.exception))

    def test_wallet_format(self):
        self.assertTrue(w_svc.is_valid_wallet("  UQ" + "a" * 46 + " "))
        self.assertFalse(w_svc.is_valid_wallet("UQ123"))
        self.assertFalse(w_svc.is_valid_wallet("0:" + "a" * 64))


if __name__ == "__main__":
    unittest.main()
