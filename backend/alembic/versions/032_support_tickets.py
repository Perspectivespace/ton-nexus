"""Тикеты поддержки: обращения игроков в закрытый чат

Revision ID: 032
Revises: 031
Create Date: 2026-11-27

Таблица support_tickets: категория, текст, флаг скриншота, статус, привязка к сообщению
в закрытом чате (chat_id / chat_message_id) и последний ответ поддержки. Скриншоты на диск
не пишутся — только пересылаются в чат. Идемпотентна.
"""

from alembic import op
import sqlalchemy as sa

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if insp.has_table("support_tickets"):
        return
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("has_screenshot", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("chat_id", sa.BigInteger(), nullable=True),
        sa.Column("chat_message_id", sa.BigInteger(), nullable=True),
        sa.Column("reply_text", sa.Text(), nullable=True),
        sa.Column("replied_by_tg_id", sa.BigInteger(), nullable=True),
        sa.Column("replied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_support_tickets_user_id", "support_tickets", ["user_id"])
    op.create_index("ix_support_tickets_status", "support_tickets", ["status"])
    op.create_index("ix_support_tickets_chat_message_id", "support_tickets", ["chat_message_id"])


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("support_tickets"):
        return
    op.drop_index("ix_support_tickets_chat_message_id", table_name="support_tickets")
    op.drop_index("ix_support_tickets_status", table_name="support_tickets")
    op.drop_index("ix_support_tickets_user_id", table_name="support_tickets")
    op.drop_table("support_tickets")
