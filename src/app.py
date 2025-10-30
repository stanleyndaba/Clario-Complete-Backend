# Compatibility patch for Python 3.13
try:
    from .compatibility_patch import *  # type: ignore
except Exception:
    # Fallback for execution contexts where package-relative import fails
    import sys
    import os
    try:
        src_dir = os.path.dirname(__file__)  # e.g., /app/src
        if src_dir not in sys.path:
            sys.path.append(src_dir)
        # Retry absolute-style import from the src directory
        from compatibility_patch import *  # type: ignore
    except Exception as _compat_err:  # Final fallback: don't crash on missing patch
        print(f"[startup-warning] compatibility_patch not applied: {_compat_err}")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi import Request
from contextlib import asynccontextmanager
import asyncio
import logging
import os

# Temporarily comment out all imports to debug routing
# from .cdd.router import router as detect_router
# from .acg.router import router as filing_router
# from .ml_detector.router import router as ml_router
from .api.auth_sandbox import router as auth_router
# from .api.integrations import router as integrations_router
# from .api.detections import router as detections_router
# from .api.recoveries import router as recoveries_router
# from .api.evidence import router as evidence_router
# from .api.evidence_sources import router as evidence_sources_router
# from .api.parser import router as parser_router
# from .api.evidence_matching import router as evidence_matching_router
# from .api.zero_effort_evidence import router as zero_effort_evidence_router
# from .api.metrics import router as metrics_router
# from .api.sync import router as sync_router
# from .api.websocket import router as websocket_router
# from .api.evidence_prompts_proof_packets import router as evidence_prompts_router
# from .api.websocket_endpoints import router as websocket_endpoints_router
# from .api.dispute_submissions import router as dispute_submissions_router
# from .api.security import router as security_router
# from .api.analytics import router as analytics_router
# from .api.feature_flags import router as feature_flags_router
# from .analytics.analytics_integration import analytics_integration
# from .features.feature_integration import feature_integration
from .services.service_directory import service_directory

logger = logging.getLogger(__name__)

# Simplified lifespan for debugging
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    logger.info("Starting Opside FBA Claims Pipeline Orchestrator...")
    
    # Start service health monitoring
    health_task = asyncio.create_task(service_directory.start_health_monitoring())
    
    # Initial health check
    await service_directory.check_all_services()
    
    logger.info("Orchestrator started successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down orchestrator...")
    health_task.cancel()
    await service_directory.close()
    logger.info("Orchestrator shutdown complete")

