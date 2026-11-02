"""«Арена»: журнал ходов боя arena_turns

Revision ID: 013
Revises: 012
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "arena_turns",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("room_id", sa.Integer(), sa.ForeignKey("arena_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("turn", sa.Integer(), nullable=False),
        sa.Column("opens_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("plans_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("result_json", sa.Text(), nullable=True),
        sa.Column("reason", sa.String(16), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("room_id", "turn", name="uq_arena_turns_room_turn"),
    )


def downgrade() -> None:
    op.drop_table("arena_turns")
