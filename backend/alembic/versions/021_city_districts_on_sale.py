"""Районы города: 8 мест «Неон-рядов» и «Порта» поступают в продажу

Revision ID: 021
Revises: 020
Create Date: 2026-11-10

Меняется только настройка city_ads в economy_settings (JSON в тексте): у мест районов spots.<место>.enabled = true.
Если в сохранённой настройке ещё нет мест районов, цен по типу места (prices) или длины текста экрана на фасаде
(limits.facade_screen) — они добавляются со значениями по умолчанию, чтобы владелец видел их в настройках.
Остальное (цены Центра, сроки, уровень, свои цены мест) не трогается. Нет строки настройки — ничего не делается:
её засеет seed_economy уже с включёнными местами. Объявления и таблица мест не меняются.
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None

# копия ключей мест районов и значений по умолчанию (миграция не зависит от будущих правок кода)
DISTRICT_SPOTS = (
    "rows_facade", "rows_line", "rows_neon", "rows_banner",
    "port_line", "port_banner_cargo", "port_banner_tram", "port_neon",
)
PRICES = {
    "line": {"price_day": "1"},
    "banner": {"price_day": "0.5"},
    "neon": {"price_day": "0.3"},
    "facade_screen": {"price_day": "1.5"},
}
FACADE_LIMITS = {"title_max": 24, "subtitle_max": 32}


def on_sale(value: dict, enabled: bool = True) -> dict:
    """Новая настройка: места районов продаются (enabled), недостающие цены типов и лимиты экрана — по умолчанию."""
    out = dict(value)
    spots = dict(out.get("spots") or {})
    for key in DISTRICT_SPOTS:
        item = dict(spots.get(key) or {})
        item["enabled"] = enabled
        spots[key] = item
    out["spots"] = spots
    if enabled:
        prices = dict(out.get("prices") or {})
        for fmt, p in PRICES.items():
            prices.setdefault(fmt, dict(p))
        out["prices"] = prices
        limits = dict(out.get("limits") or {})
        limits.setdefault("facade_screen", dict(FACADE_LIMITS))
        out["limits"] = limits
    return out


def _apply(enabled: bool) -> None:
    bind = op.get_bind()
    row = bind.execute(sa.text("SELECT value_json FROM economy_settings WHERE key = 'city_ads'")).first()
    if row is None:
        return
    try:
        value = json.loads(row[0])
    except (TypeError, ValueError):
        return  # испорченное значение не чиним миграцией — его покажет и поправит владелец
    if not isinstance(value, dict):
        return
    new = on_sale(value, enabled)
    if new == value:
        return
    bind.execute(
        sa.text("UPDATE economy_settings SET value_json = :v WHERE key = 'city_ads'"),
        {"v": json.dumps(new, ensure_ascii=False)},
    )


def upgrade() -> None:
    _apply(True)


def downgrade() -> None:
    # снова снять места районов с продажи (добавленные цены и лимиты безвредны — остаются)
    _apply(False)
