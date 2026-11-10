"""Реклама в городе — места, тариф `city_ads`, расчёт цены и свободных дат, проверка текста и ссылки.

PR 1: расчёт. PR 2: бронь с оплатой с баланса, модерация владельцем, возвраты, смена ссылки, истечение срока.

Форматы и места (координаты — во фронтенде):
- ``line``          «Бегущая строка» — LED-полоса (tower_line; в районах — rows_line, port_line);
- ``banner``        «Голо-баннер» — голо-панель (banner_sky, banner_street; rows_banner, port_banner_cargo/tram);
- ``neon``          «Неоновая вывеска» (neon_left, neon_right; rows_neon, port_neon);
- ``facade_screen`` «Экран на фасаде» — большой экран на рынке «Неон-рядов» (rows_facade). Пока только текст:
  заголовок + подпись; картинка-постер — отдельным обновлением (загрузка и модерация изображения).

Районы: centre — главная страница города (все места до районов), rows — «Неон-ряды», port — «Порт».
Цена за сутки — по типу места (настройка ``prices``); у места может быть своя цена (``spots.<место>.price_day``).
У мест Центра своя цена задана, как и раньше, — их цены не меняются. Места районов засеяны снятыми с продажи.

Сутки — по МСК (app.services.gameday). Одно объявление на место в сутки (city_ad_days, UNIQUE(spot, day)).
Начать показ можно не раньше завтрашнего дня (до начала владелец успевает проверить объявление)
и не позже чем через MAX_AHEAD_DAYS дней. Суммы считаются в целых нанотонах.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.city_ad import AD_STATUSES as AD_STATUSES_ALL
from app.models.city_ad import AD_EVENT_KINDS, DISTRICTS, SPOT_FORMATS, CityAd, CityAdDay, CityAdEvent, CityAdSpot
from app.models.user import User
from app.services import balance as balance_svc
from app.services.economy import get_setting
from app.services.economy_seed import DEFAULTS
from app.services.gameday import game_day
from app.services.task_tariff import TaskTariffError, nano_to_ton, ton_to_nano

KEY = "city_ads"
FORMATS = SPOT_FORMATS
FORMAT_RU = {
    "line": "Бегущая строка",
    "banner": "Голо-баннер",
    "neon": "Неоновая вывеска",
    "facade_screen": "Экран на фасаде",
}
DEFAULT_DISTRICT = "centre"
DISTRICT_RU = {"centre": "Центр", "rows": "Неон-ряды", "port": "Порт"}

# места: ключ, формат, подпись, порядок (Центр сеет миграция 018, районы — 020)
SPOTS: tuple[tuple[str, str, str, int], ...] = (
    ("tower_line", "line", "Бегущая строка на реакторной башне", 10),
    ("banner_sky", "banner", "Голо-баннер над площадью", 20),
    ("banner_street", "banner", "Голо-баннер у мостовой", 30),
    ("neon_left", "neon", "Неоновая вывеска слева", 40),
    ("neon_right", "neon", "Неоновая вывеска справа", 50),
    ("rows_facade", "facade_screen", "Экран на фасаде рынка", 110),
    ("rows_line", "line", "Бегущая строка над навесами", 120),
    ("rows_neon", "neon", "Неоновая вывеска у входа на рынок", 130),
    ("rows_banner", "banner", "Голо-баннер над крышей рынка", 140),
    ("port_line", "line", "Бегущая строка на стреле крана", 210),
    ("port_banner_cargo", "banner", "Голо-баннер на контейнерах", 220),
    ("port_banner_tram", "banner", "Голо-баннер на станции трамвая", 230),
    ("port_neon", "neon", "Неоновая вывеска над воротами склада", 240),
)
SPOT_KEYS = tuple(s[0] for s in SPOTS)
# район места по ключу (места без префикса района — Центр)
SPOT_DISTRICT: dict[str, str] = {
    k: ("rows" if k.startswith("rows_") else "port" if k.startswith("port_") else "centre") for k in SPOT_KEYS
}


def district_keys(district: str) -> tuple[str, ...]:
    return tuple(k for k in SPOT_KEYS if SPOT_DISTRICT[k] == district)


def check_district(district: str | None) -> str | None:
    """None — район не указан; иначе один из DISTRICTS."""
    if district in (None, ""):
        return None
    if district not in DISTRICTS:
        raise CityAdError("неизвестный район")
    return district

# палитра города (styles/tokens.css): ключ → цвет; во фронтенде те же ключи
PALETTE: dict[str, str] = {
    "cyan": "#2BF5FF",
    "magenta": "#FF2E7E",
    "amber": "#FFB547",
    "mint": "#5DFFB0",
    "violet": "#B084FF",
}

MIN_LEAD_DAYS = 1  # начать можно с завтрашнего дня МСК
MAX_AHEAD_DAYS = 90  # и не позже чем через 90 дней
HARD_MAX_DAYS = 30
MAX_PRICE_NANO = 1_000 * 10**9
HARD_TITLE_MAX = 64  # колонка city_ads.title
HARD_SUBTITLE_MAX = 32  # колонка city_ads.subtitle
HARD_BODY_MAX = 2_000
MAX_LINK_LEN = 512
BUSY_STATUSES = ("pending", "approved")  # эти объявления держат дни

# значения по умолчанию живут в economy_seed.DEFAULTS["city_ads"] (сид настроек), здесь — ссылка на них
DEFAULT: dict[str, Any] = DEFAULTS[KEY][0]  # type: ignore[assignment]

# сокращатели ссылок: прячут настоящий адрес — запрещены
SHORTENERS = frozenset(
    {
        "bit.ly", "bitly.com", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "v.gd", "buff.ly", "cutt.ly",
        "rb.gy", "shorturl.at", "tiny.cc", "bit.do", "clck.ru", "vk.cc", "u.to", "rebrand.ly", "s.id", "t.ly",
        "lnkd.in", "adf.ly", "shorte.st", "qps.ru", "surl.li", "goo.su", "tinyurl.ru", "short.io", "bl.ink",
        "soo.gd", "trib.al", "dlvr.it", "cli.re", "kutt.it", "shrtco.de", "x.gd", "urlz.fr", "l.ead.me",
    }
)
TELEGRAM_HOSTS = frozenset({"t.me", "telegram.me"})


class CityAdError(ValueError):
    pass


class CityAdPermissionError(PermissionError):
    pass


class CityAdBusyError(CityAdError):
    """Хотя бы одни сутки уже заняты другим объявлением."""


class CityAdFundsError(CityAdError):
    """Не хватает TON на балансе."""


class CityAdNotFoundError(LookupError):
    pass


# ── Настройка city_ads ─────────────────────────────────────────────────────────


def _int(v: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise CityAdError(f"{name}: целое число")
    if not lo <= v <= hi:
        raise CityAdError(f"{name}: от {lo} до {hi}")
    return v


def _price(v: Any, name: str) -> str:
    try:
        nano = ton_to_nano(v, name=name)
    except TaskTariffError as e:
        raise CityAdError(str(e)) from e
    if nano > MAX_PRICE_NANO:
        raise CityAdError(f"{name}: не больше 1000 TON")
    return nano_to_ton(nano)


def normalize(value: Any) -> dict[str, Any]:
    """Каноническая настройка: недостающие поля берутся из DEFAULT, лишние и неверные — ошибка."""
    if not isinstance(value, dict):
        raise CityAdError("Настройка рекламы должна быть объектом")
    extra = set(value) - set(DEFAULT)
    if extra:
        raise CityAdError(f"лишние поля {sorted(extra)}")
    out: dict[str, Any] = {
        "min_level": _int(value.get("min_level", DEFAULT["min_level"]), "Мин. уровень покупателя", 1, 1000),
        "min_days": _int(value.get("min_days", DEFAULT["min_days"]), "Мин. срок", 1, HARD_MAX_DAYS),
        "max_days": _int(value.get("max_days", DEFAULT["max_days"]), "Макс. срок", 1, HARD_MAX_DAYS),
        "body_max": _int(value.get("body_max", DEFAULT["body_max"]), "Текст объявления", 0, HARD_BODY_MAX),
    }
    if out["min_days"] > out["max_days"]:
        raise CityAdError("Мин. срок не может быть больше макс. срока")

    spots = value.get("spots", {})
    if not isinstance(spots, dict):
        raise CityAdError("spots: нужен объект")
    extra = set(spots) - set(SPOT_KEYS)
    if extra:
        raise CityAdError(f"неизвестные места {sorted(extra)}")
    out["spots"] = {}
    for key in SPOT_KEYS:
        base = DEFAULT["spots"][key]
        raw = spots.get(key, base)
        if not isinstance(raw, dict):
            raise CityAdError(f"{key}: нужен объект")
        if set(raw) - {"price_day", "enabled"}:
            raise CityAdError(f"{key}: лишние поля {sorted(set(raw) - {'price_day', 'enabled'})}")
        # своя цена места: не задана (нет поля, null или пусто) — берётся цена типа места из prices
        own = raw.get("price_day", base.get("price_day"))
        enabled = raw.get("enabled", base.get("enabled", True))
        if not isinstance(enabled, bool):
            raise CityAdError(f"{key} · продаётся: да/нет")
        item: dict[str, Any] = {}
        if own not in (None, ""):
            item["price_day"] = _price(own, f"{key} · цена за сутки")
        item["enabled"] = enabled
        out["spots"][key] = item

    prices = value.get("prices", {})
    if not isinstance(prices, dict):
        raise CityAdError("prices: нужен объект")
    extra = set(prices) - set(FORMATS)
    if extra:
        raise CityAdError(f"неизвестные форматы {sorted(extra)}")
    out["prices"] = {}
    for fmt in FORMATS:
        raw = prices.get(fmt, DEFAULT["prices"][fmt])
        if not isinstance(raw, dict):
            raise CityAdError(f"{fmt}: нужен объект")
        if set(raw) - {"price_day"}:
            raise CityAdError(f"{fmt}: лишние поля {sorted(set(raw) - {'price_day'})}")
        out["prices"][fmt] = {
            "price_day": _price(raw.get("price_day", DEFAULT["prices"][fmt]["price_day"]), f"{FORMAT_RU[fmt]} · цена за сутки")
        }

    limits = value.get("limits", {})
    if not isinstance(limits, dict):
        raise CityAdError("limits: нужен объект")
    extra = set(limits) - set(FORMATS)
    if extra:
        raise CityAdError(f"неизвестные форматы {sorted(extra)}")
    out["limits"] = {}
    for fmt in FORMATS:
        base = DEFAULT["limits"][fmt]
        raw = limits.get(fmt, base)
        if not isinstance(raw, dict):
            raise CityAdError(f"{fmt}: нужен объект")
        if set(raw) - set(base):
            raise CityAdError(f"{fmt}: лишние поля {sorted(set(raw) - set(base))}")
        lim = {"title_max": _int(raw.get("title_max", base["title_max"]), f"{FORMAT_RU[fmt]} · длина текста", 1, HARD_TITLE_MAX)}
        if "subtitle_max" in base:
            lim["subtitle_max"] = _int(
                raw.get("subtitle_max", base["subtitle_max"]), f"{FORMAT_RU[fmt]} · длина подписи", 0, HARD_SUBTITLE_MAX
            )
        out["limits"][fmt] = lim
    return out


async def load_config(session: AsyncSession) -> dict[str, Any]:
    """Тариф из economy_settings; если записи нет или она испорчена — значения по умолчанию."""
    raw = await get_setting(session, KEY)
    try:
        return normalize(raw if isinstance(raw, dict) else DEFAULT)
    except CityAdError:
        return normalize(DEFAULT)


def spot_price_day(cfg: dict[str, Any], spot_key: str) -> str:
    """Цена места за сутки (TON строкой): своя цена места, иначе — цена его типа."""
    own = cfg["spots"].get(spot_key, {}).get("price_day")
    if own is not None:
        return own
    fmt = next(f for k, f, _, _ in SPOTS if k == spot_key)
    return cfg["prices"][fmt]["price_day"]


def price_nano(cfg: dict[str, Any], spot_key: str, days: int) -> tuple[int, int]:
    """(цена за сутки, итого) в нанотонах."""
    per_day = ton_to_nano(spot_price_day(cfg, spot_key), name="цена за сутки")
    return per_day, per_day * int(days)


# ── Места ─────────────────────────────────────────────────────────────────────


async def ensure_spots(session: AsyncSession) -> int:
    """Добавить недостающие места (то же делают миграции 018 и 020; нужно тестам и запуску без alembic)."""
    have = set((await session.execute(select(CityAdSpot.key))).scalars().all())
    n = 0
    for key, fmt, title, sort in SPOTS:
        if key not in have:
            session.add(
                CityAdSpot(key=key, format=fmt, title=title, sort=sort, enabled=True, district=SPOT_DISTRICT[key])
            )
            n += 1
    if n:
        await session.flush()
    return n


async def _spot(session: AsyncSession, key: str) -> CityAdSpot:
    spot = await session.scalar(select(CityAdSpot).where(CityAdSpot.key == key))
    if not spot:
        raise CityAdError("рекламное место не найдено")
    return spot


def spot_on_sale(cfg: dict[str, Any], spot: CityAdSpot) -> bool:
    return bool(spot.enabled) and bool(cfg["spots"].get(spot.key, {}).get("enabled", False))


# ── Текст, цвет, ссылка ──────────────────────────────────────────────────────

_CTRL = re.compile(r"[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")
_HOST = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$")


def _line(v: str | None, name: str, limit: int, *, required: bool) -> str | None:
    s = " ".join(str(v or "").split())
    if not s:
        if required:
            raise CityAdError(f"{name}: пусто")
        return None
    if _CTRL.search(s):
        raise CityAdError(f"{name}: недопустимые символы")
    if len(s) > limit:
        raise CityAdError(f"{name}: не длиннее {limit} символов")
    return s


def _body(v: str | None, limit: int) -> str | None:
    s = str(v or "").replace("\r\n", "\n").strip()
    if not s:
        return None
    if _CTRL.search(s.replace("\n", "")):
        raise CityAdError("Текст объявления: недопустимые символы")
    if len(s) > limit:
        raise CityAdError(f"Текст объявления: не длиннее {limit} символов")
    return s


def _is_shortener(host: str) -> bool:
    return any(host == d or host.endswith("." + d) for d in SHORTENERS)


def normalize_link(url: str | None) -> str | None:
    """Ссылка объявления: только https:// или t.me; без сокращателей, логина в адресе, IP и чужих портов.

    «t.me/имя» без схемы дополняется до https://t.me/имя. Возвращает каноническую ссылку или None (ссылки нет).
    """
    s = str(url or "").strip()
    if not s:
        return None
    if len(s) > MAX_LINK_LEN:
        raise CityAdError(f"Ссылка: не длиннее {MAX_LINK_LEN} символов")
    if _CTRL.search(s) or any(c.isspace() for c in s):
        raise CityAdError("Ссылка: недопустимые символы")
    low = s.lower()
    if low.startswith(("t.me/", "telegram.me/")):
        s = "https://" + s
    parts = urlsplit(s)
    if parts.scheme.lower() != "https":
        raise CityAdError("Ссылка: только https:// или t.me")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise CityAdError("Ссылка: логин и пароль в адресе запрещены")
    try:
        port = parts.port
    except ValueError as e:
        raise CityAdError("Ссылка: неверный порт") from e
    if port not in (None, 443):
        raise CityAdError("Ссылка: нестандартный порт запрещён")
    host = (parts.hostname or "").rstrip(".")
    try:
        host = host.encode("idna").decode("ascii").lower()
    except UnicodeError as e:
        raise CityAdError("Ссылка: неверный адрес сайта") from e
    try:
        ipaddress.ip_address(host.strip("[]"))
        is_ip = True
    except ValueError:
        is_ip = False
    if is_ip:
        raise CityAdError("Ссылка: адрес по IP запрещён — нужен домен")
    if not _HOST.match(host):
        raise CityAdError("Ссылка: неверный адрес сайта")
    if _is_shortener(host):
        raise CityAdError("Ссылка: сокращатели ссылок запрещены — укажите полный адрес")
    if host in TELEGRAM_HOSTS:
        path = parts.path.strip("/")
        if not path:
            raise CityAdError("Ссылка t.me: укажите канал, бота или чат")
        host = "t.me"
    return urlunsplit(("https", host, parts.path or "", parts.query, parts.fragment))


def link_kind(url: str | None) -> str | None:
    """telegram — открывать через openTelegramLink, web — через openLink (с подтверждением)."""
    if not url:
        return None
    return "telegram" if urlsplit(url).hostname in TELEGRAM_HOSTS else "web"


@dataclass
class AdContent:
    title: str | None = None
    subtitle: str | None = None
    body: str | None = None
    link_url: str | None = None
    color: str | None = None


def validate_content(cfg: dict[str, Any], fmt: str, c: AdContent, *, partial: bool = True) -> AdContent:
    """Проверить и привести текст, ссылку и цвет. partial — проверять только заполненное (живой расчёт в форме)."""
    lim = cfg["limits"][fmt]
    title = _line(c.title, "Текст в городе", lim["title_max"], required=not partial)
    subtitle = None
    if c.subtitle not in (None, ""):
        if "subtitle_max" not in lim:
            raise CityAdError("Подпись бывает только у баннера и экрана на фасаде")
        subtitle = _line(c.subtitle, "Подпись баннера", lim.get("subtitle_max", 0), required=False)
    body = _body(c.body, cfg["body_max"])
    link = normalize_link(c.link_url)
    color = None
    if c.color not in (None, ""):
        color = str(c.color).strip().lower()
        if color not in PALETTE:
            raise CityAdError("Цвет: только из палитры города")
    elif not partial:
        raise CityAdError("Цвет: выберите из палитры")
    return AdContent(title=title, subtitle=subtitle, body=body, link_url=link, color=color)


# ── Занятость и расчёт ───────────────────────────────────────────────────────


async def busy_days(session: AsyncSession, spot_id: int, start: date, end: date) -> set[date]:
    rows = await session.execute(
        select(CityAdDay.day)
        .join(CityAd, CityAd.id == CityAdDay.ad_id)
        .where(
            CityAdDay.spot_id == spot_id,
            CityAdDay.day >= start,
            CityAdDay.day <= end,
            CityAd.status.in_(BUSY_STATUSES),
        )
    )
    return set(rows.scalars().all())


def next_free_start(busy: set[date], *, frm: date, latest: date, days: int) -> date | None:
    """Первая дата начала ≥ frm (не позже latest), с которой подряд свободны `days` суток."""
    d = frm
    while d <= latest:
        clash = [x for x in (d + timedelta(days=i) for i in range(days)) if x in busy]
        if not clash:
            return d
        d = max(clash) + timedelta(days=1)  # раньше конца занятого дня окно не освободится
    return None


@dataclass
class Quote:
    spot_key: str
    format: str
    district: str
    start: date
    end: date
    days: int
    price_day_nano: int
    total_nano: int
    available: bool
    occupied: list[date]
    busy: list[date]  # все занятые сутки места в окне брони — для календаря
    next_free: date | None
    earliest: date
    latest: date
    content: AdContent | None = None
    link_kind: str | None = None

    @property
    def price_day(self) -> str:
        return nano_to_ton(self.price_day_nano)

    @property
    def total(self) -> str:
        return nano_to_ton(self.total_nano)


async def quote(
    session: AsyncSession,
    *,
    user: User,
    spot_key: str,
    start: date,
    days: int,
    content: AdContent | None = None,
    today: date | None = None,
    strict: bool = False,
    district: str | None = None,
) -> Quote:
    """Цена и свободные даты для брони. Всё пересчитывается на сервере из тарифа и занятых дней.

    district — необязательно: если указан, место должно быть в этом районе."""
    cfg = await load_config(session)
    if int(user.level or 1) < cfg["min_level"]:
        raise CityAdPermissionError(f"Реклама в городе доступна с {cfg['min_level']}-го уровня")
    district = check_district(district)
    spot = await _spot(session, spot_key)
    if district is not None and spot.district != district:
        raise CityAdError("Это место в другом районе")
    if not spot_on_sale(cfg, spot):
        raise CityAdError("Это место сейчас не продаётся")
    if isinstance(days, bool) or not isinstance(days, int) or not cfg["min_days"] <= days <= cfg["max_days"]:
        raise CityAdError(f"Срок: от {cfg['min_days']} до {cfg['max_days']} суток")
    today = today or game_day()
    earliest = today + timedelta(days=MIN_LEAD_DAYS)
    latest = today + timedelta(days=MAX_AHEAD_DAYS)
    if start < earliest:
        raise CityAdError("Начать показ можно не раньше завтрашнего дня (МСК)")
    if start > latest:
        raise CityAdError(f"Начать показ можно не позже чем через {MAX_AHEAD_DAYS} дней")
    end = start + timedelta(days=days - 1)
    per_day, total = price_nano(cfg, spot.key, days)
    horizon_end = latest + timedelta(days=cfg["max_days"] - 1)
    busy = await busy_days(session, spot.id, earliest, horizon_end)
    occupied = sorted(d for d in busy if start <= d <= end)
    nxt = next_free_start(busy, frm=start, latest=latest, days=days)
    # strict — бронь: текст и цвет обязательны; без strict — живой расчёт, проверяется только заполненное
    checked = validate_content(cfg, spot.format, content, partial=not strict) if content is not None else None
    return Quote(
        spot_key=spot.key,
        format=spot.format,
        district=spot.district,
        start=start,
        end=end,
        days=days,
        price_day_nano=per_day,
        total_nano=total,
        available=not occupied,
        occupied=occupied,
        busy=sorted(busy),
        next_free=nxt,
        earliest=earliest,
        latest=latest,
        content=checked,
        link_kind=link_kind(checked.link_url) if checked else None,
    )


# ── Публичная витрина: места и объявления на сегодня ─────────────────────────


async def board(
    session: AsyncSession, *, today: date | None = None, district: str | None = DEFAULT_DISTRICT
) -> dict[str, Any]:
    """Что показывать в городе сегодня (МСК): места, цены, одобренные объявления. Без персональных данных.

    district — район (по умолчанию Центр, как было до районов); "all" — все районы сразу."""
    cfg = await load_config(session)
    today = today or game_day()
    q = select(CityAdSpot).order_by(CityAdSpot.sort, CityAdSpot.id)
    if district != "all":
        district = check_district(district) or DEFAULT_DISTRICT
        q = q.where(CityAdSpot.district == district)
    spots = (await session.execute(q)).scalars().all()
    rows = await session.execute(
        select(CityAdDay.spot_id, CityAd)
        .join(CityAd, CityAd.id == CityAdDay.ad_id)
        .where(CityAdDay.day == today, CityAd.status == "approved")
    )
    ads = {spot_id: ad for spot_id, ad in rows.all()}
    from app.services import city_ad_images as images_svc

    pics = await images_svc.keys_for(session, [a.id for a in ads.values() if a.format == images_svc.FORMAT])
    out = []
    for s in spots:
        ad = ads.get(s.id) if s.enabled else None
        out.append(
            {
                "key": s.key,
                "format": s.format,
                "district": s.district,
                "title": s.title,
                "on_sale": spot_on_sale(cfg, s),
                "price_day": spot_price_day(cfg, s.key) if s.key in SPOT_DISTRICT else None,
                "ad": None
                if ad is None
                else {
                    "id": ad.id,
                    "title": ad.title,
                    "subtitle": ad.subtitle,
                    "body": ad.body,
                    "link_url": ad.link_url,
                    "link_kind": link_kind(ad.link_url),
                    "color": ad.color,
                    "until": ad.end_day.isoformat(),
                    # картинка экрана на фасаде (одобрена вместе с объявлением); нет — экран только с текстом
                    "image_url": images_svc.public_path(pics[ad.id]) if ad.id in pics else None,
                },
            }
        )
    return {
        "day": today.isoformat(),
        "district": district,
        "spots": out,
        "prices": {f: p["price_day"] for f, p in cfg["prices"].items()},
        "palette": PALETTE,
        "min_level": cfg["min_level"],
        "min_days": cfg["min_days"],
        "max_days": cfg["max_days"],
        "body_max": cfg["body_max"],
        "limits": cfg["limits"],
        # можно ли загрузить картинку на экран фасада (на сервере есть Pillow с WebP)
        "image_upload": images_svc.available(),
    }


# ── Бронь, оплата, модерация, возвраты (PR 2) ─────────────────────────────────
#
# Деньги (нанотоны, целые): при брони с баланса списывается total_nano (paid_nano) — это удержание.
# Одобрение переводит удержание в доход платформы (revenue_nano). Возвраты — refunded_nano.
# Инвариант: refunded_nano + revenue_nano ≤ paid_nano; удержание = paid − refunded − revenue.
# Каждая функция работает в транзакции вызывающего: он делает commit, при ошибке — rollback.

PAY_TYPE = "city_ads"  # списание за рекламу (balance_history.balance_type)
REFUND_TYPE = "city_ads_refund"  # возврат за рекламу
REF_TYPE = "city_ad"
NOTE_MAX = 500
_NANO = Decimal(10**9)


def _ton(nano: int) -> Decimal:
    """Нанотоны → TON для журнала баланса (кратно 10 нанотонам — кванту баланса, проверено в тарифе)."""
    return (Decimal(int(nano)) / _NANO).quantize(Decimal("0.00000001"))


def held_nano(ad: CityAd) -> int:
    return int(ad.paid_nano) - int(ad.refunded_nano) - int(ad.revenue_nano)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _lock_ad(session: AsyncSession, ad_id: int) -> CityAd:
    await session.flush()
    ad = await session.scalar(
        select(CityAd).where(CityAd.id == ad_id).with_for_update().execution_options(populate_existing=True)
    )
    if not ad:
        raise CityAdNotFoundError("объявление не найдено")
    return ad


async def _free_days(session: AsyncSession, ad: CityAd) -> None:
    """Освободить сутки объявления: место снова можно купить (UNIQUE(spot, day) держит только живые брони)."""
    await session.execute(delete(CityAdDay).where(CityAdDay.ad_id == ad.id))


async def _refund(session: AsyncSession, ad: CityAd, nano: int, why: str) -> int:
    if nano <= 0:
        return 0
    await balance_svc.credit(
        session,
        user_id=ad.advertiser_id,
        amount=_ton(nano),
        balance_type=REFUND_TYPE,
        description=f"Возврат за рекламу в городе: {why} (объявление #{ad.id})",
        reference_type=REF_TYPE,
        reference_id=ad.id,
    )
    ad.refunded_nano = int(ad.refunded_nano) + nano
    return nano


def _days_ru(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} сутки"
    return f"{n} суток"


async def book(
    session: AsyncSession,
    *,
    user: User,
    spot_key: str,
    start: date,
    days: int,
    content: AdContent,
    today: date | None = None,
    district: str | None = None,
    image_id: int | None = None,
) -> CityAd:
    """Купить показ: цена пересчитывается на сервере, сутки резервируются атомарно, оплата — с баланса.

    Порядок: расчёт и проверки (уровень, место, срок, текст, ссылка) → блокировка пользователя и проверка баланса →
    объявление и его сутки в точке сохранения (гонка за те же сутки → UNIQUE → «занято», ничего не списано) →
    списание. Объявление ждёт модерации (pending); деньги до одобрения — удержание.
    image_id — загруженная заранее картинка (только экран на фасаде), прикладывается в той же транзакции.
    """
    q = await quote(
        session, user=user, spot_key=spot_key, start=start, days=days, content=content, today=today, strict=True,
        district=district,
    )
    if not q.available:
        raise CityAdBusyError("Эти сутки уже заняты — выберите другие даты")
    c = q.content
    assert c is not None and c.title and c.color
    spot = await _spot(session, q.spot_key)
    if image_id is not None:
        # картинку проверяем до брони и списания: чужая, просроченная или не к экрану — ничего не создаётся
        from app.services import city_ad_images as images_svc

        if spot.format != images_svc.FORMAT:
            raise CityAdError("Картинка — только для экрана на фасаде")
        try:
            await images_svc._own_fresh(session, user=user, image_id=image_id, now=images_svc._now())
        except images_svc.ImageError as e:
            raise CityAdError(str(e)) from e
    total = q.total_nano
    fresh = await balance_svc.get_user_for_update(session, user.id)
    if Decimal(fresh.balance) < _ton(total):
        raise CityAdFundsError(f"Недостаточно TON: нужно {q.total} TON")
    ad = CityAd(
        advertiser_id=user.id,
        spot_id=spot.id,
        format=spot.format,
        title=c.title,
        subtitle=c.subtitle,
        body=c.body,
        link_url=c.link_url,
        color=c.color,
        status="pending",
        start_day=q.start,
        end_day=q.end,
        days=q.days,
        price_day_nano=q.price_day_nano,
        total_nano=total,
        paid_nano=total,
        refunded_nano=0,
        revenue_nano=0,
    )
    try:
        async with session.begin_nested():
            session.add(ad)
            await session.flush()
            for i in range(q.days):
                session.add(CityAdDay(spot_id=spot.id, day=q.start + timedelta(days=i), ad_id=ad.id))
            await session.flush()
    except IntegrityError as e:
        # параллельная бронь успела занять хотя бы одни из этих суток
        raise CityAdBusyError("Эти сутки только что заняли — выберите другие даты") from e
    if image_id is not None:
        try:
            await images_svc.attach(session, user=user, image_id=image_id, ad=ad)
        except images_svc.ImageError as e:
            raise CityAdError(str(e)) from e
    await balance_svc.debit(
        session,
        user_id=user.id,
        amount=_ton(total),
        balance_type=PAY_TYPE,
        description=(
            f"Реклама в городе: {FORMAT_RU[spot.format]}, {_days_ru(q.days)} с {q.start:%d.%m} (объявление #{ad.id})"
        ),
        reference_type=REF_TYPE,
        reference_id=ad.id,
    )
    await session.refresh(ad)  # created_at/updated_at ставит база
    return ad


async def cancel(session: AsyncSession, *, user: User, ad_id: int) -> CityAd:
    """Отменить своё объявление до модерации — полный возврат, сутки освобождаются."""
    ad = await _lock_ad(session, ad_id)
    if ad.advertiser_id != user.id:
        raise CityAdNotFoundError("объявление не найдено")
    if ad.status != "pending" or ad.moderated_at is not None:
        raise CityAdError("Отменить можно только до проверки владельцем")
    await _refund(session, ad, held_nano(ad), "отмена до проверки")
    ad.status = "cancelled"
    ad.cancelled_at = _now()
    await _free_days(session, ad)
    await session.flush()
    return ad


async def edit_link(session: AsyncSession, *, user: User, ad_id: int, link_url: str | None, today: date | None = None) -> CityAd:
    """Сменить ссылку. Одобренное объявление снова уходит на модерацию и до одобрения не показывается."""
    today = today or game_day()
    ad = await _lock_ad(session, ad_id)
    if ad.advertiser_id != user.id:
        raise CityAdNotFoundError("объявление не найдено")
    if ad.status not in BUSY_STATUSES or ad.end_day < today:
        raise CityAdError("Ссылку можно менять только у действующего объявления")
    new = normalize_link(link_url)
    if new == ad.link_url:
        return ad
    ad.link_url = new
    ad.link_changed_at = _now()
    if ad.status == "approved":
        ad.status = "pending"
        ad.moderation_note = None
    await session.flush()
    return ad


async def approve(session: AsyncSession, *, owner: User, ad_id: int, today: date | None = None) -> CityAd:
    """Одобрить: объявление выходит в город в свои сутки; удержание становится доходом платформы."""
    today = today or game_day()
    ad = await _lock_ad(session, ad_id)
    if ad.status != "pending":
        raise CityAdError("Одобрить можно только объявление на проверке")
    if ad.end_day < today:
        raise CityAdError("Срок показа уже прошёл")
    ad.revenue_nano = int(ad.revenue_nano) + held_nano(ad)
    ad.status = "approved"
    ad.moderated_by_id = owner.id
    ad.moderated_at = _now()
    ad.moderation_note = None
    await session.flush()
    return ad


def unshown_days(ad: CityAd, today: date) -> int:
    """Сутки, которые ещё не показаны (сегодня — тоже: снятое объявление сегодня уже не видно)."""
    frm = max(ad.start_day, today)
    return max((ad.end_day - frm).days + 1, 0)


async def reject(
    session: AsyncSession, *, owner: User, ad_id: int, note: str | None = None, today: date | None = None
) -> CityAd:
    """Отклонить (на проверке) или снять (уже одобренное). Возврат на баланс, сутки освобождаются.

    Ни разу не одобренное — полный возврат. Уже показанное (одобрено, потом сменили ссылку, или снято владельцем) —
    возврат за непоказанные сутки, начиная с сегодняшних; показанные остаются доходом платформы.
    """
    today = today or game_day()
    note = _line(note, "Причина", NOTE_MAX, required=False)
    ad = await _lock_ad(session, ad_id)
    if ad.status not in BUSY_STATUSES:
        raise CityAdError("Объявление уже закрыто")
    held = held_nano(ad)
    take_back = min(int(ad.revenue_nano), int(ad.price_day_nano) * unshown_days(ad, today))
    ad.revenue_nano = int(ad.revenue_nano) - take_back
    await _refund(session, ad, held + take_back, "объявление отклонено" if held else "объявление снято")
    ad.status = "rejected"
    ad.moderated_by_id = owner.id
    ad.moderated_at = _now()
    ad.moderation_note = note
    await _free_days(session, ad)
    await session.flush()
    return ad


async def expire_once(session: AsyncSession, *, today: date | None = None) -> int:
    """Закрыть объявления с прошедшим сроком. Одобренные → expired. Так и не проверенные → expired с полным
    возвратом удержания и освобождением суток. Возвращает число закрытых."""
    today = today or game_day()
    ids = (
        await session.execute(
            select(CityAd.id).where(CityAd.status.in_(BUSY_STATUSES), CityAd.end_day < today).order_by(CityAd.id)
        )
    ).scalars().all()
    n = 0
    for ad_id in ids:
        ad = await _lock_ad(session, ad_id)
        if ad.status not in BUSY_STATUSES or ad.end_day >= today:
            continue
        if ad.status == "pending":
            await _refund(session, ad, held_nano(ad), "объявление не успели проверить")
            if not ad.moderation_note:
                ad.moderation_note = "Срок показа прошёл до проверки"
            await _free_days(session, ad)
        ad.status = "expired"
        n += 1
    await session.flush()
    return n


async def my_ads(session: AsyncSession, *, user: User) -> list[CityAd]:
    rows = await session.execute(
        select(CityAd).where(CityAd.advertiser_id == user.id).order_by(CityAd.created_at.desc(), CityAd.id.desc()).limit(100)
    )
    return list(rows.scalars().all())


async def moderation_queue(
    session: AsyncSession, *, status: str = "pending", limit: int = 100
) -> list[tuple[CityAd, CityAdSpot]]:
    if status not in AD_STATUSES_ALL:
        raise CityAdError("неизвестный статус")
    rows = await session.execute(
        select(CityAd, CityAdSpot)
        .join(CityAdSpot, CityAdSpot.id == CityAd.spot_id)
        .where(CityAd.status == status)
        .order_by(CityAd.start_day, CityAd.id)
        .limit(limit)
    )
    return [(a, k) for a, k in rows.all()]


async def revenue_total_nano(session: AsyncSession) -> int:
    """Доход платформы с рекламы за всё время, нанотоны."""
    v = await session.scalar(select(func.coalesce(func.sum(CityAd.revenue_nano), 0)))
    return int(v or 0)


# ── Статистика «Прогулки» (PR 3): показ / открытие карточки / переход ───────
#
# Счётчики пишутся только из режима «Прогулка» (клиент шлёт события лишь там). Одно событие вида на человека,
# объявление и сутки МСК (UNIQUE в city_ad_events); повторы не ошибка, а «не засчитано». Сверху — дневной
# потолок на человека, чтобы скрипт не раздувал таблицу.

EVENTS_PER_USER_DAY = 60


async def record_event(
    session: AsyncSession, *, user: User, ad_id: int, kind: str, today: date | None = None
) -> bool:
    """Засчитать событие. True — записано впервые сегодня; False — уже было (или дневной потолок)."""
    if kind not in AD_EVENT_KINDS:
        raise CityAdError("неизвестное событие")
    today = today or game_day()
    ad = await session.get(CityAd, ad_id)
    if not ad or ad.status != "approved" or not ad.start_day <= today <= ad.end_day:
        raise CityAdNotFoundError("объявление сейчас не показывается")
    seen = await session.scalar(
        select(CityAdEvent.id).where(
            CityAdEvent.ad_id == ad_id, CityAdEvent.user_id == user.id, CityAdEvent.day == today, CityAdEvent.kind == kind
        )
    )
    if seen:
        return False
    used = await session.scalar(
        select(func.count()).select_from(CityAdEvent).where(CityAdEvent.user_id == user.id, CityAdEvent.day == today)
    )
    if int(used or 0) >= EVENTS_PER_USER_DAY:
        return False
    try:
        async with session.begin_nested():
            session.add(CityAdEvent(ad_id=ad_id, user_id=user.id, day=today, kind=kind))
            await session.flush()
    except IntegrityError:
        return False  # параллельный такой же запрос успел первым
    return True


async def event_counts(session: AsyncSession, ad_ids: list[int]) -> dict[int, dict[str, int]]:
    """Счётчики по объявлениям: {ad_id: {impression, open, click}} (уникальные люди-сутки)."""
    out: dict[int, dict[str, int]] = {i: {k: 0 for k in AD_EVENT_KINDS} for i in ad_ids}
    if not ad_ids:
        return out
    rows = await session.execute(
        select(CityAdEvent.ad_id, CityAdEvent.kind, func.count())
        .where(CityAdEvent.ad_id.in_(ad_ids))
        .group_by(CityAdEvent.ad_id, CityAdEvent.kind)
    )
    for ad_id, kind, n in rows.all():
        out[ad_id][kind] = int(n)
    return out
