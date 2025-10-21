"""
Auto-Submit Service
Handles automatic submission of high-confidence evidence matches
"""

import uuid
import json
from typing import Dict, Any, Optional
from datetime import datetime
import logging
import httpx

from src.api.schemas import AutoSubmitRequest, AutoSubmitResponse, DisputeEvidenceLink, LinkType
from src.common.db_postgresql import DatabaseManager
from src.common.config import settings

logger = logging.getLogger(__name__)

class AutoSubmitService:
    """Service for auto-submitting evidence matches"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.integrations_url = settings.INTEGRATIONS_URL
        self.integrations_api_key = settings.INTEGRATIONS_API_KEY
    
    async def auto_submit_evidence(self, request: AutoSubmitRequest) -> AutoSubmitResponse:
        """Auto-submit evidence for a dispute case"""
        try:
            # Validate the request
            dispute = await self._get_dispute_case(request.dispute_id)
            if not dispute:
                return AutoSubmitResponse(
                    success=False,
                    dispute_id=request.dispute_id,
                    evidence_document_id=request.evidence_document_id,
                    action_taken="error",
                    message="Dispute case not found"
                )
            
            evidence_doc = await self._get_evidence_document(request.evidence_document_id)
            if not evidence_doc:
                return AutoSubmitResponse(
                    success=False,
                    dispute_id=request.dispute_id,
                    evidence_document_id=request.evidence_document_id,
                    action_taken="error",
                    message="Evidence document not found"
                )
            
            # Check if already linked
            existing_link = await self._get_existing_link(request.dispute_id, request.evidence_document_id)
            if existing_link:
                return AutoSubmitResponse(
                    success=True,
                    dispute_id=request.dispute_id,
                    evidence_document_id=request.evidence_document_id,
                    action_taken="already_linked",
                    message="Evidence already linked to dispute"
                )
            
            # Create evidence link
            link_id = await self._create_evidence_link(
                request.dispute_id,
                request.evidence_document_id,
                request.confidence,
                request.reasoning
            )
            
            # Call integrations service to start dispute
            dispute_result = await self._start_dispute_with_evidence(
                dispute,
                evidence_doc,
                request.confidence
            )
            
            if dispute_result['success']:
                # Update dispute status
                await self._update_dispute_status(
                    request.dispute_id,
                    'auto_submitted',
                    request.confidence,
                    dispute_result.get('amazon_case_id')
                )
                
                return AutoSubmitResponse(
                    success=True,
                    dispute_id=request.dispute_id,
                    evidence_document_id=request.evidence_document_id,
                    action_taken="auto_submitted",
                    message=f"Evidence auto-submitted successfully. Amazon Case ID: {dispute_result.get('amazon_case_id', 'N/A')}"
                )
            else:
                # Update dispute status to manual review
                await self._update_dispute_status(
                    request.dispute_id,
                    'manual_review',
                    request.confidence,
                    None
                )
                
                return AutoSubmitResponse(
                    success=False,
                    dispute_id=request.dispute_id,
                    evidence_document_id=request.evidence_document_id,
                    action_taken="manual_review",
                    message=f"Auto-submit failed: {dispute_result.get('error', 'Unknown error')}. Moved to manual review."
                )
                
        except Exception as e:
            logger.error(f"Auto-submit failed for dispute {request.dispute_id}: {e}")
            return AutoSubmitResponse(
                success=False,
                dispute_id=request.dispute_id,
                evidence_document_id=request.evidence_document_id,
                action_taken="error",
                message=f"Auto-submit failed: {str(e)}"
            )
    
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
    
    async def _get_evidence_document(self, evidence_document_id: str) -> Optional[Dict[str, Any]]:
        """Get evidence document by ID"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, user_id, filename, content_type, parsed_metadata,
                           parser_confidence, download_url
                    FROM evidence_documents 
                    WHERE id = %s
                """, (evidence_document_id,))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'user_id': str(result[1]),
                        'filename': result[2],
                        'content_type': result[3],
                        'parsed_metadata': json.loads(result[4]) if result[4] else {},
                        'parser_confidence': result[5],
                        'download_url': result[6]
                    }
                return None
    
    async def _get_existing_link(self, dispute_id: str, evidence_document_id: str) -> Optional[Dict[str, Any]]:
        """Check if evidence is already linked to dispute"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, link_type, confidence
                    FROM dispute_evidence_links 
                    WHERE dispute_id = %s AND evidence_document_id = %s
                """, (dispute_id, evidence_document_id))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'link_type': result[1],
                        'confidence': result[2]
                    }
                return None
    
    async def _create_evidence_link(
        self, 
        dispute_id: str, 
        evidence_document_id: str, 
        confidence: float, 
        reasoning: Optional[str]
    ) -> str:
        """Create evidence link between dispute and document"""
        link_id = str(uuid.uuid4())
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                # Create evidence link
                cursor.execute("""
                    INSERT INTO dispute_evidence_links 
                    (id, dispute_id, evidence_document_id, link_type, confidence, match_reasoning)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    link_id, dispute_id, evidence_document_id,
                    LinkType.AUTO_MATCH.value, confidence, reasoning
                ))
                
                # Update dispute evidence linked IDs
                cursor.execute("""
                    UPDATE dispute_cases 
                    SET evidence_linked_ids = COALESCE(evidence_linked_ids, '[]'::jsonb) || %s::jsonb
                    WHERE id = %s
                """, (json.dumps([evidence_document_id]), dispute_id))
        
        return link_id
    
    async def _start_dispute_with_evidence(
        self, 
        dispute: Dict[str, Any], 
        evidence_doc: Dict[str, Any], 
        confidence: float
    ) -> Dict[str, Any]:
        """Call integrations service to start dispute with evidence"""
        try:
            async with httpx.AsyncClient() as client:
                payload = {
                    "dispute_id": dispute['id'],
                    "order_id": dispute['order_id'],
                    "asin": dispute.get('asin'),
                    "sku": dispute.get('sku'),
                    "dispute_type": dispute['dispute_type'],
                    "amount_claimed": dispute.get('amount_claimed'),
                    "currency": dispute.get('currency', 'USD'),
                    "evidence": {
                        "document_id": evidence_doc['id'],
                        "filename": evidence_doc['filename'],
                        "content_type": evidence_doc['content_type'],
                        "parsed_metadata": evidence_doc['parsed_metadata'],
                        "confidence": confidence
                    }
                }
                
                response = await client.post(
                    f"{self.integrations_url}/api/disputes/start",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.integrations_api_key}",
                        "Content-Type": "application/json"
                    },
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    return {
                        "success": True,
                        "amazon_case_id": response.json().get("amazon_case_id"),
                        "message": response.json().get("message", "Dispute started successfully")
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Integrations service error: {response.status_code} - {response.text}"
                    }
                    
        except httpx.TimeoutException:
            return {
                "success": False,
                "error": "Integrations service timeout"
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Integrations service error: {str(e)}"
            }
    
    async def _update_dispute_status(
        self, 
        dispute_id: str, 
        status: str, 
        confidence: float, 
        amazon_case_id: Optional[str] = None
    ):
        """Update dispute case status"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                if amazon_case_id:
                    cursor.execute("""
                        UPDATE dispute_cases 
                        SET status = %s, match_confidence = %s, 
                            metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb,
                            updated_at = NOW()
                        WHERE id = %s
                    """, (
                        status, confidence, 
                        json.dumps({"amazon_case_id": amazon_case_id}),
                        dispute_id
                    ))
                else:
                    cursor.execute("""
                        UPDATE dispute_cases 
                        SET status = %s, match_confidence = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (status, confidence, dispute_id))
    
    async def get_auto_submit_metrics(self, user_id: str, days: int = 30) -> Dict[str, Any]:
        """Get auto-submit metrics for a user"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                # Get auto-submit statistics
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_auto_submits,
                        COUNT(CASE WHEN status = 'auto_submitted' THEN 1 END) as successful_submits,
                        COUNT(CASE WHEN status = 'manual_review' THEN 1 END) as failed_submits,
                        AVG(match_confidence) as avg_confidence
                    FROM dispute_cases 
                    WHERE user_id = %s 
                    AND status IN ('auto_submitted', 'manual_review')
                    AND updated_at >= NOW() - INTERVAL '%s days'
                """, (user_id, days))
                
                result = cursor.fetchone()
                if result:
                    total_auto_submits = result[0] or 0
                    successful_submits = result[1] or 0
                    failed_submits = result[2] or 0
                    avg_confidence = result[3] or 0.0
                    
                    success_rate = (successful_submits / total_auto_submits) if total_auto_submits > 0 else 0.0
                    
                    return {
                        "total_auto_submits": total_auto_submits,
                        "successful_submits": successful_submits,
                        "failed_submits": failed_submits,
                        "success_rate": success_rate,
                        "avg_confidence": avg_confidence,
                        "period_days": days
                    }
                else:
                    return {
                        "total_auto_submits": 0,
                        "successful_submits": 0,
                        "failed_submits": 0,
                        "success_rate": 0.0,
                        "avg_confidence": 0.0,
                        "period_days": days
                    }

