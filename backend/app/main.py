"""FastAPI entrypoint — TON Nexus."""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.config import settings
from app.db.session import SessionLocal
from app.services.arena_rooms import poll_once as arena_poll_once
from app.services.economy_seed import seed_economy
from app.services.ton_deposits import poll_once
from app.services.ton_payouts import poll_once as poll_payouts_once


async def deposit_loop():
    """Фоновый опрос: пополнения TON, подтверждение выплат (toncenter), возвраты ставок «Арены» по таймауту набора.
    Ошибки не останавливают цикл."""
    from app.services.economy import get_setting

    while True:
        try:
            await poll_once(SessionLocal)
        except Exception:
            logging.getLogger(__name__).exception("[deposits] poll error")
        try:
            await poll_payouts_once(SessionLocal)
        except Exception:
            logging.getLogger(__name__).exception("[payouts] poll error")
        try:
            await arena_poll_once(SessionLocal)
        except Exception:
            logging.getLogger(__name__).exception("[arena] refund poll error")
        try:
            async with SessionLocal() as s:
                cfg = await get_setting(s, "ton_deposits") or {}
                interval = min(max(int(cfg.get("poll_seconds", 15)), 5), 120)
        except Exception:
            interval = 15
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with SessionLocal() as session:
            await seed_economy(session)
            await session.commit()
    except Exception as e:
        print(f"[startup] seed_economy skipped: {e}")
    task = asyncio.create_task(deposit_loop())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(
    title="TON Nexus API",
    version="0.3.0",
    description="Task marketplace + miner circuit Mini App backend",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ton-nexus",
        "version": "0.3.0",
        "debug": settings.debug,
    }


@app.get("/")
async def root():
    return {
        "name": settings.app_name,
        "docs": "/docs",
        "api": "/api/v1",
        "debug": settings.debug,
    }
