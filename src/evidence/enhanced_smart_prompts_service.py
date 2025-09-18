"""
Enhanced Smart Prompts Service
Handles smart prompts with real-time events, expiry handling, and zero-effort evidence loop
"""

import uuid
import json
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import logging

from src.api.schemas import (
    SmartPrompt, SmartPromptAnswer, SmartPromptAnswerResponse, 
    PromptStatus, DisputeEvidenceLink, LinkType
)
from src.common.db_postgresql import DatabaseManager
from src.evidence.auto_submit_service import AutoSubmitService
from src.common.config import settings

logger = logging.getLogger(__name__)

class EnhancedSmartPromptsService:
    """Enhanced service for managing smart prompts with real-time events"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.auto_submit_service = AutoSubmitService()
        self.event_handlers = []
        self.expiry_check_interval = 300  # 5 minutes
        self.is_running = False
    
    async def start(self):
        """Start the enhanced smart prompts service"""
        self.is_running = True
        logger.info("Enhanced Smart Prompts Service started")
        
        # Start background tasks
        asyncio.create_task(self._expiry_checker())
        asyncio.create_task(self._cleanup_expired_prompts())
    
    async def stop(self):
        """Stop the enhanced smart prompts service"""
        self.is_running = False
        logger.info("Enhanced Smart Prompts Service stopped")
    
    def add_event_handler(self, handler):
        """Add an event handler for real-time notifications"""
        self.event_handlers.append(handler)
    
    async def emit_event(self, event_type: str, data: Dict[str, Any]):
        """Emit an event to all registered handlers"""
        for handler in self.event_handlers:
            try:
                await handler(event_type, data)
            except Exception as e:
                logger.error(f"Event handler error: {e}")
    
    async def create_smart_prompt(
        self, 
        user_id: str,
        dispute_id: str, 
        evidence_document_id: str, 
        question: str, 
        options: List[Dict[str, Any]],
        expires_in_hours: int = 24
    ) -> SmartPrompt:
        """Create a smart prompt for ambiguous evidence match with real-time notification"""
        try:
            # Check feature flag
            if not settings.FEATURE_FLAG_EV_SMART_PROMPTS:
                raise Exception("Smart prompts feature is disabled")
            
            prompt_id = str(uuid.uuid4())
            expires_at = datetime.utcnow() + timedelta(hours=expires_in_hours)
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO smart_prompts 
                        (id, user_id, dispute_id, evidence_document_id, question, options, expires_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        prompt_id, user_id, dispute_id, evidence_document_id,
                        question, json.dumps(options), expires_at
                    ))
            
            # Create prompt object
            prompt = SmartPrompt(
                id=prompt_id,
                user_id=user_id,
                dispute_id=dispute_id,
                evidence_document_id=evidence_document_id,
                question=question,
                options=options,
                status=PromptStatus.PENDING,
                expires_at=expires_at.isoformat() + "Z",
                created_at=datetime.utcnow().isoformat() + "Z",
                updated_at=datetime.utcnow().isoformat() + "Z"
            )
            
            # Emit real-time event
            await self.emit_event("prompt_created", {
                "prompt_id": prompt_id,
                "user_id": user_id,
                "dispute_id": dispute_id,
                "question": question,
                "options": options,
                "expires_at": expires_at.isoformat() + "Z"
            })
            
            logger.info(f"Smart prompt created: {prompt_id} for user {user_id}")
            return prompt
            
        except Exception as e:
            logger.error(f"Failed to create smart prompt: {e}")
            raise
    
    async def answer_smart_prompt(
        self, 
        prompt_id: str, 
        answer: SmartPromptAnswer,
        user_id: str
    ) -> SmartPromptAnswerResponse:
        """Answer a smart prompt with real-time event emission"""
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
            
            # Verify user ownership
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
            
            # Find the selected option
            selected_option = None
            for option in prompt['options']:
                if option['id'] == answer.selected_option:
                    selected_option = option
                    break
            
            if not selected_option:
                return SmartPromptAnswerResponse(
                    success=False,
                    prompt_id=prompt_id,
                    action_taken="error",
                    message="Invalid option selected"
                )
            
            # Update prompt with answer
            await self._update_smart_prompt_answer(
                prompt_id, 
                answer.selected_option, 
                answer.reasoning
            )
            
            # Process the action based on selected option
            action_result = await self._process_prompt_action(
                prompt, 
                selected_option, 
                answer.reasoning
            )
            
            # Emit real-time event
            await self.emit_event("prompt_answered", {
                "prompt_id": prompt_id,
                "user_id": user_id,
                "dispute_id": prompt['dispute_id'],
                "selected_option": answer.selected_option,
                "action_taken": action_result['action'],
                "message": action_result['message']
            })
            
            # Audit log the decision
            await self._audit_log_decision(
                prompt_id, 
                user_id, 
                answer.selected_option, 
                action_result['action'],
                answer.reasoning
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
    
    async def get_user_smart_prompts(
        self, 
        user_id: str, 
        status: Optional[str] = None,
        limit: int = 10,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Get smart prompts for a user with enhanced filtering"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Build query
                    where_clause = "WHERE dc.user_id = %s"
                    params = [user_id]
                    
                    if status:
                        where_clause += " AND sp.status = %s"
                        params.append(status)
                    
                    # Get prompts
                    cursor.execute(f"""
                        SELECT sp.id, sp.dispute_id, sp.evidence_document_id, sp.question,
                               sp.options, sp.status, sp.selected_option, sp.answered_at,
                               sp.expires_at, sp.created_at, sp.updated_at,
                               dc.order_id, dc.dispute_type, dc.amount_claimed,
                               ed.filename, ed.content_type
                        FROM smart_prompts sp
                        JOIN dispute_cases dc ON sp.dispute_id = dc.id
                        JOIN evidence_documents ed ON sp.evidence_document_id = ed.id
                        {where_clause}
                        ORDER BY sp.created_at DESC
                        LIMIT %s OFFSET %s
                    """, params + [limit, offset])
                    
                    prompts = []
                    for row in cursor.fetchall():
                        prompts.append({
                            "id": str(row[0]),
                            "dispute_id": str(row[1]),
                            "evidence_document_id": str(row[2]),
                            "question": row[3],
                            "options": json.loads(row[4]) if row[4] else [],
                            "status": row[5],
                            "selected_option": row[6],
                            "answered_at": row[7].isoformat() + "Z" if row[7] else None,
                            "expires_at": row[8].isoformat() + "Z",
                            "created_at": row[9].isoformat() + "Z",
                            "updated_at": row[10].isoformat() + "Z",
                            "dispute_info": {
                                "order_id": row[11],
                                "dispute_type": row[12],
                                "amount_claimed": row[13]
                            },
                            "evidence_info": {
                                "filename": row[14],
                                "content_type": row[15]
                            }
                        })
                    
                    # Get total count
                    cursor.execute(f"""
                        SELECT COUNT(*) 
                        FROM smart_prompts sp
                        JOIN dispute_cases dc ON sp.dispute_id = dc.id
                        {where_clause}
                    """, params)
                    total = cursor.fetchone()[0]
                    
                    return {
                        "prompts": prompts,
                        "total": total,
                        "has_more": offset + len(prompts) < total
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get smart prompts for user {user_id}: {e}")
            raise
    
    async def dismiss_smart_prompt(self, prompt_id: str, user_id: str) -> bool:
        """Dismiss a smart prompt with real-time notification"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Verify ownership and update
                    cursor.execute("""
                        UPDATE smart_prompts 
                        SET status = 'dismissed', updated_at = NOW()
                        WHERE id = %s AND user_id = %s AND status = 'pending'
                    """, (prompt_id, user_id))
                    
                    if cursor.rowcount > 0:
                        # Emit real-time event
                        await self.emit_event("prompt_dismissed", {
                            "prompt_id": prompt_id,
                            "user_id": user_id
                        })
                        return True
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to dismiss smart prompt {prompt_id}: {e}")
            return False
    
    async def _expiry_checker(self):
        """Background task to check for expiring prompts"""
        while self.is_running:
            try:
                await self._check_expiring_prompts()
                await asyncio.sleep(self.expiry_check_interval)
            except Exception as e:
                logger.error(f"Expiry checker error: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error
    
    async def _check_expiring_prompts(self):
        """Check for prompts expiring soon and send notifications"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Find prompts expiring in the next hour
                    cursor.execute("""
                        SELECT id, user_id, dispute_id, question, expires_at
                        FROM smart_prompts 
                        WHERE status = 'pending' 
                        AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '1 hour'
                        ORDER BY expires_at ASC
                    """)
                    
                    expiring_prompts = cursor.fetchall()
                    for prompt in expiring_prompts:
                        await self.emit_event("prompt_expiring_soon", {
                            "prompt_id": str(prompt[0]),
                            "user_id": str(prompt[1]),
                            "dispute_id": str(prompt[2]),
                            "question": prompt[3],
                            "expires_at": prompt[4].isoformat() + "Z"
                        })
                        
        except Exception as e:
            logger.error(f"Failed to check expiring prompts: {e}")
    
    async def _cleanup_expired_prompts(self):
        """Background task to cleanup expired prompts"""
        while self.is_running:
            try:
                expired_count = await self.cleanup_expired_prompts()
                if expired_count > 0:
                    logger.info(f"Cleaned up {expired_count} expired smart prompts")
                await asyncio.sleep(3600)  # Check every hour
            except Exception as e:
                logger.error(f"Cleanup expired prompts error: {e}")
                await asyncio.sleep(300)  # Wait 5 minutes on error
    
    async def cleanup_expired_prompts(self) -> int:
        """Clean up expired smart prompts"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get expired prompts before cleanup
                    cursor.execute("""
                        SELECT id, user_id, dispute_id
                        FROM smart_prompts 
                        WHERE status = 'pending' AND expires_at < NOW()
                    """)
                    
                    expired_prompts = cursor.fetchall()
                    
                    # Update status to expired
                    cursor.execute("""
                        UPDATE smart_prompts 
                        SET status = 'expired', updated_at = NOW()
                        WHERE status = 'pending' AND expires_at < NOW()
                    """)
                    
                    # Emit events for expired prompts
                    for prompt in expired_prompts:
                        await self.emit_event("prompt_expired", {
                            "prompt_id": str(prompt[0]),
                            "user_id": str(prompt[1]),
                            "dispute_id": str(prompt[2])
                        })
                    
                    return cursor.rowcount
                    
        except Exception as e:
            logger.error(f"Failed to cleanup expired prompts: {e}")
            return 0
    
    async def _get_smart_prompt(self, prompt_id: str) -> Optional[Dict[str, Any]]:
        """Get smart prompt by ID"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, user_id, dispute_id, evidence_document_id, question, options,
                           status, selected_option, answered_at, expires_at, created_at, updated_at
                    FROM smart_prompts 
                    WHERE id = %s
                """, (prompt_id,))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'user_id': str(result[1]),
                        'dispute_id': str(result[2]),
                        'evidence_document_id': str(result[3]),
                        'question': result[4],
                        'options': json.loads(result[5]) if result[5] else [],
                        'status': result[6],
                        'selected_option': result[7],
                        'answered_at': result[8].isoformat() + "Z" if result[8] else None,
                        'expires_at': result[9].isoformat() + "Z",
                        'created_at': result[10].isoformat() + "Z",
                        'updated_at': result[11].isoformat() + "Z"
                    }
                return None
    
    async def _update_smart_prompt_answer(
        self, 
        prompt_id: str, 
        selected_option: str, 
        reasoning: Optional[str]
    ):
        """Update smart prompt with answer"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE smart_prompts 
                    SET status = 'answered', selected_option = %s, answered_at = NOW(), updated_at = NOW()
                    WHERE id = %s
                """, (selected_option, prompt_id))
    
    async def _process_prompt_action(
        self, 
        prompt: Dict[str, Any], 
        selected_option: Dict[str, Any], 
        reasoning: Optional[str]
    ) -> Dict[str, str]:
        """Process the action based on selected option"""
        action = selected_option.get('action', 'unknown')
        
        if action == 'confirm_match':
            # Create evidence link and potentially auto-submit
            await self._create_evidence_link_from_prompt(prompt, LinkType.SMART_PROMPT_CONFIRMED)
            
            # Check if we should auto-submit
            dispute = await self._get_dispute_case(prompt['dispute_id'])
            if dispute and dispute.get('auto_submit_ready'):
                # Try auto-submit
                auto_submit_result = await self.auto_submit_service.auto_submit_evidence({
                    "dispute_id": prompt['dispute_id'],
                    "evidence_document_id": prompt['evidence_document_id'],
                    "confidence": 0.8,  # High confidence since user confirmed
                    "reasoning": f"User confirmed match via smart prompt: {reasoning or 'No additional reasoning'}"
                })
                
                if auto_submit_result.success:
                    return {
                        "action": "auto_submitted",
                        "message": "Evidence confirmed and auto-submitted successfully"
                    }
                else:
                    return {
                        "action": "confirmed_manual_review",
                        "message": "Evidence confirmed but requires manual review for submission"
                    }
            else:
                return {
                    "action": "confirmed",
                    "message": "Evidence confirmed and linked to dispute"
                }
        
        elif action == 'reject_match':
            # Mark as rejected, no action needed
            return {
                "action": "rejected",
                "message": "Evidence match rejected"
            }
        
        elif action == 'manual_review':
            # Move to manual review
            await self._update_dispute_status(prompt['dispute_id'], 'manual_review')
            return {
                "action": "manual_review",
                "message": "Moved to manual review for further analysis"
            }
        
        else:
            return {
                "action": "unknown",
                "message": "Unknown action selected"
            }
    
    async def _create_evidence_link_from_prompt(
        self, 
        prompt: Dict[str, Any], 
        link_type: LinkType
    ):
        """Create evidence link from smart prompt confirmation"""
        link_id = str(uuid.uuid4())
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                # Create evidence link
                cursor.execute("""
                    INSERT INTO dispute_evidence_links 
                    (id, dispute_id, evidence_document_id, link_type, confidence, match_reasoning)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    link_id, prompt['dispute_id'], prompt['evidence_document_id'],
                    link_type.value, 0.8, "User confirmed via smart prompt"
                ))
                
                # Update dispute evidence linked IDs
                cursor.execute("""
                    UPDATE dispute_cases 
                    SET evidence_linked_ids = COALESCE(evidence_linked_ids, '[]'::jsonb) || %s::jsonb
                    WHERE id = %s
                """, (json.dumps([prompt['evidence_document_id']]), prompt['dispute_id']))
    
    async def _get_dispute_case(self, dispute_id: str) -> Optional[Dict[str, Any]]:
        """Get dispute case by ID"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, user_id, order_id, asin, sku, dispute_type, status,
                           amount_claimed, currency, dispute_date, order_date, metadata
                    FROM dispute_cases 
                    WHERE id = %s
                """, (dispute_id,))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'user_id': str(result[1]),
                        'order_id': result[2],
                        'asin': result[3],
                        'sku': result[4],
                        'dispute_type': result[5],
                        'status': result[6],
                        'amount_claimed': result[7],
                        'currency': result[8],
                        'dispute_date': result[9].isoformat() if result[9] else None,
                        'order_date': result[10].isoformat() if result[10] else None,
                        'metadata': json.loads(result[11]) if result[11] else {}
                    }
                return None
    
    async def _update_dispute_status(self, dispute_id: str, status: str):
        """Update dispute case status"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE dispute_cases 
                    SET status = %s, updated_at = NOW()
                    WHERE id = %s
                """, (status, dispute_id))
    
    async def _audit_log_decision(
        self, 
        prompt_id: str, 
        user_id: str, 
        selected_option: str, 
        action_taken: str,
        reasoning: Optional[str]
    ):
        """Audit log every decision for compliance"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO audit_logs 
                        (id, user_id, action_type, resource_id, details, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (
                        str(uuid.uuid4()),
                        user_id,
                        'smart_prompt_answered',
                        prompt_id,
                        json.dumps({
                            'selected_option': selected_option,
                            'action_taken': action_taken,
                            'reasoning': reasoning,
                            'timestamp': datetime.utcnow().isoformat() + "Z"
                        }),
                        datetime.utcnow()
                    ))
        except Exception as e:
            logger.error(f"Failed to audit log decision: {e}")

# Global enhanced smart prompts service instance
enhanced_smart_prompts_service = EnhancedSmartPromptsService()

