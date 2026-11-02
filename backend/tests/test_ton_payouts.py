"""Выплаты TON: payload для TON Connect, подтверждение по исходящим транзакциям (фейковый toncenter),
запасной путь по хешу, блок второго payload, отклонение с возвратом, API Кассы, история.

SQLite в памяти, без сети. Запуск из backend: python -m unittest tests.test_ton_payouts
"""

import base64
import json
import logging
import time
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import mock

import httpx
from pytoniq_core import Cell
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 — регистрирует таблицы
import app.services.ton_deposits as td
from app.core.config import settings
from app.db.base import Base
from app.models.balance import BalanceHistory
from app.models.economy import EconomySetting
from app.models.user import User
from app.models.withdraw import WithdrawRequest
from app.services import balance_history as bh
from app.services import ton_payouts as tp
from app.services import withdraw as w_svc
from app.services.economy_admin import EconomyAdminError, _normalize_ton_payouts
from app.services.ton_wallet import normalize_address
from tests.test_ton_deposits import FakeToncenter

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
warnings.filterwarnings("ignore", category=DeprecationWarning)
logging.getLogger("app.services.ton_payouts").setLevel(logging.CRITICAL)

D = Decimal
PAYOUT_RAW = "0:" + "ee" * 32
PAYOUT_UQ = normalize_address(PAYOUT_RAW)[1]
DEST_RAW = "0:" + "11" * 32
DEST_UQ = normalize_address(DEST_RAW)[1]
OTHER_RAW = "0:" + "22" * 32
OWNER_TG, ADMIN_TG, USER_TG, USER2_TG = 900, 901, 1, 2


def h(lt: int) -> str:
    return base64.b64encode(lt.to_bytes(32, "big")).decode()


def hexh(lt: int) -> str:
    return lt.to_bytes(32, "big").hex()


def out_tx(lt, nano, comment, dest=DEST_UQ, *, utime=None):
    """Исходящая транзакция кошелька выплат: внешнее входящее + одно исходящее сообщение."""
    return {
        "@type": "raw.transaction",
        "utime": utime or int(time.time()) + lt,
        "transaction_id": {"lt": str(lt), "hash": h(lt)},
        "in_msg": {"source": "", "destination": PAYOUT_UQ, "value": "0", "message": "", "msg_data": {"@type": "msg.dataRaw"}},
        "out_msgs": [{
            "source": PAYOUT_UQ, "destination": dest, "value": str(nano), "message": comment,
            "msg_data": {"@type": "msg.dataText"},
        }],
    }


