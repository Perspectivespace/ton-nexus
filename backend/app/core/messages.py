"""Тексты сервера, которые видит игрок, на его языке: ошибки API и подписи истории баланса.

Исходный текст пишется в коде по-русски (как и раньше), а здесь — его перевод. Для текста с подстановками
(f-строка) ключ — шаблон с именами в фигурных скобках: «Минимум {min_ton} TON». Подставленные значения тоже
переводятся, если они есть в каталоге (названия полей вроде «Подпись баннера»).

Новая ошибка для игрока = строка в коде + строка здесь; tests/test_messages.py падает, если перевода нет.
"""

from __future__ import annotations

import re
from functools import lru_cache

from app.core.i18n import SUPPORTED, normalize

EN: dict[str, str] = {
    # ── «Арена» ──
    "нет спавнов на {seats} мест": "no spawn points for {seats} seats",
    "seed — целое 0…2^32−1": "seed must be an integer 0…2^32−1",
    "нужно ровно {seats} игроков": "exactly {seats} players required",
    "id игроков — разные целые": "player ids must be distinct integers",
    "ожидается объект": "an object is expected",
    "лишние поля {extra}": "unknown fields {extra}",
    "path — список": "path must be a list",
    "шаг — [x, y]": "a step must be [x, y]",
    "координаты — целые": "coordinates must be integers",
    "attack — id игрока или null": "attack must be a player id or null",
    "аптечка вместо движения и атаки": "a medkit replaces moving and attacking",
    "рывок без атаки": "no attack after a dash",
    "неизвестная версия состояния: {v}": "unknown state version: {v}",
    "«Арена» пока закрыта": "The Arena is closed for now",
    "Это не ваша комната": "This isn't your room",
    "Только для владельцев": "Owners only",
    # ── реклама: картинка экрана ──
    "пустой файл": "empty file",
    "файл больше 5 МБ": "file is over 5 MB",
    "Файл больше 5 МБ": "File is over 5 MB",
    "нужна картинка PNG, JPG или WebP": "use a PNG, JPG or WebP image",
    "тип файла не совпадает с содержимым": "file type doesn't match its contents",
    "загрузка картинок пока недоступна": "image uploads are unavailable for now",
    "Загрузка картинок пока недоступна — экран будет с текстом": "Image uploads are unavailable for now, the screen will show text",
    "картинка слишком большая по пикселям": "image has too many pixels",
    "картинка слишком маленькая — нужно хотя бы {MIN_W}×{MIN_H}": "image is too small, at least {MIN_W}×{MIN_H} needed",
    "картинка повреждена или это не картинка": "image is broken or not an image",
    "Реклама в городе доступна с {min_level}-го уровня": "City ads unlock at level {min_level}",
    "слишком много загрузок — попробуйте через час": "too many uploads, try again in an hour",
    "картинка не найдена — загрузите её заново": "image not found, upload it again",
    "картинка — только для экрана на фасаде": "images are for facade screens only",
    "Картинка — только для экрана на фасаде": "Images are for facade screens only",
    "объявление не найдено": "ad not found",
    "Картинку можно менять только у действующего объявления": "You can only change the image of an active ad",
    "картинка не найдена": "image not found",
    "нет доступа": "no access",
    # ── реклама: покупка, текст, ссылка ──
    "неизвестный район": "unknown district",
    "{name}: целое число": "{name}: whole number",
    "{name}: от {lo} до {hi}": "{name}: from {lo} to {hi}",
    "{name}: не больше 1000 TON": "{name}: 1000 TON max",
    "рекламное место не найдено": "ad spot not found",
    "{name}: пусто": "{name}: empty",
    "{name}: недопустимые символы": "{name}: invalid characters",
    "{name}: не длиннее {limit} символов": "{name}: {limit} characters max",
    "Текст объявления: недопустимые символы": "Text: invalid characters",
    "Текст объявления: не длиннее {limit} символов": "Text: {limit} characters max",
    "Ссылка: не длиннее {MAX_LINK_LEN} символов": "Link: {MAX_LINK_LEN} characters max",
    "Ссылка: недопустимые символы": "Link: invalid characters",
    "Ссылка: только https:// или t.me": "Link: https:// or t.me only",
    "Ссылка: логин и пароль в адресе запрещены": "Link: no login or password in the address",
    "Ссылка: неверный порт": "Link: invalid port",
    "Ссылка: нестандартный порт запрещён": "Link: non-standard ports aren't allowed",
    "Ссылка: неверный адрес сайта": "Link: invalid site address",
    "Ссылка: адрес по IP запрещён — нужен домен": "Link: no IP addresses, use a domain",
    "Ссылка: сокращатели ссылок запрещены — укажите полный адрес": "Link: no URL shorteners, use the full address",
    "Ссылка t.me: укажите канал, бота или чат": "Link t.me: add a channel, bot or chat",
    "Подпись бывает только у баннера и экрана на фасаде": "Only banners and facade screens have a subtitle",
    "Цвет: только из палитры города": "Color: city palette only",
    "Цвет: выберите из палитры": "Color: pick one from the palette",
    "Это место в другом районе": "This spot is in another district",
    "Это место сейчас не продаётся": "This spot isn't for sale right now",
    "Срок: от {min_days} до {max_days} суток": "Duration: {min_days} to {max_days} days",
    "Начать показ можно не раньше завтрашнего дня (МСК)": "The run can start tomorrow at the earliest (Moscow time)",
    "Начать показ можно не позже чем через {MAX_AHEAD_DAYS} дней": "The run must start within {MAX_AHEAD_DAYS} days",
    "Эти сутки уже заняты — выберите другие даты": "Those days are taken, pick other dates",
    "Недостаточно TON: нужно {total} TON": "Not enough TON: {total} TON needed",
    "Эти сутки только что заняли — выберите другие даты": "Those days were just taken, pick other dates",
    "Отменить можно только до проверки владельцем": "You can only cancel before the owner reviews it",
    "Ссылку можно менять только у действующего объявления": "You can only change the link of an active ad",
    "неизвестное событие": "unknown event",
    "объявление сейчас не показывается": "this ad isn't showing right now",
    # названия полей, которые подставляются в сообщения выше
    "Текст в городе": "City text",
    "Подпись баннера": "Subtitle",
    "Причина": "Reason",
    "цена за сутки": "price per day",
    "цена": "price",
    "награда": "reward",
    "награда за выполнение": "reward per completion",
    # ── рейтинги ──
    "Такого рейтинга нет": "No such rating",
    "Период: month или all": "Period: month or all",
    # ── задания и скриншоты ──
    "хранилище скриншотов недоступно": "screenshot storage is unavailable",
    "PNG повреждён": "PNG is broken",
    "JPEG повреждён": "JPEG is broken",
    "WebP повреждён": "WebP is broken",
    "задание неактивно": "task is inactive",
    "нельзя сдавать своё задание": "you can't submit your own task",
    "слишком много загрузок — отправьте заявку или подождите час": "too many uploads, submit or wait an hour",
    "скриншот не найден — загрузите заново": "screenshot not found, upload it again",
    "{name}: сумма TON строкой, например \"0.01\"": "{name}: TON amount as a string, e.g. \"0.01\"",
    "{name}: сумма TON — число": "{name}: TON amount must be a number",
    "{name}: должна быть больше 0": "{name}: must be above 0",
    "{name}: не больше 9 знаков после точки": "{name}: 9 decimal places max",
    "{name}: не больше 8 знаков после точки": "{name}: 8 decimal places max",
    "отрицательная сумма": "negative amount",
    "число выполнений — целое": "completions must be a whole number",
    "число выполнений: от {min_slots} до {max_slots}": "completions: {min_slots} to {max_slots}",
    "награда за выполнение: не больше 100 TON": "reward per completion: 100 TON max",
    "цена: не больше 100 TON": "price: 100 TON max",
    "комиссия больше суммы": "the fee exceeds the amount",
    "для «Перехода» нужна ссылка на ресурс": "a Visit task needs a link",
    "ссылка: http(s)://… или t.me/…": "link: http(s)://… or t.me/…",
    "ссылка слишком длинная": "link is too long",
    "Недостаточно TON на балансе создателя задания: нужно {amount} TON.": "The task creator doesn't have enough TON: {amount} TON needed.",
    "скриншот-подтверждение — только для «Перехода» и «Кампании»": "screenshot proof is for Visit and Campaign tasks only",
    "«{task_type}» создаёт только владелец": "Only the owner creates “{task_type}”",
    "цена: укажите сумму TON": "price: enter a TON amount",
    "число продаж: от 1 до {MAX_SLOTS}": "sales: 1 to {MAX_SLOTS}",
    "XP: от 0 до {MAX_XP}": "XP: 0 to {MAX_XP}",
    "награда за выполнение: укажите сумму TON": "reward per completion: enter a TON amount",
    "Тип «{t}» нельзя сменить.": "The “{t}” type can't be changed.",
    "«{task_type}» меняет только владелец": "Only the owner edits “{task_type}”",
    "число продаж: от {filled_slots} до {MAX_SLOTS}": "sales: {filled_slots} to {MAX_SLOTS}",
    "Награда «Перехода» задаётся тарифом и не меняется.": "The Visit reward is set by the tariff and can't be changed.",
    "XP «Перехода» задаётся тарифом и не меняется.": "Visit XP is set by the tariff and can't be changed.",
    "Тип «Переход» нельзя сменить.": "The Visit type can't be changed.",
    "После публикации награду можно только повысить.": "After publishing, the reward can only go up.",
    "После публикации число мест можно только увеличить.": "After publishing, slots can only be added.",
    "«Партнёрскую услугу» публикует только владелец": "Only the owner publishes a Partner service",
    "продажи закончились — увеличьте число продаж": "sold out, add more sales",
    "Бюджет задания не покрывает оставшиеся места — возобновить нельзя. Обратитесь к администратору.": "The task budget doesn't cover the remaining slots, so it can't be resumed. Contact an admin.",
    "«{task_type}» ставит на паузу только владелец": "Only the owner pauses “{task_type}”",
    "Это покупка: нажмите «Купить».": "This is a purchase: tap “Buy”.",
    "Приложите скриншот выполнения.": "Attach a screenshot of the completed task.",
    "Бюджет задания исчерпан: эта выплата превысила бы оплаченный бюджет. Заявка осталась на проверке.": "The task budget is used up: this payout would exceed it. The submission stays in review.",
    "партнёр: укажите Telegram ID пользователя приложения": "partner: enter the app user's Telegram ID",
    "партнёр: такого пользователя нет в приложении (пусть сначала откроет бота)": "partner: no such app user (they need to open the bot first)",
    "партнёр заблокирован": "partner is blocked",
    "закрыть так можно только партнёрскую услугу": "only a Partner service can be closed this way",
    "«Партнёрскую услугу» закрывает только владелец": "Only the owner closes a Partner service",
    "Услуга сейчас недоступна.": "This service is unavailable right now.",
    "Продажи закончились.": "Sold out.",
    "Нужен уровень {min_level}.": "Level {min_level} required.",
    "У услуги нет партнёра — покупка недоступна.": "This service has no partner, so it can't be bought.",
    "Нельзя купить свою услугу.": "You can't buy your own service.",
    "Недостаточно TON: нужно {amount} TON, на балансе {balance} TON.": "Not enough TON: {amount} TON needed, you have {balance} TON.",
    "Этот тип задания больше не создаётся: выберите «Переход» (можно со скриншотом) или «Кампанию».": "This task type is retired: pick Visit (screenshot optional) or Campaign.",
    "quote только для visit, campaign и partner": "quote is for visit, campaign and partner only",
    "этот тип только для владельца": "this type is owner-only",
    # ── пополнение и кошелёк ──
    "Пополнение временно недоступно": "Top-ups are temporarily unavailable",
    "Неверная сумма": "Invalid amount",
    "Не больше 9 знаков после точки": "9 decimal places max",
    "Минимум {min_ton} TON": "Minimum {min_ton} TON",
    "Сумма слишком большая": "Amount is too large",
    "Не удалось создать мемо": "Couldn't create a memo",
    "Неверный адрес TON": "Invalid TON address",
    "Нельзя отвязать кошелёк, пока заявка на вывод на проверке": "You can't unlink the wallet while a withdrawal is in review",
    "Кошелёк не привязан": "No wallet linked",
    "Этот кошелёк пока не поддерживается": "This wallet isn't supported yet",
    "Адрес не совпадает с данными кошелька": "The address doesn't match the wallet data",
    "Время подтверждения из будущего": "The proof time is in the future",
    "Время подтверждения истекло": "The proof has expired",
    "Домен подтверждения не совпадает": "The proof domain doesn't match",
    "Сеть кошелька не совпадает с настройками": "The wallet network doesn't match the settings",
    "Некорректный адрес": "Invalid address",
    "Публичный ключ не совпадает": "The public key doesn't match",
    "Подпись не прошла проверку": "The signature failed verification",
    "Привязка кошелька временно отключена": "Wallet linking is temporarily off",
    "Привязка кошелька отключена": "Wallet linking is off",
    "Неверные данные подтверждения": "Invalid proof data",
    "Подтверждение уже использовано": "This proof was already used",
    "Этот кошелёк уже привязан к другому аккаунту": "This wallet is already linked to another account",
    "Не указана сеть кошелька": "Wallet network not specified",
    # ── «Башня» ──
    "Месяц в формате ГГГГ-ММ": "Month as YYYY-MM",
    "Бустеры пока недоступны": "Boosters aren't available yet",
    "Слишком длинный журнал тапов": "Tap log is too long",
    "Некорректный журнал тапов": "Invalid tap log",
    "Первый тап слишком быстрый": "The first tap came too fast",
    "Тапы идут быстрее, чем может человек": "Taps are faster than humanly possible",
    "Игра длилась меньше, чем записано в журнале": "The game was shorter than the tap log says",
    "Игра не найдена": "Game not found",
    "Результат этой игры уже принят": "This game's result is already in",
    "Игра закрыта по времени": "The game timed out",
    "В журнале есть тапы, которых в этой игре быть не могло": "The log has taps that couldn't happen in this game",
    "Результат не совпал с проверкой": "The result didn't pass the check",
    # ── история баланса ──
    "Пополнение TON": "TON top-up",
    "Вывод TON": "TON withdrawal",
    "Возврат вывода": "Withdrawal refund",
    "Награда за задание": "Task reward",
    "Бюджет задания": "Task budget",
    "Ежедневный бонус": "Daily bonus",
    "Сбор майнера": "Miner collect",
    "Усиление майнера": "Miner boost",
    "Рулетка": "Wheel",
    "Промокод": "Promo code",
    "Приз «Башни»": "Tower prize",
    "Ставка «Арены»": "Arena stake",
    "Возврат ставки «Арены»": "Arena stake refund",
    "Приз «Арены»": "Arena prize",
    "Продажа партнёрской услуги": "Partner service sale",
    "Покупка партнёрской услуги": "Partner service purchase",
    "Возврат бюджета задания": "Task budget refund",
    "Реклама в городе": "City ads",
    "Возврат за рекламу в городе": "City ad refund",
    "Начисление": "Credit",
    "Списание": "Debit",
    "в обработке": "processing",
    "отправляется": "sending",
    "выплачено": "paid",
    "отклонено": "rejected",
    "на проверке": "in review",
    "Зачислено вручную": "Credited manually",
    "Меньше минимума": "Below minimum",
    "Заявка #{id}": "Request #{id}",
    "Заявка #{id} отклонена": "Request #{id} rejected",
}

