# Облачный запуск бесплатно (Neon + Railway + Vercel)

На компьютере **ничего ставить не нужно** (кроме браузера).

Порядок: **1 Neon → 2 Railway → 3 Vercel**.

---

## Часть 1. База данных — Neon (бесплатно)

1. Открой https://neon.tech  
2. **Sign up** → войти через **GitHub**  
3. **Create a project**  
   - Name: `ton-nexus`  
   - Region: ближайший (например Frankfurt / Europe)  
   - Create  
4. На экране Connection string скопируй строку вида:

```text
postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
```

5. **Важно:** для нашего Python-бэкенда замени начало:

```text
postgresql://
```

на

```text
postgresql+asyncpg://
```

и `sslmode=require` замени на `ssl=require`.

**Итоговая строка (пример):**

```text
postgresql+asyncpg://USER:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?ssl=require
```

Сохрани её в блокнот — понадобится на Railway.

---

## Часть 2. Backend API — Railway (бесплатный trial / hobby)

1. Открой https://railway.app  
2. **Login with GitHub**  
3. **New Project** → **Deploy from GitHub repo**  
4. Выбери репозиторий **`Perspectivespace/ton-nexus`**  
   (если не виден: Configure GitHub App → разреши доступ к репо)  
5. Railway создаст сервис. Открой его → **Settings**:

### Root Directory

```text
backend
```

Сохрани.

### Variables (вкладка Variables) — добавь по одной:

| Имя | Значение |
|-----|----------|
| `DEBUG` | `true` |
| `DATABASE_URL` | твоя строка из Neon (`postgresql+asyncpg://...?ssl=require`) |
| `TELEGRAM_OWNER_IDS` | `1` (пока так; позже свой Telegram id) |
| `DEV_TELEGRAM_ID` | `1` (то же число) |
| `WEBAPP_URL` | пока `https://example.com` — **потом** заменишь на URL Vercel |
| `TELEGRAM_BOT_TOKEN` | можно пусто |

### Start / Deploy

Если Railway сам не подхватил Procfile, в Settings → Deploy:

**Custom Start Command:**

```text
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

**Build:** обычно Nixpacks сам ставит `requirements.txt` из папки `backend`.

6. Дождись статуса **Success** (Deployments).  
7. **Settings → Networking → Generate Domain**  
   Получишь адрес вида:

```text
https://ton-nexus-production-xxxx.up.railway.app
```

8. Проверка в браузере:

```text
https://ТВОЙ-RAILWAY-ДОМЕН/health
```

Должно быть: `{"status":"ok", ...}`  
Ещё: `https://ТВОЙ-RAILWAY-ДОМЕН/docs` — документация API.

Если деплой красный — открой **View Logs** и пришли последние 20 строк (часто ошибка в `DATABASE_URL` или Root Directory не `backend`).

---

## Часть 3. Frontend — Vercel (бесплатно)

1. Открой https://vercel.com  
2. **Continue with GitHub**  
3. **Add New… → Project** → **`ton-nexus`**  
4. Настройки импорта:

| Поле | Значение |
|------|----------|
| Framework Preset | **Vite** |
| Root Directory | **`frontend`** (кнопка Edit) |
| Build Command | `npm run build` (по умолчанию) |
| Output Directory | `dist` |

5. **Environment Variables** (до Deploy):

| Name | Value |
|------|--------|
| `VITE_API_BASE` | `https://ТВОЙ-RAILWAY-ДОМЕН` **без** слэша в конце |
| `VITE_DEV_TG_ID` | `1` |

Пример: `VITE_API_BASE` = `https://ton-nexus-production-xxxx.up.railway.app`

6. **Deploy** → жди ~1–2 минуты.  
7. Открой выданный URL:

```text
https://ton-nexus-xxxx.vercel.app
```

Должен открыться интерфейс приложения.

8. Вернись на **Railway → Variables** и поставь:

```text
WEBAPP_URL=https://ton-nexus-xxxx.vercel.app
```

(необязательно для браузерного теста, пригодится позже для бота.)

---

## Часть 4. Проверка

1. Vercel-сайт открывается  
2. На Home есть баланс / уровень (dev-пользователь)  
3. Railway `/health` = ok  
4. Если `TELEGRAM_OWNER_IDS=1` и `VITE_DEV_TG_ID=1` — видны Owner / Inbox  

---

## Твой Telegram ID (когда захочешь «быть владельцем по-настоящему»)

1. В Telegram найди бота **@userinfobot** → Start  
2. Он пришлёт **Id** (число)  
3. На Railway поменяй:
   - `TELEGRAM_OWNER_IDS` = это число  
   - `DEV_TELEGRAM_ID` = это же число  
4. На Vercel: `VITE_DEV_TG_ID` = это же число → **Redeploy**

---

## Частые ошибки

| Проблема | Решение |
|----------|---------|
| Railway падает на старте | Root Directory = `backend`; `DATABASE_URL` с `postgresql+asyncpg://` и `?ssl=require` |
| Vercel build error TypeScript | Смотри лог; часто забыли Root = `frontend` |
| Сайт открылся, данные не грузятся | `VITE_API_BASE` должен быть **https** Railway **без** `/` в конце; сделай Redeploy frontend после смены env |
| CORS | В backend уже `allow_origins=["*"]` |
| 401 | На Railway `DEBUG=true` |

---

## Деньги / лимиты (ориентир)

- **Neon** — free tier для разработки  
- **Railway** — trial / лимиты; следи за usage в кабинете  
- **Vercel** — hobby бесплатно для такого проекта  

Когда trial кончится — можно перенести backend на Render free или другой хост; frontend на Vercel обычно остаётся.

---

## Бот Telegram — позже

Сначала добейся, чтобы **Vercel-сайт + Railway API** работали в браузере.  
Mini App внутри Telegram = отдельный шаг (токен бота + HTTPS URL уже с Vercel).
