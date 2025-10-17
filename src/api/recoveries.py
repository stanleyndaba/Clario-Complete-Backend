"""
Recoveries API endpoints - Production Implementation
"""

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging
from src.api.auth_middleware import get_current_user
from src.api.schemas import Recovery, RecoveryListResponse, RecoveryStatusResponse, ClaimSubmissionResponse
from src.services.refund_engine_client import refund_engine_client
from src.websocket.websocket_manager import websocket_manager
from src.common import db as db_module
from src.services.integrations_client import integrations_client
from src.services.cost_docs_client import cost_docs_client
from src.services.integrations_client import integrations_client

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/api/recoveries", response_model=RecoveryListResponse)
async def get_recoveries(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(20, ge=1, le=100, description="Number of recoveries to return"),
    offset: int = Query(0, ge=0, description="Number of recoveries to skip"),
    user: dict = Depends(get_current_user)
):
    """Get list of recoveries/claims for the authenticated user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting recoveries for user {user_id}, status={status}, limit={limit}, offset={offset}")
        
        # Call real refund engine service
        result = await refund_engine_client.get_claims(user_id, status, limit, offset)
        
        if "error" in result:
            logger.error(f"Get recoveries failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Refund engine error: {result['error']}")
        
        recoveries = [Recovery(**recovery) for recovery in result.get("recoveries", [])]
        
        return RecoveryListResponse(
            recoveries=recoveries,
            total=result.get("total", 0),
            has_more=result.get("has_more", False),
            pagination={
                "limit": limit,
                "offset": offset,
                "total": result.get("total", 0),
                "has_more": result.get("has_more", False)
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_recoveries: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/recoveries/{id}", response_model=Recovery)
async def get_recovery(
    id: str,
    user: dict = Depends(get_current_user)
):
    """Get specific recovery details"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting recovery {id} for user {user_id}")
        
        # Call real refund engine service
        result = await refund_engine_client.get_claim(user_id, id)
        
        if "error" in result:
            logger.error(f"Get recovery failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Refund engine error: {result['error']}")
        
        return Recovery(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_recovery: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/recoveries/{id}/status", response_model=RecoveryStatusResponse)
async def get_recovery_status(
    id: str,
    user: dict = Depends(get_current_user)
):
    """Get recovery status and timeline"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting recovery status for {id}, user {user_id}")
        
        # Call real refund engine service for status
        result = await refund_engine_client.get_claim(user_id, id)
        
        if "error" in result:
            logger.error(f"Get recovery status failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Refund engine error: {result['error']}")
        
        # Extract status information
        status_response = RecoveryStatusResponse(
            id=id,
            status=result.get("status", "unknown"),
            last_updated=result.get("updated_at", datetime.utcnow().isoformat() + "Z"),
            amazon_status=result.get("amazon_status", "Not submitted"),
            estimated_resolution=result.get("expected_payout_date"),
            timeline=result.get("timeline", [])
        )

        # Enrich timeline with local audit events
        try:
            if db_module.db:
                events = db_module.db.get_audit_events_for_claim(user["user_id"], id, limit=200)
                # Map audit events to timeline items
                extra_items = [
                    {
                        "status": e.get("action", "event"),
                        "timestamp": e.get("created_at"),
                        "description": e.get("title") or e.get("message") or "",
                    }
                    for e in events
                ]
                # Merge and sort by timestamp
                merged = list(status_response.timeline) + extra_items
                merged.sort(key=lambda x: x.get("timestamp", ""))
                status_response.timeline = merged
        except Exception:
            logger.warning("Failed to merge audit events into timeline")

        return status_response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_recovery_status: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/claims/{id}/submit", response_model=ClaimSubmissionResponse)
async def submit_claim(
    id: str,
    user: dict = Depends(get_current_user)
):
    """Submit claim to Amazon"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Submitting claim {id} for user {user_id}")
        
        # Call real refund engine service to submit claim
        result = await refund_engine_client.create_claim(user_id, {
            "claim_id": id,
            "action": "submit"
        })
        
        if "error" in result:
            logger.error(f"Submit claim failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Refund engine error: {result['error']}")
        
        # Build response
        submission = ClaimSubmissionResponse(
            id=id,
            status="submitted",
            submitted_at=datetime.utcnow().isoformat() + "Z",
            amazon_case_id=result.get("amazon_case_id"),
            message="Claim submitted successfully to Amazon SP-API",
            estimated_resolution=(datetime.utcnow() + timedelta(days=7)).isoformat() + "Z"
        )

        # Audit trail event
        try:
            if db_module.db:
                db_module.db.add_audit_event(
                    user_id=user_id,
                    claim_id=id,
                    action="claim_submitted",
                    title="Claim filed",
                    message=submission.message,
                    document_ids=[],
                    metadata={"amazon_case_id": submission.amazon_case_id},
                    actor="system",
                )
        except Exception:
            logger.warning("Failed to write audit event for claim submission")

        # WebSocket broadcast
        try:
            await websocket_manager.broadcast_to_user(user_id, "claim_filed", {
                "claim_id": id,
                "amazon_case_id": submission.amazon_case_id,
                "status": submission.status,
                "estimated_resolution": submission.estimated_resolution,
            })
        except Exception:
            logger.warning("Failed to broadcast claim_filed event")

        # Email notification via Integrations-backend
        try:
            await integrations_client.send_notification(
                user_id=user_id,
                type="claim_detected",
                title="Claim filed",
                message=f"Your claim {id} was filed with Amazon.",
                channel="both",
                payload={"claim_id": id, "amazon_case_id": submission.amazon_case_id},
                priority="normal",
            )
        except Exception:
            logger.warning("Failed to send email notification for claim submission")

        return submission
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in submit_claim: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/recoveries/{id}/document")
async def get_recovery_documents(
    id: str,
    user: dict = Depends(get_current_user)
):
    """Get documents for a specific recovery"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting documents for recovery {id}, user {user_id}")
        
        # Call cost docs service to get documents for this recovery
        result = await cost_docs_client.get_documents_by_anomaly(id, user_id)
        
        if "error" in result:
            logger.error(f"Get recovery documents failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Cost docs service error: {result['error']}")
        
        return {"ok": True, "data": result}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_recovery_documents: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/recoveries/{id}/answer")
async def answer_recovery(
    id: str,
    answer_data: dict,
    user: dict = Depends(get_current_user)
):
    """Answer a recovery case (e.g., provide additional information)"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Answering recovery {id} for user {user_id}")
        
        # Call refund engine service to update recovery with answer
        result = await refund_engine_client.update_claim(user_id, id, answer_data)
        
        if "error" in result:
            logger.error(f"Answer recovery failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Refund engine error: {result['error']}")
        
        return {"ok": True, "data": result}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in answer_recovery: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/recoveries/{id}/documents/upload")
async def upload_recovery_documents(
    id: str,
    files: List[UploadFile] = File(...),
    user: dict = Depends(get_current_user)
):
    """Upload documents for a specific recovery"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Uploading documents for recovery {id}, user {user_id}, files: {len(files)}")
        
        # Call cost docs service to upload documents
        result = await cost_docs_client.upload_documents(id, files, user_id)
        
        if "error" in result:
            logger.error(f"Upload recovery documents failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Cost docs service error: {result['error']}")
        
        return {"ok": True, "data": result}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in upload_recovery_documents: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")