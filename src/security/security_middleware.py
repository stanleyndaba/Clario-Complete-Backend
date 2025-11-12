"""
Security Middleware for FastAPI
Enforces HTTPS, security headers, and TLS validation
"""

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import RedirectResponse
import os
import logging

logger = logging.getLogger(__name__)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Middleware to add security headers to all responses"""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "no-referrer-when-downgrade"
        
        # HSTS (only in production and for HTTPS)
        if os.getenv("ENV") == "production" and request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        
        # CSP
        csp_directives = (
            "default-src 'self' https:; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; "
            "style-src 'self' 'unsafe-inline' https:; "
            "img-src 'self' data: https:; "
            "font-src 'self' data: https:; "
            "connect-src 'self' https:; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "upgrade-insecure-requests"
        )
        response.headers["Content-Security-Policy"] = csp_directives
        
        # Permissions-Policy
        permissions_policy = (
            "geolocation=(), "
            "microphone=(), "
            "camera=(), "
            "payment=(), "
            "usb=(), "
            "magnetometer=(), "
            "gyroscope=(), "
            "speaker=()"
        )
        response.headers["Permissions-Policy"] = permissions_policy
        
        # Remove X-Powered-By header
        if "X-Powered-By" in response.headers:
            del response.headers["X-Powered-By"]
        
        return response


class EnforceHttpsMiddleware(BaseHTTPMiddleware):
    """Middleware to enforce HTTPS in production"""
    
    async def dispatch(self, request: Request, call_next):
        # Only enforce in production
        if os.getenv("ENV") == "production":
            # Check if request is secure
            is_secure = (
                request.url.scheme == "https" or
                request.headers.get("x-forwarded-proto") == "https" or
                request.headers.get("x-forwarded-ssl") == "on"
            )
            
            # Allow localhost for development
            is_localhost = (
                request.url.hostname == "localhost" or
                request.url.hostname == "127.0.0.1"
            )
            
            if not is_secure and not is_localhost:
                logger.warn(f"HTTPS enforcement: Redirecting HTTP to HTTPS - {request.url}")
                https_url = str(request.url).replace("http://", "https://", 1)
                return RedirectResponse(url=https_url, status_code=301)
        
        response = await call_next(request)
        return response


class ValidateTlsMiddleware(BaseHTTPMiddleware):
    """Middleware to validate TLS version (requires TLS 1.2+)"""
    
    async def dispatch(self, request: Request, call_next):
        # This is typically handled at the reverse proxy/load balancer level
        # But we can check if TLS version is available in headers
        tls_version = request.headers.get("x-tls-version")
        
        if tls_version and tls_version < "1.2":
            logger.warn(f"TLS version too low: {tls_version} - {request.url}")
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=426,
                content={
                    "error": "Upgrade Required",
                    "message": "TLS 1.2 or higher is required"
                }
            )
        
        response = await call_next(request)
        return response

