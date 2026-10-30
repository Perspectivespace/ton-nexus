"""tower month close: closed months and frozen results with prizes

Revision ID: 005
Revises: 004
Create Date: 2026-10-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tower_months",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("reason", sa.String(24), nullable=True),
        sa.Column("prize_cfg", sa.JSON(), nullable=False),
        sa.Column("total_players", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("participants", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("places", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("budget_ton", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("planned_ton", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("paid_ton", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["closed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("month", name="uq_tower_months_month"),
    )

    op.create_table(
        "tower_month_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tower_month_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("place", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("note", sa.String(32), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_by", sa.Integer(), nullable=True),
        sa.Column("balance_history_id", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["tower_month_id"], ["tower_months.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["game_id"], ["tower_games.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["paid_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["balance_history_id"], ["balance_history.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tower_month_id", "place", name="uq_tower_result_month_place"),
        sa.UniqueConstraint("tower_month_id", "user_id", name="uq_tower_result_month_user"),
        sa.UniqueConstraint("balance_history_id", name="uq_tower_result_history"),
    )


def downgrade() -> None:
    op.drop_table("tower_month_results")
    op.drop_table("tower_months")
