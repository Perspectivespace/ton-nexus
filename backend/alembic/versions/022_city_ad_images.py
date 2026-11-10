"""Картинка на экране фасада «Неон-рядов»: таблица city_ad_images и city_ads.image_changed_at

Revision ID: 022
Revises: 021
Create Date: 2026-11-10

Картинки лежат в базе (bytea) уже пережатыми в WebP: новых папок на сервере и правок nginx не нужно.
"""

from alembic import op
import sqlalchemy as sa

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("city_ads", sa.Column("image_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "city_ad_images",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(32), nullable=False, unique=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ad_id", sa.Integer(), sa.ForeignKey("city_ads.id", ondelete="CASCADE"), nullable=True),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_city_ad_images_owner_id", "city_ad_images", ["owner_id"])
    op.create_index("ix_city_ad_images_ad_id", "city_ad_images", ["ad_id"])


def downgrade() -> None:
    op.drop_index("ix_city_ad_images_ad_id", table_name="city_ad_images")
    op.drop_index("ix_city_ad_images_owner_id", table_name="city_ad_images")
    op.drop_table("city_ad_images")
    op.drop_column("city_ads", "image_changed_at")
