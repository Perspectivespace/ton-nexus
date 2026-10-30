"""ratings: xp gain log (monthly level top) and index for the tasks top

Revision ID: 006
Revises: 005
Create Date: 2026-10-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # журнал начислений опыта — «Опыт за месяц»; история до миграции не восстанавливается
    op.create_table(
        "xp_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="other"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_xp_events_user_id", "xp_events", ["user_id"])
    op.create_index("ix_xp_events_created_user", "xp_events", ["created_at", "user_id"])
    # топ исполнителей: принятые задания за месяц по reviewed_at
    op.create_index("ix_task_submissions_status_reviewed", "task_submissions", ["status", "reviewed_at"])


def downgrade() -> None:
    op.drop_index("ix_task_submissions_status_reviewed", table_name="task_submissions")
    op.drop_index("ix_xp_events_created_user", table_name="xp_events")
    op.drop_index("ix_xp_events_user_id", table_name="xp_events")
    op.drop_table("xp_events")
