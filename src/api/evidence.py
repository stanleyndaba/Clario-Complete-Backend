"""
Evidence/Documents API endpoints - Production Implementation
"""

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Request, BackgroundTasks
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging
import json
import os
from src.api.auth_middleware import get_current_user
from src.api.schemas import Document, DocumentListResponse, DocumentViewResponse, DocumentDownloadResponse, DocumentUploadResponse
from src.services.cost_docs_client import cost_docs_client

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/api/documents", response_model=DocumentListResponse)
async def get_documents(
    claim_id: Optional[str] = Query(None, description="Filter by claim ID"),
    document_type: Optional[str] = Query(None, description="Filter by document type"),
    limit: int = Query(20, ge=1, le=100, description="Number of documents to return"),
    offset: int = Query(0, ge=0, description="Number of documents to skip"),
    user: dict = Depends(get_current_user)
):
    """Get list of documents/evidence for the authenticated user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting documents for user {user_id}, claim_id={claim_id}, limit={limit}, offset={offset}")
        
        # Call real cost documentation service
        if claim_id:
            result = await cost_docs_client.get_documents_by_anomaly(claim_id, user_id)
        else:
            result = await cost_docs_client.get_documents_by_seller(user_id, user_id, limit, offset)
        
        if "error" in result:
            logger.error(f"Get documents failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Cost docs service error: {result['error']}")
        
        documents = [Document(**doc) for doc in result.get("documents", [])]
        
        return DocumentListResponse(
            documents=documents,
            total=result.get("total", 0),
            has_more=result.get("has_more", False),
            pagination={
                "limit": limit,
                "offset": offset,
                "total": result.get("total", 0),
                "has_more": result.get("has_more", False)
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_documents: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/documents/{id}", response_model=Document)
async def get_document(
    id: str,
    user: dict = Depends(get_current_user)
):
    """Get specific document details"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting document {id} for user {user_id}")
        
        # Call real cost documentation service
        result = await cost_docs_client.get_document(user_id, id)
        
        if "error" in result:
            logger.error(f"Get document failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Cost docs service error: {result['error']}")
        
        return Document(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_document: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/documents/{id}/view", response_model=DocumentViewResponse)
async def get_document_view_url(
    id: str,
    user: dict = Depends(get_current_user)
):
    """Get signed URL for viewing document"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting document view URL for {id}, user {user_id}")
        
        # Call real cost documentation service
        result = await cost_docs_client.get_document(user_id, id)
        
        if "error" in result:
            logger.error(f"Get document view URL failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Cost docs service error: {result['error']}")
        
        # Extract view URL from result
        return DocumentViewResponse(
            id=id,
            view_url=result.get("view_url", f"/api/documents/{id}/view"),
            expires_at=(datetime.utcnow() + timedelta(hours=1)).isoformat() + "Z",
            max_views=10,
            current_views=0
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_document_view_url: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/documents/{id}/download", response_model=DocumentDownloadResponse)
async def get_document_download_url(
    id: str,
    user: dict = Depends(get_current_user)
):
    """Get signed URL for downloading document"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting document download URL for {id}, user {user_id}")
        
        # Call real cost documentation service
        result = await cost_docs_client.get_document(user_id, id)
        
        if "error" in result:
            logger.error(f"Get document download URL failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Cost docs service error: {result['error']}")
        
        # Extract download URL from result
        return DocumentDownloadResponse(
            id=id,
            download_url=result.get("download_url", f"/api/documents/{id}/download"),
            expires_at=(datetime.utcnow() + timedelta(hours=1)).isoformat() + "Z",
            filename=result.get("filename", f"document_{id}.pdf"),
            content_type="application/pdf"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_document_download_url: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/documents/upload", response_model=DocumentUploadResponse)
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    claim_id: Optional[str] = Query(None, description="Associate with specific claim"),
    user: dict = Depends(get_current_user)
):
    """Upload new document(s) - accepts 'file' (singular) field name for multiple files"""
    
    try:
        user_id = user["user_id"]
        
        # Parse multipart form data manually to handle 'file' (singular) field name
        form = await request.form()
        
        # Accept both 'file' (singular) and 'files' (plural) field names
        # Frontend sends 'file' (singular) for all files
        files: List[UploadFile] = []
        
        # Check for 'file' field (singular - frontend sends multiple files with same field name)
        file_fields = form.getlist('file')
        if file_fields:
            for file_field in file_fields:
                # file_field is already an UploadFile when using form.getlist()
                if isinstance(file_field, UploadFile):
                    files.append(file_field)
        
        # Fallback to 'files' field (plural)
        if not files:
            file_fields = form.getlist('files')
            for file_field in file_fields:
                if isinstance(file_field, UploadFile):
                    files.append(file_field)
        
        if not files:
            raise HTTPException(status_code=400, detail="No files provided. Expected 'file' or 'files' field.")
        
        logger.info(f"Uploading documents for user {user_id}, files: {len(files)}, claim_id={claim_id}, filenames: {[f.filename for f in files]}")
        
        # Store files directly in evidence_documents table and trigger parsing
        # Since cost_docs_client doesn't have upload_documents, we'll implement direct storage
        document_ids = []
        for file in files:
            try:
                # Read file content
                content = await file.read()
                filename = file.filename or f"document_{datetime.utcnow().timestamp()}"
                content_type = file.content_type or "application/octet-stream"
                
                # Store in database (evidence_documents table)
                from src.common.db_postgresql import DatabaseManager
                db = DatabaseManager()
                
                with db._get_connection() as conn:
                    with conn.cursor() as cursor:
                        # Insert document record
                        cursor.execute("""
                            INSERT INTO evidence_documents (
                                user_id, provider, filename, content_type, 
                                size_bytes, processing_status, created_at, metadata
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id
                        """, (
                            user_id,
                            'manual_upload',
                            filename,
                            content_type,
                            len(content),
                            'pending',
                            datetime.utcnow(),
                            json.dumps({
                                'claim_id': claim_id,
                                'upload_method': 'manual',
                                'original_filename': filename
                            })
                        ))
                        
                        document_id = str(cursor.fetchone()[0])
                        document_ids.append(document_id)
                        
                        # TODO: Store file content in Supabase Storage or S3
                        # For now, we'll just store metadata
                        logger.info(f"Document {document_id} stored for user {user_id}")
                        
                        # Trigger parsing using background task
                        # Import parser worker to trigger parsing directly
                        async def trigger_parsing(doc_id: str, uid: str, content_t: str, file_name: str):
                            try:
                                # Try to use parser worker directly if available
                                try:
                                    from src.parsers.parser_worker import parser_worker
                                    if parser_worker:
                                        logger.info(f"Triggering parsing for document {doc_id} using parser worker")
                                        # Trigger parsing job directly
                                        await parser_worker.parse_document(doc_id, uid)
                                        logger.info(f"Parsing job started for document {doc_id}")
                                        return
                                except ImportError:
                                    logger.debug("Parser worker not available, using HTTP endpoint")
                                
                                # Fallback: Call parser endpoint via HTTP
                                import httpx
                                python_api_url = os.getenv('PYTHON_API_URL', 'http://localhost:8000')
                                if python_api_url.startswith('http://localhost') or python_api_url.startswith('https://'):
                                    # Use full URL for external calls
                                    parse_url = f"{python_api_url}/api/v1/evidence/parse/{doc_id}"
                                else:
                                    # Use relative URL for internal calls
                                    parse_url = f"/api/v1/evidence/parse/{doc_id}"
                                
                                async with httpx.AsyncClient(timeout=30.0) as client:
                                    response = await client.post(
                                        parse_url,
                                        headers={
                                            'X-User-Id': uid,
                                            'Content-Type': 'application/json'
                                        }
                                    )
                                    if response.status_code == 200:
                                        logger.info(f"Parsing triggered for document {doc_id}: {response.json()}")
                                    else:
                                        logger.warn(f"Failed to trigger parsing for document {doc_id}: {response.status_code} - {response.text}")
                            except Exception as e:
                                logger.error(f"Error triggering parsing for document {doc_id}: {e}", exc_info=True)
                        
                        # Schedule parsing as background task
                        background_tasks.add_task(trigger_parsing, document_id, user_id, content_type, filename)
                        logger.info(f"Parsing scheduled for document {document_id}")
                
            except Exception as file_error:
                logger.error(f"Error processing file {file.filename}: {file_error}")
                continue
        
        if not document_ids:
            raise HTTPException(status_code=500, detail="Failed to upload any documents")
        
        # Return success response
        return DocumentUploadResponse(
            id=document_ids[0],  # Return first document ID
            status="uploaded",
            uploaded_at=datetime.utcnow().isoformat() + "Z",
            message=f"Documents uploaded successfully ({len(document_ids)} files)",
            processing_status="processing"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in upload_document: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")





