"""
Evidence Matching API endpoints
Internal API for evidence matching, auto-submit, and smart prompts
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

from api.auth_middleware import get_current_user
from api.schemas import (
    AutoSubmitRequest, AutoSubmitResponse,
    SmartPromptAnswer, SmartPromptAnswerResponse,
    EvidenceMatchMetrics, EvidenceMatchingJob
)
from evidence.auto_submit_service import AutoSubmitService
from evidence.smart_prompts_service import SmartPromptsService
from evidence.matching_worker import evidence_matching_worker
from evidence.matching_engine import EvidenceMatchingEngine

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize services
auto_submit_service = AutoSubmitService()
smart_prompts_service = SmartPromptsService()
matching_engine = EvidenceMatchingEngine()

@router.post("/api/internal/evidence/auto-submit", response_model=AutoSubmitResponse)
async def auto_submit_evidence(
    request: AutoSubmitRequest,
    user: dict = Depends(get_current_user)
):
    """Auto-submit evidence for a dispute case"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Auto-submitting evidence for dispute {request.dispute_id} by user {user_id}")
        
        # Validate that the dispute belongs to the user
        # This would be done in the auto_submit_service
        
        result = await auto_submit_service.auto_submit_evidence(request)
        
        return result
        
    except Exception as e:
        logger.error(f"Auto-submit failed: {e}")
        raise HTTPException(status_code=500, detail="Auto-submit failed")

@router.post("/api/internal/events/smart-prompts/{prompt_id}/answer", response_model=SmartPromptAnswerResponse)
async def answer_smart_prompt(
    prompt_id: str,
    answer: SmartPromptAnswer,
    user: dict = Depends(get_current_user)
):
    """Answer a smart prompt"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Answering smart prompt {prompt_id} by user {user_id}")
        
        result = await smart_prompts_service.answer_smart_prompt(prompt_id, answer)
        
        return result
        
    except Exception as e:
        logger.error(f"Smart prompt answer failed: {e}")
        raise HTTPException(status_code=500, detail="Smart prompt answer failed")

@router.get("/api/internal/evidence/smart-prompts")
async def get_smart_prompts(
    status: Optional[str] = Query(None, description="Filter by prompt status"),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """Get smart prompts for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting smart prompts for user {user_id}")
        
        result = await smart_prompts_service.get_user_smart_prompts(
            user_id, status, limit, offset
        )
        
        return {
            "ok": True,
            "data": result
        }
        
    except Exception as e:
        logger.error(f"Failed to get smart prompts: {e}")
        raise HTTPException(status_code=500, detail="Failed to get smart prompts")

@router.post("/api/internal/evidence/smart-prompts/{prompt_id}/dismiss")
async def dismiss_smart_prompt(
    prompt_id: str,
    user: dict = Depends(get_current_user)
):
    """Dismiss a smart prompt"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Dismissing smart prompt {prompt_id} by user {user_id}")
        
        success = await smart_prompts_service.dismiss_smart_prompt(prompt_id)
        
        if success:
            return {
                "ok": True,
                "message": "Smart prompt dismissed successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Smart prompt not found or already processed")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to dismiss smart prompt: {e}")
        raise HTTPException(status_code=500, detail="Failed to dismiss smart prompt")

@router.post("/api/internal/evidence/matching/start")
async def start_evidence_matching(
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """Start evidence matching for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Starting evidence matching for user {user_id}")
        
        # Create matching job
        job_id = await evidence_matching_worker.create_matching_job(user_id)
        
        # Start background processing
        background_tasks.add_task(
            evidence_matching_worker._process_job,
            {"id": job_id, "user_id": user_id, "status": "pending", "started_at": datetime.utcnow().isoformat() + "Z"}
        )
        
        return {
            "ok": True,
            "data": {
                "job_id": job_id,
                "status": "started",
                "message": "Evidence matching started"
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to start evidence matching: {e}")
        raise HTTPException(status_code=500, detail="Failed to start evidence matching")

@router.get("/api/internal/evidence/matching/jobs/{job_id}")
async def get_matching_job_status(
    job_id: str,
    user: dict = Depends(get_current_user)
):
    """Get evidence matching job status"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting matching job status {job_id} for user {user_id}")
        
        job_status = await evidence_matching_worker.get_job_status(job_id)
        
        if not job_status:
            raise HTTPException(status_code=404, detail="Matching job not found")
        
        return {
            "ok": True,
            "data": job_status
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get matching job status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get matching job status")

@router.get("/api/internal/evidence/matching/metrics")
async def get_evidence_matching_metrics(
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user)
):
    """Get evidence matching metrics for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting evidence matching metrics for user {user_id}")
        
        metrics = await evidence_matching_worker.get_user_metrics(user_id, days)
        
        return {
            "ok": True,
            "data": metrics
        }
        
    except Exception as e:
        logger.error(f"Failed to get evidence matching metrics: {e}")
        raise HTTPException(status_code=500, detail="Failed to get evidence matching metrics")

@router.get("/api/internal/evidence/auto-submit/metrics")
async def get_auto_submit_metrics(
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user)
):
    """Get auto-submit metrics for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting auto-submit metrics for user {user_id}")
        
        metrics = await auto_submit_service.get_auto_submit_metrics(user_id, days)
        
        return {
            "ok": True,
            "data": metrics
        }
        
    except Exception as e:
        logger.error(f"Failed to get auto-submit metrics: {e}")
        raise HTTPException(status_code=500, detail="Failed to get auto-submit metrics")

@router.post("/api/internal/evidence/matching/run")
async def run_evidence_matching(
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """Run evidence matching immediately (for testing)"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Running immediate evidence matching for user {user_id}")
        
        # Run matching directly
        result = await matching_engine.match_evidence_for_user(user_id)
        
        return {
            "ok": True,
            "data": {
                "matches": result["matches"],
                "auto_submits": result["auto_submits"],
                "smart_prompts": result["smart_prompts"],
                "message": "Evidence matching completed"
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to run evidence matching: {e}")
        raise HTTPException(status_code=500, detail="Failed to run evidence matching")

@router.get("/api/internal/evidence/disputes")
async def get_dispute_cases(
    status: Optional[str] = Query(None, description="Filter by dispute status"),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """Get dispute cases for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting dispute cases for user {user_id}")
        
        # This would typically call a dispute service
        # For now, return a placeholder response
        return {
            "ok": True,
            "data": {
                "disputes": [],
                "total": 0,
                "has_more": False
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get dispute cases: {e}")
        raise HTTPException(status_code=500, detail="Failed to get dispute cases")


