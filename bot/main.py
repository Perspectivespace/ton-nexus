"""
Thin Telegram bot — /start + Mini App button.
No business logic; all economy lives in FastAPI.
"""

from __future__ import annotations

import asyncio
import logging
import os

from aiogram import Bot, Dispatcher
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ton-nexus-bot")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "").rstrip("/")
OWNER_IDS = {
    int(x.strip())
    for x in os.getenv("TELEGRAM_OWNER_IDS", "").split(",")
    if x.strip().isdigit()
}


def webapp_keyboard() -> InlineKeyboardMarkup | None:
    if not WEBAPP_URL:
        return None
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть TON Nexus",
                    web_app=WebAppInfo(url=WEBAPP_URL),
                )
            ]
        ]
    )


WELCOME = (
    "<b>TON Nexus</b>\n\n"
    "Задания · майнер · уровни · вывод TON\n\n"
    "Нажми кнопку ниже, чтобы открыть приложение."
)


async def cmd_start(message: Message) -> None:
    kb = webapp_keyboard()
    text = WELCOME
    if not kb:
        text += (
            "\n\n⚠️ WEBAPP_URL не задан. "
            "Укажи URL Mini App в переменных окружения бота."
        )
    await message.answer(text, reply_markup=kb, parse_mode="HTML")


async def cmd_app(message: Message) -> None:
    await cmd_start(message)


async def cmd_help(message: Message) -> None:
    await message.answer(
        "Команды:\n"
        "/start — открыть Mini App\n"
        "/app — то же\n"
        "/help — справка\n\n"
        "Вывод, майнер и задания — только внутри приложения."
    )


async def cmd_ping(message: Message) -> None:
    if message.from_user and message.from_user.id in OWNER_IDS:
        await message.answer("pong · owner")
    else:
        await message.answer("pong")


async def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("TELEGRAM_BOT_TOKEN is required")

    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()

    dp.message.register(cmd_start, CommandStart())
    dp.message.register(cmd_app, Command("app"))
    dp.message.register(cmd_help, Command("help"))
    dp.message.register(cmd_ping, Command("ping"))

    log.info("starting thin bot; webapp=%s", WEBAPP_URL or "(not set)")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
