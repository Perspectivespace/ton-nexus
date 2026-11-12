"""Promo code redemption."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.promo import PromoCode, PromoRedemption
from app.models.secret_promo import SecretPromoClaim
from app.models.user import User
from app.services import balance as balance_svc
from app.services.levels import add_xp
from app.services import secret_promo as secret_svc
from app.services.roles import is_admin, is_platform_owner


class PromoError(Exception):
    pass


class PromoPermissionError(PromoError):
    pass


class PromoInvalid(PromoError):
    """Неверный ввод: кода нет, он выключен или (секретный) вне окна. Один и тот же ответ — время не раскрывается."""

    def __init__(self) -> None:
        super().__init__("invalid or inactive code")


class PromoRateLimited(PromoError):
    pass


@dataclass
class PromoResult:
    code: str
    reward_ton: Decimal
    reward_xp: int
    reward_focus: int


async def redeem(session: AsyncSession, *, user: User, code: str) -> PromoResult:
    code_norm = code.strip().upper()
    if not code_norm:
        raise PromoError("empty code")
    if await secret_svc.too_many_failures(session, user.id):
        raise PromoRateLimited("too many attempts")

    promo = await session.scalar(
        select(PromoCode).where(PromoCode.code == code_norm).with_for_update()
    )
    if not promo or not promo.is_active:
        raise PromoInvalid()
    # секретный код «Прогулки»: только пока виден и GRACE после; иначе — как несуществующий
    camp = await secret_svc.campaign_for(session, promo.id)
    if camp is not None and not await secret_svc.in_window(session, camp):
        raise PromoInvalid()

    if promo.expires_at:
        exp = promo.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > exp:
            raise PromoError("code expired")

    if promo.max_uses is not None and promo.used_count >= promo.max_uses:
        raise PromoError("code fully used")

    already = await session.scalar(
        select(PromoRedemption.id).where(
            PromoRedemption.promo_id == promo.id,
            PromoRedemption.user_id == user.id,
        )
    )
    if already:
        raise PromoError("already redeemed")

    if camp is not None:
        # одна активация на игрока в кампании: уникальный ключ ловит гонку двух одновременных вводов
        try:
            async with session.begin_nested():
                session.add(SecretPromoClaim(campaign_id=camp.id, user_id=user.id))
                await session.flush()
        except IntegrityError as e:
            raise PromoError("already redeemed") from e
    # лимит активаций — условным UPDATE: два одновременных ввода не проскочат за max_uses
    res = await session.execute(
        update(PromoCode)
        .where(PromoCode.id == promo.id, or_(PromoCode.max_uses.is_(None), PromoCode.used_count < PromoCode.max_uses))
        .values(used_count=PromoCode.used_count + 1)
        .execution_options(synchronize_session=False)
    )
    if res.rowcount != 1:
        raise PromoError("code fully used")
    await session.refresh(promo, ["used_count"])

    ton = Decimal(promo.reward_ton or 0)
    xp = int(promo.reward_xp or 0)
    focus = int(promo.reward_focus or 0)

    if ton > 0:
        await balance_svc.credit(
            session,
            user_id=user.id,
            amount=ton,
            balance_type="promo",
            description=f"Промо {code_norm}",
            reference_type="promo",
            reference_id=promo.id,
        )
    if xp > 0:
        await add_xp(session, user, xp, "promo")
    if focus > 0:
        user.focus_tokens = int(user.focus_tokens or 0) + focus

    session.add(PromoRedemption(promo_id=promo.id, user_id=user.id))
    await session.flush()

    return PromoResult(code=code_norm, reward_ton=ton, reward_xp=xp, reward_focus=focus)


async def create_promo(
    session: AsyncSession,
    *,
    actor: User,
    code: str,
    reward_ton: Decimal = Decimal("0"),
    reward_xp: int = 0,
    reward_focus: int = 0,
    max_uses: int | None = None,
    expires_at: datetime | None = None,
) -> PromoCode:
    if not is_platform_owner(actor) and not is_admin(actor):
        raise PromoPermissionError("admin or owner required")
    code_norm = code.strip().upper()
    if len(code_norm) < 3:
        raise PromoError("code too short")
    exists = await session.scalar(select(PromoCode.id).where(PromoCode.code == code_norm))
    if exists:
        raise PromoError("code already exists")

    row = PromoCode(
        code=code_norm,
        reward_ton=reward_ton,
        reward_xp=reward_xp,
        reward_focus=reward_focus,
        max_uses=max_uses,
        used_count=0,
        is_active=True,
        expires_at=expires_at,
    )
    session.add(row)
    await session.flush()
    return row
