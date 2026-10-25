# Деплой из Telegram

Агент пушит код в `main` → владелец (или деплойер) жмёт в Mini App
**Кабинет → Деплой → «Обновить тест»**. Команды на сервере не нужны.

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

`users.is_deployer` — отдельный флаг. Владелец всегда может деплоить, но
деплойеров назначает и снимает **только активный деплойер** (вкладка «Деплой» →
«Деплойеры», по Telegram ID). Владельцу без флага этот блок не показывается,
API отвечает 403.

- Если деплойеров нет совсем, первого может назначить владелец (один раз, чтобы
  не остаться без деплойеров навсегда).
- Последнего деплойера снять нельзя — ни себя, ни другого. Сначала добавьте второго.
Деплойер видит только вкладку «Деплой» — без экономики, кассы и модерации.

## Установка (один раз)

После того как эта ветка смержена в `main`, на сервере под root:

```
curl -fsSL https://raw.githubusercontent.com/Perspectivespace/ton-nexus/main/scripts/install-deploy-runner.sh | bash
```

Скрипт ставит runner и systemd-юниты, создаёт spool и сразу делает первый полный
деплой (применит миграцию `003`). Повторный запуск безопасен.

## Настройки (`backend/.env`, всё необязательно)

- `GITHUB_TOKEN` — read-only токен, если упрётесь в лимит GitHub API (60 запросов/час).
- `DEPLOY_SPOOL_DIR`, `DEPLOY_TEST_APP_DIR`, `DEPLOY_BRANCH`, `GITHUB_REPO` — по умолчанию
  подходят для текущего сервера.

## Прод

Пока не настроен: кнопка «Прод — скоро», API отвечает 400. Добавляется новой
целью в `scripts/deploy-runner.sh` и `TARGETS` в `backend/app/services/deploy.py`.
