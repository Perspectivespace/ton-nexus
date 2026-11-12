"""Секретный промокод в «Прогулке» — пасхалка без анонсов.

Владелец заводит кампанию: код, награда TON, всего активаций, дней, появлений в сутки. Сервер сразу разыгрывает
расписание криптостойким генератором (secrets): в каждые сутки кампании — per_day появлений в случайное время
(любой час дня и ночи), в случайной локации (Центр, «Неон-ряды», «Порт»), длительностью 3–10 минут.

Расписание не уходит клиентам и не показывается владельцу: клиент спрашивает «что видно здесь сейчас» и получает
код только пока появление идёт в этой локации. Ввод — в обычном разделе «Промокод» (services/promo.redeem):
пока код виден и ещё GRACE после конца появления; вне окна — тот же ответ, что на несуществующий код.
Активация — одна на игрока в кампании (уникальный ключ), начисление TON — через журнал баланса.
"""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.promo import PromoCode
from app.models.secret_promo import PromoFailedAttempt, SecretPromoAppearance, SecretPromoCampaign, SecretPromoClaim
from app.models.user import User
from app.services.roles import is_platform_owner
from app.services.task_tariff import TaskTariffError, nano_to_ton, ton_to_nano

DISTRICTS = ("centre", "rows", "port")
DAY = timedelta(days=1)
MIN_SECONDS = 3 * 60
MAX_SECONDS = 10 * 60
GRACE = timedelta(minutes=10)  # ввод после конца появления
MAX_DAYS = 60
MAX_PER_DAY = 24
MAX_USES = 100_000
MAX_REWARD_NANO = 1000 * 10**9
CODE_RE = re.compile(r"^[A-Z0-9-]{4,16}$")
# перебор: не больше FAIL_LIMIT неверных вводов за FAIL_WINDOW
FAIL_LIMIT = 5
FAIL_WINDOW = timedelta(minutes=10)


class SecretPromoError(Exception):
    pass


