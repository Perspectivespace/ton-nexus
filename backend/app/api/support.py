"""Тикеты поддержки: обращения игрока и внутренние эндпоинты бота."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_bot
from app.db.session import get_db
from app.models.user import User
from app.services import support_tickets as svc

router = APIRouter(prefix="/support", tags=["support"])

_CHUNK = 64 * 1024


class TicketCreatedOut(BaseModel):
    id: int
    category: str
    status: str
    has_screenshot: bool
    created_at: datetime


class TicketItemOut(BaseModel):
    id: int
    category: str
    message: str
    has_screenshot: bool
    status: str
    reply_text: str | None
    replied_at: datetime | None
    created_at: datetime


class TicketListOut(BaseModel):
    items: list[TicketItemOut]


class ReplyIn(BaseModel):
    reply_text: str = Field(min_length=1, max_length=4000)
    replied_by_tg_id: int | None = None


class ReplyOut(BaseModel):
    id: int
    status: str
    reply_text: str
    replied_at: datetime | None
    delivered: bool


class CloseOut(BaseModel):
    id: int
    status: str


def _raise(err: svc.TicketError) -> None:
    raise HTTPException(status_code=err.status, detail={"code": err.code, "message": err.message}) from err


async def _read_screenshot(upload: UploadFile | None) -> tuple[bytes | None, str | None]:
    if upload is None:
        return None, None
    declared = upload.content_type
    buf = bytearray()
    while True:
        chunk = await upload.read(_CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > svc.MAX_BYTES:
            raise HTTPException(
                status_code=400,
                detail={"code": "too_large", "message": "файл больше 5 МБ"},
            )
    return (bytes(buf) if buf else b""), declared


@router.post("/tickets", response_model=TicketCreatedOut, status_code=201)
async def create_ticket(
    category: str = Form(...),
    message: str = Form(...),
    screenshot: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data, declared = await _read_screenshot(screenshot)
    try:
        ticket = await svc.create_ticket(
            db,
            user,
            category=category,
            message=message,
            screenshot=data,
            screenshot_type=declared,
        )
    except svc.TicketError as e:
        _raise(e)
    await db.commit()
    await db.refresh(ticket)
    return TicketCreatedOut(**svc.created_out(ticket))


@router.get("/tickets", response_model=TicketListOut)
async def list_tickets(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await svc.list_tickets(db, user.id)
    return TicketListOut(items=[TicketItemOut(**svc.player_out(t)) for t in rows])


@router.get("/internal/tickets/by-message/{chat_message_id}")
async def internal_by_message(
    chat_message_id: int,
    db: AsyncSession = Depends(get_db),
    __: None = Depends(require_bot),
):
    ticket = await svc.get_by_message(db, chat_message_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    user = await db.get(User, ticket.user_id)
    return svc.internal_out(ticket, user)


@router.get("/internal/tickets/{ticket_id}")
async def internal_get(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    __: None = Depends(require_bot),
):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    user = await db.get(User, ticket.user_id)
    return svc.internal_out(ticket, user)


@router.post("/internal/tickets/{ticket_id}/reply", response_model=ReplyOut)
async def internal_reply(
    ticket_id: int,
    body: ReplyIn,
    db: AsyncSession = Depends(get_db),
    __: None = Depends(require_bot),
):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    try:
        result = await svc.reply_ticket(
            db, ticket, reply_text=body.reply_text, replied_by_tg_id=body.replied_by_tg_id
        )
    except svc.TicketError as e:
        _raise(e)
    await db.commit()
    await db.refresh(ticket)
    return ReplyOut(
        id=ticket.id,
        status=ticket.status,
        reply_text=ticket.reply_text or "",
        replied_at=ticket.replied_at,
        delivered=bool(result["delivered"]),
    )


@router.post("/internal/tickets/{ticket_id}/close", response_model=CloseOut)
async def internal_close(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    __: None = Depends(require_bot),
):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    await svc.close_ticket(db, ticket)
    await db.commit()
    await db.refresh(ticket)
    return CloseOut(id=ticket.id, status=ticket.status)
