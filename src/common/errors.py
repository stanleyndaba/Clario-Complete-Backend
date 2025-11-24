"""
Comprehensive Error Types for Clario Python Backend
Provides typed errors for all common failure scenarios
"""

from enum import Enum
from typing import Optional, Dict, Any
from datetime import datetime
import logging
import traceback
import os

logger = logging.getLogger(__name__)

# Optional Sentry integration
try:
    import sentry_sdk
    SENTRY_AVAILABLE = True
except ImportError:
    SENTRY_AVAILABLE = False
    sentry_sdk = None


class ErrorCode(str, Enum):
    """Error codes for categorizing errors"""
    
    # Authentication errors (1xxx)
    AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED"
    AUTH_TOKEN_INVALID = "AUTH_TOKEN_INVALID"
    AUTH_UNAUTHORIZED = "AUTH_UNAUTHORIZED"
    AUTH_FORBIDDEN = "AUTH_FORBIDDEN"
    
    # Amazon SP-API errors (2xxx)
    SPAPI_RATE_LIMITED = "SPAPI_RATE_LIMITED"
    SPAPI_TOKEN_EXPIRED = "SPAPI_TOKEN_EXPIRED"
    SPAPI_INVALID_CREDENTIALS = "SPAPI_INVALID_CREDENTIALS"
    SPAPI_REQUEST_FAILED = "SPAPI_REQUEST_FAILED"
    
    # Database errors (3xxx)
    DB_CONNECTION_FAILED = "DB_CONNECTION_FAILED"
    DB_QUERY_FAILED = "DB_QUERY_FAILED"
    DB_RECORD_NOT_FOUND = "DB_RECORD_NOT_FOUND"
    DB_DUPLICATE_ENTRY = "DB_DUPLICATE_ENTRY"
    
    # Network errors (4xxx)
    NETWORK_TIMEOUT = "NETWORK_TIMEOUT"
    NETWORK_CONNECTION_REFUSED = "NETWORK_CONNECTION_REFUSED"
    
    # Validation errors (5xxx)
    VALIDATION_FAILED = "VALIDATION_FAILED"
    VALIDATION_MISSING_FIELD = "VALIDATION_MISSING_FIELD"
    
    # Business logic errors (6xxx)
    CLAIM_NOT_FOUND = "CLAIM_NOT_FOUND"
    CLAIM_ALREADY_FILED = "CLAIM_ALREADY_FILED"
    EVIDENCE_NOT_FOUND = "EVIDENCE_NOT_FOUND"
    
    # Generic errors (9xxx)
    INTERNAL_ERROR = "INTERNAL_ERROR"
    NOT_FOUND = "NOT_FOUND"
    BAD_REQUEST = "BAD_REQUEST"


