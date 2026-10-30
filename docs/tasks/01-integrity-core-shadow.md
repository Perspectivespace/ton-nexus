# 01 — Ядро «Честности» в теневом режиме (B1)

- **Ветка:** `feat/integrity-core`
- **Заголовок PR:** `Честность: ядро в теневом режиме (журнал событий, счёт, причины отказа)`
- **Миграция:** `backend/alembic/versions/007_integrity_core.py` (`revision = "007"`, `down_revision = "006"`)
- **Перед началом:** прочитай `docs/HANDOFF.md` (особенно §4 «Инварианты» и §9 «Никогда»).

## Цель

Завести у каждого пользователя показатель «Честность» (0–1000, старт 500) и журнал событий, из которого он считается. В этом PR **только копим данные и считаем счёт** («теневой режим»): никаких ограничений, допусков, штрафов к деньгам, ничего не показываем обычным пользователям. Через несколько недель по накопленным данным владелец настроит веса, и следующая задача (B2) включит эффекты.

Деньги этот PR **не трогает**: `services/balance.py` не меняется, выплаты и бюджеты работают как раньше.

## Контекст (что уже есть)

- Проверка заявок: `backend/app/services/tasks.py: review_submission(session, actor, submission_id, approve, note)`. При `approve=True` — выплата через `balance_svc.credit`, `add_xp`, `task.filled_slots += 1`, при заполнении всех мест `task.status = "completed"`. При `approve=False` — `sub.status = "rejected"`.
- Модерация заданий амбассадоров: `approve_task` (`pending_approval` → `draft`), `reject_task(session, task_id, actor, note=None)` (`pending_approval` → `rejected`; `note` сейчас никуда не пишется). Права — `can_approve_ambassador_task` (админ или владелец).
- HTTP: `backend/app/api/tasks.py` — `POST /api/v1/tasks/submissions/{id}/review` (тело `ReviewBody{approve, note}`), `POST /api/v1/tasks/{id}/reject` (без тела), `POST /api/v1/tasks/{id}/approve`.
- Фронт: `frontend/src/pages/Inbox.tsx` (проверка заявок и модерация заданий), хуки `useReviewSubmission`, `useRejectTask` в `frontend/src/api/hooks.ts`.
- Настройки: `services/economy_seed.py: DEFAULTS`, `services/economy_admin.py: set_setting` + `SETTING_CATALOG`, фронт — `frontend/src/lib/settingsMeta.ts`, группы — `frontend/src/components/owner/SettingsList.tsx` (`GROUP_RU`, `GROUP_ORDER`).
- Время: `services/gameday.py` (`MSK`, `now_utc`, `game_day`, `day_start`). Наивное время из SQLite считай UTC.
- Владелец: `services/roles.is_platform_owner(user)`; образец проверки — `_require_owner` в `api/economy.py`.
- Жалоб на задания и удаления заданий в коде **нет** — источником событий для автора служат модерация (`approve_task` / `reject_task`) и выполнение задания.

## Модель данных — миграция 007

Новая модель `backend/app/models/integrity.py` → `IntegrityEvent`, экспорт из `models/__init__.py`.

Таблица `integrity_events` (только добавление; строки не удаляются и не меняются, кроме полей статуса/аннулирования):

| Поле | Тип | Примечание |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | FK `users.id` ON DELETE CASCADE, index | чей счёт меняется |
| `event_type` | String(40) | код из таблицы событий ниже |
| `delta` | Integer | уже с учётом лимитов (может быть 0) |
| `half_life_days` | Integer NULL | NULL = не затухает |
| `reason` | Text NULL | текст (для ручных — обязателен) |
| `source_type` | String(24) NULL | `submission` · `task` · `manual` |
| `source_id` | Integer NULL | id заявки/задания |
| `actor_id` | FK `users.id` NULL | кто вызвал (проверяющий, владелец) |
| `status` | String(16), default `applied` | `applied` · `pending_review` · `voided` |
| `voided_by_id` | FK `users.id` NULL | |
| `voided_at` | DateTime(tz) NULL | |
| `void_reason` | Text NULL | |
| `created_at` | DateTime(tz), server_default now() | |

Ограничения и индексы:

