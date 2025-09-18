"""
Smart Prompts Service
Handles smart prompts for ambiguous evidence matches
"""

import uuid
import json
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import logging

from src.api.schemas import (
    SmartPrompt, SmartPromptAnswer, SmartPromptAnswerResponse, 
    PromptStatus, DisputeEvidenceLink, LinkType
)
from src.common.db_postgresql import DatabaseManager
from src.evidence.auto_submit_service import AutoSubmitService

logger = logging.getLogger(__name__)

class SmartPromptsService:
    """Service for managing smart prompts"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.auto_submit_service = AutoSubmitService()
    
    async def create_smart_prompt(
        self, 
        dispute_id: str, 
        evidence_document_id: str, 
        question: str, 
        options: List[Dict[str, Any]],
        expires_in_days: int = 7
    ) -> SmartPrompt:
        """Create a smart prompt for ambiguous evidence match"""
        try:
            prompt_id = str(uuid.uuid4())
            expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO smart_prompts 
                        (id, dispute_id, evidence_document_id, question, options, expires_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (
                        prompt_id, dispute_id, evidence_document_id,
                        question, json.dumps(options), expires_at
                    ))
            
            return SmartPrompt(
                id=prompt_id,
                dispute_id=dispute_id,
                evidence_document_id=evidence_document_id,
                question=question,
                options=options,
                status=PromptStatus.PENDING,
                expires_at=expires_at.isoformat() + "Z",
                created_at=datetime.utcnow().isoformat() + "Z",
                updated_at=datetime.utcnow().isoformat() + "Z"
            )
            
        except Exception as e:
            logger.error(f"Failed to create smart prompt: {e}")
            raise
    
    async def answer_smart_prompt(
        self, 
        prompt_id: str, 
        answer: SmartPromptAnswer
    ) -> SmartPromptAnswerResponse:
        """Answer a smart prompt"""
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
        """Get smart prompts for a user"""
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
    
    async def dismiss_smart_prompt(self, prompt_id: str) -> bool:
        """Dismiss a smart prompt"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE smart_prompts 
                        SET status = 'dismissed', updated_at = NOW()
                        WHERE id = %s AND status = 'pending'
                    """, (prompt_id,))
                    
                    return cursor.rowcount > 0
                    
        except Exception as e:
            logger.error(f"Failed to dismiss smart prompt {prompt_id}: {e}")
            return False
    
    async def _get_smart_prompt(self, prompt_id: str) -> Optional[Dict[str, Any]]:
        """Get smart prompt by ID"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, dispute_id, evidence_document_id, question, options,
                           status, selected_option, answered_at, expires_at, created_at, updated_at
                    FROM smart_prompts 
                    WHERE id = %s
                """, (prompt_id,))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'dispute_id': str(result[1]),
                        'evidence_document_id': str(result[2]),
                        'question': result[3],
                        'options': json.loads(result[4]) if result[4] else [],
                        'status': result[5],
                        'selected_option': result[6],
                        'answered_at': result[7].isoformat() + "Z" if result[7] else None,
                        'expires_at': result[8].isoformat() + "Z",
                        'created_at': result[9].isoformat() + "Z",
                        'updated_at': result[10].isoformat() + "Z"
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
    
    async def cleanup_expired_prompts(self) -> int:
        """Clean up expired smart prompts"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE smart_prompts 
                        SET status = 'expired', updated_at = NOW()
                        WHERE status = 'pending' AND expires_at < NOW()
                    """)
                    
                    return cursor.rowcount
                    
        except Exception as e:
            logger.error(f"Failed to cleanup expired prompts: {e}")
            return 0

