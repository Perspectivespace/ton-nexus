# Thin Telegram bot

Только вход в Mini App. Бизнес-логика — в `backend/` (FastAPI).

## Запуск

```bash
cd bot
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export TELEGRAM_BOT_TOKEN=...
export WEBAPP_URL=https://your-mini-app.example
export TELEGRAM_OWNER_IDS=123456789

python main.py
```

В BotFather: **Menu Button** → Web App → тот же `WEBAPP_URL`.

## Env

| Переменная | Описание |
|------------|----------|
| `TELEGRAM_BOT_TOKEN` | токен бота |
| `WEBAPP_URL` | HTTPS URL фронта Mini App |
| `TELEGRAM_OWNER_IDS` | telegram id владельца |
