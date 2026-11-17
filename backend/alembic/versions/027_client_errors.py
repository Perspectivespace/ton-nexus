"""Ошибки клиента (Mini App) — P6

Revision ID: 027
Revises: 026
Create Date: 2026-11-17

Таблица client_errors: необработанные ошибки и отклонённые промисы из Mini App, сгруппированные по
отпечатку (счётчик, число игроков, первый и последний случай). Без персональных данных. Идемпотентна.
"""

from alembic import op
import sqlalchemy as sa

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if insp.has_table("client_errors"):
        return
    op.create_table(
        "client_errors",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("stack", sa.Text(), nullable=True),
        sa.Column("route", sa.String(length=120), nullable=True),
        sa.Column("build", sa.String(length=40), nullable=True),
        sa.Column("platform", sa.String(length=120), nullable=True),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("users", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("user_ids", sa.Text(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_client_errors_fingerprint", "client_errors", ["fingerprint"], unique=True)
    op.create_index("ix_client_errors_last_seen_at", "client_errors", ["last_seen_at"])


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if insp.has_table("client_errors"):
        op.drop_index("ix_client_errors_last_seen_at", table_name="client_errors")
        op.drop_index("ix_client_errors_fingerprint", table_name="client_errors")
        op.drop_table("client_errors")
