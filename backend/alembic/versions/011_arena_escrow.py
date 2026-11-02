"""«Арена»: комнаты arena_rooms и места со ставками в холде arena_entries

Revision ID: 011
Revises: 010
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "arena_rooms",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("room_type", sa.String(8), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="waiting"),
        sa.Column("seats", sa.Integer(), nullable=False),
        sa.Column("stake_nano", sa.BigInteger(), nullable=False),
        sa.Column("commission_bps", sa.Integer(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("seed_salt", sa.String(32), nullable=False),
        sa.Column("seed_hash", sa.String(64), nullable=False),
        sa.Column("commission_nano", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("fill_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_arena_rooms_type_status", "arena_rooms", ["room_type", "status"])
    op.create_table(
        "arena_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("room_id", sa.Integer(), sa.ForeignKey("arena_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seat", sa.Integer(), nullable=True),
        sa.Column("held_nano", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="held"),
        sa.Column("place", sa.Integer(), nullable=True),
        sa.Column("prize_nano", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("room_id", "user_id", name="uq_arena_entries_room_user"),
        sa.UniqueConstraint("room_id", "seat", name="uq_arena_entries_room_seat"),
    )
    op.create_index("ix_arena_entries_user_id", "arena_entries", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_arena_entries_user_id", table_name="arena_entries")
    op.drop_table("arena_entries")
    op.drop_index("ix_arena_rooms_type_status", table_name="arena_rooms")
    op.drop_table("arena_rooms")
