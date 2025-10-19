"""
Zero-Effort Evidence Loop API endpoints
Complete API for smart prompts, auto-submit, and proof packets
"""

from fastapi import APIRouter, HTTPException, Depends, Query, WebSocket, WebSocketDisconnect, Header
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

from src.api.auth_middleware import get_current_user
from src.api.schemas import (
    SmartPromptAnswer, SmartPromptAnswerResponse,
    AutoSubmitRequest, AutoSubmitResponse,
    EvidenceMatchMetrics
)
from src.evidence.enhanced_smart_prompts_service import enhanced_smart_prompts_service
from src.evidence.auto_submit_service import AutoSubmitService
from src.evidence.proof_packet_worker import proof_packet_worker
from src.evidence.matching_engine import EvidenceMatchingEngine
from src.evidence.matching_worker import evidence_matching_worker
from src.events.event_system import event_system, EVENT_TYPES
from src.common.config import settings
from src.security.audit_service import audit_service, AuditAction, AuditSeverity
from src.websocket.websocket_manager import WebSocketManager
from src.services.service_directory import service_directory

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize services
auto_submit_service = AutoSubmitService()
matching_engine = EvidenceMatchingEngine()

# Connect services to event system
enhanced_smart_prompts_service.add_event_handler(
    lambda event_type, data: event_system.emit_event(event_type, data, data.get('user_id'))
)
proof_packet_worker.add_event_handler(
    "proof_packet_processed",
    lambda event_type, data: event_system.emit_event(event_type, data, data.get('user_id'))
)

