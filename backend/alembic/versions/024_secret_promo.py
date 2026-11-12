"""Секретный промокод в «Прогулке»: кампании, расписание появлений, активации, неудачные попытки ввода

Revision ID: 024
Revises: 023
Create Date: 2026-11-12

Только новые таблицы; существующие promo_codes и promo_redemptions не меняются (код кампании — обычная строка
promo_codes). Новых папок и настроек сервера не нужно.
"""

from alembic import op
import sqlalchemy as sa

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "secret_promo_campaigns",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("promo_id", sa.Integer(), sa.ForeignKey("promo_codes.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("per_day", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "secret_promo_appearances",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("secret_promo_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("district", sa.String(16), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_secret_promo_appearances_campaign_id", "secret_promo_appearances", ["campaign_id"])
    op.create_index("ix_secret_promo_appearances_time", "secret_promo_appearances", ["starts_at", "ends_at"])
    op.create_table(
        "secret_promo_claims",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("secret_promo_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("campaign_id", "user_id", name="uq_secret_promo_claims_campaign_user"),
    )
    op.create_index("ix_secret_promo_claims_user_id", "secret_promo_claims", ["user_id"])
    op.create_table(
        "promo_failed_attempts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_promo_failed_attempts_user_time", "promo_failed_attempts", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_promo_failed_attempts_user_time", table_name="promo_failed_attempts")
    op.drop_table("promo_failed_attempts")
    op.drop_index("ix_secret_promo_claims_user_id", table_name="secret_promo_claims")
    op.drop_table("secret_promo_claims")
    op.drop_index("ix_secret_promo_appearances_time", table_name="secret_promo_appearances")
    op.drop_index("ix_secret_promo_appearances_campaign_id", table_name="secret_promo_appearances")
    op.drop_table("secret_promo_appearances")
    op.drop_table("secret_promo_campaigns")
