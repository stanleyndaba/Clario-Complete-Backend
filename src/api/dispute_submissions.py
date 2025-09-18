"""
Dispute Submissions API endpoints
Handles Amazon SP-API dispute submission management and tracking
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks, Request
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

from src.api.auth_middleware import get_current_user
from src.api.schemas import (
    DisputeSubmission, SubmissionStatus, AuditAction
)
from src.integrations.amazon_spapi_service import amazon_spapi_service
from src.evidence.auto_submit_engine import auto_submit_engine
from src.websocket.websocket_manager import websocket_manager

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/api/v1/disputes/submit/{match_id}")
async def submit_dispute_match(
    match_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """Submit a specific evidence match as a dispute"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Submitting dispute match {match_id} for user {user_id}")
        
        # Submit the match
        result = await auto_submit_engine.submit_single_match(
            match_id=match_id,
            user_id=user_id
        )
        
        if result["success"]:
            return {
                "ok": True,
                "data": {
                    "submission_id": result["submission_id"],
                    "amazon_case_id": result["amazon_case_id"],
                    "status": result["status"],
                    "message": "Dispute submitted successfully"
                }
            }
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Submission failed: {result['error']}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to submit dispute match: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit dispute match")

@router.post("/api/v1/disputes/auto-submit/process")
async def process_auto_submit(
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = Query(None, description="Process for specific user or all users"),
    user: dict = Depends(get_current_user)
):
    """Process high-confidence matches for auto-submission"""
    
    try:
        # Use authenticated user if no user_id specified
        target_user_id = user_id or user["user_id"]
        
        logger.info(f"Processing auto-submit for user {target_user_id}")
        
        # Process matches
        result = await auto_submit_engine.process_high_confidence_matches(target_user_id)
        
        return {
            "ok": True,
            "data": {
                "processed": result["processed"],
                "submitted": result["submitted"],
                "failed": result["failed"],
                "skipped": result["skipped"],
                "message": "Auto-submit processing completed"
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to process auto-submit: {e}")
        raise HTTPException(status_code=500, detail="Failed to process auto-submit")

@router.post("/api/v1/disputes/retry-failed")
async def retry_failed_submissions(
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = Query(None, description="Retry for specific user or all users"),
    user: dict = Depends(get_current_user)
):
    """Retry failed dispute submissions"""
    
    try:
        # Use authenticated user if no user_id specified
        target_user_id = user_id or user["user_id"]
        
        logger.info(f"Retrying failed submissions for user {target_user_id}")
        
        # Retry failed submissions
        result = await auto_submit_engine.retry_failed_submissions(target_user_id)
        
        return {
            "ok": True,
            "data": {
                "retried": result["retried"],
                "successful": result["successful"],
                "still_failed": result["still_failed"],
                "message": "Retry processing completed"
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to retry submissions: {e}")
        raise HTTPException(status_code=500, detail="Failed to retry submissions")

@router.get("/api/v1/disputes/submissions")
async def get_user_submissions(
    status: Optional[str] = Query(None, description="Filter by submission status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """Get user's dispute submissions"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting submissions for user {user_id}")
        
        # Get submissions
        result = await amazon_spapi_service.get_user_submissions(
            user_id=user_id,
            limit=limit,
            offset=offset
        )
        
        # Filter by status if specified
        if status:
            result["submissions"] = [
                s for s in result["submissions"] if s["status"] == status
            ]
        
        return {
            "ok": True,
            "data": result
        }
        
    except Exception as e:
        logger.error(f"Failed to get user submissions: {e}")
        raise HTTPException(status_code=500, detail="Failed to get user submissions")

@router.get("/api/v1/disputes/submissions/{submission_id}")
async def get_submission_details(
    submission_id: str,
    user: dict = Depends(get_current_user)
):
    """Get detailed information about a specific submission"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting submission details {submission_id} for user {user_id}")
        
        # Get submission details from database
        from src.common.db_postgresql import DatabaseManager
        db = DatabaseManager()
        
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT ds.id, ds.submission_id, ds.amazon_case_id, ds.order_id, 
                           ds.asin, ds.sku, ds.claim_type, ds.amount_claimed, ds.currency,
                           ds.status, ds.confidence_score, ds.submission_timestamp,
                           ds.resolution_timestamp, ds.amount_approved, ds.resolution_notes,
                           ds.error_message, ds.retry_count, ds.max_retries,
                           ds.last_retry_at, ds.next_retry_at, ds.metadata,
                           ds.created_at, ds.updated_at
                    FROM dispute_submissions ds
                    WHERE ds.id = %s AND ds.user_id = %s
                """, (submission_id, user_id))
                
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Submission not found")
                
                submission = {
                    "id": str(row[0]),
                    "submission_id": row[1],
                    "amazon_case_id": row[2],
                    "order_id": row[3],
                    "asin": row[4],
                    "sku": row[5],
                    "claim_type": row[6],
                    "amount_claimed": row[7],
                    "currency": row[8],
                    "status": row[9],
                    "confidence_score": row[10],
                    "submission_timestamp": row[11].isoformat() + "Z" if row[11] else None,
                    "resolution_timestamp": row[12].isoformat() + "Z" if row[12] else None,
                    "amount_approved": row[13],
                    "resolution_notes": row[14],
                    "error_message": row[15],
                    "retry_count": row[16],
                    "max_retries": row[17],
                    "last_retry_at": row[18].isoformat() + "Z" if row[18] else None,
                    "next_retry_at": row[19].isoformat() + "Z" if row[19] else None,
                    "metadata": row[20],
                    "created_at": row[21].isoformat() + "Z",
                    "updated_at": row[22].isoformat() + "Z"
                }
                
                # Get status history
                cursor.execute("""
                    SELECT status, status_reason, amazon_response, changed_by, changed_at
                    FROM submission_status_history 
                    WHERE submission_id = %s
                    ORDER BY changed_at DESC
                """, (submission_id,))
                
                status_history = []
                for hist_row in cursor.fetchall():
                    status_history.append({
                        "status": hist_row[0],
                        "status_reason": hist_row[1],
                        "amazon_response": hist_row[2],
                        "changed_by": str(hist_row[3]) if hist_row[3] else None,
                        "changed_at": hist_row[4].isoformat() + "Z"
                    })
                
                submission["status_history"] = status_history
                
                # Get evidence documents
                cursor.execute("""
                    SELECT ed.id, ed.filename, ed.content_type, ed.size_bytes,
                           ed.download_url, sel.evidence_type, sel.evidence_order
                    FROM submission_evidence_links sel
                    JOIN evidence_documents ed ON sel.evidence_document_id = ed.id
                    WHERE sel.submission_id = %s
                    ORDER BY sel.evidence_order ASC
                """, (submission_id,))
                
                evidence_documents = []
                for evid_row in cursor.fetchall():
                    evidence_documents.append({
                        "id": str(evid_row[0]),
                        "filename": evid_row[1],
                        "content_type": evid_row[2],
                        "size_bytes": evid_row[3],
                        "download_url": evid_row[4],
                        "evidence_type": evid_row[5],
                        "evidence_order": evid_row[6]
                    })
                
                submission["evidence_documents"] = evidence_documents
        
        return {
            "ok": True,
            "data": submission
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get submission details: {e}")
        raise HTTPException(status_code=500, detail="Failed to get submission details")

@router.get("/api/v1/disputes/submissions/{submission_id}/status")
async def check_submission_status(
    submission_id: str,
    user: dict = Depends(get_current_user)
):
    """Check the current status of a submission with Amazon"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Checking submission status {submission_id} for user {user_id}")
        
        # Get submission details
        from src.common.db_postgresql import DatabaseManager
        db = DatabaseManager()
        
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT submission_id FROM dispute_submissions 
                    WHERE id = %s AND user_id = %s
                """, (submission_id, user_id))
                
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Submission not found")
                
                spapi_submission_id = row[0]
                if not spapi_submission_id:
                    raise HTTPException(status_code=400, detail="No SP-API submission ID")
        
        # Check status with Amazon
        status_result = await amazon_spapi_service.check_submission_status(
            submission_id=spapi_submission_id,
            user_id=user_id
        )
        
        if status_result["success"]:
            # Update local status if changed
            if status_result["status"]:
                from src.common.db_postgresql import DatabaseManager
                db = DatabaseManager()
                
                with db._get_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute("""
                            SELECT update_submission_status(%s, %s, %s, %s, %s)
                        """, (
                            submission_id, status_result["status"], 
                            "Status checked from Amazon", 
                            status_result, user_id
                        ))
        
        return {
            "ok": True,
            "data": status_result
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to check submission status: {e}")
        raise HTTPException(status_code=500, detail="Failed to check submission status")

@router.post("/api/v1/disputes/auto-submit/start")
async def start_auto_submit_processing(
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """Start continuous auto-submit processing"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Starting auto-submit processing for user {user_id}")
        
        # Start background task
        background_tasks.add_task(
            auto_submit_engine.start_continuous_processing
        )
        
        return {
            "ok": True,
            "message": "Auto-submit processing started"
        }
        
    except Exception as e:
        logger.error(f"Failed to start auto-submit processing: {e}")
        raise HTTPException(status_code=500, detail="Failed to start auto-submit processing")

@router.post("/api/v1/disputes/auto-submit/stop")
async def stop_auto_submit_processing(
    user: dict = Depends(get_current_user)
):
    """Stop continuous auto-submit processing"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Stopping auto-submit processing for user {user_id}")
        
        # Stop processing
        await auto_submit_engine.stop_continuous_processing()
        
        return {
            "ok": True,
            "message": "Auto-submit processing stopped"
        }
        
    except Exception as e:
        logger.error(f"Failed to stop auto-submit processing: {e}")
        raise HTTPException(status_code=500, detail="Failed to stop auto-submit processing")

@router.get("/api/v1/disputes/submissions/metrics")
async def get_submission_metrics(
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user)
):
    """Get submission metrics for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting submission metrics for user {user_id}")
        
        # Get metrics from database
        from src.common.db_postgresql import DatabaseManager
        db = DatabaseManager()
        
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_submissions,
                        COUNT(CASE WHEN status = 'submitted' THEN 1 END) as submitted,
                        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
                        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
                        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                        AVG(confidence_score) as avg_confidence,
                        SUM(amount_claimed) as total_claimed,
                        SUM(amount_approved) as total_approved
                    FROM dispute_submissions 
                    WHERE user_id = %s 
                    AND created_at >= NOW() - INTERVAL '%s days'
                """, (user_id, days))
                
                result = cursor.fetchone()
                if result:
                    total_submissions = result[0] or 0
                    submitted = result[1] or 0
                    approved = result[2] or 0
                    rejected = result[3] or 0
                    failed = result[4] or 0
                    avg_confidence = result[5] or 0.0
                    total_claimed = result[6] or 0.0
                    total_approved = result[7] or 0.0
                    
                    success_rate = (approved / total_submissions) if total_submissions > 0 else 0.0
                    approval_rate = (approved / submitted) if submitted > 0 else 0.0
                    
                    return {
                        "ok": True,
                        "data": {
                            "total_submissions": total_submissions,
                            "submitted": submitted,
                            "approved": approved,
                            "rejected": rejected,
                            "failed": failed,
                            "success_rate": success_rate,
                            "approval_rate": approval_rate,
                            "avg_confidence": avg_confidence,
                            "total_claimed": total_claimed,
                            "total_approved": total_approved,
                            "period_days": days
                        }
                    }
                else:
                    return {
                        "ok": True,
                        "data": {
                            "total_submissions": 0,
                            "submitted": 0,
                            "approved": 0,
                            "rejected": 0,
                            "failed": 0,
                            "success_rate": 0.0,
                            "approval_rate": 0.0,
                            "avg_confidence": 0.0,
                            "total_claimed": 0.0,
                            "total_approved": 0.0,
                            "period_days": days
                        }
                    }
        
    except Exception as e:
        logger.error(f"Failed to get submission metrics: {e}")
        raise HTTPException(status_code=500, detail="Failed to get submission metrics")
