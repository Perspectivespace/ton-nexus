"""Реклама в городе: доход платформы по объявлению (нанотоны)

Revision ID: 019
Revises: 018
Create Date: 2026-11-08
"""

from alembic import op
import sqlalchemy as sa

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # доход платформы: становится равен оплате при одобрении, уменьшается на частичный возврат; 0 — пока не одобрено
    op.add_column(
        "city_ads",
        sa.Column("revenue_nano", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_city_ads_money", "city_ads", "paid_nano >= 0 AND refunded_nano >= 0 AND revenue_nano >= 0 "
        "AND refunded_nano + revenue_nano <= paid_nano"
    )


def downgrade() -> None:
    op.drop_constraint("ck_city_ads_money", "city_ads", type_="check")
    op.drop_column("city_ads", "revenue_nano")
