"""Basic tests for wallet linking (task 01). Full ton_proof crypto tests require a real keypair."""

import pytest
from app.services.ton_wallet import WalletError, _verify_ton_proof
from datetime import datetime, timezone


def test_domain_mismatch():
    now = datetime.now(timezone.utc)
    with pytest.raises(WalletError):
        _verify_ton_proof(
            {"address": "0:abc", "network": "-239", "publicKey": "00"},
            {"timestamp": int(now.timestamp()), "domain": {"value": "evil.com", "lengthBytes": 8}, "signature": "00", "payload": "x"},
            "mytaskbot.de",
            15,
            now,
        )


def test_future_timestamp():
    now = datetime.now(timezone.utc)
    with pytest.raises(WalletError):
        _verify_ton_proof(
            {"address": "0:abc", "network": "-239", "publicKey": "00"},
            {"timestamp": int(now.timestamp()) + 120, "domain": {"value": "mytaskbot.de", "lengthBytes": 12}, "signature": "00", "payload": "x"},
            "mytaskbot.de",
            15,
            now,
        )
