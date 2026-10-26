"""Default economy_settings — owner can change via admin later."""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.economy import EconomySetting

DEFAULTS: dict[str, tuple[object, str]] = {
    "upgrade_base_cost": (
        {"ton": "0.05"},
        "Базовая стоимость попытки усиления (TON)",
    ),
    "upgrade_cost_scale": (
        {"per_total_levels": "0.01"},
        "Надбавка к стоимости за сумму уровней статов",
    ),
    "upgrade_type_weights": (
        {
            "power": 25,
            "capacity": 25,
            "acceleration": 20,
            "luck": 15,
            "stability": 15,
        },
        "Веса колеса типа усиления",
    ),
    "upgrade_success_base_bp": (
        {"base": 5500, "min": 1500},
        "Базовый шанс успеха (bp), 5500=55%, min=15%",
    ),
    "upgrade_success_decay_per_level_bp": (
        {"decay": 200},
        "Снижение шанса на уровень стата (−2%)",
    ),
    "soft_caps": (
        {"power": 25, "acceleration": 20, "luck": 20, "capacity": 30, "stability": 25},
        "Мягкие потолки статов",
    ),
    "miner_session_hours": ({"hours": 12}, "Длительность сессии (часы)"),
    "miner_base_rate": ({"ton_per_hour": "0.00035"}, "Базовая ставка TON/час"),
    "miner_power_mult": ({"per_level": "0.08"}, "Множитель за Мощность"),
    "miner_capacity_mult": ({"per_level": "0.06"}, "Ёмкость: +доля добычи за цикл за уровень выше 1"),
    "miner_luck_roll_bp": (
        {"min_bp": -100, "max_bp": 500},
        "Удача: границы броска при сборе (bp), −100..500 = −1%..+5%; полный диапазон с 26-го уровня",
    ),
    "task_platform_commission_bp": ({"bp": 1000}, "Комиссия платформы 10%"),
    "min_withdraw_ton": ({"ton": "0.2"}, "Минимальный вывод"),
    "referral_reward": ({"ton": "0.04"}, "Реферальная награда"),
    "daily_rewards": (
        {
            "day_1": {"ton": "0.001", "xp": 5},
            "day_2": {"ton": "0.0015", "xp": 8},
            "day_3": {"ton": "0.002", "xp": 10},
            "day_4": {"ton": "0.0025", "xp": 12},
            "day_5": {"ton": "0.003", "xp": 15},
            "day_6": {"ton": "0.0035", "xp": 18},
            "day_7": {"ton": "0.005", "xp": 25, "focus": 1},
        },
        "Ежедневная награда: 7 дней по кругу",
    ),
    "xp_per_level": ({"base": 100, "growth": 1.35}, "XP curve"),
    "prize_wheel": (
        {
            "free_spins_per_day": 1,
            "items": [
                {"id": "success_plus_5", "weight": 8, "label": "+5% к успеху", "success_boost_bp": 500},
                {"id": "focus_1", "weight": 15, "label": "Фокус ×1", "focus": 1},
                {"id": "block_1", "weight": 12, "label": "Запрет ×1", "block": 1},
                {"id": "xp_small", "weight": 25, "label": "XP", "xp": 15},
                {"id": "ton_dust", "weight": 20, "label": "Пыль TON", "ton": "0.001"},
                {"id": "nothing", "weight": 20, "label": "Пусто", "ton": "0"},
            ],
        },
        "Колесо наград",
    ),
    "focus_weight_bonus": ({"multiplier": 2.0}, "Фокус: множитель веса типа"),
    "success_boost_cap_bp": (
        {"bp": 1500},
        "Потолок накопленного бонуса к успеху (bp), 1500 = +15%",
    ),
}


async def seed_economy(session: AsyncSession) -> int:
    inserted = 0
    for key, (value, description) in DEFAULTS.items():
        exists = await session.scalar(select(EconomySetting.id).where(EconomySetting.key == key))
        if exists:
            continue
        session.add(
            EconomySetting(
                key=key,
                value_json=json.dumps(value, ensure_ascii=False),
                description=description,
            )
        )
        inserted += 1
    if inserted:
        await session.commit()
    return inserted
