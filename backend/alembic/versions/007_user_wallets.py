"""user wallets and ton_proof nonces

Revision ID: 007
Revises: 006
Create Date: 2026-11-01
"""

from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_wallets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("address_raw", sa.String(66), nullable=False),
        sa.Column("address", sa.String(48), nullable=False),
        sa.Column("network", sa.String(16), nullable=False),
        sa.Column("wallet_app", sa.String(64), nullable=True),
        sa.Column("public_key", sa.String(64), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proof_nonce_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_wallets_user_id", "user_wallets", ["user_id"])
    op.create_index("ix_user_wallets_address_raw", "user_wallets", ["address_raw"])
    # Partial unique indexes (Postgres + SQLite compatible where)
    op.create_index(
        "ix_user_wallets_active_user",
        "user_wallets",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("unlinked_at IS NULL"),
        sqlite_where=sa.text("unlinked_at IS NULL"),
    )
    op.create_index(
        "ix_user_wallets_active_address",
        "user_wallets",
        ["address_raw"],
        unique=True,
        postgresql_where=sa.text("unlinked_at IS NULL"),
        sqlite_where=sa.text("unlinked_at IS NULL"),
    )

    op.create_table(
        "ton_proof_nonces",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("payload", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payload"),
    )
    op.create_index("ix_ton_proof_nonces_user_id", "ton_proof_nonces", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ton_proof_nonces_user_id", table_name="ton_proof_nonces")
    op.drop_table("ton_proof_nonces")
    op.drop_index("ix_user_wallets_active_address", table_name="user_wallets")
    op.drop_index("ix_user_wallets_active_user", table_name="user_wallets")
    op.drop_index("ix_user_wallets_address_raw", table_name="user_wallets")
    op.drop_index("ix_user_wallets_user_id", table_name="user_wallets")
    op.drop_table("user_wallets")
