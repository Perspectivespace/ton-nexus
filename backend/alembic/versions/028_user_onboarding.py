"""Знакомство игрока: что уже показано (вводные экраны и подсказки разделов)

Revision ID: 028
Revises: 027
Create Date: 2026-11-17

Новый столбец users.onboarding (JSON): {"intro": bool, "hints": ["home", "miner", ...]}. Хранится на
сервере, поэтому знакомство не повторяется на другом устройстве. Пусто — новый игрок: покажем всё.
Уже существующие игроки знакомство и разделы видели — им ставим «всё показано» (повтор — из Профиля).
Идемпотентна.
"""

from alembic import op
import sqlalchemy as sa

revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None

SEEN_ALL = {"intro": True, "hints": ["home", "miner", "earn", "profile"]}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "onboarding" in {c["name"] for c in insp.get_columns("users")}:
        return
    op.add_column("users", sa.Column("onboarding", sa.JSON(), nullable=True))
    # параметр типа JSON: в Postgres столбец json, строковый параметр (VARCHAR) он не примет — миграция падала
    op.execute(sa.text("UPDATE users SET onboarding = :v").bindparams(sa.bindparam("v", SEEN_ALL, type_=sa.JSON())))


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "onboarding" in {c["name"] for c in insp.get_columns("users")}:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("onboarding")
