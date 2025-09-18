"""
Access Control Service
Phase 6: Row-Level Security (RLS) and Role-Based Access Control (RBAC)
"""

import uuid
import json
from typing import Dict, Any, List, Optional, Set
from datetime import datetime, timedelta
import logging
from enum import Enum

from src.common.db_postgresql import DatabaseManager
from src.common.config import settings

logger = logging.getLogger(__name__)

class Permission(str, Enum):
    """System permissions"""
    # Evidence permissions
    EVIDENCE_READ = "evidence:read"
    EVIDENCE_WRITE = "evidence:write"
    EVIDENCE_DELETE = "evidence:delete"
    
    # Dispute permissions
    DISPUTE_READ = "dispute:read"
    DISPUTE_WRITE = "dispute:write"
    DISPUTE_SUBMIT = "dispute:submit"
    DISPUTE_APPROVE = "dispute:approve"
    
    # Proof packet permissions
    PROOF_PACKET_READ = "proof_packet:read"
    PROOF_PACKET_GENERATE = "proof_packet:generate"
    PROOF_PACKET_DOWNLOAD = "proof_packet:download"
    
    # Audit permissions
    AUDIT_READ = "audit:read"
    AUDIT_EXPORT = "audit:export"
    
    # Admin permissions
    ADMIN_READ = "admin:read"
    ADMIN_WRITE = "admin:write"
    ADMIN_DELETE = "admin:delete"
    ADMIN_AUDIT = "admin:audit"
    
    # System permissions
    SYSTEM_READ = "system:read"
    SYSTEM_WRITE = "system:write"
    SYSTEM_DELETE = "system:delete"

class Role(str, Enum):
    """System roles"""
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    MANAGER = "manager"
    SELLER = "seller"
    AUDITOR = "auditor"
    READONLY = "readonly"
    SERVICE = "service"