@router.post("/api/internal/events/smart-prompts", response_model=Dict[str, Any])
async def create_smart_prompt(
    dispute_id: str,
    question: str,
    options: List[Dict[str, Any]],
    user_id: str = Depends(get_current_user)
):
    """Create a smart prompt for ambiguous evidence match"""
    
    try:
        user_id = user_id["user_id"]
        logger.info(f"Creating smart prompt for dispute {dispute_id} by user {user_id}")
        
        # Get evidence document ID from dispute (simplified)
        evidence_document_id = "placeholder_evidence_id"  # Would be determined from dispute
        
        prompt = await enhanced_smart_prompts_service.create_smart_prompt(
            user_id=user_id,
            dispute_id=dispute_id,
            evidence_document_id=evidence_document_id,
            question=question,
            options=options,
            expires_in_hours=24
        )
        
        return {
            "ok": True,
            "data": {
                "prompt_id": prompt.id,
                "dispute_id": dispute_id,
                "question": question,
                "options": options,
                "expires_at": prompt.expires_at
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to create smart prompt: {e}")
        raise HTTPException(status_code=500, detail="Failed to create smart prompt")

@router.post("/api/internal/events/smart-prompts/{prompt_id}/answer", response_model=SmartPromptAnswerResponse)
async def answer_smart_prompt(
    prompt_id: str,
    answer: SmartPromptAnswer,
    user: dict = Depends(get_current_user)
):
    """Answer a smart prompt with real-time event emission"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Answering smart prompt {prompt_id} by user {user_id}")
        
        result = await enhanced_smart_prompts_service.answer_smart_prompt(
            prompt_id, answer, user_id
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Smart prompt answer failed: {e}")
        raise HTTPException(status_code=500, detail="Smart prompt answer failed")

@router.get("/api/internal/events/smart-prompts")
async def get_smart_prompts(
    status: Optional[str] = Query(None, description="Filter by prompt status"),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """Get smart prompts for the user with real-time updates"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting smart prompts for user {user_id}")
        
        result = await enhanced_smart_prompts_service.get_user_smart_prompts(
            user_id, status, limit, offset
        )
        
        return {
            "ok": True,
            "data": result
        }
        
    except Exception as e:
        logger.error(f"Failed to get smart prompts: {e}")
        raise HTTPException(status_code=500, detail="Failed to get smart prompts")

@router.post("/api/internal/events/smart-prompts/{prompt_id}/dismiss")
async def dismiss_smart_prompt(
    prompt_id: str,
    user: dict = Depends(get_current_user)
):
    """Dismiss a smart prompt with real-time notification"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Dismissing smart prompt {prompt_id} by user {user_id}")
        
        success = await enhanced_smart_prompts_service.dismiss_smart_prompt(
            prompt_id, user_id
        )
        
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

@router.post("/api/internal/evidence/auto-submit", response_model=AutoSubmitResponse)
async def auto_submit_evidence(
    request: AutoSubmitRequest,
    user: dict = Depends(get_current_user)
):
    """Auto-submit evidence for a dispute case with real-time events"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Auto-submitting evidence for dispute {request.dispute_id} by user {user_id}")
        
        # Emit auto-submit triggered event
        await event_system.emit_event(
            EVENT_TYPES["AUTO_SUBMIT_TRIGGERED"],
            {
                "dispute_id": request.dispute_id,
                "evidence_document_id": request.evidence_document_id,
                "confidence": request.confidence,
                "user_id": user_id
            },
            user_id
        )
        
        result = await auto_submit_service.auto_submit_evidence(request)
        
        # Emit result event
        event_type = EVENT_TYPES["AUTO_SUBMIT_SUCCESS"] if result.success else EVENT_TYPES["AUTO_SUBMIT_FAILED"]
        await event_system.emit_event(
            event_type,
            {
                "dispute_id": request.dispute_id,
                "evidence_document_id": request.evidence_document_id,
                "action_taken": result.action_taken,
                "message": result.message,
                "user_id": user_id
            },
            user_id
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Auto-submit failed: {e}")
        raise HTTPException(status_code=500, detail="Auto-submit failed")

@router.post("/api/internal/evidence/proof-packet")
async def generate_proof_packet(
    dispute_id: str,
    user: dict = Depends(get_current_user)
):
    """Generate proof packet for a dispute"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Generating proof packet for dispute {dispute_id} by user {user_id}")
        
        # Simulate payout webhook data
        webhook_data = {
            "dispute_id": dispute_id,
            "user_id": user_id,
            "amount": 0.0,  # Would come from actual payout
            "date": datetime.utcnow().isoformat() + "Z"
        }
        
        result = await proof_packet_worker.process_payout_webhook(webhook_data)
        
        if result["success"]:
            return {
                "ok": True,
                "data": {
                    "packet_id": result["packet_id"],
                    "url": result["url"],
                    "message": "Proof packet generated successfully"
                }
            }
        else:
            raise HTTPException(status_code=400, detail=result["error"])
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate proof packet: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate proof packet")

@router.get("/api/internal/evidence/proof-packets")
async def get_proof_packets(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """Get proof packets for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting proof packets for user {user_id}")
        
        result = await proof_packet_worker.get_proof_packets_for_user(
            user_id, limit, offset
        )
        
        return {
            "ok": True,
            "data": result
        }
        
    except Exception as e:
        logger.error(f"Failed to get proof packets: {e}")
        raise HTTPException(status_code=500, detail="Failed to get proof packets")

@router.get("/api/internal/evidence/metrics")
async def get_evidence_metrics(
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user)
):
    """Get comprehensive evidence metrics for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting evidence metrics for user {user_id}")
        
        # Get matching metrics
        matching_metrics = await evidence_matching_worker.get_user_metrics(user_id, days)
        
        # Get auto-submit metrics
        auto_submit_metrics = await auto_submit_service.get_auto_submit_metrics(user_id, days)
        
        # Combine metrics
        combined_metrics = {
            **matching_metrics,
            "auto_submit_metrics": auto_submit_metrics,
            "period": f"{days} days"
        }
        
        return {
            "ok": True,
            "data": combined_metrics
        }
        
    except Exception as e:
        logger.error(f"Failed to get evidence metrics: {e}")
        raise HTTPException(status_code=500, detail="Failed to get evidence metrics")

@router.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time events"""
    await event_system.get_websocket_endpoint(websocket, user_id)

