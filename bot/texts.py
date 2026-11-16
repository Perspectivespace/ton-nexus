"""Тексты бота на языке игрока: RU для ru / uk / be / kk из Telegram, остальным — EN (как в Mini App)."""

from __future__ import annotations

RU_FAMILY = frozenset({"ru", "uk", "be", "kk"})

TEXTS: dict[str, dict[str, str]] = {
    "ru": {
        "open": "Открыть Neon Nexus",
        "welcome": "<b>Neon Nexus</b>\n<i>на TON</i>\n\nЗадания · майнер · уровни · вывод TON\n\nНажми кнопку ниже, чтобы открыть приложение.",
        "no_url": "\n\n⚠️ WEBAPP_URL не задан. Укажи URL Mini App в переменных окружения бота.",
        "help": (
            "Команды:\n"
            "/start — открыть Mini App\n"
            "/app — то же\n"
            "/help — справка\n\n"
            "Вывод, майнер и задания — только внутри приложения."
        ),
    },
    "en": {
        "open": "Open Neon Nexus",
        "welcome": "<b>Neon Nexus</b>\n<i>on TON</i>\n\nTasks · miner · levels · TON withdrawals\n\nTap the button below to open the app.",
        "no_url": "\n\n⚠️ WEBAPP_URL is not set. Add the Mini App URL to the bot's environment.",
        "help": (
            "Commands:\n"
            "/start — open the Mini App\n"
            "/app — same\n"
            "/help — help\n\n"
            "Withdrawals, the miner and tasks live inside the app."
        ),
    },
}


def lang_for(language_code: str | None) -> str:
    """Язык по language_code из Telegram (бот — отдельный процесс, базу не читает)."""
    base = (language_code or "").strip().lower().replace("_", "-").split("-", 1)[0]
    return "ru" if base in RU_FAMILY else "en"


def text(key: str, language_code: str | None) -> str:
    return TEXTS[lang_for(language_code)][key]
