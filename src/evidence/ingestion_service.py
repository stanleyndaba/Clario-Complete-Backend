"""
Evidence Ingestion Service
Handles metadata-first ingestion from external evidence sources
"""

import httpx
import json
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import logging
from src.common.db_postgresql import DatabaseManager
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
        
        # TODO: Queue actual ingestion task
        # For now, just mark as completed
        await self._process_ingestion_job(job_id)
        
        return job_id
    
    async def _process_ingestion_job(self, job_id: str):
        """Process an ingestion job (placeholder for background task)"""
        try:
            # Get job details
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT ej.id, ej.source_id, ej.user_id, es.provider, es.account_email,
                               es.encrypted_access_token, es.metadata
                        FROM evidence_ingestion_jobs ej
                        JOIN evidence_sources es ON ej.source_id = es.id
                        WHERE ej.id = %s
                    """, (job_id,))
                    
                    result = cursor.fetchone()
                    if not result:
                        return
                    
                    job_id, source_id, user_id, provider, account_email, encrypted_access_token, metadata = result
                    
                    # Decrypt access token
                    access_token = self._decrypt_token(encrypted_access_token)
                    
                    # Fetch documents based on provider
                    documents = await self._fetch_documents(provider, access_token, source_id)
                    
                    # Store documents
                    for doc in documents:
                        await self._store_document(source_id, user_id, provider, doc)
                    
                    # Update job status
                    cursor.execute("""
                        UPDATE evidence_ingestion_jobs 
                        SET status = 'completed', completed_at = NOW(),
                            documents_found = %s, documents_processed = %s, progress = 100
                        WHERE id = %s
                    """, (len(documents), len(documents), job_id))
                    
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
    
    async def _fetch_documents(self, provider: str, access_token: str, source_id: str) -> List[Dict[str, Any]]:
        """Fetch documents from external source (metadata only)"""
        # This is a placeholder - in production, implement actual API calls
        # For now, return mock data
        return [
            {
                "external_id": f"doc_{provider}_1",
                "filename": f"invoice_{provider}_1.pdf",
                "size_bytes": 1024000,
                "content_type": "application/pdf",
                "created_at": datetime.utcnow() - timedelta(days=1),
                "modified_at": datetime.utcnow() - timedelta(days=1),
                "sender": f"sender@{provider}.com",
                "subject": f"Invoice from {provider}",
                "message_id": f"msg_{provider}_1",
                "folder_path": "/invoices",
                "metadata": {"provider": provider}
            }
        ]
    
    async def _store_document(self, source_id: str, user_id: str, provider: str, doc_data: Dict[str, Any]):
        """Store document metadata in database"""
        doc_id = str(uuid.uuid4())
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO evidence_documents 
                    (id, source_id, user_id, provider, external_id, filename, size_bytes,
                     content_type, created_at, modified_at, sender, subject, message_id,
                     folder_path, metadata, processing_status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (source_id, external_id) DO NOTHING
                """, (
                    doc_id, source_id, user_id, provider, doc_data["external_id"],
                    doc_data["filename"], doc_data["size_bytes"], doc_data["content_type"],
                    doc_data["created_at"], doc_data["modified_at"], doc_data.get("sender"),
                    doc_data.get("subject"), doc_data.get("message_id"), doc_data.get("folder_path"),
                    json.dumps(doc_data.get("metadata", {})), "pending"
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