- `UniqueConstraint("user_id", "event_type", "source_type", "source_id", name="uq_integrity_event_source")` — идемпотентность (для `manual` `source_id` = NULL, дубли разрешены).
- `Index("ix_integrity_events_user_created", "user_id", "created_at")`, индекс по `status`.

Изменения существующих таблиц:

- `users.integrity` Integer NOT NULL, server_default `500`;
- `users.integrity_tier` String(16) NOT NULL, server_default `normal`;
- `users.integrity_updated_at` DateTime(tz) NULL;
- `task_submissions.reject_reason` String(32) NULL;
- `tasks.reject_reason` String(32) NULL;
- `tasks.min_integrity` Integer NOT NULL, server_default `0` — **пока не используется** (задел для B2).

Добавь поля и в модели (`models/user.py`, `models/task.py`). `downgrade()` удаляет всё добавленное. Миграция должна проходить на базе с существующими данными (поэтому только server_default, без backfill).

## События и веса (значения по умолчанию)

| `event_type` | Кому | Δ | Полураспад, дней | Лимит | Где возникает в этом PR |
|---|---|---|---|---|---|
| `submission_accepted` | исполнитель | +3 | 180 | не больше +15 за сутки МСК | `review_submission`, approve |
| `submission_streak_10` | исполнитель | +10 | 180 | — | каждая 10-я принятая подряд (без отказов между) |
| `submission_rejected_low_quality` | исполнитель | −10 | 90 | — | reject, причина `low_quality` |
| `submission_rejected_wrong_task` | исполнитель | −5 | 90 | — | reject, причина `wrong_task` |
| `submission_rejected_duplicate` | исполнитель | −15 | 90 | — | reject, причина `duplicate` |
| `submission_rejected_forged` | исполнитель | −60 | 180 | всегда `pending_review` | reject, причина `forged` |
| `author_task_approved` | автор задания | +5 | 180 | — | `approve_task` |
| `author_task_rejected_bad` | автор задания | −15 | 90 | — | `reject_task`, причина `bad_task` |
| `author_task_completed` | автор задания | +10 | 180 | — | задание перешло в `completed` |
| `author_review_slow` | автор задания | −2 | 60 | не больше −10 за 7 дней | заявка проверена позже 72 ч после подачи |
| `manual_adjust` | любой | ±N | из запроса (NULL = навсегда) | — | владелец, причина обязательна |
| `fraud` | любой | −300 | NULL (не затухает никогда) | — | владелец, причина обязательна |
| `appeal_upheld` | автор | −20 | 120 | — | **не подключается** (B3) |
| `month_clean` | любой | +10 | 180 | — | **не подключается** (нужен планировщик/закрытие месяца) |
| `stars_chargeback` | любой | −100 | 365 | — | **не подключается** (A3) |

Неподключаемые типы всё равно лежат в настройках, чтобы владелец видел полную картину.

Коды причин отказа:

- заявка: `low_quality`, `wrong_task`, `duplicate`, `forged`, `other` (`other` — события нет, но `note` обязателен);
- задание: `bad_task`, `other` (`other` — события нет, `note` обязателен).

## Логика — `backend/app/services/integrity.py`

1. `async def record_event(session, *, user_id, event_type, source_type=None, source_id=None, actor_id=None, reason=None, delta=None, half_life_days=..., now=None) -> IntegrityEvent | None`
   - Читает `integrity_rules`. Если `enabled = false` — ничего не пишет, возвращает `None`.
   - `delta` и `half_life_days` по умолчанию — из `weights[event_type]`; для `manual_adjust` передаются явно.
   - **Идемпотентность:** если событие с тем же `(user_id, event_type, source_type, source_id)` уже есть (при `source_id` не NULL) — вернуть существующее, второй раз не писать. Уникальный ключ в БД — страховка.
   - **Лимиты** (`caps`): для `submission_accepted` — сумма `delta` этого типа у пользователя с начала текущих суток МСК (`gameday.day_start_of(now)`); новое `delta = min(weight, cap - уже)`, но не меньше 0. Для `author_review_slow` — то же за последние 7×24 ч (отрицательный лимит). Событие пишется даже с `delta = 0` (для статистики).
   - **Крупные падения** (`review_thresholds`): если `delta <= event` (−50) или сумма отрицательных `applied`-событий за сутки МСК + `delta` `<= day` (−80) — статус `pending_review` (в счёт не входит, ждёт владельца). `submission_rejected_forged` — всегда `pending_review`. Ручные события владельца (`manual_adjust`, `fraud`) — сразу `applied`.
   - После записи — `recompute(session, user_id, now)`.
   - Не вызывает `commit` (коммитит вызывающий эндпоинт), не бросает исключений в денежный путь: ошибки валидации — только для ручных вызовов владельца.
