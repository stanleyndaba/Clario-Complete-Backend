from fastapi import APIRouter, Header, HTTPException, Depends
from src.common.schemas import ClaimDetection
from src.cdd.service import ingest_detection
from src.api.auth_middleware import get_current_user

router = APIRouter(prefix="/claims", tags=["claims"])

@router.post("/detect")
def detect(claim: ClaimDetection, idempotency_key: str = Header(default=None, alias="Idempotency-Key"), user: dict = Depends(get_current_user)):
    try:
        return ingest_detection(claim, idempotency_key=idempotency_key)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

