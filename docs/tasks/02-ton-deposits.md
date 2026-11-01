# 02 — Пополнение баланса в TON: кошелёк проекта, личный мемо, зачисление по блокчейну

- **Ветка:** `feat/ton-deposits`
- **Заголовок PR:** `Пополнение: зачисление TON на баланс по мемо с кошелька проекта`
- **Миграция:** `backend/alembic/versions/008_ton_deposits.py` (`revision = "008"`, `down_revision = "007"`)
- **Зависит от:** задачи 01 (привязка кошелька, миграция `007_user_wallets.py`, настройка `ton_wallet`) — уже в `main` (PR #75). Последняя миграция в `main` — `007`, значит у этой задачи `008`.
- **Перед началом:** прочитай `docs/HANDOFF.md` (§4, §6, §7, §9).

## Цель

Пользователь пополняет игровой баланс в TON:

1. В «Профиле» нажимает «Пополнить», вводит сумму, жмёт «Пополнить» → через TON Connect открывается его привязанный кошелёк с уже заполненными адресом проекта, суммой и комментарием (личный мемо) → подтверждает.
2. Сервер сам видит входящий перевод на кошелёк проекта (опрос toncenter), находит пользователя по мемо и зачисляет сумму на баланс. Обычно за 10–30 секунд.
3. Для перевода с биржи — ручной способ: адрес проекта и мемо с кнопками «Скопировать» и предупреждением «без комментария деньги не зачислятся автоматически».

Один кошелёк проекта на всех; адрес задаёт владелец в «Управление → Экономика» («Кошелёк проекта»). Для **приёма** приватный ключ не нужен — на сервере его нет и не будет в этой задаче.

## Контекст (что уже есть)

- Деньги — только `backend/app/services/balance.py`: `credit(session, *, user_id, amount, balance_type, description, reference_type, reference_id)`; строка пользователя под `get_user_for_update`; каждая операция пишет `BalanceHistory` с `balance_after`. `users.balance` — `Numeric(18, 8)`.
- Настройки — `services/economy_seed.DEFAULTS`, нормализация в `services/economy_admin.set_setting`, группы в `SETTING_CATALOG`; изменение — только владелец (`api/economy.py`, `_require_owner`). Фронт: `lib/settingsMeta.ts`, `components/owner/SettingsList.tsx`, `components/SettingEditor.tsx`.
- Задача 01 дала: `user_wallets` (`backend/app/models/wallet.py`), `services/ton_wallet.active_wallet` и `link_wallet`, настройку `ton_wallet` (`network`: `mainnet` | `testnet`, нормализация `_normalize_ton_wallet` в `economy_admin.py`), ленивый провайдер TON Connect `frontend/src/lib/tonconnect.tsx`, лист `components/WalletConnectSheet.tsx` + `WalletConnectSheetInner.tsx`, строку «Кошелёк TON» в `pages/Wallet.tsx`.
- Группы `ton` в `SETTING_CATALOG` (`economy_admin.py`) и в `GROUP_RU` (`components/owner/SettingsList.tsx`) пока **нет**: `ton_wallet` сейчас попадает в «прочее». В этой задаче добавь группу `ton` («TON») и положи в неё `ton_wallet` и `ton_deposits`.
- «Касса» (`frontend/src/pages/WithdrawQueue.tsx`, вход из `components/WorkArea.tsx`) — экран команды для заявок на вывод; сюда добавляем вкладку пополнений.
- Планировщика в проекте нет (`backend/app/main.py` — только `lifespan` с `seed_economy`). Бот при деплое не перезапускается; API — перезапускается.
- Сравнение адресов — через raw-форму (`pytoniq-core` `Address`), как в задаче 01.

## Модель данных — миграция 008

1. `users.deposit_memo` — `String(16) NULL`, `UNIQUE`. Постоянный личный код, выдаётся лениво при первом открытии «Пополнить»: префикс `TN` + 8 символов base32 Крокфорда без похожих букв (`0-9A-Z` без `I L O U`), генерация `secrets`, повтор при коллизии. Сравнение без учёта регистра и пробелов по краям.
2. `ton_deposits`:

| Поле | Тип | Примечание |
|---|---|---|
| `id` | Integer PK | |
| `tx_hash` | String(64) **UNIQUE** | hex хэша транзакции — ключ идемпотентности |
| `lt` | BigInteger | logical time |
| `utime` | DateTime(tz) | время блока |
| `source_raw` | String(70) NULL | отправитель `0:<hex>` |
| `amount_nano` | BigInteger | сумма в нанотонах, как пришла |
| `amount_ton` | Numeric(18, 8) | зачтённая сумма: `amount_nano / 10^9`, **округление вниз** до 8 знаков |
| `comment` | String(128) NULL | текст комментария (обрезанный) |
| `user_id` | FK `users.id` NULL, index | найденный по мемо |
| `status` | String(16), index | `credited` \| `unmatched` \| `below_min` \| `ignored` \| `manual` |
| `note` | String(255) NULL | причина / кто зачёл вручную |
| `created_at` | DateTime(tz) | |
| `credited_at` | DateTime(tz) NULL | |

3. `chain_cursors`: `account` String(70) PK (raw адрес проекта), `last_lt` BigInteger, `last_hash` String(64), `updated_at`. Курсор у каждого адреса свой: смена адреса проекта не путает историю.

`downgrade()` удаляет таблицы и колонку.

## Настройка `ton_deposits` (группа `ton`)

```json
{
  "enabled": false,
  "project_address": "",
  "min_ton": "0.1",
  "poll_seconds": 15
}
```

- Подпись в «Экономике»: «Кошелёк проекта» — адрес, куда пользователи переводят TON. Нормализация в `set_setting`: пустая строка или валидный адрес TON (friendly `UQ/EQ…` или raw `0:…`), хранится в non-bounceable виде `UQ…`; `min_ton` > 0 (Decimal строкой); `poll_seconds` 5–120.
- `enabled = true` при пустом адресе — ошибка нормализации («Сначала укажите кошелёк проекта»).
- Адрес — публичный, это не секрет. **Сид-фраза и приватный ключ кошелька проекта никогда не попадают в репозиторий, настройки, логи и чат.**
- Ключ toncenter — **только** переменная окружения сервера `TONCENTER_API_KEY` (`core/config.py: toncenter_api_key: str = ""`, строка-пример с пустым значением в `backend/.env.example`). Без ключа работаем с лимитом 1 запрос/с. В описании PR дай Сергею пошаговую команду `printf … >> …/backend/.env` с местом для ключа и перезапуском API (как в HANDOFF §5); сам ключ не пиши.

## Логика — `backend/app/services/ton_deposits.py`

1. `async def get_or_create_memo(session, user) -> str`.
2. `async def fetch_transactions(account_raw, after_lt, limit=50) -> list[dict]` — toncenter v3 `GET /api/v3/transactions?account=<addr>&start_lt=<after_lt+1>&sort=asc&limit=<n>`, заголовок `X-API-Key` если ключ задан; база `https://toncenter.com` для mainnet, `https://testnet.toncenter.com` для testnet (по `ton_wallet.network`). HTTP — `httpx` (уже в `requirements.txt`), таймаут 10 с, ошибки сети — лог и выход без падения. Точные имена полей ответа сверь с документацией toncenter v3 и зафиксируй в тестовой фикстуре.
3. `def classify(tx) -> Incoming | None` — депозит засчитывается, только если **все** условия:
   - есть входящее внутреннее сообщение (`in_msg` с `source`), `value > 0`;
   - не `bounced`, транзакция не `aborted`, фаза вычислений успешна;
   - тело — текстовый комментарий (op = 0); иначе статус `ignored`/`unmatched` с причиной.
   Никогда не зачисляем по `pendingTransactions`, по BOC/хэшу, который прислал фронт, или по ответу кошелька — только по подтверждённой транзакции из блокчейна.
4. `async def process_tx(session, tx, *, project_raw, min_ton, now)` — в **одной** транзакции БД:
   - `INSERT ton_deposits … ON CONFLICT (tx_hash) DO NOTHING` (на SQLite — проверка + перехват `IntegrityError`); если строка уже была — выходим (идемпотентность);
   - мемо найден, сумма ≥ `min_ton` → `balance.credit(user_id=…, amount=amount_ton, balance_type="ton_deposit", description="Пополнение TON", reference_type="ton_deposit", reference_id=deposit.id)`, статус `credited`, `credited_at`;
   - мемо не найден → `unmatched`; меньше минимума → `below_min` (ничего не зачисляем, видно в «Кассе»).
5. `async def poll_once(session_factory, *, now=None) -> int` — берёт настройки; если выключено или адреса нет — 0. Блокировка от параллельного запуска: `pg_try_advisory_xact_lock(<константа>)` в Postgres (на SQLite — пропуск). Курсор `chain_cursors` читается и обновляется под `SELECT … FOR UPDATE` в той же транзакции, что и записи депозитов. Страницами по 50, пока приходят новые.
6. Фоновый цикл: в `lifespan` (`backend/app/main.py`) запустить `asyncio.create_task(deposit_loop())` — каждые `poll_seconds` вызывает `poll_once`, любые исключения логирует и продолжает; при остановке приложения — отмена задачи. Блокировка из п. 5 гарантирует, что при нескольких процессах API опрашивает один. Отдельные systemd-юниты и Docker **не** добавлять.
7. Ленивая проверка: `POST /deposits/check` (пользователь) — вызывает `poll_once`, но не чаще раза в 10 с на весь сервер (метка времени в памяти процесса + та же блокировка); отвечает последними депозитами пользователя.
8. Ручное зачисление командой (для `unmatched`/`below_min`, например перевод с биржи без мемо): `async def assign_manual(session, *, deposit_id, user_id, actor, note)` — только владелец; тот же `balance.credit` с `reference_id=deposit.id`, статус `manual`, `note` с id исполнителя. Повторно зачесть нельзя (проверка статуса под `FOR UPDATE` строки депозита).

## API — `backend/app/api/deposits.py`

| Метод | Путь | Кто | Что делает |
|---|---|---|---|
| GET | `/deposits/info` | пользователь | `{enabled, project_address, memo, min_ton, network}` (мемо создаётся лениво) |
| GET | `/deposits/mine` | пользователь | последние 20 пополнений пользователя |
| POST | `/deposits/check` | пользователь | ленивая проверка, → как `/mine` |
| GET | `/deposits` | владелец и админы | список с фильтром `status` (по умолчанию `unmatched`, `below_min`) |
| POST | `/deposits/{id}/assign` | **владелец** | `{telegram_id, note}` → ручное зачисление |

`amount_*` в ответах — строки (Decimal), не float.

## TON Connect: перевод с заполненными полями

- `GET /deposits/tx-payload?amount=1.5` (пользователь) → `{to: project_address, amount_nano: "1500000000", payload: <base64 BOC>, valid_until}`. Тело — ячейка комментария: `begin_cell().store_uint(0, 32).store_snake_string(memo).end_cell()` через `pytoniq-core` (фронту не нужен `@ton/core` и полифилл `Buffer`). Сумма: Decimal → нанотоны, ровно 9 знаков, > 0, ≥ `min_ton`.
- Фронт: `tonConnectUI.sendTransaction({ validUntil, messages: [{ address: to, amount: amount_nano, payload }] })`. Если TON Connect не подключён — сначала `openModal()`. Подключённый адрес должен совпадать с привязанным (raw-сравнение); иначе предупреждение «В приложении открыт другой кошелёк» с кнопкой «Сменить».
- Ответ кошелька (BOC) **не** считается оплатой: после него показываем «Ждём подтверждение сети…» и каждые 5 с вызываем `/deposits/check` до 2 минут, затем «Перевод ещё не виден — зачислим автоматически, проверьте позже».
- Без привязанного кошелька (задача 01) кнопка «Пополнить» ведёт в привязку; ручной способ (адрес + мемо) доступен и без привязки.

## UI — «Профиль», стиль «Ночной контур»

- `ListRow` «Пополнить» **над** «Вывод», подпись «TON · от {min_ton} TON», при `enabled = false` — «Скоро» и неактивно.
- `Sheet` «Пополнение»:
  - поле суммы (`Field`, цифровая клавиатура `inputMode="decimal"`, запятая → точка), быстрые суммы `1 / 5 / 10 TON` (чипы 44 px);
  - главная кнопка «Пополнить» (52 px) → поток TON Connect выше;
  - блок «Перевод с биржи или другого кошелька» (свёрнут по умолчанию): адрес проекта моноширинным шрифтом целиком с переносом, мемо крупно, у каждого — «Скопировать» (вибрация `selection`, `Toast` «Скопировано»); предупреждение `Tag tone="warn"`: «Обязательно укажите комментарий {memo}, иначе зачисление вручную через поддержку»;
  - список последних пополнений: сумма (`Num`), время по МСК, статус «зачислено» / «ждёт проверки» / «меньше минимума».
- Зачисление прилетело — обновить `useMe` (баланс) и показать `Toast` «Зачислено +X TON».
- «Касса» (`pages/WithdrawQueue.tsx`): вкладки `Tabs` «Вывод» | «Пополнения»; во второй — `unmatched`/`below_min` с суммой, временем, комментарием, сокращённым хэшем (ссылка на tonviewer), у владельца — «Зачислить вручную» (Telegram ID + причина, `HoldButton`).
- Без бесконечных анимаций (кроме, если нужно, одного индикатора ожидания в шторке — в счёт лимита 19, в `html.low-end` и `prefers-reduced-motion` — статично), без `backdrop-filter`. Чек-лист 360/390 px из HANDOFF §6, скриншоты: шторка пополнения, ручной способ с длинным адресом, ожидание, «Касса → Пополнения».

## Тесты (обязательно)

`backend/tests/test_ton_deposits.py` (SQLite в памяти; сеть **не** трогаем — `fetch_transactions` подменяется фикстурой JSON в формате toncenter v3):

1. Входящий перевод с мемо → `credited`, баланс вырос на сумму, `BalanceHistory` с `balance_type="ton_deposit"`, `reference_id = deposit.id`.
2. Тот же `tx_hash` второй раз (повтор опроса) → баланс не меняется, запись одна.
3. Мемо в другом регистре и с пробелами → находит пользователя.
4. Неизвестный мемо → `unmatched`, баланс не тронут; без комментария → `unmatched`.
5. Меньше `min_ton` → `below_min`.
6. `bounced` / `aborted` / неуспешная фаза вычислений / исходящее сообщение / `value = 0` → не зачисляется.
7. Нанотоны: `1 000 000 001` → `1.00000000` (вниз), `123456789` → `0.12345678`; Decimal везде, без float.
8. Курсор: после опроса `last_lt` = последней обработанной; следующий запрос идёт с него; другой адрес проекта — свой курсор.
9. Ручное зачисление: `unmatched` → `manual`, баланс вырос; повтор → ошибка; не владелец → 403.
10. `tx-payload`: сумма в нанотонах верная, BOC разбирается обратно в op = 0 + мемо; сумма меньше минимума или ≤ 0 → 400.
11. Нормализация `ton_deposits`: неверный адрес → ошибка; `enabled` без адреса → ошибка; адрес приводится к `UQ…`.
12. Выключено (`enabled = false`) → `poll_once` ничего не запрашивает.

Фронт (vitest): разбор суммы с запятой, преобразование TON → нанотоны строкой без float (`"1.5"` → `"1500000000"`), отображение статусов.

## Хвосты из задачи 01 (сделать в этом же PR)

Это недоделки после ревью PR #75. Они входят в эту задачу и проверяются на ревью так же, как основная часть.

1. **Хэши кода кошельков** — `backend/tests/test_ton_wallet.py` (unittest, SQLite в памяти, без сети): положи в тесты официальные BOC кода кошельков v3r1, v3r2, v4r2, v5r1 (как в `pytoniq`/`tonsdk`, укажи источник в комментарии) и **вычисляй** хэш кода из них (`Cell.one_from_boc(...).hash`), сравнивая с `KNOWN_CODE_HASHES`. Сравнивать таблицу с теми же строками, захардкоженными в тесте, — не проверка.
2. **Привязки через `link_wallet` на SQLite** (тот же файл): положительные привязки для настоящих v4r2 и v5r1: ключ Ed25519, `StateInit` из официального кода и данных кошелька, адрес = хэш `StateInit`, подпись `ton_proof` по алгоритму из задачи 01; кошелёк привязан, `public_key` совпадает. Отказы через `link_wallet`: подпись чужим ключом для чужого адреса; `StateInit`, не совпадающий с адресом; повторное использование того же nonce; адрес уже привязан к другому пользователю; после отвязки кошелёк неактивен и его можно привязать заново.
3. **Сборка фронта:** в `frontend/vite.config.ts` в `manualChunks` добавь правило `vendor-tonconnect` для `@tonconnect/*` (сейчас библиотека уходит в безымянный чанк `index-*.js`). Загрузка должна остаться ленивой: при открытии «Профиля» чанк не грузится.
4. **Настройки владельца:** поле `network` у `ton_wallet` — выбор из двух вариантов `mainnet` / `testnet`, а не текстовое поле. Если в `SettingEditor.tsx` нет вида поля «выбор» — добавь его (`kind: "select"` со списком вариантов) и тест в `settingsMeta`.
5. **Строка «Кошелёк TON»:** у привязанного кошелька подзаголовок в одну строку и на 360, и на 390 px (обрезка с многоточием или короче сокращённый адрес). Скриншоты 360 и 390.
6. **Ожидание при привязке:** «Ожидание…» на кнопке держится, пока идёт запрос `POST /wallet/link`, а не сбрасывается при закрытии модалки TON Connect. После ответа — успех или ошибка с «Повторить».
7. **Запасной способ для неизвестного кода кошелька:** если хэш кода не из `KNOWN_CODE_HASHES`, получить ключ через `get_public_key` у toncenter (тот же `TONCENTER_API_KEY` и база по `ton_wallet.network`, что в этой задаче). Ключ из ответа должен совпасть с ключом, которым проверяется подпись; при ошибке сети — понятный отказ «Не удалось проверить кошелёк, попробуйте позже», без падения. Привязка всё равно требует `StateInit`, хэш которого равен адресу. Тест с подменённым ответом toncenter: совпал ключ → привязка; другой ключ → отказ; ошибка сети → отказ.

## Критерии приёмки

- [ ] Миграция `008` применяется на базе с данными и откатывается.
- [ ] Зачисление только через `balance.credit` в одной транзакции с записью `ton_deposits`; идемпотентность по `tx_hash` подтверждена тестом.
- [ ] Ничего не зачисляется по данным с фронта — только по транзакции из toncenter.
- [ ] На тестовом стенде (testnet или маленькая сумма в mainnet) перевод через TON Connect зачисляется за 10–30 с — скриншоты от Сергея после деплоя.
- [ ] Ручной способ с копированием адреса и мемо работает без привязки.
- [ ] Ключ toncenter — только в окружении сервера; в PR — пошаговая инструкция для Сергея. Сид-фраз и приватных ключей нигде нет.
- [ ] UI по чек-листу 360/390 px.
- [ ] Все 7 пунктов «Хвосты из задачи 01» сделаны и перечислены в описании PR.

## Не входит (не делать)

- Оплата заданий, усилений и апгрейдов майнера из баланса — задача 03.
- Вывод на привязанный кошелёк — задача 04.
- Отправка TON с кошелька проекта, горячий кошелёк, приватные ключи — позже, отдельной задачей.
- Звёзды Telegram, курсы обмена, другие токены (USDT/джеттоны).

## Файлы

Новые:

- `backend/alembic/versions/008_ton_deposits.py`
- `backend/app/models/deposit.py` (`TonDeposit`, `ChainCursor`)
- `backend/app/services/ton_deposits.py`
- `backend/app/api/deposits.py`
- `backend/tests/test_ton_deposits.py` (+ фикстура `backend/tests/fixtures/toncenter_transactions.json`)
- `frontend/src/components/TopUpSheet.tsx`

Изменить:

- `backend/app/main.py` (фоновый цикл в `lifespan`), `backend/app/core/config.py`, `backend/.env.example`
- `backend/app/models/__init__.py`, `backend/app/models/user.py` (`deposit_memo`), `backend/app/api/__init__.py`
- `backend/app/services/economy_seed.py`, `backend/app/services/economy_admin.py`
- `frontend/src/pages/Wallet.tsx`, `frontend/src/pages/WithdrawQueue.tsx`, `frontend/src/api/hooks.ts`
- `frontend/src/lib/settingsMeta.ts` (+ тест)
- Хвосты из 01: `backend/app/services/ton_wallet.py`, `backend/tests/test_ton_wallet.py`, `frontend/vite.config.ts`, `frontend/src/components/SettingEditor.tsx`, `frontend/src/components/owner/SettingsList.tsx`, `frontend/src/components/WalletConnectSheetInner.tsx`
- `docs/SCHEMA.md`
