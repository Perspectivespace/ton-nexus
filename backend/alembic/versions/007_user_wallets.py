"""user wallets and proof payloads

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
        sa.Column("address", sa.String(66), nullable=False),
        sa.Column("wallet_app", sa.String(64), nullable=True),
        sa.Column("public_key", sa.String(64), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proof_payload_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_wallets_user_id", "user_wallets", ["user_id"])
    op.create_index("ix_user_wallets_address", "user_wallets", ["address"])
    # Partial unique: one active wallet per user
    op.create_index(
        "ix_user_wallets_active_user",
        "user_wallets",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("unlinked_at IS NULL"),
    )

    op.create_table(
        "wallet_proof_payloads",
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
    op.create_index("ix_wallet_proof_payloads_user_id", "wallet_proof_payloads", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_wallet_proof_payloads_user_id", table_name="wallet_proof_payloads")
    op.drop_table("wallet_proof_payloads")
    op.drop_index("ix_user_wallets_active_user", table_name="user_wallets")
    op.drop_index("ix_user_wallets_address", table_name="user_wallets")
    op.drop_index("ix_user_wallets_user_id", table_name="user_wallets")
    op.drop_table("user_wallets")
