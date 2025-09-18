from fastapi import APIRouter, HTTPException
from src.acg.filer import file_claim
from src.common.db_postgresql import DatabaseManager

# Initialize database manager
db = DatabaseManager()

router = APIRouter(prefix="/claims", tags=["claims-filing"])

@router.post("/{claim_id}/file")
def force_file(claim_id: str):
    """Force file a specific claim"""
    claim = db.load_claim(claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    
    file_claim(claim_id)
    return {"claim_id": claim_id, "status": "file_attempted"}

@router.get("/{claim_id}")
def get_claim(claim_id: str):
    """Get claim status and history"""
    status = db.get_claim_status(claim_id)
    if not status:
        raise HTTPException(404, "Claim not found")
    return status

@router.post("/{claim_id}/cancel")
def cancel_claim(claim_id: str):
    """Cancel a claim (mark as cancelled)"""
    claim = db.load_claim(claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    
    db.update_claim_status(claim_id, "cancelled")
    return {"claim_id": claim_id, "status": "cancelled"}








