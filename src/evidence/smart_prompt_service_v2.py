"""
Enhanced Smart Prompt Service
Phase 4: Real-time prompts with WebSocket/SSE support and comprehensive audit logging
"""

import uuid
import json
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass
from enum import Enum

from src.api.schemas import (
    SmartPromptRequest, SmartPromptResponse, SmartPromptAnswer, 
    SmartPromptAnswerResponse, PromptStatus, AuditAction
)
from src.common.db_postgresql import DatabaseManager
from src.common.config import settings
from src.websocket.websocket_manager import WebSocketManager

logger = logging.getLogger(__name__)

@dataclass
class PromptEvent:
    """Event data for WebSocket broadcasting"""
    event_type: str
    prompt_id: str
    claim_id: str
    user_id: str
    data: Dict[str, Any]
    timestamp: str

class SmartPromptServiceV2:
    """Enhanced Smart Prompt Service with real-time capabilities"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.websocket_manager = WebSocketManager()
        self.default_expiry_hours = 24  # Default prompt expiry
        self.cleanup_interval = 300  # 5 minutes cleanup interval
        
    async def create_smart_prompt(
        self, 
        request: SmartPromptRequest,
        user_id: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> SmartPromptResponse:
        """Create a smart prompt for a claim with real-time broadcasting"""
        try:
            prompt_id = str(uuid.uuid4())
            expires_at = datetime.utcnow() + timedelta(hours=request.expiry_hours or self.default_expiry_hours)
            
            # Create prompt in database
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO evidence_prompts 
                        (id, claim_id, user_id, question, options, expires_at, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        prompt_id, request.claim_id, user_id, request.question,
                        json.dumps(request.options), expires_at, json.dumps(request.metadata or {})
                    ))
            
            # Log audit event
            await self._log_audit_event(
                user_id=user_id,
                claim_id=request.claim_id,
                action=AuditAction.PROMPT_CREATED,
                entity_type="evidence_prompt",
                entity_id=prompt_id,
                details={
                    "question": request.question,
                    "options_count": len(request.options),
                    "expiry_hours": request.expiry_hours or self.default_expiry_hours
                },
                ip_address=ip_address,
                user_agent=user_agent
            )
            
            # Broadcast real-time event
            await self._broadcast_prompt_event(
                event_type="prompt.created",
                prompt_id=prompt_id,
                claim_id=request.claim_id,
                user_id=user_id,
                data={
                    "question": request.question,
                    "options": request.options,
                    "expires_at": expires_at.isoformat() + "Z",
                    "expiry_hours": request.expiry_hours or self.default_expiry_hours
                }
            )
            
            return SmartPromptResponse(
                prompt_id=prompt_id,
                claim_id=request.claim_id,
                question=request.question,
                options=request.options,
                status=PromptStatus.PENDING,
                expires_at=expires_at.isoformat() + "Z",
                created_at=datetime.utcnow().isoformat() + "Z"
            )
            
        except Exception as e:
            logger.error(f"Failed to create smart prompt: {e}")
            raise
    
    async def answer_smart_prompt(
        self, 
        prompt_id: str,
        answer: SmartPromptAnswer,
        user_id: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> SmartPromptAnswerResponse:
        """Answer a smart prompt with real-time broadcasting"""
        try:
            # Get the prompt
            prompt = await self._get_smart_prompt(prompt_id)
            if not prompt:
                return SmartPromptAnswerResponse(
                    success=False,
                    prompt_id=prompt_id,
                    action_taken="error",
                    message="Smart prompt not found"
                )
            
            # Validate ownership
            if prompt['user_id'] != user_id:
                return SmartPromptAnswerResponse(
                    success=False,
                    prompt_id=prompt_id,
                    action_taken="error",
                    message="Unauthorized access to prompt"
                )
            
            # Check if prompt is still valid
            if prompt['status'] != 'pending':
                return SmartPromptAnswerResponse(
                    success=False,
                    prompt_id=prompt_id,
                    action_taken="error",
                    message="Smart prompt is no longer pending"
                )
            
            if datetime.utcnow() > datetime.fromisoformat(prompt['expires_at'].replace('Z', '+00:00')):
                return SmartPromptAnswerResponse(
                    success=False,
                    prompt_id=prompt_id,
                    action_taken="expired",
                    message="Smart prompt has expired"
                )
            
            # Validate answer
            valid_option = self._validate_answer(prompt['options'], answer.selected_option)
            if not valid_option:
                return SmartPromptAnswerResponse(
                    success=False,
                    prompt_id=prompt_id,
                    action_taken="error",
                    message="Invalid option selected"
                )
            
            # Update prompt with answer
            answered_at = datetime.utcnow()
            await self._update_prompt_answer(
                prompt_id, 
                answer.selected_option, 
                answer.reasoning,
                answered_at
            )
            
            # Log audit event
            await self._log_audit_event(
                user_id=user_id,
                claim_id=prompt['claim_id'],
                action=AuditAction.PROMPT_ANSWERED,
                entity_type="evidence_prompt",
                entity_id=prompt_id,
                details={
                    "selected_option": answer.selected_option,
                    "reasoning": answer.reasoning,
                    "answered_at": answered_at.isoformat() + "Z"
                },
                ip_address=ip_address,
                user_agent=user_agent
            )
            
            # Process the action based on selected option
            action_result = await self._process_prompt_action(
                prompt, 
                valid_option, 
                answer.reasoning
            )
            
            # Broadcast real-time event
            await self._broadcast_prompt_event(
                event_type="prompt.answered",
                prompt_id=prompt_id,
                claim_id=prompt['claim_id'],
                user_id=user_id,
                data={
                    "selected_option": answer.selected_option,
                    "reasoning": answer.reasoning,
                    "action_taken": action_result['action'],
                    "answered_at": answered_at.isoformat() + "Z"
                }
            )
            
            return SmartPromptAnswerResponse(
                success=True,
                prompt_id=prompt_id,
                action_taken=action_result['action'],
                message=action_result['message']
            )
            
        except Exception as e:
            logger.error(f"Failed to answer smart prompt {prompt_id}: {e}")
            return SmartPromptAnswerResponse(
                success=False,
                prompt_id=prompt_id,
                action_taken="error",
                message=f"Failed to process answer: {str(e)}"
            )
    
    async def get_claim_prompts(
        self, 
        claim_id: str, 
        user_id: str,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get all prompts for a specific claim"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Build query
                    where_clause = "WHERE claim_id = %s AND user_id = %s"
                    params = [claim_id, user_id]
                    
                    if status:
                        where_clause += " AND status = %s"
                        params.append(status)
                    
                    cursor.execute(f"""
                        SELECT id, question, options, status, answer, answer_reasoning,
                               answered_at, expires_at, created_at, updated_at, metadata
                        FROM evidence_prompts 
                        {where_clause}
                        ORDER BY created_at DESC
                    """, params)
                    
                    prompts = []
                    for row in cursor.fetchall():
                        prompts.append({
                            "id": str(row[0]),
                            "question": row[1],
                            "options": json.loads(row[2]) if row[2] else [],
                            "status": row[3],
                            "answer": row[4],
                            "answer_reasoning": row[5],
                            "answered_at": row[6].isoformat() + "Z" if row[6] else None,
                            "expires_at": row[7].isoformat() + "Z",
                            "created_at": row[8].isoformat() + "Z",
                            "updated_at": row[9].isoformat() + "Z",
                            "metadata": json.loads(row[10]) if row[10] else {}
                        })
                    
                    return prompts
                    
        except Exception as e:
            logger.error(f"Failed to get prompts for claim {claim_id}: {e}")
            raise
    
    async def cancel_smart_prompt(
        self, 
        prompt_id: str, 
        user_id: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> bool:
        """Cancel a pending smart prompt"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE evidence_prompts 
                        SET status = 'cancelled', updated_at = NOW()
                        WHERE id = %s AND user_id = %s AND status = 'pending'
                    """, (prompt_id, user_id))
                    
                    if cursor.rowcount > 0:
                        # Get prompt details for audit
                        prompt = await self._get_smart_prompt(prompt_id)
                        
                        # Log audit event
                        await self._log_audit_event(
                            user_id=user_id,
                            claim_id=prompt['claim_id'] if prompt else None,
                            action=AuditAction.PROMPT_CANCELLED,
                            entity_type="evidence_prompt",
                            entity_id=prompt_id,
                            details={"cancelled_at": datetime.utcnow().isoformat() + "Z"},
                            ip_address=ip_address,
                            user_agent=user_agent
                        )
                        
                        # Broadcast real-time event
                        if prompt:
                            await self._broadcast_prompt_event(
                                event_type="prompt.cancelled",
                                prompt_id=prompt_id,
                                claim_id=prompt['claim_id'],
                                user_id=user_id,
                                data={"cancelled_at": datetime.utcnow().isoformat() + "Z"}
                            )
                        
                        return True
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to cancel smart prompt {prompt_id}: {e}")
            return False
    
    async def cleanup_expired_prompts(self) -> int:
        """Clean up expired prompts and broadcast events"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get expired prompts before updating
                    cursor.execute("""
                        SELECT id, claim_id, user_id FROM evidence_prompts 
                        WHERE status = 'pending' AND expires_at < NOW()
                    """)
                    expired_prompts = cursor.fetchall()
                    
                    # Update status to expired
                    cursor.execute("""
                        UPDATE evidence_prompts 
                        SET status = 'expired', updated_at = NOW()
                        WHERE status = 'pending' AND expires_at < NOW()
                    """)
                    
                    expired_count = cursor.rowcount
                    
                    # Log audit events and broadcast for each expired prompt
                    for prompt_id, claim_id, user_id in expired_prompts:
                        await self._log_audit_event(
                            user_id=user_id,
                            claim_id=claim_id,
                            action=AuditAction.PROMPT_EXPIRED,
                            entity_type="evidence_prompt",
                            entity_id=prompt_id,
                            details={"expired_at": datetime.utcnow().isoformat() + "Z"}
                        )
                        
                        await self._broadcast_prompt_event(
                            event_type="prompt.expired",
                            prompt_id=prompt_id,
                            claim_id=claim_id,
                            user_id=user_id,
                            data={"expired_at": datetime.utcnow().isoformat() + "Z"}
                        )
                    
                    return expired_count
                    
        except Exception as e:
            logger.error(f"Failed to cleanup expired prompts: {e}")
            return 0
    
    async def start_cleanup_scheduler(self):
        """Start background task for cleaning up expired prompts"""
        while True:
            try:
                await asyncio.sleep(self.cleanup_interval)
                expired_count = await self.cleanup_expired_prompts()
                if expired_count > 0:
                    logger.info(f"Cleaned up {expired_count} expired prompts")
            except Exception as e:
                logger.error(f"Cleanup scheduler error: {e}")
    
    async def _get_smart_prompt(self, prompt_id: str) -> Optional[Dict[str, Any]]:
        """Get smart prompt by ID"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, claim_id, user_id, question, options, status, 
                           answer, answer_reasoning, answered_at, expires_at, 
                           created_at, updated_at, metadata
                    FROM evidence_prompts 
                    WHERE id = %s
                """, (prompt_id,))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'claim_id': str(result[1]),
                        'user_id': str(result[2]),
                        'question': result[3],
                        'options': json.loads(result[4]) if result[4] else [],
                        'status': result[5],
                        'answer': result[6],
                        'answer_reasoning': result[7],
                        'answered_at': result[8].isoformat() + "Z" if result[8] else None,
                        'expires_at': result[9].isoformat() + "Z",
                        'created_at': result[10].isoformat() + "Z",
                        'updated_at': result[11].isoformat() + "Z",
                        'metadata': json.loads(result[12]) if result[12] else {}
                    }
                return None
    
    def _validate_answer(self, options: List[Dict[str, Any]], selected_option: str) -> Optional[Dict[str, Any]]:
        """Validate that the selected option is valid"""
        for option in options:
            if option.get('id') == selected_option:
                return option
        return None
    
    async def _update_prompt_answer(
        self, 
        prompt_id: str, 
        selected_option: str, 
        reasoning: Optional[str],
        answered_at: datetime
    ):
        """Update prompt with answer"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE evidence_prompts 
                    SET status = 'answered', answer = %s, answer_reasoning = %s, 
                        answered_at = %s, updated_at = NOW()
                    WHERE id = %s
                """, (selected_option, reasoning, answered_at, prompt_id))
    
    async def _process_prompt_action(
        self, 
        prompt: Dict[str, Any], 
        selected_option: Dict[str, Any], 
        reasoning: Optional[str]
    ) -> Dict[str, str]:
        """Process the action based on selected option"""
        action = selected_option.get('action', 'unknown')
        
        if action == 'confirm_evidence':
            return {
                "action": "evidence_confirmed",
                "message": "Evidence confirmed and linked to claim"
            }
        elif action == 'reject_evidence':
            return {
                "action": "evidence_rejected",
                "message": "Evidence rejected and removed from claim"
            }
        elif action == 'request_additional':
            return {
                "action": "additional_evidence_requested",
                "message": "Additional evidence requested for claim"
            }
        elif action == 'escalate_manual':
            return {
                "action": "escalated_manual_review",
                "message": "Claim escalated to manual review"
            }
        else:
            return {
                "action": "unknown",
                "message": "Unknown action selected"
            }
    
    async def _broadcast_prompt_event(
        self, 
        event_type: str, 
        prompt_id: str, 
        claim_id: str, 
        user_id: str, 
        data: Dict[str, Any]
    ):
        """Broadcast prompt event via WebSocket"""
        try:
            event = PromptEvent(
                event_type=event_type,
                prompt_id=prompt_id,
                claim_id=claim_id,
                user_id=user_id,
                data=data,
                timestamp=datetime.utcnow().isoformat() + "Z"
            )
            
            # Broadcast to user's WebSocket connections
            await self.websocket_manager.broadcast_to_user(
                user_id=user_id,
                event=event_type,
                data={
                    "prompt_id": prompt_id,
                    "claim_id": claim_id,
                    "timestamp": event.timestamp,
                    **data
                }
            )
            
        except Exception as e:
            logger.error(f"Failed to broadcast prompt event {event_type}: {e}")
    
    async def _log_audit_event(
        self,
        user_id: str,
        claim_id: Optional[str],
        action: AuditAction,
        entity_type: str,
        entity_id: str,
        details: Dict[str, Any],
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ):
        """Log audit event to database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT log_audit_event(%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        user_id, claim_id, action.value, entity_type, entity_id,
                        json.dumps(details), ip_address, user_agent
                    ))
        except Exception as e:
            logger.error(f"Failed to log audit event: {e}")

# Global instance
smart_prompt_service_v2 = SmartPromptServiceV2()
