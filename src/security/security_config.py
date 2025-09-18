"""
Security Configuration
Phase 6: Security settings and configuration management
"""

import os
from typing import Dict, Any, List
from enum import Enum

class SecurityLevel(str, Enum):
    """Security level configurations"""
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"

class SecurityConfig:
    """Security configuration management"""
    
    def __init__(self, environment: str = "production"):
        self.environment = SecurityLevel(environment)
        self.config = self._load_config()
    
    def _load_config(self) -> Dict[str, Any]:
        """Load security configuration based on environment"""
        base_config = {
            "encryption": {
                "algorithm": "AES-256-GCM",
                "key_rotation_days": 90,
                "master_key_env_var": "ENCRYPTION_MASTER_KEY",
                "key_storage_table": "encryption_keys"
            },
            "access_control": {
                "default_role": "seller",
                "session_timeout_minutes": 480,  # 8 hours
                "api_key_length": 32,
                "max_failed_attempts": 5,
                "lockout_duration_minutes": 30
            },
            "audit": {
                "log_retention_days": 2555,  # 7 years
                "security_incident_retention_days": 2555,
                "audit_log_encryption": True,
                "sensitive_data_encryption": True
            },
            "data_retention": {
                "evidence_prompts_days": 90,
                "proof_packets_days": 2555,  # 7 years
                "audit_logs_days": 2555,  # 7 years
                "parser_jobs_days": 30,
                "cleanup_frequency_days": 7
            },
            "tls": {
                "enforce_https": True,
                "min_tls_version": "1.2",
                "cipher_suites": [
                    "TLS_AES_256_GCM_SHA384",
                    "TLS_CHACHA20_POLY1305_SHA256",
                    "TLS_AES_128_GCM_SHA256"
                ]
            },
            "rate_limiting": {
                "api_requests_per_minute": 100,
                "login_attempts_per_minute": 5,
                "audit_requests_per_minute": 50
            }
        }
        
        # Environment-specific overrides
        if self.environment == SecurityLevel.DEVELOPMENT:
            base_config["encryption"]["key_rotation_days"] = 365  # 1 year for dev
            base_config["access_control"]["session_timeout_minutes"] = 1440  # 24 hours
            base_config["audit"]["log_retention_days"] = 30
            base_config["tls"]["enforce_https"] = False
            
        elif self.environment == SecurityLevel.STAGING:
            base_config["encryption"]["key_rotation_days"] = 180  # 6 months
            base_config["access_control"]["session_timeout_minutes"] = 720  # 12 hours
            base_config["audit"]["log_retention_days"] = 365  # 1 year
            
        # Production settings are already in base_config
        
        return base_config
    
    def get_encryption_config(self) -> Dict[str, Any]:
        """Get encryption configuration"""
        return self.config["encryption"]
    
    def get_access_control_config(self) -> Dict[str, Any]:
        """Get access control configuration"""
        return self.config["access_control"]
    
    def get_audit_config(self) -> Dict[str, Any]:
        """Get audit configuration"""
        return self.config["audit"]
    
    def get_data_retention_config(self) -> Dict[str, Any]:
        """Get data retention configuration"""
        return self.config["data_retention"]
    
    def get_tls_config(self) -> Dict[str, Any]:
        """Get TLS configuration"""
        return self.config["tls"]
    
    def get_rate_limiting_config(self) -> Dict[str, Any]:
        """Get rate limiting configuration"""
        return self.config["rate_limiting"]
    
    def get_security_policies(self) -> List[Dict[str, Any]]:
        """Get security policies for the environment"""
        policies = [
            {
                "name": "password_policy",
                "min_length": 12,
                "require_uppercase": True,
                "require_lowercase": True,
                "require_numbers": True,
                "require_special_chars": True,
                "max_age_days": 90
            },
            {
                "name": "session_policy",
                "timeout_minutes": self.config["access_control"]["session_timeout_minutes"],
                "require_https": self.config["tls"]["enforce_https"],
                "secure_cookies": True,
                "http_only_cookies": True
            },
            {
                "name": "api_key_policy",
                "min_length": self.config["access_control"]["api_key_length"],
                "require_rotation_days": 365,
                "max_usage_per_day": 10000
            },
            {
                "name": "audit_policy",
                "log_all_actions": True,
                "encrypt_sensitive_data": self.config["audit"]["sensitive_data_encryption"],
                "retention_days": self.config["audit"]["log_retention_days"]
            }
        ]
        
        return policies
    
    def get_compliance_requirements(self) -> Dict[str, Any]:
        """Get compliance requirements for the environment"""
        requirements = {
            "gdpr": {
                "data_anonymization": True,
                "right_to_erasure": True,
                "data_portability": True,
                "consent_management": True,
                "data_minimization": True
            },
            "ccpa": {
                "data_transparency": True,
                "user_rights": True,
                "opt_out_capability": True,
                "data_security": True
            },
            "soc2": {
                "security_controls": True,
                "audit_logging": True,
                "access_controls": True,
                "data_protection": True
            },
            "iso27001": {
                "information_security": True,
                "risk_management": True,
                "security_monitoring": True,
                "incident_response": True
            }
        }
        
        return requirements
    
    def validate_environment(self) -> Dict[str, Any]:
        """Validate security environment configuration"""
        validation_results = {
            "valid": True,
            "warnings": [],
            "errors": [],
            "recommendations": []
        }
        
        # Check required environment variables
        required_vars = [
            "ENCRYPTION_MASTER_KEY",
            "DATABASE_URL",
            "REDIS_URL"
        ]
        
        for var in required_vars:
            if not os.getenv(var):
                validation_results["errors"].append(f"Missing required environment variable: {var}")
                validation_results["valid"] = False
        
        # Check TLS configuration for production
        if self.environment == SecurityLevel.PRODUCTION:
            if not self.config["tls"]["enforce_https"]:
                validation_results["warnings"].append("HTTPS not enforced in production")
                validation_results["recommendations"].append("Enable HTTPS enforcement for production")
        
        # Check encryption key rotation
        if self.config["encryption"]["key_rotation_days"] > 365:
            validation_results["warnings"].append("Key rotation period exceeds 1 year")
            validation_results["recommendations"].append("Consider more frequent key rotation")
        
        # Check audit log retention
        if self.config["audit"]["log_retention_days"] < 2555:  # 7 years
            validation_results["warnings"].append("Audit log retention less than 7 years")
            validation_results["recommendations"].append("Consider 7-year retention for compliance")
        
        return validation_results

# Global security configuration
security_config = SecurityConfig(os.getenv("ENVIRONMENT", "production"))
