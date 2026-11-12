from fastapi import APIRouter

from app.api.admin import router as admin_router
from app.api.arena import router as arena_router
from app.api.city_ads import router as city_ads_router
from app.api.deploy import router as deploy_router
from app.api.economy import router as economy_router
from app.api.engagement import router as engagement_router
from app.api.me import router as me_router
from app.api.miner import router as miner_router
from app.api.ratings import router as ratings_router
from app.api.tasks import router as tasks_router
from app.api.tower import router as tower_router
from app.api.withdraw import router as withdraw_router
from app.api.wallet import router as wallet_router
from app.api.deposits import router as deposits_router
from app.api.balance import router as balance_router
from app.api.secret_promo import router as secret_promo_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(me_router)
api_router.include_router(miner_router)
api_router.include_router(tasks_router)
api_router.include_router(admin_router)
api_router.include_router(deploy_router)
api_router.include_router(economy_router)
api_router.include_router(withdraw_router)
api_router.include_router(wallet_router)
api_router.include_router(deposits_router)
api_router.include_router(balance_router)
api_router.include_router(engagement_router)
api_router.include_router(tower_router)
api_router.include_router(ratings_router)
api_router.include_router(arena_router)
api_router.include_router(city_ads_router)
api_router.include_router(secret_promo_router)
