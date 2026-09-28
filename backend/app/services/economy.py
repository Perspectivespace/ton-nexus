"""Load economy_settings from DB with seed fallbacks."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.economy import EconomySetting
from app.services.economy_seed import DEFAULTS


async def get_setting(session: AsyncSession, key: str) -> Any:
    row = await session.scalar(select(EconomySetting).where(EconomySetting.key == key))
    if row:
        return json.loads(row.value_json)
    if key in DEFAULTS:
        return DEFAULTS[key][0]
    raise KeyError(f"economy setting missing: {key}")


def dec(value: Any) -> Decimal:
    return Decimal(str(value))
