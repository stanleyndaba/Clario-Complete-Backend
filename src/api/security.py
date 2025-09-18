"""
Security API Endpoints
Phase 6: Security and privacy management endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import logging

from src.api.auth_middleware import get_current_user
from src.security.encryption_service import encryption_service
from src.security.access_control import access_control_service, Permission, Role
from src.security.audit_service import audit_service, AuditAction, AuditSeverity
from src.security.data_retention_service import data_retention_service
from src.common.db_postgresql import DatabaseManager

logger = logging.getLogger(__name__)

router = APIRouter()
db = DatabaseManager()

@router.post("/api/v1/security/encrypt", response_model=Dict[str, Any], tags=["security"])
async def encrypt_data(
    data: Dict[str, Any],
    key_id: Optional[str] = None,
    user: dict = Depends(get_current_user)
):
    """
    Encrypt sensitive data using AES-256 encryption.
    Requires admin or system permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.SYSTEM_WRITE
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        encrypted_data = encryption_service.encrypt_data(data, key_id)
        
        # Log the encryption event
        await audit_service.log_event(
            action=AuditAction.SYSTEM_START,  # Reuse for encryption
            user_id=user_id,
            resource_type="encryption",
            security_context={
                "key_id": key_id or "default",
                "data_size": len(str(data))
            }
        )
        
        return {
            "success": True,
            "encrypted_data": encrypted_data,
            "encrypted_at": datetime.utcnow().isoformat() + "Z"
        }
        
    except Exception as e:
        logger.error(f"Failed to encrypt data: {e}")
        raise HTTPException(status_code=500, detail="Encryption failed")

@router.post("/api/v1/security/decrypt", response_model=Dict[str, Any], tags=["security"])
async def decrypt_data(
    encrypted_data: Dict[str, Any],
    user: dict = Depends(get_current_user)
):
    """
    Decrypt sensitive data using AES-256 encryption.
    Requires admin or system permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.SYSTEM_READ
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        decrypted_data = encryption_service.decrypt_data(encrypted_data)
        
        # Log the decryption event
        await audit_service.log_event(
            action=AuditAction.SYSTEM_START,  # Reuse for decryption
            user_id=user_id,
            resource_type="decryption",
            security_context={
                "key_id": encrypted_data.get("key_id", "default")
            }
        )
        
        return {
            "success": True,
            "decrypted_data": decrypted_data,
            "decrypted_at": datetime.utcnow().isoformat() + "Z"
        }
        
    except Exception as e:
        logger.error(f"Failed to decrypt data: {e}")
        raise HTTPException(status_code=500, detail="Decryption failed")

@router.get("/api/v1/security/keys", response_model=Dict[str, Any], tags=["security"])
async def get_encryption_keys(
    user: dict = Depends(get_current_user)
):
    """
    Get status of all encryption keys.
    Requires admin permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.ADMIN_READ
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        key_status = encryption_service.get_key_status()
        
        # Log the key status check
        await audit_service.log_event(
            action=AuditAction.ADMIN_READ,
            user_id=user_id,
            resource_type="encryption_keys",
            security_context={"total_keys": key_status.get("total_keys", 0)}
        )
        
        return key_status
        
    except Exception as e:
        logger.error(f"Failed to get encryption keys: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve key status")

