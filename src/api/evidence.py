"""
Evidence/Documents API endpoints - Production Implementation
"""

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging
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
    files: List[UploadFile] = File(...),
    claim_id: Optional[str] = Query(None, description="Associate with specific claim"),
    user: dict = Depends(get_current_user)
):
    """Upload new document(s)"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Uploading documents for user {user_id}, files: {len(files)}, claim_id={claim_id}")
        
        # Call cost docs service to upload documents
        result = await cost_docs_client.upload_documents(claim_id or "general", files, user_id)
        
        if "error" in result:
            logger.error(f"Upload documents failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Cost docs service error: {result['error']}")
        
        return DocumentUploadResponse(
            id=result.get("document_id", f"doc_{user_id}_{int(datetime.utcnow().timestamp())}"),
            status="uploaded",
            uploaded_at=datetime.utcnow().isoformat() + "Z",
            message="Documents uploaded successfully",
            processing_status="processing"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in upload_document: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")





