"""Скриншоты-подтверждения (task_proofs, tasks.proof_required) и перенос старых типов заданий

Revision ID: 017
Revises: 016
Create Date: 2026-11-07
"""

from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def _owner_ids() -> set[int]:
    try:
        from app.core.telegram_auth import env_owner_ids

        return env_owner_ids()
    except Exception:
        return set()


def upgrade() -> None:
    op.add_column("tasks", sa.Column("proof_required", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("tasks", sa.Column("legacy_type", sa.String(32), nullable=True))
    op.create_table(
        "task_proofs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("submission_id", sa.Integer(), sa.ForeignKey("task_submissions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("filename", sa.String(64), nullable=False, unique=True),
        sa.Column("mime", sa.String(32), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delete_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delete_reason", sa.String(32), nullable=True),
    )
    op.create_index("ix_task_proofs_task_id", "task_proofs", ["task_id"])
    op.create_index("ix_task_proofs_user_id", "task_proofs", ["user_id"])
    op.create_index("ix_task_proofs_submission_id", "task_proofs", ["submission_id"])
    op.create_index("ix_task_proofs_due", "task_proofs", ["deleted_at", "delete_after"])

    from app.services.task_legacy import upgrade_sql

    for stmt in upgrade_sql(_owner_ids()):
        op.execute(stmt)


def downgrade() -> None:
    from app.services.task_legacy import downgrade_sql

    for stmt in downgrade_sql():
        op.execute(stmt)
    op.drop_index("ix_task_proofs_due", table_name="task_proofs")
    op.drop_index("ix_task_proofs_submission_id", table_name="task_proofs")
    op.drop_index("ix_task_proofs_user_id", table_name="task_proofs")
    op.drop_index("ix_task_proofs_task_id", table_name="task_proofs")
    op.drop_table("task_proofs")
    op.drop_column("tasks", "legacy_type")
    op.drop_column("tasks", "proof_required")
