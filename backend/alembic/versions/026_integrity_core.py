"""«Честность» (репутация) — ядро в теневом режиме

Revision ID: 026
Revises: 025
Create Date: 2026-11-13

Журнал integrity_events (только добавление, идемпотентность по источнику), счёт и тир у пользователя
(users.integrity 500 / integrity_tier neutral), коды причин отказа у заявок и заданий и задел
tasks.min_integrity (пока не проверяется). Только server_default, без backfill. Идемпотентна:
повторный запуск на базе, где таблица или столбцы уже есть, ничего не ломает.
"""

from alembic import op
import sqlalchemy as sa

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None

USER_COLS = (
    ("integrity", lambda: sa.Column("integrity", sa.Integer(), nullable=False, server_default="500")),
    ("integrity_tier", lambda: sa.Column("integrity_tier", sa.String(length=16), nullable=False, server_default="neutral")),
    ("integrity_updated_at", lambda: sa.Column("integrity_updated_at", sa.DateTime(timezone=True), nullable=True)),
)
TASK_COLS = (
    ("reject_reason", lambda: sa.Column("reject_reason", sa.String(length=32), nullable=True)),
    ("min_integrity", lambda: sa.Column("min_integrity", sa.Integer(), nullable=False, server_default="0")),
)
SUB_COLS = (("reject_reason", lambda: sa.Column("reject_reason", sa.String(length=32), nullable=True)),)


def _cols(insp, table: str) -> set[str]:
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("integrity_events"):
        op.create_table(
            "integrity_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("event_type", sa.String(length=40), nullable=False),
            sa.Column("delta", sa.Integer(), nullable=False),
            sa.Column("half_life_days", sa.Integer(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("source_type", sa.String(length=24), nullable=True),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="applied"),
            sa.Column("voided_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("void_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("user_id", "event_type", "source_type", "source_id", name="uq_integrity_event_source"),
        )
    idx = {i["name"] for i in insp.get_indexes("integrity_events")} if insp.has_table("integrity_events") else set()
    for name, cols in (
        ("ix_integrity_events_user_id", ["user_id"]),
        ("ix_integrity_events_status", ["status"]),
        ("ix_integrity_events_user_created", ["user_id", "created_at"]),
    ):
        if name not in idx:
            op.create_index(name, "integrity_events", cols)
    for table, spec in (("users", USER_COLS), ("tasks", TASK_COLS), ("task_submissions", SUB_COLS)):
        have = _cols(insp, table)
        for name, make in spec:
            if name not in have:
                op.add_column(table, make())


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for table, spec in (("task_submissions", SUB_COLS), ("tasks", TASK_COLS), ("users", USER_COLS)):
        have = _cols(insp, table)
        drop = [name for name, _ in spec if name in have]
        if drop:
            with op.batch_alter_table(table) as batch:
                for name in drop:
                    batch.drop_column(name)
    if insp.has_table("integrity_events"):
        op.drop_table("integrity_events")
