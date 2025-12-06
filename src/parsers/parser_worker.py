"""
Document Parser Worker
Background task system for processing document parsing jobs
"""

import asyncio
import json
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import logging
import os
import tempfile

from src.common.db_postgresql import DatabaseManager
from src.evidence.matching_worker import evidence_matching_worker
from src.api.schemas import ParserStatus, ParserJob, ParsedInvoiceData

# Import ParsingResult
try:
    from src.parsers.pdf_parser import ParsingResult
except ImportError:
    from dataclasses import dataclass
    from typing import Optional
    
    @dataclass
    class ParsingResult:
        """Result of document parsing"""
        success: bool
        data: Optional[ParsedInvoiceData] = None
        confidence: float = 0.0
        method: str = "regex"
        error: Optional[str] = None
        processing_time_ms: int = 0

# Conditional imports to avoid circular dependencies
try:
    from src.parsers.pdf_parser import PDFParser, PDF_AVAILABLE
except ImportError:
    PDF_AVAILABLE = False
    PDFParser = None

try:
    from src.parsers.email_parser import EmailParser
except ImportError:
    EmailParser = None

try:
    from src.parsers.image_parser import ImageParser, OCR_AVAILABLE
except ImportError:
    OCR_AVAILABLE = False
    ImageParser = None

logger = logging.getLogger(__name__)

