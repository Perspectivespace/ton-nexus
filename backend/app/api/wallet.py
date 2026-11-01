"""TON wallet linking API."""

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services.economy import get_setting
from app.services.ton_wallet import (
    WalletError,
    active_wallet,
    create_proof_payload,
    link_wallet,
    unlink_wallet,
)

router = APIRouter(prefix="/wallet", tags=["wallet"])


class AccountIn(BaseModel):
    """Аккаунт из TON Connect. SDK присылает сеть в поле chain, старые клиенты в network."""

    address: str
    network: str | int | None = None
    chain: str | int | None = None
    publicKey: str | None = None
    walletStateInit: str | None = None

    @model_validator(mode="after")
    def _network_from_chain(self):
        if self.network is None:
            self.network = self.chain
        if self.network is None:
            raise ValueError("Не указана сеть кошелька")
        self.network = str(self.network)
        return self


class DomainIn(BaseModel):
    lengthBytes: int
    value: str


class ProofIn(BaseModel):
    timestamp: int
    domain: DomainIn
    signature: str
    payload: str


class LinkBody(BaseModel):
    account: AccountIn
    proof: ProofIn
    wallet_app: str | None = None


@router.get("/tonconnect-manifest.json")
async def manifest(response: Response):
    base = settings.webapp_url.rstrip("/")
    response.headers["Cache-Control"] = "public, max-age=300"
    return {
        "url": base,
        "name": "TON Nexus",
        "iconUrl": f"{base}/apple-touch-icon.png",
    }


@router.get("")
async def get_wallet(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cfg = await get_setting(db, "ton_wallet") or {}
    w = await active_wallet(db, user.id)
    return {
        "enabled": cfg.get("enabled", True),
        "network": cfg.get("network", "-239"),
        "wallet": (
            {"address": w.address, "wallet_app": w.wallet_app, "linked_at": w.linked_at.isoformat()}
            if w
            else None
        ),
    }


@router.post("/proof-payload")
async def proof_payload(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        data = await create_proof_payload(db, user=user)
        await db.commit()
        return data
    except WalletError as e:
        raise HTTPException(status_code=400, detail=e.message) from e


@router.post("/link")
async def link(
    body: LinkBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = await get_setting(db, "ton_wallet") or {}
    if not cfg.get("enabled", True):
        raise HTTPException(status_code=403, detail="Привязка кошелька отключена")
    try:
        w = await link_wallet(
            db,
            user=user,
            account=body.account.model_dump(),
            proof=body.proof.model_dump(),
            wallet_app=body.wallet_app,
        )
        await db.commit()
        return {
            "wallet": {
                "address": w.address,
                "wallet_app": w.wallet_app,
                "linked_at": w.linked_at.isoformat(),
            }
        }
    except WalletError as e:
        raise HTTPException(status_code=400, detail=e.message) from e


@router.post("/unlink")
async def unlink(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await unlink_wallet(db, user=user)
        await db.commit()
        return {"wallet": None}
    except WalletError as e:
        raise HTTPException(status_code=400, detail=e.message) from e
