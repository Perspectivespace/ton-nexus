"""Язык приложения игрока (ru / en)

Revision ID: 025
Revises: 024
Create Date: 2026-11-12

Новый столбец users.lang — выбор в Профиле «Язык / Language», общий для всех устройств. Пусто — язык
берётся из Telegram (language_code): ru, uk, be, kk → русский, остальные → английский. Существующие
игроки не меняются: у них пусто, то есть язык Telegram.
"""

from alembic import op
import sqlalchemy as sa

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("lang", sa.String(length=8), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("lang")
