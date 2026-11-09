"""Районы города: у рекламного места — район, новый тип места «экран на фасаде», 8 мест «Неон-рядов» и «Порта»

Revision ID: 020
Revises: 019
Create Date: 2026-11-09

Безопасно для действующих данных: все прежние места получают район centre (значение по умолчанию),
цены и объявления не трогаются. Новые места добавляются, только если их ещё нет; продажу новых мест
выключает настройка city_ads (spots.<место>.enabled = false по умолчанию) — до выхода рисунков и экрана
районов покупателям ничего не меняется.
"""

from alembic import op
import sqlalchemy as sa

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None

# копия app.services.city_ads.SPOTS для районов (миграция не зависит от будущих правок кода)
NEW_SPOTS = (
    ("rows_facade", "facade_screen", "Экран на фасаде рынка", 110, "rows"),
    ("rows_line", "line", "Бегущая строка над навесами", 120, "rows"),
    ("rows_neon", "neon", "Неоновая вывеска у входа на рынок", 130, "rows"),
    ("rows_banner", "banner", "Голо-баннер над крышей рынка", 140, "rows"),
    ("port_line", "line", "Бегущая строка на стреле крана", 210, "port"),
    ("port_banner_cargo", "banner", "Голо-баннер на контейнерах", 220, "port"),
    ("port_banner_tram", "banner", "Голо-баннер на станции трамвая", 230, "port"),
    ("port_neon", "neon", "Неоновая вывеска над воротами склада", 240, "port"),
)


def upgrade() -> None:
    op.add_column(
        "city_ad_spots",
        sa.Column("district", sa.String(16), nullable=False, server_default="centre"),
    )
    op.create_check_constraint("ck_city_ad_spots_district", "city_ad_spots", "district IN ('centre', 'rows', 'port')")
    op.drop_constraint("ck_city_ad_spots_format", "city_ad_spots", type_="check")
    op.create_check_constraint(
        "ck_city_ad_spots_format", "city_ad_spots", "format IN ('line', 'banner', 'neon', 'facade_screen')"
    )
    ins = sa.text(
        "INSERT INTO city_ad_spots (key, format, title, sort, enabled, district) "
        "SELECT :key, :format, :title, :sort, true, :district "
        "WHERE NOT EXISTS (SELECT 1 FROM city_ad_spots WHERE key = :key)"
    )
    for key, fmt, title, sort, district in NEW_SPOTS:
        op.execute(ins.bindparams(key=key, format=fmt, title=title, sort=sort, district=district))


def downgrade() -> None:
    # места районов удаляются, только если на них не было объявлений (FK RESTRICT не даст удалить иначе)
    keys = ", ".join(f"'{k}'" for k, *_ in NEW_SPOTS)
    op.execute(sa.text(f"DELETE FROM city_ad_spots WHERE key IN ({keys})"))
    op.drop_constraint("ck_city_ad_spots_format", "city_ad_spots", type_="check")
    op.create_check_constraint("ck_city_ad_spots_format", "city_ad_spots", "format IN ('line', 'banner', 'neon')")
    op.drop_constraint("ck_city_ad_spots_district", "city_ad_spots", type_="check")
    op.drop_column("city_ad_spots", "district")
