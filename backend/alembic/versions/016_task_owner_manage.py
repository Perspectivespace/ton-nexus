"""Управление заданиями владельцем: учёт бюджета в нанотонах и журнал task_owner_actions

Revision ID: 016
Revises: 015
Create Date: 2026-11-07
"""

from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("creator_payout_nano", sa.BigInteger(), nullable=True))
    op.add_column("tasks", sa.Column("creator_commission_nano", sa.BigInteger(), nullable=True))
    op.add_column("tasks", sa.Column("platform_payout_nano", sa.BigInteger(), nullable=True))
    op.create_table(
        "task_owner_actions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("mode", sa.String(16), nullable=True),
        sa.Column("creator_delta_nano", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("platform_delta_nano", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_task_owner_actions_task_id", "task_owner_actions", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_owner_actions_task_id", table_name="task_owner_actions")
    op.drop_table("task_owner_actions")
    op.drop_column("tasks", "platform_payout_nano")
    op.drop_column("tasks", "creator_commission_nano")
    op.drop_column("tasks", "creator_payout_nano")
