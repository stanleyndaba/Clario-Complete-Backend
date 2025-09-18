"""
Security middleware for the Claim Detector Model
"""
from fastapi import Request, Response
from fastapi.middleware.base import BaseHTTPMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import time
from typing import Callable
from .rate_limiter import check_rate_limit, get_remaining_requests

class SecurityMiddleware(BaseHTTPMiddleware):
    """Security middleware for additional protection"""
    
    def __init__(self, app, rate_limit_enabled: bool = True):
        super().__init__(app)
        self.rate_limit_enabled = rate_limit_enabled
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request through security middleware"""
        start_time = time.time()
        
        # Get client IP
        client_ip = self._get_client_ip(request)
        
        # Rate limiting
        if self.rate_limit_enabled:
            endpoint = request.url.path.split('/')[-1] or 'default'
            if not check_rate_limit(client_ip, endpoint):
                remaining = get_remaining_requests(client_ip, endpoint)
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "Rate limit exceeded",
                        "remaining_requests": remaining,
                        "retry_after": 60
                    },
                    headers={"Retry-After": "60"}
                )
        
        # Add security headers
        response = await call_next(request)
        
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        
        # Add rate limit headers
        if self.rate_limit_enabled:
            endpoint = request.url.path.split('/')[-1] or 'default'
            remaining = get_remaining_requests(client_ip, endpoint)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Reset"] = str(int(start_time + 60))
        
        # Add processing time header
        processing_time = (time.time() - start_time) * 1000
        response.headers["X-Processing-Time"] = f"{processing_time:.2f}ms"
        
        return response
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request"""
        # Check for forwarded headers (for proxy setups)
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        
        # Check for real IP header
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip
        
        # Fallback to client host
        return request.client.host if request.client else "unknown"

class HTTPSRedirectMiddleware(BaseHTTPMiddleware):
    """Middleware to redirect HTTP to HTTPS"""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Redirect HTTP to HTTPS if needed"""
        if request.url.scheme == "http":
            # Redirect to HTTPS
            https_url = str(request.url).replace("http://", "https://", 1)
            return JSONResponse(
                status_code=301,
                content={"message": "HTTPS required"},
                headers={"Location": https_url}
            )
        
        return await call_next(request)
