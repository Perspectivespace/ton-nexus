"""users.is_owner (владельцы из приложения) и журнал ролей role_changes

Revision ID: 010
Revises: 009
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_owner", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_table(
        "role_changes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_role_changes_user_id", "role_changes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_role_changes_user_id", table_name="role_changes")
    op.drop_table("role_changes")
    op.drop_column("users", "is_owner")
