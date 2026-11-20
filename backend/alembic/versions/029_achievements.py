"""Достижения: полученные ступени и закреплённый значок

Revision ID: 029
Revises: 028
Create Date: 2026-11-19

Таблица achievement_awards (одна строка на игрока, ветку и ступень; статус награды, рассылка в боте,
праздничное окно) и users.ach_pin — значок, закреплённый в профиле. Настройка веток — economy_settings
«achievements» (её сеет приложение при старте). Идемпотентна.
"""

from alembic import op
import sqlalchemy as sa

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("achievement_awards"):
        op.create_table(
            "achievement_awards",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("branch", sa.String(length=16), nullable=False),
            sa.Column("tier", sa.Integer(), nullable=False),
            sa.Column("ton", sa.Numeric(18, 8), nullable=False, server_default="0"),
            sa.Column("xp", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=12), nullable=False, server_default="paid"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("user_id", "branch", "tier", name="uq_achievement_awards_user_branch_tier"),
        )
        op.create_index("ix_achievement_awards_user_id", "achievement_awards", ["user_id"])
        op.create_index("ix_achievement_awards_branch_tier", "achievement_awards", ["branch", "tier"])
        op.create_index("ix_achievement_awards_status", "achievement_awards", ["status"])
    if "ach_pin" not in {c["name"] for c in insp.get_columns("users")}:
        op.add_column("users", sa.Column("ach_pin", sa.String(length=32), nullable=True))


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "ach_pin" in {c["name"] for c in insp.get_columns("users")}:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("ach_pin")
    if insp.has_table("achievement_awards"):
        op.drop_index("ix_achievement_awards_status", table_name="achievement_awards")
        op.drop_index("ix_achievement_awards_branch_tier", table_name="achievement_awards")
        op.drop_index("ix_achievement_awards_user_id", table_name="achievement_awards")
        op.drop_table("achievement_awards")
