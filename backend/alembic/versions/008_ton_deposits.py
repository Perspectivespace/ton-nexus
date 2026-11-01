"""ton deposits and chain cursors

Revision ID: 008
Revises: 007
Create Date: 2026-11-01
"""

from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deposit_memo", sa.String(16), nullable=True))
    op.create_index("ix_users_deposit_memo", "users", ["deposit_memo"], unique=True)

    op.create_table(
        "ton_deposits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tx_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("amount_ton", sa.Numeric(18, 8), nullable=False),
        sa.Column("amount_nano", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("memo", sa.String(64), nullable=True),
        sa.Column("comment", sa.String(255), nullable=True),
        sa.Column("lt", sa.BigInteger(), nullable=True),
        sa.Column("utime", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("from_address", sa.String(66), nullable=True),
        sa.Column("credited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tx_hash"),
    )
    op.create_index("ix_ton_deposits_user_id", "ton_deposits", ["user_id"])
    op.create_index("ix_ton_deposits_status", "ton_deposits", ["status"])

    op.create_table(
        "chain_cursors",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.String(66), nullable=False),
        sa.Column("last_hash", sa.String(64), nullable=True),
        sa.Column("lt", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("chain_cursors")
    op.drop_index("ix_ton_deposits_status", table_name="ton_deposits")
    op.drop_index("ix_ton_deposits_user_id", table_name="ton_deposits")
    op.drop_table("ton_deposits")
    op.drop_index("ix_users_deposit_memo", table_name="users")
    op.drop_column("users", "deposit_memo")
