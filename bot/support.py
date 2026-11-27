"""Обработчики тикетов поддержки в закрытом чате.

Бизнес-логика ответа игроку живёт в FastAPI; бот только принимает
кнопки/реплаи в SUPPORT_CHAT_ID и вызывает внутренние эндпоинты.
Если SUPPORT_CHAT_ID не задан, обработчики ничего не делают — бот
как и раньше отвечает на /start, /help и /ping.
"""

from __future__ import annotations

import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

import httpx
from aiogram import Dispatcher, F
from aiogram.types import (
    CallbackQuery,
    ForceReply,
    Message,
)

log = logging.getLogger("ton-nexus-bot")

CALLBACK_RE = re.compile(r"^ticket:(reply|close):(\d+)$")
# Текст подсказки: «…тикета #12 (или на это сообщение)…»
PROMPT_ID_RE = re.compile(r"тикета\s+#(\d+)", re.IGNORECASE)
# Заголовок карточки (и короткой подписи к фото): «Тикет #12 · Баг»
CARD_ID_RE = re.compile(r"^Тикет\s+#(\d+)\b")
PROMPT_MARKER = "текст уйдёт игроку"

MAX_REPLY = 4000
PROMPT_CACHE_LIMIT = 200
HTTP_TIMEOUT = 10.0

PROMPT_TEXT = (
    "Ответь реплаем на карточку тикета #{id} (или на это сообщение) — текст уйдёт игроку."
)
HINT_TEXT = "Ответь текстом, чтобы отправить игроку."
HINT_TOO_LONG = "Текст ответа слишком длинный (максимум 4000 символов). Сократи и отправь ещё раз."
CLOSED_CALLBACK = "Тикет #{id} закрыт"
CLOSED_CHAT = "Тикет #{id} закрыт без ответа"
REPLY_OK = "Ответ по тикету #{id} отправлен игроку."
REPLY_UNDELIVERED = (
    "Ответ по тикету #{id} сохранён, но игрок, возможно, заблокировал бота — сообщение не доставлено."
)
ERR_CLOSE = "Не удалось закрыть тикет #{id}: {reason}"
ERR_REPLY = "Не удалось отправить ответ по тикету #{id}: {reason}"
ERR_NOT_FOUND = "Тикет #{id} не найден."
ERR_UNAVAILABLE = "бэкенд недоступен"
NOT_CONFIGURED = "Тикеты не настроены (нет SUPPORT_CHAT_ID или API_BASE_URL)."