CATALOGS: dict[str, dict[str, str]] = {"en": EN}


@lru_cache(maxsize=None)
def _patterns(lang: str) -> list[tuple[re.Pattern[str], str]]:
    """Шаблоны с подстановками → регулярные выражения (полное совпадение, значения — именованные группы)."""
    out = []
    for src, dst in CATALOGS.get(lang, {}).items():
        if "{" not in src:
            continue
        parts = re.split(r"\{(\w+)\}", src)
        rx = "".join(re.escape(p) if i % 2 == 0 else f"(?P<{p}>.+?)" for i, p in enumerate(parts))
        out.append((re.compile(f"^{rx}$", re.S), dst))
    # длинные шаблоны первыми: «{name}: …» не должен перехватывать более точный
    out.sort(key=lambda x: -len(x[0].pattern))
    return out


def localize(text: str, lang: str | None) -> str:
    """Текст сервера на языке игрока; нет перевода — как есть (по-русски)."""
    lang = normalize(lang)
    cat = CATALOGS.get(lang) if lang else None
    if not cat or not isinstance(text, str) or not text:
        return text
    if text in cat:
        return cat[text]
    for rx, dst in _patterns(lang):
        m = rx.match(text)
        if m:
            vals = {k: cat.get(v, v) for k, v in m.groupdict().items()}
            return dst.format(**vals)
    return text


def request_lang(header: str | None) -> str | None:
    """Язык из заголовка X-Lang (клиент шлёт его с каждым запросом); неизвестный — None."""
    v = normalize(header)
    return v if v in SUPPORTED else None
