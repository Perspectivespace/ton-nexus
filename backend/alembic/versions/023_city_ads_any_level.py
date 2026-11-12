"""Реклама в городе и районах — с любого уровня

Revision ID: 023
Revises: 022
Create Date: 2026-11-12

Меняется только настройка city_ads в economy_settings (JSON в тексте): прежний порог по умолчанию min_level = 3
становится 1 (покупать может игрок любого уровня). Если владелец уже задал свой порог (не 3), он не трогается —
владелец по-прежнему может поднять порог в настройках. Нет строки настройки — ничего не делается: её засеет
seed_economy уже с новым значением. Откат возвращает 3 только там, где стоит 1.
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None

OLD_DEFAULT = 3
NEW_DEFAULT = 1


def _swap(src: int, dst: int) -> None:
    bind = op.get_bind()
    row = bind.execute(sa.text("SELECT value_json FROM economy_settings WHERE key = 'city_ads'")).first()
    if row is None:
        return
    try:
        value = json.loads(row[0])
    except (TypeError, ValueError):
        return  # испорченное значение не чиним миграцией — его покажет и поправит владелец
    if not isinstance(value, dict) or value.get("min_level", OLD_DEFAULT) != src:
        return
    value["min_level"] = dst
    bind.execute(
        sa.text("UPDATE economy_settings SET value_json = :v WHERE key = 'city_ads'"),
        {"v": json.dumps(value, ensure_ascii=False)},
    )


def upgrade() -> None:
    _swap(OLD_DEFAULT, NEW_DEFAULT)


def downgrade() -> None:
    _swap(NEW_DEFAULT, OLD_DEFAULT)
