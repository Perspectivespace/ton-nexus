from fastapi import APIRouter

from app.api.me import router as me_router
from app.api.miner import router as miner_router
from app.api.tasks import router as tasks_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(me_router)
api_router.include_router(miner_router)
api_router.include_router(tasks_router)
