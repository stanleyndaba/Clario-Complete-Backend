"""
Enhanced Audit Service
Phase 6: Comprehensive audit logging with security context and encryption
"""

import uuid
import json
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import logging
from enum import Enum

from src.common.db_postgresql import DatabaseManager
from src.security.encryption_service import encryption_service
from src.security.access_control import Permission

logger = logging.getLogger(__name__)

class AuditSeverity(str, Enum):
    """Audit event severity levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class AuditAction(str, Enum):
    """Audit action types"""
    # Authentication actions
    LOGIN = "login"
    LOGOUT = "logout"
    LOGIN_FAILED = "login_failed"
    PASSWORD_CHANGE = "password_change"
    PASSWORD_RESET = "password_reset"
    
    # Evidence actions
    EVIDENCE_UPLOAD = "evidence_upload"
    EVIDENCE_DELETE = "evidence_delete"
    EVIDENCE_VIEW = "evidence_view"
    EVIDENCE_DOWNLOAD = "evidence_download"
    
    # Dispute actions
    DISPUTE_CREATE = "dispute_create"
    DISPUTE_UPDATE = "dispute_update"
    DISPUTE_DELETE = "dispute_delete"
    DISPUTE_SUBMIT = "dispute_submit"
    DISPUTE_APPROVE = "dispute_approve"
    DISPUTE_REJECT = "dispute_reject"
    
    # Proof packet actions
    PROOF_PACKET_GENERATE = "proof_packet_generate"
    PROOF_PACKET_DOWNLOAD = "proof_packet_download"
    PROOF_PACKET_DELETE = "proof_packet_delete"
    
    # Prompt actions
    PROMPT_CREATE = "prompt_create"
    PROMPT_ANSWER = "prompt_answer"
    PROMPT_EXPIRE = "prompt_expire"
    PROMPT_CANCEL = "prompt_cancel"
    
    # System actions
    SYSTEM_START = "system_start"
    SYSTEM_STOP = "system_stop"
    SYSTEM_ERROR = "system_error"
    CONFIG_CHANGE = "config_change"
    
    # Security actions
    PERMISSION_GRANT = "permission_grant"
    PERMISSION_REVOKE = "permission_revoke"
    ROLE_ASSIGN = "role_assign"
    ROLE_REVOKE = "role_revoke"
    API_KEY_CREATE = "api_key_create"
    API_KEY_REVOKE = "api_key_revoke"
    
    # Data actions
    DATA_EXPORT = "data_export"
    DATA_IMPORT = "data_import"
    DATA_DELETE = "data_delete"
    DATA_ANONYMIZE = "data_anonymize"

class AuditService:
    """Enhanced audit service with security context and encryption"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.encryption_service = encryption_service
        
    async def log_event(
        self,
        action: AuditAction,
        user_id: Optional[str] = None,
        service_account_id: Optional[str] = None,
        resource_type: str = "unknown",
        resource_id: Optional[str] = None,
        severity: AuditSeverity = AuditSeverity.MEDIUM,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
        response_status: Optional[int] = None,
        response_time_ms: Optional[int] = None,
        error_message: Optional[str] = None,
        security_context: Optional[Dict[str, Any]] = None,
        sensitive_data: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None
    ) -> str:
        """Log an audit event with full context"""
        try:
            event_id = str(uuid.uuid4())
            
            # Encrypt sensitive data if provided
            encrypted_data = None
            if sensitive_data:
                encrypted_data = self.encryption_service.encrypt_data(sensitive_data)
            
            # Prepare security context
            security_context = security_context or {}
            security_context.update({
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "action": action.value,
                "severity": severity.value
            })
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT log_security_event(
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        )
                    """, (
                        user_id, service_account_id, session_id, action.value,
                        resource_type, resource_id, severity.value, ip_address,
                        user_agent, request_id, response_status, response_time_ms,
                        error_message, json.dumps(security_context), 
                        json.dumps(encrypted_data) if encrypted_data else None
                    ))
            
            # Log to application logger
            self._log_to_application_logger(
                event_id, action, user_id, severity, error_message
            )
            
            return event_id
            
        except Exception as e:
            logger.error(f"Failed to log audit event: {e}")
            raise
    
    async def get_audit_events(
        self,
        user_id: Optional[str] = None,
        action: Optional[AuditAction] = None,
        resource_type: Optional[str] = None,
        severity: Optional[AuditSeverity] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Get audit events with filtering"""
        try:
            where_conditions = []
            params = []
            
            if user_id:
                where_conditions.append("user_id = %s")
                params.append(user_id)
            
            if action:
                where_conditions.append("action = %s")
                params.append(action.value)
            
            if resource_type:
                where_conditions.append("resource_type = %s")
                params.append(resource_type)
            
            if severity:
                where_conditions.append("severity = %s")
                params.append(severity.value)
            
            if start_date:
                where_conditions.append("created_at >= %s")
                params.append(start_date)
            
            if end_date:
                where_conditions.append("created_at <= %s")
                params.append(end_date)
            
            where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get events
                    cursor.execute(f"""
                        SELECT id, user_id, service_account_id, session_id, action, resource_type,
                               resource_id, severity, ip_address, user_agent, request_id,
                               response_status, response_time_ms, error_message, security_context,
                               encrypted_data, created_at
                        FROM security_audit_log 
                        {where_clause}
                        ORDER BY created_at DESC
                        LIMIT %s OFFSET %s
                    """, params + [limit, offset])
                    
                    events = []
                    for row in cursor.fetchall():
                        event = {
                            "id": str(row[0]),
                            "user_id": str(row[1]) if row[1] else None,
                            "service_account_id": str(row[2]) if row[2] else None,
                            "session_id": row[3],
                            "action": row[4],
                            "resource_type": row[5],
                            "resource_id": row[6],
                            "severity": row[7],
                            "ip_address": row[8],
                            "user_agent": row[9],
                            "request_id": row[10],
                            "response_status": row[11],
                            "response_time_ms": row[12],
                            "error_message": row[13],
                            "security_context": json.loads(row[14]) if row[14] else {},
                            "encrypted_data": json.loads(row[15]) if row[15] else None,
                            "created_at": row[16].isoformat() + "Z"
                        }
                        
                        # Decrypt sensitive data if present
                        if event["encrypted_data"]:
                            try:
                                event["sensitive_data"] = self.encryption_service.decrypt_data(
                                    event["encrypted_data"]
                                )
                            except Exception as e:
                                logger.warning(f"Failed to decrypt sensitive data: {e}")
                                event["sensitive_data"] = None
                        
                        events.append(event)
                    
                    # Get total count
                    cursor.execute(f"""
                        SELECT COUNT(*) FROM security_audit_log {where_clause}
                    """, params)
                    total = cursor.fetchone()[0]
                    
                    return {
                        "events": events,
                        "total": total,
                        "has_more": offset + len(events) < total,
                        "pagination": {
                            "limit": limit,
                            "offset": offset,
                            "total": total,
                            "has_more": offset + len(events) < total
                        }
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get audit events: {e}")
            raise
    
    async def get_security_incidents(
        self,
        severity: Optional[AuditSeverity] = None,
        status: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Get security incidents"""
        try:
            where_conditions = []
            params = []
            
            if severity:
                where_conditions.append("severity = %s")
                params.append(severity.value)
            
            if status:
                where_conditions.append("status = %s")
                params.append(status)
            
            if start_date:
                where_conditions.append("created_at >= %s")
                params.append(start_date)
            
            if end_date:
                where_conditions.append("created_at <= %s")
                params.append(end_date)
            
            where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(f"""
                        SELECT id, incident_type, severity, title, description,
                               affected_user_id, affected_resource, status, resolved_at,
                               resolved_by, resolution_notes, created_at, updated_at, metadata
                        FROM security_incidents 
                        {where_clause}
                        ORDER BY created_at DESC
                        LIMIT %s OFFSET %s
                    """, params + [limit, offset])
                    
                    incidents = []
                    for row in cursor.fetchall():
                        incidents.append({
                            "id": str(row[0]),
                            "incident_type": row[1],
                            "severity": row[2],
                            "title": row[3],
                            "description": row[4],
                            "affected_user_id": str(row[5]) if row[5] else None,
                            "affected_resource": row[6],
                            "status": row[7],
                            "resolved_at": row[8].isoformat() + "Z" if row[8] else None,
                            "resolved_by": str(row[9]) if row[9] else None,
                            "resolution_notes": row[10],
                            "created_at": row[11].isoformat() + "Z",
                            "updated_at": row[12].isoformat() + "Z",
                            "metadata": json.loads(row[13]) if row[13] else {}
                        })
                    
                    # Get total count
                    cursor.execute(f"""
                        SELECT COUNT(*) FROM security_incidents {where_clause}
                    """, params)
                    total = cursor.fetchone()[0]
                    
                    return {
                        "incidents": incidents,
                        "total": total,
                        "has_more": offset + len(incidents) < total
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get security incidents: {e}")
            raise
    
    async def create_security_incident(
        self,
        incident_type: str,
        severity: AuditSeverity,
        title: str,
        description: str,
        affected_user_id: Optional[str] = None,
        affected_resource: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """Create a security incident"""
        try:
            incident_id = str(uuid.uuid4())
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO security_incidents 
                        (id, incident_type, severity, title, description, affected_user_id,
                         affected_resource, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        incident_id, incident_type, severity.value, title, description,
                        affected_user_id, affected_resource, json.dumps(metadata or {})
                    ))
            
            # Log the incident creation
            await self.log_event(
                action=AuditAction.SYSTEM_ERROR,
                severity=severity,
                resource_type="security_incident",
                resource_id=incident_id,
                security_context={
                    "incident_type": incident_type,
                    "title": title,
                    "affected_user_id": affected_user_id,
                    "affected_resource": affected_resource
                }
            )
            
            return incident_id
            
        except Exception as e:
            logger.error(f"Failed to create security incident: {e}")
            raise
    
    async def resolve_security_incident(
        self,
        incident_id: str,
        resolved_by: str,
        resolution_notes: str
    ) -> bool:
        """Resolve a security incident"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE security_incidents 
                        SET status = 'resolved', resolved_at = NOW(), resolved_by = %s,
                            resolution_notes = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (resolved_by, resolution_notes, incident_id))
                    
                    return cursor.rowcount > 0
                    
        except Exception as e:
            logger.error(f"Failed to resolve security incident {incident_id}: {e}")
            return False
    
    def _log_to_application_logger(
        self,
        event_id: str,
        action: AuditAction,
        user_id: Optional[str],
        severity: AuditSeverity,
        error_message: Optional[str]
    ):
        """Log to application logger for immediate visibility"""
        log_message = f"Audit Event {event_id}: {action.value}"
        if user_id:
            log_message += f" by user {user_id}"
        if error_message:
            log_message += f" - Error: {error_message}"
        
        if severity == AuditSeverity.CRITICAL:
            logger.critical(log_message)
        elif severity == AuditSeverity.HIGH:
            logger.error(log_message)
        elif severity == AuditSeverity.MEDIUM:
            logger.warning(log_message)
        else:
            logger.info(log_message)
    
    async def get_audit_statistics(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Get audit statistics"""
        try:
            where_conditions = []
            params = []
            
            if start_date:
                where_conditions.append("created_at >= %s")
                params.append(start_date)
            
            if end_date:
                where_conditions.append("created_at <= %s")
                params.append(end_date)
            
            where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(f"""
                        SELECT 
                            COUNT(*) as total_events,
                            COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_events,
                            COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_events,
                            COUNT(CASE WHEN severity = 'medium' THEN 1 END) as medium_events,
                            COUNT(CASE WHEN severity = 'low' THEN 1 END) as low_events,
                            COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) as error_events,
                            COUNT(DISTINCT user_id) as unique_users,
                            COUNT(DISTINCT ip_address) as unique_ips
                        FROM security_audit_log 
                        {where_clause}
                    """, params)
                    
                    result = cursor.fetchone()
                    if result:
                        return {
                            "total_events": result[0] or 0,
                            "critical_events": result[1] or 0,
                            "high_events": result[2] or 0,
                            "medium_events": result[3] or 0,
                            "low_events": result[4] or 0,
                            "error_events": result[5] or 0,
                            "unique_users": result[6] or 0,
                            "unique_ips": result[7] or 0,
                            "period": {
                                "start_date": start_date.isoformat() + "Z" if start_date else None,
                                "end_date": end_date.isoformat() + "Z" if end_date else None
                            }
                        }
                    
                    return {}
                    
        except Exception as e:
            logger.error(f"Failed to get audit statistics: {e}")
            return {}

# Global instance
audit_service = AuditService()
