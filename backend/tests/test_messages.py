"""Тексты сервера на языке игрока: у каждой ошибки для игрока есть перевод, X-Lang переводит ответ API."""

from __future__ import annotations

import ast
import itertools
import pathlib
import re
import unittest
from decimal import Decimal as D
from unittest import mock

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.messages import EN, localize, request_lang
from app.db.base import Base
from app.models import User

APP = pathlib.Path(__file__).resolve().parents[1] / "app"
CY = re.compile("[\u0400-\u04ff]")
# Служебное: админка владельца, Касса, деплой и настройки экономики остаются по-русски
STAFF: dict[str, object] = {
    "api/deploy.py": "*",
    "api/tower.py": {"_owner"},
    "api/withdraw.py": {"review_withdraw", "payout_check"},
    "services/arena_config.py": "*",
    "services/city_ads.py": {"normalize", "moderation_queue", "approve", "reject"},
    "services/economy_admin.py": "*",
    "services/integrity_rules.py": "*",  # настройка «Честности» — только владелец
    "services/ratings.py": {"normalize_friend_rule"},
    "services/secret_promo.py": {"create_campaign", "disable", "list_campaigns"},
    "services/task_owner.py": "*",
    "services/task_proofs.py": {"read_for_reviewer"},
    "services/task_tariff.py": {"normalize", "_bp", "_slots", "_xp"},
    "services/ton_deposits.py": {"assign_manual"},
    "services/ton_payouts.py": "*",
    "services/tower_close.py": "*",
    "services/tower_prizes.py": "*",
}
_SKIP_NAMES = {"str", "int", "sorted", "join", "ton_str", "len", "round", "float", "cfg", "self"}


def template(node: ast.JoinedStr) -> str:
    """f-строка → шаблон каталога: значения — {имя} по последнему имени в выражении."""
    out, used = [], {}
    for v in node.values:
        if isinstance(v, ast.Constant):
            out.append(v.value)
            continue
        names = [n for n in re.findall(r"[A-Za-z_]\w*", ast.unparse(v.value)) if n not in _SKIP_NAMES]
        n = names[-1] if names else "v"
        used[n] = used.get(n, 0) + 1
        out.append("{" + (n if used[n] == 1 else f"{n}{used[n]}") + "}")
    return "".join(out)


def player_messages() -> dict[str, str]:
    """Русские тексты в raise … для игрока (вне служебных функций) → где встречаются."""
    found: dict[str, str] = {}
    for path in sorted(APP.rglob("*.py")):
        rel = path.relative_to(APP).as_posix()
        staff = STAFF.get(rel)
        if staff == "*":
            continue
        stack: list[str] = []

        class V(ast.NodeVisitor):
            def visit_FunctionDef(self, n):
                stack.append(n.name)
                self.generic_visit(n)
                stack.pop()

            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_Raise(self, n):
                fn = stack[0] if stack else "<module>"
                if isinstance(n.exc, ast.Call) and not (staff and fn in staff):
                    args = list(n.exc.args) + [k.value for k in n.exc.keywords if k.arg == "detail"]
                    for a in args:
                        if isinstance(a, ast.Constant) and isinstance(a.value, str) and CY.search(a.value):
                            found.setdefault(a.value, f"{rel}:{n.lineno}")
                        elif isinstance(a, ast.JoinedStr) and CY.search(ast.unparse(a)):
                            found.setdefault(template(a), f"{rel}:{n.lineno}")
                self.generic_visit(n)

        V().visit(ast.parse(path.read_text(encoding="utf-8")))
    return found


