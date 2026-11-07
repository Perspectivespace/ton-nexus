"""Реклама в городе — места, тариф `city_ads`, расчёт цены и свободных дат, проверка текста и ссылки.

PR 1: только расчёт. Бронирование, оплата с баланса, модерация и возвраты — следующим PR.

Форматы и места (координаты — во фронтенде, кадр 720×1280):
- ``line``   «Бегущая строка» — LED-полоса на реакторной башне (tower_line);
- ``banner`` «Голо-баннер» — две голо-панели на фасадах (banner_sky, banner_street);
- ``neon``   «Неоновая вывеска» — две вывески (neon_left, neon_right).

Сутки — по МСК (app.services.gameday). Одно объявление на место в сутки (city_ad_days, UNIQUE(spot, day)).
Начать показ можно не раньше завтрашнего дня (до начала владелец успевает проверить объявление)
и не позже чем через MAX_AHEAD_DAYS дней. Суммы считаются в целых нанотонах.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.city_ad import CityAd, CityAdDay, CityAdSpot
from app.models.user import User
from app.services.economy import get_setting
from app.services.economy_seed import DEFAULTS
from app.services.gameday import game_day
from app.services.task_tariff import TaskTariffError, nano_to_ton, ton_to_nano

KEY = "city_ads"
FORMATS = ("line", "banner", "neon")
FORMAT_RU = {"line": "Бегущая строка", "banner": "Голо-баннер", "neon": "Неоновая вывеска"}

# места: ключ, формат, подпись, порядок (то же сеет миграция 018)
SPOTS: tuple[tuple[str, str, str, int], ...] = (
    ("tower_line", "line", "Бегущая строка на реакторной башне", 10),
    ("banner_sky", "banner", "Голо-баннер над площадью", 20),
    ("banner_street", "banner", "Голо-баннер у мостовой", 30),
    ("neon_left", "neon", "Неоновая вывеска слева", 40),
    ("neon_right", "neon", "Неоновая вывеска справа", 50),
)
SPOT_KEYS = tuple(s[0] for s in SPOTS)

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


# ── Настройка city_ads ─────────────────────────────────────────────────────────


def _int(v: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise CityAdError(f"{name}: целое число")
    if not lo <= v <= hi:
        raise CityAdError(f"{name}: от {lo} до {hi}")
    return v


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
        raw = spots.get(key, DEFAULT["spots"][key])
        if not isinstance(raw, dict):
            raise CityAdError(f"{key}: нужен объект")
        if set(raw) - {"price_day", "enabled"}:
            raise CityAdError(f"{key}: лишние поля {sorted(set(raw) - {'price_day', 'enabled'})}")
        try:
            nano = ton_to_nano(raw.get("price_day", DEFAULT["spots"][key]["price_day"]), name=f"{key} · цена за сутки")
        except TaskTariffError as e:
            raise CityAdError(str(e)) from e
        if nano > MAX_PRICE_NANO:
            raise CityAdError(f"{key} · цена за сутки: не больше 1000 TON")
        enabled = raw.get("enabled", True)
        if not isinstance(enabled, bool):
            raise CityAdError(f"{key} · продаётся: да/нет")
        out["spots"][key] = {"price_day": nano_to_ton(nano), "enabled": enabled}

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


def price_nano(cfg: dict[str, Any], spot_key: str, days: int) -> tuple[int, int]:
    """(цена за сутки, итого) в нанотонах."""
    per_day = ton_to_nano(cfg["spots"][spot_key]["price_day"], name="цена за сутки")
    return per_day, per_day * int(days)


# ── Места ─────────────────────────────────────────────────────────────────────


async def ensure_spots(session: AsyncSession) -> int:
    """Добавить недостающие места (то же делает миграция 018; нужно тестам и локальному запуску без alembic)."""
    have = set((await session.execute(select(CityAdSpot.key))).scalars().all())
    n = 0
    for key, fmt, title, sort in SPOTS:
        if key not in have:
            session.add(CityAdSpot(key=key, format=fmt, title=title, sort=sort, enabled=True))
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
        if fmt != "banner":
            raise CityAdError("Подпись бывает только у баннера")
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
) -> Quote:
    """Цена и свободные даты для брони. Всё пересчитывается на сервере из тарифа и занятых дней."""
    cfg = await load_config(session)
    if int(user.level or 1) < cfg["min_level"]:
        raise CityAdPermissionError(f"Реклама в городе доступна с {cfg['min_level']}-го уровня")
    spot = await _spot(session, spot_key)
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
    checked = validate_content(cfg, spot.format, content) if content is not None else None
    return Quote(
        spot_key=spot.key,
        format=spot.format,
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


async def board(session: AsyncSession, *, today: date | None = None) -> dict[str, Any]:
    """Что показывать в городе сегодня (МСК): места, цены, одобренные объявления. Без персональных данных."""
    cfg = await load_config(session)
    today = today or game_day()
    spots = (await session.execute(select(CityAdSpot).order_by(CityAdSpot.sort, CityAdSpot.id))).scalars().all()
    rows = await session.execute(
        select(CityAdDay.spot_id, CityAd)
        .join(CityAd, CityAd.id == CityAdDay.ad_id)
        .where(CityAdDay.day == today, CityAd.status == "approved")
    )
    ads = {spot_id: ad for spot_id, ad in rows.all()}
    out = []
    for s in spots:
        ad = ads.get(s.id) if s.enabled else None
        out.append(
            {
                "key": s.key,
                "format": s.format,
                "title": s.title,
                "on_sale": spot_on_sale(cfg, s),
                "price_day": cfg["spots"].get(s.key, {}).get("price_day"),
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
                },
            }
        )
    return {
        "day": today.isoformat(),
        "spots": out,
        "palette": PALETTE,
        "min_level": cfg["min_level"],
        "min_days": cfg["min_days"],
        "max_days": cfg["max_days"],
        "body_max": cfg["body_max"],
        "limits": cfg["limits"],
    }
