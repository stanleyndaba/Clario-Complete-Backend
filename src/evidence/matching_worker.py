"""
Evidence Matching Worker
Background worker for processing evidence matching jobs
"""

import asyncio
import uuid
import json
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import logging

from src.common.db_postgresql import DatabaseManager
from src.evidence.matching_engine import EvidenceMatchingEngine
from src.evidence.auto_submit_service import AutoSubmitService
from src.evidence.smart_prompts_service import SmartPromptsService
from src.api.schemas import EvidenceMatchingJob, EvidenceMatchingResult

logger = logging.getLogger(__name__)

class EvidenceMatchingWorker:
    """Background worker for evidence matching"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.matching_engine = EvidenceMatchingEngine()
        self.auto_submit_service = AutoSubmitService()
        self.smart_prompts_service = SmartPromptsService()
        self.is_running = False
        self.processing_interval = 60  # Process every 60 seconds
    
    async def start(self):
        """Start the evidence matching worker"""
        self.is_running = True
        logger.info("Evidence matching worker started")
        
        while self.is_running:
            try:
                await self._process_pending_jobs()
                await self._cleanup_expired_prompts()
                await asyncio.sleep(self.processing_interval)
            except Exception as e:
                logger.error(f"Evidence matching worker error: {e}")
                await asyncio.sleep(30)  # Wait longer on error
    
    async def stop(self):
        """Stop the evidence matching worker"""
        self.is_running = False
        logger.info("Evidence matching worker stopped")
    
    async def create_matching_job(self, user_id: str) -> str:
        """Create a new evidence matching job"""
        job_id = str(uuid.uuid4())
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO evidence_matching_jobs 
                    (id, user_id, status, started_at)
                    VALUES (%s, %s, %s, %s)
                """, (job_id, user_id, 'pending', datetime.utcnow()))
        
        logger.info(f"Created evidence matching job {job_id} for user {user_id}")
        return job_id
    
    async def _process_pending_jobs(self):
        """Process pending evidence matching jobs"""
        try:
            # Get pending jobs
            jobs = await self._get_pending_jobs()
            
            for job in jobs:
                try:
                    await self._process_job(job)
                except Exception as e:
                    logger.error(f"Failed to process job {job['id']}: {e}")
                    await self._mark_job_failed(job['id'], str(e))
                    
        except Exception as e:
            logger.error(f"Error processing pending jobs: {e}")
    
    async def _get_pending_jobs(self) -> List[Dict[str, Any]]:
        """Get pending evidence matching jobs"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, user_id, status, started_at
                    FROM evidence_matching_jobs 
                    WHERE status = 'pending'
                    ORDER BY started_at ASC
                    LIMIT 5
                """)
                
                jobs = []
                for row in cursor.fetchall():
                    jobs.append({
                        'id': str(row[0]),
                        'user_id': str(row[1]),
                        'status': row[2],
                        'started_at': row[3].isoformat() + "Z"
                    })
                
                return jobs
    
    async def _process_job(self, job: Dict[str, Any]):
        """Process a single evidence matching job"""
        job_id = job['id']
        user_id = job['user_id']
        
        logger.info(f"Processing evidence matching job {job_id} for user {user_id}")
        
        try:
            # Mark job as processing
            await self._mark_job_processing(job_id)
            
            # Run evidence matching
            matching_result = await self.matching_engine.match_evidence_for_user(user_id)
            
            # Update job with results
            await self._update_job_results(
                job_id,
                matching_result['matches'],
                matching_result['auto_submits'],
                matching_result['smart_prompts']
            )
            
            # Store detailed results
            if matching_result.get('results'):
                await self._store_matching_results(job_id, matching_result['results'])
            
            # Mark job as completed
            await self._mark_job_completed(job_id)
            
            logger.info(f"Job {job_id} completed: {matching_result['matches']} matches, "
                       f"{matching_result['auto_submits']} auto-submits, "
                       f"{matching_result['smart_prompts']} smart prompts")
            
        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            await self._mark_job_failed(job_id, str(e))
    
    async def _mark_job_processing(self, job_id: str):
        """Mark job as processing"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE evidence_matching_jobs 
                    SET status = 'processing', started_at = NOW()
                    WHERE id = %s
                """, (job_id,))
    
    async def _mark_job_completed(self, job_id: str):
        """Mark job as completed"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE evidence_matching_jobs 
                    SET status = 'completed', completed_at = NOW()
                    WHERE id = %s
                """, (job_id,))
    
    async def _mark_job_failed(self, job_id: str, error_message: str):
        """Mark job as failed"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE evidence_matching_jobs 
                    SET status = 'failed', completed_at = NOW(),
                        errors = COALESCE(errors, '[]'::jsonb) || %s::jsonb
                    WHERE id = %s
                """, (json.dumps([error_message]), job_id))
    
    async def _update_job_results(
        self, 
        job_id: str, 
        matches: int, 
        auto_submits: int, 
        smart_prompts: int
    ):
        """Update job with processing results"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE evidence_matching_jobs 
                    SET matches_found = %s, auto_submits_triggered = %s, 
                        smart_prompts_created = %s
                    WHERE id = %s
                """, (matches, auto_submits, smart_prompts, job_id))
    
    async def _store_matching_results(self, job_id: str, results: List[Any]):
        """Store detailed matching results"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                for result in results:
                    result_id = str(uuid.uuid4())
                    cursor.execute("""
                        INSERT INTO evidence_matching_results 
                        (id, job_id, dispute_id, evidence_document_id, rule_score,
                         ml_score, final_confidence, match_type, matched_fields,
                         reasoning, action_taken)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        result_id, job_id, result.dispute_id, result.evidence_document_id,
                        result.rule_score, result.ml_score, result.final_confidence,
                        result.match_type, json.dumps(result.matched_fields),
                        result.reasoning, result.action_taken
                    ))
    
    async def _cleanup_expired_prompts(self):
        """Clean up expired smart prompts"""
        try:
            expired_count = await self.smart_prompts_service.cleanup_expired_prompts()
            if expired_count > 0:
                logger.info(f"Cleaned up {expired_count} expired smart prompts")
        except Exception as e:
            logger.error(f"Failed to cleanup expired prompts: {e}")
    
    async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get evidence matching job status"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, user_id, status, started_at, completed_at,
                           disputes_processed, evidence_documents_processed,
                           matches_found, auto_submits_triggered, smart_prompts_created,
                           errors, metadata
                    FROM evidence_matching_jobs 
                    WHERE id = %s
                """, (job_id,))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'user_id': str(result[1]),
                        'status': result[2],
                        'started_at': result[3].isoformat() + "Z" if result[3] else None,
                        'completed_at': result[4].isoformat() + "Z" if result[4] else None,
                        'disputes_processed': result[5],
                        'evidence_documents_processed': result[6],
                        'matches_found': result[7],
                        'auto_submits_triggered': result[8],
                        'smart_prompts_created': result[9],
                        'errors': json.loads(result[10]) if result[10] else [],
                        'metadata': json.loads(result[11]) if result[11] else {}
                    }
                return None
    
    async def get_user_metrics(self, user_id: str, days: int = 30) -> Dict[str, Any]:
        """Get evidence matching metrics for a user"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                # Get dispute statistics
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_disputes,
                        COUNT(CASE WHEN status = 'auto_submitted' THEN 1 END) as auto_submitted,
                        COUNT(CASE WHEN status = 'smart_prompt_sent' THEN 1 END) as smart_prompt_sent,
                        COUNT(CASE WHEN status = 'evidence_linked' THEN 1 END) as evidence_linked,
                        AVG(match_confidence) as avg_confidence
                    FROM dispute_cases 
                    WHERE user_id = %s 
                    AND created_at >= NOW() - INTERVAL '%s days'
                """, (user_id, days))
                
                dispute_stats = cursor.fetchone()
                
                # Get evidence document statistics
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_evidence_docs,
                        COUNT(CASE WHEN parser_status = 'completed' THEN 1 END) as parsed_docs,
                        AVG(parser_confidence) as avg_parser_confidence
                    FROM evidence_documents 
                    WHERE user_id = %s 
                    AND created_at >= NOW() - INTERVAL '%s days'
                """, (user_id, days))
                
                evidence_stats = cursor.fetchone()
                
                # Get matching job statistics
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_jobs,
                        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
                        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
                        SUM(matches_found) as total_matches,
                        SUM(auto_submits_triggered) as total_auto_submits,
                        SUM(smart_prompts_created) as total_smart_prompts
                    FROM evidence_matching_jobs 
                    WHERE user_id = %s 
                    AND started_at >= NOW() - INTERVAL '%s days'
                """, (user_id, days))
                
                job_stats = cursor.fetchone()
                
                # Calculate rates
                total_disputes = dispute_stats[0] or 0
                evidence_match_rate = (dispute_stats[3] or 0) / total_disputes if total_disputes > 0 else 0.0
                auto_submit_rate = (dispute_stats[1] or 0) / total_disputes if total_disputes > 0 else 0.0
                smart_prompt_rate = (dispute_stats[2] or 0) / total_disputes if total_disputes > 0 else 0.0
                
                return {
                    "evidence_match_rate": evidence_match_rate,
                    "auto_submit_rate": auto_submit_rate,
                    "smart_prompt_rate": smart_prompt_rate,
                    "false_positive_alerts": 0,  # TODO: Implement false positive tracking
                    "total_disputes": total_disputes,
                    "total_evidence_documents": evidence_stats[0] or 0,
                    "total_matches": job_stats[3] or 0,
                    "period": f"{days} days",
                    "dispute_stats": {
                        "total": total_disputes,
                        "auto_submitted": dispute_stats[1] or 0,
                        "smart_prompt_sent": dispute_stats[2] or 0,
                        "evidence_linked": dispute_stats[3] or 0,
                        "avg_confidence": dispute_stats[4] or 0.0
                    },
                    "evidence_stats": {
                        "total": evidence_stats[0] or 0,
                        "parsed": evidence_stats[1] or 0,
                        "avg_parser_confidence": evidence_stats[2] or 0.0
                    },
                    "job_stats": {
                        "total": job_stats[0] or 0,
                        "completed": job_stats[1] or 0,
                        "failed": job_stats[2] or 0,
                        "total_matches": job_stats[3] or 0,
                        "total_auto_submits": job_stats[4] or 0,
                        "total_smart_prompts": job_stats[5] or 0
                    }
                }

# Global evidence matching worker instance
evidence_matching_worker = EvidenceMatchingWorker()

