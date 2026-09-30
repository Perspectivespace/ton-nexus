# TON Nexus / Task Forge

Telegram Mini App: **рынок заданий (TON)** + **майнер-контур** + рулетки + ручные выводы.

## Репозиторий

| Путь | Назначение |
|------|------------|
| `docs/` | Концепция, промпты ИИ, TODO — **источник правды** |
| `backend/` | FastAPI API |
| `frontend/` | React Mini App |
| `bot/` | Тонкий бот (WebApp-кнопка) |
| `legacy/` | Старый бот — архив |

## Документы

- [docs/CONCEPT.md](docs/CONCEPT.md) — продукт, MVP
- [docs/PROMPTS.md](docs/PROMPTS.md) — дизайн для ИИ
- [docs/LOCAL_RUN.md](docs/LOCAL_RUN.md) — **локальный запуск без Docker**
- [docs/TODO.md](docs/TODO.md) — задачи

## Стек

- Backend: FastAPI + SQLAlchemy 2 async + PostgreSQL
- Frontend: React 19 + Vite + TypeScript + Tailwind + Framer Motion
- Bot: aiogram 3

## Локальный запуск

Полная инструкция: **[docs/LOCAL_RUN.md](docs/LOCAL_RUN.md)**

Кратко:

```bash
# 1) Postgres: user nexus / db ton_nexus

# 2) Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 3) Frontend (другой терминал)
cd frontend && cp .env.example .env && npm install && npm run dev
```

- API: http://localhost:8000/docs  
- App: http://localhost:5173  
- DEBUG-логин в браузере: `dev:<telegram_id>` (см. LOCAL_RUN)

## Принципы

1. UI — продуктовый custom, не шаблон
2. Вывод TON — только manual
3. Экономика — `economy_settings`
4. MVP: 1 слот майнера; игры позже
5. Усиление — double wheel, 100% burn
