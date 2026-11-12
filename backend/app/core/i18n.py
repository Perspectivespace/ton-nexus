"""Язык игрока: ru / en. Пока два языка; новый добавляется в SUPPORTED и в словари (docs/i18n.md)."""

from __future__ import annotations

SUPPORTED = ("ru", "en")
DEFAULT = "en"
# Русскоязычная аудитория: русский, украинский, белорусский, казахский — им по умолчанию RU
RU_FAMILY = frozenset({"ru", "uk", "be", "kk"})


def normalize(lang: str | None) -> str | None:
    """'en' / 'RU' / 'en-US' → поддерживаемый код; неизвестное → None."""
    if not lang:
        return None
    base = str(lang).strip().lower().replace("_", "-").split("-", 1)[0]
    return base if base in SUPPORTED else None


def detect(language_code: str | None) -> str:
    """Язык первого входа по language_code из Telegram initData."""
    if not language_code:
        return DEFAULT
    base = str(language_code).strip().lower().replace("_", "-").split("-", 1)[0]
    return "ru" if base in RU_FAMILY else DEFAULT


def user_lang(user) -> str:
    """Выбор игрока, а если его нет — язык Telegram."""
    return normalize(getattr(user, "lang", None)) or detect(getattr(user, "language_code", None))
