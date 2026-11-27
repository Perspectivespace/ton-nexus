"""Тикеты поддержки: приём обращений, антиспам, пересылка в закрытый чат, ответы бота."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.i18n import user_lang
from app.models.support_ticket import CATEGORIES, STATUSES, SupportTicket
from app.models.user import User
from app.services import tg_notify

log = logging.getLogger(__name__)

MIN_MESSAGE = 5
MAX_MESSAGE = 2000
MAX_REPLY = 4000
MAX_BYTES = 5 * 1024 * 1024
CAPTION_LIMIT = 1024
RATE_INTERVAL = timedelta(minutes=3)
DAILY_LIMIT = 5
DAILY_WINDOW = timedelta(hours=24)
LIST_LIMIT = 20

MIME_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
ALLOWED_MIME = frozenset(MIME_EXT)

CATEGORY_LABELS = {
    "bug": "Баг",
    "payment": "Пополнение и вывод",
    "idea": "Предложение",
    "other": "Другое",
}

REPLY_TEXT = {
    "ru": "Ответ поддержки по обращению #{id}:\n\n{text}",
    "en": "Support reply to ticket #{id}:\n\n{text}",
}


class TicketError(ValueError):
    def __init__(self, message: str, status: int = 400, code: str = "bad_request"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def detect_mime(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def normalize_message(raw: str | None) -> str:
    text = (raw or "").strip()
    if len(text) < MIN_MESSAGE or len(text) > MAX_MESSAGE:
        raise TicketError("Текст обращения: от 5 до 2000 символов", 400, "bad_message")
    return text


def normalize_category(raw: str | None) -> str:
    cat = (raw or "").strip().lower()
    if cat not in CATEGORIES:
        raise TicketError("Неизвестная категория обращения", 400, "bad_category")
    return cat


def normalize_reply(raw: str | None) -> str:
    text = (raw or "").strip()
    if not text or len(text) > MAX_REPLY:
        raise TicketError("Текст ответа: от 1 до 4000 символов", 400, "bad_reply")
    return text


def validate_screenshot(data: bytes, declared: str | None = None) -> str:
    if not data:
        raise TicketError("пустой файл", 400, "empty_file")
    if len(data) > MAX_BYTES:
        raise TicketError("файл больше 5 МБ", 400, "too_large")
    mime = detect_mime(data)
    if mime is None:
        raise TicketError("нужна картинка PNG, JPG или WebP", 400, "bad_type")
    if declared:
        d = declared.split(";", 1)[0].strip().lower()
        if d in ("image/jpg", "image/jpeg"):
            d = "image/jpeg"
        if d.startswith("image/") and d not in ALLOWED_MIME:
            raise TicketError("нужна картинка PNG, JPG или WebP", 400, "bad_type")
        if d.startswith("image/") and d != mime:
            raise TicketError("тип файла не совпадает с содержимым", 400, "type_mismatch")
    return mime


def ticket_keyboard(ticket_id: int) -> dict:
    return {
        "inline_keyboard": [
            [
                {"text": "Ответить", "callback_data": f"ticket:reply:{ticket_id}"},
                {"text": "Закрыть", "callback_data": f"ticket:close:{ticket_id}"},
            ]
        ]
    }


def format_card(ticket: SupportTicket, user: User) -> str:
    name = " ".join(p for p in (user.first_name, user.last_name) if p).strip()
    handle = f"@{user.username}" if user.username else ""
    who = " ".join(p for p in (handle, f"({name})" if name else "") if p) or "—"
    label = CATEGORY_LABELS.get(ticket.category, ticket.category)
    return (
        f"Тикет #{ticket.id} · {label}\n"
        f"\n"
        f"Игрок: {who}\n"
        f"tg_id: {user.telegram_id}\n"
        f"Язык: {user_lang(user)}\n"
        f"\n"
        f"Текст обращения:\n"
        f"{ticket.message}"
    )


def short_caption(ticket: SupportTicket, user: User) -> str:
    label = CATEGORY_LABELS.get(ticket.category, ticket.category)
    handle = f"@{user.username}" if user.username else str(user.telegram_id)
    return f"Тикет #{ticket.id} · {label} · {handle}\nТекст во втором сообщении."[:CAPTION_LIMIT]


async def _check_rate_limit(db: AsyncSession, user_id: int) -> None:
    now = utcnow()
    last = await db.scalar(
        select(func.max(SupportTicket.created_at)).where(SupportTicket.user_id == user_id)
    )
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if now - last < RATE_INTERVAL:
            raise TicketError("Подождите 3 минуты перед новым обращением", 429, "too_soon")
    recent = await db.scalar(
        select(func.count())
        .select_from(SupportTicket)
        .where(SupportTicket.user_id == user_id, SupportTicket.created_at >= now - DAILY_WINDOW)
    )
    if (recent or 0) >= DAILY_LIMIT:
        raise TicketError("Слишком много обращений за сутки — попробуйте завтра", 429, "daily_limit")


async def forward_to_chat(
    ticket: SupportTicket,
    user: User,
    photo: bytes | None = None,
    mime: str | None = None,
) -> tuple[int | None, int | None]:
    """Пересылает карточку в закрытый чат. При ошибке или без настроек — (None, None), тикет уже в БД."""
    chat_id = settings.support_chat_id
    if not chat_id:
        log.warning("[support] SUPPORT_CHAT_ID is not set; ticket #%s saved without forwarding", ticket.id)
        return None, None
    if not (settings.telegram_bot_token or "").strip():
        log.warning("[support] TELEGRAM_BOT_TOKEN is not set; ticket #%s saved without forwarding", ticket.id)
        return None, None

    card = format_card(ticket, user)
    kb = ticket_keyboard(ticket.id)
    mid: int | None = None
    if photo and mime:
        caption = card if len(card) <= CAPTION_LIMIT else short_caption(ticket, user)
        mid = await tg_notify.send_photo(
            int(chat_id),
            photo,
            filename=f"ticket-{ticket.id}.{MIME_EXT[mime]}",
            mime=mime,
            caption=caption,
            reply_markup=kb,
        )
        if mid is not None and caption != card:
            await tg_notify.send_chat_message(int(chat_id), card)
    else:
        mid = await tg_notify.send_chat_message(int(chat_id), card, reply_markup=kb)
    if mid is None:
        log.warning("[support] failed to forward ticket #%s to support chat", ticket.id)
        return None, None
    return int(chat_id), mid


async def create_ticket(
    db: AsyncSession,
    user: User,
    *,
    category: str,
    message: str,
    screenshot: bytes | None = None,
    screenshot_type: str | None = None,
) -> SupportTicket:
    cat = normalize_category(category)
    text = normalize_message(message)
    mime: str | None = None
    if screenshot is not None:
        mime = validate_screenshot(screenshot, screenshot_type)
    await _check_rate_limit(db, user.id)

    ticket = SupportTicket(
        user_id=user.id,
        category=cat,
        message=text,
        has_screenshot=bool(mime),
        status="open",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(ticket)
    await db.flush()

    chat_id, message_id = await forward_to_chat(ticket, user, screenshot if mime else None, mime)
    ticket.chat_id = chat_id
    ticket.chat_message_id = message_id
    ticket.updated_at = utcnow()
    await db.flush()
    return ticket


async def list_tickets(db: AsyncSession, user_id: int, *, limit: int = LIST_LIMIT) -> list[SupportTicket]:
    n = max(1, min(int(limit), 50))
    rows = await db.scalars(
        select(SupportTicket)
        .where(SupportTicket.user_id == user_id)
        .order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc())
        .limit(n)
    )
    return list(rows)


async def stats(db: AsyncSession) -> dict[str, int]:
    rows = (await db.execute(select(SupportTicket.status, func.count()).group_by(SupportTicket.status))).all()
    counts = {status: int(n) for status, n in rows}
    return {
        "open_count": counts.get("open", 0),
        "answered_count": counts.get("answered", 0),
        "closed_count": counts.get("closed", 0),
        "total_count": sum(counts.values()),
    }


async def get_ticket(db: AsyncSession, ticket_id: int) -> SupportTicket | None:
    return await db.get(SupportTicket, ticket_id)


async def get_by_message(db: AsyncSession, chat_message_id: int) -> SupportTicket | None:
    return await db.scalar(
        select(SupportTicket)
        .where(SupportTicket.chat_message_id == chat_message_id)
        .order_by(SupportTicket.id.desc())
    )


async def reply_ticket(
    db: AsyncSession,
    ticket: SupportTicket,
    *,
    reply_text: str,
    replied_by_tg_id: int | None = None,
) -> dict[str, Any]:
    text = normalize_reply(reply_text)
    user = await db.get(User, ticket.user_id)
    if user is None:
        raise TicketError("Игрок не найден", 404, "user_not_found")
    now = utcnow()
    ticket.reply_text = text
    ticket.replied_by_tg_id = replied_by_tg_id
    ticket.replied_at = now
    ticket.status = "answered"
    ticket.updated_at = now
    await db.flush()

    lang = user_lang(user)
    body = REPLY_TEXT["ru" if lang == "ru" else "en"].format(id=ticket.id, text=text)
    delivered = await tg_notify.send_message(user.telegram_id, body)
    if not delivered:
        log.warning("[support] reply to player for ticket #%s was not delivered", ticket.id)
    return {"delivered": delivered}


async def close_ticket(db: AsyncSession, ticket: SupportTicket) -> SupportTicket:
    ticket.status = "closed"
    ticket.updated_at = utcnow()
    await db.flush()
    return ticket


def player_out(ticket: SupportTicket) -> dict[str, Any]:
    return {
        "id": ticket.id,
        "category": ticket.category,
        "message": ticket.message,
        "has_screenshot": bool(ticket.has_screenshot),
        "status": ticket.status,
        "reply_text": ticket.reply_text,
        "replied_at": ticket.replied_at,
        "created_at": ticket.created_at,
    }


def created_out(ticket: SupportTicket) -> dict[str, Any]:
    return {
        "id": ticket.id,
        "category": ticket.category,
        "status": ticket.status,
        "has_screenshot": bool(ticket.has_screenshot),
        "created_at": ticket.created_at,
    }


def internal_out(ticket: SupportTicket, user: User | None = None) -> dict[str, Any]:
    return {
        "id": ticket.id,
        "user_id": ticket.user_id,
        "telegram_id": user.telegram_id if user else None,
        "username": user.username if user else None,
        "first_name": user.first_name if user else None,
        "lang": user_lang(user) if user else None,
        "category": ticket.category,
        "message": ticket.message,
        "has_screenshot": bool(ticket.has_screenshot),
        "status": ticket.status,
        "chat_id": ticket.chat_id,
        "chat_message_id": ticket.chat_message_id,
        "reply_text": ticket.reply_text,
        "replied_by_tg_id": ticket.replied_by_tg_id,
        "replied_at": ticket.replied_at,
        "created_at": ticket.created_at,
    }


# импорт STATUSES, чтобы внутренние проверки и тесты видели допустимые статусы рядом с моделью
assert STATUSES == ("open", "answered", "closed")
