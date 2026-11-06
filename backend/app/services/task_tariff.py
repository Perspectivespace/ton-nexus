"""Тариф заданий — настройка `task_tariff` (расчёт цены; публикация заданий его ещё не читает).

Владелец задаёт награду (TON) и XP за одно выполнение для трёх уровней сложности:
лёгкое / среднее / сложное. Заказчик при публикации платит
`награда × число выполнений + комиссия платформы`; исполнитель получает награду,
XP — из тарифа по сложности.

Комиссия платформы — из существующей настройки `task_platform_commission_bp`
(один источник правды; в `task_tariff` комиссии нет).

Все суммы в расчёте — целые нанотоны (1 TON = 10⁹); баланс хранит 8 знаков после
точки, поэтому нанотоны кратны 10 (LEDGER_QUANTUM_NANO).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

KEY = "task_tariff"
LEVELS = ("easy", "normal", "hard")
LEVEL_RU = {"easy": "лёгкое", "normal": "среднее", "hard": "сложное"}

NANO_PER_TON = 10**9
# Numeric(18, 8) в балансе → наименьший шаг 10 нанотонов
LEDGER_QUANTUM_NANO = 10
# разумные потолки в настройке владельца
MAX_REWARD_NANO = 100 * NANO_PER_TON  # 100 TON за одно выполнение
MAX_XP = 100_000
MAX_SLOTS = 10_000
MIN_SLOTS = 1

DEFAULT: dict[str, Any] = {
    "levels": {
        "easy": {"reward": "0.01", "xp": 5},
        "normal": {"reward": "0.02", "xp": 10},
        "hard": {"reward": "0.05", "xp": 20},
    },
    "min_slots": 1,
    "max_slots": 10_000,
}


class TaskTariffError(ValueError):
    pass


def ton_to_nano(value: Any, *, name: str = "сумма") -> int:
    """Строка TON → нанотоны; >0, не больше 8 знаков после точки, кратно кванту баланса."""
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise TaskTariffError(f"{name}: сумма TON строкой, например \"0.01\"")
    s = str(value).strip().replace(",", ".")
    try:
        d = Decimal(s)
    except InvalidOperation as e:
        raise TaskTariffError(f"{name}: сумма TON — число") from e
    if not d.is_finite() or d <= 0:
        raise TaskTariffError(f"{name}: должна быть больше 0")
    if d * NANO_PER_TON != (d * NANO_PER_TON).to_integral_value():
        # больше 9 знаков — уже не нанотоны
        raise TaskTariffError(f"{name}: не больше 9 знаков после точки")
    nano = int(d * NANO_PER_TON)
    if nano > MAX_REWARD_NANO:
        raise TaskTariffError(f"{name}: не больше 100 TON")
    if nano % LEDGER_QUANTUM_NANO != 0:
        raise TaskTariffError(f"{name}: не больше 8 знаков после точки")
    return nano


def nano_to_ton(nano: int) -> str:
    """Нанотоны → строка TON без хвоста нулей (и без научной записи)."""
    if nano < 0:
        raise TaskTariffError("отрицательная сумма")
    whole, frac = divmod(int(nano), NANO_PER_TON)
    f = f"{frac:09d}".rstrip("0")
    return f"{whole}.{f}" if f else f"{whole}"


def _xp(v: Any, name: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise TaskTariffError(f"{name}: XP — целое число")
    if not 0 <= v <= MAX_XP:
        raise TaskTariffError(f"{name}: XP от 0 до {MAX_XP}")
    return v


def _slots(v: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise TaskTariffError(f"{name}: целое число")
    if not lo <= v <= hi:
        raise TaskTariffError(f"{name}: от {lo} до {hi}")
    return v


def normalize(value: Any) -> dict[str, Any]:
    """Проверить и привести тариф к каноническому виду (строки TON, int XP/места)."""
    if not isinstance(value, dict):
        raise TaskTariffError("Тариф заданий должен быть объектом")
    extra = set(value) - {"levels", "min_slots", "max_slots"}
    if extra:
        raise TaskTariffError(f"тариф: лишние поля {sorted(extra)}")
    raw_levels = value.get("levels")
    if not isinstance(raw_levels, dict):
        raise TaskTariffError("levels: нужен объект с easy / normal / hard")
    missing = [lv for lv in LEVELS if lv not in raw_levels]
    if missing:
        raise TaskTariffError(f"levels: нет уровня {', '.join(missing)}")
    extra_lv = set(raw_levels) - set(LEVELS)
    if extra_lv:
        raise TaskTariffError(f"levels: лишние уровни {sorted(extra_lv)}")

    levels: dict[str, dict[str, Any]] = {}
    for lv in LEVELS:
        row = raw_levels[lv]
        if not isinstance(row, dict):
            raise TaskTariffError(f"{LEVEL_RU[lv]}: нужен объект {{reward, xp}}")
        extra_row = set(row) - {"reward", "xp"}
        if extra_row:
            raise TaskTariffError(f"{LEVEL_RU[lv]}: лишние поля {sorted(extra_row)}")
        nano = ton_to_nano(row.get("reward"), name=f"{LEVEL_RU[lv]} · награда")
        levels[lv] = {"reward": nano_to_ton(nano), "xp": _xp(row.get("xp"), f"{LEVEL_RU[lv]} · XP")}

    min_slots = _slots(value.get("min_slots", MIN_SLOTS), "min_slots", MIN_SLOTS, MAX_SLOTS)
    max_slots = _slots(value.get("max_slots", MAX_SLOTS), "max_slots", MIN_SLOTS, MAX_SLOTS)
    if min_slots > max_slots:
        raise TaskTariffError("min_slots не может быть больше max_slots")
    return {"levels": levels, "min_slots": min_slots, "max_slots": max_slots}


@dataclass(frozen=True)
class Quote:
    level: str
    slots: int
    reward_nano: int
    payout_nano: int
    commission_nano: int
    total_nano: int
    xp: int

    @property
    def reward(self) -> str:
        return nano_to_ton(self.reward_nano)

    @property
    def payout(self) -> str:
        return nano_to_ton(self.payout_nano)

    @property
    def commission(self) -> str:
        return nano_to_ton(self.commission_nano)

    @property
    def total(self) -> str:
        return nano_to_ton(self.total_nano)


def quote(
    tariff: dict[str, Any],
    *,
    level: str,
    slots: int,
    commission_bp: int,
) -> Quote:
    """Цена задания по тарифу.

    payout = reward × slots;
    commission = floor(payout × bp / 10000) вниз до кванта баланса;
    total = payout + commission.
    Комиссия берётся снаружи (из `task_platform_commission_bp`), не из тарифа.
    """
    cfg = normalize(tariff)
    if level not in LEVELS:
        raise TaskTariffError(f"уровень: easy, normal или hard (не {level!r})")
    if isinstance(commission_bp, bool) or not isinstance(commission_bp, int):
        raise TaskTariffError("комиссия: целые bp")
    if not 0 <= commission_bp <= 10_000:
        raise TaskTariffError("комиссия: от 0 до 10000 bp")
    if not isinstance(slots, int) or isinstance(slots, bool):
        raise TaskTariffError("число мест — целое")
    if not cfg["min_slots"] <= slots <= cfg["max_slots"]:
        raise TaskTariffError(
            f"число мест: от {cfg['min_slots']} до {cfg['max_slots']}"
        )

    row = cfg["levels"][level]
    reward_nano = ton_to_nano(row["reward"], name="награда")
    payout_nano = reward_nano * slots
    # целочисленно, затем вниз до шага баланса (8 знаков)
    raw_commission = payout_nano * commission_bp // 10_000
    commission_nano = raw_commission - (raw_commission % LEDGER_QUANTUM_NANO)
    return Quote(
        level=level,
        slots=slots,
        reward_nano=reward_nano,
        payout_nano=payout_nano,
        commission_nano=commission_nano,
        total_nano=payout_nano + commission_nano,
        xp=int(row["xp"]),
    )