@router.post("/api/v1/security/keys/rotate", response_model=Dict[str, Any], tags=["security"])
async def rotate_encryption_keys(
    user: dict = Depends(get_current_user)
):
    """
    Rotate encryption keys.
    Requires admin permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.ADMIN_WRITE
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        rotation_result = encryption_service.rotate_keys()
        
        # Log the key rotation
        await audit_service.log_event(
            action=AuditAction.CONFIG_CHANGE,
            user_id=user_id,
            resource_type="encryption_keys",
            severity=AuditSeverity.HIGH,
            security_context={
                "rotated_keys": rotation_result.get("rotated_keys", []),
                "rotation_count": len(rotation_result.get("rotated_keys", []))
            }
        )
        
        return rotation_result
        
    except Exception as e:
        logger.error(f"Failed to rotate encryption keys: {e}")
        raise HTTPException(status_code=500, detail="Key rotation failed")

@router.post("/api/v1/security/roles/assign", response_model=Dict[str, Any], tags=["security"])
async def assign_role(
    user_id: str,
    role: Role,
    expires_at: Optional[datetime] = None,
    user: dict = Depends(get_current_user)
):
    """
    Assign a role to a user.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        current_user_id, Permission.ADMIN_WRITE
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        role_id = await access_control_service.assign_role(
            user_id=user_id,
            role=role,
            granted_by=current_user_id,
            expires_at=expires_at
        )
        
        # Log the role assignment
        await audit_service.log_event(
            action=AuditAction.ROLE_ASSIGN,
            user_id=current_user_id,
            resource_type="user_role",
            resource_id=role_id,
            security_context={
                "assigned_user_id": user_id,
                "role": role.value,
                "expires_at": expires_at.isoformat() + "Z" if expires_at else None
            }
        )
        
        return {
            "success": True,
            "role_id": role_id,
            "user_id": user_id,
            "role": role.value,
            "assigned_at": datetime.utcnow().isoformat() + "Z"
        }
        
    except Exception as e:
        logger.error(f"Failed to assign role: {e}")
        raise HTTPException(status_code=500, detail="Role assignment failed")

