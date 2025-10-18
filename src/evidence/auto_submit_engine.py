"""
Auto-Submit Engine
Handles automatic dispute submission for high-confidence evidence matches
"""

import asyncio
import json
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass

from src.common.config import settings
from src.common.db_postgresql import DatabaseManager
from src.integrations.amazon_spapi_service import (
    AmazonSPAPIService, SPAPIClaim, SubmissionResult, SubmissionStatus
)
from src.evidence.proof_packet_worker import proof_packet_worker
from src.websocket.websocket_manager import websocket_manager
from src.services.refund_engine_client import refund_engine_client
from src.api.schemas import AuditAction

logger = logging.getLogger(__name__)

@dataclass
class AutoSubmitConfig:
    """Configuration for auto-submit engine"""
    confidence_threshold: float = 0.85
    max_retries: int = 3
    retry_delay_seconds: int = 300  # 5 minutes
    batch_size: int = 10
    processing_interval: int = 60  # 1 minute

class AutoSubmitEngine:
    """Engine for automatic dispute submission"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.spapi_service = AmazonSPAPIService()
        self.config = AutoSubmitConfig()
        self.processing = False
        
    async def process_high_confidence_matches(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Process high-confidence matches for auto-submission"""
        try:
            logger.info(f"Starting auto-submit processing for user {user_id or 'all'}")
            
            # Get high-confidence matches
            matches = await self._get_high_confidence_matches(user_id)
            
            if not matches:
                return {
                    "processed": 0,
                    "submitted": 0,
                    "failed": 0,
                    "skipped": 0
                }
            
            # Process matches in batches
            results = {
                "processed": 0,
                "submitted": 0,
                "failed": 0,
                "skipped": 0
            }
            
            for i in range(0, len(matches), self.config.batch_size):
                batch = matches[i:i + self.config.batch_size]
                batch_results = await self._process_batch(batch)
                
                # Aggregate results
                for key in results:
                    results[key] += batch_results[key]
                
                # Small delay between batches to respect rate limits
                if i + self.config.batch_size < len(matches):
                    await asyncio.sleep(1)
            
            logger.info(f"Auto-submit processing completed: {results}")
            return results
            
        except Exception as e:
            logger.error(f"Auto-submit processing failed: {e}")
            raise
    
    async def submit_single_match(
        self, 
        match_id: str, 
        user_id: str
    ) -> Dict[str, Any]:
        """Submit a single high-confidence match"""
        try:
            # Get match details
            match = await self._get_match_details(match_id, user_id)
            if not match:
                return {
                    "success": False,
                    "error": "Match not found"
                }
            
            # Check if already submitted
            if match.get("submission_status") in ["submitted", "approved", "rejected"]:
                return {
                    "success": False,
                    "error": "Match already submitted"
                }
            
            # Prepare SP-API claim
            claim = await self._prepare_spapi_claim(match)
            
            # Get evidence documents
            evidence_docs = await self._get_evidence_documents(match["dispute_id"], user_id)
            
            # Submit to SP-API
            submission_result = await self.spapi_service.submit_dispute(
                claim=claim,
                user_id=user_id,
                evidence_documents=evidence_docs,
                confidence_score=match["confidence_score"]
            )
            
            # Update match status
            await self._update_match_submission_status(
                match_id, 
                submission_result, 
                user_id
            )
            
            # Broadcast real-time update
            await self._broadcast_submission_update(
                user_id, 
                match["dispute_id"], 
                submission_result
            )
            
            # Trigger proof packet if successful
            if submission_result.success:
                await self._trigger_proof_packet_generation(
                    match["dispute_id"], 
                    user_id
                )

            # 🎯 STEP 6 → STEP 7: Start refund engine tracking
            await self._start_refund_engine_tracking(match, user_id, submission_result)
            
            return {
                "success": submission_result.success,
                "submission_id": submission_result.submission_id,
                "amazon_case_id": submission_result.amazon_case_id,
                "status": submission_result.status.value,
                "error": submission_result.error_message
            }
            
        except Exception as e:
            logger.error(f"Failed to submit match {match_id}: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def retry_failed_submissions(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Retry failed submissions that are eligible for retry"""
        try:
            # Get failed submissions eligible for retry
            failed_submissions = await self._get_failed_submissions_for_retry(user_id)
            
            if not failed_submissions:
                return {
                    "retried": 0,
                    "successful": 0,
                    "still_failed": 0
                }
            
            results = {
                "retried": 0,
                "successful": 0,
                "still_failed": 0
            }
            
            for submission in failed_submissions:
                try:
                    # Update status to retrying
                    await self._update_submission_status(
                        submission["id"], 
                        SubmissionStatus.RETRYING
                    )
                    
                    # Resubmit
                    result = await self.submit_single_match(
                        submission["match_id"], 
                        submission["user_id"]
                    )
                    
                    results["retried"] += 1
                    if result["success"]:
                        results["successful"] += 1
                    else:
                        results["still_failed"] += 1
                        
                except Exception as e:
                    logger.error(f"Failed to retry submission {submission['id']}: {e}")
                    results["still_failed"] += 1
            
            return results
            
        except Exception as e:
            logger.error(f"Failed to retry submissions: {e}")
            raise
    
    async def start_continuous_processing(self):
        """Start continuous processing of high-confidence matches"""
        if self.processing:
            logger.warning("Auto-submit engine is already running")
            return
        
        self.processing = True
        logger.info("Starting continuous auto-submit processing")
        
        try:
            while self.processing:
                try:
                    # Process all users
                    await self.process_high_confidence_matches()
                    
                    # Retry failed submissions
                    await self.retry_failed_submissions()
                    
                    # Wait before next cycle
                    await asyncio.sleep(self.config.processing_interval)
                    
                except Exception as e:
                    logger.error(f"Error in continuous processing: {e}")
                    await asyncio.sleep(60)  # Wait 1 minute on error
                    
        finally:
            self.processing = False
            logger.info("Continuous auto-submit processing stopped")
    
    async def stop_continuous_processing(self):
        """Stop continuous processing"""
        self.processing = False
        logger.info("Stopping continuous auto-submit processing")
    
    async def _get_high_confidence_matches(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get high-confidence matches ready for submission"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Build query
                    where_clause = """
                        WHERE emr.final_confidence >= %s 
                        AND emr.action_taken = 'auto_submit'
                        AND dc.status = 'pending'
                        AND (ds.id IS NULL OR ds.status IN ('failed', 'retrying'))
                    """
                    params = [self.config.confidence_threshold]
                    
                    if user_id:
                        where_clause += " AND dc.user_id = %s"
                        params.append(user_id)
                    
                    cursor.execute(f"""
                        SELECT emr.id, emr.dispute_id, emr.evidence_document_id, 
                               emr.final_confidence, emr.match_type, emr.matched_fields,
                               dc.user_id, dc.order_id, dc.asin, dc.sku, dc.dispute_type,
                               dc.amount_claimed, dc.currency, dc.dispute_date,
                               ed.filename, ed.parsed_metadata, ds.id as submission_id
                        FROM evidence_matching_results emr
                        JOIN dispute_cases dc ON emr.dispute_id = dc.id
                        JOIN evidence_documents ed ON emr.evidence_document_id = ed.id
                        LEFT JOIN dispute_submissions ds ON emr.dispute_id = ds.order_id
                        {where_clause}
                        ORDER BY emr.final_confidence DESC, emr.created_at ASC
                        LIMIT %s
                    """, params + [self.config.batch_size * 2])  # Get more than batch size for filtering
                    
                    matches = []
                    for row in cursor.fetchall():
                        matches.append({
                            "id": str(row[0]),
                            "dispute_id": str(row[1]),
                            "evidence_document_id": str(row[2]),
                            "confidence_score": row[3],
                            "match_type": row[4],
                            "matched_fields": json.loads(row[5]) if row[5] else [],
                            "user_id": str(row[6]),
                            "order_id": row[7],
                            "asin": row[8],
                            "sku": row[9],
                            "dispute_type": row[10],
                            "amount_claimed": row[11],
                            "currency": row[12],
                            "dispute_date": row[13].isoformat() if row[13] else None,
                            "filename": row[14],
                            "parsed_metadata": json.loads(row[15]) if row[15] else {},
                            "submission_id": str(row[16]) if row[16] else None
                        })
                    
                    return matches
                    
        except Exception as e:
            logger.error(f"Failed to get high-confidence matches: {e}")
            raise
    
    async def _get_match_details(self, match_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Get detailed match information"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT emr.id, emr.dispute_id, emr.evidence_document_id, 
                               emr.final_confidence, emr.match_type, emr.matched_fields,
                               dc.user_id, dc.order_id, dc.asin, dc.sku, dc.dispute_type,
                               dc.amount_claimed, dc.currency, dc.dispute_date,
                               ed.filename, ed.parsed_metadata
                        FROM evidence_matching_results emr
                        JOIN dispute_cases dc ON emr.dispute_id = dc.id
                        JOIN evidence_documents ed ON emr.evidence_document_id = ed.id
                        WHERE emr.id = %s AND dc.user_id = %s
                    """, (match_id, user_id))
                    
                    row = cursor.fetchone()
                    if row:
                        return {
                            "id": str(row[0]),
                            "dispute_id": str(row[1]),
                            "evidence_document_id": str(row[2]),
                            "confidence_score": row[3],
                            "match_type": row[4],
                            "matched_fields": json.loads(row[5]) if row[5] else [],
                            "user_id": str(row[6]),
                            "order_id": row[7],
                            "asin": row[8],
                            "sku": row[9],
                            "dispute_type": row[10],
                            "amount_claimed": row[11],
                            "currency": row[12],
                            "dispute_date": row[13].isoformat() if row[13] else None,
                            "filename": row[14],
                            "parsed_metadata": json.loads(row[15]) if row[15] else {}
                        }
                    return None
                    
        except Exception as e:
            logger.error(f"Failed to get match details: {e}")
            return None
    
    async def _prepare_spapi_claim(self, match: Dict[str, Any]) -> SPAPIClaim:
        """Prepare SP-API claim from match data"""
        parsed_metadata = match.get("parsed_metadata", {})
        
        return SPAPIClaim(
            order_id=match["order_id"],
            asin=match["asin"],
            sku=match["sku"],
            claim_type=match["dispute_type"],
            amount_claimed=match["amount_claimed"],
            currency=match["currency"],
            invoice_number=parsed_metadata.get("invoice_number", ""),
            invoice_date=parsed_metadata.get("invoice_date", match["dispute_date"]),
            supporting_documents=[],  # Will be populated separately
            evidence_summary=self._generate_evidence_summary(match),
            seller_notes=f"Automated submission via Opside (confidence: {match['confidence_score']:.2%})"
        )
    
    def _generate_evidence_summary(self, match: Dict[str, Any]) -> str:
        """Generate evidence summary for SP-API submission"""
        summary_parts = [
            f"Evidence Type: {match['match_type']}",
            f"Confidence Score: {match['confidence_score']:.2%}",
            f"Matched Fields: {', '.join(match['matched_fields'])}"
        ]
        
        if match.get("parsed_metadata"):
            metadata = match["parsed_metadata"]
            if metadata.get("supplier_name"):
                summary_parts.append(f"Supplier: {metadata['supplier_name']}")
            if metadata.get("invoice_number"):
                summary_parts.append(f"Invoice: {metadata['invoice_number']}")
        
        return " | ".join(summary_parts)
    
    async def _get_evidence_documents(self, dispute_id: str, user_id: str) -> List[Dict[str, Any]]:
        """Get evidence documents for dispute"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT ed.id, ed.filename, ed.content_type, ed.size_bytes, 
                               ed.download_url, ed.parsed_metadata
                        FROM evidence_documents ed
                        JOIN dispute_evidence_links del ON ed.id = del.evidence_document_id
                        WHERE del.dispute_id = %s AND ed.user_id = %s
                    """, (dispute_id, user_id))
                    
                    documents = []
                    for row in cursor.fetchall():
                        documents.append({
                            "id": str(row[0]),
                            "filename": row[1],
                            "content_type": row[2],
                            "size_bytes": row[3],
                            "download_url": row[4],
                            "parsed_metadata": json.loads(row[5]) if row[5] else {}
                        })
                    
                    return documents
                    
        except Exception as e:
            logger.error(f"Failed to get evidence documents: {e}")
            return []
    
    async def _process_batch(self, matches: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Process a batch of matches"""
        results = {
            "processed": 0,
            "submitted": 0,
            "failed": 0,
            "skipped": 0
        }
        
        for match in matches:
            try:
                results["processed"] += 1
                
                # Check if already submitted
                if match.get("submission_id"):
                    results["skipped"] += 1
                    continue
                
                # Submit match
                result = await self.submit_single_match(
                    match["id"], 
                    match["user_id"]
                )
                
                if result["success"]:
                    results["submitted"] += 1
                else:
                    results["failed"] += 1
                    
            except Exception as e:
                logger.error(f"Failed to process match {match['id']}: {e}")
                results["failed"] += 1
        
        return results
    
    async def _update_match_submission_status(
        self, 
        match_id: str, 
        submission_result: SubmissionResult,
        user_id: str
    ):
        """Update match with submission status"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Update dispute case status
                    cursor.execute("""
                        UPDATE dispute_cases 
                        SET status = %s, updated_at = NOW()
                        WHERE id = (
                            SELECT dispute_id FROM evidence_matching_results 
                            WHERE id = %s
                        )
                    """, (submission_result.status.value, match_id))
                    
                    # Log submission result
                    cursor.execute("""
                        INSERT INTO dispute_submissions 
                        (id, user_id, order_id, asin, sku, claim_type, amount_claimed, 
                         currency, status, confidence_score, submission_id, amazon_case_id,
                         error_message, submission_timestamp, created_at, updated_at)
                        SELECT %s, %s, dc.order_id, dc.asin, dc.sku, dc.dispute_type, 
                               dc.amount_claimed, dc.currency, %s, emr.final_confidence,
                               %s, %s, %s, %s, NOW(), NOW()
                        FROM evidence_matching_results emr
                        JOIN dispute_cases dc ON emr.dispute_id = dc.id
                        WHERE emr.id = %s
                    """, (
                        str(uuid.uuid4()), user_id, submission_result.status.value,
                        submission_result.submission_id, submission_result.amazon_case_id,
                        submission_result.error_message, submission_result.submission_timestamp,
                        match_id
                    ))
                    
        except Exception as e:
            logger.error(f"Failed to update match submission status: {e}")
    
    async def _update_submission_status(self, submission_id: str, status: SubmissionStatus):
        """Update submission status"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE dispute_submissions 
                        SET status = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (status.value, submission_id))
                    
        except Exception as e:
            logger.error(f"Failed to update submission status: {e}")
    
    async def _get_failed_submissions_for_retry(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get failed submissions eligible for retry"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    where_clause = """
                        WHERE ds.status IN ('failed', 'retrying')
                        AND ds.created_at > NOW() - INTERVAL '24 hours'
                        AND ds.retry_count < %s
                    """
                    params = [self.config.max_retries]
                    
                    if user_id:
                        where_clause += " AND ds.user_id = %s"
                        params.append(user_id)
                    
                    cursor.execute(f"""
                        SELECT ds.id, ds.user_id, ds.order_id, emr.id as match_id
                        FROM dispute_submissions ds
                        JOIN dispute_cases dc ON ds.order_id = dc.order_id
                        JOIN evidence_matching_results emr ON dc.id = emr.dispute_id
                        {where_clause}
                        ORDER BY ds.created_at ASC
                    """, params)
                    
                    submissions = []
                    for row in cursor.fetchall():
                        submissions.append({
                            "id": str(row[0]),
                            "user_id": str(row[1]),
                            "order_id": row[2],
                            "match_id": str(row[3])
                        })
                    
                    return submissions
                    
        except Exception as e:
            logger.error(f"Failed to get failed submissions: {e}")
            return []
    
    async def _broadcast_submission_update(
        self, 
        user_id: str, 
        dispute_id: str, 
        submission_result: SubmissionResult
    ):
        """Broadcast submission update via WebSocket"""
        try:
            await websocket_manager.broadcast_to_user(
                user_id=user_id,
                event="dispute.submitted",
                data={
                    "dispute_id": dispute_id,
                    "submission_id": submission_result.submission_id,
                    "amazon_case_id": submission_result.amazon_case_id,
                    "status": submission_result.status.value,
                    "success": submission_result.success,
                    "error": submission_result.error_message,
                    "submitted_at": submission_result.submission_timestamp.isoformat() + "Z" if submission_result.submission_timestamp else None
                }
            )
        except Exception as e:
            logger.error(f"Failed to broadcast submission update: {e}")
    
    async def _trigger_proof_packet_generation(self, dispute_id: str, user_id: str):
        """Trigger proof packet generation after successful submission"""
        try:
            # This would typically be triggered by a payout webhook
            # For now, we'll simulate it after a delay
            await asyncio.sleep(5)  # Simulate processing time
            
            result = await proof_packet_worker.generate_proof_packet(
                claim_id=dispute_id,
                user_id=user_id,
                payout_details={
                    "submission_id": "auto-generated",
                    "amount": 0,  # Would be filled by actual payout
                    "currency": "USD",
                    "payout_date": datetime.utcnow().isoformat() + "Z"
                }
            )
            
            if result["success"]:
                # Broadcast proof packet generation
                await websocket_manager.broadcast_to_user(
                    user_id=user_id,
                    event="proof_packet.generated",
                    data={
                        "dispute_id": dispute_id,
                        "packet_id": result["packet_id"],
                        "pdf_url": result["pdf_url"],
                        "zip_url": result["zip_url"],
                        "generated_at": result["generated_at"]
                    }
                )
                
        except Exception as e:
            logger.error(f"Failed to trigger proof packet generation: {e}")

# Global instance
auto_submit_engine = AutoSubmitEngine()

