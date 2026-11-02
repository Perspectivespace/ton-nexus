"""История баланса текущего пользователя (экран «Кошелёк» → «История»)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
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
):
    """Операции по балансу, новые сверху. Страница по `cursor` (id последней строки прошлой страницы).

    filter: all | deposits | withdrawals | earnings | spending. `pending` — только на первой странице:
    пополнения, которые сеть видела, но ещё не зачислены.
    """
    if filter not in bh.FILTERS:
        raise HTTPException(status_code=400, detail="unknown filter")
    page = await bh.history(db, user_id=user.id, flt=filter, cursor=cursor, limit=limit)
    return {"items": page.items, "next_cursor": page.next_cursor, "pending": page.pending}
