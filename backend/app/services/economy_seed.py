"""Default economy_settings — owner can change via admin later."""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.economy import EconomySetting

_PRIZES_OFF: dict = {
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
    "ton_wallet": ({"enabled": True, "network": "mainnet", "unique_address": True, "proof_ttl_minutes": 15}, "Настройки кошелька TON"),
    "ton_deposits": ({"enabled": False, "project_address": "", "min_ton": "0.1", "poll_seconds": 15}, "Пополнение TON"),
    "arena": ({"enabled": False}, "«Арена»: вход в комнаты со ставкой (выключено — API комнат закрыт для игроков)"),
    "ton_payouts": ({"enabled": False, "payout_wallet": ""}, "Выплаты TON: кошелёк, с которого владелец платит заявки на вывод"),
    "miner_power_mult": ({"per_level": "0.08"}, "Множитель за Мощность"),
    "miner_capacity_mult": ({"per_level": "0.06"}, "Ёмкость: +доля добычи за цикл за уровень выше 1"),
    "miner_luck_roll_bp": (
        {"min_bp": -100, "max_bp": 500},
        "Удача: границы броска при сборе (bp), −100..500 = −1%..+5%; полный диапазон с 26-го уровня",
    ),
    "task_platform_commission_bp": ({"bp": 1000}, "Комиссия платформы 10%"),
    "task_tariff": (
        {
            "visit": {
                "reward": "0.01",
                "commission_bp": 1000,
                "xp": 5,
                "min_slots": 1,
                "max_slots": 10000,
            },
            "campaign": {"commission_bp": 1000, "xp": 10},
            "partner": {"fee_bp": 1000, "xp": 5},
        },
        "Тариф заданий по типам: переход / кампания / партнёр (комиссия — в тарифе; task_platform_commission_bp — запасной для старых)",
    ),
    "city_ads": (
        {
            "min_level": 3,
            "min_days": 1,
            "max_days": 30,
            "body_max": 500,
            "spots": {
                "tower_line": {"price_day": "1", "enabled": True},
                "banner_sky": {"price_day": "0.5", "enabled": True},
                "banner_street": {"price_day": "0.5", "enabled": True},
                "neon_left": {"price_day": "0.3", "enabled": True},
                "neon_right": {"price_day": "0.3", "enabled": True},
                # районы: цена — по типу места (prices), пока не продаются (включит владелец к выходу рисунков)
                "rows_facade": {"enabled": False},
                "rows_line": {"enabled": False},
                "rows_neon": {"enabled": False},
                "rows_banner": {"enabled": False},
                "port_line": {"enabled": False},
                "port_banner_cargo": {"enabled": False},
                "port_banner_tram": {"enabled": False},
                "port_neon": {"enabled": False},
            },
            # цена за сутки по типу места; у места может быть своя цена (spots.<место>.price_day)
            "prices": {
                "line": {"price_day": "1"},
                "banner": {"price_day": "0.5"},
                "neon": {"price_day": "0.3"},
                "facade_screen": {"price_day": "1.5"},
            },
            "limits": {
                "line": {"title_max": 60},
                "banner": {"title_max": 14, "subtitle_max": 18},
                "neon": {"title_max": 12},
                "facade_screen": {"title_max": 24, "subtitle_max": 32},
            },
        },
        "Реклама в городе: цена за сутки по типу места и своя цена места (TON), продаётся ли место, районы, сроки 1–30 суток, длина текста, мин. уровень покупателя",
    ),
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
    "tower_prizes": (
        {
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
        },
        "Башня: месячный бюджет призов топа (TON), места и группы мест; выключено, пока бюджет не задан",
    ),
    # рейтинги: призы — та же модель, что у «Башни», свой бюджет на каждый топ; по умолчанию выключены
    "level_prizes": (
        {**_PRIZES_OFF},
        "Рейтинг по уровню: призы за опыт, набранный за месяц (TON); выключено, пока бюджет не задан",
    ),
    "tasks_prizes": (
        {**_PRIZES_OFF},
        "Топ исполнителей: призы за принятые задания за месяц (TON); выключено, пока бюджет не задан",
    ),
    "friends_prizes": (
        {**_PRIZES_OFF},
        "Топ друзей: призы за засчитанных друзей за месяц (TON); заработает вместе с приглашениями",
    ),
    "friend_rule": (
        {"min_level": 3, "min_tasks": 20, "need_both": False},
        "Когда приглашённый друг засчитывается: уровень и/или принятые задания (0 — условие выключено)",
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
