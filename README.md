# TON Nexus / Task Forge

Telegram Mini App: **рынок заданий (TON)** + **майнер-контур** + рулетки + ручные выводы.

## Репозиторий

| Путь | Назначение |
|------|------------|
| `docs/` | Концепция, промпты ИИ, TODO — **источник правды** |
| `backend/` | FastAPI API (новое ядро) |
| `frontend/` | React Mini App (далее) |
| `bot/` | Тонкий бот (WebApp-кнопка, уведомления) |
| `legacy/` | Старый бот — архив логики, не прод |

## Документы

- [docs/CONCEPT.md](docs/CONCEPT.md) — продукт, MVP, монетизация
- [docs/PROMPTS.md](docs/PROMPTS.md) — дизайн и эталоны для ИИ
- [docs/TODO.md](docs/TODO.md) — задачи
- [legacy/README.md](legacy/README.md) — что брать из старого кода

## Стек

- Backend: FastAPI + SQLAlchemy 2 async + PostgreSQL
- Frontend: React 19 + Vite + TypeScript + Tailwind + Framer Motion
- Bot: тонкий python-telegram-bot / aiogram

## Быстрый старт backend (каркас)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Health: http://localhost:8000/health · Docs: http://localhost:8000/docs

## Принципы

1. UI — продуктовый custom, не miner-шаблон
2. Вывод TON — только manual
3. Экономика — `economy_settings`
4. MVP: 1 слот майнера; игры и «дома» — не сейчас
5. Усиление — на экране Майнер (double wheel, 100% burn)
