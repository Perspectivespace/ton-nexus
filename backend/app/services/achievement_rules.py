"""Достижения: настройка (economy_settings → «achievements») и её проверка.

Ветки: tasks — принятые задания; miner — уровень майнера (сумма пяти параметров); games — сыгранные игры
(арена, башня, колесо удачи); level — уровень аккаунта; ambassador — размещённые задания (только значки, без TON).
Каждая ступень: порог `at`, награда `ton` и `xp`, `enabled`. Владелец меняет всё в админке без правки кода.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

KEY = "achievements"
BRANCHES = ("tasks", "miner", "games", "level", "ambassador")
BADGE_ONLY = ("ambassador",)  # ветки без TON: только значок
METALS = ("bronze", "silver", "gold", "platinum", "neon")
MAX_TIERS = 20
MAX_TON = Decimal("1000")
MAX_XP = 100000
# тиры «Честности», при которых награда идёт на ручное подтверждение (если включено manual_low_integrity)
LOW_INTEGRITY = ("hostile", "unfriendly")

# названия веток (бот, админка). Значки на экранах подписываются на клиенте
BRANCH_NAMES = {
    "tasks": ("Задания", "Tasks"),
    "miner": ("Уровень майнера", "Miner level"),
    "games": ("Сыграно игр", "Games played"),
    "level": ("Уровень аккаунта", "Account level"),
    "ambassador": ("Амбассадор", "Ambassador"),
}
# звания амбассадора по ступеням (по порядку порогов)
AMBASSADOR_TITLES = (
    ("Проверенный амбассадор", "Verified Ambassador"),
    ("Активный амбассадор", "Active Ambassador"),
    ("Надёжный амбассадор", "Trusted Ambassador"),
    ("Элитный амбассадор", "Elite Ambassador"),
    ("Легендарный амбассадор", "Legendary Ambassador"),
)


def _tiers(pairs: list[tuple[int, str]], xp_step: int = 10) -> list[dict[str, Any]]:
    return [{"at": at, "ton": ton, "xp": xp_step * (i + 1), "enabled": True} for i, (at, ton) in enumerate(pairs)]


DEFAULT: dict[str, Any] = {
    "enabled": True,
    # засчитывать прогресс, накопленный до включения (тест). Выключение = «старт с нуля» с момента start_at
    "retroactive": True,
    "start_at": None,
    # награды от этой суммы — на ручное подтверждение владельцем
    "manual_from_ton": "10",
    # «Честность»: награды игрокам с низким тиром — тоже на ручное подтверждение (по умолчанию выкл.: теневой режим)
    "manual_low_integrity": False,
    "branches": {
        "tasks": {"enabled": True, "tiers": _tiers([
            (10, "0.03"), (25, "0.06"), (50, "0.1"), (100, "0.2"), (250, "0.5"),
            (500, "1"), (1000, "5"), (2500, "10"), (5000, "20"),
        ])},
        "miner": {"enabled": True, "tiers": _tiers([
            (5, "0"), (10, "0.07"), (25, "0.25"), (50, "1"), (75, "1.5"), (100, "2"), (120, "5"),
        ])},
        "games": {"enabled": True, "tiers": _tiers([
            (50, "0"), (100, "0.03"), (250, "0.05"), (500, "0.15"), (1000, "0.5"),
            (2000, "1"), (3000, "3"), (5000, "5"), (7500, "8"), (10000, "10"),
        ])},
        "level": {"enabled": True, "tiers": _tiers([
            (5, "0.03"), (10, "0.1"), (20, "0.5"), (30, "1"), (50, "3"), (75, "5"),
            (100, "8"), (150, "10"), (200, "12"), (250, "15"), (300, "20"),
        ])},
        "ambassador": {"enabled": True, "tiers": _tiers([(1, "0"), (10, "0"), (50, "0"), (100, "0"), (300, "0")], xp_step=0)},
    },
}


class AchievementRulesError(ValueError):
    pass


def defaults() -> dict[str, Any]:
    import copy

    return copy.deepcopy(DEFAULT)


def metal(index: int, count: int) -> str:
    """Металл значка по месту ступени в ветке: бронза → серебро → золото → платина; последняя — неон."""
    if count <= 0:
        return METALS[0]
    if index >= count - 1:
        return METALS[-1]
    return METALS[min(3, index * 5 // count)]


def _ton(v: Any, where: str) -> str:
    try:
        d = Decimal(str(v).strip().replace(",", "."))
    except (InvalidOperation, ValueError) as e:
        raise AchievementRulesError(f"{where}: TON — число") from e
    if not d.is_finite() or d < 0 or d > MAX_TON:
        raise AchievementRulesError(f"{where}: TON — от 0 до {MAX_TON}")
    d = d.quantize(Decimal("0.00000001"))
    s = format(d.normalize(), "f")
    return s


def _int(v: Any, where: str, lo: int, hi: int) -> int:
    if isinstance(v, bool):
        raise AchievementRulesError(f"{where}: целое число")
    try:
        n = int(str(v).strip())
    except (TypeError, ValueError) as e:
        raise AchievementRulesError(f"{where}: целое число") from e
    if not lo <= n <= hi:
        raise AchievementRulesError(f"{where}: от {lo} до {hi}")
    return n


def _start_at(v: Any) -> str | None:
    if v in (None, ""):
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError as e:
        raise AchievementRulesError("start_at: дата ISO") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def normalize(value: Any, prev: dict[str, Any] | None = None, now: datetime | None = None) -> dict[str, Any]:
    """Проверка настройки из админки. Выключение «засчитывать прошлое» ставит start_at = сейчас
    (если его ещё нет); включение обратно стирает start_at."""
    if not isinstance(value, dict):
        raise AchievementRulesError("настройка достижений — объект")
    d = defaults()
    out: dict[str, Any] = {
        "enabled": bool(value.get("enabled", d["enabled"])),
        "retroactive": bool(value.get("retroactive", d["retroactive"])),
        "manual_from_ton": _ton(value.get("manual_from_ton", d["manual_from_ton"]), "Порог ручного подтверждения"),
        "manual_low_integrity": bool(value.get("manual_low_integrity", d["manual_low_integrity"])),
    }
    if out["retroactive"]:
        out["start_at"] = None
    else:
        start = _start_at(value.get("start_at")) or _start_at((prev or {}).get("start_at"))
        out["start_at"] = start or (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
    raw_branches = value.get("branches", d["branches"])
    if not isinstance(raw_branches, dict):
        raise AchievementRulesError("branches — объект")
    branches: dict[str, Any] = {}
    for key in BRANCHES:
        b = raw_branches.get(key, d["branches"][key])
        name = BRANCH_NAMES[key][0]
        if not isinstance(b, dict) or not isinstance(b.get("tiers"), list):
            raise AchievementRulesError(f"{name}: нужен список ступеней")
        tiers = b["tiers"]
        if not 1 <= len(tiers) <= MAX_TIERS:
            raise AchievementRulesError(f"{name}: от 1 до {MAX_TIERS} ступеней")
        seen: set[int] = set()
        clean = []
        for i, t in enumerate(tiers, 1):
            where = f"{name}, ступень {i}"
            if not isinstance(t, dict):
                raise AchievementRulesError(f"{where}: объект")
            at = _int(t.get("at"), f"{where}, порог", 1, 10_000_000)
            if at in seen:
                raise AchievementRulesError(f"{name}: порог {at} повторяется")
            seen.add(at)
            ton = "0" if key in BADGE_ONLY else _ton(t.get("ton", "0"), where)
            clean.append({
                "at": at,
                "ton": ton,
                "xp": _int(t.get("xp", 0), f"{where}, XP", 0, MAX_XP),
                "enabled": bool(t.get("enabled", True)),
            })
        clean.sort(key=lambda t: t["at"])
        branches[key] = {"enabled": bool(b.get("enabled", True)), "tiers": clean}
    out["branches"] = branches
    return out


def merged(value: Any) -> dict[str, Any]:
    """Сохранённая настройка поверх значений по умолчанию; битая запись — значения по умолчанию."""
    if not isinstance(value, dict):
        return defaults()
    try:
        base = defaults()
        raw = {**base, **value, "branches": {**base["branches"], **(value.get("branches") or {})}}
        return normalize(raw, prev=value)
    except AchievementRulesError:
        return defaults()
