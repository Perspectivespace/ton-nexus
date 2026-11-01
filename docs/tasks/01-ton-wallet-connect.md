# 01 — Привязка кошелька TON через TON Connect (ton_proof)

- **Ветка:** `feat/ton-wallet-connect`
- **Заголовок PR:** `Кошелёк: привязка TON-кошелька через TON Connect с проверкой ton_proof`
- **Миграция:** `backend/alembic/versions/007_user_wallets.py` (`revision = "007"`, `down_revision = "006"`)
- **Перед началом:** прочитай `docs/HANDOFF.md` (§4 «Инварианты», §6 «Дизайн», §7 «Платежи», §9 «Никогда»).

## Цель

Пользователь в «Профиле» (`/wallet`) нажимает «Привязать кошелёк», выбирает свой кошелёк (Tonkeeper, Telegram Wallet, MyTonWallet и т. д.) через TON Connect и подтверждает владение подписью `ton_proof`. Сервер проверяет подпись и сохраняет адрес. Это основа для следующих задач: пополнение (02) открывает этот же кошелёк для перевода, вывод (04) идёт только на привязанный адрес.

В этом PR **деньги не двигаются**: `services/balance.py` и вывод (`services/withdraw.py`) не меняются.

## Контекст (что уже есть)

- Кода TON Connect во фронте **нет** (проверено по `main`: ни `@tonconnect/*` в `frontend/package.json`, ни упоминаний в `frontend/src`). Всё ставим с нуля.
- Экран «Профиль» — `frontend/src/pages/Wallet.tsx` (маршрут `/wallet`, псевдоним `/profile`): панель баланса, `ProfileRanks`, список `ListRow` («Вывод», «История», «Настройки»), шторки `Sheet`. Вывод сейчас — ручной ввод адреса (`services/withdraw.py`, `_TON_RE = ^(UQ|EQ)[A-Za-z0-9_-]{46}$`).
- Компоненты — `frontend/src/components/ui/` (`Panel`, `Button`, `HoldButton`, `Sheet`, `List`/`ListRow`, `Tag`, `Toast`, `States`); иконки — `frontend/src/components/icons.tsx`.
- API-клиент — `frontend/src/api/client.ts` (`VITE_API_BASE` пустой → тот же домен), хуки — `frontend/src/api/hooks.ts`.
- Конфиг сервера — `backend/app/core/config.py` (`webapp_url` — адрес Mini App; из него берём домен для `ton_proof`). Пример окружения — `backend/.env.example`.
- Иконка 180×180 для манифеста уже есть: `frontend/public/apple-touch-icon.png`.
- Текущий пользователь — `api/deps.py: get_current_user`; время — `services/gameday.now_utc`.

## Зависимости (добавить)

- Фронт: `@tonconnect/ui-react` (последняя 2.x) — `npm install`, закоммитить `package-lock.json`. Вынести в отдельный чанк `vendor-tonconnect` в `manualChunks` (`frontend/vite.config.ts`) и грузить **лениво** (только на экране «Профиль» при открытии шторки кошелька), чтобы не раздувать стартовую загрузку.
- Бэкенд (`backend/requirements.txt`): `pytoniq-core` (разбор адресов, `Cell`, `StateInit`) и `PyNaCl` (Ed25519). Версии — закрепить нижнюю границу. Других TON-библиотек не тянуть; если очень хочется готовый верификатор — только с PyPI, поддерживаемый, и объяснить выбор в PR.

## Модель данных — миграция 007

Новая модель `backend/app/models/wallet.py`, экспорт из `models/__init__.py`.

`user_wallets`:

| Поле | Тип | Примечание |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | FK `users.id` ON DELETE CASCADE, index | |
| `address_raw` | String(70) | `0:<64 hex>` нижним регистром — для сравнения |
| `address` | String(48) | user-friendly, **non-bounceable** (`UQ…`) — для показа и вывода |
| `network` | String(8) | `-239` (mainnet) или `-3` (testnet) |
| `public_key` | String(64) | hex |
| `wallet_app` | String(64) NULL | имя приложения кошелька из TON Connect |
| `linked_at` | DateTime(tz), server_default now() | |
| `unlinked_at` | DateTime(tz) NULL | NULL = активная привязка |

