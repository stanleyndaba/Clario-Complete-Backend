from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import logging

from src.cdd.router import router as detect_router
from src.acg.router import router as filing_router
from src.ml_detector.router import router as ml_router
from importlib import import_module
def _safe_import_router(module_path: str, attr: str = "router"):
    try:
        mod = import_module(module_path)
        return getattr(mod, attr, None)
    except Exception as e:
        logger.warning(f"Skipping router {module_path}: {e}")
        return None

auth_router = _safe_import_router('src.api.auth')
integrations_router = _safe_import_router('src.api.integrations')
detections_router = _safe_import_router('src.api.detections')
recoveries_router = _safe_import_router('src.api.recoveries')
evidence_router = _safe_import_router('src.api.evidence')
evidence_sources_router = _safe_import_router('src.api.evidence_sources')
parser_router = _safe_import_router('src.api.parser')
evidence_matching_router = _safe_import_router('src.api.evidence_matching')
zero_effort_evidence_router = _safe_import_router('src.api.zero_effort_evidence')
metrics_router = _safe_import_router('src.api.metrics')
sync_router = _safe_import_router('src.api.sync')
websocket_router = _safe_import_router('src.api.websocket')
evidence_prompts_router = _safe_import_router('src.api.evidence_prompts_proof_packets')
websocket_endpoints_router = _safe_import_router('src.api.websocket_endpoints')
dispute_submissions_router = _safe_import_router('src.api.dispute_submissions')
security_router = _safe_import_router('src.api.security')
analytics_router = _safe_import_router('src.api.analytics')
feature_flags_router = _safe_import_router('src.api.feature_flags')
from src.analytics.analytics_integration import analytics_integration
from src.features.feature_integration import feature_integration
from src.services.service_directory import service_directory
from src.common.config import settings

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    logger.info("Starting Opside FBA Claims Pipeline Orchestrator...")
    
    # Start service health monitoring (guard against missing services during cold start)
    health_task = None
    try:
        health_task = asyncio.create_task(service_directory.start_health_monitoring())
    except Exception as e:
        logger.warning(f"Health monitoring not started: {e}")

    # Start analytics integration (do not crash app if it fails)
    try:
        await analytics_integration.start()
    except Exception as e:
        logger.warning(f"Analytics integration not started: {e}")

    # Start feature integration (do not crash app if it fails)
    try:
        await feature_integration.start()
    except Exception as e:
        logger.warning(f"Feature integration not started: {e}")

    # Initial health check (best-effort)
    try:
        await service_directory.check_all_services()
    except Exception as e:
        logger.warning(f"Initial service check failed: {e}")

    logger.info("Orchestrator started successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down orchestrator...")
    if health_task:
        health_task.cancel()
    try:
        await analytics_integration.stop()
    except Exception:
        pass
    try:
        await feature_integration.stop()
    except Exception:
        pass
    try:
        await service_directory.close()
    except Exception:
        pass
    logger.info("Orchestrator shutdown complete")

app = FastAPI(
    title="FBA Claims Pipeline Orchestrator",
    description="Production-ready orchestrator for Claim Detection, Evidence Validation, and Auto-Claims Generation",
    version="2.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend integration using env-configured origins
cors_kwargs = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
origins = settings.get_allowed_origins()
origin_regex = getattr(settings, 'ALLOWED_ORIGIN_REGEX', '')
if origin_regex:
    cors_kwargs["allow_origin_regex"] = origin_regex
else:
    cors_kwargs["allow_origins"] = origins

app.add_middleware(CORSMiddleware, **cors_kwargs)

# Include routers
app.include_router(detect_router)
app.include_router(filing_router)
app.include_router(ml_router)

# Include API routers for frontend
for tag, r in [
    ("auth", auth_router),
    ("integrations", integrations_router),
    ("detections", detections_router),
    ("recoveries", recoveries_router),
    ("evidence", evidence_router),
    ("evidence-sources", evidence_sources_router),
    ("parser", parser_router),
    ("evidence-matching", evidence_matching_router),
    ("zero-effort-evidence", zero_effort_evidence_router),
    ("metrics", metrics_router),
    ("sync", sync_router),
    ("websocket", websocket_router),
    ("evidence-prompts", evidence_prompts_router),
    ("websocket-endpoints", websocket_endpoints_router),
    ("dispute-submissions", dispute_submissions_router),
    ("security", security_router),
    ("analytics", analytics_router),
    ("feature-flags", feature_flags_router),
]:
    if r is not None:
        try:
            app.include_router(r, tags=[tag])
        except Exception as e:
            logger.warning(f"Failed to include router {tag}: {e}")

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








