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

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from contextlib import asynccontextmanager
from datetime import datetime
import asyncio
import logging
import os

# Temporarily comment out all imports to debug routing
# from .cdd.router import router as detect_router
# from .acg.router import router as filing_router
# from .ml_detector.router import router as ml_router
from .api.auth_sandbox import router as auth_router
from .api.integrations import router as integrations_router
from .api.detections import router as detections_router
from .api.recoveries import router as recoveries_router
from .api.evidence import router as evidence_router
# from .api.evidence_sources import router as evidence_sources_router
# from .api.parser import router as parser_router
# from .api.evidence_matching import router as evidence_matching_router
# from .api.zero_effort_evidence import router as zero_effort_evidence_router
# from .api.metrics import router as metrics_router
from .api.sync import router as sync_router
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
    logger.info("Starting Opside Python API (Consolidated Services)...")
    
    # Note: All Python services are now consolidated internally
    # Only start health monitoring if there are external services to check
    if service_directory.services:
        health_task = asyncio.create_task(service_directory.start_health_monitoring())
        # Initial health check
        await service_directory.check_all_services()
    else:
        logger.info("All services consolidated - no external health checks needed")
    
    logger.info("Python API started successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Python API...")
    if service_directory.services:
        health_task.cancel()
        try:
            await health_task
        except asyncio.CancelledError:
            pass
    await service_directory.close()
    logger.info("Python API shutdown complete")

app = FastAPI(
    title="Opside Integrations API",
    description="Production-ready orchestrator for Claim Detection, Evidence Validation, and Auto-Claims Generation",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    debug=False  # Disable debug mode to prevent verbose error responses
)