class AccessControlService:
    """Service for managing access control and permissions"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.role_permissions = self._initialize_role_permissions()
        
    def _initialize_role_permissions(self) -> Dict[Role, Set[Permission]]:
        """Initialize role-based permissions"""
        return {
            Role.SUPER_ADMIN: {
                Permission.EVIDENCE_READ, Permission.EVIDENCE_WRITE, Permission.EVIDENCE_DELETE,
                Permission.DISPUTE_READ, Permission.DISPUTE_WRITE, Permission.DISPUTE_SUBMIT, Permission.DISPUTE_APPROVE,
                Permission.PROOF_PACKET_READ, Permission.PROOF_PACKET_GENERATE, Permission.PROOF_PACKET_DOWNLOAD,
                Permission.AUDIT_READ, Permission.AUDIT_EXPORT,
                Permission.ADMIN_READ, Permission.ADMIN_WRITE, Permission.ADMIN_DELETE, Permission.ADMIN_AUDIT,
                Permission.SYSTEM_READ, Permission.SYSTEM_WRITE, Permission.SYSTEM_DELETE
            },
            Role.ADMIN: {
                Permission.EVIDENCE_READ, Permission.EVIDENCE_WRITE, Permission.EVIDENCE_DELETE,
                Permission.DISPUTE_READ, Permission.DISPUTE_WRITE, Permission.DISPUTE_SUBMIT, Permission.DISPUTE_APPROVE,
                Permission.PROOF_PACKET_READ, Permission.PROOF_PACKET_GENERATE, Permission.PROOF_PACKET_DOWNLOAD,
                Permission.AUDIT_READ, Permission.AUDIT_EXPORT,
                Permission.ADMIN_READ, Permission.ADMIN_WRITE
            },
            Role.MANAGER: {
                Permission.EVIDENCE_READ, Permission.EVIDENCE_WRITE,
                Permission.DISPUTE_READ, Permission.DISPUTE_WRITE, Permission.DISPUTE_SUBMIT,
                Permission.PROOF_PACKET_READ, Permission.PROOF_PACKET_GENERATE, Permission.PROOF_PACKET_DOWNLOAD,
                Permission.AUDIT_READ
            },
            Role.SELLER: {
                Permission.EVIDENCE_READ, Permission.EVIDENCE_WRITE,
                Permission.DISPUTE_READ, Permission.DISPUTE_WRITE, Permission.DISPUTE_SUBMIT,
                Permission.PROOF_PACKET_READ, Permission.PROOF_PACKET_DOWNLOAD
            },
            Role.AUDITOR: {
                Permission.EVIDENCE_READ,
                Permission.DISPUTE_READ,
                Permission.PROOF_PACKET_READ,
                Permission.AUDIT_READ, Permission.AUDIT_EXPORT
            },
            Role.READONLY: {
                Permission.EVIDENCE_READ,
                Permission.DISPUTE_READ,
                Permission.PROOF_PACKET_READ
            },
            Role.SERVICE: {
                Permission.EVIDENCE_READ, Permission.EVIDENCE_WRITE,
                Permission.DISPUTE_READ, Permission.DISPUTE_WRITE, Permission.DISPUTE_SUBMIT,
                Permission.PROOF_PACKET_READ, Permission.PROOF_PACKET_GENERATE,
                Permission.SYSTEM_READ, Permission.SYSTEM_WRITE
            }
        }
    
    async def assign_role(
        self, 
        user_id: str, 
        role: Role, 
        granted_by: str,
        expires_at: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """Assign a role to a user"""
        try:
            role_id = str(uuid.uuid4())
            permissions = list(self.role_permissions[role])
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO user_roles 
                        (id, user_id, role_name, permissions, granted_by, expires_at, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        role_id, user_id, role.value, json.dumps(permissions),
                        granted_by, expires_at, json.dumps(metadata or {})
                    ))
            
            logger.info(f"Assigned role {role.value} to user {user_id}")
            return role_id
            
        except Exception as e:
            logger.error(f"Failed to assign role {role.value} to user {user_id}: {e}")
            raise
    
    async def revoke_role(self, role_id: str, revoked_by: str) -> bool:
        """Revoke a user role"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE user_roles 
                        SET is_active = FALSE, updated_at = NOW()
                        WHERE id = %s
                    """, (role_id,))
                    
                    return cursor.rowcount > 0
                    
        except Exception as e:
            logger.error(f"Failed to revoke role {role_id}: {e}")
            return False
    
    async def check_permission(
        self, 
        user_id: str, 
        permission: Permission,
        resource_type: Optional[str] = None
    ) -> bool:
        """Check if user has a specific permission"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT check_user_permission(%s, %s, %s)
                    """, (user_id, permission.value, resource_type))
                    
                    result = cursor.fetchone()
                    return result[0] if result else False
                    
        except Exception as e:
            logger.error(f"Failed to check permission {permission.value} for user {user_id}: {e}")
            return False
    
    async def get_user_permissions(self, user_id: str) -> Set[Permission]:
        """Get all permissions for a user"""
        try:
            permissions = set()
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT permissions FROM user_roles 
                        WHERE user_id = %s AND is_active = TRUE 
                        AND (expires_at IS NULL OR expires_at > NOW())
                    """, (user_id,))
                    
                    for row in cursor.fetchall():
                        role_permissions = json.loads(row[0])
                        for perm in role_permissions:
                            try:
                                permissions.add(Permission(perm))
                            except ValueError:
                                logger.warning(f"Unknown permission: {perm}")
            
            return permissions
            
        except Exception as e:
            logger.error(f"Failed to get permissions for user {user_id}: {e}")
            return set()
    
    async def get_user_roles(self, user_id: str) -> List[Dict[str, Any]]:
        """Get all roles for a user"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, role_name, permissions, granted_at, expires_at, 
                               granted_by, is_active, metadata
                        FROM user_roles 
                        WHERE user_id = %s
                        ORDER BY granted_at DESC
                    """, (user_id,))
                    
                    roles = []
                    for row in cursor.fetchall():
                        roles.append({
                            "id": str(row[0]),
                            "role_name": row[1],
                            "permissions": json.loads(row[2]),
                            "granted_at": row[3].isoformat() + "Z",
                            "expires_at": row[4].isoformat() + "Z" if row[4] else None,
                            "granted_by": str(row[5]) if row[5] else None,
                            "is_active": row[6],
                            "metadata": json.loads(row[7]) if row[7] else {}
                        })
                    
                    return roles
                    
        except Exception as e:
            logger.error(f"Failed to get roles for user {user_id}: {e}")
            return []
    
    async def create_service_account(
        self, 
        name: str, 
        description: str,
        permissions: List[Permission],
        created_by: str,
        expires_at: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Create a service account with API key"""
        try:
            # Generate API key
            api_key = self._generate_api_key()
            api_key_hash = self._hash_api_key(api_key)
            
            service_account_id = str(uuid.uuid4())
            permission_strings = [p.value for p in permissions]
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO service_accounts 
                        (id, name, description, api_key_hash, permissions, created_by, expires_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        service_account_id, name, description, api_key_hash,
                        json.dumps(permission_strings), created_by, expires_at
                    ))
            
            logger.info(f"Created service account {name}")
            
            return {
                "service_account_id": service_account_id,
                "api_key": api_key,  # Only returned once
                "name": name,
                "permissions": permission_strings
            }
            
        except Exception as e:
            logger.error(f"Failed to create service account {name}: {e}")
            raise
    
    async def validate_api_key(self, api_key: str) -> Optional[Dict[str, Any]]:
        """Validate API key and return service account info"""
        try:
            api_key_hash = self._hash_api_key(api_key)
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, name, permissions, is_active, expires_at, last_used_at
                        FROM service_accounts 
                        WHERE api_key_hash = %s
                    """, (api_key_hash,))
                    
                    result = cursor.fetchone()
                    if result:
                        service_account_id, name, permissions, is_active, expires_at, last_used_at = result
                        
                        # Check if account is active and not expired
                        if not is_active or (expires_at and expires_at < datetime.utcnow()):
                            return None
                        
                        # Update last used timestamp
                        cursor.execute("""
                            UPDATE service_accounts 
                            SET last_used_at = NOW()
                            WHERE id = %s
                        """, (service_account_id,))
                        
                        return {
                            "service_account_id": str(service_account_id),
                            "name": name,
                            "permissions": json.loads(permissions),
                            "last_used_at": last_used_at.isoformat() + "Z" if last_used_at else None
                        }
                    
                    return None
                    
        except Exception as e:
            logger.error(f"Failed to validate API key: {e}")
            return None
    
    async def revoke_service_account(self, service_account_id: str) -> bool:
        """Revoke a service account"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE service_accounts 
                        SET is_active = FALSE
                        WHERE id = %s
                    """, (service_account_id,))
                    
                    return cursor.rowcount > 0
                    
        except Exception as e:
            logger.error(f"Failed to revoke service account {service_account_id}: {e}")
            return False
    
    def _generate_api_key(self) -> str:
        """Generate a secure API key"""
        import secrets
        return f"ev_{secrets.token_urlsafe(32)}"
    
    def _hash_api_key(self, api_key: str) -> str:
        """Hash API key for storage"""
        import hashlib
        return hashlib.sha256(api_key.encode()).hexdigest()
    
    async def enforce_rls_policies(self):
        """Enable Row-Level Security policies on all tables"""
        try:
            rls_policies = [
                # Evidence documents - users can only see their own
                """
                CREATE POLICY evidence_documents_user_policy ON evidence_documents
                FOR ALL TO authenticated
                USING (user_id = current_user_id())
                """,
                
                # Dispute cases - users can only see their own
                """
                CREATE POLICY dispute_cases_user_policy ON dispute_cases
                FOR ALL TO authenticated
                USING (user_id = current_user_id())
                """,
                
                # Evidence prompts - users can only see their own
                """
                CREATE POLICY evidence_prompts_user_policy ON evidence_prompts
                FOR ALL TO authenticated
                USING (user_id = current_user_id())
                """,
                
                # Proof packets - users can only see their own
                """
                CREATE POLICY proof_packets_user_policy ON proof_packets
                FOR ALL TO authenticated
                USING (user_id = current_user_id())
                """,
                
                # Dispute submissions - users can only see their own
                """
                CREATE POLICY dispute_submissions_user_policy ON dispute_submissions
                FOR ALL TO authenticated
                USING (user_id = current_user_id())
                """,
                
                # Audit logs - users can only see their own, admins can see all
                """
                CREATE POLICY audit_log_user_policy ON audit_log
                FOR ALL TO authenticated
                USING (
                    user_id = current_user_id() 
                    OR current_user_has_permission('admin:read')
                )
                """,
                
                # Security audit logs - only admins and auditors
                """
                CREATE POLICY security_audit_log_admin_policy ON security_audit_log
                FOR ALL TO authenticated
                USING (
                    current_user_has_permission('admin:read') 
                    OR current_user_has_permission('audit:read')
                )
                """
            ]
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Enable RLS on all tables
                    tables = [
                        'evidence_documents', 'dispute_cases', 'evidence_prompts',
                        'proof_packets', 'dispute_submissions', 'audit_log',
                        'security_audit_log', 'evidence_matching_results'
                    ]
                    
                    for table in tables:
                        cursor.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
                    
                    # Create policies
                    for policy in rls_policies:
                        try:
                            cursor.execute(policy)
                        except Exception as e:
                            logger.warning(f"Failed to create RLS policy: {e}")
            
            logger.info("RLS policies enabled successfully")
            
        except Exception as e:
            logger.error(f"Failed to enforce RLS policies: {e}")
            raise

# Global instance
access_control_service = AccessControlService()
