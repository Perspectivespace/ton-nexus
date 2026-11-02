"""«Арена»: состояние боя набранной комнаты arena_matches

Revision ID: 012
Revises: 011
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "arena_matches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("room_id", sa.Integer(), sa.ForeignKey("arena_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("turn", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("state_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("room_id", name="uq_arena_matches_room_id"),
    )


def downgrade() -> None:
    op.drop_table("arena_matches")
