"""
Detections API Router
Handles ML-powered claim detection operations
"""

from fastapi import APIRouter, HTTPException, Depends, Query, Body
from typing import Optional
from datetime import datetime
import logging
from src.api.auth_middleware import get_current_user
from src.api.schemas import DetectionJob, DetectionResult
from src.services.integrations_client import integrations_client

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/api/detections/run", response_model=DetectionJob)
async def run_detection(
    body: dict = Body(None),
    user: dict = Depends(get_current_user)
):
    """
    Run ML-powered claim detection for the authenticated user
    
    Args:
        body: Request body with syncId and optional triggerType
        user: Authenticated user information
        
    Returns:
        DetectionJob: Detection job information
    """
    try:
        user_id = user["user_id"]
        sync_id = body.get("syncId") if body else None
        trigger_type = body.get("triggerType", "inventory") if body else "inventory"
        
        logger.info(f"Starting detection for user {user_id}, syncId={sync_id}")
        
        if not sync_id:
            # Try to get latest sync or create one
            logger.warning(f"No syncId provided, attempting to start sync first")
            sync_result = await integrations_client.start_sync(user_id, "inventory")
            if "error" in sync_result:
                raise HTTPException(status_code=400, detail="syncId is required. Please start a sync first.")
            sync_id = sync_result.get("syncId") or sync_result.get("id")
        
        # Call integrations backend detection service
        import time
        result = await integrations_client.run_detection(user_id, sync_id, trigger_type)
        
        if "error" in result or not result.get("success"):
            error_msg = result.get("error", {}).get("message") if isinstance(result.get("error"), dict) else result.get("error", "Unknown error")
            logger.error(f"Detection failed: {error_msg}")
            raise HTTPException(
                status_code=502,
                detail=f"Detection service error: {error_msg}"
            )
        
        job_data = result.get("job", {})
        # Create detection job response
        detection_job = DetectionJob(
            id=job_data.get("sync_id", sync_id),
            status="processing",
            started_at=datetime.utcnow().isoformat() + "Z",
            completed_at=None,
            estimated_completion=None,
            message="Detection job started successfully"
        )
        
        return detection_job
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in run_detection: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error"
        )

@router.get("/api/detections/status/{detectionId}", response_model=DetectionResult)
async def get_detection_status(
    detectionId: str,
    user: dict = Depends(get_current_user)
):
    """
    Get status of a specific detection job
    
    Args:
        detectionId: Detection job ID
        user: Authenticated user information
        
    Returns:
        DetectionResult: Detection result details
    """
    try:
        user_id = user["user_id"]
        logger.info(f"Getting detection status for {detectionId}, user {user_id}")
        
        # Call integrations backend to get detection status
        result = await integrations_client.get_detection_status(detectionId, user_id)
        
        if "error" in result or not result.get("success"):
            error_msg = result.get("error", {}).get("message") if isinstance(result.get("error"), dict) else result.get("error", "Unknown error")
            logger.error(f"Get detection status failed: {error_msg}")
            raise HTTPException(
                status_code=502,
                detail=f"Detection service error: {error_msg}"
            )
        
        results = result.get("results", [])
        # Create detection result response
        detection_result = DetectionResult(
            id=detectionId,
            status="completed" if results else "processing",
            started_at=datetime.utcnow().isoformat() + "Z",
            completed_at=datetime.utcnow().isoformat() + "Z" if results else None,
            claims_found=len(results),
            total_amount=sum(float(r.get("amount", 0)) for r in results),
            high_confidence_claims=sum(1 for r in results if r.get("confidence", 0) > 0.8),
            medium_confidence_claims=sum(1 for r in results if 0.5 <= r.get("confidence", 0) <= 0.8),
            low_confidence_claims=sum(1 for r in results if r.get("confidence", 0) < 0.5),
            processing_time_seconds=300
        )
        
        return detection_result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_detection_status: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error"
        )

@router.get("/api/detections/history")
async def get_detection_history(
    limit: int = Query(10, ge=1, le=100, description="Number of detections to return"),
    offset: int = Query(0, ge=0, description="Number of detections to skip"),
    user: dict = Depends(get_current_user)
):
    """
    Get detection history for the authenticated user
    
    Args:
        limit: Maximum number of detections to return
        offset: Number of detections to skip
        user: Authenticated user information
        
    Returns:
        dict: Detection history
    """
    try:
        user_id = user["user_id"]
        logger.info(f"Getting detection history for user {user_id}, limit={limit}, offset={offset}")
        
        # Call refund engine service to get detection history
        result = await refund_engine_client.get_claim_stats(user_id)
        
        if "error" in result:
            logger.error(f"Get detection history failed: {result['error']}")
            raise HTTPException(
                status_code=502,
                detail=f"Detection service error: {result['error']}"
            )
        
        return {
            "ok": True,
            "data": {
                "detections": [result],  # Single detection for now
                "total": 1,
                "has_more": False
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_detection_history: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error"
        )