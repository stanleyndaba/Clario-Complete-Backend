"""
Evidence Sources API endpoints
Implements Phase 1 of Evidence Validator (EV) - Secure Ingestion Connectors
"""

from fastapi import APIRouter, HTTPException, Depends, Query, Body
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging
from src.api.auth_middleware import get_current_user
from src.api.schemas import (
    EvidenceSourceConnectRequest, 
    EvidenceSourceConnectResponse,
    EvidenceSourceListResponse,
    EvidenceDocumentListResponse,
    EvidenceIngestionJob
)
from src.evidence.ingestion_service import EvidenceIngestionService
from src.common.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize evidence ingestion service
evidence_service = EvidenceIngestionService()

@router.post("/api/v1/integrations/evidence/sources", response_model=EvidenceSourceConnectResponse)
async def connect_evidence_source(
    request: EvidenceSourceConnectRequest,
    user: dict = Depends(get_current_user)
):
    """Connect a new evidence source (Gmail, Outlook, Drive, Dropbox)"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Connecting evidence source {request.provider} for user {user_id}")
        
        # Get OAuth credentials for provider
        oauth_config = _get_oauth_config(request.provider)
        if not oauth_config:
            raise HTTPException(
                status_code=400, 
                detail=f"OAuth configuration not found for provider: {request.provider}"
            )
        
        # Connect evidence source
        result = await evidence_service.connect_evidence_source(
            user_id=user_id,
            provider=request.provider,
            oauth_code=request.oauth_code,
            client_id=oauth_config["client_id"],
            client_secret=oauth_config["client_secret"],
            redirect_uri=oauth_config["redirect_uri"]
        )
        
        return EvidenceSourceConnectResponse(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in connect_evidence_source: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/integrations/evidence/sources", response_model=EvidenceSourceListResponse)
async def list_evidence_sources(
    user: dict = Depends(get_current_user)
):
    """List all connected evidence sources for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Listing evidence sources for user {user_id}")
        
        sources = await evidence_service.list_evidence_sources(user_id)
        
        return EvidenceSourceListResponse(
            sources=sources,
            total=len(sources)
        )
        
    except Exception as e:
        logger.error(f"Unexpected error in list_evidence_sources: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.delete("/api/v1/integrations/evidence/sources/{source_id}")
async def disconnect_evidence_source(
    source_id: str,
    user: dict = Depends(get_current_user)
):
    """Disconnect and revoke an evidence source"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Disconnecting evidence source {source_id} for user {user_id}")
        
        success = await evidence_service.disconnect_evidence_source(user_id, source_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Evidence source not found")
        
        return {"ok": True, "message": "Evidence source disconnected successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in disconnect_evidence_source: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/integrations/evidence/sources/{source_id}/documents", response_model=EvidenceDocumentListResponse)
async def list_evidence_documents(
    source_id: str,
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """List evidence documents from a specific source"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Listing evidence documents from source {source_id} for user {user_id}")
        
        result = await evidence_service.list_evidence_documents(
            user_id=user_id,
            source_id=source_id,
            limit=limit,
            offset=offset
        )
        
        return EvidenceDocumentListResponse(**result)
        
    except Exception as e:
        logger.error(f"Unexpected error in list_evidence_documents: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/integrations/evidence/documents", response_model=EvidenceDocumentListResponse)
async def list_all_evidence_documents(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """List all evidence documents from all sources"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Listing all evidence documents for user {user_id}")
        
        result = await evidence_service.list_evidence_documents(
            user_id=user_id,
            source_id=None,
            limit=limit,
            offset=offset
        )
        
        return EvidenceDocumentListResponse(**result)
        
    except Exception as e:
        logger.error(f"Unexpected error in list_all_evidence_documents: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/integrations/evidence/sources/{source_id}/ingestion-jobs")
async def list_ingestion_jobs(
    source_id: str,
    user: dict = Depends(get_current_user)
):
    """List ingestion jobs for a specific source"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Listing ingestion jobs for source {source_id} and user {user_id}")
        
        # TODO: Implement ingestion job listing
        # For now, return empty list
        return {
            "jobs": [],
            "total": 0
        }
        
    except Exception as e:
        logger.error(f"Unexpected error in list_ingestion_jobs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/v1/integrations/evidence/sources/{source_id}/sync")
async def trigger_sync(
    source_id: str,
    user: dict = Depends(get_current_user)
):
    """Trigger a manual sync for a specific evidence source"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Triggering sync for source {source_id} and user {user_id}")
        
        # Verify source exists and belongs to user
        with evidence_service.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, provider, account_email, status
                    FROM evidence_sources 
                    WHERE id = %s AND user_id = %s
                """, (source_id, user_id))
                
                result = cursor.fetchone()
                if not result:
                    raise HTTPException(status_code=404, detail="Evidence source not found")
                
                source_id_db, provider, account_email, status = result
                
                if status != 'connected':
                    raise HTTPException(
                        status_code=400, 
                        detail=f"Evidence source is not connected (status: {status})"
                    )
        
        # Start ingestion job
        job_id = await evidence_service._start_ingestion_job(source_id, user_id)
        
        logger.info(f"Sync triggered successfully for source {source_id}, job {job_id}")
        
        return {
            "ok": True,
            "message": "Sync triggered successfully",
            "job_id": job_id,
            "source_id": source_id,
            "provider": provider,
            "account_email": account_email
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in trigger_sync: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

def _get_oauth_config(provider: str) -> Optional[Dict[str, str]]:
    """Get OAuth configuration for a provider"""
    configs = {
        "gmail": {
            "client_id": getattr(settings, "GMAIL_CLIENT_ID", ""),
            "client_secret": getattr(settings, "GMAIL_CLIENT_SECRET", ""),
            "redirect_uri": getattr(settings, "GMAIL_REDIRECT_URI", f"{settings.FRONTEND_URL}/auth/callback/gmail")
        },
        "outlook": {
            "client_id": getattr(settings, "OUTLOOK_CLIENT_ID", ""),
            "client_secret": getattr(settings, "OUTLOOK_CLIENT_SECRET", ""),
            "redirect_uri": getattr(settings, "OUTLOOK_REDIRECT_URI", f"{settings.FRONTEND_URL}/auth/callback/outlook")
        },
        "gdrive": {
            "client_id": getattr(settings, "GDRIVE_CLIENT_ID", ""),
            "client_secret": getattr(settings, "GDRIVE_CLIENT_SECRET", ""),
            "redirect_uri": getattr(settings, "GDRIVE_REDIRECT_URI", f"{settings.FRONTEND_URL}/auth/callback/gdrive")
        },
        "dropbox": {
            "client_id": getattr(settings, "DROPBOX_CLIENT_ID", ""),
            "client_secret": getattr(settings, "DROPBOX_CLIENT_SECRET", ""),
            "redirect_uri": getattr(settings, "DROPBOX_REDIRECT_URI", f"{settings.FRONTEND_URL}/auth/callback/dropbox")
        }
    }
    
    config = configs.get(provider)
    if not config or not config["client_id"] or not config["client_secret"]:
        return None
    
    return config