@router.delete("/api/v1/security/roles/{role_id}", response_model=Dict[str, Any], tags=["security"])
async def revoke_role(
    role_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Revoke a user role.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        current_user_id, Permission.ADMIN_WRITE
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        success = await access_control_service.revoke_role(role_id, current_user_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Role not found")
        
        # Log the role revocation
        await audit_service.log_event(
            action=AuditAction.ROLE_REVOKE,
            user_id=current_user_id,
            resource_type="user_role",
            resource_id=role_id,
            security_context={"revoked_role_id": role_id}
        )
        
        return {
            "success": True,
            "role_id": role_id,
            "revoked_at": datetime.utcnow().isoformat() + "Z"
        }
        
    except Exception as e:
        logger.error(f"Failed to revoke role: {e}")
        raise HTTPException(status_code=500, detail="Role revocation failed")

@router.get("/api/v1/security/audit/events", response_model=Dict[str, Any], tags=["security"])
async def get_audit_events(
    action: Optional[AuditAction] = Query(None, description="Filter by action"),
    severity: Optional[AuditSeverity] = Query(None, description="Filter by severity"),
    resource_type: Optional[str] = Query(None, description="Filter by resource type"),
    start_date: Optional[datetime] = Query(None, description="Start date filter"),
    end_date: Optional[datetime] = Query(None, description="End date filter"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """
    Get audit events with filtering.
    Requires audit or admin permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.AUDIT_READ
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        events = await audit_service.get_audit_events(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            severity=severity,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset
        )
        
        # Log the audit access
        await audit_service.log_event(
            action=AuditAction.AUDIT_READ,
            user_id=user_id,
            resource_type="audit_log",
            security_context={
                "filters": {
                    "action": action.value if action else None,
                    "severity": severity.value if severity else None,
                    "resource_type": resource_type,
                    "start_date": start_date.isoformat() + "Z" if start_date else None,
                    "end_date": end_date.isoformat() + "Z" if end_date else None
                },
                "limit": limit,
                "offset": offset
            }
        )
        
        return events
        
    except Exception as e:
        logger.error(f"Failed to get audit events: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve audit events")

@router.get("/api/v1/security/audit/statistics", response_model=Dict[str, Any], tags=["security"])
async def get_audit_statistics(
    start_date: Optional[datetime] = Query(None, description="Start date filter"),
    end_date: Optional[datetime] = Query(None, description="End date filter"),
    user: dict = Depends(get_current_user)
):
    """
    Get audit statistics.
    Requires audit or admin permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.AUDIT_READ
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        statistics = await audit_service.get_audit_statistics(
            start_date=start_date,
            end_date=end_date
        )
        
        return statistics
        
    except Exception as e:
        logger.error(f"Failed to get audit statistics: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve audit statistics")

@router.get("/api/v1/security/incidents", response_model=Dict[str, Any], tags=["security"])
async def get_security_incidents(
    severity: Optional[AuditSeverity] = Query(None, description="Filter by severity"),
    status: Optional[str] = Query(None, description="Filter by status"),
    start_date: Optional[datetime] = Query(None, description="Start date filter"),
    end_date: Optional[datetime] = Query(None, description="End date filter"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user)
):
    """
    Get security incidents.
    Requires admin permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.ADMIN_READ
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        incidents = await audit_service.get_security_incidents(
            severity=severity,
            status=status,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset
        )
        
        return incidents
        
    except Exception as e:
        logger.error(f"Failed to get security incidents: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve security incidents")

@router.post("/api/v1/security/incidents", response_model=Dict[str, Any], tags=["security"])
async def create_security_incident(
    incident_type: str,
    severity: AuditSeverity,
    title: str,
    description: str,
    affected_user_id: Optional[str] = None,
    affected_resource: Optional[str] = None,
    user: dict = Depends(get_current_user)
):
    """
    Create a security incident.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        current_user_id, Permission.ADMIN_WRITE
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        incident_id = await audit_service.create_security_incident(
            incident_type=incident_type,
            severity=severity,
            title=title,
            description=description,
            affected_user_id=affected_user_id,
            affected_resource=affected_resource
        )
        
        return {
            "success": True,
            "incident_id": incident_id,
            "created_at": datetime.utcnow().isoformat() + "Z"
        }
        
    except Exception as e:
        logger.error(f"Failed to create security incident: {e}")
        raise HTTPException(status_code=500, detail="Failed to create security incident")

@router.post("/api/v1/security/data/cleanup", response_model=Dict[str, Any], tags=["security"])
async def run_data_cleanup(
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """
    Run data retention cleanup.
    Requires admin permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.ADMIN_WRITE
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        # Run cleanup in background
        background_tasks.add_task(data_retention_service.run_cleanup_job)
        
        # Log the cleanup initiation
        await audit_service.log_event(
            action=AuditAction.SYSTEM_START,
            user_id=user_id,
            resource_type="data_cleanup",
            security_context={"cleanup_initiated": True}
        )
        
        return {
            "message": "Data cleanup started in background",
            "initiated_at": datetime.utcnow().isoformat() + "Z"
        }
        
    except Exception as e:
        logger.error(f"Failed to start data cleanup: {e}")
        raise HTTPException(status_code=500, detail="Failed to start data cleanup")

@router.get("/api/v1/security/data/retention", response_model=Dict[str, Any], tags=["security"])
async def get_retention_status(
    user: dict = Depends(get_current_user)
):
    """
    Get data retention status.
    Requires admin permissions.
    """
    user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        user_id, Permission.ADMIN_READ
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        status = await data_retention_service.get_retention_status()
        return status
        
    except Exception as e:
        logger.error(f"Failed to get retention status: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve retention status")

@router.post("/api/v1/security/data/anonymize", response_model=Dict[str, Any], tags=["security"])
async def anonymize_user_data(
    target_user_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Anonymize user data for GDPR compliance.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    # Check permissions
    has_permission = await access_control_service.check_permission(
        current_user_id, Permission.ADMIN_WRITE
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        result = await data_retention_service.anonymize_user_data(target_user_id)
        
        # Log the anonymization
        await audit_service.log_event(
            action=AuditAction.DATA_ANONYMIZE,
            user_id=current_user_id,
            resource_type="user_data",
            resource_id=target_user_id,
            severity=AuditSeverity.HIGH,
            security_context={
                "target_user_id": target_user_id,
                "anonymization_results": result
            }
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Failed to anonymize user data: {e}")
        raise HTTPException(status_code=500, detail="Failed to anonymize user data")