# Custom exception handlers to return clean error responses (no stack traces)
# Define these immediately after app creation to ensure imports are available
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Return clean HTTP exception responses"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "message": exc.detail,
            "status_code": exc.status_code
        }
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return clean validation error responses"""
    return JSONResponse(
        status_code=422,
        content={
            "error": True,
            "message": "Validation error",
            "status_code": 422,
            "details": exc.errors()
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Return clean error responses for unhandled exceptions (no stack traces)"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "message": "Internal server error",
            "status_code": 500
        }
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
    "https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app",
    "https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app",
    "https://opside-complete-frontend-nwcors9h1-mvelo-ndabas-projects.vercel.app",
    "https://opside-complete-frontend.onrender.com",
    "https://clario-complete-backend-y5cd.onrender.com",
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
    """Simple health check endpoint for Render and monitoring"""
    return {
        "status": "ok",
        "service": "Opside Python API",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

# Consolidated routers - all services merged into main-api
from .api.consolidated.mcde_router import mcde_router
from .api.consolidated.claim_detector_router import claim_detector_router
from .api.consolidated.evidence_engine_router import evidence_engine_router
from .api.consolidated.test_service_router import test_service_router

# Existing routers
app.include_router(auth_router, tags=["auth"])
app.include_router(detections_router, tags=["detections"])
app.include_router(recoveries_router, tags=["recoveries"])
app.include_router(evidence_router, tags=["evidence"])
app.include_router(sync_router, tags=["sync"])
app.include_router(integrations_router, tags=["integrations"])

# Workflow orchestration is now handled by Node.js OrchestrationJobManager
# Python services call Node.js orchestrator via HTTP: POST /api/v1/workflow/phase/:phaseNumber

# Consolidated service routers (merged from separate microservices)
app.include_router(mcde_router)
app.include_router(claim_detector_router)
app.include_router(evidence_engine_router)
app.include_router(test_service_router)



@app.get("/api/services/status")
async def services_status():
    """Get status of services (consolidated architecture)"""
    # All Python services are now consolidated internally
    consolidated_services = {
        "mcde": {
            "name": "MCDE",
            "status": "internal",
            "consolidated": True,
            "endpoint": "/api/v1/mcde"
        },
        "claim-detector": {
            "name": "Claim Detector",
            "status": "internal",
            "consolidated": True,
            "endpoint": "/api/v1/claim-detector"
        },
        "evidence-engine": {
            "name": "Evidence Engine",
            "status": "internal",
            "consolidated": True,
            "endpoint": "/api/v1/evidence-engine"
        },
        "test-service": {
            "name": "Test Service",
            "status": "internal",
            "consolidated": True,
            "endpoint": "/api/v1/tests"
        }
    }
    
    # Include external services if any (e.g., Node.js backend)
    external_services = service_directory.get_all_services_status()
    
    return {
        "consolidated": True,
        "architecture": "monolithic",
        "internal_services": consolidated_services,
        "external_services": external_services,
        "total_internal": len(consolidated_services),
        "total_external": len(external_services)
    }

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
@app.post("/api/v1/integrations/amazon/sandbox/callback")
async def amazon_sandbox_callback(request: Request):
    """Handle sandbox Amazon OAuth callback with CORS headers - accepts POST with JSON body"""
    from fastapi.responses import JSONResponse, Response
    from .api.auth_sandbox import MOCK_USERS
    from .common import db as db_module
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
    
    # Handle POST request with JSON body
    if request.method == "POST":
        try:
            body = await request.json()
            state = body.get("state", "")
            
            # Create or retrieve sandbox user
            user_data = MOCK_USERS["sandbox-user"]
            user_id = user_data["user_id"]
            
            # Ensure sandbox user exists in database
            try:
                db_module.db.upsert_user_profile(
                    seller_id=user_data["amazon_seller_id"],
                    company_name=user_data.get("name", "Sandbox Company"),
                    marketplaces=["ATVPDKIKX0DER"]  # US marketplace
                )
            except Exception as e:
                logger.warning(f"Database upsert failed (sandbox mode): {e}")
                # Continue even if database fails - sandbox mode is forgiving
            
            # Generate JWT token with proper payload
            now = datetime.utcnow()
            payload = {
                "user_id": user_id,
                "email": user_data.get("email", "sandbox@example.com"),
                "name": user_data.get("name", "Sandbox User"),
                "amazon_seller_id": user_data.get("amazon_seller_id", "SANDBOX"),
                "exp": int((now + timedelta(days=7)).timestamp()),
                "iat": int(now.timestamp())
            }
            session_token = jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")
            
            # Create response
            origin = request.headers.get("Origin", "*")
            response = JSONResponse(
                content={
                    "ok": True,
                    "connected": True
                }
            )
            
            # Set session cookie with correct configuration
            response.set_cookie(
                key="session_token",
                value=session_token,
                httponly=True,
                secure=settings.ENV == "production",  # Secure only in production
                samesite="none",
                max_age=604800,  # 7 days
                path="/"
            )
            
            # Set CORS headers explicitly
            if origin in all_allowed_origins or any(o in origin for o in ["vercel.app", "onrender.com"]):
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Allow-Credentials"] = "true"
            
            logger.info(f"Sandbox session established for user {user_id}")
            return response
            
        except Exception as e:
            logger.error(f"Sandbox callback error: {e}")
            origin = request.headers.get("Origin", "*")
            error_response = JSONResponse(
                status_code=400,
                content={"ok": False, "error": "Invalid request", "message": str(e)}
            )
            if origin in all_allowed_origins or any(o in origin for o in ["vercel.app", "onrender.com"]):
                error_response.headers["Access-Control-Allow-Origin"] = origin
                error_response.headers["Access-Control-Allow-Credentials"] = "true"
            return error_response
    
    # Handle GET request (backward compatibility)
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
async def amazon_recoveries_summary(request: Request, user: dict = Depends(get_current_user)):
    """Get Amazon recovery summary - returns totalAmount, currency, and claimCount"""
    from fastapi.responses import JSONResponse
    import httpx
    import time
    from .common.config import settings
    
    try:
        user_id = user["user_id"]
        logger.info(f"🔍 Getting Amazon recoveries summary for user {user_id}")
        
        # Call Node.js backend's Amazon service to get real SP-API data
        # The Node.js backend has the actual Amazon SP-API integration
        # Use /recoveries endpoint which returns summary (totalAmount, claimCount)
        integrations_url = settings.INTEGRATIONS_URL or "http://localhost:3001"
        recoveries_url = f"{integrations_url}/api/v1/integrations/amazon/recoveries"
        
        logger.info(f"📍 Calling Node.js backend: {recoveries_url}")
        logger.info(f"🔗 INTEGRATIONS_URL: {integrations_url}")
        
        try:
            start_time = time.time()
            async with httpx.AsyncClient(timeout=30.0) as client:
                # First, try to get claims/reimbursements from Node.js backend
                # This calls the real SP-API directly
                try:
                    recoveries_response = await client.get(
                        recoveries_url,
                        headers={
                            "Content-Type": "application/json",
                            # Forward user context if needed
                        },
                        cookies=request.cookies  # Forward auth cookies if needed
                    )
                    elapsed_time = time.time() - start_time
                    
                    logger.info(f"⏱️ Node.js backend response time: {elapsed_time:.2f}s")
                    logger.info(f"📊 Response status: {recoveries_response.status_code}")
                    
                    if recoveries_response.status_code == 200:
                        recoveries_data = recoveries_response.json()
                        logger.info(f"📦 Response data keys: {list(recoveries_data.keys())}")
                        logger.info(f"📦 Full response: {recoveries_data}")
                        
                        # The /recoveries endpoint returns: {totalAmount, currency, claimCount, source, dataSource}
                        total_amount = recoveries_data.get("totalAmount", 0) or 0
                        claim_count = recoveries_data.get("claimCount", 0) or 0
                        source = recoveries_data.get("source", "unknown")
                        data_source = recoveries_data.get("dataSource", "unknown")
                        
                        logger.info(f"✅ Got recoveries from Node.js backend: {claim_count} claims, ${total_amount} total (source: {source}, dataSource: {data_source})")
                        
                        # Return the response directly (it already has the right format)
                        return JSONResponse(
                            content={
                                "totalAmount": float(total_amount),
                                "currency": recoveries_data.get("currency", "USD"),
                                "claimCount": int(claim_count),
                                "source": source,
                                "dataSource": data_source,
                                "message": recoveries_data.get("message"),
                                "responseTime": round(elapsed_time, 2)
                            }
                        )
                    elif recoveries_response.status_code == 401:
                        logger.error(f"🔒 AUTH ERROR: Node.js backend returned 401 Unauthorized")
                        logger.error(f"📄 Response body: {recoveries_response.text[:500]}")
                    elif recoveries_response.status_code == 404:
                        logger.error(f"📍 NOT FOUND: Node.js backend endpoint {recoveries_url} returned 404")
                        logger.error(f"📄 Response body: {recoveries_response.text[:500]}")
                    elif recoveries_response.status_code >= 500:
                        logger.error(f"💥 SERVER ERROR: Node.js backend returned {recoveries_response.status_code}")
                        logger.error(f"📄 Response body: {recoveries_response.text[:500]}")
                    else:
                        logger.warning(f"⚠️ Node.js backend returned {recoveries_response.status_code}: {recoveries_response.text[:500]}")
                        
                except httpx.TimeoutException as e:
                    elapsed_time = time.time() - start_time
                    logger.error(f"⏱️ BACKEND TIMEOUT: Node.js backend took longer than 30 seconds (elapsed: {elapsed_time:.2f}s)")
                    logger.error(f"🔗 URL: {recoveries_url}")
                    logger.error(f"❌ Timeout error: {str(e)}")
                except httpx.RequestError as e:
                    elapsed_time = time.time() - start_time
                    logger.error(f"🌐 NETWORK ERROR: Cannot reach Node.js backend")
                    logger.error(f"🔗 URL: {recoveries_url}")
                    logger.error(f"⏱️ Elapsed time: {elapsed_time:.2f}s")
                    logger.error(f"❌ Request error: {str(e)}")
                    logger.error(f"📋 Error type: {type(e).__name__}")
                except Exception as e:
                    elapsed_time = time.time() - start_time
                    logger.error(f"❌ UNEXPECTED ERROR calling Node.js backend")
                    logger.error(f"🔗 URL: {recoveries_url}")
                    logger.error(f"⏱️ Elapsed time: {elapsed_time:.2f}s")
                    logger.error(f"❌ Error: {str(e)}")
                    logger.error(f"📋 Error type: {type(e).__name__}", exc_info=True)
                    
        except Exception as e:
            logger.error(f"❌ Outer exception in Node.js backend call: {str(e)}", exc_info=True)
        
        # Fallback: Try refund engine (in case data was synced there)
        logger.info(f"🔄 Trying refund engine fallback for user {user_id}")
        try:
            from .services.refund_engine_client import refund_engine_client
            result = await refund_engine_client.get_claim_stats(user_id)
            
            if "error" not in result:
                total_amount = result.get("total_amount", 0) or result.get("approved_amount", 0)
                claim_count = result.get("total_claims", 0)
                
                if total_amount > 0 or claim_count > 0:
                    logger.info(f"✅ Got data from refund engine: {claim_count} claims, ${total_amount:.2f}")
                    return JSONResponse(
                        content={
                            "totalAmount": float(total_amount),
                            "currency": "USD",
                            "claimCount": int(claim_count),
                            "source": "refund_engine"
                        }
                    )
                else:
                    logger.info(f"⚠️ Refund engine returned zero claims/amount")
            else:
                logger.warning(f"❌ Refund engine returned error: {result.get('error')}")
        except Exception as e:
            logger.warning(f"❌ Refund engine fallback failed: {str(e)}", exc_info=True)
        
        # Default response if no data found
        # This might mean:
        # 1. User hasn't synced data yet - frontend should call /api/sync/start
        # 2. Amazon connection not established
        # 3. No claims/reimbursements exist in the date range
        # 4. Node.js backend is not responding
        logger.info(f"⚠️ No Amazon recovery data found for user {user_id} - returning zeros")
        logger.info(f"💡 Possible reasons:")
        logger.info(f"   1. User hasn't synced data yet - frontend should call /api/sync/start")
        logger.info(f"   2. Amazon connection not established")
        logger.info(f"   3. No claims/reimbursements exist in the date range")
        logger.info(f"   4. Node.js backend at {integrations_url} is not responding")
        
        return JSONResponse(
            content={
                "totalAmount": 0.0,
                "currency": "USD",
                "claimCount": 0,
                "message": "No data found. Please sync your Amazon account first.",
                "source": "fallback",
                "diagnostics": {
                    "integrationsUrl": integrations_url,
                    "claimsUrl": claims_url,
                    "userId": user_id
                }
            }
        )
        
    except Exception as e:
        logger.error(f"💥 CRITICAL ERROR getting recoveries summary: {str(e)}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "totalAmount": 0.0,
                "currency": "USD",
                "claimCount": 0,
                "error": str(e),
                "source": "error",
                "message": "Internal server error while fetching recoveries"
            }
        )

@app.get("/api/v1/integrations/amazon/test-connection")
async def test_amazon_spapi_connection(user: dict = Depends(get_current_user)):
    """Test Amazon SP-API connection - verifies credentials and fetches real data"""
    from .integrations.amazon_spapi_service import amazon_spapi_service
    
    try:
        logger.info(f"Testing Amazon SP-API connection for user {user.get('user_id')}")
        
        # Test the connection
        result = await amazon_spapi_service.test_connection()
        
        return JSONResponse(
            content=result,
            status_code=200 if result.get("success") else 502
        )
        
    except Exception as e:
        logger.error(f"Amazon SP-API connection test failed: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "message": "Failed to test Amazon SP-API connection"
            }
        )

@app.get("/api/v1/integrations/amazon/sellers-info")
async def get_amazon_sellers_info(user: dict = Depends(get_current_user)):
    """Get Amazon seller information and marketplace participations - real SP-API data"""
    from .integrations.amazon_spapi_service import amazon_spapi_service
    
    try:
        logger.info(f"Getting Amazon sellers info for user {user.get('user_id')}")
        
        # Get sellers info
        result = await amazon_spapi_service.get_sellers_info()
        
        return JSONResponse(
            content=result,
            status_code=200 if result.get("success") else 502
        )
        
    except Exception as e:
        logger.error(f"Failed to get Amazon sellers info: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "message": "Failed to get Amazon sellers information"
            }
        )

@app.get("/api/v1/integrations/amazon/inventory-real")
async def get_amazon_inventory_real(user: dict = Depends(get_current_user)):
    """Get real Amazon inventory data from SP-API"""
    from .integrations.amazon_spapi_service import amazon_spapi_service
    
    try:
        logger.info(f"Getting real Amazon inventory for user {user.get('user_id')}")
        
        # Get inventory summaries
        result = await amazon_spapi_service.get_inventory_summaries()
        
        return JSONResponse(
            content=result,
            status_code=200 if result.get("success") else 502
        )
        
    except Exception as e:
        logger.error(f"Failed to get Amazon inventory: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "message": "Failed to get Amazon inventory"
            }
        )

@app.post("/api/v1/integrations/amazon/start-sync")
async def start_amazon_sync():
    # Redirect to existing sync start endpoint
    return RedirectResponse("/api/sync/start")

# Recoveries Aliases - These endpoints are now in recoveries_router
# The redirect was breaking authentication (403 errors)
# Now using the actual router endpoints which properly handle auth

# Evidence Aliases
@app.post("/api/evidence/auto-collect")
async def auto_collect_evidence(user: dict = Depends(get_current_user)):
    # Simple stub indicating auto-collect enabled
    return {"ok": True, "message": "Auto-collect enabled", "user_id": user["user_id"]}

@app.post("/api/evidence/sync")
async def evidence_sync(user: dict = Depends(get_current_user)):
    """Trigger evidence sync for all connected sources (primarily Gmail)"""
    try:
        user_id = user["user_id"]
        logger.info(f"Triggering evidence sync for user {user_id}")
        
        from src.evidence.ingestion_service import EvidenceIngestionService
        from src.common.db_postgresql import DatabaseManager
        
        evidence_service = EvidenceIngestionService()
        db = DatabaseManager()
        
        # Find all connected Gmail sources for this user
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, provider, account_email, status
                    FROM evidence_sources 
                    WHERE user_id = %s AND status = 'connected' AND provider = 'gmail'
                    ORDER BY connected_at DESC
                """, (user_id,))
                
                sources = cursor.fetchall()
                
        if not sources:
            return {
                "ok": False,
                "error": "No connected Gmail sources found. Please connect Gmail first.",
                "started": False
            }
        
        # Trigger sync for each Gmail source
        job_ids = []
        for source_id, provider, account_email, status in sources:
            try:
                job_id = await evidence_service._start_ingestion_job(str(source_id), user_id)
                job_ids.append(job_id)
                logger.info(f"Started ingestion job {job_id} for Gmail source {source_id} ({account_email})")
            except Exception as e:
                logger.error(f"Failed to start ingestion job for source {source_id}: {e}")
        
        if job_ids:
            return {
                "ok": True,
                "started": True,
                "message": f"Evidence sync started for {len(job_ids)} Gmail source(s)",
                "job_ids": job_ids,
                "sources_synced": len(job_ids)
            }
        else:
            return {
                "ok": False,
                "error": "Failed to start evidence sync",
                "started": False
            }
            
    except Exception as e:
        logger.error(f"Error in evidence_sync: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start evidence sync: {str(e)}")

# SSE Alias
@app.get("/api/sse/status")
async def sse_status():
    # Report SSE connection status
    return {"connected": True, "endpoints": ["/api/sse/stream"]}












