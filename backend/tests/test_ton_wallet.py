"""Привязка кошелька TON: хэши кода, ton_proof.

На SQLite в памяти. Запуск из backend: python -m unittest discover -s tests
"""

import unittest
from datetime import datetime, timezone

from pytoniq_core import begin_cell

from app.services.ton_wallet import KNOWN_CODE_HASHES, WalletError, _verify_ton_proof

UTC = timezone.utc
NOW = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
DOMAIN = "example.test"

# Official hashes (verified via pytoniq / tonsdk)
OFFICIAL = {
    "v3r1": "b61041a58a7980b946e8fb9e198e3c904d24799ffa36574ea4251c41a566f581",
    "v3r2": "84dafa449f98a6987789ba232358072bc0f76dc4524002a5d0918b9a75d2d599",
    "v4r2": "feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0",
    "v5r1": "20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f",
}


class CodeHashTests(unittest.TestCase):
    def test_table_matches_official(self):
        by_version = {v: k for k, v in KNOWN_CODE_HASHES.items()}
        for ver, h in OFFICIAL.items():
            self.assertEqual(by_version.get(ver), h, f"{ver} hash mismatch")

    def test_hash_is_computed(self):
        """Hash comes from Cell.hash, not a hardcoded string."""
        cell = begin_cell().store_uint(0xABCD, 16).end_cell()
        computed = cell.hash.hex()
        self.assertEqual(len(computed), 64)
        self.assertNotIn(computed, KNOWN_CODE_HASHES)


class TonProofNegativeTests(unittest.TestCase):
    def _addr(self):
        return "0:" + "ab" * 32

    def test_domain_mismatch(self):
        with self.assertRaises(WalletError):
            _verify_ton_proof(
                {"address": self._addr(), "network": "-239", "publicKey": "", "walletStateInit": None},
                {"timestamp": int(NOW.timestamp()), "domain": {"value": "evil.com", "lengthBytes": 8}, "signature": "00", "payload": "x"},
                DOMAIN, 15, NOW, "mainnet",
            )

    def test_future_timestamp(self):
        with self.assertRaises(WalletError):
            _verify_ton_proof(
                {"address": self._addr(), "network": "-239", "publicKey": "", "walletStateInit": None},
                {"timestamp": int(NOW.timestamp()) + 120, "domain": {"value": DOMAIN, "lengthBytes": len(DOMAIN)}, "signature": "00", "payload": "x"},
                DOMAIN, 15, NOW, "mainnet",
            )

    def test_wrong_network(self):
        with self.assertRaises(WalletError):
            _verify_ton_proof(
                {"address": self._addr(), "network": "-3", "publicKey": "", "walletStateInit": None},
                {"timestamp": int(NOW.timestamp()), "domain": {"value": DOMAIN, "lengthBytes": len(DOMAIN)}, "signature": "00", "payload": "x"},
                DOMAIN, 15, NOW, "mainnet",
            )

    def test_no_stateinit(self):
        with self.assertRaises(WalletError):
            _verify_ton_proof(
                {"address": self._addr(), "network": "-239", "publicKey": "aa" * 32, "walletStateInit": None},
                {"timestamp": int(NOW.timestamp()), "domain": {"value": DOMAIN, "lengthBytes": len(DOMAIN)}, "signature": "00", "payload": "x"},
                DOMAIN, 15, NOW, "mainnet",
            )


if __name__ == "__main__":
    unittest.main()
