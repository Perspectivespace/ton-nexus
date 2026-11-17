"""Сбор ошибок клиента (P6): очистка, группировка по отпечатку, лимит частоты, крючок для оповещений.

Оповещения в закрытый Telegram-чат появятся отдельным PR: подключаются через ``on_new_error`` —
функция получает новую (впервые увиденную) ошибку после записи в базу. Сбой крючка запись не ломает.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
from collections import deque
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.client_error import ClientError

log = logging.getLogger(__name__)

KINDS = ("error", "rejection", "render")
MAX_MESSAGE, MAX_STACK, MAX_ROUTE, MAX_BUILD, MAX_PLATFORM = 500, 4000, 120, 40, 120

# ── очистка: то, чего в журнале быть не должно ──
_SCRUB: list[tuple[re.Pattern[str], str]] = [
    # initData / tgWebAppData / подписи и токены в адресах и тексте
    (re.compile(r"(tgWebAppData|initData|init_data|query_id|auth_date|hash|signature|token|access_token|key|password|user)=[^&\s\"']*", re.I), r"\1=<скрыто>"),
    (re.compile(r"(X-Telegram-Init-Data|Authorization)\s*[:=]\s*\S+", re.I), r"\1: <скрыто>"),
    (re.compile(r"\bbot\d+:[A-Za-z0-9_-]{20,}"), "<токен>"),
    # адреса TON: user-friendly (EQ/UQ/kQ/0Q + 46 символов) и raw (0:/-1: + 64 hex)
    (re.compile(r"\b[EUk0]Q[A-Za-z0-9_-]{46}\b"), "<адрес>"),
    (re.compile(r"(?<![\w])-?[01]:[0-9a-fA-F]{64}\b"), "<адрес>"),
    # длинные hex / base64 — хэши, ключи, подписи
    (re.compile(r"\b[0-9a-fA-F]{32,}\b"), "<hex>"),
    (re.compile(r"[A-Za-z0-9+/_-]{40,}={0,2}"), "<blob>"),
    # почта и телефоны
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "<email>"),
    # суммы и балансы: десятичные числа; длинные целые (id, суммы в нано)
    (re.compile(r"(?<![\w.])\d+[.,]\d+(?![\w.])"), "<n>"),
    (re.compile(r"(?<![\w])\d{5,}(?![\w])"), "<n>"),
]
_QUERY = re.compile(r"(https?://[^\s?#\"')]+)[?#][^\s\"')]*")


def scrub(text: str | None, limit: int) -> str:
    if not text:
        return ""
    s = str(text)[: limit * 2]
    s = _QUERY.sub(r"\1", s)  # строку запроса и хэш у адресов отбрасываем целиком
    for rx, rep in _SCRUB:
        s = rx.sub(rep, s)
    return s[:limit].strip()


_META = re.compile(r"[^A-Za-z0-9 ._/-]")


def scrub_meta(text: str | None, limit: int) -> str:
    """Сборка, платформа: только безопасные символы (версии вида 8.0 оставляем)."""
    return _META.sub("", str(text or ""))[:limit].strip()


USERS_CAP = 100


def _add_user(row: ClientError, user_id: int | None) -> None:
    if user_id is None:
        return
    ids = [x for x in (row.user_ids or "").split(",") if x]
    if str(user_id) in ids or len(ids) >= USERS_CAP:
        return
    ids.append(str(user_id))
    row.user_ids = ",".join(ids)
    row.users = len(ids)


def _first_frame(stack: str) -> str:
    for line in stack.splitlines():
        line = line.strip()
        if line and ("at " in line or "@" in line):
            # номер колонки/строки и хэш чанка в имени файла меняются от сборки к сборке — не учитываем
            return re.sub(r"-[A-Za-z0-9_]{6,}\.js", ".js", re.sub(r":\d+(:\d+)?\)?$", "", line))
    return ""


def fingerprint(kind: str, message: str, stack: str) -> str:
    base = f"{kind}|{message[:200]}|{_first_frame(stack)}"
    return hashlib.sha256(base.encode()).hexdigest()


# ── лимит частоты (в памяти процесса): на игрока и общий ──
PER_USER, PER_USER_WINDOW = 20, 600.0  # не больше 20 отчётов за 10 минут от одного игрока
GLOBAL, GLOBAL_WINDOW = 600, 60.0  # и 600 в минуту на всех — защита базы от лавины
_buckets: dict[str, deque] = {}


def allow(key: str, now: float | None = None) -> bool:
    now = time.monotonic() if now is None else now
    for k, cap, win in ((f"u:{key}", PER_USER, PER_USER_WINDOW), ("*", GLOBAL, GLOBAL_WINDOW)):
        q = _buckets.setdefault(k, deque())
        while q and now - q[0] > win:
            q.popleft()
        if len(q) >= cap:
            return False
    for k in (f"u:{key}", "*"):
        _buckets[k].append(now)
    if len(_buckets) > 5000:  # не копим ключи бесконечно
        for k in [k for k, q in _buckets.items() if not q or now - q[-1] > PER_USER_WINDOW][:2500]:
            _buckets.pop(k, None)
    return True


def reset_limits() -> None:
    _buckets.clear()


# ── крючок оповещений (Telegram — отдельный PR) ──
AlertHook = Callable[[ClientError], Awaitable[None]]
_hooks: list[AlertHook] = []


def on_new_error(fn: AlertHook) -> AlertHook:
    """Зарегистрировать обработчик новой ошибки (первый случай отпечатка). Можно как декоратор."""
    _hooks.append(fn)
    return fn


async def _notify(row: ClientError) -> None:
    for fn in list(_hooks):
        try:
            await fn(row)
        except Exception:  # оповещение не должно ломать приём ошибок
            log.exception("client error hook failed")


async def record(
    db: AsyncSession,
    *,
    kind: str,
    message: str,
    stack: str | None = None,
    route: str | None = None,
    build: str | None = None,
    platform: str | None = None,
    user_id: int | None = None,
    now: datetime | None = None,
) -> tuple[ClientError, bool]:
    """Записать случай: новая строка или +1 к существующей. Возвращает (строка, новая ли)."""
    kind = kind if kind in KINDS else "error"
    msg = scrub(message, MAX_MESSAGE) or "(без сообщения)"
    st = scrub(stack, MAX_STACK) or None
    fp = fingerprint(kind, msg, st or "")
    now = now or datetime.now(timezone.utc)
    row = (await db.execute(select(ClientError).where(ClientError.fingerprint == fp))).scalar_one_or_none()
    new = row is None
    if new:
        row = ClientError(
            fingerprint=fp, kind=kind, message=msg, stack=st,
            route=scrub(route, MAX_ROUTE) or None, build=scrub_meta(build, MAX_BUILD) or None,
            platform=scrub_meta(platform, MAX_PLATFORM) or None,
            count=1, users=0, first_seen_at=now, last_seen_at=now,
        )
        _add_user(row, user_id)
        db.add(row)
    else:
        row.count += 1
        _add_user(row, user_id)
        row.last_seen_at = now
        if build:
            row.build = scrub_meta(build, MAX_BUILD) or row.build
        if route:
            row.route = scrub(route, MAX_ROUTE) or row.route
    await db.commit()
    if new:
        await _notify(row)
    return row, new


def _iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat()


def row_out(r: ClientError, with_stack: bool = False) -> dict:
    out = {
        "id": r.id, "kind": r.kind, "message": r.message, "route": r.route, "build": r.build,
        "platform": r.platform, "count": r.count, "users": r.users,
        "first_seen_at": _iso(r.first_seen_at), "last_seen_at": _iso(r.last_seen_at),
    }
    if with_stack:
        out["stack"] = r.stack
    return out


async def summary(db: AsyncSession, limit: int = 50, now: datetime | None = None) -> dict:
    from datetime import timedelta

    now = now or datetime.now(timezone.utc)
    day = now - timedelta(days=1)
    week = now - timedelta(days=7)
    total = (await db.execute(select(func.count(), func.coalesce(func.sum(ClientError.count), 0)))).one()
    d_cnt = (await db.execute(select(func.count()).where(ClientError.last_seen_at >= day))).scalar_one()
    w_cnt = (await db.execute(select(func.count()).where(ClientError.last_seen_at >= week))).scalar_one()
    rows = (await db.execute(select(ClientError).order_by(ClientError.last_seen_at.desc()).limit(limit))).scalars().all()
    return {
        "groups": int(total[0]), "events": int(total[1]), "groups_24h": int(d_cnt), "groups_7d": int(w_cnt),
        "items": [row_out(r) for r in rows],
    }


async def clear(db: AsyncSession, error_id: int | None = None) -> int:
    from sqlalchemy import delete

    q = delete(ClientError)
    if error_id is not None:
        q = q.where(ClientError.id == error_id)
    res = await db.execute(q)
    await db.commit()
    return int(res.rowcount or 0)
