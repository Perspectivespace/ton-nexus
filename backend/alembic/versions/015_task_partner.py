"""«Партнёрская услуга»: tasks.partner_user_id и покупки task_purchases

Revision ID: 015
Revises: 014
Create Date: 2026-11-07
"""

from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("partner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_tasks_partner_user_id", "tasks", ["partner_user_id"])
    op.create_table(
        "task_purchases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("buyer_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("partner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount_nano", sa.BigInteger(), nullable=False),
        sa.Column("fee_nano", sa.BigInteger(), nullable=False),
        sa.Column("partner_nano", sa.BigInteger(), nullable=False),
        sa.Column("fee_bp", sa.Integer(), nullable=False),
        sa.Column("xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("task_id", "buyer_id", name="uq_task_purchases_task_buyer"),
    )
    op.create_index("ix_task_purchases_task_id", "task_purchases", ["task_id"])
    op.create_index("ix_task_purchases_buyer_id", "task_purchases", ["buyer_id"])
    op.create_index("ix_task_purchases_partner_id", "task_purchases", ["partner_id"])


def downgrade() -> None:
    op.drop_index("ix_task_purchases_partner_id", table_name="task_purchases")
    op.drop_index("ix_task_purchases_buyer_id", table_name="task_purchases")
    op.drop_index("ix_task_purchases_task_id", table_name="task_purchases")
    op.drop_table("task_purchases")
    op.drop_index("ix_tasks_partner_user_id", table_name="tasks")
    op.drop_column("tasks", "partner_user_id")