def parse_support_chat_id(raw: object) -> int | None:
    """Как в backend Settings: пустая строка → None, иначе int. Мусор не роняет бота."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    s = str(raw).strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        log.warning("[support] SUPPORT_CHAT_ID is not an integer, ignoring")
        return None


@dataclass
class SupportConfig:
    chat_id: int | None
    api_base: str
    bot_token: str

    @property
    def enabled(self) -> bool:
        return self.chat_id is not None and bool(self.api_base) and bool(self.bot_token)


@dataclass
class BotAction:
    """Что бот должен сделать в Telegram. Тесты проверяют список действий, без сети."""

    kind: str
    text: str | None = None
    show_alert: bool = False
    reply_to_message_id: int | None = None
    reply_markup: Any = None
    parse_mode: str | None = None
    ticket_id: int | None = None
    edit_markup: bool = False


class TicketApiError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        unavailable: bool = False,
    ):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.unavailable = unavailable

    @property
    def reason(self) -> str:
        if self.unavailable:
            return ERR_UNAVAILABLE
        if self.status == 404 or self.code in {"user_not_found"}:
            return "тикет или игрок не найден"
        if self.message:
            return self.message
        return f"ошибка {self.status}" if self.status else "неизвестная ошибка"


class TicketApi:
    """Клиент внутренних эндпоинтов /api/v1/support/internal/*."""

    def __init__(self, config: SupportConfig, client: httpx.AsyncClient):
        self.config = config
        self.client = client

    def _headers(self) -> dict[str, str]:
        return {"X-Bot-Token": self.config.bot_token, "Accept": "application/json"}

    def _url(self, path: str) -> str:
        return f"{self.config.api_base}{path}"

    def _ensure_ready(self) -> None:
        if not self.config.api_base or not self.config.bot_token:
            raise TicketApiError(NOT_CONFIGURED, unavailable=True)

    def _parse_error(self, resp: httpx.Response) -> TicketApiError:
        code = None
        message = f"HTTP {resp.status_code}"
        try:
            data = resp.json()
            detail = data.get("detail", data) if isinstance(data, dict) else data
            if isinstance(detail, dict):
                code = detail.get("code")
                message = str(detail.get("message") or detail.get("code") or message)
            elif isinstance(detail, str) and detail.strip():
                message = detail.strip()
        except Exception:
            pass
        unavailable = resp.status_code >= 500
        return TicketApiError(message, status=resp.status_code, code=code, unavailable=unavailable)

    async def get_by_message(self, message_id: int) -> dict[str, Any] | None:
        self._ensure_ready()
        url = self._url(f"/api/v1/support/internal/tickets/by-message/{int(message_id)}")
        try:
            resp = await self.client.get(url, headers=self._headers())
        except httpx.HTTPError as e:
            raise TicketApiError(ERR_UNAVAILABLE, unavailable=True) from e
        if resp.status_code == 404:
            return None
        if resp.status_code >= 400:
            raise self._parse_error(resp)
        return resp.json()

    async def reply(self, ticket_id: int, reply_text: str, replied_by_tg_id: int | None) -> dict[str, Any]:
        self._ensure_ready()
        url = self._url(f"/api/v1/support/internal/tickets/{int(ticket_id)}/reply")
        payload = {"reply_text": reply_text, "replied_by_tg_id": replied_by_tg_id}
        try:
            resp = await self.client.post(url, headers=self._headers(), json=payload)
        except httpx.HTTPError as e:
            raise TicketApiError(ERR_UNAVAILABLE, unavailable=True) from e
        if resp.status_code >= 400:
            raise self._parse_error(resp)
        return resp.json()

    async def close(self, ticket_id: int) -> dict[str, Any]:
        self._ensure_ready()
        url = self._url(f"/api/v1/support/internal/tickets/{int(ticket_id)}/close")
        try:
            resp = await self.client.post(url, headers=self._headers())
        except httpx.HTTPError as e:
            raise TicketApiError(ERR_UNAVAILABLE, unavailable=True) from e
        if resp.status_code >= 400:
            raise self._parse_error(resp)
        return resp.json()


def parse_callback(data: str | None) -> tuple[str, int] | None:
    m = CALLBACK_RE.match(data or "")
    if not m:
        return None
    return m.group(1), int(m.group(2))


def parse_prompt_ticket_id(text: str | None) -> int | None:
    raw = (text or "").strip()
    if PROMPT_MARKER not in raw.lower():
        return None
    m = PROMPT_ID_RE.search(raw)
    return int(m.group(1)) if m else None


def parse_card_ticket_id(text: str | None) -> int | None:
    raw = (text or "").strip()
    m = CARD_ID_RE.match(raw)
    return int(m.group(1)) if m else None


def message_text(msg: Any) -> str:
    return (getattr(msg, "text", None) or getattr(msg, "caption", None) or "").strip()


def _user_id(obj: Any) -> int | None:
    user = getattr(obj, "from_user", None)
    if user is None:
        return None
    uid = getattr(user, "id", None)
    return int(uid) if uid is not None else None


def _is_bot(obj: Any) -> bool:
    user = getattr(obj, "from_user", None)
    return bool(user is not None and getattr(user, "is_bot", False))


def _chat_id(obj: Any) -> int | None:
    chat = getattr(obj, "chat", None)
    if chat is None:
        return None
    cid = getattr(chat, "id", None)
    return int(cid) if cid is not None else None


def _mention_html(user: Any) -> str:
    if user is None:
        return ""
    fn = getattr(user, "mention_html", None)
    if callable(fn):
        try:
            return str(fn())
        except Exception:
            pass
    name = getattr(user, "first_name", None) or "админ"
    uid = getattr(user, "id", None)
    if uid is None:
        return name
    safe = (
        str(name)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return f'<a href="tg://user?id={int(uid)}">{safe}</a>'


class SupportHandlers:
    def __init__(self, config: SupportConfig, api: TicketApi):
        self.config = config
        self.api = api
        # message_id подсказки → ticket_id (после рестарта подсказку разбираем по тексту)
        self.prompts: OrderedDict[int, int] = OrderedDict()

    def remember_prompt(self, message_id: int, ticket_id: int) -> None:
        self.prompts[int(message_id)] = int(ticket_id)
        self.prompts.move_to_end(int(message_id))
        while len(self.prompts) > PROMPT_CACHE_LIMIT:
            self.prompts.popitem(last=False)

    def is_support_chat(self, chat_id: int | None) -> bool:
        return self.config.chat_id is not None and chat_id == self.config.chat_id

    def lookup_prompt(self, message: Any) -> int | None:
        if message is None:
            return None
        mid = getattr(message, "message_id", None)
        if mid is not None and int(mid) in self.prompts:
            return self.prompts[int(mid)]
        return parse_prompt_ticket_id(message_text(message))

    def lookup_card(self, message: Any) -> int | None:
        if message is None:
            return None
        return parse_card_ticket_id(message_text(message))

    async def handle_callback(self, query: Any) -> list[BotAction]:
        parsed = parse_callback(getattr(query, "data", None))
        if parsed is None:
            return []
        action, ticket_id = parsed
        message = getattr(query, "message", None)
        chat_id = _chat_id(message) if message is not None else None
        if not self.is_support_chat(chat_id):
            # Чужой чат: гасим «часики», ничего не делаем.
            return [BotAction(kind="answer_callback")]
        if not self.config.enabled:
            return [
                BotAction(kind="answer_callback", text=NOT_CONFIGURED, show_alert=True),
            ]
        if action == "reply":
            return self._prompt_reply(query, message, ticket_id)
        if action == "close":
            return await self._close_ticket(message, ticket_id)
        return [BotAction(kind="answer_callback")]

    def _prompt_reply(self, query: Any, message: Any, ticket_id: int) -> list[BotAction]:
        mention = _mention_html(getattr(query, "from_user", None))
        body = PROMPT_TEXT.format(id=ticket_id)
        text = f"{mention}, {body[0].lower() + body[1:]}" if mention else body
        mid = getattr(message, "message_id", None)
        return [
            BotAction(kind="answer_callback"),
            BotAction(
                kind="send",
                text=text,
                reply_to_message_id=int(mid) if mid is not None else None,
                reply_markup=ForceReply(
                    force_reply=True,
                    selective=True,
                    input_field_placeholder="Ответ игроку",
                ),
                parse_mode="HTML",
                ticket_id=ticket_id,
            ),
        ]

    async def _close_ticket(self, message: Any, ticket_id: int) -> list[BotAction]:
        mid = getattr(message, "message_id", None)
        try:
            await self.api.close(ticket_id)
        except TicketApiError as e:
            log.warning("[support] close ticket #%s failed: %s", ticket_id, e)
            return [
                BotAction(
                    kind="answer_callback",
                    text=ERR_CLOSE.format(id=ticket_id, reason=e.reason)[:200],
                    show_alert=True,
                ),
            ]
        return [
            BotAction(kind="answer_callback", text=CLOSED_CALLBACK.format(id=ticket_id)),
            BotAction(kind="edit_markup", reply_markup=None, reply_to_message_id=mid),
            BotAction(
                kind="send",
                text=CLOSED_CHAT.format(id=ticket_id),
                reply_to_message_id=int(mid) if mid is not None else None,
            ),
        ]

    async def handle_reply(self, message: Any) -> list[BotAction]:
        if not self.is_support_chat(_chat_id(message)):
            return []
        if _is_bot(message):
            return []
        reply_to = getattr(message, "reply_to_message", None)
        if reply_to is None:
            return []
        if not self.config.enabled:
            # В закрытом чате без настроек не спамим: обычные разговоры важнее.
            return []

        ticket_id = self.lookup_prompt(reply_to) or self.lookup_card(reply_to)
        if ticket_id is None:
            mid = getattr(reply_to, "message_id", None)
            if mid is None:
                return []
            try:
                row = await self.api.get_by_message(int(mid))
            except TicketApiError as e:
                # Реплай на обычное сообщение чата не должен превращаться в ошибку,
                # даже если бэкенд временно недоступен.
                log.warning("[support] by-message lookup failed: %s", e)
                return []
            if not row:
                return []
            ticket_id = int(row["id"])

        text = message_text(message)
        if not text:
            # Стикер, фото без подписи и т.п. — подсказка только если это точно тикет.
            return [
                BotAction(
                    kind="send",
                    text=HINT_TEXT,
                    reply_to_message_id=getattr(message, "message_id", None),
                )
            ]
        if len(text) > MAX_REPLY:
            return [
                BotAction(
                    kind="send",
                    text=HINT_TOO_LONG,
                    reply_to_message_id=getattr(message, "message_id", None),
                )
            ]

        try:
            result = await self.api.reply(ticket_id, text, _user_id(message))
        except TicketApiError as e:
            log.warning("[support] reply ticket #%s failed: %s", ticket_id, e)
            if e.status == 404:
                reason = ERR_NOT_FOUND.format(id=ticket_id)
            else:
                reason = ERR_REPLY.format(id=ticket_id, reason=e.reason)
            return [
                BotAction(
                    kind="send",
                    text=reason,
                    reply_to_message_id=getattr(message, "message_id", None),
                )
            ]

        delivered = True
        if isinstance(result, dict) and "delivered" in result:
            delivered = bool(result["delivered"])
        body = REPLY_OK.format(id=ticket_id) if delivered else REPLY_UNDELIVERED.format(id=ticket_id)
        return [
            BotAction(
                kind="send",
                text=body,
                reply_to_message_id=getattr(message, "message_id", None),
            )
        ]

    async def on_callback(self, query: CallbackQuery) -> None:
        actions = await self.handle_callback(query)
        await self._execute(query, getattr(query, "message", None), actions)

    async def on_reply(self, message: Message) -> None:
        actions = await self.handle_reply(message)
        await self._execute(None, message, actions)

    async def _execute(self, query: CallbackQuery | None, message: Message | None, actions: list[BotAction]) -> None:
        for action in actions:
            try:
                if action.kind == "answer_callback":
                    if query is not None:
                        await query.answer(action.text or "", show_alert=action.show_alert)
                elif action.kind == "edit_markup":
                    if message is not None:
                        await message.edit_reply_markup(reply_markup=action.reply_markup)
                elif action.kind == "send":
                    if message is None:
                        continue
                    sent = await message.reply(
                        action.text or "",
                        reply_markup=action.reply_markup,
                        parse_mode=action.parse_mode,
                    )
                    if action.ticket_id is not None and sent is not None:
                        mid = getattr(sent, "message_id", None)
                        if mid is not None:
                            self.remember_prompt(int(mid), action.ticket_id)
            except Exception:
                log.exception("[support] failed to apply action %s", action.kind)

    def register(self, dp: Dispatcher) -> None:
        dp.callback_query.register(self.on_callback, F.data.startswith("ticket:"))
        dp.message.register(self.on_reply, F.reply_to_message)
