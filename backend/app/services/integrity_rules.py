"""«Честность» (репутация): настройка integrity_rules — значения по умолчанию, тиры, нормализация.

Без зависимостей от БД (импортируется из economy_seed и economy_admin). Счёт 0–1000, старт 500.
Тиры — «фракционные», как в WoW: Неприязнь … Превознесение. В R1 (теневой режим) ни тиры, ни счёт
ни на что не влияют и игрокам не показываются: shadow_mode всегда true, gates.enabled всегда false.
"""

from __future__ import annotations

import copy
from typing import Any

KEY = "integrity_rules"
SCORE_MIN, SCORE_MAX = 0, 1000

# ключ → (RU, EN, порог по умолчанию); по убыванию порога
TIERS: tuple[tuple[str, str, str, int], ...] = (
    ("exalted", "Превознесение", "Exalted", 950),
    ("revered", "Почтение", "Revered", 850),
    ("honored", "Уважение", "Honored", 750),
    ("friendly", "Дружелюбие", "Friendly", 600),
    ("neutral", "Нейтрально", "Neutral", 400),
    ("unfriendly", "Настороженность", "Unfriendly", 200),
    ("hostile", "Неприязнь", "Hostile", 0),
)
TIER_KEYS = tuple(t[0] for t in TIERS)
DEFAULT_TIER = "neutral"

# события, которые пишутся в R1; остальные лежат в настройке «на будущее», чтобы владелец видел картину
CONNECTED = (
    "submission_accepted",
    "submission_streak_10",
    "submission_rejected_low_quality",
    "submission_rejected_wrong_task",
    "submission_rejected_duplicate",
    "submission_rejected_forged",
    "author_task_approved",
    "author_task_rejected_bad",
    "author_task_completed",
    "author_review_slow",
    "manual_adjust",
    "fraud",
)

SUBMISSION_REASONS = ("low_quality", "wrong_task", "duplicate", "forged", "other")
TASK_REASONS = ("bad_task", "other")

DEFAULT: dict[str, Any] = {
    "enabled": True,
    "shadow_mode": True,
    "start": 500,
    "tiers": [{"key": k, "min": m} for k, _ru, _en, m in TIERS],
    "weights": {
        "submission_accepted": {"delta": 3, "half_life_days": 180},
        "submission_streak_10": {"delta": 10, "half_life_days": 180},
        "submission_rejected_low_quality": {"delta": -10, "half_life_days": 90},
        "submission_rejected_wrong_task": {"delta": -5, "half_life_days": 90},
        "submission_rejected_duplicate": {"delta": -15, "half_life_days": 90},
        "submission_rejected_forged": {"delta": -60, "half_life_days": 180},
        "author_task_approved": {"delta": 5, "half_life_days": 180},
        "author_task_rejected_bad": {"delta": -15, "half_life_days": 90},
        "author_task_completed": {"delta": 10, "half_life_days": 180},
        "author_review_slow": {"delta": -2, "half_life_days": 60},
        "appeal_upheld": {"delta": -20, "half_life_days": 120},
        "month_clean": {"delta": 10, "half_life_days": 180},
        "stars_chargeback": {"delta": -100, "half_life_days": 365},
        "fraud": {"delta": -300, "half_life_days": 0},
    },
    "caps": {"accepted_per_day": 15, "review_slow_per_week": -10, "review_slow_hours": 72},
    "review_thresholds": {"event": -50, "day": -80},
    "gates": {"enabled": False},
}


class IntegrityRulesError(ValueError):
    pass


def defaults() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT)


def _int(v: Any, what: str) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != int(v):
        raise IntegrityRulesError(f"«Честность»: {what} — целое число")
    return int(v)


