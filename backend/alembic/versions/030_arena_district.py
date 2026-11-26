"""Арена-дистрикт: район arena и 4 рекламных места сразу в продаже

Revision ID: 030
Revises: 029
Create Date: 2026-11-26

Ограничение district у city_ad_spots дополняется значением arena (прежние centre|rows|port не меняются).
Четыре места добавляются, только если их ещё нет. В настройке city_ads они включаются в продажу
(spots.<место>.enabled = true); своей цены нет — действует цена типа места. Цены Центра, рядов и порта,
сроки и уровень не трогаются. Нет строки настройки — ничего не делается: её засеет seed_economy уже
с включёнными местами.

Откат удаляет места, только если на них не было объявлений (FK RESTRICT), убирает их ключи из настройки
(иначе старый код отверг бы всю настройку из-за неизвестных мест) и возвращает прежнее ограничение района.
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None

# копия мест арены из app.services.city_ads.SPOTS (миграция не зависит от будущих правок кода)
NEW_SPOTS = (
    ("arena_facade", "facade_screen", "Экран на фасаде чаши", 310, "arena"),
    ("arena_line", "line", "Бегущая строка вдоль кольца", 320, "arena"),
    ("arena_neon", "neon", "Неоновая вывеска над воротами", 330, "arena"),
    ("arena_banner", "banner", "Голо-баннер над площадью", 340, "arena"),
)
ARENA_KEYS = tuple(k for k, *_ in NEW_SPOTS)
OLD_DISTRICT_CHECK = "district IN ('centre', 'rows', 'port')"
NEW_DISTRICT_CHECK = "district IN ('centre', 'rows', 'port', 'arena')"


def with_arena(value: dict, enabled: bool) -> dict:
    """В продаже — ключи мест арены с enabled. Снятие — ключи убираются, своё у остальных мест не трогается."""
    out = dict(value)
    spots = dict(out.get("spots") or {})
    if enabled:
        for key in ARENA_KEYS:
            item = dict(spots.get(key) or {})
            item["enabled"] = True
            spots[key] = item
    else:
        for key in ARENA_KEYS:
            spots.pop(key, None)
    out["spots"] = spots
    return out


def seed_spots() -> None:
    ins = sa.text(
        "INSERT INTO city_ad_spots (key, format, title, sort, enabled, district) "
        "SELECT :key, :format, :title, :sort, true, :district "
        "WHERE NOT EXISTS (SELECT 1 FROM city_ad_spots WHERE key = :key)"
    )
    for key, fmt, title, sort, district in NEW_SPOTS:
        op.execute(ins.bindparams(key=key, format=fmt, title=title, sort=sort, district=district))


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
    new = with_arena(value, enabled)
    if new == value:
        return
    bind.execute(
        sa.text("UPDATE economy_settings SET value_json = :v WHERE key = 'city_ads'"),
        {"v": json.dumps(new, ensure_ascii=False)},
    )


def _district_check(sql: str) -> None:
    op.drop_constraint("ck_city_ad_spots_district", "city_ad_spots", type_="check")
    op.create_check_constraint("ck_city_ad_spots_district", "city_ad_spots", sql)


def upgrade() -> None:
    _district_check(NEW_DISTRICT_CHECK)
    seed_spots()
    apply_settings(True)


def downgrade() -> None:
    keys = ", ".join(f"'{k}'" for k in ARENA_KEYS)
    op.execute(sa.text(f"DELETE FROM city_ad_spots WHERE key IN ({keys})"))
    apply_settings(False)
    _district_check(OLD_DISTRICT_CHECK)
