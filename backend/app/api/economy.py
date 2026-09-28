"""Owner economy cabinet API."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.economy_admin import (
    SETTING_CATALOG,
    EconomyAdminError,
    bulk_set,
    get_setting_admin,
    list_settings,
    set_setting,
)
from app.services.roles import is_platform_owner

router = APIRouter(prefix="/economy", tags=["economy"])


def _require_owner(user: User) -> None:
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="owner only")


class SettingOut(BaseModel):
    key: str
    value: Any
    description: str | None = None
    group: str | None = None
    label: str | None = None


class SettingUpdateBody(BaseModel):
    value: Any
    description: str | None = None


class BulkUpdateBody(BaseModel):
    updates: dict[str, Any] = Field(
        ...,
        description='Map key → JSON value',
    )


def _enrich(key: str, value: Any, description: str | None) -> SettingOut:
    meta = next((c for c in SETTING_CATALOG if c["key"] == key), None)
    return SettingOut(
        key=key,
        value=value,
        description=description,
        group=meta["group"] if meta else "custom",
        label=meta["label"] if meta else key,
    )


@router.get("/settings", response_model=list[SettingOut])
async def get_all_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_owner(user)
    items = await list_settings(db)
    await db.commit()
    return [_enrich(i.key, i.value, i.description) for i in items]


@router.get("/settings/{key}", response_model=SettingOut)
async def get_one_setting(
    key: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_owner(user)
    try:
        item = await get_setting_admin(db, key)
        await db.commit()
        return _enrich(item.key, item.value, item.description)
    except EconomyAdminError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.put("/settings/{key}", response_model=SettingOut)
async def put_setting(
    key: str,
    body: SettingUpdateBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_owner(user)
    try:
        item = await set_setting(db, key=key, value=body.value, description=body.description)
        await db.commit()
        return _enrich(item.key, item.value, item.description)
    except EconomyAdminError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/settings", response_model=list[SettingOut])
async def put_bulk(
    body: BulkUpdateBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_owner(user)
    try:
        items = await bulk_set(db, body.updates)
        await db.commit()
        return [_enrich(i.key, i.value, i.description) for i in items]
    except EconomyAdminError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/catalog")
async def catalog(user: User = Depends(get_current_user)):
    _require_owner(user)
    return {"groups": SETTING_CATALOG}
