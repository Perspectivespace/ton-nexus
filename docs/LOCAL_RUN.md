# Локальный запуск TON Nexus — пошагово (Windows)

Цель: открыть приложение в браузере на `http://localhost:5173` и API на `http://localhost:8000`.

Docker **не нужен**. Бот Telegram **пока не нужен** — тестируем в обычном Chrome.

---

## Что должно быть установлено заранее

Проверь по очереди. Если чего-то нет — поставь, потом иди дальше.

### A. Git

1. Открой сайт: https://git-scm.com/download/win  
2. Скачай и установи (всё «Next»).  
3. Открой **Git Bash** (поиск Windows → «Git Bash»).  
4. Введи:

```bash
git --version
```

Должно показать номер версии, например `git version 2.4x`.

### B. Python 3.11 или 3.12

1. https://www.python.org/downloads/  
2. Скачай **Windows installer (64-bit)**.  
3. В начале установки **обязательно галочка** «Add python.exe to PATH».  
4. В Git Bash:

```bash
python --version
```

Должно быть `Python 3.11` или `3.12` (не 2.x).

Если пишет «command not found» — перезапусти Git Bash или поставь Python снова с галочкой PATH.

### C. Node.js 20+

1. https://nodejs.org/  → кнопка **LTS**  
2. Установи.  
3. В Git Bash:

```bash
node --version
npm --version
```

Должны появиться номера версий.

### D. PostgreSQL

1. https://www.enterprisedb.com/downloads/postgres-postgresql-downloads  
   или официальный установщик: https://www.postgresql.org/download/windows/  
2. Установи **PostgreSQL 16** (или 15).  
3. Запомни пароль пользователя **postgres**, который спросит установщик.  
4. Порт оставь **5432**.  
5. Stack Builder можно закрыть / пропустить.

После установки в меню «Пуск» появится **pgAdmin** и **SQL Shell (psql)**.

---

## Шаг 0. Скачать проект

Открой **Git Bash** и выполни (папку можно свою):

```bash
cd ~
mkdir -p projects
cd projects
git clone https://github.com/Perspectivespace/ton-nexus.git
cd ton-nexus
ls
```

Должны быть папки: `backend`, `frontend`, `bot`, `docs`.

Если репозиторий уже есть:

```bash
cd ~/projects/ton-nexus
git pull
```

---

## Шаг 1. Создать базу данных

1. Открой **SQL Shell (psql)** из меню Пуск.  
2. Жми Enter на все вопросы (Server, Database, Port, Username = postgres).  
3. Введи **пароль postgres**, который задал при установке.  
4. Вставь **по одной** эти команды (после каждой — Enter):

```sql
CREATE USER nexus WITH PASSWORD 'nexus';
```

```sql
CREATE DATABASE ton_nexus OWNER nexus;
```

```sql
GRANT ALL PRIVILEGES ON DATABASE ton_nexus TO nexus;
```

Если пишет `already exists` — значит уже создано, это нормально.

5. Выйти: `\q` и Enter.

---

## Шаг 2. Настроить и запустить Backend (API)

Всё в **Git Bash**.

### 2.1. Зайти в папку backend

```bash
cd ~/projects/ton-nexus/backend
```

### 2.2. Создать виртуальное окружение Python

```bash
python -m venv .venv
```

### 2.3. Включить его

```bash
source .venv/Scripts/activate
```

В начале строки появится `(.venv)` — значит ок.

> Если `source` не сработал:
> ```bash
> .venv/Scripts/activate
> ```
> или в **cmd**:
> ```cmd
> .venv\Scripts\activate.bat
> ```

### 2.4. Поставить библиотеки

```bash
pip install -r requirements.txt
```

Подожди, пока закончится без красных ошибок.

### 2.5. Файл настроек `.env`

```bash
cp .env.example .env
```

Открой файл `.env` блокнотом (или в Cursor / VS Code):

```bash
notepad .env
```

Содержимое должно быть таким (можно оставить как есть для первого теста):

```env
DEBUG=true
DATABASE_URL=postgresql+asyncpg://nexus:nexus@localhost:5432/ton_nexus
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_IDS=1
DEV_TELEGRAM_ID=1
WEBAPP_URL=http://localhost:5173
```

