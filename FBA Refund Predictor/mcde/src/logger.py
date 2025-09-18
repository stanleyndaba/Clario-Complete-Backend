"""
Structured logging for MCDE.
Provides comprehensive logging with audit trails and performance monitoring.
"""
import sys
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
from loguru import logger
import structlog
from src.config import settings


def setup_logging(
    log_level: str = "INFO",
    log_file: Optional[str] = None,
    enable_audit: bool = True
) -> None:
    """
    Setup structured logging for MCDE.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR)
        log_file: Path to log file (optional)
        enable_audit: Enable audit trail logging
    """
    # Remove default logger
    logger.remove()
    
    # Console logging
    logger.add(
        sys.stdout,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
               "<level>{level: <8}</level> | "
               "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
               "<level>{message}</level>",
        level=log_level,
        colorize=True
    )
    
    # File logging
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        
        logger.add(
            log_file,
            format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} | {message}",
            level=log_level,
            rotation="100 MB",
            retention="30 days",
            compression="zip"
        )
    
    # Audit trail logging
    if enable_audit:
        audit_file = Path("logs/audit.log")
        audit_file.parent.mkdir(parents=True, exist_ok=True)
        
        logger.add(
            str(audit_file),
            format="{time:YYYY-MM-DD HH:mm:ss} | AUDIT | {extra[user_id]} | {extra[action]} | {message}",
            level="INFO",
            filter=lambda record: record["extra"].get("audit", False),
            rotation="50 MB",
            retention="90 days"
        )
    
    # Error logging
    error_file = Path("logs/errors.log")
    error_file.parent.mkdir(parents=True, exist_ok=True)
    
    logger.add(
        str(error_file),
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} | {message}",
        level="ERROR",
        rotation="50 MB",
        retention="30 days"
    )
    
    logger.info(f"MCDE logging initialized - Level: {log_level}")


def get_logger(name: str) -> "logger":
    """
    Get logger instance for a specific module.
    
    Args:
        name: Module name
        
    Returns:
        Logger instance
    """
    return logger.bind(name=name)


def log_audit_event(
    user_id: str,
    action: str,
    details: Dict[str, Any],
    success: bool = True
) -> None:
    """
    Log audit event for compliance and security.
    
    Args:
        user_id: User performing the action
        action: Action being performed
        details: Additional details about the action
        success: Whether the action was successful
    """
    logger.bind(
        audit=True,
        user_id=user_id,
        action=action,
        success=success
    ).info(f"Audit event: {action}", extra={"details": details})


def log_document_processing(
    document_id: str,
    processing_type: str,
    duration: float,
    success: bool,
    error_message: Optional[str] = None
) -> None:
    """
    Log document processing events for monitoring.
    
    Args:
        document_id: Unique document identifier
        processing_type: Type of processing (OCR, validation, etc.)
        duration: Processing duration in seconds
        success: Whether processing was successful
        error_message: Error message if processing failed
    """
    log_data = {
        "document_id": document_id,
        "processing_type": processing_type,
        "duration": duration,
        "success": success,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    if error_message:
        log_data["error"] = error_message
    
    logger.info(f"Document processing: {processing_type}", extra=log_data)


def log_cost_estimation(
    claim_id: str,
    estimated_cost: float,
    confidence: float,
    model_version: str
) -> None:
    """
    Log cost estimation events.
    
    Args:
        claim_id: Refund claim identifier
        estimated_cost: Estimated manufacturing cost
        confidence: Model confidence score
        model_version: ML model version used
    """
    logger.info(
        f"Cost estimation for claim {claim_id}",
        extra={
            "claim_id": claim_id,
            "estimated_cost": estimated_cost,
            "confidence": confidence,
            "model_version": model_version,
            "timestamp": datetime.utcnow().isoformat()
        }
    )


def log_api_request(
    endpoint: str,
    method: str,
    user_id: Optional[str] = None,
    duration: Optional[float] = None,
    status_code: Optional[int] = None
) -> None:
    """
    Log API request for monitoring and analytics.
    
    Args:
        endpoint: API endpoint
        method: HTTP method
        user_id: User making the request
        duration: Request duration in seconds
        status_code: HTTP status code
    """
    log_data = {
        "endpoint": endpoint,
        "method": method,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    if user_id:
        log_data["user_id"] = user_id
    if duration:
        log_data["duration"] = duration
    if status_code:
        log_data["status_code"] = status_code
    
    logger.info(f"API request: {method} {endpoint}", extra=log_data)


def log_integration_event(
    service: str,
    event_type: str,
    success: bool,
    details: Dict[str, Any]
) -> None:
    """
    Log integration events with external services.
    
    Args:
        service: External service name (Refund Engine, Amazon API, etc.)
        event_type: Type of event (request, response, error)
        success: Whether the integration was successful
        details: Additional details about the event
    """
    logger.info(
        f"Integration event: {service} - {event_type}",
        extra={
            "service": service,
            "event_type": event_type,
            "success": success,
            "details": details,
            "timestamp": datetime.utcnow().isoformat()
        }
    )


# Initialize logging on module import
setup_logging(
    log_level=settings.environment.upper() if settings.debug else "INFO",
    log_file="logs/mcde.log",
    enable_audit=True
) 