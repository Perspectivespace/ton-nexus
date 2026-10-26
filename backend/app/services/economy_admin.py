"""Owner economy switchboard — read/update economy_settings."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.economy import EconomySetting
from app.services.economy_seed import DEFAULTS, seed_economy


class EconomyAdminError(Exception):
    pass


@dataclass
class SettingView:
    key: str
    value: Any
    description: str | None


def _fill_missing(key: str, value: Any) -> Any:
    """Ежедневка: в старой записи нет дней 4–6 — показываем их со значениями по умолчанию,
    чтобы в форме были все 7 дней (сохранение запишет их в базу)."""
    if key == "daily_rewards" and isinstance(value, dict):
        week = DEFAULTS[key][0]
        merged = {d: value.get(d, week[d]) for d in week}
        merged.update({k: v for k, v in value.items() if k not in merged})
        return merged
    return value


async def list_settings(session: AsyncSession) -> list[SettingView]:
    await seed_economy(session)
    result = await session.execute(select(EconomySetting).order_by(EconomySetting.key))
    rows = {r.key: r for r in result.scalars().all()}
    views: list[SettingView] = []
    for key in sorted(set(rows) | set(DEFAULTS)):
        if key in rows:
            r = rows[key]
            views.append(
                SettingView(key=r.key, value=_fill_missing(r.key, json.loads(r.value_json)), description=r.description)
            )
        else:
            val, desc = DEFAULTS[key]
            views.append(SettingView(key=key, value=val, description=desc))
    return views


async def get_setting_admin(session: AsyncSession, key: str) -> SettingView:
    await seed_economy(session)
    row = await session.scalar(select(EconomySetting).where(EconomySetting.key == key))
    if row:
        return SettingView(key=row.key, value=_fill_missing(row.key, json.loads(row.value_json)), description=row.description)
    if key in DEFAULTS:
        val, desc = DEFAULTS[key]
        return SettingView(key=key, value=val, description=desc)
    raise EconomyAdminError(f"unknown key: {key}")


def _validate_value(key: str, value: Any) -> None:
    if key not in DEFAULTS:
        json.dumps(value)
        return
    sample = DEFAULTS[key][0]
    if type(sample) is not type(value) and not (
        isinstance(sample, dict) and isinstance(value, dict)
    ):
        if isinstance(sample, dict) and isinstance(value, dict):
            return
        raise EconomyAdminError(
            f"value type for {key} should match seed template ({type(sample).__name__})"
        )


async def set_setting(
    session: AsyncSession,
    *,
    key: str,
    value: Any,
    description: str | None = None,
) -> SettingView:
    _validate_value(key, value)
    row = await session.scalar(select(EconomySetting).where(EconomySetting.key == key))
    payload = json.dumps(value, ensure_ascii=False)
    if row:
        row.value_json = payload
        if description is not None:
            row.description = description
    else:
        desc = description
        if desc is None and key in DEFAULTS:
            desc = DEFAULTS[key][1]
        session.add(EconomySetting(key=key, value_json=payload, description=desc))
    await session.flush()
    return SettingView(
        key=key,
        value=value,
        description=description
        if description is not None
        else (DEFAULTS[key][1] if key in DEFAULTS else None),
    )


async def bulk_set(session: AsyncSession, updates: dict[str, Any]) -> list[SettingView]:
    out: list[SettingView] = []
    for key, value in updates.items():
        out.append(await set_setting(session, key=key, value=value))
    return out


SETTING_CATALOG: list[dict[str, str]] = [
    {"key": "upgrade_base_cost", "group": "miner_upgrade", "label": "Базовая цена усиления"},
    {"key": "upgrade_cost_scale", "group": "miner_upgrade", "label": "Надбавка цены за уровни"},
    {"key": "upgrade_type_weights", "group": "miner_upgrade", "label": "Веса колеса типа"},
    {"key": "upgrade_success_base_bp", "group": "miner_upgrade", "label": "Базовый шанс успеха (bp)"},
    {"key": "upgrade_success_decay_per_level_bp", "group": "miner_upgrade", "label": "Decay шанса за уровень"},
    {"key": "soft_caps", "group": "miner_upgrade", "label": "Soft-cap статов"},
    {"key": "focus_weight_bonus", "group": "miner_upgrade", "label": "Множитель Фокуса"},
    {"key": "success_boost_cap_bp", "group": "miner_upgrade", "label": "Потолок бонуса к успеху"},
    {"key": "miner_session_hours", "group": "miner", "label": "Базовая длительность цикла (ч)"},
    {"key": "miner_base_rate", "group": "miner", "label": "Базовая ставка TON/час"},
    {"key": "miner_power_mult", "group": "miner", "label": "Множитель Мощности"},
    {"key": "miner_capacity_mult", "group": "miner", "label": "Множитель Ёмкости"},
    {"key": "miner_luck_roll_bp", "group": "miner", "label": "Бросок Удачи при сборе"},
    {"key": "task_platform_commission_bp", "group": "tasks", "label": "Комиссия платформы (bp)"},
    {"key": "min_withdraw_ton", "group": "withdraw", "label": "Мин. вывод TON"},
    {"key": "referral_reward", "group": "growth", "label": "Реферальная награда"},
    {"key": "daily_rewards", "group": "daily", "label": "Награды daily/streak"},
    {"key": "xp_per_level", "group": "progression", "label": "Кривая XP"},
    {"key": "prize_wheel", "group": "roulette", "label": "Колесо призов (веса/награды)"},
]