2. `async def recompute(session, user_id, now=None) -> int`
   - `score = start + floor(Σ delta_i × 0.5 ** (age_days_i / half_life_i))` по событиям со статусом `applied`; при `half_life = NULL` множитель 1. `age_days = (now − created_at).total_seconds() / 86400`.
   - Ограничить 0…1000, записать `users.integrity`, `users.integrity_tier`, `users.integrity_updated_at = now`.
   - Это не деньги — `float` здесь допустим; итог — целое.
3. `def tier_for(score, tiers) -> str` — первый тир, у которого `score >= min` (тиры отсортированы по убыванию `min`).
4. `async def confirm_event(session, *, event_id, actor)` — `pending_review` → `applied`, пересчёт. `async def void_event(session, *, event_id, actor, reason)` — `applied`/`pending_review` → `voided` (заполнить `voided_*`), пересчёт. Повторный вызов на уже обработанном — ошибка 400, не двойное действие.
5. Затухание считается **лениво** (планировщика нет): пересчёт при каждом новом событии и при чтении владельцем (`GET /integrity/users/{id}` и `POST .../recompute`).

Тиры (ключ → русское название на фронте):

| Ключ | Порог | Название |
|---|---|---|
| `exemplary` | 800 | Образцовый |
| `reliable` | 600 | Надёжный |
| `normal` | 400 | Обычный |
| `caution` | 200 | Осторожно |
| `questionable` | 0 | Под вопросом |

### Подключение в `services/tasks.py`

- `review_submission(..., reject_reason: str | None = None)`:
  - при `approve=False` `reject_reason` обязателен и из списка, иначе `TaskError` (→ 400); `other` требует непустой `note`. Записать `sub.reject_reason`.
  - после успешной выплаты: `submission_accepted` (source `submission`, id заявки); затем проверка серии: число принятых заявок пользователя после его последнего отказа (по `reviewed_at`), включая текущую, кратно 10 → `submission_streak_10` (source `submission`, id текущей).
  - при отказе с кодом ≠ `other` → `submission_rejected_<код>` (source `submission`).
  - если `now − sub.created_at > 72 ч` → `author_review_slow` автору задания (`task.creator_id`, source `submission`).
  - если задание стало `completed` → `author_task_completed` (source `task`, id задания).
  - Порядок: события пишутся **после** денежной части, в той же транзакции. Существующая логика выплаты, бюджета и блокировок не меняется.
- `approve_task` → `author_task_approved` автору (source `task`).
- `reject_task(..., reject_reason: str | None = None)` — код обязателен (`bad_task` / `other`; `other` — с `note`), записать `task.reject_reason`; `bad_task` → `author_task_rejected_bad`.
- `api/tasks.py`: `ReviewBody` + `reject_reason: str | None`; у `POST /tasks/{id}/reject` появляется тело `RejectBody{reject_reason: str, note: str | None}`. Отдавать `reject_reason` в `SubmissionOut`.

## Настройка `integrity_rules`

Добавить в `DEFAULTS` (`services/economy_seed.py`), описание: «Честность: веса событий, затухание, лимиты, тиры. Теневой режим — только копим данные, эффектов нет».

