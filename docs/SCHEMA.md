# Схема БД (MVP)

PostgreSQL · SQLAlchemy 2 async · Alembic (миграции — следующий шаг)

## Таблицы

| Таблица | Назначение |
|---------|------------|
| `users` | Telegram-пользователь, баланс, XP/level, Фокус/Запрет; `integrity` / `integrity_tier` — «Честность» (теневой режим, игроку не видна) |
| `balance_history` | Леджер credit/debit |
| `miners` | 1 слот: статы + сессия |
| `miner_upgrade_logs` | Аудит double-wheel и burn |
| `tasks` | Задания заказчика; `reject_reason` (bad_task/other), `min_integrity` (пока не проверяется) |
| `task_submissions` | Ответы + модерация; `reject_reason` (low_quality/wrong_task/duplicate/forged/other) |
| `economy_settings` | Ключ → JSON (без деплоя) |
| `promo_codes` / `promo_redemptions` | Промо |
| `daily_checkins` | Daily + streak |
| `withdraw_requests` | Вывод manual |
| `user_wallets` | Привязки TON-кошельков (TON Connect) |
| `ton_deposits` | Пополнения TON по мемо |
| `chain_cursors` | Курсор опроса toncenter |
| `wallet_proof_payloads` | Nonce для ton_proof |
| `arena_rooms` | «Арена»: комнаты (a4/a8), статус, ставка/комиссия в nanoTON, seed commit–reveal, доход с комиссии |
| `arena_entries` | «Арена»: места игроков, ставка в холде, итоговое место и приз (`docs/arena/RULES.md`) |
| `integrity_events` | «Честность»: журнал событий (только добавление; уникально по пользователь+тип+источник), Δ, полураспад, статус applied/pending_review/voided (`docs/tasks/05-integrity-core-shadow.md`, миграция 026) |

## Майнер

Мощность · Ёмкость · Ускорение · Удача · Стабильность  
Статус: `idle` | `running` | `ready`

## «Честность» (R1, теневой режим)

Счёт 0–1000, старт 500: `start + floor(Σ Δ × 0.5^(возраст/полураспад))` по applied-событиям. Тиры: Неприязнь 0–199 · Настороженность 200–399 · Нейтрально 400–599 · Дружелюбие 600–749 · Уважение 750–849 · Почтение 850–949 · Превознесение 950–1000. Настройка `integrity_rules` (веса, лимиты, пороги проверки, тиры); эффектов на игроков нет, API `/api/v1/integrity/*` — только владелец.

## Файлы

`backend/app/models/*` · `backend/app/db/session.py`