class Base_(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite://")
        async with self.engine.begin() as c:
            await c.run_sync(Base.metadata.create_all)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.S() as s:
            s.add(EconomySetting(key="ton_payouts", value_json=json.dumps({"enabled": True, "payout_wallet": PAYOUT_UQ})))
            s.add(EconomySetting(key="ton_wallet", value_json=json.dumps({"network": "testnet"})))
            s.add(EconomySetting(key="min_withdraw_ton", value_json=json.dumps({"ton": "0.1"})))
            s.add_all([
                User(telegram_id=OWNER_TG, balance=D("0")),
                User(telegram_id=ADMIN_TG, balance=D("0"), is_admin=True),
                User(telegram_id=USER_TG, balance=D("5"), username="vasya"),
                User(telegram_id=USER2_TG, balance=D("5")),
            ])
            await s.commit()
        self.fake = FakeToncenter()
        for p in (mock.patch.object(td, "_fetch_transactions", self.fake),
                  mock.patch.object(settings, "telegram_owner_ids", str(OWNER_TG))):
            p.start()
            self.addCleanup(p.stop)
        self.addAsyncCleanup(self.engine.dispose)

    async def user(self, s, tg):
        return await s.scalar(select(User).where(User.telegram_id == tg))

    async def create(self, tg=USER_TG, amount="1.25", wallet=DEST_UQ) -> int:
        async with self.S() as s:
            v = await w_svc.create_request(s, user=await self.user(s, tg), amount=D(amount), wallet_address=wallet)
            await s.commit()
            return v.id

    async def req(self, rid) -> WithdrawRequest:
        async with self.S() as s:
            return await s.get(WithdrawRequest, rid)

    async def payload(self, rid, tg=OWNER_TG, **kw):
        async with self.S() as s:
            try:
                return await tp.issue_payload(s, actor=await self.user(s, tg), request_id=rid, **kw)
            finally:
                await s.commit()

    async def balance(self, tg):
        async with self.S() as s:
            return D((await self.user(s, tg)).balance)


class PayloadTests(Base_):
    async def test_payload_moves_to_sending(self):
        rid = await self.create()
        p = await self.payload(rid)
        self.assertEqual(p["amount_nano"], "1250000000")
        self.assertEqual(normalize_address(p["to"])[0], DEST_RAW)
        self.assertEqual(p["comment"], f"TN payout #{rid}")
        self.assertEqual(p["payout_wallet_raw"], PAYOUT_RAW)
        self.assertEqual(p["network"], "testnet")
        sl = Cell.one_from_boc(base64.b64decode(p["payload"])).begin_parse()
        self.assertEqual((sl.load_uint(32), sl.load_snake_string()), (0, f"TN payout #{rid}"))
        r = await self.req(rid)
        self.assertEqual(r.status, "sending")
        self.assertIsNotNone(r.payout_started_at)

    async def test_second_payload_blocked_until_timeout_or_owner_override(self):
        rid = await self.create()
        await self.payload(rid)
        with self.assertRaises(tp.PayoutError) as e:
            await self.payload(rid)
        self.assertEqual(e.exception.status, 409)
        with self.assertRaises(tp.PayoutError) as e:  # админ не может форсировать
            await self.payload(rid, tg=ADMIN_TG, force=True)
        self.assertEqual(e.exception.status, 403)
        self.assertEqual((await self.payload(rid, force=True))["id"], rid)  # явное решение владельца
        # окно истекло: повторный payload только после проверки сети
        later = datetime.now(timezone.utc) + tp.INFLIGHT + timedelta(seconds=5)
        self.assertEqual((await self.payload(rid, now=later))["id"], rid)
        self.fake.fail = True
        with self.assertRaises(tp.PayoutError) as e:
            await self.payload(rid, now=later + tp.INFLIGHT * 2)
        self.assertEqual(e.exception.status, 503)

    async def test_reissue_after_timeout_finds_landed_transfer(self):
        rid = await self.create()
        await self.payload(rid)
        self.fake.txs.append(out_tx(10, 1_250_000_000, f"TN payout #{rid}"))
        later = datetime.now(timezone.utc) + tp.INFLIGHT + timedelta(seconds=5)
        with self.assertRaises(tp.PayoutError) as e:
            await self.payload(rid, now=later)
        self.assertEqual(e.exception.status, 409)
        self.assertEqual((await self.req(rid)).status, "paid")

    async def test_permissions_and_config(self):
        rid = await self.create()
        with self.assertRaises(tp.PayoutError) as e:
            await self.payload(rid, tg=USER2_TG)
        self.assertEqual(e.exception.status, 403)
        self.assertEqual((await self.payload(rid, tg=ADMIN_TG))["id"], rid)  # админ платит, но не форсирует
        async with self.S() as s:
            row = await s.scalar(select(EconomySetting).where(EconomySetting.key == "ton_payouts"))
            row.value_json = json.dumps({"enabled": False, "payout_wallet": PAYOUT_UQ})
            await s.commit()
        rid2 = await self.create(tg=USER2_TG)
        with self.assertRaises(tp.PayoutError) as e:
            await self.payload(rid2)
        self.assertIn("Выплаты TON", e.exception.message)

    async def test_open_request_blocks_new_one(self):
        rid = await self.create()
        await self.payload(rid)
        with self.assertRaises(w_svc.WithdrawStateError):
            await self.create()


class ConfirmTests(Base_):
    async def test_match_marks_paid_once(self):
        rid = await self.create()
        await self.payload(rid)
        self.fake.txs.append(out_tx(10, 1_250_000_000, f"TN payout #{rid}"))
        self.assertEqual(await tp.poll_once(self.S), 1)
        r = await self.req(rid)
        self.assertEqual((r.status, r.tx_hash), ("paid", hexh(10)))
        self.assertIsNotNone(r.paid_at)
        self.assertEqual(await tp.poll_once(self.S), 0)  # идемпотентно
        self.assertEqual(await self.balance(USER_TG), D("3.75"))  # холд не возвращён

    async def test_wrong_amount_or_destination_not_paid(self):
        rid = await self.create()
        await self.payload(rid)
        self.fake.txs.append(out_tx(10, 1_200_000_000, f"TN payout #{rid}"))
        self.fake.txs.append(out_tx(11, 1_250_000_000, f"TN payout #{rid}", dest=normalize_address(OTHER_RAW)[1]))
        self.fake.txs.append(out_tx(12, 1_250_000_000, "TN payout #999"))
        self.fake.txs.append(out_tx(13, 1_250_000_000, f"TN payout #{rid} спасибо"))
        self.assertEqual(await tp.poll_once(self.S), 0)
        r = await self.req(rid)
        self.assertEqual((r.status, r.tx_hash), ("sending", None))

    async def test_duplicate_transfer_closes_one_request(self):
        """Один перевод не закрывает две заявки: ни по комментарию, ни по хешу."""
        r1 = await self.create()
        r2 = await self.create(tg=USER2_TG)
        await self.payload(r1)
        await self.payload(r2)
        self.fake.txs.append(out_tx(10, 1_250_000_000, f"TN payout #{r1}"))
        self.fake.txs.append(out_tx(11, 1_250_000_000, f"TN payout #{r1}"))  # повтор той же выплаты
        self.assertEqual(await tp.poll_once(self.S), 1)
        self.assertEqual((await self.req(r1)).tx_hash, hexh(10))
        self.assertEqual((await self.req(r2)).status, "sending")
        async with self.S() as s:
            with self.assertRaises(tp.PayoutError) as e:
                await tp.verify_hash(s, actor=await self.user(s, OWNER_TG), request_id=r2, tx_hash=hexh(10))
        self.assertEqual(e.exception.status, 409)

    async def test_network_error_changes_nothing(self):
        rid = await self.create()
        await self.payload(rid)
        self.fake.fail = True
        self.assertEqual(await tp.poll_once(self.S), 0)
        self.assertEqual((await self.req(rid)).status, "sending")

    async def test_nothing_sending_no_network(self):
        await self.create()
        self.assertEqual(await tp.poll_once(self.S), 0)
        self.assertEqual(self.fake.calls, [])


class HashFallbackTests(Base_):
    async def verify(self, rid, value, tg=OWNER_TG):
        async with self.S() as s:
            r = await tp.verify_hash(s, actor=await self.user(s, tg), request_id=rid, tx_hash=value)
            await s.commit()
            return r

    async def test_valid_hash_without_comment(self):
        rid = await self.create()
        self.fake.txs.append(out_tx(20, 1_250_000_000, ""))
        r = await self.verify(rid, h(20))  # base64 как в toncenter
        self.assertEqual((r.status, r.tx_hash), ("paid", hexh(20)))
        self.assertIn("хешу", r.admin_note)
        r = await self.verify(rid, f"https://testnet.tonviewer.com/transaction/{hexh(20)}")  # повтор — без ошибки
        self.assertEqual(r.status, "paid")

    async def test_invalid_hashes(self):
        rid = await self.create()
        self.fake.txs.append(out_tx(20, 1_000_000_000, ""))  # другая сумма
        self.fake.txs.append(out_tx(21, 1_250_000_000, "", dest=normalize_address(OTHER_RAW)[1]))
        self.fake.txs.append(out_tx(22, 1_250_000_000, "TN payout #777"))  # для другой заявки
        for value, needle in ((hexh(20), "сумма"), (hexh(21), "адрес"), (hexh(22), "другой заявки"),
                              (hexh(99), "не найдена"), ("not-a-hash!!", "Хеш")):
            with self.assertRaises(tp.PayoutError, msg=value) as e:
                await self.verify(rid, value)
            self.assertIn(needle, e.exception.message)
        self.assertEqual((await self.req(rid)).status, "pending")
        with self.assertRaises(tp.PayoutError) as e:
            await self.verify(rid, hexh(20), tg=USER2_TG)
        self.assertEqual(e.exception.status, 403)


class RejectAndUnverifiedTests(Base_):
    async def reject(self, rid, now=None):
        async with self.S() as s:
            try:  # как API: фиксируем и при ошибке — проверка сети могла закрыть заявку
                return await tp.reject(s, actor=await self.user(s, ADMIN_TG), request_id=rid, note="нет", now=now)
            finally:
                await s.commit()

    async def test_reject_refunds(self):
        rid = await self.create()
        self.assertEqual(await self.balance(USER_TG), D("3.75"))
        await self.reject(rid)
        self.assertEqual(((await self.req(rid)).status, await self.balance(USER_TG)), ("rejected", D("5")))

    async def test_reject_sending_waits_and_checks_chain(self):
        rid = await self.create()
        await self.payload(rid)
        with self.assertRaises(tp.PayoutError) as e:
            await self.reject(rid)
        self.assertEqual(e.exception.status, 409)
        later = datetime.now(timezone.utc) + tp.INFLIGHT + timedelta(seconds=5)
        self.fake.txs.append(out_tx(30, 1_250_000_000, f"TN payout #{rid}"))
        with self.assertRaises(tp.PayoutError):
            await self.reject(rid, now=later)  # перевод нашёлся — заявка выплачена, возврата нет
        self.assertEqual(((await self.req(rid)).status, await self.balance(USER_TG)), ("paid", D("3.75")))

    async def test_reject_sending_after_timeout_without_transfer(self):
        rid = await self.create()
        await self.payload(rid)
        await self.reject(rid, now=datetime.now(timezone.utc) + tp.INFLIGHT + timedelta(seconds=5))
        self.assertEqual(((await self.req(rid)).status, await self.balance(USER_TG)), ("rejected", D("5")))
        async with self.S() as s:
            refunds = await s.scalar(select(func.count()).select_from(BalanceHistory).where(
                BalanceHistory.reference_id == rid, BalanceHistory.operation_type == "credit"))
        self.assertEqual(refunds, 1)


class ApiTests(Base_):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        from app.api.deps import get_current_user
        from app.db.session import get_db
        from app.main import app

        async def _db():
            async with self.S() as s:
                yield s

        async def _user():
            async with self.S() as s:
                return await self.user(s, self.tg)

        self.tg = OWNER_TG
        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = _user
        self.addCleanup(app.dependency_overrides.clear)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def test_kassa_flow(self):
        rid = await self.create()
        r = await self.client.get("/api/v1/withdraw/payout-config")
        self.assertEqual(r.json()["payout_wallet_raw"], PAYOUT_RAW)
        r = await self.client.get("/api/v1/withdraw/pending")
        row = r.json()[0]
        self.assertEqual((row["username"], row["user_telegram_id"], row["status"]), ("vasya", USER_TG, "pending"))
        r = await self.client.get(f"/api/v1/withdraw/{rid}/tx-payload")
        self.assertEqual(r.status_code, 200, r.text)
        r = await self.client.get(f"/api/v1/withdraw/{rid}/tx-payload")
        self.assertEqual(r.status_code, 409)
        self.assertEqual((await self.client.get("/api/v1/withdraw/pending")).json()[0]["status"], "sending")
        self.fake.txs.append(out_tx(10, 1_250_000_000, f"TN payout #{rid}"))
        r = await self.client.post(f"/api/v1/withdraw/{rid}/check")
        self.assertEqual((r.json()["status"], r.json()["tx_hash"]), ("paid", hexh(10)))
        self.assertEqual((await self.client.get("/api/v1/withdraw/pending")).json(), [])
        # история пользователя: статус и ссылка на tonviewer
        async with self.S() as s:
            page = await bh.history(s, user_id=(await self.user(s, USER_TG)).id)
        item = next(i for i in page.items if i["kind"] == "withdraw")
        self.assertEqual(item["status_label"], "выплачено")
        self.assertEqual(item["tx_url"], f"https://testnet.tonviewer.com/transaction/{hexh(10)}")

    async def test_review_paths(self):
        rid = await self.create()
        r = await self.client.post(f"/api/v1/withdraw/{rid}/review", json={"approve": True, "note": "x"})
        self.assertEqual(r.status_code, 400)  # старый путь «Выплачено» без доказательства закрыт
        self.tg = ADMIN_TG
        r = await self.client.post(f"/api/v1/withdraw/{rid}/review", json={"approve": True, "unverified": True, "note": "x"})
        self.assertEqual(r.status_code, 403)
        self.tg = OWNER_TG
        r = await self.client.post(f"/api/v1/withdraw/{rid}/review", json={"approve": True, "unverified": True})
        self.assertEqual(r.status_code, 400)  # без заметки нельзя
        r = await self.client.post(f"/api/v1/withdraw/{rid}/review", json={"approve": True, "unverified": True, "note": "перевёл с биржи"})
        self.assertEqual((r.status_code, r.json()["status"]), (200, "paid"))
        self.assertTrue(r.json()["admin_note"].startswith("Без проверки"))
        rid2 = await self.create(tg=USER2_TG)
        r = await self.client.post(f"/api/v1/withdraw/{rid2}/review", json={"approve": False, "note": "нет"})
        self.assertEqual(r.json()["status"], "rejected")
        self.assertEqual(await self.balance(USER2_TG), D("5"))

    async def test_user_cannot_touch_payouts(self):
        rid = await self.create()
        self.tg = USER2_TG
        for method, url in (("GET", "/payout-config"), ("GET", f"/{rid}/tx-payload"), ("POST", f"/{rid}/check")):
            r = await self.client.request(method, "/api/v1/withdraw" + url)
            self.assertEqual(r.status_code, 403, url)
        r = await self.client.post(f"/api/v1/withdraw/{rid}/verify-hash", json={"tx_hash": hexh(1)})
        self.assertEqual(r.status_code, 403)


class SettingsTests(unittest.TestCase):
    def test_normalize(self):
        out = _normalize_ton_payouts({"enabled": 1, "payout_wallet": PAYOUT_RAW, "network": "testnet"})
        self.assertEqual(out, {"enabled": True, "payout_wallet": PAYOUT_UQ})
        self.assertEqual(_normalize_ton_payouts({"payout_wallet": ""}), {"enabled": False, "payout_wallet": ""})
        for bad in ({"enabled": True, "payout_wallet": ""}, {"payout_wallet": "nope"}, []):
            with self.assertRaises(EconomyAdminError):
                _normalize_ton_payouts(bad)

    def test_in_catalog_and_defaults(self):
        from app.services.economy_admin import SETTING_CATALOG
        from app.services.economy_seed import DEFAULTS

        self.assertIn({"key": "ton_payouts", "group": "ton", "label": "Выплаты TON"}, SETTING_CATALOG)
        self.assertEqual(DEFAULTS["ton_payouts"][0], {"enabled": False, "payout_wallet": ""})
