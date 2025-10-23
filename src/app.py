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
    except Exception as _compat_err:  # Final fallback: apply an inline shim
        print(f"[startup-warning] compatibility_patch not applied: {_compat_err}")
        # Inline, safe shim for Pydantic v1 on Python 3.13+
        try:
            import typing
            import pydantic  # type: ignore

            def _apply_inline_py313_pydantic_v1_patch() -> None:
                try:
                    version = getattr(pydantic, "__version__", "1")
                    major = int(str(version).split(".")[0])
                except Exception:
                    major = 1

                if major != 1:
                    return

                if sys.version_info < (3, 13):
                    return

                try:
                    import pydantic.typing as pyd_typing  # type: ignore
                except Exception:
                    return

                original = getattr(pyd_typing, "evaluate_forwardref", None)
                ForwardRef = getattr(typing, "ForwardRef", None)
                if not callable(original) or ForwardRef is None:
                    return

                def _patched(type_, globalns, localns):  # type: ignore
                    try:
                        if isinstance(type_, ForwardRef):
                            return type_._evaluate(globalns=globalns, localns=localns, recursive_guard=set())
                    except TypeError:
                        return type_._evaluate(globalns, localns, set())
                    return original(type_, globalns, localns)

                try:
                    pyd_typing.evaluate_forwardref = _patched  # type: ignore[attr-defined]
                except Exception:
                    pass

            _apply_inline_py313_pydantic_v1_patch()
        except Exception:
            # If even the inline shim fails, proceed without blocking startup
            pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi import Request
from contextlib import asynccontextmanager
import asyncio
import logging
import os

from .cdd.router import router as detect_router
from .acg.router import router as filing_router
from .ml_detector.router import router as ml_router
from .api.auth_sandbox import router as auth_router
from .api.integrations import router as integrations_router
from .api.detections import router as detections_router
from .api.recoveries import router as recoveries_router
from .api.evidence import router as evidence_router
from .api.evidence_sources import router as evidence_sources_router
from .api.parser import router as parser_router
from .api.evidence_matching import router as evidence_matching_router
from .api.zero_effort_evidence import router as zero_effort_evidence_router
from .api.metrics import router as metrics_router
from .api.sync import router as sync_router
from .api.websocket import router as websocket_router
from .api.evidence_prompts_proof_packets import router as evidence_prompts_router
from .api.websocket_endpoints import router as websocket_endpoints_router
from .api.dispute_submissions import router as dispute_submissions_router
from .api.security import router as security_router
from .api.analytics import router as analytics_router
from .api.feature_flags import router as feature_flags_router
from .analytics.analytics_integration import analytics_integration
from .features.feature_integration import feature_integration
from .services.service_directory import service_directory

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    logger.info("Starting Opside FBA Claims Pipeline Orchestrator...")
    
    # Start service health monitoring
    health_task = asyncio.create_task(service_directory.start_health_monitoring())

    # Start analytics integration
    await analytics_integration.start()

    # Start feature integration
    await feature_integration.start()

    # Initial health check
    await service_directory.check_all_services()

    logger.info("Orchestrator started successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down orchestrator...")
    health_task.cancel()
    await analytics_integration.stop()
    await feature_integration.stop()
    await service_directory.close()
    logger.info("Orchestrator shutdown complete")

app = FastAPI(
    title="FBA Claims Pipeline Orchestrator",
    description="Production-ready orchestrator for Claim Detection, Evidence Validation, and Auto-Claims Generation",
    version="2.0.0",
    lifespan=lifespan
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
frontend = os.getenv("FRONTEND_URL") or settings.FRONTEND_URL or "https://opside-complete-frontend.onrender.com"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(detect_router)
app.include_router(filing_router)
app.include_router(ml_router)

# Include API routers for frontend
app.include_router(auth_router, tags=["auth"])
app.include_router(integrations_router, tags=["integrations"])
app.include_router(detections_router, tags=["detections"])
app.include_router(recoveries_router, tags=["recoveries"])
app.include_router(evidence_router, tags=["evidence"])
app.include_router(evidence_sources_router, tags=["evidence-sources"])
app.include_router(parser_router, tags=["parser"])
app.include_router(evidence_matching_router, tags=["evidence-matching"])
app.include_router(zero_effort_evidence_router, tags=["zero-effort-evidence"])
app.include_router(metrics_router, tags=["metrics"])
app.include_router(sync_router, tags=["sync"])
app.include_router(websocket_router, tags=["websocket"])
app.include_router(evidence_prompts_router, tags=["evidence-prompts"])
app.include_router(websocket_endpoints_router, tags=["websocket-endpoints"])
app.include_router(dispute_submissions_router, tags=["dispute-submissions"])
app.include_router(security_router, tags=["security"])
app.include_router(analytics_router, tags=["analytics"])
app.include_router(feature_flags_router, tags=["feature-flags"])

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

@app.get("/")
def root():
    """Root endpoint with service information"""
    return {
        "service": "FBA Claims Pipeline Orchestrator",
        "version": "2.0.0",
        "description": "Production-ready microservices orchestrator",
        "endpoints": {
            "auth": "/api/auth",
            "integrations": "/api/integrations", 
            "detections": "/api/detections",
            "recoveries": "/api/recoveries",
            "evidence": "/api/documents",
            "evidence-sources": "/api/v1/integrations/evidence/sources",
            "parser": "/api/v1/evidence/parse",
            "evidence-matching": "/api/internal/evidence",
            "zero-effort-evidence": "/api/internal/events",
            "metrics": "/api/metrics",
            "health": "/health",
            "services": "/api/services/status"
        }
    }

@app.get("/api/services/status")
async def services_status():
    """Get status of all microservices"""
    return service_directory.get_all_services_status()

@app.get("/cors/debug")
def cors_debug():
    """Expose current CORS configuration for debugging deployments"""
    return {
        "allow_origins": allow_origins,
        "allow_origin_regex": allow_origin_regex,
    }

# ------------------------------------------------------------
# Alias routes to match frontend-expected paths (Phase 1)
# These are thin wrappers/redirects to existing endpoints
# ------------------------------------------------------------

# Amazon SP-API Aliases
@app.get("/api/v1/integrations/amazon/sandbox/callback")
async def amazon_sandbox_callback(request: Request):
    # Redirect to existing Amazon OAuth callback
    target = "/api/auth/amazon/callback"
    if request.url.query:
        target = f"{target}?{request.url.query}"
    return RedirectResponse(target)

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
async def auto_collect_evidence():
    # Simple stub indicating auto-collect enabled
    return {"ok": True, "message": "Auto-collect enabled"}

@app.post("/api/evidence/sync")
async def evidence_sync():
    # Simple stub indicating evidence sync started
    return {"ok": True, "started": True}

# SSE Alias
@app.get("/api/sse/status")
async def sse_status():
    # Report SSE connection status
    return {"connected": True, "endpoints": ["/api/sse/stream"]}












