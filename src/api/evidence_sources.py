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
        oauth_config = _get_oauth_config(request.provider)
        if not oauth_config:
            raise HTTPException(
                status_code=400, 
                detail=f"OAuth configuration not found for provider: {request.provider}"
            )
        result = await evidence_service.connect_evidence_source(
            user_id=user_id,
            provider=request.provider,
            oauth_code=request.oauth_code,
            client_id=oauth_config["client_id"],
            client_secret=oauth_config["client_secret"],
            redirect_uri=oauth_config["redirect_uri"]
        )
        # Consent log
        try:
            with evidence_service.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO evidence_consent_log (user_id, provider, scopes, event)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (user_id, request.provider, json.dumps(result.get('permissions', [])), 'connect')
                    )
        except Exception:
            pass
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
        with evidence_service.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, status, started_at, completed_at, documents_found, documents_processed, progress
                    FROM evidence_ingestion_jobs
                    WHERE source_id = %s AND user_id = %s
                    ORDER BY started_at DESC
                    LIMIT 50
                    """, (source_id, user["user_id"]))
                rows = cursor.fetchall() or []
                jobs = []
                for r in rows:
                    jobs.append({
                        "id": str(r[0]),
                        "status": r[1],
                        "started_at": r[2].isoformat() + "Z" if r[2] else None,
                        "completed_at": r[3].isoformat() + "Z" if r[3] else None,
                        "documents_found": r[4],
                        "documents_processed": r[5],
                        "progress": r[6]
                    })
        return {"jobs": jobs, "total": len(jobs)}
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
        job_id = await evidence_service._start_ingestion_job(source_id, user["user_id"])  # noqa
        return {"ok": True, "message": "Sync triggered", "job_id": job_id}
    except Exception as e:
        logger.error(f"Unexpected error in trigger_sync: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/integrations/evidence/search")
async def search_evidence(
    q: str = Query(..., min_length=2, description="Search term: order id, filename, sender"),
    provider: Optional[str] = Query(None, description="Filter by provider"),
    kind: Optional[str] = Query(None, description="Filter by doc_kind"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """Search evidence by identifiers, filename, sender, subject."""
    try:
        with evidence_service.db._get_connection() as conn:
            with conn.cursor() as cursor:
                where = ["user_id = %s"]
                params: List[Any] = [user["user_id"]]
                # ILIKE based search across key columns
                where.append("(order_id ILIKE %s OR filename ILIKE %s OR sender ILIKE %s OR subject ILIKE %s)")
                params.extend([f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"])
                if provider:
                    where.append("provider = %s")
                    params.append(provider)
                if kind:
                    where.append("doc_kind = %s")
                    params.append(kind)
                where_sql = " AND ".join(where)
                cursor.execute(
                    f"SELECT id, provider, filename, sender, subject, doc_kind, order_id, evidence_date FROM evidence_documents WHERE {where_sql} ORDER BY created_at DESC LIMIT %s OFFSET %s",
                    params + [limit, offset]
                )
                rows = cursor.fetchall() or []
                results = []
                for r in rows:
                    results.append({
                        "id": str(r[0]),
                        "provider": r[1],
                        "filename": r[2],
                        "sender": r[3],
                        "subject": r[4],
                        "doc_kind": r[5],
                        "order_id": r[6],
                        "evidence_date": r[7].isoformat() if r[7] else None
                    })
        return {"results": results, "total": len(results)}
    except Exception as e:
        logger.error(f"Unexpected error in search_evidence: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/v1/integrations/evidence/webhooks/gmail/watch")
async def gmail_watch_webhook(
    body: Dict[str, Any] = Body(...)
):
    """Handle Gmail Pub/Sub push (configure upstream)."""
    try:
        logger.info(f"gmail.watch webhook: {body}")
        # TODO: verify signature, decode message, identify user/source by email
        # For MVP: expect { "source_id": "...", "user_id": "..." }
        source_id = body.get("source_id")
        user_id = body.get("user_id")
        if source_id and user_id:
            job_id = await evidence_service._start_ingestion_job(source_id, user_id)  # noqa
            return {"ok": True, "job_id": job_id}
        return {"ok": True}
    except Exception as e:
        logger.error(f"gmail_watch_webhook failed: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/v1/integrations/evidence/webhooks/gdrive/changes")
async def gdrive_changes_webhook(
    body: Dict[str, Any] = Body(...)
):
    """Handle Google Drive push notifications."""
    try:
        logger.info(f"gdrive.changes webhook: {body}")
        # Expect mapping payload to { source_id, user_id }
        source_id = body.get("source_id")
        user_id = body.get("user_id")
        if source_id and user_id:
            job_id = await evidence_service._start_ingestion_job(source_id, user_id)  # noqa
            return {"ok": True, "job_id": job_id}
        return {"ok": True}
    except Exception as e:
        logger.error(f"gdrive_changes_webhook failed: {e}")
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
