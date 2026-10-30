"""Призы топа «Башни» за месяц — настройка `tower_prizes` (только расчёт; денег не двигает).

Владелец задаёт месячный бюджет в TON. Правила (всё настраивается):

1. Участников меньше `min_participants` (10) — призов нет, бюджет не тратится.
2. Мест n = max(лесенка, ⌊участники × `places_percent` / 100⌋), не больше `max_places` (200).
   Лесенка: `base_places` (3), +1 за каждые `extra_place_every` (20) участников сверх первых,
   не больше `ladder_max_places` (5): 21+ → 4, 41+ → 5.
3. Каждое место получает не меньше `min_prize_ton` (0.1). Если бюджета не хватает, мест
   становится меньше, но не меньше `base_places`. Если не хватает даже на них — призов нет
   (бюджет не тратится); включить призы с таким бюджетом владелец не может.
4. Вес места i — 1/i (гармонический ряд): 3 места ≈ 54.5 / 27.3 / 18.2 %. Места
   1…`individual_places` (10) получают свою сумму; дальше — группы `bands` (верхние границы:
   11–20, 21–50, 51–100, 101–200), в группе у всех одна сумма — среднее долей группы.
   Каждая сумма округляется ВНИЗ до 0.0001 TON: сумма выплат никогда не больше бюджета,
   остаток не тратится; суммы не растут от места к месту.

Выплат здесь нет — только ручная проверка владельцем (`payout_mode: review`).
"""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_DOWN, Context, Decimal, InvalidOperation, localcontext
from typing import Any

KEY = "tower_prizes"
DEFAULT: dict[str, Any] = {
    "enabled": False,
    "budget_ton": "0",
    "min_participants": 10,
    "base_places": 3,
    "extra_place_every": 20,
    "ladder_max_places": 5,
    "places_percent": 5,
    "max_places": 200,
    "min_prize_ton": "0.1",
    "individual_places": 10,
    "bands": [20, 50, 100, 200],
    "min_score": 1,
    "payout_mode": "review",
}
FIELDS = frozenset(DEFAULT)
# поля прежних черновиков настройки (не выпускались) — молча отбрасываем
LEGACY_FIELDS = frozenset({"shares"})
PLACES_CAP = 1000
BANDS_CAP = 20
MAX_BUDGET = Decimal("100000")
STEP = Decimal("0.0001")
FINE = Decimal("1e-18")
# авто-выплат пока нет — только ручная проверка владельцем
PAYOUT_MODES = ("review",)
_CTX = Context(prec=50)


class PrizeConfigError(ValueError):
    pass


