"""Ошибки клиента (P6): приём отчётов из Mini App и просмотр владельцем."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import client_errors as svc
from app.services.roles import is_platform_owner

router = APIRouter(prefix="/client-errors", tags=["client-errors"])


class ReportIn(BaseModel):
    kind: str = Field(default="error", max_length=16)
    message: str = Field(default="", max_length=2000)
    stack: str | None = Field(default=None, max_length=8000)
    route: str | None = Field(default=None, max_length=300)
    build: str | None = Field(default=None, max_length=80)
    platform: str | None = Field(default=None, max_length=200)


async def _optional_user(x_telegram_init_data: str | None, db: AsyncSession) -> User | None:
    """Ошибка могла случиться до входа (нет или протух initData) — такой отчёт принимаем без игрока."""
    try:
        return await get_current_user(x_telegram_init_data, db)
    except HTTPException:
        return None


@router.post("", status_code=204)
async def report(
    body: ReportIn,
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    user = await _optional_user(x_telegram_init_data, db)
    # сверх лимита — тихо 204: клиенту незачем знать, а повторять он всё равно не будет
    if svc.allow(str(user.id) if user else "anon"):
        await svc.record(db, kind=body.kind, message=body.message, stack=body.stack, route=body.route,
                         build=body.build, platform=body.platform, user_id=user.id if user else None)
    return Response(status_code=204)


def _require_owner(user: User) -> None:
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="owner only")


@router.get("")
async def summary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_owner(user)
    return await svc.summary(db)


@router.get("/{error_id}")
async def detail(error_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_owner(user)
    from app.models.client_error import ClientError

    row = await db.get(ClientError, error_id)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return svc.row_out(row, with_stack=True)


@router.delete("")
async def clear_all(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, int]:
    _require_owner(user)
    return {"deleted": await svc.clear(db)}


@router.delete("/{error_id}")
async def clear_one(error_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, int]:
    _require_owner(user)
    return {"deleted": await svc.clear(db, error_id)}
