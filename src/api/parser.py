"""
Document Parser API endpoints
Handles document parsing requests and job management
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks, Request
from typing import Dict, Any, List, Optional
from datetime import datetime
import json
import logging
from src.api.auth_middleware import get_current_user, get_optional_user
from src.api.schemas import (
    ParserJobResponse, 
    DocumentWithParsedData,
    ParserStatus,
    ParsedInvoiceData
)
try:
    from src.parsers.parser_worker import parser_worker  # type: ignore
except Exception as _parser_err:
    logger = logging.getLogger(__name__)
    logger.warning(f"Parser worker unavailable at startup: {_parser_err}")
    parser_worker = None  # type: ignore
from src.common.db_postgresql import DatabaseManager

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize database manager
db = DatabaseManager()

@router.post("/api/v1/evidence/parse/{document_id}", response_model=ParserJobResponse)
async def force_parse_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user)
):
    """Force parse a specific document"""
    
    try:
        # Support both authenticated user and X-User-Id header (for Node.js backend calls)
        user_id = None
        if user:
            user_id = user.get("user_id")
        
        # Fallback to X-User-Id header if no authenticated user
        if not user_id:
            user_id = request.headers.get("X-User-Id")
        
        if not user_id:
            raise HTTPException(status_code=401, detail="User ID required (authenticate or provide X-User-Id header)")
        
        logger.info(f"Force parsing document {document_id} for user {user_id}")
        
        # Check if document exists and belongs to user
        document = await _get_document(document_id, user_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Determine parser type based on content type
        parser_type = _determine_parser_type(document['content_type'], document['filename'])
        
        if parser_worker is None:
            raise HTTPException(status_code=503, detail="Parser subsystem unavailable")
        # Create parser job
        job_id = await parser_worker.create_parser_job(document_id, user_id, parser_type)
        
        # Start background processing
        background_tasks.add_task(_process_document_async, job_id, document_id, parser_type)
        
        return ParserJobResponse(
            job_id=job_id,
            status="pending",
            message="Document parsing started",
            estimated_completion=_get_estimated_completion(parser_type)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in force_parse_document: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/evidence/documents/{document_id}", response_model=DocumentWithParsedData)
async def get_document_with_parsed_data(
    document_id: str,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user)
):
    """Get document with parsed invoice data"""
    
    try:
        # Support both authenticated user and X-User-Id header
        user_id = None
        if user:
            user_id = user.get("user_id")
        
        if not user_id:
            user_id = request.headers.get("X-User-Id")
        
        if not user_id:
            raise HTTPException(status_code=401, detail="User ID required")
        
        logger.info(f"Getting document {document_id} with parsed data for user {user_id}")
        
        # Get document with parsed data
        document = await _get_document_with_parsed_data(document_id, user_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        
        return document
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_document_with_parsed_data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/evidence/parse/jobs/{job_id}")
async def get_parser_job_status(
    job_id: str,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user)
):
    """Get parser job status"""
    
    try:
        # Support both authenticated user and X-User-Id header
        user_id = None
        if user:
            user_id = user.get("user_id")
        
        if not user_id:
            user_id = request.headers.get("X-User-Id")
        
        if not user_id:
            raise HTTPException(status_code=401, detail="User ID required")
        
        logger.info(f"Getting parser job status {job_id} for user {user_id}")
        
        if parser_worker is None:
            raise HTTPException(status_code=503, detail="Parser subsystem unavailable")
        # Get job status
        job_status = await parser_worker.get_job_status(job_id)
        if not job_status:
            raise HTTPException(status_code=404, detail="Parser job not found")
        
        return {
            "ok": True,
            "data": job_status
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_parser_job_status: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/evidence/parse/jobs")
async def list_parser_jobs(
    status: Optional[str] = Query(None, description="Filter by job status"),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """List parser jobs for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Listing parser jobs for user {user_id}")
        
        # Build query
        where_clause = "WHERE pj.user_id = %s"
        params = [user_id]
        
        if status:
            where_clause += " AND pj.status = %s"
            params.append(status)
        
        # Get jobs
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"""
                    SELECT pj.id, pj.document_id, pj.status, pj.parser_type, 
                           pj.started_at, pj.completed_at,
                           pj.error_message, pj.confidence_score,
                           ed.filename, ed.content_type
                    FROM parser_jobs pj
                    JOIN evidence_documents ed ON pj.document_id = ed.id
                    {where_clause}
                    ORDER BY pj.created_at DESC
                    LIMIT %s OFFSET %s
                """, params + [limit, offset])
                
                jobs = []
                for row in cursor.fetchall():
                    jobs.append({
                        "id": str(row[0]),
                        "document_id": str(row[1]),
                        "status": row[2],
                        "parser_type": row[3],
                        "started_at": row[4].isoformat() + "Z" if row[4] else None,
                        "completed_at": row[5].isoformat() + "Z" if row[5] else None,
                        "retry_count": 0,
                        "max_retries": 3,
                        "error_message": row[6],
                        "confidence_score": row[7],
                        "filename": row[8],
                        "content_type": row[9]
                    })
                
                # Get total count
                cursor.execute(f"""
                    SELECT COUNT(*) 
                    FROM parser_jobs pj
                    {where_clause}
                """, params)
                total = cursor.fetchone()[0]
        
        return {
            "ok": True,
            "data": {
                "jobs": jobs,
                "total": total,
                "has_more": offset + len(jobs) < total,
                "pagination": {
                    "limit": limit,
                    "offset": offset,
                    "total": total,
                    "has_more": offset + len(jobs) < total
                }
            }
        }
        
    except Exception as e:
        logger.error(f"Unexpected error in list_parser_jobs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/evidence/documents/search")
