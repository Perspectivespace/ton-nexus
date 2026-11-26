"""Сводка для «Помощи»: числа из настроек, без адресов и чужих id.

Запуск из backend: python -m unittest tests.test_help_facts
"""

from __future__ import annotations

import copy
import itertools
import json
import re
import unittest
from dataclasses import replace
from decimal import Decimal

from unittest import mock

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.models.economy import EconomySetting
from app.models.user import User
from app.services import arena_config
from app.services.help_facts import commission_percent
from app.services.task_tariff import DEFAULT as TARIFF_DEFAULT
from app.services.task_tariff import nano_to_ton
from app.services.ton_deposits import MAX_DEPOSIT_TON

_TG = itertools.count(94000)
# Выдуманные адреса только для проверки, что сводка их не повторяет.
_ADDR = "UQ" + "C" * 46
_PAYOUT = "EQ" + "D" * 46
_WALLET_RE = re.compile(r"(UQ|EQ)[A-Za-z0-9_-]{46}")
_FORBIDDEN_KEYS = ("address", "wallet", "memo", "telegram", "user_id", "username")


def _walk(obj, hits: list[str]) -> None:
    if isinstance(obj, dict):
        for key, value in obj.items():
            low = str(key).lower()
            for bad in _FORBIDDEN_KEYS:
                if bad in low:
                    hits.append(key)
            _walk(value, hits)
    elif isinstance(obj, list):
        for value in obj:
            _walk(value, hits)


class StakeAndPercentTest(unittest.TestCase):
    def test_stake_comes_from_room_table(self):
        self.assertEqual(arena_config.stake_nano(), 100_000_000)
        self.assertEqual({rt.stake_nano for rt in arena_config.ARENA_ROOMS.values()}, {arena_config.stake_nano()})

    def test_stake_rejects_split_rooms(self):
        a4 = arena_config.ARENA_ROOMS["a4"]
        fake = {"a4": a4, "a8": replace(a4, code="a8", stake_nano=a4.stake_nano + 10)}
        with mock.patch.object(arena_config, "ARENA_ROOMS", fake):
            with self.assertRaises(RuntimeError):
                arena_config.stake_nano()

    def test_percent_from_bp(self):
        self.assertEqual(commission_percent(1000), "10")
        self.assertEqual(commission_percent(1050), "10.5")
        self.assertEqual(commission_percent(1001), "10.01")
        self.assertEqual(commission_percent(0), "0")
        self.assertEqual(commission_percent(10000), "100")


class ApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.db.session import get_db
        from app.main import app

        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.addAsyncCleanup(self.engine.dispose)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

        async def _db():
            async with self.S() as s:
                yield s

        app.dependency_overrides[get_db] = _db
        self.addCleanup(app.dependency_overrides.clear)
        p = mock.patch.object(settings, "debug", True)
        p.start()
        self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def _get(self, tg: int):
        return await self.client.get("/api/v1/help", headers={"X-Telegram-Init-Data": f"dev:{tg}"})

    def _assert_clean(self, body: str, data: dict) -> None:
        hits: list[str] = []
        _walk(data, hits)
        self.assertEqual(hits, [])
        self.assertNotIn(_ADDR, body)
        self.assertNotIn(_PAYOUT, body)
        self.assertIsNone(_WALLET_RE.search(body))
        self.assertNotIn("project_address", body)
        self.assertNotIn("payout_wallet", body)

    async def test_auth_required(self):
        with mock.patch.object(settings, "debug", False):
            r = await self.client.get("/api/v1/help")
            self.assertEqual(r.status_code, 401)
            r = await self.client.get("/api/v1/help", headers={"X-Telegram-Init-Data": "query_id=x&hash=bad"})
            self.assertEqual(r.status_code, 401)

    async def test_defaults_and_no_addresses(self):
        tg = next(_TG)
        r = await self._get(tg)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self._assert_clean(r.text, data)
        self.assertEqual(set(data), {"deposit", "withdraw", "ads", "arena", "visit"})
        self.assertEqual(data["deposit"], {"enabled": False, "min_ton": "0.1", "max_ton": "10000"})
        self.assertEqual(data["deposit"]["max_ton"], format(MAX_DEPOSIT_TON, "f"))
        self.assertEqual(data["withdraw"], {"min_ton": "0.2"})
        self.assertEqual(data["ads"]["min_level"], 1)
        self.assertEqual((data["ads"]["min_days"], data["ads"]["max_days"]), (1, 30))
        self.assertEqual(
            data["ads"]["price_per_day"],
            {"line": "1", "banner": "0.5", "neon": "0.3", "facade_screen": "1.5"},
        )
        self.assertEqual(
            data["arena"],
            {
                "commission_bp": 1000,
                "commission_percent": "10",
                "stake_ton": nano_to_ton(arena_config.stake_nano()),
                "fill_timeout_s": arena_config.FILL_TIMEOUT_S,
            },
        )
        self.assertEqual(data["arena"]["stake_ton"], "0.1")
        self.assertEqual(data["visit"], {"reward_ton": "0.01", "commission_bp": 1000, "commission_percent": "10"})
        async with self.S() as s:
            memo = await s.scalar(select(User.deposit_memo).where(User.telegram_id == tg))
        self.assertIsNone(memo)

    async def test_settings_override_and_hidden_address(self):
        tariff = copy.deepcopy(TARIFF_DEFAULT)
        tariff["visit"]["reward"] = "0.02"
        tariff["visit"]["commission_bp"] = 2500
        rows = [
            ("ton_deposits", {"enabled": True, "project_address": _ADDR, "min_ton": "0.4", "poll_seconds": 15}),
            ("ton_payouts", {"enabled": True, "payout_wallet": _PAYOUT}),
            ("min_withdraw_ton", {"ton": "1.25"}),
            ("arena", {"enabled": True, "commission_bp": 500}),
            (
                "city_ads",
                {
                    "min_level": 4,
                    "min_days": 2,
                    "max_days": 14,
                    "prices": {
                        "line": {"price_day": "2"},
                        "banner": {"price_day": "0.8"},
                        "neon": {"price_day": "0.4"},
                        "facade_screen": {"price_day": "3"},
                    },
                },
            ),
            ("task_tariff", tariff),
        ]
        async with self.S() as s:
            for key, value in rows:
                s.add(EconomySetting(key=key, value_json=json.dumps(value)))
            await s.commit()

        r = await self._get(next(_TG))
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self._assert_clean(r.text, data)
        self.assertEqual(data["deposit"]["enabled"], True)
        self.assertEqual(data["deposit"]["min_ton"], "0.4")
        self.assertEqual(data["deposit"]["max_ton"], "10000")
        self.assertEqual(data["withdraw"]["min_ton"], "1.25")
        self.assertEqual(data["arena"]["commission_bp"], 500)
        self.assertEqual(data["arena"]["commission_percent"], "5")
        self.assertEqual(data["ads"]["min_level"], 4)
        self.assertEqual((data["ads"]["min_days"], data["ads"]["max_days"]), (2, 14))
        self.assertEqual(
            data["ads"]["price_per_day"],
            {"line": "2", "banner": "0.8", "neon": "0.4", "facade_screen": "3"},
        )
        self.assertEqual(data["visit"], {"reward_ton": "0.02", "commission_bp": 2500, "commission_percent": "25"})

        over = await self.client.get(
            "/api/v1/deposits/tx-payload",
            params={"amount": "10000.1"},
            headers={"X-Telegram-Init-Data": f"dev:{next(_TG)}"},
        )
        self.assertEqual(over.status_code, 400)
        self.assertIn("10000", data["deposit"]["max_ton"])

    async def test_stake_follows_the_one_function(self):
        with mock.patch("app.services.help_facts.stake_nano", return_value=200_000_000):
            r = await self._get(next(_TG))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["arena"]["stake_ton"], "0.2")
        self._assert_clean(r.text, r.json())
