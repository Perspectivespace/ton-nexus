"""Пополнения TON: мемо, опрос toncenter v2 (фейковый), зачисление, курсор, API, запуск приложения.

SQLite в памяти, без сети. Запуск из backend: python -m unittest tests.test_ton_deposits
"""

import asyncio
import base64
import json
import logging
import unittest
import warnings
from decimal import Decimal
from unittest import mock

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 — регистрирует таблицы
import app.services.ton_deposits as td
from app.db.base import Base
from app.models.balance import BalanceHistory
from app.models.deposit import ChainCursor, TonDeposit
from app.models.economy import EconomySetting
from app.models.user import User
from app.services.economy_admin import EconomyAdminError, _normalize_ton_deposits
from app.services.ton_wallet import normalize_address

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
warnings.filterwarnings("ignore", category=DeprecationWarning)
logging.getLogger("app.services.ton_deposits").setLevel(logging.CRITICAL)

D = Decimal
RAW = "0:" + "ab" * 32
UQ = normalize_address(RAW)[1]
SRC = "0:" + "cd" * 32
MEMO1, MEMO2 = "TNABC234", "TNXYZ789"


def h(lt: int) -> str:
    """base64-хеш как у toncenter v2."""
    return base64.b64encode(lt.to_bytes(32, "big")).decode()


def tx(lt, nano, comment="", *, bounced=False, out_msgs=None, source=SRC, data_type="msg.dataText"):
    return {
        "@type": "raw.transaction",
        "utime": 1_700_000_000 + lt,
        "transaction_id": {"lt": str(lt), "hash": h(lt)},
        "in_msg": {
            "source": source,
            "destination": UQ,
            "value": str(nano),
            "message": comment,
            "bounced": bounced,
            "msg_data": {"@type": data_type},
        },
        "out_msgs": out_msgs or [],
    }


class FakeToncenter:
    """toncenter v2 getTransactions: новые сверху; lt+hash — начать с этой транзакции (включительно) и назад."""

    def __init__(self):
        self.txs: list[dict] = []
        self.calls: list[dict] = []
        self.fail = False

    async def __call__(self, address, network, *, limit=100, lt=None, tx_hash=None):
        self.calls.append({"address": address, "network": network, "limit": limit, "lt": lt, "hash": tx_hash})
        if self.fail:
            raise td.ToncenterError("down")
        items = sorted(self.txs, key=lambda t: -int(t["transaction_id"]["lt"]))
        if lt is not None:
            idx = next(i for i, t in enumerate(items) if int(t["transaction_id"]["lt"]) == lt and t["transaction_id"]["hash"] == tx_hash)
            items = items[idx:]
        return items[: min(limit, 100)]


