"""Validate Telegram WebApp initData (HMAC-SHA256)."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from app.core.config import settings


class TelegramAuthError(Exception):
    pass


def _secret_key(bot_token: str) -> bytes:
    return hmac.new(
        b"WebAppData",
        bot_token.encode(),
        hashlib.sha256,
    ).digest()


def validate_init_data(
    init_data: str,
    *,
    bot_token: str | None = None,
    max_age_sec: int = 86400,
) -> dict:
    token = bot_token or settings.telegram_bot_token
    if not token:
        raise TelegramAuthError("TELEGRAM_BOT_TOKEN not configured")

    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise TelegramAuthError("missing hash")

    data_check = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    computed = hmac.new(
        _secret_key(token),
        data_check.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(computed, received_hash):
        raise TelegramAuthError("invalid hash")

    auth_date = int(parsed.get("auth_date", "0"))
    if max_age_sec and (time.time() - auth_date) > max_age_sec:
        raise TelegramAuthError("initData expired")

    user_raw = parsed.get("user")
    if not user_raw:
        raise TelegramAuthError("missing user")

    user = json.loads(user_raw)
    return {
        "user": user,
        "auth_date": auth_date,
        "query_id": parsed.get("query_id"),
        "start_param": parsed.get("start_param"),
    }


def is_owner(telegram_id: int) -> bool:
    raw = settings.telegram_owner_ids or ""
    ids = {int(x.strip()) for x in raw.split(",") if x.strip().isdigit()}
    return telegram_id in ids