Индексы: частичные уникальные `ux_user_wallets_active_user (user_id) WHERE unlinked_at IS NULL` и `ux_user_wallets_active_addr (address_raw) WHERE unlinked_at IS NULL` (`postgresql_where` + `sqlite_where`, чтобы работало и в тестах). Индекс по `address_raw`.

`ton_proof_nonces`:

| Поле | Тип | Примечание |
|---|---|---|
| `nonce` | String(64) PK | 32 случайных байта в hex (`secrets.token_hex(32)`) |
| `user_id` | FK `users.id` ON DELETE CASCADE | |
| `created_at` | DateTime(tz) | |
| `used_at` | DateTime(tz) NULL | |

`downgrade()` удаляет обе таблицы. Записи `user_wallets` не удаляются — отвязка ставит `unlinked_at` (история нужна для антифрода).

## Настройка `ton_wallet` (economy_settings)

В `DEFAULTS` (`services/economy_seed.py`), группа `ton` («TON и кошелёк») в `SETTING_CATALOG` и `GROUP_RU`/`GROUP_ORDER` (`components/owner/SettingsList.tsx`), подписи в `lib/settingsMeta.ts`:

```json
{
  "enabled": true,
  "network": "mainnet",
  "proof_ttl_minutes": 15,
  "unique_address": true
}
```

- `network`: `mainnet` | `testnet` (тестовый стенд может работать в testnet). Нормализация в `set_setting`: только эти два значения, `proof_ttl_minutes` 1–30.
- `enabled = false` → эндпоинты привязки отвечают 403 «Привязка кошелька временно выключена», карточка показывает это текстом.

## Манифест TON Connect

Не кладём статический файл с доменом в репозиторий. Отдаём манифест из API:

- `GET /api/v1/wallet/tonconnect-manifest.json` (без авторизации, `Cache-Control: public, max-age=300`):
  `{"url": settings.webapp_url, "name": "TON Nexus", "iconUrl": settings.webapp_url.rstrip("/") + "/apple-touch-icon.png"}`.
- Фронт: `manifestUrl = location.origin + "/api/v1/wallet/tonconnect-manifest.json"` (или `VITE_API_BASE`, если задан).
- Домен для проверки `ton_proof` = хост из `settings.webapp_url`. В PR опиши Сергею, что `WEBAPP_URL` на сервере должен совпадать с адресом Mini App (обычно уже так).

## Логика — `backend/app/services/ton_wallet.py`

1. `async def new_proof_payload(session, user) -> str` — создаёт nonce, срок жизни `proof_ttl_minutes`. Старые неиспользованные nonce пользователя старше часа можно удалять тут же (без планировщика).
2. `async def link_wallet(session, *, user, account: dict, proof: dict, wallet_app: str | None, now=None) -> UserWallet` — проверки строго по docs.ton.org «How to authenticate users with ton_proof»:
   1. `proof.payload` — наш nonce этого пользователя, не использован, не истёк; пометить `used_at` **атомарно** (`UPDATE … WHERE used_at IS NULL` и проверить число строк) — повторно не принимается.
   2. `account.network` совпадает с настройкой (`-239` для mainnet, `-3` для testnet).
   3. `proof.domain.value` == домен из `webapp_url`, `proof.domain.lengthBytes` == длина домена в байтах UTF-8.
   4. `proof.timestamp` не старше `proof_ttl_minutes` и не из будущего больше чем на 60 с.
   5. `walletStateInit` (base64 BOC) → `StateInit`; `hash(StateInit)` с воркчейном из адреса == `account.address` (raw).
   6. Публичный ключ: из данных `StateInit` по известным хэшам кода кошелька (v3r1, v3r2, v4r2 — раскладка данных `seqno:32 subwallet:32 pubkey:256`; v5r1 — `is_signature_allowed:1 seqno:32 wallet_id:32 pubkey:256`). Хэши кода — из официального демо-бэкенда `ton-connect/demo-dapp-backend` и/или пакета `pytoniq` (сошлись на источник в комментарии, не выдумывай). Неизвестный код → запасной путь `get_public_key` через toncenter `runGetMethod` (задача 02 добавит ключ API; здесь без ключа, лимит 1 запрос/с) — если не вышло, ошибка «Этот кошелёк пока не поддерживается». Если `account.publicKey` передан — он должен совпасть.
   7. Подпись: `message = b"ton-proof-item-v2/" + workchain(int32 BE) + hash(32) + domain_len(uint32 LE) + domain + timestamp(uint64 LE) + payload(utf-8)`; `signed = sha256(b"\xff\xff" + b"ton-connect" + sha256(message))`; `nacl.signing.VerifyKey(pubkey).verify(signed, signature)`.
   8. Уникальность: если адрес активно привязан к **другому** пользователю и `unique_address = true` → ошибка «Этот кошелёк уже привязан к другому аккаунту». Если тот же адрес уже привязан к этому пользователю — вернуть существующую запись (идемпотентно).
   9. Если у пользователя другой активный кошелёк — сначала ставим ему `unlinked_at = now` (смена кошелька), затем создаём новую запись. Всё в одной транзакции, строка пользователя под `balance.get_user_for_update` (чтобы два параллельных запроса не создали две активные привязки; уникальный индекс — страховка).
