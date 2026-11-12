"""История баланса текущего пользователя (экран «Кошелёк» → «История»)."""

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.i18n import user_lang
from app.core.messages import localize, request_lang
from app.db.session import get_db
from app.models.user import User
from app.services import balance_history as bh

router = APIRouter(prefix="/balance", tags=["balance"])


@router.get("/history")
async def balance_history(
    filter: str = Query("all"),
    cursor: int | None = Query(None, ge=1),
    limit: int = Query(bh.PAGE_SIZE, ge=1, le=bh.MAX_PAGE_SIZE),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_lang: str | None = Header(None),
):
    """Операции по балансу, новые сверху. Страница по `cursor` (id последней строки прошлой страницы).

    filter: all | deposits | withdrawals | earnings | spending. `pending` — только на первой странице:
    пополнения, которые сеть видела, но ещё не зачислены.
    """
    if filter not in bh.FILTERS:
        raise HTTPException(status_code=400, detail="unknown filter")
    page = await bh.history(db, user_id=user.id, flt=filter, cursor=cursor, limit=limit)
    lang = request_lang(x_lang) or user_lang(user)
    return {"items": _localized(page.items, lang), "next_cursor": page.next_cursor, "pending": _localized(page.pending, lang)}


def _localized(items: list[dict], lang: str) -> list[dict]:
    """Подписи, статус и служебная деталь — на языке игрока; детали с текстом игрока (код, название) — как есть."""
    return [
        {**it, **{k: localize(it[k], lang) for k in ("label", "status_label", "detail") if isinstance(it.get(k), str)}}
        for it in items
    ]
