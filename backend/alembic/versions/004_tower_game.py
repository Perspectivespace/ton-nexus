"""tower game: games, daily attempts, monthly best

Revision ID: 004
Revises: 003
Create Date: 2026-10-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tower_games",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("booster", sa.String(8), nullable=True),
        sa.Column("game_day", sa.Date(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="started"),
        sa.Column("reject_reason", sa.String(32), nullable=True),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("height", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("perfects", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("best_combo", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("over", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("taps", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tower_games_user_day", "tower_games", ["user_id", "game_day"])

    op.create_table(
        "tower_daily_attempts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("game_day", sa.Date(), nullable=False),
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "game_day", name="uq_tower_attempts_user_day"),
    )

    op.create_table(
        "tower_monthly_best",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("best_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("best_game_id", sa.Integer(), nullable=True),
        sa.Column("achieved_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["best_game_id"], ["tower_games.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "month", name="uq_tower_best_user_month"),
    )
    op.create_index("ix_tower_best_month_score", "tower_monthly_best", ["month", "best_score"])


def downgrade() -> None:
    op.drop_index("ix_tower_best_month_score", table_name="tower_monthly_best")
    op.drop_table("tower_monthly_best")
    op.drop_table("tower_daily_attempts")
    op.drop_index("ix_tower_games_user_day", table_name="tower_games")
    op.drop_table("tower_games")
