"""Призы топа «Башни» за месяц — настройка `tower_prizes` (только расчёт; денег не двигает).

Владелец задаёт месячный бюджет в TON. Призы есть, только если в месяце не меньше
`min_participants` участников (иначе бюджет не тратится). Призовых мест `base_places`
(3), и ещё по одному за каждые `extra_place_every` (20) участников сверх первых:
21+ → 4, 41+ → 5, но не больше `max_places`. Бюджет делится по долям `shares`
для текущего числа мест (сумма долей — 100 %). Каждая сумма округляется ВНИЗ до
0.0001 TON, поэтому сумма выплат никогда не превышает бюджет; остаток не тратится.

Выплат здесь нет — только ручная проверка владельцем (`payout_mode: review`).
"""

from __future__ import annotations

from decimal import ROUND_DOWN, Decimal, InvalidOperation
from typing import Any

KEY = "tower_prizes"
DEFAULT: dict[str, Any] = {
    "enabled": False,
    "budget_ton": "0",
    "min_participants": 10,
    "base_places": 3,
    "extra_place_every": 20,
    "max_places": 5,
    "shares": {
        "3": [50, 30, 20],
        "4": [40, 27, 20, 13],
        "5": [35, 25, 18, 13, 9],
    },
    "min_score": 1,
    "payout_mode": "review",
}
FIELDS = frozenset(DEFAULT)
PLACES_CAP = 10
MAX_BUDGET = Decimal("100000")
STEP = Decimal("0.0001")
# авто-выплат пока нет — только ручная проверка владельцем
PAYOUT_MODES = ("review",)


class PrizeConfigError(ValueError):
    pass


def _int(v: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise PrizeConfigError(f"{name}: нужно целое число")
    if not lo <= v <= hi:
        raise PrizeConfigError(f"{name}: от {lo} до {hi}")
    return v


def _budget(v: Any) -> str:
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        raise PrizeConfigError("budget_ton: сумма TON строкой, например \"10\"")
    try:
        d = Decimal(str(v).strip())
    except InvalidOperation as e:
        raise PrizeConfigError("budget_ton: сумма TON — число") from e
    if not d.is_finite() or d < 0 or d > MAX_BUDGET:
        raise PrizeConfigError(f"budget_ton: от 0 до {MAX_BUDGET} TON")
    if d != d.quantize(STEP, rounding=ROUND_DOWN):
        raise PrizeConfigError("budget_ton: не больше 4 знаков после точки")
    return format(d.normalize(), "f") if d else "0"


def _shares(raw: Any, base: int, top: int) -> dict[str, list[int]]:
    if not isinstance(raw, dict):
        raise PrizeConfigError("shares: нужен объект «число мест → доли в %»")
    need = {str(n) for n in range(base, top + 1)}
    if set(raw) != need:
        raise PrizeConfigError(f"shares: нужны доли ровно для {', '.join(sorted(need, key=int))} мест")
    out: dict[str, list[int]] = {}
    for k in sorted(need, key=int):
        row = raw[k]
        n = int(k)
        if not isinstance(row, list) or len(row) != n:
            raise PrizeConfigError(f"shares {k}: нужно {n} долей")
        vals = [_int(x, f"shares {k}", 1, 100) for x in row]
        if sum(vals) != 100:
            raise PrizeConfigError(f"shares {k}: сумма долей {sum(vals)} %, нужно 100 %")
        if any(b > a for a, b in zip(vals, vals[1:])):
            raise PrizeConfigError(f"shares {k}: место ниже не может получать больше места выше")
        out[k] = vals
    return out


def normalize(value: Any) -> dict[str, Any]:
    """Проверить и привести к каноническому виду. Ошибка — PrizeConfigError с русским текстом."""
    if not isinstance(value, dict):
        raise PrizeConfigError("tower_prizes: нужен объект")
    extra = set(value) - FIELDS
    if extra:
        raise PrizeConfigError(f"tower_prizes: лишние поля {sorted(extra)}")
    out = {**DEFAULT, **value}
    if not isinstance(out["enabled"], bool):
        raise PrizeConfigError("enabled: true или false")
    budget = _budget(out["budget_ton"])
    if out["enabled"] and Decimal(budget) <= 0:
        raise PrizeConfigError("Чтобы включить призы, задайте бюджет больше 0 TON")
    base = _int(out["base_places"], "base_places", 1, PLACES_CAP)
    top = _int(out["max_places"], "max_places", 1, PLACES_CAP)
    if top < base:
        raise PrizeConfigError("max_places: не меньше base_places")
    every = _int(out["extra_place_every"], "extra_place_every", 0, 100000)
    minp = _int(out["min_participants"], "min_participants", 1, 100000)
    if minp < base:
        raise PrizeConfigError("min_participants: не меньше числа призовых мест")
    if out["payout_mode"] not in PAYOUT_MODES:
        raise PrizeConfigError(f"payout_mode: пока только {', '.join(PAYOUT_MODES)}")
    return {
        "enabled": out["enabled"],
        "budget_ton": budget,
        "min_participants": minp,
        "base_places": base,
        "extra_place_every": every,
        "max_places": top,
        "shares": _shares(out["shares"], base, top),
        "min_score": _int(out["min_score"], "min_score", 1, 10**9),
        "payout_mode": out["payout_mode"],
    }


def safe(value: Any) -> dict[str, Any]:
    """Для чтения: битая запись в базе не роняет топ — призы считаются выключенными."""
    try:
        return normalize(value)
    except PrizeConfigError:
        return normalize(DEFAULT)


def places_for(cfg: dict[str, Any], participants: int) -> int:
    """Сколько призовых мест при таком числе участников (0 — ниже минимума)."""
    if participants < cfg["min_participants"]:
        return 0
    extra = (participants - 1) // cfg["extra_place_every"] if cfg["extra_place_every"] else 0
    return min(cfg["max_places"], cfg["base_places"] + extra)


def next_place_at(cfg: dict[str, Any], participants: int) -> int | None:
    """При каком числе участников станет на одно призовое место больше (None — уже максимум)."""
    n = places_for(cfg, participants)
    if n == 0:
        return cfg["min_participants"]
    if n >= cfg["max_places"] or not cfg["extra_place_every"]:
        return None
    # n = base + (p-1)//every → следующее место при p = (n - base + 1) * every + 1
    return max(cfg["min_participants"], (n - cfg["base_places"] + 1) * cfg["extra_place_every"] + 1)


def split(budget: Decimal, shares: list[int]) -> list[Decimal]:
    """Доли бюджета, каждая вниз до 0.0001 TON. Сумма ≤ бюджета, остаток не тратится."""
    amounts = [(budget * Decimal(s) / Decimal(100)).quantize(STEP, rounding=ROUND_DOWN) for s in shares]
    assert sum(amounts, Decimal(0)) <= budget
    return amounts


def ton_str(d: Decimal) -> str:
    return format(d.normalize(), "f") if d else "0"


def plan(cfg: dict[str, Any], participants: int) -> dict[str, Any]:
    """Призы при текущем числе участников: места, суммы, когда следующее место."""
    budget = Decimal(cfg["budget_ton"])
    n = places_for(cfg, participants)
    amounts = split(budget, cfg["shares"][str(n)]) if n else []
    return {
        "budget_ton": ton_str(budget),
        "places": n,
        "prizes": [{"place": i, "ton": ton_str(a)} for i, a in enumerate(amounts, start=1)],
        "next_place_at": next_place_at(cfg, participants),
        "unspent_ton": ton_str(budget - sum(amounts, Decimal(0))) if n else ton_str(budget),
    }