def normalize(value: Any) -> dict[str, Any]:
    """Проверить и привести настройку: целые числа, тиры по убыванию до 0, знаки весов не меняются,
    у fraud полураспад 0 (не затухает); shadow_mode = true и gates.enabled = false — принудительно (R1)."""
    if not isinstance(value, dict):
        raise IntegrityRulesError("Настройки «Честности» должны быть объектом")
    d = DEFAULT
    out: dict[str, Any] = {}
    enabled = value.get("enabled", d["enabled"])
    if not isinstance(enabled, bool):
        raise IntegrityRulesError("«Честность»: enabled — да/нет")
    out["enabled"] = enabled
    out["shadow_mode"] = True
    start = _int(value.get("start", d["start"]), "старт")
    if not SCORE_MIN <= start <= SCORE_MAX:
        raise IntegrityRulesError("«Честность»: старт — от 0 до 1000")
    out["start"] = start

    raw_tiers = value.get("tiers", d["tiers"])
    if not isinstance(raw_tiers, list):
        raise IntegrityRulesError("«Честность»: тиры — список")
    by_key: dict[str, int] = {}
    for t in raw_tiers:
        if not isinstance(t, dict) or t.get("key") not in TIER_KEYS:
            raise IntegrityRulesError("«Честность»: неизвестный тир")
        by_key[t["key"]] = _int(t.get("min"), f"порог тира {t['key']}")
    if set(by_key) != set(TIER_KEYS):
        raise IntegrityRulesError("«Честность»: нужны все 7 тиров")
    mins = [by_key[k] for k in TIER_KEYS]
    if mins[-1] != 0:
        raise IntegrityRulesError("«Честность»: у нижнего тира порог 0")
    if any(not SCORE_MIN <= m <= SCORE_MAX for m in mins) or any(a <= b for a, b in zip(mins, mins[1:])):
        raise IntegrityRulesError("«Честность»: пороги тиров — по убыванию, от 1000 до 0")
    out["tiers"] = [{"key": k, "min": by_key[k]} for k in TIER_KEYS]

    raw_w = value.get("weights", {})
    if not isinstance(raw_w, dict):
        raise IntegrityRulesError("«Честность»: веса — объект")
    weights: dict[str, Any] = {}
    for et, dw in d["weights"].items():
        w = raw_w.get(et, dw)
        if not isinstance(w, dict):
            raise IntegrityRulesError(f"«Честность»: вес {et} — объект")
        delta = _int(w.get("delta", dw["delta"]), f"Δ {et}")
        hl = _int(w.get("half_life_days", dw["half_life_days"]), f"полураспад {et}")
        if (dw["delta"] > 0) != (delta > 0) or delta == 0:
            raise IntegrityRulesError(f"«Честность»: у {et} нельзя менять знак (и ставить 0)")
        if abs(delta) > 1000:
            raise IntegrityRulesError(f"«Честность»: Δ {et} — не больше 1000 по модулю")
        if not 0 <= hl <= 3650:
            raise IntegrityRulesError(f"«Честность»: полураспад {et} — от 0 до 3650 дней")
        if et == "fraud":
            hl = 0
        weights[et] = {"delta": delta, "half_life_days": hl}
    out["weights"] = weights

    raw_c = value.get("caps", {})
    if not isinstance(raw_c, dict):
        raise IntegrityRulesError("«Честность»: лимиты — объект")
    dc = d["caps"]
    apd = _int(raw_c.get("accepted_per_day", dc["accepted_per_day"]), "лимит принятых за сутки")
    rsw = _int(raw_c.get("review_slow_per_week", dc["review_slow_per_week"]), "лимит медленной проверки")
    rsh = _int(raw_c.get("review_slow_hours", dc["review_slow_hours"]), "часы медленной проверки")
    if apd < 0 or rsw > 0 or not 1 <= rsh <= 720:
        raise IntegrityRulesError("«Честность»: лимиты — принятые ≥ 0, медленная проверка ≤ 0, часы 1–720")
    out["caps"] = {"accepted_per_day": apd, "review_slow_per_week": rsw, "review_slow_hours": rsh}

    raw_r = value.get("review_thresholds", {})
    if not isinstance(raw_r, dict):
        raise IntegrityRulesError("«Честность»: пороги проверки — объект")
    dr = d["review_thresholds"]
    ev = _int(raw_r.get("event", dr["event"]), "порог события")
    day = _int(raw_r.get("day", dr["day"]), "порог за сутки")
    if ev >= 0 or day >= 0:
        raise IntegrityRulesError("«Честность»: пороги проверки — отрицательные")
    out["review_thresholds"] = {"event": ev, "day": day}
    out["gates"] = {"enabled": False}
    return out


def merged(value: Any) -> dict[str, Any]:
    """Значение из БД → полная настройка (битое — по умолчанию; читать можно всегда)."""
    try:
        return normalize(value if isinstance(value, dict) else {})
    except IntegrityRulesError:
        return defaults()


def tier_for(score: int, tiers: list[dict[str, Any]] | None = None) -> str:
    """Первый тир, у которого score >= min (тиры по убыванию порога)."""
    for t in sorted(tiers or DEFAULT["tiers"], key=lambda t: -t["min"]):
        if score >= t["min"]:
            return t["key"]
    return TIER_KEYS[-1]