class Catalog(unittest.TestCase):
    def test_every_player_error_has_english(self):
        missing = {k: v for k, v in player_messages().items() if k not in EN}
        self.assertEqual(missing, {}, "добавьте перевод в app/core/messages.py")

    def test_balance_history_labels_have_english(self):
        from app.services import balance_history as bh

        for s in [*bh.LABELS.values(), *bh.WITHDRAW_STATUS_RU.values()]:
            self.assertIn(s, EN)

    def test_english_has_no_cyrillic_and_same_placeholders(self):
        for ru, en in EN.items():
            self.assertFalse(CY.search(en), en)
            self.assertEqual(sorted(re.findall(r"\{(\w+)\}", ru)), sorted(re.findall(r"\{(\w+)\}", en)), ru)


class Localize(unittest.TestCase):
    def test_exact_and_template(self):
        self.assertEqual(localize("Неверная сумма", "en"), "Invalid amount")
        self.assertEqual(localize("Минимум 0.5 TON", "en"), "Minimum 0.5 TON")
        # название поля внутри шаблона тоже переводится — клиент узнаёт поле по началу строки
        self.assertEqual(localize("Подпись баннера: не длиннее 18 символов", "en"), "Subtitle: 18 characters max")
        self.assertEqual(localize("Недостаточно TON: нужно 1 TON, на балансе 0.2 TON.", "en"), "Not enough TON: 1 TON needed, you have 0.2 TON.")

    def test_russian_unknown_and_missing_lang_stay_as_is(self):
        self.assertEqual(localize("Неверная сумма", "ru"), "Неверная сумма")
        self.assertEqual(localize("Неверная сумма", None), "Неверная сумма")
        self.assertEqual(localize("совсем новая ошибка", "en"), "совсем новая ошибка")
        self.assertEqual(localize("miner not found", "en"), "miner not found")

    def test_request_lang(self):
        self.assertEqual(request_lang("EN"), "en")
        self.assertIsNone(request_lang("de"))
        self.assertIsNone(request_lang(None))


_TG = itertools.count(62000)


class Api(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.db.session import get_db
        from app.main import app

        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.addAsyncCleanup(self.engine.dispose)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

        async def _db():
            async with self.S() as s:
                yield s

        app.dependency_overrides[get_db] = _db
        self.addCleanup(app.dependency_overrides.clear)
        p = mock.patch.object(settings, "debug", True)
        p.start()
        self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def user(self, **kw) -> tuple[int, int]:
        tg = next(_TG)
        async with self.S() as s:
            u = User(telegram_id=tg, balance=D("0"), level=1, **kw)
            s.add(u)
            await s.commit()
            return tg, u.id

    async def test_error_follows_x_lang(self):
        tg, _ = await self.user()
        h = {"X-Telegram-Init-Data": f"dev:{tg}"}
        ru = await self.client.get("/api/v1/deposits/tx-payload?amount=abc", headers={**h, "X-Lang": "ru"})
        en = await self.client.get("/api/v1/deposits/tx-payload?amount=abc", headers={**h, "X-Lang": "en"})
        bare = await self.client.get("/api/v1/deposits/tx-payload?amount=abc", headers=h)
        self.assertEqual(ru.status_code, 400)
        self.assertTrue(CY.search(ru.json()["detail"]))
        self.assertEqual(en.json()["detail"], EN[ru.json()["detail"]])
        self.assertEqual(bare.json()["detail"], ru.json()["detail"])  # без заголовка — как раньше

    async def test_balance_history_labels_in_player_language(self):
        from app.services import balance as balance_svc

        tg, uid = await self.user(lang="en")
        async with self.S() as s:
            await balance_svc.credit(s, user_id=uid, amount=D("0.01"), balance_type="daily")
            await s.commit()
        h = {"X-Telegram-Init-Data": f"dev:{tg}"}
        item = (await self.client.get("/api/v1/balance/history", headers=h)).json()["items"][0]
        self.assertEqual(item["label"], "Daily bonus")  # без X-Lang — по выбору игрока
        item = (await self.client.get("/api/v1/balance/history", headers={**h, "X-Lang": "ru"})).json()["items"][0]
        self.assertEqual(item["label"], "Ежедневный бонус")