app = FastAPI(
    title="Opside Integrations API",
    description="Production-ready orchestrator for Claim Detection, Evidence Validation, and Auto-Claims Generation",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# Enable CORS for frontend integration (env-driven, supports multiple origins)
from .common.config import settings

# Build explicit origin list, never use '*'
origins_raw = (
    settings.CORS_ALLOW_ORIGINS
    or settings.FRONTEND_URLS
    or settings.ALLOWED_ORIGINS
    or settings.FRONTEND_URL
)

computed_origins = []
if origins_raw:
    computed_origins = [o.strip() for o in origins_raw.split(",") if o.strip() and o.strip() != "*"]

# Safe defaults include the known frontend domain and local dev ports
default_origins = [
    settings.FRONTEND_URL or "",
    "https://opside-complete-frontend.onrender.com",
    "http://localhost:3000",
    "http://localhost:5173",
]

# Merge, dedupe, and drop empties
allow_origins = []
seen = set()
for o in (computed_origins or default_origins):
    if o and o not in seen:
        seen.add(o)
        allow_origins.append(o)

# Apply strict CORS like minimal app
# Add Vercel frontend domain explicitly
vercel_origins = [
    "https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app",
    "https://opside-complete-frontend.onrender.com",
    "https://clario-complete-backend-y5cd.onrender.com",
    # Support any vercel preview deployments
    "https://*.vercel.app",
    "https://opside-complete-frontend-kqvxrzg4s*.vercel.app",
]
frontend = os.getenv("FRONTEND_URL") or settings.FRONTEND_URL or "https://opside-complete-frontend.onrender.com"
# Filter out wildcard patterns from the explicit origins list
explicit_origins = [o for o in vercel_origins if "*" not in o]
all_allowed_origins = list(set(allow_origins + explicit_origins + [frontend]))

# Debug logging
logger.info(f"CORS Configuration - allow_origins computed: {allow_origins}")
logger.info(f"CORS Configuration - explicit_origins: {explicit_origins}")
logger.info(f"CORS Configuration - Final all_allowed_origins: {all_allowed_origins}")

# Secure CORS - no wildcards with credentials
app.add_middleware(
    CORSMiddleware,
    allow_origins=all_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

# Define main endpoints before including routers
@app.get("/")
def root():
    """Root endpoint with service information"""
    return {
        "message": "Opside Integrations API",
        "version": "1.0.0"
    }

@app.get("/integrations")
def integrations():
    """Simple integrations endpoint"""
    return {
        "status": "ok",
        "integrations": [
            {"name": "amazon", "status": "available"},
            {"name": "gmail", "status": "available"},
            {"name": "stripe", "status": "available"}
        ]
    }

@app.get("/health")
async def health():
    """Health check endpoint with service status"""
    services_status = service_directory.get_all_services_status()
    healthy_services = sum(1 for service in services_status.values() if service["is_healthy"])
    total_services = len(services_status)
    
    return {
        "status": "healthy" if healthy_services == total_services else "degraded",
        "service": "FBA Claims Pipeline Orchestrator",
        "version": "2.0.0",
        "services": {
            "healthy": healthy_services,
            "total": total_services,
            "status": services_status
        }
    }

# Temporarily comment out all router includes to debug
# app.include_router(detect_router)
# app.include_router(filing_router)
# app.include_router(ml_router)
app.include_router(auth_router, tags=["auth"])
# app.include_router(integrations_router, tags=["integrations"])
# app.include_router(detections_router, tags=["detections"])
# app.include_router(recoveries_router, tags=["recoveries"])
# app.include_router(evidence_router, tags=["evidence"])
# app.include_router(evidence_sources_router, tags=["evidence-sources"])
# app.include_router(parser_router, tags=["parser"])
# app.include_router(evidence_matching_router, tags=["evidence-matching"])
# app.include_router(zero_effort_evidence_router, tags=["zero-effort-evidence"])
# app.include_router(metrics_router, tags=["metrics"])
# app.include_router(sync_router, tags=["sync"])
# app.include_router(websocket_router, tags=["websocket"])
# app.include_router(evidence_prompts_router, tags=["evidence-prompts"])
# app.include_router(websocket_endpoints_router, tags=["websocket-endpoints"])
# app.include_router(dispute_submissions_router, tags=["dispute-submissions"])
# app.include_router(security_router, tags=["security"])
# app.include_router(analytics_router, tags=["analytics"])
# app.include_router(feature_flags_router, tags=["feature-flags"])



@app.get("/api/services/status")
async def services_status():
    """Get status of all microservices"""
    return service_directory.get_all_services_status()

# Protected endpoints require authentication
from .api.auth_middleware import get_current_user
from fastapi import Depends

@app.get("/api/user/profile")
async def get_user_profile(user: dict = Depends(get_current_user)):
    """Get current user profile - protected endpoint"""
    return {"user": user}

@app.get("/cors/debug")
def cors_debug():
    """Expose current CORS configuration for debugging deployments"""
    return {
        "allow_origins": all_allowed_origins,
        "frontend_url": frontend,
    }

# ------------------------------------------------------------
# Alias routes to match frontend-expected paths (Phase 1)
# These are thin wrappers/redirects to existing endpoints
# ------------------------------------------------------------

# Amazon SP-API Aliases
@app.options("/api/v1/integrations/amazon/sandbox/callback")
@app.get("/api/v1/integrations/amazon/sandbox/callback")
async def amazon_sandbox_callback(request: Request):
    """Handle sandbox Amazon OAuth callback with CORS headers"""
    from fastapi.responses import JSONResponse, Response
    from .api.auth_sandbox import MOCK_USERS
    import jwt
    from datetime import datetime, timedelta
    
    # Handle OPTIONS preflight request
    if request.method == "OPTIONS":
        origin = request.headers.get("Origin", "*")
        if origin in all_allowed_origins or any(o in origin for o in ["vercel.app", "onrender.com"]):
            response = Response(status_code=204)
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
            response.headers["Access-Control-Max-Age"] = "3600"
            return response
    
    # Create proper session token for sandbox user
    user_data = MOCK_USERS["sandbox-user"]
    session_token = jwt.encode(
        {"user_id": user_data["user_id"], "exp": datetime.utcnow() + timedelta(days=7)}, 
        settings.JWT_SECRET, 
        algorithm="HS256"
    )
    
    origin = request.headers.get("Origin", "*")
    response = JSONResponse(
        content={
            "user": user_data,
            "access_token": session_token,
            "message": "Sandbox login successful"
        }
    )
    
    # Set session cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7*24*3600,
    )
    
    # Set CORS headers explicitly
    if origin in all_allowed_origins or any(o in origin for o in ["vercel.app", "onrender.com"]):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    
    return response

@app.get("/api/v1/integrations/amazon/recoveries")
async def amazon_recoveries_summary(request: Request):
    # Redirect to existing recovery metrics endpoint
    target = "/api/metrics/recoveries"
    if request.url.query:
        target = f"{target}?{request.url.query}"
    return RedirectResponse(target)

@app.post("/api/v1/integrations/amazon/start-sync")
async def start_amazon_sync():
    # Redirect to existing sync start endpoint
    return RedirectResponse("/api/sync/start")

# Recoveries Aliases
@app.post("/api/recoveries/{id}/submit")
async def submit_recovery(id: str):
    # Redirect to existing claims submit endpoint
    return RedirectResponse(f"/api/claims/{id}/submit")

@app.post("/api/recoveries/{id}/resubmit")
async def resubmit_recovery(id: str):
    # Reuse the same submit endpoint
    return RedirectResponse(f"/api/claims/{id}/submit")

# Evidence Aliases
@app.post("/api/evidence/auto-collect")
async def auto_collect_evidence(user: dict = Depends(get_current_user)):
    # Simple stub indicating auto-collect enabled
    return {"ok": True, "message": "Auto-collect enabled", "user_id": user["user_id"]}

@app.post("/api/evidence/sync")
async def evidence_sync():
    # Simple stub indicating evidence sync started
    return {"ok": True, "started": True}

# SSE Alias
@app.get("/api/sse/status")
async def sse_status():
    # Report SSE connection status
    return {"connected": True, "endpoints": ["/api/sse/stream"]}