```json
{
  "enabled": true,
  "shadow_mode": true,
  "start": 500,
  "tiers": [
    {"key": "exemplary", "min": 800},
    {"key": "reliable", "min": 600},
    {"key": "normal", "min": 400},
    {"key": "caution", "min": 200},
    {"key": "questionable", "min": 0}
  ],
  "weights": {
    "submission_accepted": {"delta": 3, "half_life_days": 180},
    "submission_streak_10": {"delta": 10, "half_life_days": 180},
    "submission_rejected_low_quality": {"delta": -10, "half_life_days": 90},
    "submission_rejected_wrong_task": {"delta": -5, "half_life_days": 90},
    "submission_rejected_duplicate": {"delta": -15, "half_life_days": 90},
    "submission_rejected_forged": {"delta": -60, "half_life_days": 180},
    "author_task_approved": {"delta": 5, "half_life_days": 180},
    "author_task_rejected_bad": {"delta": -15, "half_life_days": 90},
    "author_task_completed": {"delta": 10, "half_life_days": 180},
    "author_review_slow": {"delta": -2, "half_life_days": 60},
    "appeal_upheld": {"delta": -20, "half_life_days": 120},
    "month_clean": {"delta": 10, "half_life_days": 180},
    "stars_chargeback": {"delta": -100, "half_life_days": 365},
    "fraud": {"delta": -300, "half_life_days": 0}
  },
  "caps": {"accepted_per_day": 15, "review_slow_per_week": -10, "review_slow_hours": 72},
  "review_thresholds": {"event": -50, "day": -80},
  "gates": {"enabled": false}
}
```

- `half_life_days: 0` в настройках означает «не затухает» (в событие пишется NULL). Для `fraud` менять нельзя — нормализация принудительно ставит 0.
- Нормализация в `set_setting` (по образцу `ratings.normalize_*`): целые числа; `start` 0–1000; тиры убывают, последний `min = 0`; полураспад ≥ 0; знаки весов не меняются (положительные остаются > 0, штрафы < 0); **`shadow_mode` в этом PR всегда `true`, `gates.enabled` всегда `false`** (попытка выключить — ошибка «Эффекты появятся в следующем обновлении»).
- `SETTING_CATALOG`: `{"key": "integrity_rules", "group": "integrity", "label": "Честность"}`; фронт — группа `integrity` («Честность») в `GROUP_RU`/`GROUP_ORDER` и метаданные в `settingsMeta.ts` (русские подписи типов событий, «Δ», «полураспад, дн»; `shadow_mode` и `gates.enabled` — только чтение).

## API (новый роутер `backend/app/api/integrity.py`, подключить в `api/__init__.py`)

