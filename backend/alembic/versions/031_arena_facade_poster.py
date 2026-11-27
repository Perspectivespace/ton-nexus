"""Арена: экран на фасаде чаши больше не продаётся — место под афишу

Revision ID: 031
Revises: 030
Create Date: 2026-11-27

В настройке city_ads у места arena_facade ставится enabled = false. Само место
и объявления на нём (если были) не удаляются. Остальные места и цены не трогаются.
Нет строки настройки — ничего не делается: seed_economy уже засеет место выключенным.

Откат возвращает enabled = true (как после миграции 030).
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None

SPOT = "arena_facade"


def with_facade_sale(value: dict, enabled: bool) -> dict:
    """Включает или снимает с продажи только arena_facade; прочие ключи не трогает."""
    out = dict(value)
    spots = dict(out.get("spots") or {})
    item = dict(spots.get(SPOT) or {})
    item["enabled"] = enabled
    spots[SPOT] = item
    out["spots"] = spots
    return out


def apply_settings(enabled: bool) -> None:
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
    new = with_facade_sale(value, enabled)
    if new == value:
        return
    bind.execute(
        sa.text("UPDATE economy_settings SET value_json = :v WHERE key = 'city_ads'"),
        {"v": json.dumps(new, ensure_ascii=False)},
    )


def upgrade() -> None:
    apply_settings(False)


def downgrade() -> None:
    apply_settings(True)
