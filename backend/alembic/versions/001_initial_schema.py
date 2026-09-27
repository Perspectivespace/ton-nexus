"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-09-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("first_name", sa.String(255), nullable=True),
        sa.Column("last_name", sa.String(255), nullable=True),
        sa.Column("language_code", sa.String(16), nullable=True),
        sa.Column("balance", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("focus_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("block_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_boost_bp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("referred_by_id", sa.BigInteger(), nullable=True),
        sa.Column("is_banned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_ambassador", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("telegram_id"),
    )
    op.create_index("ix_users_telegram_id", "users", ["telegram_id"])
    op.create_index("ix_users_referred_by_id", "users", ["referred_by_id"])

    op.create_table(
        "balance_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("operation_type", sa.String(16), nullable=False),
        sa.Column("amount", sa.Numeric(18, 8), nullable=False),
        sa.Column("balance_type", sa.String(32), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("reference_type", sa.String(32), nullable=True),
        sa.Column("reference_id", sa.Integer(), nullable=True),
        sa.Column("balance_after", sa.Numeric(18, 8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_balance_history_user_id", "balance_history", ["user_id"])
    op.create_index("ix_balance_history_balance_type", "balance_history", ["balance_type"])
    op.create_index("ix_balance_history_created_at", "balance_history", ["created_at"])

    op.create_table(
        "miners",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("power", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("acceleration", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("luck", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("stability", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(16), nullable=False, server_default="idle"),
        sa.Column("session_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pending_reward", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_miners_user_id", "miners", ["user_id"])

    op.create_table(
        "miner_upgrade_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("miner_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("cost", sa.Numeric(18, 8), nullable=False),
        sa.Column("upgrade_type", sa.String(32), nullable=False),
        sa.Column("success_chance_bp", sa.Integer(), nullable=False),
        sa.Column("rolled_success", sa.Boolean(), nullable=False),
        sa.Column("used_focus", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("used_block_type", sa.String(32), nullable=True),
        sa.Column("meta", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["miner_id"], ["miners.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_miner_upgrade_logs_miner_id", "miner_upgrade_logs", ["miner_id"])
    op.create_index("ix_miner_upgrade_logs_user_id", "miner_upgrade_logs", ["user_id"])

    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("creator_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("task_type", sa.String(32), nullable=False, server_default="manual_proof"),
        sa.Column("target_url", sa.String(1024), nullable=True),
        sa.Column("reward", sa.Numeric(18, 8), nullable=False),
        sa.Column("total_slots", sa.Integer(), nullable=False),
        sa.Column("filled_slots", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("budget_locked", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("min_level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("xp_reward", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_creator_id", "tasks", ["creator_id"])
    op.create_index("ix_tasks_status", "tasks", ["status"])

    op.create_table(
        "task_submissions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("proof_text", sa.Text(), nullable=True),
        sa.Column("proof_url", sa.String(1024), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_submissions_task_id", "task_submissions", ["task_id"])
    op.create_index("ix_task_submissions_user_id", "task_submissions", ["user_id"])
    op.create_index("ix_task_submissions_status", "task_submissions", ["status"])

    op.create_table(
        "economy_settings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_economy_settings_key", "economy_settings", ["key"])

    op.create_table(
        "promo_codes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("reward_ton", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("reward_xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reward_focus", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_promo_codes_code", "promo_codes", ["code"])

    op.create_table(
        "promo_redemptions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("promo_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["promo_id"], ["promo_codes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_promo_redemptions_promo_id", "promo_redemptions", ["promo_id"])
    op.create_index("ix_promo_redemptions_user_id", "promo_redemptions", ["user_id"])

    op.create_table(
        "daily_checkins",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("check_date", sa.Date(), nullable=False),
        sa.Column("streak", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reward_ton", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_daily_checkins_user_id", "daily_checkins", ["user_id"])
    op.create_index("ix_daily_checkins_check_date", "daily_checkins", ["check_date"])

    op.create_table(
        "withdraw_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 8), nullable=False),
        sa.Column("wallet_address", sa.String(128), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by_telegram_id", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_withdraw_requests_user_id", "withdraw_requests", ["user_id"])
    op.create_index("ix_withdraw_requests_wallet_address", "withdraw_requests", ["wallet_address"])
    op.create_index("ix_withdraw_requests_status", "withdraw_requests", ["status"])
    op.create_index("ix_withdraw_requests_created_at", "withdraw_requests", ["created_at"])


def downgrade() -> None:
    op.drop_table("withdraw_requests")
    op.drop_table("daily_checkins")
    op.drop_table("promo_redemptions")
    op.drop_table("promo_codes")
    op.drop_table("economy_settings")
    op.drop_table("task_submissions")
    op.drop_table("tasks")
    op.drop_table("miner_upgrade_logs")
    op.drop_table("miners")
    op.drop_table("balance_history")
    op.drop_table("users")
