"""FastAPI entrypoint — TON Nexus."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="TON Nexus API",
    version="0.1.0",
    description="Task marketplace + miner circuit Mini App backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ton-nexus"}


@app.get("/")
async def root():
    return {
        "name": "TON Nexus",
        "docs": "/docs",
        "phase": "0-scaffold",
    }
