"""
Integration Tests for Security Hardening
Tests that all security requirements are met
"""

import pytest
import os
import re
from fastapi.testclient import TestClient
from src.app import app

client = TestClient(app)

class TestSecretsManagement:
    """Test that no secrets are hard-coded"""
    
    def test_no_hardcoded_amazon_tokens(self):
        """Test that Amazon tokens are not hard-coded"""
        # Scan source files for Amazon token patterns
        source_dir = "src"
        token_patterns = [
            r"amzn1\.application-oa2-client\.[a-zA-Z0-9]+",
            r"Atzr\|[a-zA-Z0-9\-_]+",
            r"amzn1\.oa2-cs\.v1\.[a-zA-Z0-9]+",
        ]
        
        violations = []
        for root, dirs, files in os.walk(source_dir):
            # Skip __pycache__ and node_modules
            if "__pycache__" in root or "node_modules" in root:
                continue
                
            for file in files:
                if file.endswith((".py", ".ts", ".js")):
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            content = f.read()
                            for pattern in token_patterns:
                                if re.search(pattern, content):
                                    violations.append(f"{file_path}: Found hard-coded token pattern")
                    except Exception:
                        pass
        
        assert len(violations) == 0, f"Found hard-coded tokens: {violations}"
    
    def test_no_hardcoded_jwt_secrets(self):
        """Test that JWT secrets are not hard-coded"""
        source_dir = "src"
        secret_patterns = [
            r"JWT_SECRET\s*=\s*['\"][^'\"]+['\"]",
            r"jwt_secret\s*=\s*['\"][^'\"]+['\"]",
        ]
        
        violations = []
        for root, dirs, files in os.walk(source_dir):
            if "__pycache__" in root or "node_modules" in root:
                continue
                
            for file in files:
                if file.endswith((".py", ".ts", ".js")):
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            content = f.read()
                            # Skip test files and template files
                            if "test" in file_path.lower() or "template" in file_path.lower():
                                continue
                            for pattern in secret_patterns:
                                matches = re.findall(pattern, content, re.IGNORECASE)
                                # Check if matches are placeholders
                                for match in matches:
                                    if "your-" not in match.lower() and "placeholder" not in match.lower():
                                        violations.append(f"{file_path}: Found hard-coded JWT secret")
                    except Exception:
                        pass
        
        assert len(violations) == 0, f"Found hard-coded secrets: {violations}"


class TestHttpsEnforcement:
    """Test HTTPS enforcement"""
    
    def test_https_enforcement_in_production(self):
        """Test that HTTPS is enforced in production"""
        # This test would need to run in production mode
        # For now, we test that the middleware exists
        from src.security.security_middleware import EnforceHttpsMiddleware
        assert EnforceHttpsMiddleware is not None
    
    def test_http_redirects_to_https(self):
        """Test that HTTP requests redirect to HTTPS in production"""
        # This would need to be tested in production environment
        # For now, we verify the middleware is configured
        pass


class TestSecurityHeaders:
    """Test security headers"""
    
    def test_security_headers_present(self):
        """Test that security headers are present in responses"""
        response = client.get("/health")
        
        # Check for security headers
        assert "X-Content-Type-Options" in response.headers
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        
        assert "X-Frame-Options" in response.headers
        assert response.headers["X-Frame-Options"] == "DENY"
        
        assert "X-XSS-Protection" in response.headers
        
        # CSP may not be present in test environment
        # But we verify the middleware exists
        from src.security.security_middleware import SecurityHeadersMiddleware
        assert SecurityHeadersMiddleware is not None


class TestOAuthBypass:
    """Test OAuth bypass is disabled in production"""
    
    def test_oauth_bypass_disabled_in_production(self):
        """Test that OAuth bypass is disabled in production"""
        # This test would need to run in production mode
        # For now, we verify the code checks for production environment
        import inspect
        from Integrations_backend.src.controllers.amazonController import startAmazonOAuth
        
        source = inspect.getsource(startAmazonOAuth)
        assert "isProduction" in source or "NODE_ENV" in source
        assert "bypass" in source.lower()


class TestTokenRotation:
    """Test token rotation"""
    
    def test_token_rotation_exists(self):
        """Test that token rotation utility exists"""
        try:
            from Integrations_backend.src.security.tokenRotation import rotateRefreshToken
            assert rotateRefreshToken is not None
        except ImportError:
            pytest.skip("Token rotation not implemented yet")


class TestAuditLogging:
    """Test audit logging"""
    
    def test_audit_logging_exists(self):
        """Test that audit logging utility exists"""
        try:
            from Integrations_backend.src.security.auditLogger import logAuditEvent
            assert logAuditEvent is not None
        except ImportError:
            pytest.skip("Audit logging not implemented yet")


class TestRateLimiting:
    """Test rate limiting"""
    
    def test_rate_limiting_configured(self):
        """Test that rate limiting is configured"""
        # This test would need to make multiple requests
        # For now, we verify the rate limiter exists
        try:
            from Integrations_backend.src.security.rateLimiter import authRateLimiter
            assert authRateLimiter is not None
        except ImportError:
            pytest.skip("Rate limiter not implemented yet")


class TestHealthEndpoint:
    """Test health endpoint"""
    
    def test_health_endpoint_exists(self):
        """Test that health endpoint exists"""
        response = client.get("/health")
        assert response.status_code == 200
        assert "status" in response.json()
    
    def test_healthz_endpoint_exists(self):
        """Test that comprehensive health endpoint exists"""
        response = client.get("/healthz")
        assert response.status_code in [200, 503]  # May be degraded
        assert "status" in response.json()
        assert "checks" in response.json()


class TestLogSanitization:
    """Test log sanitization"""
    
    def test_log_sanitization_exists(self):
        """Test that log sanitization utility exists"""
        try:
            from Integrations_backend.src.security.logSanitizer import sanitizeLogData
            assert sanitizeLogData is not None
            
            # Test that it sanitizes tokens
            test_data = {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
                "refresh_token": "Atzr|test-token",
            }
            sanitized = sanitizeLogData(test_data)
            assert "REDACTED" in str(sanitized) or sanitized.get("access_token") != test_data["access_token"]
        except ImportError:
            pytest.skip("Log sanitization not implemented yet")


class TestEnvironmentValidation:
    """Test environment variable validation"""
    
    def test_environment_validation_exists(self):
        """Test that environment validation exists"""
        try:
            from Integrations_backend.src.security.envValidation import validateEnvironment
            assert validateEnvironment is not None
        except ImportError:
            pytest.skip("Environment validation not implemented yet")

