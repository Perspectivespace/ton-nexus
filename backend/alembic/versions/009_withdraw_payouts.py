"""withdraw payouts: payout_started_at, tx_hash, paid_at

Revision ID: 009
Revises: 008
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("withdraw_requests", sa.Column("payout_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("withdraw_requests", sa.Column("tx_hash", sa.String(64), nullable=True))
    op.add_column("withdraw_requests", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
    # уникальный: один перевод не закрывает две заявки; NULL не мешает (у pending нет хеша)
    op.create_unique_constraint("uq_withdraw_requests_tx_hash", "withdraw_requests", ["tx_hash"])


def downgrade() -> None:
    op.drop_constraint("uq_withdraw_requests_tx_hash", "withdraw_requests", type_="unique")
    op.drop_column("withdraw_requests", "paid_at")
    op.drop_column("withdraw_requests", "tx_hash")
    op.drop_column("withdraw_requests", "payout_started_at")
