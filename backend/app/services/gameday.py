"""Игровой день: единая граница суток для ежедневной отметки, бесплатных вращений колеса и «сегодня» в статистике.

Новый день начинается в 00:00 по Москве. Москва без перехода на летнее время с 2014 г., поэтому
используется фиксированный сдвиг UTC+3: так не нужен пакет tzdata на сервере (в slim-образах
и на Windows его может не быть, и тогда zoneinfo("Europe/Moscow") падает).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

MSK = timezone(timedelta(hours=3), "MSK")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    # наивное время из БД/тестов считаем UTC (так пишет сервер)
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def game_day(now: datetime | None = None) -> date:
    """Игровой день (дата по Москве) для момента `now`."""
    return _aware(now or now_utc()).astimezone(MSK).date()


def day_start(day: date) -> datetime:
    """Начало игрового дня `day` (00:00 МСК) в UTC."""
    return datetime.combine(day, time(0), tzinfo=MSK).astimezone(timezone.utc)


def day_start_of(now: datetime | None = None) -> datetime:
    """Начало текущего игрового дня в UTC."""
    return day_start(game_day(now))


def reset_after(day: date) -> datetime:
    """Начало игрового дня, следующего за `day`, в UTC."""
    return day_start(day + timedelta(days=1))


def next_reset(now: datetime | None = None) -> datetime:
    """Ближайшие 00:00 МСК (в UTC) — с этого момента снова можно отметиться и крутить бесплатно."""
    return reset_after(game_day(now))