Сохрани и закрой.

**Позже** вместо `1` можно поставить свой Telegram ID (узнать у бота `@userinfobot`). Тогда в приложении будут кнопки Owner.

### 2.6. Создать таблицы в базе

Убедись, что в строке есть `(.venv)` и ты в папке `backend`:

```bash
pwd
alembic upgrade head
```

Должно пройти без ошибки `connection refused`.  
Если `connection refused` — Postgres не запущен: Пуск → службы → postgresql → Start.

### 2.7. Запустить API

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Оставь это окно **открытым**. Не закрывай.

Проверка: открой в браузере:

- http://localhost:8000/health  
  Должно быть что-то вроде: `{"status":"ok",...}`
- http://localhost:8000/docs  
  Должна открыться документация API (Swagger).

---

## Шаг 3. Запустить Frontend (интерфейс)

Открой **второе** окно Git Bash (первое с uvicorn не трогай).

### 3.1. Папка frontend

```bash
cd ~/projects/ton-nexus/frontend
```

### 3.2. Настройки

```bash
cp .env.example .env
notepad .env
```

Должно быть:

```env
VITE_API_BASE=http://localhost:8000
VITE_DEV_TG_ID=1
```

Сохрани. Число `1` — то же, что `DEV_TELEGRAM_ID` в backend.

### 3.3. Установить пакеты (один раз)

```bash
npm install
```

Может занять 1–3 минуты.

### 3.4. Запуск

```bash
npm run dev
```

В конце будет строка вида:

```text
  ➜  Local:   http://localhost:5173/
```

### 3.5. Открыть приложение

В браузере: **http://localhost:5173**

Ты должен увидеть интерфейс (Home / баланс).  
Это **не** Telegram — обычный браузер, тестовый пользователь `dev:1`.

Оба окна (backend и frontend) должны оставаться запущенными.

---

## Шаг 4. Что нажать, чтобы проверить

1. **Home** — баланс, уровень.  
2. **Майнер** — кнопка старта цикла.  
3. **Задания / Рулетка** — экраны открываются.  
4. Если `TELEGRAM_OWNER_IDS=1` и `VITE_DEV_TG_ID=1` — на Home есть **Owner · экономика**, **Inbox**, **Касса**.

---

## Как остановить

В каждом окне Git Bash: `Ctrl + C`.

Запуск снова:

**Окно 1:**
```bash
cd ~/projects/ton-nexus/backend
source .venv/Scripts/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Окно 2:**
```bash
cd ~/projects/ton-nexus/frontend
npm run dev
```

(`npm install` и `alembic` повторно не нужны, пока не менял зависимости / схему.)

---

## Если что-то сломалось

| Что видишь | Что сделать |
|------------|-------------|
| `python: command not found` | Переустановить Python с галочкой PATH, новый Git Bash |
| `connection refused` порт 5432 | Запустить службу PostgreSQL в Windows |
| `password authentication failed` | В `.env` пароль `nexus` / пользователь `nexus`; БД создана на шаге 1 |
| `alembic: command not found` | Не активирован venv: `source .venv/Scripts/activate` |
| Страница 5173 пустая / ошибка сети | Backend не запущен или `VITE_API_BASE` неверный |
| 401 на API | В backend `.env` стоит `DEBUG=true` |
| Нет кнопки Owner | Одинаковые числа: `TELEGRAM_OWNER_IDS`, `DEV_TELEGRAM_ID`, `VITE_DEV_TG_ID` |

---

## Бот и Telegram (не сейчас)

Пока **не обязательно**. Сначала проверь всё в браузере.  
Когда будешь готов открывать Mini App внутри Telegram — нужен HTTPS-туннель и токен бота; это отдельный шаг.

---

## Краткий чеклист

- [ ] Git, Python, Node, PostgreSQL установлены  
- [ ] Репозиторий склонирован  
- [ ] Пользователь `nexus` и БД `ton_nexus` созданы  
- [ ] Backend: venv → pip → `.env` → alembic → uvicorn  
- [ ] Frontend: `.env` → npm install → npm run dev  
- [ ] Браузер: http://localhost:5173  
