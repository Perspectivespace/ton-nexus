"""Перенос старых типов заданий (manual_proof, link) в новые — SQL для миграции 017 и тестов.

Правило (самое безопасное: деньги, места, заявки и комиссия не трогаются, меняются только тип и флаг):
- link → visit (ссылка у такого задания уже есть), скриншот не обязателен;
- manual_proof, созданное владельцем → campaign со скриншотом;
- manual_proof остальных (амбассадоры, админы) → visit со скриншотом: создатель сохраняет
  права на своё задание (кампанией управляет только владелец).
commission_bp остаётся NULL — значит комиссия считается как раньше, от task_platform_commission_bp.
Исходный тип сохраняется в legacy_type, откат возвращает его. Повторный запуск ничего не меняет:
обновляются только строки со старым типом.
"""

from __future__ import annotations

LEGACY_TYPES = ("manual_proof", "link")


def _owner_clause(owner_tg_ids: set[int] | None) -> str:
    ids = sorted({int(x) for x in (owner_tg_ids or set())})
    env = f" OR u.telegram_id IN ({', '.join(str(i) for i in ids)})" if ids else ""
    return (
        "EXISTS (SELECT 1 FROM users u WHERE u.id = tasks.creator_id "
        f"AND (u.is_owner = TRUE{env}))"
    )


def upgrade_sql(owner_tg_ids: set[int] | None = None) -> list[str]:
    owner = _owner_clause(owner_tg_ids)
    return [
        "UPDATE tasks SET legacy_type = task_type, task_type = 'visit', proof_required = FALSE "
        "WHERE task_type = 'link'",
        "UPDATE tasks SET legacy_type = task_type, task_type = 'campaign', proof_required = TRUE "
        f"WHERE task_type = 'manual_proof' AND {owner}",
        "UPDATE tasks SET legacy_type = task_type, task_type = 'visit', proof_required = TRUE "
        "WHERE task_type = 'manual_proof'",
    ]


def downgrade_sql() -> list[str]:
    return [
        "UPDATE tasks SET task_type = legacy_type, proof_required = FALSE, legacy_type = NULL "
        "WHERE legacy_type IN ('manual_proof', 'link')",
    ]
