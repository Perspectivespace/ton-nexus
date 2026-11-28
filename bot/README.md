# Thin Telegram bot

Вход в Mini App (`/start`, `/app`, `/help`, `/ping`) и обработчики тикетов
в закрытом чате поддержки. Бизнес-логика (ответ игроку, статусы) — в `backend/` (FastAPI).

## Запуск

```bash
cd bot
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export TELEGRAM_BOT_TOKEN=...
export WEBAPP_URL=https://your-mini-app.example
export TELEGRAM_OWNER_IDS=123456789
# для тикетов (необязательно; без них бот просто не обрабатывает кнопки чата)
export SUPPORT_CHAT_ID=-1001234567890
export API_BASE_URL=http://127.0.0.1:8000

python main.py
```

В BotFather: **Menu Button** → Web App → тот же `WEBAPP_URL`.

## Env

| Переменная | Описание |
|------------|----------|
| `TELEGRAM_BOT_TOKEN` | токен бота; тем же значением бот подписывает внутренние запросы (`X-Bot-Token`) |
| `WEBAPP_URL` | HTTPS URL фронта Mini App |
| `TELEGRAM_OWNER_IDS` | telegram id владельца (для `/ping`) |
| `SUPPORT_CHAT_ID` | id закрытого чата поддержки; пусто — обработчики тикетов ничего не делают, бот не падает |
| `API_BASE_URL` | базовый URL бэкенда **без** `/api/v1` (как `VITE_API_BASE`); нужен, чтобы кнопки «Ответить» / «Закрыть» и реплаи доходили до API |

Если задан `SUPPORT_CHAT_ID`, но нет `API_BASE_URL`, бот стартует, а на кнопки тикетов отвечает, что тикеты не настроены.

## Тикеты в закрытом чате

Кнопки на карточке тикета ставит бэкенд (`ticket:reply:<id>`, `ticket:close:<id>`). Бот принимает их только из `SUPPORT_CHAT_ID`:

- **Ответить** — подсказка с `ForceReply` (реплай на карточку или на подсказку).
- Реплай текстом — `POST /api/v1/support/internal/tickets/<id>/reply`, затем подтверждение в чате. Ответ игроку на его языке отправляет бэкенд.
- **Закрыть** — `POST .../close`, кнопки с карточки снимаются, в чат пишется «Тикет #<id> закрыт без ответа». Реплай на карточку после этого всё ещё можно отправить (бэкенд снова откроет тикет как `answered`).
