"""
Working FastAPI app for frontend integration
This version includes essential endpoints without complex dependencies
"""

from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import jwt
import logging
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Clario Backend API",
    description="Working backend for frontend integration",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://localhost:5173", 
        "https://app.clario.ai",
        "*"  # Allow all origins for development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mock JWT secret - in production, use environment variable
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
security = HTTPBearer()

# Mock data storage (in production, use database)
mock_users = {
    "user1": {
        "id": "user1",
        "email": "user@example.com",
        "name": "Test User",
        "amazon_connected": False,
        "stripe_connected": False,
        "created_at": "2025-01-01T00:00:00Z",
        "last_login": datetime.utcnow().isoformat() + "Z"
    }
}

mock_integrations = {
    "user1": {
        "amazon": {"connected": False, "last_sync": None},
        "gmail": {"connected": False, "last_sync": None},
        "outlook": {"connected": False, "last_sync": None},
        "gdrive": {"connected": False, "last_sync": None},
        "dropbox": {"connected": False, "last_sync": None}
    }
}

def create_access_token(user_id: str) -> str:
    """Create JWT access token"""
    payload = {
        "user_id": user_id,
        "exp": datetime.utcnow() + timedelta(hours=24),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Verify JWT token and return user_id"""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Health and status endpoints
@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Clario Backend API is running!",
        "status": "healthy",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "auth": "/api/auth/me",
            "integrations": "/api/v1/integrations/status",
            "connect-amazon": "/api/v1/integrations/connect-amazon",
            "connect-docs": "/api/v1/integrations/connect-docs"
        }
    }

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "message": "API is running successfully",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "services": {
            "main_api": "healthy",
            "database": "mock",
            "redis": "mock"
        }
    }

# Authentication endpoints
@app.get("/api/auth/me")
async def get_current_user_profile(user_id: str = Depends(verify_token)):
    """Get current user profile"""
    if user_id not in mock_users:
        raise HTTPException(status_code=404, detail="User not found")
    
    return mock_users[user_id]

@app.post("/api/auth/login")
async def login(request: Request):
    """Mock login endpoint"""
    # In a real app, this would validate credentials
    user_id = "user1"  # Mock user
    token = create_access_token(user_id)
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": mock_users[user_id]
    }

@app.get("/auth/amazon/start")
async def amazon_login_start():
    """Initiate Amazon OAuth login"""
    # Mock Amazon OAuth URL
    auth_url = "https://www.amazon.com/ap/oa?client_id=mock&scope=profile&response_type=code&redirect_uri=http://localhost:8000/api/auth/amazon/callback&state=mock"
    
    return {
        "auth_url": auth_url,
        "state": "mock_state"
    }

@app.get("/api/auth/amazon/callback")
async def amazon_callback(request: Request):
    """Handle Amazon OAuth callback"""
    # Mock successful callback
    user_id = "user1"
    mock_users[user_id]["amazon_connected"] = True
    mock_integrations[user_id]["amazon"]["connected"] = True
    mock_integrations[user_id]["amazon"]["last_sync"] = datetime.utcnow().isoformat()
    
    token = create_access_token(user_id)
    
    # Set cookie and redirect
    response = Response(status_code=302)
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=False,  # Set to True in production with HTTPS
        samesite="lax",
        max_age=7*24*3600,
    )
    response.headers["Location"] = "http://localhost:3000/dashboard"
    return response

# Integration endpoints
@app.get("/api/v1/integrations/status")
async def get_integrations_status(user_id: str = Depends(verify_token)):
    """Get status of all integrations for the user"""
    if user_id not in mock_integrations:
        mock_integrations[user_id] = {
            "amazon": {"connected": False, "last_sync": None},
            "gmail": {"connected": False, "last_sync": None},
            "outlook": {"connected": False, "last_sync": None},
            "gdrive": {"connected": False, "last_sync": None},
            "dropbox": {"connected": False, "last_sync": None}
        }
    
    return {"ok": True, "data": mock_integrations[user_id]}

@app.get("/api/v1/integrations/connect-amazon")
async def connect_amazon(user_id: str = Depends(verify_token)):
    """Connect to Amazon integration"""
    # Mock Amazon connection
    mock_integrations[user_id]["amazon"]["connected"] = True
    mock_integrations[user_id]["amazon"]["last_sync"] = datetime.utcnow().isoformat()
    
    return {
        "ok": True, 
        "data": {
            "provider": "amazon",
            "connected": True,
            "message": "Amazon integration connected successfully"
        }
    }

@app.get("/api/v1/integrations/connect-docs")
async def connect_docs(
    provider: str,
    user_id: str = Depends(verify_token)
):
    """Connect to document provider integration"""
    if provider not in ["gmail", "outlook", "gdrive", "dropbox"]:
        raise HTTPException(status_code=400, detail="Invalid provider")
    
    # Mock document provider connection
    mock_integrations[user_id][provider]["connected"] = True
    mock_integrations[user_id][provider]["last_sync"] = datetime.utcnow().isoformat()
    
    return {
        "ok": True, 
        "data": {
            "provider": provider,
            "connected": True,
            "message": f"{provider} integration connected successfully"
        }
    }

@app.post("/api/v1/integrations/disconnect")
async def disconnect_integration(
    provider: str,
    user_id: str = Depends(verify_token)
):
    """Disconnect an integration"""
    if provider in mock_integrations[user_id]:
        mock_integrations[user_id][provider]["connected"] = False
        mock_integrations[user_id][provider]["last_sync"] = None
    
    return {
        "ok": True, 
        "data": {
            "provider": provider,
            "connected": False,
            "message": f"{provider} integration disconnected successfully"
        }
    }

# Additional endpoints that your frontend might need
@app.get("/api/detections")
async def get_detections(user_id: str = Depends(verify_token)):
    """Get claim detections"""
    return {
        "ok": True,
        "data": {
            "detections": [],
            "total": 0,
            "message": "No detections found"
        }
    }

@app.get("/api/recoveries")
async def get_recoveries(user_id: str = Depends(verify_token)):
    """Get recoveries"""
    return {
        "ok": True,
        "data": {
            "recoveries": [],
            "total": 0,
            "message": "No recoveries found"
        }
    }

@app.get("/api/evidence")
async def get_evidence(user_id: str = Depends(verify_token)):
    """Get evidence documents"""
    return {
        "ok": True,
        "data": {
            "evidence": [],
            "total": 0,
            "message": "No evidence found"
        }
    }

@app.get("/api/metrics")
async def get_metrics(user_id: str = Depends(verify_token)):
    """Get metrics"""
    return {
        "ok": True,
        "data": {
            "total_claims": 0,
            "successful_recoveries": 0,
            "total_amount": 0,
            "last_sync": None
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)