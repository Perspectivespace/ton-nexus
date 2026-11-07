"""Реклама в городе: места, объявления, занятые сутки, события статистики

Revision ID: 018
Revises: 017
Create Date: 2026-11-07
"""

from alembic import op
import sqlalchemy as sa

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None

# те же места, что app.services.city_ads.SPOTS (копия: миграция не зависит от будущих правок кода)
SPOTS = (
    ("tower_line", "line", "Бегущая строка на реакторной башне", 10),
    ("banner_sky", "banner", "Голо-баннер над площадью", 20),
    ("banner_street", "banner", "Голо-баннер у мостовой", 30),
    ("neon_left", "neon", "Неоновая вывеска слева", 40),
    ("neon_right", "neon", "Неоновая вывеска справа", 50),
)


def upgrade() -> None:
    spots = op.create_table(
        "city_ad_spots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(32), nullable=False, unique=True),
        sa.Column("format", sa.String(16), nullable=False),
        sa.Column("title", sa.String(64), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.CheckConstraint("format IN ('line', 'banner', 'neon')", name="ck_city_ad_spots_format"),
    )
    op.create_table(
        "city_ads",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("advertiser_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("spot_id", sa.Integer(), sa.ForeignKey("city_ad_spots.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("format", sa.String(16), nullable=False),
        sa.Column("title", sa.String(64), nullable=False),
        sa.Column("subtitle", sa.String(32), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("link_url", sa.String(512), nullable=True),
        sa.Column("color", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("start_day", sa.Date(), nullable=False),
        sa.Column("end_day", sa.Date(), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("price_day_nano", sa.BigInteger(), nullable=False),
        sa.Column("total_nano", sa.BigInteger(), nullable=False),
        sa.Column("paid_nano", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("refunded_nano", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("is_free", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("moderated_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("moderation_note", sa.Text(), nullable=True),
        sa.Column("link_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')", name="ck_city_ads_status"
        ),
        sa.CheckConstraint("end_day >= start_day", name="ck_city_ads_days"),
    )
    op.create_index("ix_city_ads_advertiser_id", "city_ads", ["advertiser_id"])
    op.create_index("ix_city_ads_spot_id", "city_ads", ["spot_id"])
    op.create_index("ix_city_ads_status_start", "city_ads", ["status", "start_day"])
    op.create_table(
        "city_ad_days",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("spot_id", sa.Integer(), sa.ForeignKey("city_ad_spots.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("ad_id", sa.Integer(), sa.ForeignKey("city_ads.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("spot_id", "day", name="uq_city_ad_days_spot_day"),
    )
    op.create_index("ix_city_ad_days_ad_id", "city_ad_days", ["ad_id"])
    op.create_table(
        "city_ad_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ad_id", sa.Integer(), sa.ForeignKey("city_ads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("ad_id", "user_id", "day", "kind", name="uq_city_ad_events_once"),
        sa.CheckConstraint("kind IN ('impression', 'open', 'click')", name="ck_city_ad_events_kind"),
    )
    op.create_index("ix_city_ad_events_ad_id", "city_ad_events", ["ad_id"])
    op.create_index("ix_city_ad_events_user_id", "city_ad_events", ["user_id"])
    op.bulk_insert(
        spots,
        [{"key": k, "format": f, "title": t, "sort": s, "enabled": True} for k, f, t, s in SPOTS],
    )


def downgrade() -> None:
    op.drop_index("ix_city_ad_events_user_id", table_name="city_ad_events")
    op.drop_index("ix_city_ad_events_ad_id", table_name="city_ad_events")
    op.drop_table("city_ad_events")
    op.drop_index("ix_city_ad_days_ad_id", table_name="city_ad_days")
    op.drop_table("city_ad_days")
    op.drop_index("ix_city_ads_status_start", table_name="city_ads")
    op.drop_index("ix_city_ads_spot_id", table_name="city_ads")
    op.drop_index("ix_city_ads_advertiser_id", table_name="city_ads")
    op.drop_table("city_ads")
    op.drop_table("city_ad_spots")
