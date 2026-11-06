"""tasks.commission_bp — снимок комиссии тарифа при создании (visit и далее)

Revision ID: 014
Revises: 013
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("commission_bp", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tasks", "commission_bp")
