# Схема БД (MVP)

PostgreSQL · SQLAlchemy 2 async · Alembic (миграции — следующий шаг)

## Таблицы

| Таблица | Назначение |
|---------|------------|
| `users` | Telegram-пользователь, баланс, XP/level, Фокус/Запрет |
| `balance_history` | Леджер credit/debit |
| `miners` | 1 слот: статы + сессия |
| `miner_upgrade_logs` | Аудит double-wheel и burn |
| `tasks` | Задания заказчика |
| `task_submissions` | Ответы + модерация |
| `economy_settings` | Ключ → JSON (без деплоя) |
| `promo_codes` / `promo_redemptions` | Промо |
| `daily_checkins` | Daily + streak |
| `withdraw_requests` | Вывод manual |

## Майнер

Мощность · Ёмкость · Ускорение · Удача · Стабильность  
Статус: `idle` | `running` | `ready`

## Файлы

`backend/app/models/*` · `backend/app/db/session.py`
