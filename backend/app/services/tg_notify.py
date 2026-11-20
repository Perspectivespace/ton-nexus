"""Сообщения игрокам от имени бота (Bot API sendMessage). Без токена — ничего не отправляем."""

from __future__ import annotations

import logging

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


async def send_message(chat_id: int, text: str) -> bool:
    token = (settings.telegram_bot_token or "").strip()
    if not token or not chat_id:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": int(chat_id), "text": text[:4000], "disable_web_page_preview": True},
            )
    except httpx.HTTPError as e:
        log.warning("[tg] sendMessage failed: %s", type(e).__name__)
        return False
    if r.status_code != 200:
        # 403 — игрок остановил бота; 400 — чат не найден. Повторять не нужно
        log.info("[tg] sendMessage status %s", r.status_code)
        return False
    return True
