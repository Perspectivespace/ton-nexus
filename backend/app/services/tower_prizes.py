"""Призы топа «Башни» за месяц — настройка `tower_prizes` (только описание; денег не двигает).

Пока Сергей не назначил суммы, по умолчанию призы выключены и места пусты:
экран топа честно пишет «призы пока не назначены». Выплат здесь нет — PR 3b.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

KEY = "tower_prizes"
DEFAULT: dict[str, Any] = {
    "enabled": False,
    "places": [],
    "min_participants": 10,
    "min_score": 1,
    "payout_mode": "review",
}
FIELDS = frozenset(DEFAULT)
MAX_PLACES = 20
MAX_TON = Decimal("1000")
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


def _ton(v: Any, place: int) -> str:
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        raise PrizeConfigError(f"место {place}: сумма TON строкой, например \"1.5\"")
    try:
        d = Decimal(str(v).strip())
    except InvalidOperation as e:
        raise PrizeConfigError(f"место {place}: сумма TON — число") from e
    if not d.is_finite() or d <= 0 or d > MAX_TON:
        raise PrizeConfigError(f"место {place}: сумма больше 0 и не больше {MAX_TON} TON")
    if -d.normalize().as_tuple().exponent > 9:
        raise PrizeConfigError(f"место {place}: не больше 9 знаков после точки")
    s = format(d.normalize(), "f")
    return s


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
    places = out["places"]
    if not isinstance(places, list):
        raise PrizeConfigError("places: нужен список мест")
    if len(places) > MAX_PLACES:
        raise PrizeConfigError(f"places: не больше {MAX_PLACES} призовых мест")
    rows: list[dict[str, Any]] = []
    for r in places:
        if not isinstance(r, dict) or set(r) != {"place", "ton"}:
            raise PrizeConfigError("places: каждое место — {place, ton}")
        p = _int(r["place"], "place", 1, MAX_PLACES)
        rows.append({"place": p, "ton": _ton(r["ton"], p)})
    rows.sort(key=lambda r: r["place"])
    if [r["place"] for r in rows] != list(range(1, len(rows) + 1)):
        raise PrizeConfigError("places: места подряд с 1-го, без пропусков и повторов")
    for hi, lo in zip(rows, rows[1:]):
        if Decimal(lo["ton"]) > Decimal(hi["ton"]):
            raise PrizeConfigError(f"место {lo['place']} не может получать больше места {hi['place']}")
    if out["enabled"] and not rows:
        raise PrizeConfigError("Чтобы включить призы, задайте хотя бы 1-е место")
    if out["payout_mode"] not in PAYOUT_MODES:
        raise PrizeConfigError(f"payout_mode: пока только {', '.join(PAYOUT_MODES)}")
    return {
        "enabled": out["enabled"],
        "places": rows,
        "min_participants": _int(out["min_participants"], "min_participants", 1, 100000),
        "min_score": _int(out["min_score"], "min_score", 0, 10**9),
        "payout_mode": out["payout_mode"],
    }


def safe(value: Any) -> dict[str, Any]:
    """Для чтения: битая запись в базе не роняет топ — призы считаются выключенными."""
    try:
        return normalize(value)
    except PrizeConfigError:
        return {**DEFAULT, "places": []}
