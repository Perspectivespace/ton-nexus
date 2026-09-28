from fastapi import APIRouter

from app.api.admin import router as admin_router
from app.api.economy import router as economy_router
from app.api.engagement import router as engagement_router
from app.api.me import router as me_router
from app.api.miner import router as miner_router
from app.api.tasks import router as tasks_router
from app.api.withdraw import router as withdraw_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(me_router)
api_router.include_router(miner_router)
api_router.include_router(tasks_router)
api_router.include_router(admin_router)
api_router.include_router(economy_router)
api_router.include_router(withdraw_router)
api_router.include_router(engagement_router)