class AppError(Exception):
    """Base application error with structured error information"""
    
    def __init__(
        self,
        code: ErrorCode,
        message: str,
        status_code: int = 500,
        retryable: bool = False,
        retry_after_ms: Optional[int] = None,
        context: Optional[Dict[str, Any]] = None
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        self.retry_after_ms = retry_after_ms
        self.context = context or {}
        self.timestamp = datetime.utcnow()
        self.error_id = f"err_{int(self.timestamp.timestamp())}_{id(self) % 10000:04d}"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert error to dictionary for JSON response"""
        response = {
            "error": True,
            "error_id": self.error_id,
            "code": self.code.value,
            "message": self.message,
            "status_code": self.status_code,
            "timestamp": self.timestamp.isoformat(),
        }
        
        if self.retryable:
            response["retryable"] = True
            if self.retry_after_ms:
                response["retry_after_ms"] = self.retry_after_ms
        
        # Include context in non-production environments
        if os.getenv("ENV") != "production" and self.context:
            response["context"] = self.context
        
        return response


class AuthError(AppError):
    """Authentication/Authorization errors"""
    
    @classmethod
    def token_expired(cls, context: Optional[Dict] = None) -> "AuthError":
        return cls(
            code=ErrorCode.AUTH_TOKEN_EXPIRED,
            message="Authentication token has expired. Please re-authenticate.",
            status_code=401,
            retryable=True,
            context=context
        )
    
    @classmethod
    def unauthorized(cls, message: str = "Authentication required") -> "AuthError":
        return cls(
            code=ErrorCode.AUTH_UNAUTHORIZED,
            message=message,
            status_code=401
        )
    
    @classmethod
    def forbidden(cls, message: str = "Access denied") -> "AuthError":
        return cls(
            code=ErrorCode.AUTH_FORBIDDEN,
            message=message,
            status_code=403
        )


class SPAPIError(AppError):
    """Amazon SP-API specific errors"""
    
    @classmethod
    def rate_limited(cls, retry_after_ms: int = 60000, context: Optional[Dict] = None) -> "SPAPIError":
        return cls(
            code=ErrorCode.SPAPI_RATE_LIMITED,
            message=f"Amazon SP-API rate limit exceeded. Retry after {retry_after_ms // 1000} seconds.",
            status_code=429,
            retryable=True,
            retry_after_ms=retry_after_ms,
            context=context
        )
    
    @classmethod
    def token_expired(cls, context: Optional[Dict] = None) -> "SPAPIError":
        return cls(
            code=ErrorCode.SPAPI_TOKEN_EXPIRED,
            message="Amazon SP-API access token has expired.",
            status_code=401,
            retryable=True,
            retry_after_ms=5000,
            context=context
        )
    
    @classmethod
    def request_failed(cls, original_error: str, context: Optional[Dict] = None) -> "SPAPIError":
        return cls(
            code=ErrorCode.SPAPI_REQUEST_FAILED,
            message=f"Amazon SP-API request failed: {original_error}",
            status_code=502,
            retryable=True,
            retry_after_ms=10000,
            context=context
        )


class DatabaseError(AppError):
    """Database-related errors"""
    
    @classmethod
    def connection_failed(cls, original_error: str, context: Optional[Dict] = None) -> "DatabaseError":
        return cls(
            code=ErrorCode.DB_CONNECTION_FAILED,
            message=f"Database connection failed: {original_error}",
            status_code=503,
            retryable=True,
            retry_after_ms=5000,
            context=context
        )
    
    @classmethod
    def not_found(cls, entity: str, entity_id: str) -> "DatabaseError":
        return cls(
            code=ErrorCode.DB_RECORD_NOT_FOUND,
            message=f"{entity} with ID {entity_id} not found",
            status_code=404,
            context={"entity": entity, "id": entity_id}
        )


class ValidationError(AppError):
    """Input validation errors"""
    
    def __init__(self, message: str, fields: Optional[Dict[str, str]] = None):
        super().__init__(
            code=ErrorCode.VALIDATION_FAILED,
            message=message,
            status_code=400,
            context={"fields": fields or {}}
        )
        self.fields = fields or {}
    
    @classmethod
    def missing_field(cls, field: str) -> "ValidationError":
        return cls(
            message=f"Missing required field: {field}",
            fields={field: "This field is required"}
        )


class BusinessError(AppError):
    """Business logic errors"""
    
    @classmethod
    def claim_not_found(cls, claim_id: str) -> "BusinessError":
        return cls(
            code=ErrorCode.CLAIM_NOT_FOUND,
            message=f"Claim {claim_id} not found",
            status_code=404,
            context={"claim_id": claim_id}
        )
    
    @classmethod
    def claim_already_filed(cls, claim_id: str) -> "BusinessError":
        return cls(
            code=ErrorCode.CLAIM_ALREADY_FILED,
            message=f"Claim {claim_id} has already been filed",
            status_code=422,
            context={"claim_id": claim_id}
        )


def initialize_sentry():
    """Initialize Sentry error tracking if configured"""
    sentry_dsn = os.getenv("SENTRY_DSN")
    
    if sentry_dsn and SENTRY_AVAILABLE:
        sentry_sdk.init(
            dsn=sentry_dsn,
            environment=os.getenv("ENV", "development"),
            traces_sample_rate=0.1 if os.getenv("ENV") == "production" else 1.0,
            # Don't send 4xx errors
            before_send=lambda event, hint: None if _is_client_error(hint) else event,
        )
        logger.info("Sentry initialized successfully")
    else:
        logger.info("Sentry not configured or not available")


def _is_client_error(hint: Dict) -> bool:
    """Check if error is a client error (4xx)"""
    exc_info = hint.get("exc_info")
    if exc_info:
        exc = exc_info[1]
        if isinstance(exc, AppError) and 400 <= exc.status_code < 500:
            return True
    return False


def capture_exception(error: Exception, context: Optional[Dict] = None):
    """Capture exception with Sentry"""
    # Log locally
    logger.error(f"Exception captured: {error}", exc_info=True)
    
    if SENTRY_AVAILABLE and sentry_sdk:
        if context:
            sentry_sdk.set_context("additional", context)
        sentry_sdk.capture_exception(error)


def log_error(
    error: Exception,
    request_path: Optional[str] = None,
    user_id: Optional[str] = None
):
    """Log error with structured context"""
    error_data = {
        "error_type": type(error).__name__,
        "message": str(error),
        "request_path": request_path,
        "user_id": user_id,
    }
    
    if isinstance(error, AppError):
        error_data.update({
            "error_id": error.error_id,
            "error_code": error.code.value,
            "status_code": error.status_code,
            "retryable": error.retryable,
        })
    
    # Add stack trace for server errors
    if not isinstance(error, AppError) or error.status_code >= 500:
        error_data["stack_trace"] = traceback.format_exc()
        logger.error("Server error occurred", extra=error_data)
        capture_exception(error, error_data)
    else:
        logger.warning("Client error occurred", extra=error_data)