@router.get("/api/internal/events/stream/{user_id}")
async def sse_endpoint(user_id: str):
    """Server-Sent Events endpoint for real-time events"""
    return await event_system.get_sse_endpoint(user_id)

@router.post("/api/internal/claims/{id}/events")
async def intake_claim_event(
    id: str,
    payload: Dict[str, Any],
    x_internal_api_key: Optional[str] = Header(None, convert_underscores=False)
):
    """Internal event intake for claims. Secured by internal API key.

    Body: { action, title, message, document_ids:[], metadata }
    """
    expected_key = settings.INTEGRATIONS_API_KEY or settings.STRIPE_INTERNAL_API_KEY
    if not expected_key or x_internal_api_key != expected_key:
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        user_id = str(payload.get("user_id") or payload.get("userId") or "")
        action = payload.get("action") or "event"
        title = payload.get("title") or action.replace("_", " ").title()
        message = payload.get("message") or ""
        document_ids = payload.get("document_ids") or []
        metadata = payload.get("metadata") or {}

        # Audit trail
        try:
            await audit_service.log_event(
                action=AuditAction.SYSTEM_START,
                user_id=user_id or None,
                resource_type="claim_event",
                resource_id=id,
                severity=AuditSeverity.LOW,
                security_context={
                    "action": action,
                    "title": title,
                    "message": message,
                    "document_ids": document_ids,
                    **({"metadata": metadata} if metadata else {})
                }
            )
        except Exception:
            pass

        # WebSocket broadcast
        if user_id:
            await WebSocketManager().broadcast_to_user(
                user_id=user_id,
                event=f"claim.{action}",
                data={
                    "claim_id": id,
                    "title": title,
                    "message": message,
                    "document_ids": document_ids,
                    "metadata": metadata,
                }
            )

        # Email/in-app notification via Integrations
        try:
            if service_directory.get_service_url("integrations"):
                await service_directory.call_service(
                    "integrations",
                    "POST",
                    "/api/notifications",
                    headers={
                        "Content-Type": "application/json",
                        # Expect downstream to validate JWT if provided in metadata
                        "Authorization": f"Bearer {metadata.get('jwt', '')}"
                    },
                    json={
                        "type": "system_alert",
                        "title": title,
                        "message": message,
                        "channel": "both",
                        "payload": {"claim_id": id, **metadata, "document_ids": document_ids},
                        "immediate": True,
                    },
                )
        except Exception:
            pass

        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to intake claim event: {e}")
        raise HTTPException(status_code=500, detail="Failed to process event")

@router.post("/api/internal/evidence/matching/run")
async def run_evidence_matching(
    user: dict = Depends(get_current_user)
):
    """Run evidence matching immediately for zero-effort processing"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Running immediate evidence matching for user {user_id}")
        
        # Run matching directly
        result = await matching_engine.match_evidence_for_user(user_id)
        
        # Emit events for matches found
        if result["matches"] > 0:
            await event_system.emit_event(
                EVENT_TYPES["EVIDENCE_MATCHED"],
                {
                    "matches": result["matches"],
                    "auto_submits": result["auto_submits"],
                    "smart_prompts": result["smart_prompts"],
                    "user_id": user_id
                },
                user_id
            )
        
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

@router.get("/api/internal/evidence/status")
async def get_evidence_status(
    user: dict = Depends(get_current_user)
):
    """Get current evidence processing status for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting evidence status for user {user_id}")
        
        # Get pending smart prompts
        prompts_result = await enhanced_smart_prompts_service.get_user_smart_prompts(
            user_id, "pending", 5, 0
        )
        
        # Get recent proof packets
        packets_result = await proof_packet_worker.get_proof_packets_for_user(
            user_id, 5, 0
        )
        
        return {
            "ok": True,
            "data": {
                "pending_prompts": prompts_result["total"],
                "recent_packets": packets_result["total"],
                "prompts": prompts_result["prompts"][:3],  # Last 3 prompts
                "packets": packets_result["packets"][:3]   # Last 3 packets
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get evidence status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get evidence status")

