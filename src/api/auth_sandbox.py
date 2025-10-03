"""
Mock Amazon OAuth for sandbox testing
"""

from fastapi import APIRouter, HTTPException, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Dict, Any
import secrets
import logging
from src.common.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Request models
class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str

# Mock user database for sandbox
MOCK_USERS = {
    "sandbox-user": {
        "user_id": "sandbox-user-123",
        "email": "sandbox@clario.com",
        "name": "Sandbox User",
        "amazon_seller_id": "A1SANDBOX123"
    }
}

@router.get("/auth/amazon/start")
async def amazon_login_start():
    """Mock Amazon OAuth start - redirects to mock callback"""
    state = secrets.token_urlsafe(32)
    
    # For sandbox, directly redirect to callback with mock data
    redirect_url = f"{settings.FRONTEND_URL}/auth/callback?code=mock_auth_code&state={state}"
    
    return {"auth_url": redirect_url, "state": state, "message": "Sandbox mode - redirecting to frontend"}

@router.get("/api/auth/amazon/callback")
async def amazon_callback(request: Request):
    """Mock Amazon OAuth callback - creates mock user session"""
    try:
        # Mock successful authentication
        user_data = MOCK_USERS["sandbox-user"]
        
        # In a real implementation, you'd create JWT tokens here
        # For sandbox, return user data directly
        return {
            "user": user_data,
            "access_token": "mock_jwt_token_sandbox",
            "message": "Sandbox login successful"
        }
        
    except Exception as e:
        logger.error(f"Mock auth error: {e}")
        raise HTTPException(status_code=400, detail="Authentication failed")

@router.get("/api/auth/me")
async def get_current_user_profile():
    """Get mock user profile for sandbox"""
    return MOCK_USERS["sandbox-user"]

@router.post("/auth/login")
async def login(login_data: LoginRequest):
    """Mock login for sandbox testing"""
    if login_data.email == "test@clario.com" and login_data.password == "test":
        return {
            "user": MOCK_USERS["sandbox-user"],
            "access_token": "mock_jwt_token_sandbox",
            "message": "Login successful"
        }
    raise HTTPException(status_code=401, detail="Invalid credentials")

@router.post("/auth/register")
async def register(register_data: RegisterRequest):
    """Mock registration for sandbox testing"""
    return {
        "user": {
            "user_id": f"user-{secrets.token_urlsafe(8)}",
            "email": register_data.email,
            "name": register_data.name,
            "amazon_seller_id": f"A1{secrets.token_urlsafe(8).upper()}"
        },
        "access_token": "mock_jwt_token_sandbox",
        "message": "Registration successful"
    }

@router.post("/api/auth/logout")
async def logout():
    """Mock logout"""
    return {"message": "Logged out successfully"}
