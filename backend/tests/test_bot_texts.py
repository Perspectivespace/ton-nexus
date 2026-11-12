"""Бот отвечает на /start и /help на языке игрока из Telegram (bot/texts.py)."""

from __future__ import annotations

import importlib.util
import pathlib
import re
import unittest

_PATH = pathlib.Path(__file__).resolve().parents[2] / "bot" / "texts.py"
texts = None
if _PATH.exists():  # в образе бэкенда папки бота нет
    _spec = importlib.util.spec_from_file_location("bot_texts", _PATH)
    texts = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(texts)
CY = re.compile("[\u0400-\u04ff]")


@unittest.skipIf(texts is None, "нет bot/texts.py рядом с backend")
class BotTexts(unittest.TestCase):
    def test_language_from_telegram(self):
        for code in ("ru", "uk", "be", "kk", "ru-RU"):
            self.assertEqual(texts.lang_for(code), "ru", code)
        for code in ("en", "de", "", None):
            self.assertEqual(texts.lang_for(code), "en", code)

    def test_same_keys_and_english_is_english(self):
        self.assertEqual(set(texts.TEXTS["ru"]), set(texts.TEXTS["en"]))
        for k, v in texts.TEXTS["en"].items():
            self.assertFalse(CY.search(v), k)
            self.assertTrue(v.strip(), k)

    def test_text(self):
        self.assertIn("Commands", texts.text("help", "en-US"))
        self.assertIn("Команды", texts.text("help", "uk"))
