"""
Evidence Prompts & Proof Packets API endpoints
Phase 4: Smart Prompts & Proof Packets for Evidence Validator
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks, Request
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

from src.api.auth_middleware import get_current_user
from src.api.schemas import (
    SmartPromptRequest, SmartPromptResponse, SmartPromptAnswer, 
    SmartPromptAnswerResponse, ProofPacketResponse, AuditAction
)
from src.evidence.smart_prompt_service_v2 import smart_prompt_service_v2
from src.evidence.proof_packet_worker import proof_packet_worker
from src.websocket.websocket_manager import WebSocketManager

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize WebSocket manager
websocket_manager = WebSocketManager()

@router.post("/api/v1/evidence/prompts", response_model=SmartPromptResponse)
async def create_smart_prompt(
    request: SmartPromptRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
    http_request: Request = None
):
    """Create a smart prompt for a claim"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Creating smart prompt for claim {request.claim_id} by user {user_id}")
        
        # Get client IP and user agent
        ip_address = http_request.client.host if http_request else None
        user_agent = http_request.headers.get("user-agent") if http_request else None
        
        # Create smart prompt
        response = await smart_prompt_service_v2.create_smart_prompt(
            request=request,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Failed to create smart prompt: {e}")
        raise HTTPException(status_code=500, detail="Failed to create smart prompt")

@router.post("/api/v1/evidence/prompts/{prompt_id}/answer", response_model=SmartPromptAnswerResponse)
async def answer_smart_prompt(
    prompt_id: str,
    answer: SmartPromptAnswer,
    user: dict = Depends(get_current_user),
    http_request: Request = None
):
    """Answer a smart prompt"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Answering smart prompt {prompt_id} by user {user_id}")
        
        # Get client IP and user agent
        ip_address = http_request.client.host if http_request else None
        user_agent = http_request.headers.get("user-agent") if http_request else None
        
        # Answer smart prompt
        response = await smart_prompt_service_v2.answer_smart_prompt(
            prompt_id=prompt_id,
            answer=answer,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Failed to answer smart prompt: {e}")
        raise HTTPException(status_code=500, detail="Failed to answer smart prompt")

@router.get("/api/v1/evidence/prompts/{claim_id}")
async def get_claim_prompts(
    claim_id: str,
    status: Optional[str] = Query(None, description="Filter by prompt status"),
    user: dict = Depends(get_current_user)
):
    """Get all prompts for a specific claim"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting prompts for claim {claim_id} by user {user_id}")
        
        # Get prompts for claim
        prompts = await smart_prompt_service_v2.get_claim_prompts(
            claim_id=claim_id,
            user_id=user_id,
            status=status
        )
        
        return {
            "ok": True,
            "data": {
                "prompts": prompts,
                "total": len(prompts),
                "claim_id": claim_id
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get claim prompts: {e}")
        raise HTTPException(status_code=500, detail="Failed to get claim prompts")

@router.delete("/api/v1/evidence/prompts/{prompt_id}")
async def cancel_smart_prompt(
    prompt_id: str,
    user: dict = Depends(get_current_user),
    http_request: Request = None
):
    """Cancel a pending smart prompt"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Cancelling smart prompt {prompt_id} by user {user_id}")
        
        # Get client IP and user agent
        ip_address = http_request.client.host if http_request else None
        user_agent = http_request.headers.get("user-agent") if http_request else None
        
        # Cancel smart prompt
        success = await smart_prompt_service_v2.cancel_smart_prompt(
            prompt_id=prompt_id,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        if success:
            return {
                "ok": True,
                "message": "Smart prompt cancelled successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Smart prompt not found or already processed")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel smart prompt: {e}")
        raise HTTPException(status_code=500, detail="Failed to cancel smart prompt")

@router.post("/api/v1/evidence/proof-packets/{claim_id}/generate")
async def generate_proof_packet(
    claim_id: str,
    background_tasks: BackgroundTasks,
    payout_details: Optional[Dict[str, Any]] = None,
    user: dict = Depends(get_current_user)
):
    """Generate proof packet for a claim after payout confirmation"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Generating proof packet for claim {claim_id} by user {user_id}")
        
        # Start background task for packet generation
        background_tasks.add_task(
            _generate_proof_packet_async,
            claim_id,
            user_id,
            payout_details or {}
        )
        
        return {
            "ok": True,
            "message": "Proof packet generation started",
            "claim_id": claim_id
        }
        
    except Exception as e:
        logger.error(f"Failed to start proof packet generation: {e}")
        raise HTTPException(status_code=500, detail="Failed to start proof packet generation")

@router.get("/api/v1/evidence/proof-packets/{claim_id}")
async def get_proof_packet_url(
    claim_id: str,
    hours_valid: int = Query(24, ge=1, le=168, description="Hours the signed URL is valid"),
    user: dict = Depends(get_current_user)
):
    """Get signed URL for proof packet download"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting proof packet URL for claim {claim_id} by user {user_id}")
        
        # Get proof packet URL
        packet_url = await proof_packet_worker.get_proof_packet_url(
            claim_id=claim_id,
            user_id=user_id,
            hours_valid=hours_valid
        )
        
        if packet_url:
            return {
                "ok": True,
                "data": {
                    "packet_url": packet_url,
                    "claim_id": claim_id,
                    "hours_valid": hours_valid,
                    "expires_at": (datetime.utcnow().timestamp() + (hours_valid * 3600))
                }
            }
        else:
            raise HTTPException(status_code=404, detail="Proof packet not found or not ready")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get proof packet URL: {e}")
        raise HTTPException(status_code=500, detail="Failed to get proof packet URL")

@router.get("/api/v1/evidence/proof-packets/{claim_id}/status")
async def get_proof_packet_status(
    claim_id: str,
    user: dict = Depends(get_current_user)
):
    """Get proof packet generation status"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting proof packet status for claim {claim_id} by user {user_id}")
        
        # Get packet status from database
        from src.common.db_postgresql import DatabaseManager
        db = DatabaseManager()
        
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, status, generation_started_at, generation_completed_at, 
                           error_message, packet_size_bytes, created_at
                    FROM proof_packets 
                    WHERE claim_id = %s AND user_id = %s
                    ORDER BY created_at DESC LIMIT 1
                """, (claim_id, user_id))
                
                result = cursor.fetchone()
                if result:
                    return {
                        "ok": True,
                        "data": {
                            "packet_id": str(result[0]),
                            "status": result[1],
                            "generation_started_at": result[2].isoformat() + "Z" if result[2] else None,
                            "generation_completed_at": result[3].isoformat() + "Z" if result[3] else None,
                            "error_message": result[4],
                            "packet_size_bytes": result[5],
                            "created_at": result[6].isoformat() + "Z"
                        }
                    }
                else:
                    raise HTTPException(status_code=404, detail="Proof packet not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get proof packet status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get proof packet status")

@router.get("/api/v1/evidence/audit-log/{claim_id}")
async def get_claim_audit_log(
    claim_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """Get audit log for a specific claim"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting audit log for claim {claim_id} by user {user_id}")
        
        # Get audit log from database
        from src.common.db_postgresql import DatabaseManager
        db = DatabaseManager()
        
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, action, entity_type, entity_id, details, 
                           ip_address, user_agent, created_at
                    FROM audit_log 
                    WHERE claim_id = %s AND user_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                """, (claim_id, user_id, limit, offset))
                
                audit_entries = []
                for row in cursor.fetchall():
                    audit_entries.append({
                        "id": str(row[0]),
                        "action": row[1],
                        "entity_type": row[2],
                        "entity_id": str(row[3]),
                        "details": row[4],
                        "ip_address": row[5],
                        "user_agent": row[6],
                        "created_at": row[7].isoformat() + "Z"
                    })
                
                # Get total count
                cursor.execute("""
                    SELECT COUNT(*) FROM audit_log 
                    WHERE claim_id = %s AND user_id = %s
                """, (claim_id, user_id))
                total = cursor.fetchone()[0]
                
                return {
                    "ok": True,
                    "data": {
                        "audit_entries": audit_entries,
                        "total": total,
                        "has_more": offset + len(audit_entries) < total,
                        "pagination": {
                            "limit": limit,
                            "offset": offset,
                            "total": total,
                            "has_more": offset + len(audit_entries) < total
                        }
                    }
                }
        
    except Exception as e:
        logger.error(f"Failed to get audit log: {e}")
        raise HTTPException(status_code=500, detail="Failed to get audit log")

async def _generate_proof_packet_async(
    claim_id: str, 
    user_id: str, 
    payout_details: Dict[str, Any]
):
    """Background task to generate proof packet"""
    try:
        result = await proof_packet_worker.generate_proof_packet(
            claim_id=claim_id,
            user_id=user_id,
            payout_details=payout_details
        )
        
        if result["success"]:
            logger.info(f"Proof packet generated successfully for claim {claim_id}")
            
            # Broadcast completion event
            await websocket_manager.broadcast_to_user(
                user_id=user_id,
                event="packet.generated",
                data={
                    "claim_id": claim_id,
                    "packet_id": result["packet_id"],
                    "pdf_url": result["pdf_url"],
                    "zip_url": result["zip_url"],
                    "generated_at": result["generated_at"]
                }
            )
        else:
            logger.error(f"Proof packet generation failed for claim {claim_id}: {result['error']}")
            
            # Broadcast failure event
            await websocket_manager.broadcast_to_user(
                user_id=user_id,
                event="packet.failed",
                data={
                    "claim_id": claim_id,
                    "error": result["error"],
                    "failed_at": result["failed_at"]
                }
            )
            
    except Exception as e:
        logger.error(f"Background proof packet generation failed for claim {claim_id}: {e}")
        
        # Broadcast failure event
        await websocket_manager.broadcast_to_user(
            user_id=user_id,
            event="packet.failed",
            data={
                "claim_id": claim_id,
                "error": str(e),
                "failed_at": datetime.utcnow().isoformat() + "Z"
            }
        )
