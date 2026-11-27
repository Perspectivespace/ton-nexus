"""Сообщения от имени бота (Bot API sendMessage / sendPhoto). Без токена — ничего не отправляем."""

from __future__ import annotations

import json
import logging

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

_API = "https://api.telegram.org/bot{token}/{method}"


def _async_client(**kwargs):
    return httpx.AsyncClient(**kwargs)


def _token() -> str:
    return (settings.telegram_bot_token or "").strip()


def _message_id(payload: object) -> int | None:
    if not isinstance(payload, dict):
        return None
    result = payload.get("result")
    if not isinstance(result, dict):
        return None
    mid = result.get("message_id")
    try:
        return int(mid)
    except (TypeError, ValueError):
        return None


async def send_message(chat_id: int, text: str) -> bool:
    return await send_chat_message(chat_id, text) is not None


async def send_chat_message(
    chat_id: int,
    text: str,
    *,
    reply_markup: dict | None = None,
) -> int | None:
    token = _token()
    if not token or not chat_id:
        return None
    payload: dict = {
        "chat_id": int(chat_id),
        "text": text[:4000],
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        async with _async_client(timeout=10) as client:
            r = await client.post(_API.format(token=token, method="sendMessage"), json=payload)
    except httpx.HTTPError as e:
        log.warning("[tg] sendMessage failed: %s", type(e).__name__)
        return None
    if r.status_code != 200:
        # 403 — игрок остановил бота; 400 — чат не найден. Повторять не нужно
        log.info("[tg] sendMessage status %s", r.status_code)
        return None
    try:
        return _message_id(r.json())
    except ValueError:
        return None


async def send_photo(
    chat_id: int,
    photo: bytes,
    *,
    filename: str,
    mime: str,
    caption: str | None = None,
    reply_markup: dict | None = None,
) -> int | None:
    """Отправка картинки в память: файл на диск не пишется."""
    token = _token()
    if not token or not chat_id or not photo:
        return None
    data: dict[str, str] = {"chat_id": str(int(chat_id))}
    if caption:
        data["caption"] = caption[:1024]
    if reply_markup is not None:
        data["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
    name = filename or "photo.jpg"
    try:
        async with _async_client(timeout=30) as client:
            r = await client.post(
                _API.format(token=token, method="sendPhoto"),
                data=data,
                files={"photo": (name, photo, mime)},
            )
    except httpx.HTTPError as e:
        log.warning("[tg] sendPhoto failed: %s", type(e).__name__)
        return None
    if r.status_code != 200:
        log.info("[tg] sendPhoto status %s", r.status_code)
        return None
    try:
        return _message_id(r.json())
    except ValueError:
        return None