Все эндпоинты — **только владелец** (403 `owner only`), префикс `/api/v1/integrity`:

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/summary` | `enabled`, `shadow_mode`, число пользователей по тирам, число событий `pending_review`, событий за 7 дней по типам |
| GET | `/users/{user_id}` | пересчитать и вернуть счёт, тир, последние 50 событий |
| POST | `/users/{user_id}/recompute` | пересчитать, вернуть счёт и тир |
| POST | `/users/{user_id}/adjust` | тело `{delta: int (≠ 0, по модулю ≤ 1000), reason: str (≥ 3 символов), half_life_days: int \| null, fraud: bool = false}`; `fraud=true` → тип `fraud`, Δ из настроек |
| GET | `/review` | события `pending_review` (до 100, старые первыми) |
| POST | `/events/{event_id}/confirm` | `pending_review` → `applied` |
| POST | `/events/{event_id}/void` | тело `{reason: str}`; → `voided` |

Публичных эндпоинтов нет. `GET /api/v1/me` **не** отдаёт счёт.

## UI

- Пользователям — **ничего**.
- Проверяющим (`Inbox.tsx`): при «Отклонить» заявку — шторка (`Sheet`) с выбором причины (Низкое качество · Не то задание · Повтор · Поддельное доказательство · Другое) и полем комментария (обязательно для «Другое»); то же для отклонения задания амбассадора (Плохо составлено · Другое). Компоненты — из `components/ui/`, без новых анимаций. Скриншоты 360/390 px.
- Владельцу — настройка «Честность» во вкладке «Экономика» (через существующий `SettingsList`).
- Необязательно (если остаётся просто): панель в «Обзоре» кабинета владельца — распределение по тирам и число событий на проверке. Если делаешь — без бесконечных анимаций, со состояниями загрузки/пусто/ошибки.

## Тесты (обязательно) — `backend/tests/test_integrity.py`

По образцу `tests/test_ratings.py` (SQLite в памяти):

1. Миграционная схема: модели создаются (`create_all`), у нового пользователя `integrity = 500`, тир `normal`.
2. `record_event` идемпотентен: повтор с тем же источником не создаёт второе событие и не меняет счёт.
3. Лимит +15 за сутки МСК: 6 принятых за одни сутки → сумма +15, шестое событие с Δ 0; на следующие сутки МСК (граница 00:00 МСК, проверка на 20:59/21:01 UTC) лимит снова доступен.
4. Затухание: событие −10 с полураспадом 90 через 90 дней даёт вклад −5 (floor суммы); `fraud` через 1000 дней — по-прежнему −300.
5. Тиры: границы 199/200, 399/400, 599/600, 799/800; ограничение 0…1000.
6. `forged` и падение ≤ −50 → `pending_review`, счёт не меняется; `confirm_event` применяет; повторное подтверждение — ошибка; `void_event` убирает вклад.
7. Дневной порог −80: серия штрафов в одни сутки — событие, переходящее порог, уходит в `pending_review`.
8. `review_submission`: отказ без `reject_reason` → ошибка; с `other` без `note` → ошибка; с `low_quality` → событие −10 исполнителю и `sub.reject_reason` записан; принятие → событие +3 **и выплата/баланс ровно как раньше** (сверить `balance_history`).
9. Серия: 10 принятых подряд → одно `submission_streak_10`; отказ сбрасывает счёт серии.
10. `author_review_slow`: проверка через 73 ч → −2 автору; лимит −10 за 7 дней.
11. `author_task_completed` при заполнении последнего места; `approve_task`/`reject_task(bad_task)` → события автору.
12. `enabled = false` → события не пишутся, денежные пути работают.
13. Нормализация настроек: нельзя выключить `shadow_mode`/включить `gates`, нельзя поменять знак веса, у `fraud` полураспад всегда 0.
14. API: не-владелец получает 403 на все `/integrity/*`; владелец — `adjust` без причины → 422/400; `adjust` создаёт `manual_adjust`.

Все старые тесты (`test_task_budget.py`, `test_double_payouts.py` и др.) должны остаться зелёными; при необходимости обнови их вызовы отказа (добавь `reject_reason`). Фронт: тест на метаданные `integrity_rules` в `settingsMeta.test.ts` и на шторку причин отказа, если меняется `Inbox.tsx`.

## Критерии приёмки

- [ ] Миграция `007` применяется на базе с данными и откатывается (`downgrade`).
- [ ] Ни одной правки в `services/balance.py`; выплаты, бюджеты и вывод ведут себя как раньше (старые тесты зелёные).
- [ ] Каждый отказ (заявки и задания) сохраняет код причины; без кода API отвечает 400.
- [ ] События пишутся из всех источников, перечисленных в таблице как подключаемые; повтор не дублирует.
- [ ] Счёт и тир считаются по формуле с затуханием, лимитами и порогами проверки.
- [ ] `integrity_rules` видна и редактируется во вкладке «Экономика»; теневой режим выключить нельзя.
- [ ] Обычный пользователь нигде не видит счёт; эндпоинты `/integrity/*` — только владелец.
- [ ] Никаких ограничений/допусков по счёту (поле `tasks.min_integrity` есть, но не проверяется).
- [ ] Все тесты бэкенда и фронта зелёные; скриншоты шторки отказа на 360/390 px.

## Не входит (не делать)

- Эффекты по счёту: допуск к заданиям (`min_integrity`), лимиты, видимость — B2.
- Апелляции и `appeal_upheld` — B3.
- Лайки/оценки заданий — B4.
- Вкладка «Честность» для пользователей и показ счёта где-либо — B5.
- Жалобы на задания, удаление заданий, `month_clean` (нет планировщика), `stars_chargeback` (нет Stars).
- Любые изменения выплат, комиссии, вывода и `balance_type`.

## Файлы

Новые:

- `backend/alembic/versions/007_integrity_core.py`
- `backend/app/models/integrity.py`
- `backend/app/services/integrity.py`
- `backend/app/api/integrity.py`
- `backend/tests/test_integrity.py`

Изменить:

- `backend/app/models/__init__.py`, `backend/app/models/user.py`, `backend/app/models/task.py`
- `backend/app/services/tasks.py`, `backend/app/api/tasks.py`, `backend/app/api/__init__.py`
- `backend/app/services/economy_seed.py`, `backend/app/services/economy_admin.py`
- `frontend/src/pages/Inbox.tsx`, `frontend/src/api/hooks.ts` (хуки и тип `InboxSubmission`)
- `frontend/src/lib/settingsMeta.ts` (+ `settingsMeta.test.ts`), `frontend/src/components/owner/SettingsList.tsx`
- `docs/SCHEMA.md` — описать новую таблицу и поля