class Base_(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite://")
        async with self.engine.begin() as c:
            await c.run_sync(Base.metadata.create_all)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.S() as s:
            s.add(EconomySetting(key="ton_deposits", value_json=json.dumps(
                {"enabled": True, "project_address": UQ, "min_ton": "0.1", "poll_seconds": 15})))
            s.add(EconomySetting(key="ton_wallet", value_json=json.dumps({"network": "testnet"})))
            s.add_all([User(telegram_id=1, balance=D("0"), deposit_memo=MEMO1),
                       User(telegram_id=2, balance=D("0"), deposit_memo=MEMO2)])
            await s.commit()
        self.fake = FakeToncenter()
        p = mock.patch.object(td, "_fetch_transactions", self.fake)
        p.start()
        self.addAsyncCleanup(self._cleanup)
        self.addCleanup(p.stop)

    async def _cleanup(self):
        await self.engine.dispose()

    async def balance(self, tg):
        async with self.S() as s:
            return (await s.scalar(select(User).where(User.telegram_id == tg))).balance

    async def deposits(self):
        async with self.S() as s:
            return {d.lt: d for d in (await s.scalars(select(TonDeposit))).all()}

    async def cursor(self):
        async with self.S() as s:
            return await s.scalar(select(ChainCursor))

    async def start(self, *existing):
        """Первый опрос: курсор на самую новую транзакцию, старая история не зачисляется."""
        self.fake.txs.extend(existing)
        self.assertEqual(await td.poll_once(self.S), 0)


class MemoTests(unittest.TestCase):
    def test_generate_format(self):
        for _ in range(50):
            m = td._generate_memo()
            self.assertRegex(m, r"^TN[0-9A-HJKMNP-TV-Z]{6}$")
            self.assertEqual(td._normalize_memo(m), m)

    def test_exact_with_boundaries(self):
        self.assertEqual(td._normalize_memo("TNXYZ789 thanks"), "TNXYZ789")
        self.assertEqual(td._normalize_memo("за игру: TNABC234!"), "TNABC234")
        self.assertEqual(td._normalize_memo("TNABC234спасибо"), "TNABC234")
        self.assertIsNone(td._normalize_memo("TNABC2345"))
        self.assertIsNone(td._normalize_memo("XTNABC234"))
        self.assertIsNone(td._normalize_memo("TNABC23"))
        self.assertIsNone(td._normalize_memo("hello"))
        self.assertIsNone(td._normalize_memo(""))
        self.assertIsNone(td._normalize_memo(None))

    def test_case_spaces_and_confusables(self):
        self.assertEqual(td._normalize_memo("tn abc 234"), "TNABC234")
        self.assertEqual(td._normalize_memo("  tnabc234  "), "TNABC234")
        self.assertEqual(td._normalize_memo("pay TN0I1LO0 extra"), "TN011100")


class PollTests(Base_):
    async def test_first_run_sets_cursor_without_crediting_history(self):
        await self.start(tx(100, 5 * 10**9, MEMO1))
        c = await self.cursor()
        self.assertEqual((c.lt, c.key, c.last_hash), (100, RAW, (100).to_bytes(32, "big").hex()))
        self.assertEqual(self.fake.calls[0]["network"], "testnet")
        self.assertEqual(await self.balance(1), D("0"))
        self.assertEqual(await self.deposits(), {})

    async def test_credit(self):
        await self.start(tx(100, 10**9, "old"))
        self.fake.txs.append(tx(200, 1_500_000_000, "tn abc 234"))
        self.assertEqual(await td.poll_once(self.S), 1)
        self.assertEqual(await self.balance(1), D("1.5"))
        d = (await self.deposits())[200]
        self.assertEqual((d.status, d.memo, d.from_address, d.amount_nano), ("credited", MEMO1, SRC, 1_500_000_000))
        self.assertEqual(d.tx_hash, (200).to_bytes(32, "big").hex())
        async with self.S() as s:
            row = await s.scalar(select(BalanceHistory).where(BalanceHistory.reference_type == "ton_deposit"))
            self.assertEqual((row.balance_type, row.reference_id, row.amount), ("ton_deposit", d.id, D("1.5")))
        self.assertEqual((await self.cursor()).lt, 200)

    async def test_duplicate_tx_credited_once(self):
        await self.start()
        self.fake.txs.append(tx(200, 10**9, MEMO1))
        await td.poll_once(self.S)
        async with self.S() as s:  # курсор откатили назад — та же транзакция приходит ещё раз
            (await s.scalar(select(ChainCursor))).lt = 0
            await s.commit()
        self.assertEqual(await td.poll_once(self.S), 0)
        self.assertEqual(await td.poll_once(self.S), 0)
        self.assertEqual(await self.balance(1), D("1"))
        self.assertEqual(len(await self.deposits()), 1)

    async def test_wrong_memo_unmatched(self):
        await self.start()
        self.fake.txs += [tx(201, 10**9, "TNZZZZZZ"), tx(202, 10**9, "привет"), tx(203, 10**9, "TNABC2345")]
        self.assertEqual(await td.poll_once(self.S), 3)
        deps = await self.deposits()
        self.assertEqual({deps[k].status for k in (201, 202, 203)}, {"unmatched"})
        self.assertIsNone(deps[201].user_id)
        self.assertEqual(await self.balance(1), D("0"))

    async def test_below_minimum(self):
        await self.start()
        self.fake.txs.append(tx(200, 50_000_000, MEMO1))
        await td.poll_once(self.S)
        d = (await self.deposits())[200]
        self.assertEqual((d.status, d.amount_ton), ("below_min", D("0.05")))
        self.assertIsNotNone(d.user_id)
        self.assertEqual(await self.balance(1), D("0"))

    async def test_bounced_and_non_transfers_not_credited(self):
        await self.start()
        self.fake.txs += [
            tx(201, 2 * 10**9, MEMO1, bounced=True),
            tx(202, 2 * 10**9, MEMO1, out_msgs=[{"destination": SRC, "value": "1999000000"}]),  # отскок обратно
            tx(203, 0, MEMO1),
            tx(204, 10**9, "", source=""),  # наш исходящий перевод (external)
            tx(205, 10**9, MEMO1, data_type="msg.dataEncryptedText"),
        ]
        await td.poll_once(self.S)
        deps = await self.deposits()
        self.assertEqual(deps[201].status, "ignored")
        self.assertEqual(deps[202].status, "ignored")
        self.assertNotIn(203, deps)
        self.assertNotIn(204, deps)
        self.assertEqual(deps[205].status, "unmatched")
        self.assertEqual(await self.balance(1), D("0"))
        self.assertEqual((await self.cursor()).lt, 205)

    async def test_empty_first_response_keeps_first_deposit(self):
        await self.start()  # пустой кошелёк
        self.assertEqual((await self.cursor()).lt, 0)
        self.fake.txs.append(tx(100, 10**9, MEMO1))
        self.assertEqual(await td.poll_once(self.S), 1)
        self.assertEqual(await self.balance(1), D("1"))

    async def test_network_error_is_not_first_run(self):
        self.fake.fail = True
        self.assertEqual(await td.poll_once(self.S), 0)
        self.assertIsNone(await self.cursor())
        self.fake.fail = False
        self.fake.txs.append(tx(100, 10**9, MEMO1))
        await td.poll_once(self.S)  # настоящий первый запуск
        self.assertEqual((await self.cursor()).lt, 100)
        self.fake.txs.append(tx(200, 10**9, MEMO1))
        self.fake.fail = True
        self.assertEqual(await td.poll_once(self.S), 0)
        self.assertEqual((await self.cursor()).lt, 100)  # ошибка не двигает курсор
        self.fake.fail = False
        self.assertEqual(await td.poll_once(self.S), 1)
        self.assertEqual(await self.balance(1), D("1"))

    async def test_mid_batch_error_loses_nothing(self):
        await self.start()
        self.fake.txs += [tx(300, 10**9, MEMO1), tx(301, 2 * 10**9, MEMO1), tx(302, 4 * 10**9, MEMO2)]
        orig = td.credit_deposit

        async def flaky(session, **kw):
            if kw["lt"] == 301:
                await orig(session, **kw)  # запись и начисление уже в сессии — savepoint должен их откатить
                raise RuntimeError("boom")
            return await orig(session, **kw)

        with mock.patch.object(td, "credit_deposit", flaky):
            self.assertEqual(await td.poll_once(self.S), 1)
        self.assertEqual((await self.cursor()).lt, 300)
        self.assertEqual(sorted(await self.deposits()), [300])
        self.assertEqual(await self.balance(1), D("1"))
        self.assertEqual(await td.poll_once(self.S), 2)  # следующий опрос добирает 301 и 302
        self.assertEqual(await self.balance(1), D("3"))
        self.assertEqual(await self.balance(2), D("4"))
        self.assertEqual((await self.cursor()).lt, 302)

    async def test_pagination_over_100(self):
        await self.start(tx(10, 10**9, "old"))
        self.fake.txs += [tx(1000 + i, 10**9, MEMO1) for i in range(250)]
        self.fake.calls.clear()
        self.assertEqual(await td.poll_once(self.S), 250)
        self.assertEqual(await self.balance(1), D("250"))
        self.assertEqual((await self.cursor()).lt, 1249)
        self.assertEqual(len(self.fake.calls), 3)
        self.assertEqual((self.fake.calls[0]["lt"], self.fake.calls[0]["hash"]), (None, None))
        last_of_page1 = 1249 - 99
        self.assertEqual((self.fake.calls[1]["lt"], self.fake.calls[1]["hash"]), (last_of_page1, h(last_of_page1)))
        self.assertEqual(len(await self.deposits()), 250)

    async def test_disabled_does_nothing(self):
        async with self.S() as s:
            row = await s.scalar(select(EconomySetting).where(EconomySetting.key == "ton_deposits"))
            row.value_json = json.dumps({"enabled": False, "project_address": UQ, "min_ton": "0.1"})
            await s.commit()
        self.assertEqual(await td.poll_once(self.S), 0)
        self.assertEqual(self.fake.calls, [])

    async def test_assign_manual(self):
        await self.start()
        self.fake.txs += [tx(200, 10**9, "no memo"), tx(201, 10**9, MEMO1)]
        await td.poll_once(self.S)
        deps = await self.deposits()
        async with self.S() as s:
            actor = await s.scalar(select(User).where(User.telegram_id == 1))
            target = await s.scalar(select(User).where(User.telegram_id == 2))
            await td.assign_manual(s, deposit_id=deps[200].id, user_id=target.id, actor=actor, note="чек")
            await s.commit()
            with self.assertRaises(td.DepositError):
                await td.assign_manual(s, deposit_id=deps[200].id, user_id=target.id, actor=actor)
            with self.assertRaises(td.DepositError):
                await td.assign_manual(s, deposit_id=deps[201].id, user_id=target.id, actor=actor)
        self.assertEqual(await self.balance(2), D("1"))
        self.assertEqual((await self.deposits())[200].status, "manual")


class FetchTests(unittest.IsolatedAsyncioTestCase):
    """_fetch_transactions: параметры v2, ключ в заголовке, ошибка — исключение, а не пустой список."""

    async def run_with(self, handler, **kw):
        real = httpx.AsyncClient
        with mock.patch.object(td.httpx, "AsyncClient", lambda **a: real(transport=httpx.MockTransport(handler), **a)), \
             mock.patch.object(td.app_settings, "toncenter_api_key", "k"):
            return await td._fetch_transactions(RAW, "testnet", **kw)

    async def test_params_and_header(self):
        seen = {}

        def handler(req):
            seen["url"], seen["key"] = req.url, req.headers.get("X-API-Key")
            return httpx.Response(200, json={"ok": True, "result": [tx(5, 1)]})

        res = await self.run_with(handler, lt=5, tx_hash=h(5))
        self.assertEqual(len(res), 1)
        self.assertEqual(seen["url"].host, "testnet.toncenter.com")
        self.assertEqual(seen["url"].params["lt"], "5")
        self.assertEqual(seen["url"].params["hash"], h(5))
        self.assertNotIn("api_key", seen["url"].params)
        self.assertEqual(seen["key"], "k")

    async def test_errors_raise(self):
        for resp in (httpx.Response(500), httpx.Response(200, json={"ok": False, "error": "rate limit"}),
                     httpx.Response(200, text="not json")):
            with self.assertRaises(td.ToncenterError):
                await self.run_with(lambda req, r=resp: r)


class SettingsTests(unittest.TestCase):
    def test_address_normalized_to_one_form(self):
        a = _normalize_ton_deposits({"enabled": True, "project_address": RAW, "min_ton": "0.1", "poll_seconds": 15})
        b = _normalize_ton_deposits({"enabled": True, "project_address": " " + UQ, "min_ton": "0.1", "poll_seconds": 15})
        self.assertEqual(a["project_address"], UQ)
        self.assertEqual(b["project_address"], UQ)

    def test_rejects_bad_values(self):
        base = {"enabled": False, "project_address": "", "min_ton": "0.1", "poll_seconds": 15}
        for patch in ({"project_address": "xyz"}, {"enabled": True}, {"min_ton": "0"}, {"min_ton": "abc"},
                      {"poll_seconds": 2}, {"poll_seconds": 500}):
            with self.assertRaises(EconomyAdminError, msg=str(patch)):
                _normalize_ton_deposits({**base, **patch})


class ApiAndStartupTests(Base_):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        from app.api.deps import get_current_user
        from app.db.session import get_db
        from app.main import app

        self.app = app

        async def _db():
            async with self.S() as s:
                yield s

        async def _user():
            async with self.S() as s:
                return await s.scalar(select(User).where(User.telegram_id == self.tg))

        self.tg = 1
        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = _user
        self.addCleanup(app.dependency_overrides.clear)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def test_info_and_tx_payload(self):
        r = await self.client.get("/api/v1/deposits/info")
        self.assertEqual(r.status_code, 200, r.text)
        j = r.json()
        self.assertEqual((j["memo"], j["network"], j["enabled"]), (MEMO1, "testnet", True))
        self.assertEqual(normalize_address(j["project_address"])[0], RAW)
        for bad in ("abc", "0", "-1", "NaN", "Infinity", "0.05", "10001", "1.0000000001"):
            r = await self.client.get("/api/v1/deposits/tx-payload", params={"amount": bad})
            self.assertEqual(r.status_code, 400, bad)
        r = await self.client.get("/api/v1/deposits/tx-payload", params={"amount": "1.5"})
        j = r.json()
        self.assertEqual(j["amount_nano"], "1500000000")
        from pytoniq_core import Cell
        sl = Cell.one_from_boc(base64.b64decode(j["payload"])).begin_parse()
        self.assertEqual(sl.load_uint(32), 0)
        self.assertEqual(sl.load_snake_string(), MEMO1)

    async def test_check_polls_rate_limited(self):
        await self.start()
        self.fake.txs.append(tx(200, 10**9, MEMO1))
        td._last_manual_poll = 0.0
        with mock.patch("app.api.deposits.SessionLocal", self.S):
            r = await self.client.post("/api/v1/deposits/check")
            self.assertEqual([d["status"] for d in r.json()], ["credited"])
            self.fake.txs.append(tx(201, 10**9, MEMO1))
            r = await self.client.post("/api/v1/deposits/check")  # сразу второй раз — без опроса
            self.assertEqual(len(r.json()), 1)

    async def test_admin_list_and_owner_assign(self):
        await self.start()
        self.fake.txs.append(tx(200, 10**9, "?"))
        await td.poll_once(self.S)
        with mock.patch("app.api.deposits.is_platform_owner", lambda u: u.telegram_id == 1), \
             mock.patch("app.api.deposits.is_admin", lambda u: u.telegram_id == 1):
            self.tg = 2
            self.assertEqual((await self.client.get("/api/v1/deposits")).status_code, 403)
            self.tg = 1
            lst = (await self.client.get("/api/v1/deposits")).json()
            self.assertEqual([d["status"] for d in lst], ["unmatched"])
            r = await self.client.post(f"/api/v1/deposits/{lst[0]['id']}/assign", json={"telegram_id": 2, "note": "x"})
            self.assertEqual(r.json()["status"], "manual", r.text)
            self.assertEqual((await self.client.get("/api/v1/deposits")).json(), [])
        self.assertEqual(await self.balance(2), D("1"))

    async def test_app_startup_runs_seed_and_poller(self):
        from starlette.testclient import TestClient

        import app.main as main

        polled = asyncio.Event()

        async def fake_poll(_factory):
            polled.set()
            return 0

        with mock.patch.object(main, "SessionLocal", self.S), mock.patch.object(main, "poll_once", fake_poll):
            await asyncio.to_thread(self._run_client, TestClient, main.app)
        async with self.S() as s:
            self.assertGreater(await s.scalar(select(func.count()).select_from(EconomySetting)), 2)

    @staticmethod
    def _run_client(TestClient, app):
        with TestClient(app) as c:
            assert c.get("/health").json()["status"] == "ok"
            assert c.get("/api/v1/deposits/info").status_code == 200


if __name__ == "__main__":
    unittest.main()
