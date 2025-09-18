from src.common.schemas import ClaimDetection
from src.common.db_postgresql import DatabaseManager
from src.cdd.worker import enqueue_validation

# Initialize database manager
db = DatabaseManager()

def ingest_detection(claim: ClaimDetection, idempotency_key: str | None):
    # Check idempotency
    if idempotency_key:
        if db.idempotency_exists(idempotency_key):
            raise ValueError("Idempotent duplicate")
        db.save_idempotency(idempotency_key, claim.claim_id)
    
    # Upsert claim with status=detected
    db.upsert_claim(claim)
    
    # Enqueue validation job
    enqueue_validation(claim.claim_id)
    
    return {"claim_id": claim.claim_id, "status": "queued_validation"}