class SecretPromoPermissionError(SecretPromoError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class Slot:
    district: str
    starts_at: datetime
    ends_at: datetime


def draw_schedule(start: datetime, days: int, per_day: int, *, randbelow=None) -> list[Slot]:
    """Расписание: в каждые сутки [start + d, start + d + 1 сут) — per_day появлений целиком внутри суток.

    Время — равномерно по секундам суток, длительность — 3–10 мин (включительно), локация — равновероятно."""
    randbelow = randbelow or secrets.randbelow  # CSPRNG; подмена — только в тестах границ
    out: list[Slot] = []
    span = int(DAY.total_seconds())
    for d in range(days):
        day0 = start + d * DAY
        for _ in range(per_day):
            dur = MIN_SECONDS + randbelow(MAX_SECONDS - MIN_SECONDS + 1)
            at = day0 + timedelta(seconds=randbelow(span - dur + 1))
            out.append(Slot(DISTRICTS[randbelow(len(DISTRICTS))], at, at + timedelta(seconds=dur)))
    out.sort(key=lambda s: s.starts_at)
    return out


def normalize_code(code: str) -> str:
    return (code or "").strip().upper()


async def create_campaign(
    session: AsyncSession,
    *,
    actor: User,
    code: str,
    reward_ton: str,
    max_uses: int,
    days: int,
    per_day: int,
    now: datetime | None = None,
) -> SecretPromoCampaign:
    if not is_platform_owner(actor):
        raise SecretPromoPermissionError("Только владелец")
    code_n = normalize_code(code)
    if not CODE_RE.match(code_n):
        raise SecretPromoError("Код: 4–16 символов, латиница, цифры и дефис")
    try:
        nano = ton_to_nano(reward_ton, name="Награда")
    except TaskTariffError as e:
        raise SecretPromoError(str(e)) from e
    if nano > MAX_REWARD_NANO:
        raise SecretPromoError("Награда: не больше 1000 TON")
    for v, name, hi in ((max_uses, "Всего активаций", MAX_USES), (days, "Дней", MAX_DAYS), (per_day, "Появлений в сутки", MAX_PER_DAY)):
        if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= hi:
            raise SecretPromoError(f"{name}: от 1 до {hi}")
    if await session.scalar(select(PromoCode.id).where(PromoCode.code == code_n)):
        raise SecretPromoError("Такой код уже есть")

    now = now or _now()
    ends = now + days * DAY
    promo = PromoCode(
        code=code_n, reward_ton=Decimal(nano_to_ton(nano)), reward_xp=0, reward_focus=0,
        max_uses=max_uses, used_count=0, is_active=True, expires_at=ends + GRACE,
    )
    session.add(promo)
    await session.flush()
    camp = SecretPromoCampaign(promo_id=promo.id, days=days, per_day=per_day, starts_at=now, ends_at=ends, created_by=actor.id)
    session.add(camp)
    await session.flush()
    session.add_all(
        SecretPromoAppearance(campaign_id=camp.id, district=s.district, starts_at=s.starts_at, ends_at=s.ends_at)
        for s in draw_schedule(now, days, per_day)
    )
    await session.flush()
    return camp


def _live(now: datetime):
    """Кампания идёт: не выключена, промокод активен, активации не кончились."""
    return and_(
        SecretPromoCampaign.disabled_at.is_(None),
        PromoCode.is_active.is_(True),
        (PromoCode.max_uses.is_(None)) | (PromoCode.used_count < PromoCode.max_uses),
    )


async def visible_code(session: AsyncSession, *, user: User, district: str, now: datetime | None = None) -> str | None:
    """Код, который сейчас виден в локации district, или None. Уже активировавшим — None (видна следующая кампания)."""
    if district not in DISTRICTS:
        return None
    now = now or _now()
    claimed = select(SecretPromoClaim.campaign_id).where(SecretPromoClaim.user_id == user.id)
    return await session.scalar(
        select(PromoCode.code)
        .join(SecretPromoCampaign, SecretPromoCampaign.promo_id == PromoCode.id)
        .join(SecretPromoAppearance, SecretPromoAppearance.campaign_id == SecretPromoCampaign.id)
        .where(
            _live(now),
            SecretPromoAppearance.district == district,
            SecretPromoAppearance.starts_at <= now,
            SecretPromoAppearance.ends_at > now,
            SecretPromoCampaign.id.not_in(claimed),
        )
        .order_by(SecretPromoCampaign.id)
        .limit(1)
    )


async def campaign_for(session: AsyncSession, promo_id: int) -> SecretPromoCampaign | None:
    return await session.scalar(select(SecretPromoCampaign).where(SecretPromoCampaign.promo_id == promo_id))


async def in_window(session: AsyncSession, camp: SecretPromoCampaign, now: datetime | None = None) -> bool:
    """Ввод открыт: кампания не выключена и есть появление, которое идёт сейчас или кончилось не раньше GRACE назад."""
    if camp.disabled_at is not None:
        return False
    now = now or _now()
    hit = await session.scalar(
        select(SecretPromoAppearance.id).where(
            SecretPromoAppearance.campaign_id == camp.id,
            SecretPromoAppearance.starts_at <= now,
            SecretPromoAppearance.ends_at >= now - GRACE,
        ).limit(1)
    )
    return hit is not None


async def too_many_failures(session: AsyncSession, user_id: int, now: datetime | None = None) -> bool:
    now = now or _now()
    n = await session.scalar(
        select(func.count(PromoFailedAttempt.id)).where(
            PromoFailedAttempt.user_id == user_id, PromoFailedAttempt.created_at > now - FAIL_WINDOW
        )
    )
    return int(n or 0) >= FAIL_LIMIT


async def record_failure(session: AsyncSession, user_id: int, now: datetime | None = None) -> None:
    now = now or _now()
    session.add(PromoFailedAttempt(user_id=user_id, created_at=now))
    # старые записи не копим: всё старше суток — удалить
    await session.execute(
        PromoFailedAttempt.__table__.delete().where(PromoFailedAttempt.created_at < now - DAY)
    )
    await session.flush()


@dataclass
class CampaignStats:
    id: int
    code: str
    reward_ton: str
    max_uses: int
    used_count: int
    days: int
    per_day: int
    appearances_total: int
    appearances_done: int
    status: str  # active | exhausted | finished | disabled
    created_at: datetime
    ends_at: datetime


async def list_campaigns(session: AsyncSession, *, actor: User, now: datetime | None = None) -> list[CampaignStats]:
    """Для админки: только счётчики, без времени и мест появлений."""
    if not is_platform_owner(actor):
        raise SecretPromoPermissionError("Только владелец")
    now = now or _now()
    rows = (
        await session.execute(
            select(SecretPromoCampaign, PromoCode)
            .join(PromoCode, PromoCode.id == SecretPromoCampaign.promo_id)
            .order_by(SecretPromoCampaign.id.desc())
        )
    ).all()
    out: list[CampaignStats] = []
    for camp, promo in rows:
        total = await session.scalar(select(func.count(SecretPromoAppearance.id)).where(SecretPromoAppearance.campaign_id == camp.id))
        done = await session.scalar(
            select(func.count(SecretPromoAppearance.id)).where(
                SecretPromoAppearance.campaign_id == camp.id, SecretPromoAppearance.starts_at <= now
            )
        )
        if camp.disabled_at is not None or not promo.is_active:
            status = "disabled"
        elif promo.max_uses is not None and promo.used_count >= promo.max_uses:
            status = "exhausted"
        elif _utc(camp.ends_at) <= now:
            status = "finished"
        else:
            status = "active"
        out.append(
            CampaignStats(
                id=camp.id, code=promo.code, reward_ton=nano_to_ton(ton_to_nano(str(promo.reward_ton))),
                max_uses=int(promo.max_uses or 0), used_count=int(promo.used_count or 0), days=camp.days, per_day=camp.per_day,
                appearances_total=int(total or 0), appearances_done=int(done or 0), status=status,
                created_at=_utc(camp.created_at), ends_at=_utc(camp.ends_at),
            )
        )
    return out


async def disable(session: AsyncSession, *, actor: User, campaign_id: int, now: datetime | None = None) -> None:
    if not is_platform_owner(actor):
        raise SecretPromoPermissionError("Только владелец")
    camp = await session.get(SecretPromoCampaign, campaign_id)
    if camp is None:
        raise SecretPromoError("Кампания не найдена")
    if camp.disabled_at is None:
        camp.disabled_at = now or _now()
        promo = await session.get(PromoCode, camp.promo_id)
        if promo is not None:
            promo.is_active = False
    await session.flush()
