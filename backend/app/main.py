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
    """Фоновый опрос: пополнения TON и подтверждение выплат (toncenter). Ошибки не останавливают цикл."""
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
            async with SessionLocal() as s:
                cfg = await get_setting(s, "ton_deposits") or {}
                interval = min(max(int(cfg.get("poll_seconds", 15)), 5), 120)
        except Exception:
            interval = 15
        await asyncio.sleep(interval)


# «Арена»: ход длится 10 с, поэтому свой цикл с коротким шагом (интервал опроса пополнений — 5–120 с)
ARENA_TICK_S = 2


async def arena_loop():
    """Фоновый цикл «Арены»: возвраты ставок по таймауту набора и разрешение ходов с прошедшим дедлайном
    (если игроки не опрашивают комнату сами). Ошибки не останавливают цикл."""
    while True:
        try:
            await arena_poll_once(SessionLocal)
        except Exception:
            logging.getLogger(__name__).exception("[arena] poll error")
        await asyncio.sleep(ARENA_TICK_S)


# Скриншоты-подтверждения: проверенные удаляются через 23 ч, шаг цикла 10 мин → не позже 24 ч
PROOF_CLEANUP_S = 600


async def proof_cleanup_loop():
    """Фоновая очистка скриншотов заданий (очередь — task_proofs.delete_after). Ошибки не останавливают цикл."""
    from app.services.task_proofs import cleanup_once

    while True:
        try:
            n = await cleanup_once(SessionLocal)
            if n:
                logging.getLogger(__name__).info("[proofs] cleanup: удалено %s", n)
        except Exception:
            logging.getLogger(__name__).exception("[proofs] cleanup error")
        await asyncio.sleep(PROOF_CLEANUP_S)


# Реклама в городе: закрытие объявлений с прошедшим сроком (сутки МСК) — раз в 10 минут
CITY_ADS_EXPIRE_S = 600


async def city_ads_expire_loop():
    """Фоновое истечение рекламы: одобренные с прошедшим сроком → expired; так и не проверенные → expired
    с полным возвратом и освобождением суток. Ошибки не останавливают цикл."""
    from app.services.city_ads import expire_once

    while True:
        try:
            async with SessionLocal() as s:
                n = await expire_once(s)
                await s.commit()
            if n:
                logging.getLogger(__name__).info("[city-ads] закрыто объявлений: %s", n)
        except Exception:
            logging.getLogger(__name__).exception("[city-ads] expire error")
        await asyncio.sleep(CITY_ADS_EXPIRE_S)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with SessionLocal() as session:
            await seed_economy(session)
            await session.commit()
    except Exception as e:
        print(f"[startup] seed_economy skipped: {e}")
    try:
        # места рекламы в городе (их же сеет миграция 018; здесь — на случай базы без alembic)
        from app.services.city_ads import ensure_spots

        async with SessionLocal() as session:
            await ensure_spots(session)
            await session.commit()
    except Exception as e:
        print(f"[startup] city ad spots skipped: {e}")
    tasks = [
        asyncio.create_task(deposit_loop()),
        asyncio.create_task(arena_loop()),
        asyncio.create_task(proof_cleanup_loop()),
        asyncio.create_task(city_ads_expire_loop()),
    ]
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
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
