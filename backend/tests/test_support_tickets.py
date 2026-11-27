"""Тикеты поддержки: миграция 032, приём, антиспам, пересылка в чат, список, счётчик, ответы бота."""

from __future__ import annotations

import importlib.util
import itertools
import json
import pathlib
import unittest
import warnings
from datetime import timedelta
from unittest import mock

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import Settings, settings
from app.db.base import Base
from app.models import SupportTicket, User
from app.services import support_tickets as svc

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
_TG = itertools.count(71000)
BOT = "test-bot-token-support"
CHAT = -1001999000111  # условный id закрытого чата, не настоящий

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 24
WEBP = b"RIFF" + b"\x20\x00\x00\x00" + b"WEBP" + b"\x00" * 20
FAKE_PNG = b"this-is-not-an-image"


def _load_migration():
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "032_support_tickets.py"
    spec = importlib.util.spec_from_file_location("m032", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ConfigTest(unittest.TestCase):
    def test_parses_empty_and_int(self):
        self.assertIsNone(Settings._parse_support_chat_id(None))
        self.assertIsNone(Settings._parse_support_chat_id(""))
        self.assertIsNone(Settings._parse_support_chat_id("   "))
        self.assertEqual(Settings._parse_support_chat_id(" -1001 "), -1001)
        self.assertEqual(Settings._parse_support_chat_id(-1001), -1001)


class MimeAndCardTest(unittest.TestCase):
    def test_detect_mime(self):
        self.assertEqual(svc.detect_mime(PNG), "image/png")
        self.assertEqual(svc.detect_mime(JPEG), "image/jpeg")
        self.assertEqual(svc.detect_mime(WEBP), "image/webp")
        self.assertIsNone(svc.detect_mime(FAKE_PNG))
        self.assertIsNone(svc.detect_mime(b""))

    def test_validate_rejects_mismatch_and_oversize(self):
        self.assertEqual(svc.validate_screenshot(PNG, "image/png"), "image/png")
        self.assertEqual(svc.validate_screenshot(JPEG, "image/jpg"), "image/jpeg")
        with self.assertRaises(svc.TicketError) as cm:
            svc.validate_screenshot(FAKE_PNG, "image/png")
        self.assertEqual(cm.exception.code, "bad_type")
        with self.assertRaises(svc.TicketError) as cm:
            svc.validate_screenshot(PNG, "image/jpeg")
        self.assertEqual(cm.exception.code, "type_mismatch")
        with self.assertRaises(svc.TicketError) as cm:
            svc.validate_screenshot(PNG + b"x" * (svc.MAX_BYTES), "image/png")
        self.assertEqual(cm.exception.code, "too_large")
        with self.assertRaises(svc.TicketError) as cm:
            svc.validate_screenshot(b"", "image/png")
        self.assertEqual(cm.exception.code, "empty_file")
        with self.assertRaises(svc.TicketError) as cm:
            svc.validate_screenshot(PNG, "image/gif")
        self.assertEqual(cm.exception.code, "bad_type")

    def test_message_and_category(self):
        self.assertEqual(svc.normalize_message("  hello  "), "hello")
        with self.assertRaises(svc.TicketError) as cm:
            svc.normalize_message("hey")
        self.assertEqual(cm.exception.code, "bad_message")
        with self.assertRaises(svc.TicketError) as cm:
            svc.normalize_message("x" * (svc.MAX_MESSAGE + 1))
        self.assertEqual(cm.exception.code, "bad_message")
        self.assertEqual(svc.normalize_category("BUG"), "bug")
        with self.assertRaises(svc.TicketError) as cm:
            svc.normalize_category("quest")
        self.assertEqual(cm.exception.code, "bad_category")

    def test_keyboard_and_caption(self):
        kb = svc.ticket_keyboard(42)
        row = kb["inline_keyboard"][0]
        self.assertEqual(row[0], {"text": "Ответить", "callback_data": "ticket:reply:42"})
        self.assertEqual(row[1], {"text": "Закрыть", "callback_data": "ticket:close:42"})
        user = User(telegram_id=7, username="ann", first_name="Anna", last_name="K", lang="en")
        ticket = SupportTicket(id=9, user_id=1, category="bug", message="x" * 1500)
        card = svc.format_card(ticket, user)
        self.assertIn("Тикет #9 · Баг", card)
        self.assertIn("@ann", card)
        self.assertIn("tg_id: 7", card)
        self.assertIn("Язык: en", card)
        self.assertGreater(len(card), svc.CAPTION_LIMIT)
        cap = svc.short_caption(ticket, user)
        self.assertLessEqual(len(cap), svc.CAPTION_LIMIT)
        self.assertIn("Тикет #9", cap)


class MigrationTest(unittest.TestCase):
    def test_032_upgrade_downgrade(self):
        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        mod = _load_migration()
        self.assertEqual((mod.revision, mod.down_revision), ("032", "031"))
        eng = sa.create_engine("sqlite://")
        with eng.begin() as conn:
            Base.metadata.create_all(conn, tables=[User.__table__])

        def apply(fn):
            with eng.begin() as conn:
                with mock.patch.object(mod, "op", Operations(MigrationContext.configure(conn))):
                    fn()

        apply(mod.upgrade)
        apply(mod.upgrade)
        insp = sa.inspect(eng)
        cols = {c["name"] for c in insp.get_columns("support_tickets")}
        self.assertTrue(
            {
                "id",
                "user_id",
                "category",
                "message",
                "has_screenshot",
                "status",
                "chat_id",
                "chat_message_id",
                "reply_text",
                "replied_by_tg_id",
                "replied_at",
                "created_at",
                "updated_at",
            }
            <= cols
        )
        indexes = {i["name"] for i in insp.get_indexes("support_tickets")}
        self.assertIn("ix_support_tickets_user_id", indexes)
        self.assertIn("ix_support_tickets_status", indexes)
        self.assertIn("ix_support_tickets_chat_message_id", indexes)
        apply(mod.downgrade)
        self.assertFalse(sa.inspect(eng).has_table("support_tickets"))
        apply(mod.downgrade)


class FakeTg:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return None

    async def post(self, url, json=None, data=None, files=None):
        FakeTg.calls.append({"url": url, "json": json, "data": data, "files": files})
        return FakeTg.Resp(1000 + len(FakeTg.calls))

    class Resp:
        def __init__(self, mid):
            self.status_code = 200
            self._mid = mid

        def json(self):
            return {"ok": True, "result": {"message_id": self._mid}}


class FailTg(FakeTg):
    async def post(self, url, json=None, data=None, files=None):
        FakeTg.calls.append({"url": url, "json": json, "data": data, "files": files})
        r = FakeTg.Resp(0)
        r.status_code = 403
        return r


class ApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.db.session import get_db
        from app.main import app

        FakeTg.calls = []
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
        self.patches = [
            mock.patch.object(settings, "debug", True),
            mock.patch.object(settings, "telegram_bot_token", BOT),
            mock.patch.object(settings, "support_chat_id", CHAT),
            mock.patch("app.services.tg_notify._async_client", FakeTg),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def user(self, **kw) -> int:
        tg = next(_TG)
        async with self.S() as s:
            s.add(User(telegram_id=tg, username=kw.pop("username", "player"), **kw))
            await s.commit()
        return tg

    @staticmethod
    def h(tg: int, **extra) -> dict:
        return {"X-Telegram-Init-Data": f"dev:{tg}", **extra}

    def bot_h(self, token: str | None = BOT) -> dict:
        return {"X-Bot-Token": token} if token is not None else {}

    async def post_ticket(self, tg, category="bug", message="Экран покупки не открывается", screenshot=None, ctype="image/png"):
        data = {"category": category, "message": message}
        files = None
        if screenshot is not None:
            files = {"screenshot": ("shot.png", screenshot, ctype)}
        return await self.client.post("/api/v1/support/tickets", headers=self.h(tg), data=data, files=files)

    async def test_create_text_only_forwards_message(self):
        tg = await self.user(first_name="Игорь", lang="ru")
        r = await self.post_ticket(tg)
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual((body["category"], body["status"], body["has_screenshot"]), ("bug", "open", False))
        self.assertIsInstance(body["id"], int)
        self.assertEqual(len(FakeTg.calls), 1)
        call = FakeTg.calls[0]
        self.assertTrue(call["url"].endswith("/sendMessage"))
        payload = call["json"]
        self.assertEqual(payload["chat_id"], CHAT)
        self.assertIn(f"Тикет #{body['id']} · Баг", payload["text"])
        self.assertIn(f"tg_id: {tg}", payload["text"])
        self.assertIn("Язык: ru", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0][0]["callback_data"],
            f"ticket:reply:{body['id']}",
        )
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0][1]["callback_data"],
            f"ticket:close:{body['id']}",
        )
        async with self.S() as s:
            row = await s.get(SupportTicket, body["id"])
            self.assertEqual((row.chat_id, row.chat_message_id), (CHAT, 1001))

    async def test_create_png_jpeg_webp_and_reject_bad_files(self):
        tg = await self.user()
        for data, ctype, ext in ((PNG, "image/png", "png"), (JPEG, "image/jpeg", "jpg"), (WEBP, "image/webp", "webp")):
            FakeTg.calls = []
            r = await self.post_ticket(tg, message=f"скрин {ext} здесь", screenshot=data, ctype=ctype)
            self.assertEqual(r.status_code, 201, r.text)
            self.assertTrue(r.json()["has_screenshot"])
            call = FakeTg.calls[0]
            self.assertTrue(call["url"].endswith("/sendPhoto"))
            self.assertEqual(call["data"]["chat_id"], str(CHAT))
            self.assertTrue(call["data"]["caption"].startswith("Тикет #"))
            markup = json.loads(call["data"]["reply_markup"])
            self.assertEqual(markup["inline_keyboard"][0][0]["callback_data"].startswith("ticket:reply:"), True)
            name, blob, mime = call["files"]["photo"]
            self.assertEqual((blob, mime), (data, ctype if ctype != "image/jpeg" else "image/jpeg"))
            self.assertTrue(name.endswith("." + ext))
            # антиспам: следующее сразу не отправим — двигаем created_at назад
            async with self.S() as s:
                row = await s.get(SupportTicket, r.json()["id"])
                row.created_at = svc.utcnow() - timedelta(minutes=5)
                await s.commit()

        r = await self.post_ticket(tg, message="поддельный png файл", screenshot=FAKE_PNG, ctype="image/png")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["detail"]["code"], "bad_type")

        r = await self.post_ticket(tg, message="заголовок не совпадает", screenshot=PNG, ctype="image/jpeg")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["detail"]["code"], "type_mismatch")

        big = PNG + b"A" * svc.MAX_BYTES
        r = await self.post_ticket(tg, message="слишком большой файл тут", screenshot=big, ctype="image/png")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["detail"]["code"], "too_large")

    async def test_long_message_sends_caption_and_followup(self):
        tg = await self.user()
        text = "Проблема с выводом. " * 80  # заведомо длиннее 1024 вместе с шапкой карточки
        self.assertGreater(len(text), 800)
        r = await self.post_ticket(tg, message=text, screenshot=PNG, ctype="image/png")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(len(FakeTg.calls), 2)
        self.assertTrue(FakeTg.calls[0]["url"].endswith("/sendPhoto"))
        cap = FakeTg.calls[0]["data"]["caption"]
        self.assertLessEqual(len(cap), 1024)
        self.assertIn("Текст во втором сообщении", cap)
        self.assertTrue(FakeTg.calls[1]["url"].endswith("/sendMessage"))
        self.assertIn(text.strip(), FakeTg.calls[1]["json"]["text"])

    async def test_validation_and_rate_limits(self):
        tg = await self.user()
        r = await self.post_ticket(tg, category="quest", message="это нормальный текст")
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (400, "bad_category"))
        r = await self.post_ticket(tg, message="нет")
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (400, "bad_message"))
        r = await self.post_ticket(tg, message="x" * 2001)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (400, "bad_message"))

        r = await self.post_ticket(tg)
        self.assertEqual(r.status_code, 201, r.text)
        r2 = await self.post_ticket(tg, message="вторая попытка сразу")
        self.assertEqual((r2.status_code, r2.json()["detail"]["code"]), (429, "too_soon"))

        async with self.S() as s:
            from sqlalchemy import select

            u = (await s.execute(select(User).where(User.telegram_id == tg))).scalar_one()
            existing = (await s.execute(select(SupportTicket).where(SupportTicket.user_id == u.id))).scalars().all()
            for row in existing:
                row.created_at = svc.utcnow() - timedelta(hours=1)
                row.updated_at = row.created_at
            # уже есть 1 за сутки; добираем до лимита, все старше 3 минут
            for i in range(svc.DAILY_LIMIT - len(existing)):
                s.add(
                    SupportTicket(
                        user_id=u.id,
                        category="other",
                        message=f"старое обращение {i} ок",
                        created_at=svc.utcnow() - timedelta(hours=1, minutes=i + 1),
                        updated_at=svc.utcnow() - timedelta(hours=1, minutes=i + 1),
                    )
                )
            await s.commit()
        r3 = await self.post_ticket(tg, message="уже шестое за сутки")
        self.assertEqual((r3.status_code, r3.json()["detail"]["code"]), (429, "daily_limit"))

    async def test_saves_without_chat_id(self):
        tg = await self.user()
        with mock.patch.object(settings, "support_chat_id", None):
            with self.assertLogs("app.services.support_tickets", "WARNING") as cm:
                r = await self.post_ticket(tg, message="тикет без чата ок")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertTrue(any("SUPPORT_CHAT_ID" in line for line in cm.output))
        async with self.S() as s:
            row = await s.get(SupportTicket, r.json()["id"])
            self.assertIsNone(row.chat_id)
            self.assertIsNone(row.chat_message_id)

    async def test_saves_when_telegram_fails(self):
        tg = await self.user()
        with mock.patch("app.services.tg_notify._async_client", FailTg):
            with self.assertLogs("app.services.support_tickets", "WARNING") as cm:
                r = await self.post_ticket(tg, message="чат отклонил отправку")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertTrue(any("failed to forward" in line for line in cm.output))
        async with self.S() as s:
            row = await s.get(SupportTicket, r.json()["id"])
            self.assertIsNone(row.chat_message_id)

    async def test_list_is_own_tickets_only(self):
        a, b = await self.user(), await self.user()
        r = await self.post_ticket(a, message="обращение игрока а одно")
        self.assertEqual(r.status_code, 201, r.text)
        r = await self.post_ticket(b, message="обращение игрока б одно")
        self.assertEqual(r.status_code, 201, r.text)
        la = (await self.client.get("/api/v1/support/tickets", headers=self.h(a))).json()
        lb = (await self.client.get("/api/v1/support/tickets", headers=self.h(b))).json()
        self.assertEqual(len(la["items"]), 1)
        self.assertEqual(len(lb["items"]), 1)
        self.assertEqual(la["items"][0]["message"], "обращение игрока а одно")
        self.assertEqual(lb["items"][0]["message"], "обращение игрока б одно")
        self.assertEqual(la["items"][0]["status"], "open")

    async def test_owner_stats_and_forbidden(self):
        owner, other = await self.user(is_owner=True), await self.user()
        r = await self.post_ticket(other, message="открытый тикет для счётчика")
        self.assertEqual(r.status_code, 201, r.text)
        tid = r.json()["id"]
        rr = await self.client.post(f"/api/v1/support/internal/tickets/{tid}/reply", headers=self.bot_h(), json={"reply_text": "принято", "replied_by_tg_id": 99})
        self.assertEqual(rr.status_code, 200, rr.text)
        # второй тикет закроем; антиспам — сдвигаем время
        async with self.S() as s:
            row = await s.get(SupportTicket, tid)
            row.created_at = svc.utcnow() - timedelta(minutes=5)
            await s.commit()
        r2 = await self.post_ticket(other, message="второй тикет закроем сейчас")
        self.assertEqual(r2.status_code, 201, r2.text)
        cl = await self.client.post(f"/api/v1/support/internal/tickets/{r2.json()['id']}/close", headers=self.bot_h())
        self.assertEqual(cl.status_code, 200, cl.text)
        r3 = await self.post_ticket(await self.user(), message="ещё один открытый тикет")
        self.assertEqual(r3.status_code, 201, r3.text)

        stats = await self.client.get("/api/v1/admin/support/stats", headers=self.h(owner))
        self.assertEqual(stats.status_code, 200, stats.text)
        body = stats.json()
        self.assertEqual(body["open_count"], 1)
        self.assertEqual(body["answered_count"], 1)
        self.assertEqual(body["closed_count"], 1)
        self.assertEqual(body["total_count"], 3)
        forbidden = await self.client.get("/api/v1/admin/support/stats", headers=self.h(other))
        self.assertEqual(forbidden.status_code, 403)

    async def test_internal_reply_en_and_close_and_auth(self):
        player = await self.user(lang="en", first_name="Sam")
        r = await self.post_ticket(player, message="withdraw button is stuck now")
        self.assertEqual(r.status_code, 201, r.text)
        tid = r.json()["id"]
        mid = 1001

        self.assertEqual((await self.client.get(f"/api/v1/support/internal/tickets/{tid}")).status_code, 401)
        self.assertEqual((await self.client.get(f"/api/v1/support/internal/tickets/{tid}", headers=self.bot_h("wrong-token"))).status_code, 401)
        with mock.patch.object(settings, "telegram_bot_token", ""):
            self.assertEqual((await self.client.get(f"/api/v1/support/internal/tickets/{tid}", headers=self.bot_h("x"))).status_code, 503)

        got = await self.client.get(f"/api/v1/support/internal/tickets/{tid}", headers=self.bot_h())
        self.assertEqual(got.status_code, 200, got.text)
        self.assertEqual(got.json()["chat_message_id"], mid)
        self.assertEqual(got.json()["lang"], "en")
        by_msg = await self.client.get(f"/api/v1/support/internal/tickets/by-message/{mid}", headers=self.bot_h())
        self.assertEqual((by_msg.status_code, by_msg.json()["id"]), (200, tid))
        self.assertEqual((await self.client.get("/api/v1/support/internal/tickets/by-message/999999", headers=self.bot_h())).status_code, 404)

        FakeTg.calls = []
        reply = await self.client.post(
            f"/api/v1/support/internal/tickets/{tid}/reply",
            headers=self.bot_h(),
            json={"reply_text": "We are on it", "replied_by_tg_id": 555},
        )
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertEqual((reply.json()["status"], reply.json()["delivered"]), ("answered", True))
        send = FakeTg.calls[-1]
        self.assertTrue(send["url"].endswith("/sendMessage"))
        self.assertEqual(send["json"]["chat_id"], player)
        self.assertEqual(send["json"]["text"], f"Support reply to ticket #{tid}:\n\nWe are on it")

        mine = (await self.client.get("/api/v1/support/tickets", headers=self.h(player))).json()["items"][0]
        self.assertEqual((mine["status"], mine["reply_text"]), ("answered", "We are on it"))
        self.assertIsNotNone(mine["replied_at"])

        closed = await self.client.post(f"/api/v1/support/internal/tickets/{tid}/close", headers=self.bot_h())
        self.assertEqual((closed.status_code, closed.json()["status"]), (200, "closed"))
        # ответ по закрытому снова открывает его как answered
        FakeTg.calls = []
        again = await self.client.post(
            f"/api/v1/support/internal/tickets/{tid}/reply",
            headers=self.bot_h(),
            json={"reply_text": "Follow-up"},
        )
        self.assertEqual((again.status_code, again.json()["status"]), (200, "answered"))

        # русский ответ
        ru = await self.user(lang="ru")
        r = await self.post_ticket(ru, message="кнопка вывода не нажимается")
        FakeTg.calls = []
        rr = await self.client.post(
            f"/api/v1/support/internal/tickets/{r.json()['id']}/reply",
            headers=self.bot_h(),
            json={"reply_text": "Уже смотрим"},
        )
        self.assertEqual(rr.status_code, 200, rr.text)
        self.assertEqual(
            FakeTg.calls[-1]["json"]["text"],
            f"Ответ поддержки по обращению #{r.json()['id']}:\n\nУже смотрим",
        )


if __name__ == "__main__":
    unittest.main()
