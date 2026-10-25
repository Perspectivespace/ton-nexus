"""Deploy from Telegram: owner + deployers; deployers are managed by deployers only.

POST only queues a request; the root-owned runner on the server does the work.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import deploy as svc
from app.services.roles import can_assign_deployer, can_deploy, deployer_count

router = APIRouter(prefix="/admin/deploy", tags=["deploy"])


def require_deployer(user: User = Depends(get_current_user)) -> User:
    if not can_deploy(user):
        raise HTTPException(status_code=403, detail="deployer or owner only")
    return user


class DeployBody(BaseModel):
    target: Literal["test", "prod"] = "test"
    force: bool = False


class DeployerOut(BaseModel):
    telegram_id: int
    username: str | None
    first_name: str | None


@router.get("/overview")
async def overview(
    target: Literal["test"] = "test",
    refresh: bool = False,
    user: User = Depends(require_deployer),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    installed = svc.runner_installed()
    deployed = svc.deployed_info(target)
    gh = await svc.latest_vs_deployed(deployed.get("commit"), refresh=refresh)
    jobs = svc.list_jobs(limit=1) if installed else []
    return {
        "target": target,
        "runner_installed": installed,
        "deployed": deployed,
        **gh,
        "active": svc.active_job(target) if installed else None,
        "last": jobs[0] if jobs else None,
        "can_manage_deployers": can_assign_deployer(user, await deployer_count(db)),
    }


@router.post("", status_code=202)
async def request_deploy(body: DeployBody, user: User = Depends(require_deployer)) -> dict[str, Any]:
    if body.target not in svc.TARGETS:
        raise HTTPException(status_code=400, detail="Прод ещё не настроен — пока доступен только test")
    if not svc.runner_installed():
        raise HTTPException(
            status_code=503,
            detail="Deploy runner не установлен на сервере (scripts/install-deploy-runner.sh)",
        )
    active = svc.active_job(body.target)
    if active:
        raise HTTPException(status_code=409, detail=f"Деплой уже идёт: {active['id']}")
    name = user.username or user.first_name or str(user.telegram_id)
    try:
        return svc.create_request(body.target, body.force, user.telegram_id, name)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"не удалось поставить в очередь: {e}") from e


@router.get("/jobs")
async def jobs(
    limit: int = Query(default=10, ge=1, le=50),
    user: User = Depends(require_deployer),
) -> list[dict[str, Any]]:
    return svc.list_jobs(limit=limit)


@router.get("/jobs/{job_id}")
async def job(
    job_id: str,
    lines: int = Query(default=200, ge=10, le=1000),
    user: User = Depends(require_deployer),
) -> dict[str, Any]:
    data = svc.read_job(job_id)
    if not data:
        raise HTTPException(status_code=404, detail="job not found")
    return {**data, "log_tail": svc.log_tail(job_id, lines)}


@router.get("/deployers", response_model=list[DeployerOut])
async def deployers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_assign_deployer(user, await deployer_count(db)):
        raise HTTPException(status_code=403, detail="deployers only")
    rows = await db.scalars(select(User).where(User.is_deployer.is_(True)).order_by(User.id))
    return [
        DeployerOut(telegram_id=u.telegram_id, username=u.username, first_name=u.first_name)
        for u in rows
    ]
