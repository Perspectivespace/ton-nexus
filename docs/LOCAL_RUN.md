# Локальный запуск (без Docker-стека)

Нужны: **Python 3.11+**, **Node 20+**, **PostgreSQL 15+**.

Docker для всего приложения **не обязателен**. Postgres — системная служба (Windows: установщик / WSL).

---

## 1. PostgreSQL

```sql
CREATE USER nexus WITH PASSWORD 'nexus';
CREATE DATABASE ton_nexus OWNER nexus;
GRANT ALL PRIVILEGES ON DATABASE ton_nexus TO nexus;
```

Проверка: `psql -U nexus -d ton_nexus -h localhost`

---

## 2. Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux / macOS / WSL
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

`.env`:

```env
DEBUG=true
DATABASE_URL=postgresql+asyncpg://nexus:nexus@localhost:5432/ton_nexus
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_IDS=1
DEV_TELEGRAM_ID=1
WEBAPP_URL=http://localhost:5173
```

Подставь свой числовой Telegram id в `TELEGRAM_OWNER_IDS` и `DEV_TELEGRAM_ID` (один и тот же), чтобы в UI были кнопки Owner / Inbox.

```bash
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Health: http://localhost:8000/health  
- Docs: http://localhost:8000/docs  

При `DEBUG=true` на старте сидятся ключи economy.  
Браузер без Telegram: header `X-Telegram-Init-Data: dev:<id>`.

**DEBUG только локально, не на проде.**

---

## 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

http://localhost:5173

```env
VITE_API_BASE=http://localhost:8000
VITE_DEV_TG_ID=1
```

В `npm run dev` frontend сам шлёт `dev:<VITE_DEV_TG_ID>`.

---

## 4. Бот (опционально)

Для кнопки WebApp в Telegram нужен **HTTPS** (ngrok / cloudflared), не `localhost`.

```bash
cd bot
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# TELEGRAM_BOT_TOKEN + WEBAPP_URL=https://...
python main.py
```

---

## 5. Smoke

1. `/health` ok  
2. Frontend Home — баланс  
3. Owner (если id = owner)  
4. Майнер → старт  
5. Swagger: `GET /api/v1/me` + header `X-Telegram-Init-Data: dev:1`

---

## Ошибки

| Симптом | Действие |
|---------|----------|
| connection refused :5432 | Postgres запущен, пароль/БД |
| Alembic fail | venv + `cd backend` |
| 401 | `DEBUG=true`, dev header |
| нет Owner | совпадают OWNER_IDS и DEV_TG_ID |
