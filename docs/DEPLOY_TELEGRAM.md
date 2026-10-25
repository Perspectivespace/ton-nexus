# Деплой из Telegram

Агент пушит код в `main` → деплойер жмёт в Mini App
**Деплой → «Обновить тест»**. Команды на сервере не нужны.

## Как устроено

- API **не выполняет** shell. `POST /api/v1/admin/deploy` только кладёт файл-заявку
  в `/var/lib/ton-nexus-deploy/requests/`.
- `ton-nexus-deploy.path` (systemd) видит заявку и запускает root-сервис
  `ton-nexus-deploy.service` → `/usr/local/lib/ton-nexus-deploy/runner.sh`.
- Runner (под lock, по одному деплою за раз):
  1. `git fetch`; ручные правки на сервере → `git stash` (предупреждение в логе);
  2. `checkout -f -B main origin/main`;
  3. `pip install -r requirements.txt` — только если файл изменился;
  4. `alembic upgrade head` — если менялся backend;
  5. `npm ci` — если изменился `package-lock.json`;
  6. сборка в `dist.new`, затем подмена `dist` (старая → `dist.prev`);
  7. рестарт `ton-nexus-api`, проверка `127.0.0.1:8000/health`;
  8. `nginx -t && reload`.
  Ошибка на любом шаге → откат кода, `dist.prev` и рестарт API на прежней версии.
- Статус/лог: `/var/lib/ton-nexus-deploy/jobs/<id>.json`, `logs/<id>.log`.
  В Mini App видно шаги, хвост лога и историю. Итог приходит сообщением от бота.

## Роль «деплойер»

Деплоить и управлять деплойерами может **только деплойер**. Владелец
(`TELEGRAM_OWNER_IDS`) прав деплоя не имеет и вкладку «Деплой» не видит — если
только его аккаунт тоже не деплойер.

Деплойер — это любой из двух источников:

- `TELEGRAM_DEPLOYER_IDS` в `backend/.env` — Telegram ID через запятую. Эти люди
  всегда деплойеры; в приложении у них метка «из настроек сервера», снять их
  оттуда нельзя. Это страховка: если деплойеров не осталось, впишите ID сюда и
  перезапустите API (`systemctl restart ton-nexus-api`).
- флаг `users.is_deployer` — ставит и снимает другой деплойер во вкладке
  «Деплой» → «Деплойеры» (по Telegram ID; человек должен хоть раз открыть Mini App).

Последнего деплойера снять нельзя (деплойеры из настроек считаются). Деплойер видит
только вкладку «Деплой» и полный список деплойеров — без экономики, кассы и модерации.

## Установка (один раз)

После того как эта ветка смержена в `main`, на сервере под root:

```
curl -fsSL https://raw.githubusercontent.com/Perspectivespace/ton-nexus/main/scripts/install-deploy-runner.sh | bash
```

Скрипт ставит runner и systemd-юниты, создаёт spool и сразу делает первый полный
деплой (применит миграцию `003`). Повторный запуск безопасен.

## Настройки (`backend/.env`)

- `TELEGRAM_DEPLOYER_IDS` — деплойеры из настроек сервера (см. выше). Без него и без
  деплойеров в базе деплоить из приложения некому.

- `GITHUB_TOKEN` — read-only токен, если упрётесь в лимит GitHub API (60 запросов/час).
- `DEPLOY_SPOOL_DIR`, `DEPLOY_TEST_APP_DIR`, `DEPLOY_BRANCH`, `GITHUB_REPO` — по умолчанию
  подходят для текущего сервера.

## Прод

Пока не настроен: кнопка «Прод — скоро», API отвечает 400. Добавляется новой
целью в `scripts/deploy-runner.sh` и `TARGETS` в `backend/app/services/deploy.py`.
