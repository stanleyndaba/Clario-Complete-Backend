"""
Detections API Router
Handles ML-powered claim detection operations
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
import logging
from src.api.auth_middleware import get_current_user
from src.api.schemas import DetectionJob, DetectionResult
from src.services.refund_engine_client import refund_engine_client

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/api/detections/run", response_model=DetectionJob)
async def run_detection(
    user: dict = Depends(get_current_user)
):
    """
    Run ML-powered claim detection for the authenticated user
    
    Args:
        user: Authenticated user information
        
    Returns:
        DetectionJob: Detection job information
    """
    try:
        user_id = user["user_id"]
        logger.info(f"Starting detection for user {user_id}")
        
        # Call refund engine service to run detection
        result = await refund_engine_client.get_discrepancies(user_id)
        
        if "error" in result:
            logger.error(f"Detection failed: {result['error']}")
            raise HTTPException(
                status_code=502,
                detail=f"Detection service error: {result['error']}"
            )
        
        # Create detection job response
        detection_job = DetectionJob(
            id=result.get("detection_id", "det_" + str(int(logging.time.time()))),
            status="processing",
            started_at=result.get("started_at", "2025-01-07T00:00:00Z"),
            completed_at=result.get("completed_at"),
            estimated_completion=result.get("estimated_completion"),
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
        
        # Call refund engine service to get detection status
        result = await refund_engine_client.get_claim_stats(user_id)
        
        if "error" in result:
            logger.error(f"Get detection status failed: {result['error']}")
            raise HTTPException(
                status_code=502,
                detail=f"Detection service error: {result['error']}"
            )
        
        # Create detection result response
        detection_result = DetectionResult(
            id=detectionId,
            status=result.get("status", "completed"),
            started_at=result.get("started_at", "2025-01-07T00:00:00Z"),
            completed_at=result.get("completed_at", "2025-01-07T00:05:00Z"),
            claims_found=result.get("total_claims", 0),
            total_amount=result.get("total_amount", 0.0),
            high_confidence_claims=result.get("high_confidence_claims", 0),
            medium_confidence_claims=result.get("medium_confidence_claims", 0),
            low_confidence_claims=result.get("low_confidence_claims", 0),
            processing_time_seconds=result.get("processing_time_seconds", 300)
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