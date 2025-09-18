from fastapi import APIRouter, Header, HTTPException
from src.common.schemas import ClaimDetection
from src.cdd.service import ingest_detection

router = APIRouter(prefix="/claims", tags=["claims"])

@router.post("/detect")
def detect(claim: ClaimDetection, idempotency_key: str = Header(default=None, alias="Idempotency-Key")):
    try:
        return ingest_detection(claim, idempotency_key=idempotency_key)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

