from fastapi import APIRouter

from app.api.me import router as me_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(me_router)