3. `async def unlink_wallet(session, *, user, now=None)` — ставит `unlinked_at`. Если есть заявка на вывод в статусе `pending` → ошибка «Нельзя отвязать кошелёк, пока заявка на вывод на проверке».
4. `async def active_wallet(session, user_id) -> UserWallet | None`.
5. Ошибки — `WalletError(message)` с русским текстом для пользователя (→ 400), без технических деталей подписи наружу; подробность — в лог.

## API — новый роутер `backend/app/api/wallet.py` (подключить в `api/__init__.py`)

| Метод | Путь | Кто | Что делает |
|---|---|---|---|
| GET | `/wallet/tonconnect-manifest.json` | все, без авторизации | манифест |
| GET | `/wallet` | пользователь | `{enabled, network, wallet: {address, wallet_app, linked_at} \| null}` |
| POST | `/wallet/proof-payload` | пользователь | `{payload, expires_at}` |
| POST | `/wallet/link` | пользователь | тело: `{account: {address, network, publicKey, walletStateInit}, proof: {timestamp, domain: {lengthBytes, value}, signature, payload}, wallet_app}` → `{wallet}` |
| POST | `/wallet/unlink` | пользователь | → `{wallet: null}` |

Забаненные получают 403 (это уже делает `get_current_user`). В `GET /api/v1/me` ничего не добавляем (данные — через `/wallet`).

## UI — «Профиль» (`frontend/src/pages/Wallet.tsx`), стиль «Ночной контур»

- Новая строка `ListRow` **над** «Вывод»: иконка кошелька, заголовок «Кошелёк TON».
  - Не привязан: подпись «Не привязан · нужен для пополнения и вывода», справа `Tag` «привязать».
  - Привязан: подпись `UQ…a1b2 · Tonkeeper` (сокращение через существующую `shortAddr`), справа `Tag tone="ok"` «привязан».
- Касание открывает `Sheet` «Кошелёк TON»:
  - Не привязан: короткий текст «Подтвердите, что кошелёк ваш: приложение кошелька попросит подпись. Деньги не списываются.», главная кнопка «Привязать кошелёк» (52 px). Она: получает `payload` → `tonConnectUI.setConnectRequestParameters({ state: "ready", value: { tonProof: payload } })` → `tonConnectUI.openModal()`; по событию `onStatusChange` с `wallet.connectItems.tonProof` — `POST /wallet/link`. Пока ждём — состояние загрузки; ошибка — `Toast` с текстом сервера и «Повторить».
  - Привязан: полный адрес моноширинным шрифтом (JetBrains Mono) с переносом без обрезки, кнопка «Скопировать» (вибрация `selection`), «Сменить кошелёк» (тот же поток) и «Отвязать» — через `HoldButton` с подтверждением в шторке.
  - Отключение в интерфейсе TON Connect **не** отвязывает кошелёк на сервере. После привязки соединение не разрываем (`disconnect()` не вызываем): в задаче 02 через него отправляется перевод. Если соединения нет, а привязка на сервере есть — показываем привязку с сервера.