async def search_documents(
    supplier: Optional[str] = Query(None, description="Search by supplier name"),
    date_from: Optional[str] = Query(None, description="Search from date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Search to date (YYYY-MM-DD)"),
    sku: Optional[str] = Query(None, description="Search by SKU"),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """Search documents by parsed metadata"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Searching documents for user {user_id}")
        
        # Build search query
        where_conditions = ["ed.user_id = %s", "ed.parser_status = 'completed'"]
        params = [user_id]
        
        if supplier:
            where_conditions.append("pjr.supplier_name ILIKE %s")
            params.append(f"%{supplier}%")
        
        if date_from:
            where_conditions.append("pjr.invoice_date >= %s")
            params.append(date_from)
        
        if date_to:
            where_conditions.append("pjr.invoice_date <= %s")
            params.append(date_to)
        
        if sku:
            where_conditions.append("pjr.line_items::text ILIKE %s")
            params.append(f"%{sku}%")
        
        where_clause = "WHERE " + " AND ".join(where_conditions)
        
        # Get documents
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"""
                    SELECT ed.id, ed.filename, ed.content_type, ed.created_at,
                           ed.parser_status, ed.parser_confidence,
                           pjr.supplier_name, pjr.invoice_number, pjr.invoice_date,
                           pjr.total_amount, pjr.currency, pjr.line_items
                    FROM evidence_documents ed
                    LEFT JOIN parser_job_results pjr ON ed.id = pjr.document_id
                    {where_clause}
                    ORDER BY ed.created_at DESC
                    LIMIT %s OFFSET %s
                """, params + [limit, offset])
                
                documents = []
                for row in cursor.fetchall():
                    documents.append({
                        "id": str(row[0]),
                        "filename": row[1],
                        "content_type": row[2],
                        "created_at": row[3].isoformat() + "Z",
                        "parser_status": row[4],
                        "parser_confidence": row[5],
                        "parsed_metadata": {
                            "supplier_name": row[6],
                            "invoice_number": row[7],
                            "invoice_date": row[8],
                            "total_amount": row[9],
                            "currency": row[10],
                            "line_items": json.loads(row[11]) if row[11] and isinstance(row[11], str) else (row[11] if row[11] else [])
                        } if row[6] else None
                    })
                
                # Get total count
                cursor.execute(f"""
                    SELECT COUNT(*) 
                    FROM evidence_documents ed
                    LEFT JOIN parser_job_results pjr ON ed.id = pjr.document_id
                    {where_clause}
                """, params)
                total = cursor.fetchone()[0]
        
        return {
            "ok": True,
            "data": {
                "documents": documents,
                "total": total,
                "has_more": offset + len(documents) < total,
                "pagination": {
                    "limit": limit,
                    "offset": offset,
                    "total": total,
                    "has_more": offset + len(documents) < total
                }
            }
        }
        
    except Exception as e:
        logger.error(f"Unexpected error in search_documents: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

async def _get_document(document_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Get document by ID and user"""
    with db._get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, filename, content_type, download_url, metadata
                FROM evidence_documents 
                WHERE id = %s AND user_id = %s
            """, (document_id, user_id))
            
            result = cursor.fetchone()
            if result:
                return {
                    'id': str(result[0]),
                    'filename': result[1],
                    'content_type': result[2],
                    'download_url': result[3],
                    'metadata': json.loads(result[4]) if result[4] and isinstance(result[4], str) else (result[4] if result[4] else {})
                }
            return None

async def _get_document_with_parsed_data(document_id: str, user_id: str) -> Optional[DocumentWithParsedData]:
    """Get document with parsed data"""
    with db._get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT ed.id, ed.source_id, ed.provider, ed.external_id, ed.filename,
                       ed.size_bytes, ed.content_type, ed.created_at, ed.modified_at,
                       ed.sender, ed.subject, ed.message_id, ed.folder_path,
                       ed.download_url, ed.thumbnail_url, ed.metadata, ed.processing_status,
                       ed.ocr_text, ed.extracted_data, ed.parsed_metadata,
                       ed.parser_status, ed.parser_confidence, ed.parser_error
                FROM evidence_documents ed
                WHERE ed.id = %s AND ed.user_id = %s
            """, (document_id, user_id))
            
            result = cursor.fetchone()
            if result:
                return DocumentWithParsedData(
                    id=str(result[0]),
                    source_id=str(result[1]),
                    provider=result[2],
                    external_id=result[3],
                    filename=result[4],
                    size_bytes=result[5],
                    content_type=result[6],
                    created_at=result[7].isoformat() + "Z",
                    modified_at=result[8].isoformat() + "Z",
                    sender=result[9],
                    subject=result[10],
                    message_id=result[11],
                    folder_path=result[12],
                    download_url=result[13],
                    thumbnail_url=result[14],
                    metadata=json.loads(result[15]) if result[15] and isinstance(result[15], str) else (result[15] if result[15] else {}),
                    processing_status=result[16],
                    ocr_text=result[17],
                    extracted_data=json.loads(result[18]) if result[18] and isinstance(result[18], str) else (result[18] if result[18] else None),
                    parsed_metadata=json.loads(result[19]) if result[19] and isinstance(result[19], str) else (result[19] if result[19] else None),
                    parser_status=ParserStatus(result[20]) if result[20] else ParserStatus.PENDING,
                    parser_confidence=result[21],
                    parser_error=result[22]
                )
            return None

