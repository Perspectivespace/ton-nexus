"""Юнит-тесты обработчиков тикетов в закрытом чате (bot/support.py)."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest import mock

import json

import httpx
from aiogram.types import ForceReply

import support as S

CHAT = -1001999000111  # условный id закрытого чата, не настоящий
OTHER = -1001988000222
ADMIN_ID = 4242


def cfg(**kw) -> S.SupportConfig:
    vals = dict(chat_id=CHAT, api_base="http://api.test", bot_token="test-bot-token")
    vals.update(kw)
    return S.SupportConfig(**vals)


class FakeApi:
    def __init__(self):
        self.by_message: dict[int, dict | None] = {}
        self.replies: list[dict] = []
        self.closes: list[int] = []
        self.fail_by_message: S.TicketApiError | None = None
        self.fail_reply: S.TicketApiError | dict | None = None
        self.fail_close: S.TicketApiError | None = None

    async def get_by_message(self, message_id: int):
        if self.fail_by_message:
            raise self.fail_by_message
        return self.by_message.get(int(message_id))

    async def reply(self, ticket_id: int, reply_text: str, replied_by_tg_id: int | None):
        self.replies.append(
            {"ticket_id": ticket_id, "reply_text": reply_text, "replied_by_tg_id": replied_by_tg_id}
        )
        if isinstance(self.fail_reply, S.TicketApiError):
            raise self.fail_reply
        if isinstance(self.fail_reply, dict):
            return self.fail_reply
        return {"id": ticket_id, "status": "answered", "reply_text": reply_text, "delivered": True}

    async def close(self, ticket_id: int):
        self.closes.append(int(ticket_id))
        if self.fail_close:
            raise self.fail_close
        return {"id": ticket_id, "status": "closed"}


def user(*, uid=ADMIN_ID, is_bot=False, first_name="Админ"):
    return SimpleNamespace(id=uid, is_bot=is_bot, first_name=first_name)


def chat(cid=CHAT):
    return SimpleNamespace(id=cid, type="supergroup")


def msg(
    *,
    mid=10,
    cid=CHAT,
    text=None,
    caption=None,
    from_user=None,
    reply_to=None,
    is_bot=False,
):
    return SimpleNamespace(
        message_id=mid,
        chat=chat(cid),
        text=text,
        caption=caption,
        from_user=from_user if from_user is not None else user(is_bot=is_bot),
        reply_to_message=reply_to,
    )


def query(*, data, message, from_user=None):
    return SimpleNamespace(data=data, message=message, from_user=from_user or user())


def handlers(api=None, **kw) -> tuple[S.SupportHandlers, FakeApi]:
    api = api or FakeApi()
    return S.SupportHandlers(cfg(**kw), api), api  # type: ignore[arg-type]


class ParseTest(unittest.TestCase):
    def test_parse_support_chat_id(self):
        self.assertIsNone(S.parse_support_chat_id(None))
        self.assertIsNone(S.parse_support_chat_id(""))
        self.assertIsNone(S.parse_support_chat_id("   "))
        self.assertIsNone(S.parse_support_chat_id("abc"))
        self.assertEqual(S.parse_support_chat_id(" -1001 "), -1001)
        self.assertEqual(S.parse_support_chat_id(-1001), -1001)

    def test_parse_callback_and_texts(self):
        self.assertEqual(S.parse_callback("ticket:reply:42"), ("reply", 42))
        self.assertEqual(S.parse_callback("ticket:close:7"), ("close", 7))
        self.assertIsNone(S.parse_callback("ticket:other:1"))
        self.assertIsNone(S.parse_callback("noop"))
        prompt = S.PROMPT_TEXT.format(id=12)
        self.assertEqual(S.parse_prompt_ticket_id(prompt), 12)
        self.assertIsNone(S.parse_prompt_ticket_id("Тикет #12 · Баг\nТекст обращения:\nпривет"))
        self.assertEqual(S.parse_card_ticket_id("Тикет #12 · Баг\nТекст обращения:\nпривет"), 12)
        self.assertEqual(S.parse_card_ticket_id("Тикет #9 · Баг · @ann\nТекст во втором сообщении."), 9)
        self.assertIsNone(S.parse_card_ticket_id(prompt))
        self.assertIsNone(S.parse_card_ticket_id("смотри Тикет #5 завтра"))


class CallbackTest(unittest.IsolatedAsyncioTestCase):
    async def test_ignores_other_chat_and_missing_config(self):
        h, api = handlers()
        actions = await h.handle_callback(
            query(data="ticket:close:5", message=msg(cid=OTHER, mid=3))
        )
        self.assertEqual([a.kind for a in actions], ["answer_callback"])
        self.assertIsNone(actions[0].text)
        self.assertEqual(api.closes, [])

        h2, api2 = handlers(chat_id=None)
        actions = await h2.handle_callback(
            query(data="ticket:reply:5", message=msg(cid=CHAT, mid=3))
        )
        self.assertEqual([a.kind for a in actions], ["answer_callback"])
        self.assertEqual(api2.replies, [])
        self.assertEqual(api2.closes, [])

        h3, api3 = handlers(api_base="")
        actions = await h3.handle_callback(
            query(data="ticket:close:5", message=msg(cid=CHAT, mid=3))
        )
        self.assertEqual(actions[0].kind, "answer_callback")
        self.assertIn("не настроены", actions[0].text)
        self.assertEqual(api3.closes, [])

    async def test_ignores_unrelated_callback(self):
        h, api = handlers()
        actions = await h.handle_callback(
            query(data="something:else", message=msg(cid=CHAT, mid=3))
        )
        self.assertEqual(actions, [])

    async def test_reply_callback_sends_force_reply_prompt(self):
        h, api = handlers()
        card = msg(mid=101, text="Тикет #8 · Баг")
        actions = await h.handle_callback(query(data="ticket:reply:8", message=card))
        self.assertEqual([a.kind for a in actions], ["answer_callback", "send"])
        prompt = actions[1]
        self.assertIn("тикета #8", prompt.text)
        self.assertIn("текст уйдёт игроку", prompt.text.lower())
        self.assertEqual(prompt.reply_to_message_id, 101)
        self.assertEqual(prompt.ticket_id, 8)
        self.assertEqual(prompt.parse_mode, "HTML")
        self.assertIsInstance(prompt.reply_markup, ForceReply)
        self.assertTrue(prompt.reply_markup.selective)
        self.assertEqual(api.replies, [])

    async def test_close_callback_calls_backend_and_clears_markup(self):
        h, api = handlers()
        card = msg(mid=101, text="Тикет #8 · Баг")
        actions = await h.handle_callback(query(data="ticket:close:8", message=card))
        self.assertEqual(api.closes, [8])
        kinds = [a.kind for a in actions]
        self.assertEqual(kinds, ["answer_callback", "edit_markup", "send"])
        self.assertEqual(actions[0].text, "Тикет #8 закрыт")
        self.assertIsNone(actions[1].reply_markup)
        self.assertEqual(actions[2].text, "Тикет #8 закрыт без ответа")
        self.assertEqual(actions[2].reply_to_message_id, 101)

    async def test_close_callback_keeps_markup_when_backend_fails(self):
        h, api = handlers()
        api.fail_close = S.TicketApiError("down", unavailable=True)
        actions = await h.handle_callback(query(data="ticket:close:8", message=msg(mid=101)))
        self.assertEqual(api.closes, [8])
        self.assertEqual([a.kind for a in actions], ["answer_callback"])
        self.assertTrue(actions[0].show_alert)
        self.assertIn("закрыть тикет #8", actions[0].text.lower())
        self.assertIn("недоступен", actions[0].text.lower())


class ReplyTest(unittest.IsolatedAsyncioTestCase):
    async def test_ignores_other_chat_bots_and_plain_messages(self):
        h, api = handlers()
        card = msg(mid=50, text="Тикет #3 · Баг")
        other = msg(cid=OTHER, text="Ок, смотрим", reply_to=card)
        self.assertEqual(await h.handle_reply(other), [])
        bot_msg = msg(text="Ок, смотрим", reply_to=card, is_bot=True)
        self.assertEqual(await h.handle_reply(bot_msg), [])
        plain = msg(text="привет всем")
        self.assertEqual(await h.handle_reply(plain), [])
        self.assertEqual(api.replies, [])
        self.assertEqual(api.by_message, {})

    async def test_direct_reply_to_ticket_card(self):
        h, api = handlers()
        card = msg(mid=50, text="Тикет #3 · Баг\nТекст обращения:\nсломалось")
        # Даже без заголовка карточки сработает lookup по chat_message_id.
        api.by_message[50] = {"id": 3, "status": "open"}
        incoming = msg(mid=80, text="  Уже смотрим  ", reply_to=card)
        actions = await h.handle_reply(incoming)
        self.assertEqual(api.replies, [{"ticket_id": 3, "reply_text": "Уже смотрим", "replied_by_tg_id": ADMIN_ID}])
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].kind, "send")
        self.assertEqual(actions[0].text, "Ответ по тикету #3 отправлен игроку.")

    async def test_direct_reply_uses_by_message_when_text_is_not_a_card(self):
        """Реплай на исходное сообщение карточки, которое уже не выглядит как заголовок."""
        h, api = handlers()
        card = msg(mid=50, text="что-то переслали без заголовка")
        api.by_message[50] = {"id": 11, "status": "open"}
        incoming = msg(mid=80, text="Принято", reply_to=card)
        actions = await h.handle_reply(incoming)
        self.assertEqual(api.replies[0]["ticket_id"], 11)
        self.assertEqual(actions[0].text, "Ответ по тикету #11 отправлен игроку.")

    async def test_reply_to_prompt_via_memory_and_text(self):
        h, api = handlers()
        prompt = msg(mid=70, text=S.PROMPT_TEXT.format(id=4))
        h.remember_prompt(70, 4)
        incoming = msg(mid=81, text="Спасибо, исправим", reply_to=prompt)
        actions = await h.handle_reply(incoming)
        self.assertEqual(api.replies[0], {"ticket_id": 4, "reply_text": "Спасибо, исправим", "replied_by_tg_id": ADMIN_ID})
        self.assertEqual(actions[0].text, "Ответ по тикету #4 отправлен игроку.")
        # by-message не зовём, если id известен из подсказки
        self.assertEqual(api.by_message, {})

        # После «рестарта» карта пустая — разбираем текст подсказки.
        h2, api2 = handlers()
        mentioned = msg(
            mid=71,
            text='<a href="tg://user?id=4242">Админ</a>, ответь реплаем на карточку тикета #15 (или на это сообщение) — текст уйдёт игроку.',
        )
        actions = await h2.handle_reply(msg(mid=82, text="Ок", reply_to=mentioned))
        self.assertEqual(api2.replies[0]["ticket_id"], 15)
        self.assertEqual(actions[0].text, "Ответ по тикету #15 отправлен игроку.")

    async def test_reply_to_unrelated_message_is_silent(self):
        h, api = handlers()
        ordinary = msg(mid=99, text="совещание в 18:00")
        incoming = msg(mid=100, text="буду", reply_to=ordinary)
        actions = await h.handle_reply(incoming)
        self.assertEqual(actions, [])
        self.assertEqual(api.replies, [])

    async def test_non_text_reply_gets_hint_only_for_tickets(self):
        h, api = handlers()
        card = msg(mid=50, text="Тикет #3 · Баг")
        sticker = msg(mid=80, text=None, caption=None, reply_to=card)
        actions = await h.handle_reply(sticker)
        self.assertEqual(actions[0].text, "Ответь текстом, чтобы отправить игроку.")
        self.assertEqual(api.replies, [])

        photo = msg(mid=81, text=None, caption="Скрин как доказательство", reply_to=card)
        actions = await h.handle_reply(photo)
        self.assertEqual(api.replies[0]["reply_text"], "Скрин как доказательство")
        self.assertIn("отправлен игроку", actions[0].text)

        ordinary = msg(mid=99, text="совещание")
        silent = await h.handle_reply(msg(mid=100, text=None, reply_to=ordinary))
        self.assertEqual(silent, [])

    async def test_too_long_and_undelivered_and_errors(self):
        h, api = handlers()
        card = msg(mid=50, text="Тикет #3 · Баг")
        long = await h.handle_reply(msg(mid=80, text="x" * (S.MAX_REPLY + 1), reply_to=card))
        self.assertIn("4000", long[0].text)
        self.assertEqual(api.replies, [])

        api.fail_reply = {"id": 3, "status": "answered", "delivered": False}
        blocked = await h.handle_reply(msg(mid=81, text="Держи ответ", reply_to=card))
        self.assertIn("заблокировал бота", blocked[0].text)
        self.assertEqual(api.replies[-1]["ticket_id"], 3)

        api.fail_reply = S.TicketApiError("ticket not found", status=404)
        missing = await h.handle_reply(msg(mid=82, text="ещё раз", reply_to=card))
        self.assertEqual(missing[0].text, "Тикет #3 не найден.")

        api.fail_reply = S.TicketApiError("down", unavailable=True)
        down = await h.handle_reply(msg(mid=83, text="ещё раз", reply_to=card))
        self.assertIn("бэкенд недоступен", down[0].text)


class TicketApiHttpTest(unittest.IsolatedAsyncioTestCase):
    def _client(self, handler):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://api.test")

    async def test_headers_and_paths(self):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            if request.method == "GET":
                return httpx.Response(200, json={"id": 9, "status": "open"})
            if request.url.path.endswith("/close"):
                return httpx.Response(200, json={"id": 9, "status": "closed"})
            return httpx.Response(200, json={"id": 9, "status": "answered", "delivered": True})

        async with self._client(handler) as client:
            api = S.TicketApi(cfg(), client)
            got = await api.get_by_message(555)
            self.assertEqual(got["id"], 9)
            await api.reply(9, "привет", 77)
            await api.close(9)

        self.assertEqual(len(seen), 3)
        self.assertEqual(seen[0].url.path, "/api/v1/support/internal/tickets/by-message/555")
        self.assertEqual(seen[1].url.path, "/api/v1/support/internal/tickets/9/reply")
        self.assertEqual(seen[2].url.path, "/api/v1/support/internal/tickets/9/close")
        for req in seen:
            self.assertEqual(req.headers["X-Bot-Token"], "test-bot-token")

        payload = json.loads(seen[1].content.decode())
        self.assertEqual(payload, {"reply_text": "привет", "replied_by_tg_id": 77})

    async def test_404_and_network_errors(self):
        def not_found(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"detail": "ticket not found"})

        async with self._client(not_found) as client:
            api = S.TicketApi(cfg(), client)
            self.assertIsNone(await api.get_by_message(1))
            with self.assertRaises(S.TicketApiError) as cm:
                await api.close(1)
            self.assertEqual(cm.exception.status, 404)

        def boom(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("nope", request=request)

        async with self._client(boom) as client:
            api = S.TicketApi(cfg(), client)
            with self.assertRaises(S.TicketApiError) as cm:
                await api.reply(1, "x", 2)
            self.assertTrue(cm.exception.unavailable)


if __name__ == "__main__":
    unittest.main()
