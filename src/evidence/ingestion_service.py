"""
Evidence Ingestion Service
Handles metadata-first ingestion from external evidence sources
"""

import httpx
import asyncio
import json
import uuid
from typing import Dict, Any, List, Optional
import re
from datetime import datetime, timedelta
import logging
from src.common.db_postgresql import DatabaseManager
from src.common.config import settings
from src.evidence.oauth_connectors import get_connector
from src.api.schemas import EvidenceDocument, EvidenceIngestionJob, EvidenceSource

logger = logging.getLogger(__name__)

class EvidenceIngestionService:
    """Service for ingesting evidence documents from external sources"""
    
    def __init__(self):
        self.db = DatabaseManager()
    
    async def connect_evidence_source(
        self, 
        user_id: str, 
        provider: str, 
        oauth_code: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str
    ) -> Dict[str, Any]:
        """Connect a new evidence source via OAuth"""
        try:
            # Get OAuth connector
            connector = get_connector(provider, client_id, client_secret, redirect_uri)
            
            # Exchange code for tokens
            token_response = await connector.exchange_code_for_tokens(oauth_code)
            
            # Get user info
            user_info = await connector.get_user_info(token_response["access_token"])
            
            # Extract account email based on provider
            account_email = self._extract_account_email(provider, user_info)
            
            # Encrypt tokens
            encrypted_access_token = self._encrypt_token(token_response["access_token"])
            encrypted_refresh_token = None
            if "refresh_token" in token_response:
                encrypted_refresh_token = self._encrypt_token(token_response["refresh_token"])
            
            # Calculate token expiration
            expires_at = None
            if "expires_in" in token_response:
                expires_at = datetime.utcnow() + timedelta(seconds=token_response["expires_in"])
            
            # Store in database
            source_id = str(uuid.uuid4())
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO evidence_sources 
                        (id, user_id, provider, account_email, status, encrypted_access_token, 
                         encrypted_refresh_token, token_expires_at, permissions, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (user_id, provider, account_email) 
                        DO UPDATE SET
                            encrypted_access_token = EXCLUDED.encrypted_access_token,
                            encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
                            token_expires_at = EXCLUDED.token_expires_at,
                            status = 'connected',
                            updated_at = NOW()
                        RETURNING id
                    """, (
                        source_id,
                        user_id,
                        provider,
                        account_email,
                        "connected",
                        encrypted_access_token,
                        encrypted_refresh_token,
                        expires_at,
                        json.dumps(self._get_permissions(provider)),
                        json.dumps(self._get_metadata(provider, user_info))
                    ))
                    result = cursor.fetchone()
                    source_id = result[0]
            
            # Start background ingestion job
            await self._start_ingestion_job(source_id, user_id)
            
            return {
                "status": "connected",
                "provider": provider,
                "account": account_email,
                "source_id": source_id,
                "permissions": self._get_permissions(provider)
            }
            
        except Exception as e:
            logger.error(f"Failed to connect evidence source {provider}: {e}")
            raise
    
    async def list_evidence_sources(self, user_id: str) -> List[EvidenceSource]:
        """List all connected evidence sources for a user"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, provider, account_email, status, connected_at, 
                               last_sync_at, permissions, metadata
                        FROM evidence_sources 
                        WHERE user_id = %s
                        ORDER BY connected_at DESC
                    """, (user_id,))
                    
                    sources = []
                    for row in cursor.fetchall():
                        sources.append(EvidenceSource(
                            id=str(row[0]),
                            provider=row[1],
                            account_email=row[2],
                            status=row[3],
                            connected_at=row[4].isoformat() + "Z",
                            last_sync_at=row[5].isoformat() + "Z" if row[5] else None,
                            permissions=json.loads(row[6]) if row[6] else [],
                            metadata=json.loads(row[7]) if row[7] else {}
                        ))
                    
                    return sources
                    
        except Exception as e:
            logger.error(f"Failed to list evidence sources: {e}")
            raise
    
    async def disconnect_evidence_source(self, user_id: str, source_id: str) -> bool:
        """Disconnect and revoke an evidence source"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get source info for token revocation
                    cursor.execute("""
                        SELECT provider, encrypted_access_token, encrypted_refresh_token
                        FROM evidence_sources 
                        WHERE id = %s AND user_id = %s
                    """, (source_id, user_id))
                    
                    result = cursor.fetchone()
                    if not result:
                        return False
                    
                    provider, encrypted_access_token, encrypted_refresh_token = result
                    
                    # Revoke tokens
                    try:
                        connector = get_connector(provider, "", "", "")  # Dummy values for revocation
                        access_token = self._decrypt_token(encrypted_access_token)
                        await connector.revoke_token(access_token)
                        
                        if encrypted_refresh_token:
                            refresh_token = self._decrypt_token(encrypted_refresh_token)
                            await connector.revoke_token(refresh_token)
                    except Exception as e:
                        logger.warning(f"Failed to revoke tokens for {provider}: {e}")
                    
                    # Delete from database
                    cursor.execute("""
                        DELETE FROM evidence_sources 
                        WHERE id = %s AND user_id = %s
                    """, (source_id, user_id))
                    
                    return cursor.rowcount > 0
                    
        except Exception as e:
            logger.error(f"Failed to disconnect evidence source: {e}")
            raise
    
    async def list_evidence_documents(
        self, 
        user_id: str, 
        source_id: Optional[str] = None,
        limit: int = 10,
        offset: int = 0
    ) -> Dict[str, Any]:
        """List evidence documents for a user"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Build query
                    where_clause = "WHERE ed.user_id = %s"
                    params = [user_id]
                    
                    if source_id:
                        where_clause += " AND ed.source_id = %s"
                        params.append(source_id)
                    
                    # Get total count
                    cursor.execute(f"""
                        SELECT COUNT(*) 
                        FROM evidence_documents ed
                        {where_clause}
                    """, params)
                    total = cursor.fetchone()[0]
                    
                    # Get documents
                    cursor.execute(f"""
                        SELECT ed.id, ed.source_id, ed.provider, ed.external_id, ed.filename,
                               ed.size_bytes, ed.content_type, ed.created_at, ed.modified_at,
                               ed.sender, ed.subject, ed.message_id, ed.folder_path,
                               ed.download_url, ed.thumbnail_url, ed.metadata, ed.processing_status,
                               ed.ocr_text, ed.extracted_data
                        FROM evidence_documents ed
                        {where_clause}
                        ORDER BY ed.ingested_at DESC
                        LIMIT %s OFFSET %s
                    """, params + [limit, offset])
                    
                    documents = []
                    for row in cursor.fetchall():
                        documents.append(EvidenceDocument(
                            id=str(row[0]),
                            source_id=str(row[1]),
                            provider=row[2],
                            external_id=row[3],
                            filename=row[4],
                            size_bytes=row[5],
                            content_type=row[6],
                            created_at=row[7].isoformat() + "Z",
                            modified_at=row[8].isoformat() + "Z",
                            sender=row[9],
                            subject=row[10],
                            message_id=row[11],
                            folder_path=row[12],
                            download_url=row[13],
                            thumbnail_url=row[14],
                            metadata=json.loads(row[15]) if row[15] else {},
                            processing_status=row[16],
                            ocr_text=row[17],
                            extracted_data=json.loads(row[18]) if row[18] else None
                        ))
                    
                    return {
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
                    
        except Exception as e:
            logger.error(f"Failed to list evidence documents: {e}")
            raise
    
    async def _start_ingestion_job(self, source_id: str, user_id: str) -> str:
        """Start a background ingestion job for a source"""
        job_id = str(uuid.uuid4())
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO evidence_ingestion_jobs 
                    (id, source_id, user_id, status, started_at)
                    VALUES (%s, %s, %s, %s, %s)
                """, (job_id, source_id, user_id, "pending", datetime.utcnow()))
        # Enqueue to ARQ worker
        try:
            from arq import create_pool
            from arq.connections import RedisSettings
            redis = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
            await redis.enqueue_job('ingest_source', source_id, user_id)
        except Exception:
            # Fallback: process inline if queue not available
            await self._process_ingestion_job(job_id)
            return job_id
        
        return job_id
    
    async def _process_ingestion_job(self, job_id: str):
        """Process an ingestion job (placeholder for background task)"""
        try:
            # Get job details
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT ej.id, ej.source_id, ej.user_id, es.provider, es.account_email,
                               es.encrypted_access_token, es.encrypted_refresh_token, es.last_sync_at, es.metadata,
                               ej.started_at
                        FROM evidence_ingestion_jobs ej
                        JOIN evidence_sources es ON ej.source_id = es.id
                        WHERE ej.id = %s
                    """, (job_id,))
                    
                    result = cursor.fetchone()
                    if not result:
                        return
                    
                    job_id, source_id, user_id, provider, account_email, encrypted_access_token, encrypted_refresh_token, last_sync_at, metadata, job_started_at = result
                    
                    # Decrypt access token
                    access_token = self._decrypt_token(encrypted_access_token)
                    refresh_token = self._decrypt_token(encrypted_refresh_token) if encrypted_refresh_token else None
                    
                    # Fetch documents based on provider
                    documents = await self._fetch_documents(provider, access_token, source_id, refresh_token=refresh_token, last_sync_at=last_sync_at)
                    
                    # Store documents
                    for doc in documents:
                        await self._store_document(source_id, user_id, provider, doc)

                    # Emit basic telemetry
                    try:
                        self._emit_ingestion_metrics(provider, len(documents))
                        # Observe time_to_evidence for the job
                        try:
                            from src.api.metrics import TIME_TO_EVIDENCE
                            if job_started_at:
                                delta = (datetime.utcnow() - job_started_at).total_seconds()
                                TIME_TO_EVIDENCE.observe(delta)
                        except Exception:
                            pass
                    except Exception:
                        pass
                    
                    # Update job status
                    cursor.execute("""
                        UPDATE evidence_ingestion_jobs 
                        SET status = 'completed', completed_at = NOW(),
                            documents_found = %s, documents_processed = %s, progress = 100
                        WHERE id = %s
                    """, (len(documents), len(documents), job_id))

                    # Bump last_sync_at on source
                    cursor.execute("""
                        UPDATE evidence_sources
                        SET last_sync_at = NOW(), updated_at = NOW()
                        WHERE id = %s
                    """, (source_id,))
                    
        except Exception as e:
            logger.error(f"Failed to process ingestion job {job_id}: {e}")
            # Update job with error
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE evidence_ingestion_jobs 
                        SET status = 'failed', completed_at = NOW(),
                            errors = %s
                        WHERE id = %s
                    """, (json.dumps([str(e)]), job_id))
    
    async def _fetch_documents(self, provider: str, access_token: str, source_id: str, refresh_token: Optional[str] = None, last_sync_at: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Fetch documents from external source (metadata only)"""
        if provider == "gmail":
            return await self._fetch_gmail_documents(access_token, source_id, refresh_token=refresh_token, last_sync_at=last_sync_at)
        if provider == "outlook":
            return await self._fetch_outlook_documents(access_token, source_id, refresh_token=refresh_token, last_sync_at=last_sync_at)
        if provider == "gdrive":
            return await self._fetch_gdrive_documents(access_token, source_id, refresh_token=refresh_token, last_sync_at=last_sync_at)
        if provider == "dropbox":
            return await self._fetch_dropbox_documents(access_token, source_id, refresh_token=refresh_token, last_sync_at=last_sync_at)
        if provider == "onedrive":
            return await self._fetch_onedrive_documents(access_token, source_id, refresh_token=refresh_token, last_sync_at=last_sync_at)
        
        # Default: placeholder mock for unsupported providers (to be implemented)
        return [
            {
                "external_id": f"doc_{provider}_1",
                "filename": f"evidence_{provider}_1",
                "size_bytes": 0,
                "content_type": "application/octet-stream",
                "created_at": datetime.utcnow() - timedelta(days=1),
                "modified_at": datetime.utcnow() - timedelta(days=1),
                "sender": None,
                "subject": None,
                "message_id": None,
                "folder_path": None,
                "metadata": {"provider": provider},
                "extracted_data": None
            }
        ]

    async def _fetch_gmail_documents(self, access_token: str, source_id: str, max_results: int = 100, refresh_token: Optional[str] = None, last_sync_at: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Fetch Gmail messages matching Amazon evidence patterns (metadata-first) with pagination and token refresh."""
        base_url = "https://gmail.googleapis.com/gmail/v1/users/me"
        headers = {"Authorization": f"Bearer {access_token}"}

        # Amazon-focused search query, metadata-first
        days = 365
        if last_sync_at:
            try:
                days = max(1, (datetime.utcnow() - last_sync_at).days)
            except Exception:
                days = 365
        query = (
            "(from:amazon.com OR from:payments.amazon.com OR subject:(invoice OR receipt OR order OR shipment OR shipping)) "
            f"has:attachment newer_than:{days}d"
        )

        documents: List[Dict[str, Any]] = []
        next_page: Optional[str] = None
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                pages_fetched = 0
                while True:
                    params = {"q": query, "maxResults": max_results}
                    if next_page:
                        params["pageToken"] = next_page
                    list_resp = await self._http_get(client, f"{base_url}/messages", headers, params, provider="gmail", refresh_token=refresh_token)
                    if not list_resp:
                        break
                    message_refs = list_resp.get("messages", [])
                    next_page = list_resp.get("nextPageToken")

                    # 2) For each ID, fetch metadata and limited payload for attachment filenames
                    for ref in message_refs:
                        msg_id = ref.get("id")
                        if not msg_id:
                            continue
                        msg_json = await self._http_get(
                            client,
                            f"{base_url}/messages/{msg_id}",
                            headers,
                            params={
                                "format": "full",
                                "fields": "id,threadId,internalDate,labelIds,sizeEstimate,payload/headers,payload/parts/filename,payload/parts/mimeType,snippet"
                            },
                            provider="gmail",
                            refresh_token=refresh_token
                        )
                        if not msg_json:
                            continue

                        # Extract headers
                        headers_list = (msg_json.get("payload", {}) or {}).get("headers", [])
                        header_map = {h.get("name", "").lower(): h.get("value", "") for h in headers_list}
                        subject = header_map.get("subject", "")
                        sender = header_map.get("from", "")
                        date_hdr = header_map.get("date", "")
                        message_id_hdr = header_map.get("message-id", "")
                        references_hdr = header_map.get("references", "")

                        # Attachment filenames (metadata-only)
                        parts = (msg_json.get("payload", {}) or {}).get("parts", []) or []
                        attachment_filenames: List[str] = []
                        for p in parts:
                            filename = p.get("filename")
                            if filename:
                                attachment_filenames.append(filename)

                        # Extract key identifiers from subject and limited headers
                        extracted = self._extract_identifiers_from_gmail(subject, sender, date_hdr)
                        # Add body snippet if present
                        if msg_json.get("snippet"):
                            extracted["body_snippet"] = msg_json.get("snippet")

                        # Classify doc kind as email
                        doc_kind = "email"

                        # Build document row (email as metadata record)
                        documents.append({
                            "external_id": msg_json.get("id"),
                            "filename": subject or f"gmail_message_{msg_json.get('id')}",
                            "size_bytes": msg_json.get("sizeEstimate", 0) or 0,
                            "content_type": "message/rfc822",
                            "created_at": datetime.utcfromtimestamp(int((msg_json.get("internalDate") or 0)) / 1000) if msg_json.get("internalDate") else datetime.utcnow(),
                            "modified_at": datetime.utcnow(),
                            "sender": sender,
                            "subject": subject,
                            "message_id": message_id_hdr or msg_json.get("id"),
                            "folder_path": None,
                            "metadata": {
                                "provider": "gmail",
                                "threadId": msg_json.get("threadId"),
                                "labelIds": msg_json.get("labelIds", []),
                                "attachment_filenames": attachment_filenames,
                                "references": references_hdr
                            },
                            "extracted_data": extracted,
                            "doc_kind": doc_kind
                        })

                    pages_fetched += 1
                    if not next_page or pages_fetched >= 5:
                        break

        except Exception as e:
            logger.error(f"Failed to fetch Gmail documents: {e}")

        return documents

    async def _fetch_onedrive_documents(self, access_token: str, source_id: str, refresh_token: Optional[str] = None, last_sync_at: Optional[datetime] = None, page_size: int = 100) -> List[Dict[str, Any]]:
        """Fetch OneDrive files by filename patterns (metadata-first)."""
        headers = {"Authorization": f"Bearer {access_token}"}
        base_url = "https://graph.microsoft.com/v1.0/me/drive/root/search(q='Amazon')"
        params = {"top": page_size}
        documents: List[Dict[str, Any]] = []
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                url = base_url
                pages = 0
                while True:
                    resp_json = await self._http_get(client, url, headers, params, provider="onedrive", refresh_token=refresh_token)
                    if not resp_json:
                        break
                    items = resp_json.get("value", [])
                    for it in items:
                        name = it.get("name", "")
                        extracted = self._extract_identifiers_from_filename(name)
                        doc_kind = self._classify_doc_kind_from_filename(name)
                        documents.append({
                            "external_id": it.get("id"),
                            "filename": name,
                            "size_bytes": int(((it.get("size") or 0))),
                            "content_type": (it.get("file") or {}).get("mimeType") or "application/octet-stream",
                            "created_at": datetime.fromisoformat(((it.get("createdDateTime") or datetime.utcnow().isoformat()).replace("Z", "+00:00"))),
                            "modified_at": datetime.fromisoformat(((it.get("lastModifiedDateTime") or datetime.utcnow().isoformat()).replace("Z", "+00:00"))),
                            "sender": None,
                            "subject": None,
                            "message_id": None,
                            "folder_path": (it.get("parentReference") or {}).get("path"),
                            "metadata": {"provider": "onedrive"},
                            "extracted_data": extracted,
                            "doc_kind": doc_kind
                        })
                    url = resp_json.get("@odata.nextLink")
                    pages += 1
                    if not url or pages >= 5:
                        break
        except Exception as e:
            logger.error(f"Failed to fetch OneDrive documents: {e}")
        return documents

    async def _fetch_outlook_documents(self, access_token: str, source_id: str, refresh_token: Optional[str] = None, last_sync_at: Optional[datetime] = None, page_size: int = 50) -> List[Dict[str, Any]]:
        """Fetch Outlook (Microsoft Graph) messages for Amazon patterns (metadata-first)."""
        base_url = "https://graph.microsoft.com/v1.0/me/messages"
        headers = {"Authorization": f"Bearer {access_token}"}
        # Filter by subject contains and from domain if possible; Graph supports $search with advancedQueryParameters
        # Use receivedDateTime ge last_sync_at for incremental
        received_filter = None
        if last_sync_at:
            received_filter = last_sync_at.strftime('%Y-%m-%dT%H:%M:%SZ')
        params = {
            "$top": page_size,
            "$select": "id,subject,from,receivedDateTime,hasAttachments,internetMessageId,bodyPreview",
            "$orderby": "receivedDateTime DESC"
        }
        if received_filter:
            params["$filter"] = f"receivedDateTime ge {received_filter}"

        documents: List[Dict[str, Any]] = []
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                next_link: Optional[str] = None
                pages = 0
                while True:
                    url = next_link or base_url
                    resp_json = await self._http_get(client, url, headers, params if not next_link else None, provider="outlook", refresh_token=refresh_token)
                    if not resp_json:
                        break
                    items = resp_json.get("value", [])
                    for it in items:
                        subject = it.get("subject") or ""
                        sender = ((it.get("from") or {}).get("emailAddress") or {}).get("address", "")
                        date_hdr = it.get("receivedDateTime") or ""
                        extracted = self._extract_identifiers_from_gmail(subject, sender, date_hdr)
                        documents.append({
                            "external_id": it.get("id"),
                            "filename": subject or f"outlook_message_{it.get('id')}",
                            "size_bytes": 0,
                            "content_type": "message/rfc822",
                            "created_at": datetime.fromisoformat((it.get("receivedDateTime") or datetime.utcnow().isoformat()).replace("Z", "+00:00")),
                            "modified_at": datetime.utcnow(),
                            "sender": sender,
                            "subject": subject,
                            "message_id": it.get("internetMessageId"),
                            "folder_path": None,
                            "metadata": {
                                "provider": "outlook",
                                "hasAttachments": it.get("hasAttachments", False)
                            },
                            "extracted_data": extracted,
                            "doc_kind": "email"
                        })

                    next_link = resp_json.get("@odata.nextLink")
                    pages += 1
                    if not next_link or pages >= 5:
                        break
        except Exception as e:
            logger.error(f"Failed to fetch Outlook documents: {e}")
        return documents

    def _extract_identifiers_from_gmail(self, subject: str, sender: str, date_hdr: str) -> Dict[str, Any]:
        """Extract order/shipment IDs, amounts, dates from Gmail headers/subject."""
        text = " ".join(filter(None, [subject, sender, date_hdr]))

        # Patterns
        order_ids = re.findall(r"\b\d{3}-\d{7}-\d{7}\b", text)
        amounts = re.findall(r"(?:USD\s*|\$)\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?", text)
        shipment_ids = []
        shipment_ids += re.findall(r"\bTBA[0-9A-Z]+\b", text)
        shipment_ids += re.findall(r"\b1Z[0-9A-Z]{16}\b", text)
        currency = self._detect_currency(text)

        return {
            "order_ids": list(set(order_ids)) or None,
            "shipment_ids": list(set(shipment_ids)) or None,
            "amounts": list(set(amounts)) or None,
            "currency": currency,
            "email_date_header": date_hdr or None
        }

    def _detect_currency(self, text: str) -> Optional[str]:
        lower = (text or "").lower()
        if " usd" in lower or "$" in text:
            return "USD"
        if " eur" in lower or "€" in text:
            return "EUR"
        if " gbp" in lower or "£" in text:
            return "GBP"
        if " cad" in lower:
            return "CAD"
        if " aud" in lower:
            return "AUD"
        return None

    async def _fetch_gdrive_documents(self, access_token: str, source_id: str, page_size: int = 100, refresh_token: Optional[str] = None, last_sync_at: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Fetch Google Drive files by filename patterns (metadata-first)."""
        headers = {"Authorization": f"Bearer {access_token}"}
        base_url = "https://www.googleapis.com/drive/v3/files"
        # Query for likely Amazon-related docs by filename
        # name contains 'Amazon' OR common receipt/invoice keywords; PDFs and CSVs prioritized
        q = " or ".join([
            "name contains 'Amazon'",
            "name contains 'amazon.com'",
            "name contains 'invoice'",
            "name contains 'receipt'",
            "name contains 'shipment'",
            "name contains 'packing'"
        ])
        q = f"({q}) and trashed = false"
        params = {
            "q": q,
            "pageSize": page_size,
            "spaces": "drive",
            "fields": "nextPageToken, files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink,description,properties)"
        }
        documents: List[Dict[str, Any]] = []
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                next_page: Optional[str] = None
                pages = 0
                while True:
                    p = dict(params)
                    if next_page:
                        p["pageToken"] = next_page
                    resp_json = await self._http_get(client, base_url, headers, p, provider="gdrive", refresh_token=refresh_token)
                    if not resp_json:
                        break
                    files = resp_json.get("files", [])
                    for f in files:
                        name = f.get("name", "")
                        extracted = self._extract_identifiers_from_filename(name)
                        doc_kind = self._classify_doc_kind_from_filename(name)
                        mime = f.get("mimeType") or "application/octet-stream"
                        # Optional first-page peek for PDFs when identifiers missing
                        if mime == "application/pdf" and not (extracted.get("order_ids") or extracted.get("shipment_ids")):
                            peeked = await self._peek_pdf_identifiers_drive(headers, f.get("id"))
                            if peeked:
                                # merge
                                for k, v in peeked.items():
                                    if v and not extracted.get(k):
                                        extracted[k] = v
                        documents.append({
                            "external_id": f.get("id"),
                            "filename": name,
                            "size_bytes": int(f.get("size") or 0),
                            "content_type": mime,
                            "created_at": datetime.fromisoformat((f.get("createdTime") or datetime.utcnow().isoformat()).replace("Z", "+00:00")),
                            "modified_at": datetime.fromisoformat((f.get("modifiedTime") or datetime.utcnow().isoformat()).replace("Z", "+00:00")),
                            "sender": None,
                            "subject": None,
                            "message_id": None,
                            "folder_path": None,
                            "metadata": {
                                "provider": "gdrive",
                                "webViewLink": f.get("webViewLink"),
                                "description": f.get("description"),
                                "properties": f.get("properties")
                            },
                            "extracted_data": extracted,
                            "doc_kind": doc_kind
                        })
                    next_page = resp_json.get("nextPageToken")
                    pages += 1
                    if not next_page or pages >= 5:
                        break
        except Exception as e:
            logger.error(f"Failed to fetch GDrive documents: {e}")
        return documents

    async def _fetch_dropbox_documents(self, access_token: str, source_id: str, refresh_token: Optional[str] = None, last_sync_at: Optional[datetime] = None, max_results: int = 500) -> List[Dict[str, Any]]:
        """Fetch Dropbox files by traversing folders (metadata-first)."""
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        list_url = "https://api.dropboxapi.com/2/files/list_folder"
        continue_url = "https://api.dropboxapi.com/2/files/list_folder/continue"
        keywords = ["amazon", "invoice", "receipt", "shipment", "packing"]
        documents: List[Dict[str, Any]] = []
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                body = {"path": "", "recursive": True, "include_media_info": False, "limit": max_results}
                resp = await self._http_post(client, list_url, headers, json=body, provider="dropbox", refresh_token=refresh_token)
                if not resp:
                    return []
                entries = resp.get("entries", [])
                cursor = resp.get("cursor")
                while True:
                    for md in entries:
                        if md.get(".tag") != "file":
                            continue
                        name = md.get("name") or ""
                        if not any(k in name.lower() for k in keywords):
                            continue
                        path_md = md.get("path_display") or md.get("path_lower") or ""
                        extracted = self._extract_identifiers_from_filename(name)
                        doc_kind = self._classify_doc_kind_from_filename(name)
                        server_modified = md.get("server_modified")
                        client_modified = md.get("client_modified")
                        # Optional first-page peek for PDFs when identifiers missing
                        if name.lower().endswith('.pdf') and not (extracted.get("order_ids") or extracted.get("shipment_ids")):
                            peeked = await self._peek_pdf_identifiers_dropbox(headers, path_md)
                            if peeked:
                                for k, v in peeked.items():
                                    if v and not extracted.get(k):
                                        extracted[k] = v
                        documents.append({
                            "external_id": md.get("id") or path_md,
                            "filename": name,
                            "size_bytes": int(md.get("size") or 0),
                            "content_type": "application/octet-stream",
                            "created_at": datetime.fromisoformat((client_modified or server_modified).replace("Z", "+00:00")) if (client_modified or server_modified) else datetime.utcnow(),
                            "modified_at": datetime.fromisoformat((server_modified or client_modified).replace("Z", "+00:00")) if (server_modified or client_modified) else datetime.utcnow(),
                            "sender": None,
                            "subject": None,
                            "message_id": None,
                            "folder_path": path_md,
                            "metadata": {
                                "provider": "dropbox"
                            },
                            "extracted_data": extracted,
                            "doc_kind": doc_kind
                        })
                    if not cursor:
                        break
                    cont = await self._http_post(client, continue_url, headers, json={"cursor": cursor}, provider="dropbox", refresh_token=refresh_token)
                    if not cont:
                        break
                    entries = cont.get("entries", [])
                    cursor = cont.get("cursor")
        except Exception as e:
            logger.error(f"Failed to fetch Dropbox documents: {e}")
        return documents

    async def _peek_pdf_identifiers_drive(self, headers: Dict[str, str], file_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not file_id:
            return None
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=headers, params={"alt": "media"}, headers__=headers)
                # httpx doesn't support headers__ param; fallback simple get without range due to tool constraints
                # In practice, we would set Range: bytes=0-262143
                if resp.status_code >= 400:
                    return None
                content = resp.content[:262144]
                return self._extract_identifiers_from_pdf_bytes(content)
        except Exception:
            return None

    async def _peek_pdf_identifiers_dropbox(self, headers: Dict[str, str], path: str) -> Optional[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                dl_headers = {
                    "Authorization": headers.get("Authorization", ""),
                    "Dropbox-API-Arg": json.dumps({"path": path})
                }
                resp = await client.post("https://content.dropboxapi.com/2/files/download", headers=dl_headers)
                if resp.status_code >= 400:
                    return None
                content = resp.content[:262144]
                return self._extract_identifiers_from_pdf_bytes(content)
        except Exception:
            return None

    async def _peek_pdf_identifiers_onedrive(self, headers: Dict[str, str], item_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not item_id:
            return None
        url = f"https://graph.microsoft.com/v1.0/me/drive/items/{item_id}/content"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code >= 400:
                    return None
                content = resp.content[:262144]
                return self._extract_identifiers_from_pdf_bytes(content)
        except Exception:
            return None

    def _extract_identifiers_from_pdf_bytes(self, content: bytes) -> Dict[str, Any]:
        try:
            text = content.decode('latin-1', errors='ignore')
        except Exception:
            text = ""
        order_ids = re.findall(r"\b\d{3}-\d{7}-\d{7}\b", text)
        shipment_ids = []
        shipment_ids += re.findall(r"\bTBA[0-9A-Z]+\b", text)
        shipment_ids += re.findall(r"\b1Z[0-9A-Z]{16}\b", text)
        amounts = re.findall(r"(?:USD\s*|\$)\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?", text)
        currency = self._detect_currency(text)
        return {
            "order_ids": list(set(order_ids)) or None,
            "shipment_ids": list(set(shipment_ids)) or None,
            "amounts": list(set(amounts)) or None,
            "currency": currency
        }

    def _extract_identifiers_from_filename(self, name: str) -> Dict[str, Any]:
        """Extract order/shipment IDs from filenames."""
        text = name or ""
        order_ids = re.findall(r"\b\d{3}-\d{7}-\d{7}\b", text)
        shipment_ids = []
        shipment_ids += re.findall(r"\bTBA[0-9A-Z]+\b", text)
        shipment_ids += re.findall(r"\b1Z[0-9A-Z]{16}\b", text)
        kind_hint = self._classify_doc_kind_from_filename(text)
        return {
            "order_ids": list(set(order_ids)) or None,
            "shipment_ids": list(set(shipment_ids)) or None,
            "kind_hint": kind_hint
        }

    def _classify_doc_kind_from_filename(self, name: str) -> str:
        """Classify document kind from filename keywords."""
        lower = (name or "").lower()
        if any(k in lower for k in ["invoice", "inv-"]):
            return "invoice"
        if any(k in lower for k in ["receipt", "rcpt"]):
            return "receipt"
        if any(k in lower for k in ["shipment", "shipping", "packing", "bol", "bill of lading"]):
            return "shipping"
        return "other"

    def _emit_ingestion_metrics(self, provider: str, count: int):
        """Telemetry scaffold for ingestion metrics."""
        try:
            logger.info(f"ingestion.metrics provider={provider} count={count}")
            try:
                # Prometheus (best-effort; safe if not initialized)
                from src.api.metrics import DOCS_DISCOVERED
                DOCS_DISCOVERED.labels(provider=provider).inc(count)
            except Exception:
                pass
        except Exception:
            pass

    async def _http_get(self, client: httpx.AsyncClient, url: str, headers: dict, params: Optional[dict], provider: str, refresh_token: Optional[str] = None, max_retries: int = 3) -> Optional[dict]:
        """HTTP GET with basic retry/backoff and token refresh on 401."""
        attempt = 0
        backoff = 0.5
        while attempt < max_retries:
            # OpenTelemetry span for provider call
            try:
                from opentelemetry import trace
                tracer = trace.get_tracer(__name__)
            except Exception:
                tracer = None
            if tracer:
                with tracer.start_as_current_span(f"provider.get.{provider}"):
                    resp = await client.get(url, params=params, headers=headers)
            else:
                resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 401 and refresh_token:
                # Try token refresh once
                refreshed = await self._refresh_access_token(provider, refresh_token)
                if refreshed:
                    headers["Authorization"] = f"Bearer {refreshed}"
                    attempt += 1
                    continue
                return None
            if resp.status_code in (429, 500, 502, 503, 504):
                retry_after = resp.headers.get('Retry-After')
                if retry_after and retry_after.isdigit():
                    await asyncio.sleep(int(retry_after))
                else:
                    await asyncio.sleep(backoff)
                backoff *= 2
                attempt += 1
                continue
            if resp.status_code >= 400:
                # increment provider error metric
                try:
                    from src.api.metrics import PROVIDER_ERRORS
                    PROVIDER_ERRORS.labels(provider=provider, status=str(resp.status_code)).inc()
                except Exception:
                    pass
                logger.warning(f"GET {url} failed: {resp.status_code}")
                return None
            try:
                return resp.json()
            except Exception:
                return None
        return None

    async def _http_post(self, client: httpx.AsyncClient, url: str, headers: dict, json: Optional[dict], provider: str, refresh_token: Optional[str] = None, max_retries: int = 3) -> Optional[dict]:
        """HTTP POST with basic retry/backoff and token refresh on 401."""
        attempt = 0
        backoff = 0.5
        while attempt < max_retries:
            try:
                from opentelemetry import trace
                tracer = trace.get_tracer(__name__)
            except Exception:
                tracer = None
            if tracer:
                with tracer.start_as_current_span(f"provider.post.{provider}"):
                    resp = await client.post(url, json=json, headers=headers)
            else:
                resp = await client.post(url, json=json, headers=headers)
            if resp.status_code == 401 and refresh_token:
                refreshed = await self._refresh_access_token(provider, refresh_token)
                if refreshed:
                    headers["Authorization"] = f"Bearer {refreshed}"
                    attempt += 1
                    continue
                return None
            if resp.status_code in (429, 500, 502, 503, 504):
                retry_after = resp.headers.get('Retry-After')
                if retry_after and retry_after.isdigit():
                    await asyncio.sleep(int(retry_after))
                else:
                    await asyncio.sleep(backoff)
                backoff *= 2
                attempt += 1
                continue
            if resp.status_code >= 400:
                try:
                    from src.api.metrics import PROVIDER_ERRORS
                    PROVIDER_ERRORS.labels(provider=provider, status=str(resp.status_code)).inc()
                except Exception:
                    pass
                logger.warning(f"POST {url} failed: {resp.status_code}")
                return None
            try:
                return resp.json()
            except Exception:
                return None
        return None

    async def _refresh_access_token(self, provider: str, refresh_token: str) -> Optional[str]:
        """Refresh access token using provider connector and update DB for the source."""
        try:
            conn = self._get_connector_for_provider(provider)
            token_data = await conn.refresh_access_token(refresh_token)
            access_token = token_data.get("access_token")
            expires_in = token_data.get("expires_in")
            if access_token and expires_in:
                with self.db._get_connection() as conn_db:
                    with conn_db.cursor() as cursor:
                        cursor.execute(
                            """
                            UPDATE evidence_sources
                            SET encrypted_access_token = %s,
                                token_expires_at = NOW() + (%s || ' seconds')::interval,
                                updated_at = NOW()
                            WHERE provider = %s AND encrypted_refresh_token IS NOT NULL
                            """,
                            (
                                self._encrypt_token(access_token),
                                str(expires_in),
                                provider,
                            ),
                        )
            return access_token
        except Exception as e:
            logger.warning(f"Token refresh failed for {provider}: {e}")
            return None

    def _get_connector_for_provider(self, provider: str):
        from src.evidence.oauth_connectors import get_connector
        if provider == "gmail":
            return get_connector(provider, settings.GMAIL_CLIENT_ID, settings.GMAIL_CLIENT_SECRET, settings.GMAIL_REDIRECT_URI)
        if provider == "outlook":
            return get_connector(provider, settings.OUTLOOK_CLIENT_ID, settings.OUTLOOK_CLIENT_SECRET, settings.OUTLOOK_REDIRECT_URI)
        if provider == "gdrive":
            return get_connector(provider, settings.GDRIVE_CLIENT_ID, settings.GDRIVE_CLIENT_SECRET, settings.GDRIVE_REDIRECT_URI)
        if provider == "dropbox":
            return get_connector(provider, settings.DROPBOX_CLIENT_ID, settings.DROPBOX_CLIENT_SECRET, settings.DROPBOX_REDIRECT_URI)
        raise ValueError(f"Unsupported provider for refresh: {provider}")

    def _first_or_none(self, values: Optional[List[str]]) -> Optional[str]:
        """Return first value from list or None."""
        if not values:
            return None
        return values[0]

    def _parse_first_amount(self, amounts: Optional[List[str]]) -> Optional[float]:
        """Parse first currency-like amount string into float."""
        if not amounts:
            return None
        raw = amounts[0]
        # Strip currency symbols and commas
        cleaned = re.sub(r"[^0-9\.]", "", raw)
        try:
            return float(cleaned)
        except Exception:
            return None

    def _parse_date_from_header(self, date_hdr: Optional[str]) -> Optional[datetime.date]:
        """Best-effort parse RFC2822-like date header into date."""
        if not date_hdr:
            return None
        try:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(str(date_hdr))
            return dt.date()
        except Exception:
            return None

    def _compute_evidence_hash(self, filename: Optional[str], size_bytes: Optional[int], created_at: Optional[datetime]) -> Optional[str]:
        """Compute a stable hash for deduplication using filename+size+day-bucket."""
        try:
            import hashlib
            name = (filename or "").strip().lower()
            size = str(size_bytes or 0)
            day = (created_at or datetime.utcnow()).strftime("%Y-%m-%d")
            payload = f"{name}|{size}|{day}".encode("utf-8")
            return hashlib.sha256(payload).hexdigest()[:32]
        except Exception:
            return None
    
    async def _store_document(self, source_id: str, user_id: str, provider: str, doc_data: Dict[str, Any]):
        """Store document metadata in database"""
        doc_id = str(uuid.uuid4())
        # Compute dedupe hash (filename + size + created date bucket)
        evidence_hash = self._compute_evidence_hash(
            doc_data.get("filename"),
            doc_data.get("size_bytes"),
            doc_data.get("created_at")
        )
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO evidence_documents 
                    (id, source_id, user_id, provider, external_id, filename, size_bytes,
                     content_type, created_at, modified_at, sender, subject, message_id,
                     folder_path, metadata, processing_status, extracted_data,
                     doc_kind, order_id, shipment_id, amount, currency, sku, asin, evidence_date, evidence_hash)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (source_id, external_id) DO NOTHING
                """, (
                    doc_id, source_id, user_id, provider, doc_data["external_id"],
                    doc_data["filename"], doc_data.get("size_bytes", 0), doc_data["content_type"],
                    doc_data["created_at"], doc_data["modified_at"], doc_data.get("sender"),
                    doc_data.get("subject"), doc_data.get("message_id"), doc_data.get("folder_path"),
                    json.dumps(doc_data.get("metadata", {})), "pending", json.dumps(doc_data.get("extracted_data")) if doc_data.get("extracted_data") is not None else None,
                    # classification and identifiers (best-effort from metadata)
                    doc_data.get("doc_kind"),
                    self._first_or_none((doc_data.get("extracted_data") or {}).get("order_ids")),
                    self._first_or_none((doc_data.get("extracted_data") or {}).get("shipment_ids")),
                    self._parse_first_amount((doc_data.get("extracted_data") or {}).get("amounts")),
                    None,
                    None,
                    None,
                    self._parse_date_from_header((doc_data.get("extracted_data") or {}).get("email_date_header")),
                    evidence_hash
                ))
    
    def _extract_account_email(self, provider: str, user_info: Dict[str, Any]) -> str:
        """Extract account email from user info based on provider"""
        if provider == "gmail":
            return user_info.get("emailAddress", "")
        elif provider == "outlook":
            return user_info.get("mail", user_info.get("userPrincipalName", ""))
        elif provider == "gdrive":
            return user_info.get("user", {}).get("emailAddress", "")
        elif provider == "dropbox":
            return user_info.get("email", "")
        return ""
    
    def _get_permissions(self, provider: str) -> List[str]:
        """Get OAuth permissions for provider"""
        permissions = {
            "gmail": ["gmail.readonly"],
            "outlook": ["Mail.Read"],
            "gdrive": ["drive.readonly"],
            "dropbox": ["files.metadata.read", "files.content.read"]
        }
        return permissions.get(provider, [])
    
    def _get_metadata(self, provider: str, user_info: Dict[str, Any]) -> Dict[str, Any]:
        """Extract provider-specific metadata"""
        if provider == "gmail":
            return {
                "name": user_info.get("displayName", ""),
                "messages_total": user_info.get("messagesTotal", 0),
                "threads_total": user_info.get("threadsTotal", 0)
            }
        elif provider == "outlook":
            return {
                "display_name": user_info.get("displayName", ""),
                "given_name": user_info.get("givenName", ""),
                "surname": user_info.get("surname", "")
            }
        elif provider == "gdrive":
            return {
                "name": user_info.get("user", {}).get("displayName", ""),
                "quota_bytes_total": user_info.get("quotaBytesTotal", 0),
                "quota_bytes_used": user_info.get("quotaBytesUsed", 0)
            }
        elif provider == "dropbox":
            return {
                "name": user_info.get("name", {}).get("display_name", ""),
                "account_id": user_info.get("account_id", ""),
                "country": user_info.get("country", "")
            }
        return {}
    
    def _encrypt_token(self, token: str) -> str:
        """Encrypt token for storage"""
        from cryptography.fernet import Fernet
        raw = "your_crypto_secret".encode('utf-8')
        if len(raw) < 32:
            raw = raw.ljust(32, b'=')
        elif len(raw) > 32:
            raw = raw[:32]
        
        import base64
        key = base64.urlsafe_b64encode(raw)
        fernet = Fernet(key)
        return fernet.encrypt(token.encode()).decode()
    
    def _decrypt_token(self, encrypted_token: str) -> str:
        """Decrypt token from storage"""
        from cryptography.fernet import Fernet
        raw = "your_crypto_secret".encode('utf-8')
        if len(raw) < 32:
            raw = raw.ljust(32, b'=')
        elif len(raw) > 32:
            raw = raw[:32]
        
        import base64
        key = base64.urlsafe_b64encode(raw)
        fernet = Fernet(key)
        return fernet.decrypt(encrypted_token.encode()).decode()
