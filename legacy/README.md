# Legacy Telegram Bot (архив)

Старый Task & Reward бот на `python-telegram-bot` + SQLite.

## Зачем здесь

Справочник бизнес-логики при переносе в FastAPI + Mini App. **Не прод.**

## Структура

| Путь | Содержание |
|------|------------|
| `bot/` | Ядро: `bot.py`, баланс, антифрод, кошельки, captcha |
| `games/` | **Frozen:** blackjack, tournament (не переносим в MVP) |
| `docs/` | Старые описания |

## Что переносим в новый продукт (логика, не код 1:1)

- Пользователи, рефералы
- Задания + модерация
- Баланс + `balance_history`
- Майнер (start/claim/upgrade) → переработка под double-wheel
- Промокоды, daily
- Вывод (manual)
- Антифрод / wallet links

## Что не переносим в MVP

- RPS / КНБ
- Blackjack
- Турниры

Новый код — в `backend/`, `frontend/`, тонкий `bot/`.
