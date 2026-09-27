"""FastAPI entrypoint — TON Nexus."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="TON Nexus API",
    version="0.2.0",
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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ton-nexus", "version": "0.2.0"}


@app.get("/")
async def root():
    return {
        "name": settings.app_name,
        "docs": "/docs",
        "phase": "1-models",
        "modules": [
            "users",
            "balance_history",
            "miner",
            "tasks",
            "economy_settings",
            "promo",
            "daily",
            "withdraw",
        ],
    }