def _determine_parser_type(content_type: str, filename: str) -> str:
    """Determine parser type based on content type and filename"""
    if content_type == 'application/pdf' or filename.lower().endswith('.pdf'):
        return 'pdf'
    elif content_type in ['message/rfc822', 'application/vnd.ms-outlook'] or \
         filename.lower().endswith(('.eml', '.msg')):
        return 'email'
    elif content_type.startswith('image/') or \
         filename.lower().endswith(('.jpg', '.jpeg', '.png', '.tiff', '.bmp')):
        return 'image'
    else:
        return 'pdf'  # Default to PDF parser

def _get_estimated_completion(parser_type: str) -> str:
    """Get estimated completion time for parser type"""
    estimates = {
        'pdf': '2-5 minutes',
        'email': '1-3 minutes',
        'image': '3-8 minutes'
    }
    return estimates.get(parser_type, '5-10 minutes')

async def _process_document_async(job_id: str, document_id: str, parser_type: str):
    """Background task to process document"""
    try:
        if parser_worker is None:
            logger.error("Parser subsystem unavailable in background task")
            return
        await parser_worker._process_job({
            'id': job_id,
            'document_id': document_id,
            'parser_type': parser_type
        })
    except Exception as e:
        logger.error(f"Background processing failed for job {job_id}: {e}")
        await parser_worker._mark_job_failed(job_id, str(e))
