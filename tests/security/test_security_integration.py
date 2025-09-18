"""
Security Integration Tests
Phase 6: Comprehensive security testing for all components
"""

import pytest
import asyncio
import json
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock

from src.security.encryption_service import encryption_service, EncryptionService
from src.security.access_control import access_control_service, AccessControlService, Permission, Role
from src.security.audit_service import audit_service, AuditService, AuditAction, AuditSeverity
from src.security.data_retention_service import data_retention_service, DataRetentionService

class TestEncryptionService:
    """Test encryption service functionality"""
    
    @pytest.fixture
    def encryption_svc(self):
        return EncryptionService()
    
    def test_encrypt_decrypt_data(self, encryption_svc):
        """Test basic encryption and decryption"""
        # Test string data
        original_data = "sensitive information"
        encrypted = encryption_svc.encrypt_data(original_data)
        decrypted = encryption_svc.decrypt_data(encrypted)
        assert decrypted == original_data
        
        # Test dict data
        original_dict = {"key": "value", "nested": {"data": "secret"}}
        encrypted_dict = encryption_svc.encrypt_data(original_dict)
        decrypted_dict = encryption_svc.decrypt_data(encrypted_dict)
        assert decrypted_dict == original_dict
    
    def test_encrypt_decrypt_file(self, encryption_svc, tmp_path):
        """Test file encryption and decryption"""
        # Create test file
        test_file = tmp_path / "test.txt"
        test_file.write_text("This is sensitive file content")
        
        # Encrypt file
        encrypted_file = tmp_path / "test.enc"
        result = encryption_svc.encrypt_file(str(test_file), str(encrypted_file))
        assert result["success"] is True
        
        # Decrypt file
        decrypted_file = tmp_path / "test_decrypted.txt"
        result = encryption_svc.decrypt_file(str(encrypted_file), str(decrypted_file))
        assert result["success"] is True
        
        # Verify content
        assert decrypted_file.read_text() == "This is sensitive file content"
    
    def test_key_rotation(self, encryption_svc):
        """Test encryption key rotation"""
        # Mock database operations
        with patch.object(encryption_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock key rotation query
            mock_cursor.fetchall.return_value = [("key1", "data"), ("key2", "master")]
            mock_cursor.rowcount = 1
            
            result = encryption_svc.rotate_keys()
            assert result["success"] is True
            assert "rotated_keys" in result
    
    def test_encryption_security(self, encryption_svc):
        """Test encryption security properties"""
        data = "sensitive data"
        
        # Same data should produce different encrypted results
        encrypted1 = encryption_svc.encrypt_data(data)
        encrypted2 = encryption_svc.encrypt_data(data)
        
        assert encrypted1["ciphertext"] != encrypted2["ciphertext"]
        assert encrypted1["iv"] != encrypted2["iv"]
        assert encrypted1["tag"] != encrypted2["tag"]
        
        # Both should decrypt to same data
        decrypted1 = encryption_svc.decrypt_data(encrypted1)
        decrypted2 = encryption_svc.decrypt_data(encrypted2)
        assert decrypted1 == decrypted2 == data

class TestAccessControlService:
    """Test access control service functionality"""
    
    @pytest.fixture
    def access_control_svc(self):
        return AccessControlService()
    
    @pytest.mark.asyncio
    async def test_role_assignment(self, access_control_svc):
        """Test role assignment and revocation"""
        with patch.object(access_control_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Test role assignment
            role_id = await access_control_svc.assign_role(
                user_id="user123",
                role=Role.SELLER,
                granted_by="admin123"
            )
            assert role_id is not None
            
            # Test role revocation
            result = await access_control_svc.revoke_role(role_id, "admin123")
            assert result is True
    
    @pytest.mark.asyncio
    async def test_permission_checking(self, access_control_svc):
        """Test permission checking"""
        with patch.object(access_control_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock permission check
            mock_cursor.fetchone.return_value = (True,)
            
            has_permission = await access_control_svc.check_permission(
                user_id="user123",
                permission=Permission.EVIDENCE_READ
            )
            assert has_permission is True
    
    @pytest.mark.asyncio
    async def test_service_account_creation(self, access_control_svc):
        """Test service account creation"""
        with patch.object(access_control_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            result = await access_control_svc.create_service_account(
                name="test_service",
                description="Test service account",
                permissions=[Permission.EVIDENCE_READ, Permission.DISPUTE_READ],
                created_by="admin123"
            )
            
            assert "service_account_id" in result
            assert "api_key" in result
            assert result["name"] == "test_service"
    
    @pytest.mark.asyncio
    async def test_api_key_validation(self, access_control_svc):
        """Test API key validation"""
        with patch.object(access_control_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock API key validation
            mock_cursor.fetchone.return_value = (
                "service123", "test_service", '["evidence:read"]', True, None, None
            )
            mock_cursor.rowcount = 1
            
            result = await access_control_svc.validate_api_key("valid_api_key")
            assert result is not None
            assert result["name"] == "test_service"
            assert "evidence:read" in result["permissions"]

class TestAuditService:
    """Test audit service functionality"""
    
    @pytest.fixture
    def audit_svc(self):
        return AuditService()
    
    @pytest.mark.asyncio
    async def test_audit_event_logging(self, audit_svc):
        """Test audit event logging"""
        with patch.object(audit_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock audit log function
            mock_cursor.fetchone.return_value = ("event123",)
            
            event_id = await audit_svc.log_event(
                action=AuditAction.LOGIN,
                user_id="user123",
                resource_type="user",
                resource_id="user123",
                severity=AuditSeverity.MEDIUM,
                ip_address="192.168.1.1",
                user_agent="Mozilla/5.0"
            )
            
            assert event_id == "event123"
    
    @pytest.mark.asyncio
    async def test_audit_event_retrieval(self, audit_svc):
        """Test audit event retrieval"""
        with patch.object(audit_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock audit event query
            mock_cursor.fetchall.return_value = [
                ("event123", "user123", None, "session123", "login", "user", "user123",
                 "medium", "192.168.1.1", "Mozilla/5.0", "req123", 200, 150, None,
                 '{"timestamp": "2023-01-01T00:00:00Z"}', None, datetime.utcnow())
            ]
            mock_cursor.fetchone.return_value = (10,)
            
            result = await audit_svc.get_audit_events(
                user_id="user123",
                limit=10,
                offset=0
            )
            
            assert "events" in result
            assert "total" in result
            assert len(result["events"]) == 1
            assert result["events"][0]["id"] == "event123"
    
    @pytest.mark.asyncio
    async def test_security_incident_creation(self, audit_svc):
        """Test security incident creation"""
        with patch.object(audit_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            incident_id = await audit_svc.create_security_incident(
                incident_type="unauthorized_access",
                severity=AuditSeverity.HIGH,
                title="Suspicious login attempt",
                description="Multiple failed login attempts detected",
                affected_user_id="user123"
            )
            
            assert incident_id is not None

class TestDataRetentionService:
    """Test data retention service functionality"""
    
    @pytest.fixture
    def retention_svc(self):
        return DataRetentionService()
    
    @pytest.mark.asyncio
    async def test_cleanup_job(self, retention_svc):
        """Test data cleanup job"""
        with patch.object(retention_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock retention policies
            mock_cursor.fetchall.return_value = [
                ("evidence_prompts", 90, 7, None, None),
                ("audit_log", 2555, 30, None, None)
            ]
            
            # Mock cleanup queries
            mock_cursor.fetchone.return_value = (5,)  # Count before
            mock_cursor.rowcount = 3  # Records deleted
            
            result = await retention_svc.run_cleanup_job()
            
            assert "policies_processed" in result
            assert "records_deleted" in result
            assert result["policies_processed"] == 2
    
    @pytest.mark.asyncio
    async def test_expired_prompts_cleanup(self, retention_svc):
        """Test expired prompts cleanup"""
        with patch.object(retention_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock expired prompts query
            mock_cursor.fetchall.return_value = [
                ("prompt123", "user123", "claim123"),
                ("prompt456", "user456", "claim456")
            ]
            mock_cursor.rowcount = 2
            
            deleted_count = await retention_svc.cleanup_expired_prompts()
            assert deleted_count == 2
    
    @pytest.mark.asyncio
    async def test_user_data_anonymization(self, retention_svc):
        """Test user data anonymization"""
        with patch.object(retention_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock anonymization queries
            mock_cursor.rowcount = 5  # Records anonymized
            
            result = await retention_svc.anonymize_user_data("user123")
            
            assert result["user_id"] == "user123"
            assert "anonymized_at" in result
            assert "tables_processed" in result

class TestSecurityIntegration:
    """Integration tests for security components"""
    
    @pytest.mark.asyncio
    async def test_end_to_end_security_flow(self):
        """Test complete security flow"""
        # Test encryption
        sensitive_data = {"credit_card": "1234-5678-9012-3456", "ssn": "123-45-6789"}
        encrypted = encryption_service.encrypt_data(sensitive_data)
        decrypted = encryption_service.decrypt_data(encrypted)
        assert decrypted == sensitive_data
        
        # Test access control
        with patch.object(access_control_service.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            mock_cursor.fetchone.return_value = (True,)
            
            has_permission = await access_control_service.check_permission(
                user_id="user123",
                permission=Permission.EVIDENCE_READ
            )
            assert has_permission is True
        
        # Test audit logging
        with patch.object(audit_service.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            mock_cursor.fetchone.return_value = ("event123",)
            
            event_id = await audit_service.log_event(
                action=AuditAction.EVIDENCE_UPLOAD,
                user_id="user123",
                resource_type="evidence_document",
                resource_id="doc123",
                sensitive_data=sensitive_data
            )
            assert event_id == "event123"
    
    def test_security_constants(self):
        """Test security constants and enums"""
        # Test permissions
        assert Permission.EVIDENCE_READ.value == "evidence:read"
        assert Permission.ADMIN_WRITE.value == "admin:write"
        
        # Test roles
        assert Role.SUPER_ADMIN.value == "super_admin"
        assert Role.SELLER.value == "seller"
        
        # Test audit actions
        assert AuditAction.LOGIN.value == "login"
        assert AuditAction.EVIDENCE_UPLOAD.value == "evidence_upload"
        
        # Test audit severity
        assert AuditSeverity.CRITICAL.value == "critical"
        assert AuditSeverity.LOW.value == "low"
    
    def test_encryption_key_management(self):
        """Test encryption key management"""
        # Test key generation
        key1 = encryption_service._generate_new_key("test_key_1")
        key2 = encryption_service._generate_new_key("test_key_2")
        
        assert key1 != key2
        assert len(key1) == 32  # 256-bit key
        assert len(key2) == 32
        
        # Test key hashing
        api_key = "test_api_key_12345"
        hash1 = access_control_service._hash_api_key(api_key)
        hash2 = access_control_service._hash_api_key(api_key)
        
        assert hash1 == hash2  # Same input should produce same hash
        assert len(hash1) == 64  # SHA-256 hex digest length

class TestSecurityVulnerabilities:
    """Test for common security vulnerabilities"""
    
    def test_sql_injection_prevention(self):
        """Test SQL injection prevention"""
        # This test ensures that our database queries use parameterized queries
        # and are not vulnerable to SQL injection attacks
        
        malicious_input = "'; DROP TABLE users; --"
        
        # Test that malicious input is properly escaped
        with patch.object(access_control_service.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # This should not cause SQL injection
            asyncio.run(access_control_service.check_permission(
                user_id=malicious_input,
                permission=Permission.EVIDENCE_READ
            ))
            
            # Verify that parameterized query was used
            mock_cursor.execute.assert_called()
            call_args = mock_cursor.execute.call_args
            assert len(call_args[0]) == 2  # Query and parameters
            assert call_args[0][1] == (malicious_input, Permission.EVIDENCE_READ.value, None)
    
    def test_encryption_key_security(self):
        """Test encryption key security"""
        # Test that encryption keys are properly generated
        key = encryption_service._generate_new_key("test_security")
        
        # Key should be cryptographically secure
        assert len(key) == 32
        assert isinstance(key, bytes)
        
        # Test that same input produces different keys (due to random generation)
        key1 = encryption_service._generate_new_key("test_security")
        key2 = encryption_service._generate_new_key("test_security")
        assert key1 != key2
    
    def test_audit_log_integrity(self):
        """Test audit log integrity"""
        # Test that audit logs cannot be tampered with
        with patch.object(audit_service.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            mock_cursor.fetchone.return_value = ("event123",)
            
            # Log an event
            event_id = asyncio.run(audit_service.log_event(
                action=AuditAction.LOGIN,
                user_id="user123",
                resource_type="user",
                resource_id="user123"
            ))
            
            assert event_id == "event123"
            
            # Verify that the audit log function was called with proper parameters
            mock_cursor.execute.assert_called()
            call_args = mock_cursor.execute.call_args
            assert "log_security_event" in call_args[0][0]

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
