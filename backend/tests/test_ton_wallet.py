"""Привязка кошелька TON: ton_proof, уникальность, отвязка.

На SQLite в памяти. Запуск из backend: python -m unittest discover -s tests
"""

import unittest
from datetime import datetime, timedelta, timezone

from app.services.ton_wallet import WalletError, _verify_ton_proof

UTC = timezone.utc
NOW = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
DOMAIN = "example.test"


class TonProofVerifyTests(unittest.TestCase):
    def test_domain_mismatch(self):
        with self.assertRaises(WalletError):
            _verify_ton_proof(
                {"address": "0:abc", "network": "-239", "publicKey": "", "walletStateInit": None},
                {"timestamp": int(NOW.timestamp()), "domain": {"value": "evil.com", "lengthBytes": 8}, "signature": "00", "payload": "x"},
                DOMAIN, 15, NOW, "mainnet",
            )

    def test_future_timestamp(self):
        with self.assertRaises(WalletError):
            _verify_ton_proof(
                {"address": "0:abc", "network": "-239", "publicKey": "", "walletStateInit": None},
                {"timestamp": int(NOW.timestamp()) + 120, "domain": {"value": DOMAIN, "lengthBytes": len(DOMAIN)}, "signature": "00", "payload": "x"},
                DOMAIN, 15, NOW, "mainnet",
            )

    def test_wrong_network(self):
        with self.assertRaises(WalletError):
            _verify_ton_proof(
                {"address": "0:abc", "network": "-3", "publicKey": "", "walletStateInit": None},
                {"timestamp": int(NOW.timestamp()), "domain": {"value": DOMAIN, "lengthBytes": len(DOMAIN)}, "signature": "00", "payload": "x"},
                DOMAIN, 15, NOW, "mainnet",
            )

    def test_no_stateinit(self):
        with self.assertRaises(WalletError):
            _verify_ton_proof(
                {"address": "0:abc", "network": "-239", "publicKey": "aa", "walletStateInit": None},
                {"timestamp": int(NOW.timestamp()), "domain": {"value": DOMAIN, "lengthBytes": len(DOMAIN)}, "signature": "00", "payload": "x"},
                DOMAIN, 15, NOW, "mainnet",
            )


if __name__ == "__main__":
    unittest.main()
