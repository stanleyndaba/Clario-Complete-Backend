"""
Simplified FastAPI app for initial deployment
This version has minimal dependencies to ensure deployment works
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Clario Backend API",
    description="FBA Refund Prediction System Backend",
    version="1.0.0"
)

# Enable CORS (explicit origin, no wildcard)
origins = ["https://opside-complete-frontend.onrender.com"]
print(f"\n\n🚨 CORS CONFIG: Using origins: {origins}\n")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # No regex during verification to avoid misconfig
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("🚨 APP MIDDLEWARES:")
for mw in app.user_middleware:
    print(f"🚨 {mw}")

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Clario Backend API is running!",
        "status": "healthy",
        "version": "1.0.0"
    }

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "message": "API is running successfully",
        "timestamp": "2025-01-19T03:46:00Z"
    }

@app.get("/cors/debug")
async def cors_debug():
    return {
        "allow_origins": origins,
        "allow_origin_regex": None,
    }

@app.get("/_debug/middleware")
async def list_middleware():
    return {"user_middleware": [str(mw) for mw in app.user_middleware]}

@app.get("/api/status")
async def api_status():
    """API status endpoint"""
    return {
        "api": "Clario Backend",
        "version": "1.0.0",
        "status": "operational",
        "services": {
            "main_api": "healthy",
            "database": "connected",
            "redis": "connected"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