def _int(v: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise PrizeConfigError(f"{name}: нужно целое число")
    if not lo <= v <= hi:
        raise PrizeConfigError(f"{name}: от {lo} до {hi}")
    return v


def _ton(v: Any, name: str, lo: Decimal, hi: Decimal) -> Decimal:
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        raise PrizeConfigError(f"{name}: сумма TON строкой, например \"10\"")
    try:
        d = Decimal(str(v).strip())
    except InvalidOperation as e:
        raise PrizeConfigError(f"{name}: сумма TON — число") from e
    if not d.is_finite() or d < lo or d > hi:
        raise PrizeConfigError(f"{name}: от {ton_str(lo)} до {ton_str(hi)} TON")
    if d != d.quantize(STEP, rounding=ROUND_DOWN):
        raise PrizeConfigError(f"{name}: не больше 4 знаков после точки")
    return d


def _bands(raw: Any, individual: int) -> list[int]:
    if not isinstance(raw, list) or len(raw) > BANDS_CAP:
        raise PrizeConfigError(f"bands: список верхних границ групп, до {BANDS_CAP}")
    vals = [_int(x, "bands", 1, PLACES_CAP) for x in raw]
    prev = individual
    for b in vals:
        if b <= prev:
            raise PrizeConfigError(
                f"bands: границы по возрастанию и больше «Мест со своей суммой» ({individual}) — {b} после {prev}"
            )
        prev = b
    return vals


def ton_str(d: Decimal) -> str:
    return format(d.normalize(), "f") if d else "0"


def normalize(value: Any, key: str = KEY) -> dict[str, Any]:
    """Проверить и привести к каноническому виду. Ошибка — PrizeConfigError с русским текстом.

    Та же модель у призов рейтингов (`level_prizes`, `tasks_prizes`, `friends_prizes`) — `key` только для текста ошибки.
    """
    if not isinstance(value, dict):
        raise PrizeConfigError(f"{key}: нужен объект")
    if LEGACY_FIELDS & set(value) and "ladder_max_places" not in value:
        # запись старой модели (таблицы долей): её max_places был потолком лесенки —
        # переносим в ladder_max_places, а общий потолок берём по умолчанию
        value = {**value, "ladder_max_places": value.get("max_places", DEFAULT["ladder_max_places"])}
        value["max_places"] = max(DEFAULT["max_places"], value["ladder_max_places"]) if isinstance(value["ladder_max_places"], int) else DEFAULT["max_places"]
    value = {k: v for k, v in value.items() if k not in LEGACY_FIELDS}
    extra = set(value) - FIELDS
    if extra:
        raise PrizeConfigError(f"{key}: лишние поля {sorted(extra)}")
    out = {**DEFAULT, **value}
    if not isinstance(out["enabled"], bool):
        raise PrizeConfigError("enabled: true или false")
    budget = _ton(out["budget_ton"], "budget_ton", Decimal(0), MAX_BUDGET)
    min_prize = _ton(out["min_prize_ton"], "min_prize_ton", STEP, MAX_BUDGET)
    base = _int(out["base_places"], "base_places", 1, 10)
    ladder_max = _int(out["ladder_max_places"], "ladder_max_places", 1, 100)
    if ladder_max < base:
        raise PrizeConfigError("ladder_max_places: не меньше base_places")
    top = _int(out["max_places"], "max_places", 1, PLACES_CAP)
    if top < ladder_max:
        raise PrizeConfigError("max_places: не меньше мест лесенки (ladder_max_places)")
    every = _int(out["extra_place_every"], "extra_place_every", 0, 100000)
    pct = _int(out["places_percent"], "places_percent", 0, 100)
    minp = _int(out["min_participants"], "min_participants", 1, 100000)
    if minp < base:
        raise PrizeConfigError("min_participants: не меньше числа призовых мест")
    individual = _int(out["individual_places"], "individual_places", 1, PLACES_CAP)
    if out["payout_mode"] not in PAYOUT_MODES:
        raise PrizeConfigError(f"payout_mode: пока только {', '.join(PAYOUT_MODES)}")
    cfg = {
        "enabled": out["enabled"],
        "budget_ton": ton_str(budget),
        "min_participants": minp,
        "base_places": base,
        "extra_place_every": every,
        "ladder_max_places": ladder_max,
        "places_percent": pct,
        "max_places": top,
        "min_prize_ton": ton_str(min_prize),
        "individual_places": individual,
        "bands": _bands(out["bands"], individual),
        "min_score": _int(out["min_score"], "min_score", 1, 10**9),
        "payout_mode": out["payout_mode"],
    }
    if cfg["enabled"]:
        if budget <= 0:
            raise PrizeConfigError("Чтобы включить призы, задайте бюджет больше 0 TON")
        need = min_budget(cfg)
        if budget < need:
            raise PrizeConfigError(
                f"Бюджета не хватает даже на {base} места по {ton_str(min_prize)} TON — нужно от {ton_str(need)} TON"
            )
    return cfg


def safe(value: Any) -> dict[str, Any]:
    """Для чтения: битая запись в базе не роняет топ — призы считаются выключенными."""
    try:
        return normalize(value)
    except PrizeConfigError:
        return normalize(DEFAULT)


# ───────── места ─────────


def ladder(cfg: dict[str, Any], participants: int) -> int:
    extra = (participants - 1) // cfg["extra_place_every"] if cfg["extra_place_every"] else 0
    return min(cfg["ladder_max_places"], cfg["base_places"] + max(0, extra))


def target_places(cfg: dict[str, Any], participants: int) -> int:
    """Мест по правилам числа участников — без учёта бюджета (0 — ниже минимума)."""
    if participants < cfg["min_participants"]:
        return 0
    by_pct = participants * cfg["places_percent"] // 100
    return min(cfg["max_places"], participants, max(ladder(cfg, participants), by_pct))


def groups(cfg: dict[str, Any], n: int) -> list[tuple[int, int]]:
    """Места 1…n по группам: (с, по). Сначала по одному, дальше — группы bands; хвост — одна группа."""
    out: list[tuple[int, int]] = [(i, i) for i in range(1, min(n, cfg["individual_places"]) + 1)]
    lo = cfg["individual_places"] + 1
    for hi in [*cfg["bands"], n]:
        if lo > n:
            break
        hi = min(hi, n)
        if hi >= lo:
            out.append((lo, hi))
            lo = hi + 1
    return out


def _harmonic(n: int) -> list[Decimal]:
    """h[k] = 1 + 1/2 + … + 1/k (h[0] = 0)."""
    h = [Decimal(0)]
    with localcontext(_CTX):
        for i in range(1, n + 1):
            h.append(h[-1] + Decimal(1) / Decimal(i))
    return h


def amounts(cfg: dict[str, Any], budget: Decimal, n: int, h: list[Decimal] | None = None) -> list[tuple[int, int, Decimal]]:
    """Суммы для n мест: [(с, по, TON каждому)], вниз до 0.0001, не растут, итог ≤ бюджета."""
    if n <= 0:
        return []
    h = h if h is not None and len(h) > n else _harmonic(n)
    out: list[tuple[int, int, Decimal]] = []
    with localcontext(_CTX):
        for a, b in groups(cfg, n):
            # среднее гармонических долей группы: бюджет × (H_b − H_{a−1}) / (кол-во × H_n)
            exact = budget * (h[b] - h[a - 1]) / (Decimal(b - a + 1) * h[n])
            # сначала гасим хвост погрешности деления (16 не должно стать 15.9999), потом — вниз до 0.0001
            amt = exact.quantize(FINE).quantize(STEP, rounding=ROUND_DOWN)
            if out and amt > out[-1][2]:
                amt = out[-1][2]
            out.append((a, b, amt))
        # страховка от погрешности деления: итог строго не больше бюджета (срезаем с низа)
        while total(out) > budget:
            i = max(i for i, g in enumerate(out) if g[2] > 0)
            a, b, amt = out[i]
            out[i] = (a, b, amt - STEP)
    return out


def total(rows: list[tuple[int, int, Decimal]]) -> Decimal:
    return sum((amt * (b - a + 1) for a, b, amt in rows), Decimal(0))


def _fits(cfg: dict[str, Any], budget: Decimal, n: int, h: list[Decimal]) -> bool:
    rows = amounts(cfg, budget, n, h)
    return bool(rows) and rows[-1][2] >= Decimal(cfg["min_prize_ton"])


def min_budget(cfg: dict[str, Any]) -> Decimal:
    """Сколько нужно, чтобы base_places мест получили не меньше min_prize каждое."""
    n = cfg["base_places"]
    h = _harmonic(n)
    a, b = groups(cfg, n)[-1]
    with localcontext(_CTX):
        need = Decimal(cfg["min_prize_ton"]) * Decimal(b - a + 1) * h[n] / (h[b] - h[a - 1])
        need = need.quantize(FINE).quantize(STEP, rounding=ROUND_CEILING)
    while not _fits(cfg, need, n, h):  # на случай погрешности — добрать шаг
        need += STEP
    return need


def places_for(cfg: dict[str, Any], participants: int) -> tuple[int, str | None]:
    """(мест с учётом бюджета, почему не больше: "budget" | "max" | None)."""
    want = target_places(cfg, participants)
    if want == 0:
        return 0, None
    budget = Decimal(cfg["budget_ton"])
    h = _harmonic(want)
    if _fits(cfg, budget, want, h):
        return want, ("max" if want >= cfg["max_places"] else None)
    floor = min(cfg["base_places"], want)
    if not _fits(cfg, budget, floor, h):
        return 0, "budget"
    # самый большой n в [floor, want), при котором всем хватает min_prize (с уменьшением n суммы растут)
    lo, hi = floor, want - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if _fits(cfg, budget, mid, h):
            lo = mid
        else:
            hi = mid - 1
    while lo > floor and not _fits(cfg, budget, lo, h):  # подстраховка монотонности
        lo -= 1
    return lo, "budget"


def next_place_at(cfg: dict[str, Any], participants: int) -> int | None:
    """При каком числе участников станет на одно призовое место больше (None — больше не станет)."""
    n, limit = places_for(cfg, participants)
    if n == 0:
        return cfg["min_participants"] if limit is None else None
    if limit is not None:
        return None
    cands = []
    if cfg["extra_place_every"]:
        cands.append((ladder(cfg, participants) - cfg["base_places"] + 1) * cfg["extra_place_every"] + 1)
    if cfg["places_percent"]:
        cands.append(-(-(n + 1) * 100 // cfg["places_percent"]))
    for p in sorted(c for c in cands if c > participants):
        if target_places(cfg, p) > n:
            return p if places_for(cfg, p)[0] > n else None
    return None


def plan(cfg: dict[str, Any], participants: int) -> dict[str, Any]:
    """Призы при текущем числе участников: места, суммы по группам, когда следующее место."""
    budget = Decimal(cfg["budget_ton"])
    n, limit = places_for(cfg, participants)
    rows = amounts(cfg, budget, n)
    paid = total(rows)
    assert paid <= budget
    return {
        "budget_ton": ton_str(budget),
        "places": n,
        "limited_by": limit,
        "prizes": [{"from_place": a, "to_place": b, "ton": ton_str(amt)} for a, b, amt in rows],
        "next_place_at": next_place_at(cfg, participants),
        "total_ton": ton_str(paid),
        "unspent_ton": ton_str(budget - paid),
    }
