"""
Sentry Instrumentation for Python API (FastAPI)

This file must be imported at the very top of your application entry point
to ensure Sentry captures all errors and traces from the start.

Import this file BEFORE FastAPI app initialization in app.py:
    from .instrument import *  # or import instrument
"""

import os
import logging

logger = logging.getLogger(__name__)

# Try to import and initialize Sentry
try:
    import sentry_sdk
    # FastAPI integration is automatically enabled when fastapi package is installed
    # No need to explicitly import FastApiIntegration
    
    SENTRY_AVAILABLE = True
    
    # Get DSN from environment
    sentry_dsn = os.getenv("SENTRY_DSN")
    
    if sentry_dsn:
        # Initialize Sentry with FastAPI integration (auto-detected)
        sentry_sdk.init(
            dsn=sentry_dsn,
            environment=os.getenv("ENV", os.getenv("NODE_ENV", "development")),
            release=os.getenv("APP_VERSION", "1.0.0"),
            
            # Add data like request headers and IP for users
            # See https://docs.sentry.io/platforms/python/data-management/data-collected/
            send_default_pii=True,
            
            # Enable sending logs to Sentry
            enable_logs=True,
            
            # Set traces_sample_rate to 1.0 to capture 100% of transactions for tracing
            # In production, you may want to reduce this to 0.1 (10%) to reduce volume
            traces_sample_rate=1.0 if os.getenv("ENV") != "production" else 0.1,
            
            # Set profile_session_sample_rate to 1.0 to profile 100% of sessions
            # In production, reduce this to 0.1 or lower
            profile_session_sample_rate=1.0 if os.getenv("ENV") != "production" else 0.1,
            
            # Set profile_lifecycle to "trace" to automatically run profiler
            # when there is an active transaction
            profile_lifecycle="trace",
            
            # Filter out noisy errors
            before_send=lambda event, hint: _filter_sentry_event(event, hint),
        )
        
        logger.info("[Sentry] Initialized successfully for Python API (FastAPI)")
    else:
        logger.info("[Sentry] DSN not configured - error tracking disabled")
        SENTRY_AVAILABLE = False
        
except ImportError:
    logger.warning("[Sentry] sentry-sdk not installed - error tracking disabled")
    SENTRY_AVAILABLE = False
    sentry_sdk = None


def _filter_sentry_event(event, hint):
    """Filter out noisy errors before sending to Sentry"""
    if not event:
        return None
    
    # Don't send 4xx client errors
    exc_info = hint.get("exc_info")
    if exc_info:
        exc = exc_info[1]
        # Check if it's an HTTPException with 4xx status
        if hasattr(exc, "status_code") and 400 <= exc.status_code < 500:
            return None
        
        # Check if it's a validation error (these are usually client errors)
        if "validation" in str(type(exc)).lower():
            return None
    
    # Don't send rate limit errors
    if "rate limit" in str(event.get("message", "")).lower():
        return None
    
    return event

