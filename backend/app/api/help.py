"""Сводка для «Помощи» — игрок, без адресов и чужих id."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.help_facts import facts

router = APIRouter(prefix="/help", tags=["help"])


@router.get("")
async def help_facts(_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Числа для экрана «Помощь»: лимиты, комиссии, ставка, сроки. Кошельки и id не отдаём."""
    return await facts(db)