class ParserWorker:
    """Background worker for processing document parsing jobs"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.pdf_parser = PDFParser() if PDF_AVAILABLE and PDFParser else None
        self.email_parser = EmailParser() if EmailParser else None
        self.image_parser = ImageParser() if OCR_AVAILABLE and ImageParser else None
        self.is_running = False
        self.retry_delays = [60, 300, 900]  # 1 min, 5 min, 15 min
    
    async def start(self):
        """Start the parser worker"""
        self.is_running = True
        logger.info("Parser worker started")
        
        while self.is_running:
            try:
                await self._process_pending_jobs()
                await asyncio.sleep(10)  # Check every 10 seconds
            except Exception as e:
                logger.error(f"Parser worker error: {e}")
                await asyncio.sleep(30)  # Wait longer on error
    
    async def stop(self):
        """Stop the parser worker"""
        self.is_running = False
        logger.info("Parser worker stopped")
    
    async def _process_pending_jobs(self):
        """Process pending parser jobs"""
        try:
            # Get pending jobs
            jobs = await self._get_pending_jobs()
            
            for job in jobs:
                try:
                    await self._process_job(job)
                except Exception as e:
                    logger.error(f"Failed to process job {job['id']}: {e}")
                    await self._mark_job_failed(job['id'], str(e))
            
            # Process retry jobs
            retry_jobs = await self._get_retry_jobs()
            for job in retry_jobs:
                try:
                    await self._process_job(job)
                except Exception as e:
                    logger.error(f"Failed to retry job {job['id']}: {e}")
                    await self._handle_job_retry(job)
                    
        except Exception as e:
            logger.error(f"Error processing pending jobs: {e}")
    
    async def _get_pending_jobs(self) -> List[Dict[str, Any]]:
        """Get pending parser jobs"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, document_id, parser_type
                    FROM parser_jobs 
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT 10
                """)
                
                jobs = []
                for row in cursor.fetchall():
                    jobs.append({
                        'id': str(row[0]),
                        'document_id': str(row[1]),
                        'parser_type': row[2],
                        'retry_count': 0,
                        'max_retries': 3
                    })
                
                return jobs
    
    async def _get_retry_jobs(self) -> List[Dict[str, Any]]:
        """Get jobs that need retrying"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, document_id, parser_type, error_message
                    FROM parser_jobs 
                    WHERE status = 'retrying' 
                    AND updated_at < NOW() - INTERVAL '%s seconds'
                    ORDER BY updated_at ASC
                    LIMIT 5
                """, (self.retry_delays[0],))  # Use first retry delay
                
                jobs = []
                for row in cursor.fetchall():
                    jobs.append({
                        'id': str(row[0]),
                        'document_id': str(row[1]),
                        'parser_type': row[2],
                        'retry_count': 0,
                        'max_retries': 3,
                        'error_message': row[3]
                    })
                
                return jobs
    
    async def _process_job(self, job: Dict[str, Any]):
        """Process a single parser job"""
        job_id = job['id']
        document_id = job['document_id']
        parser_type = job['parser_type']
        
        logger.info(f"Processing job {job_id} for document {document_id} with parser {parser_type}")
        
        try:
            # Mark job as processing
            await self._mark_job_processing(job_id)
            
            # Get document details
            document = await self._get_document(document_id)
            if not document:
                raise Exception(f"Document {document_id} not found")
            
            # Parse document based on type
            result = await self._parse_document(document, parser_type)
            
            if result.success:
                # Save parsing results
                await self._save_parsing_results(job_id, document_id, result)
                await self._mark_job_completed(job_id, result.confidence)

                # 🎯 STEP 5 → STEP 6: Trigger evidence matching
                try:
                    await self._trigger_evidence_matching(document_id)
                    logger.info(
                        f"Job {job_id} completed successfully with confidence {result.confidence}"
                    )
                except Exception as e:
                    logger.warning(f"Post-parse hook failed for job {job_id}: {e}")
            else:
                # Handle parsing failure
                await self._handle_parsing_failure(job_id, result.error)
                
        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            await self._handle_job_retry(job)
    
    async def _parse_document(self, document: Dict[str, Any], parser_type: str) -> ParsingResult:
        """Parse document using appropriate parser"""
        file_path = document.get('file_path')
        file_content = document.get('content')
        
        if parser_type == 'pdf':
            if self.pdf_parser:
                return self.pdf_parser.parse_document(file_path, file_content)
            else:
                raise Exception("PDF parser not available")
        elif parser_type == 'email':
            if self.email_parser:
                return self.email_parser.parse_document(file_path, file_content)
            else:
                raise Exception("Email parser not available")
        elif parser_type == 'image':
            if self.image_parser:
                return self.image_parser.parse_document(file_path, file_content)
            else:
                raise Exception("Image parser not available")
        else:
            raise Exception(f"Unknown parser type: {parser_type}")
    
    async def _get_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        """Get document details from database"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, filename, content_type, download_url, metadata
                    FROM evidence_documents 
                    WHERE id = %s
                """, (document_id,))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'filename': result[1],
                        'content_type': result[2],
                        'download_url': result[3],
                        'metadata': json.loads(result[4]) if result[4] else {}
                    }
                return None
    
    async def _save_parsing_results(self, job_id: str, document_id: str, result: ParsingResult):
        """Save parsing results to database"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                # Update document with parsed metadata
                cursor.execute("""
                    UPDATE evidence_documents 
                    SET parsed_metadata = %s, parser_status = 'completed', 
                        parser_confidence = %s, parser_completed_at = NOW()
                    WHERE id = %s
                """, (
                    json.dumps(result.data.dict()) if result.data else None,
                    result.confidence,
                    document_id
                ))
                
                # Save detailed results
                cursor.execute("""
                    INSERT INTO parser_job_results 
                    (job_id, document_id, supplier_name, invoice_number, invoice_date,
                     total_amount, currency, tax_amount, shipping_amount, payment_terms,
                     po_number, raw_text, line_items, extraction_method, confidence_score,
                     processing_time_ms)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    job_id, document_id,
                    result.data.supplier_name if result.data else None,
                    result.data.invoice_number if result.data else None,
                    result.data.invoice_date if result.data else None,
                    result.data.total_amount if result.data else None,
                    result.data.currency if result.data else None,
                    result.data.tax_amount if result.data else None,
                    result.data.shipping_amount if result.data else None,
                    result.data.payment_terms if result.data else None,
                    result.data.po_number if result.data else None,
                    result.data.raw_text if result.data else None,
                    json.dumps([item.dict() for item in result.data.line_items]) if result.data and result.data.line_items else '[]',
                    result.method,
                    result.confidence,
                    result.processing_time_ms
                ))

    async def _trigger_evidence_matching(self, document_id: str) -> None:
        """Trigger evidence matching job for the document's owner, if available."""
        try:
            # Look up the user_id for the document to scope matching
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT user_id
                        FROM evidence_documents
                        WHERE id = %s
                        """,
                        (document_id,),
                    )
                    row = cursor.fetchone()

            user_id = str(row[0]) if row and row[0] else None
            if not user_id:
                return

            # Create a matching job for this user; worker loop will process it
            await evidence_matching_worker.create_matching_job(user_id)
        except Exception as e:
            # Best-effort hook; log and continue
            logger.warning(f"Failed to trigger evidence matching for document {document_id}: {e}")
    
    async def _mark_job_processing(self, job_id: str):
        """Mark job as processing"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE parser_jobs 
                    SET status = 'processing', started_at = NOW()
                    WHERE id = %s
                """, (job_id,))
    
    async def _mark_job_completed(self, job_id: str, confidence: float):
        """Mark job as completed"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE parser_jobs 
                    SET status = 'completed', completed_at = NOW(), confidence_score = %s
                    WHERE id = %s
                """, (confidence, job_id))
    
    async def _mark_job_failed(self, job_id: str, error_message: str):
        """Mark job as failed"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE parser_jobs 
                    SET status = 'failed', completed_at = NOW(), error_message = %s
                    WHERE id = %s
                """, (error_message, job_id))
    
    async def _handle_parsing_failure(self, job_id: str, error: str):
        """Handle parsing failure - mark as failed (no retry columns in DB)"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                # Mark as failed directly since retry columns don't exist
                cursor.execute("""
                    UPDATE parser_jobs 
                    SET status = 'failed', completed_at = NOW(), error_message = %s
                    WHERE id = %s
                """, (error, job_id))
                logger.error(f"Job {job_id} marked as failed: {error}")
    
    async def _handle_job_retry(self, job: Dict[str, Any]):
        """Handle job retry with exponential backoff"""
        job_id = job['id']
        retry_count = job['retry_count']
        
        if retry_count < len(self.retry_delays):
            delay = self.retry_delays[retry_count]
        else:
            delay = self.retry_delays[-1]
        
        # Update retry timestamp
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE parser_jobs 
                    SET updated_at = NOW() + INTERVAL '%s seconds'
                    WHERE id = %s
                """, (delay, job_id))
        
        logger.info(f"Job {job_id} scheduled for retry in {delay} seconds")
    
    async def create_parser_job(self, document_id: str, user_id: str, parser_type: str) -> str:
        """Create a new parser job"""
        job_id = str(uuid.uuid4())
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO parser_jobs 
                    (id, document_id, user_id, parser_type, status, started_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (job_id, document_id, user_id, parser_type, 'pending', datetime.utcnow()))
        
        logger.info(f"Created parser job {job_id} for document {document_id}")
        return job_id
    
    async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get parser job status"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, document_id, status, started_at, completed_at, 
                           error_message, confidence_score
                    FROM parser_jobs 
                    WHERE id = %s
                """, (job_id,))
                
                result = cursor.fetchone()
                if result:
                    return {
                        'id': str(result[0]),
                        'document_id': str(result[1]),
                        'status': result[2],
                        'started_at': result[3].isoformat() + "Z" if result[3] else None,
                        'completed_at': result[4].isoformat() + "Z" if result[4] else None,
                        'retry_count': 0,
                        'max_retries': 3,
                        'error_message': result[5],
                        'confidence_score': result[6]
                    }
                return None

# Global parser worker instance
parser_worker = ParserWorker()