- Модальное окно TON Connect — родное, его стиль не трогаем; тема — `THEME.DARK`, язык `ru`. Ограничивать список кошельков нельзя (HANDOFF §7).
- Никаких бесконечных анимаций и `backdrop-filter`; появление шторки — как у других `Sheet`. Касания ≥ 44 px. Тексты без англицизмов (кроме названий кошельков).
- Чек-лист 360/390 px из HANDOFF §6 — обязательно, скриншоты: строка «не привязан», шторка до привязки, шторка после привязки (с длинным адресом), ошибка.

## Тесты (обязательно)

`backend/tests/test_ton_wallet.py` (SQLite в памяти, образец — `tests/test_ratings.py`):

1. Генерация тестового кошелька в тесте: ключ `nacl.signing.SigningKey.generate()`, `StateInit` кошелька v4r2 с этим ключом (через `pytoniq-core`), адрес из хэша `StateInit`, правильная подпись `ton_proof` — привязка проходит, адрес сохранён в raw и `UQ…` виде.
2. Неверная подпись → ошибка; чужой домен → ошибка; `lengthBytes` не совпал → ошибка; старый `timestamp` → ошибка; testnet при `mainnet` → ошибка.
3. Повтор того же `payload` → ошибка (одноразовость); чужой `payload` (выдан другому пользователю) → ошибка; истёкший → ошибка.
4. `StateInit` не соответствует адресу → ошибка; `publicKey` не совпал с ключом из `StateInit` → ошибка.
5. Тот же адрес у другого пользователя → ошибка; повторная привязка того же адреса тем же пользователем → идемпотентно, одна активная запись.
6. Смена кошелька: старая запись получает `unlinked_at`, активна одна.
7. Отвязка при `pending` заявке на вывод → ошибка; без заявки → `unlinked_at` проставлен.
8. API: `/wallet/tonconnect-manifest.json` отдаёт `url` и `iconUrl` из настроек без авторизации; `/wallet/link` при `enabled = false` → 403.
9. Нормализация настройки `ton_wallet` (неверная сеть → ошибка).

Фронт (vitest): строка «Кошелёк TON» в двух состояниях; `settingsMeta` знает `ton_wallet`. Модуль TON Connect в тестах замокать.

Все старые тесты зелёные; `npx tsc -b` и `npm run build` — без новых предупреждений о размере стартового чанка.

## Критерии приёмки

- [ ] Миграция `007` применяется на базе с данными и откатывается.
- [ ] Привязка работает в Telegram на телефоне (Tonkeeper и Telegram Wallet) — скриншоты в PR от Сергея после деплоя на тест.
- [ ] Все проверки `ton_proof` из списка реализованы и покрыты тестами.
- [ ] Один активный кошелёк на аккаунт, один адрес — один аккаунт; история привязок сохраняется.
- [ ] Манифест отдаётся API, домен нигде не захардкожен.
- [ ] `@tonconnect/ui-react` не попадает в стартовый чанк.
- [ ] Деньги и вывод не тронуты (`balance.py`, `withdraw.py` без изменений).
- [ ] UI по чек-листу 360/390 px, без бесконечных анимаций и `backdrop-filter`.

## Не входит (не делать)

- Пополнение, мемо, опрос блокчейна — задача 02.
- Оплата заданий/усилений из баланса — 03.
- Вывод только на привязанный кошелёк, холд после смены кошелька — 04.
- Автоматические выплаты, горячий кошелёк, любые приватные ключи/сид-фразы на сервере — никогда в этой задаче.
- Звёзды Telegram.

## Файлы

Новые:

- `backend/alembic/versions/007_user_wallets.py`
- `backend/app/models/wallet.py`
- `backend/app/services/ton_wallet.py`
- `backend/app/api/wallet.py`
- `backend/tests/test_ton_wallet.py`
- `frontend/src/lib/tonconnect.tsx` (ленивый провайдер `TonConnectUIProvider` + хелперы)

Изменить:

- `backend/requirements.txt`, `backend/app/models/__init__.py`, `backend/app/api/__init__.py`
- `backend/app/services/economy_seed.py`, `backend/app/services/economy_admin.py`
- `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`
- `frontend/src/pages/Wallet.tsx`, `frontend/src/api/hooks.ts`, `frontend/src/components/icons.tsx` (если нужна иконка)
- `frontend/src/lib/settingsMeta.ts` (+ `settingsMeta.test.ts`), `frontend/src/components/owner/SettingsList.tsx`
- `docs/SCHEMA.md` — новые таблицы
