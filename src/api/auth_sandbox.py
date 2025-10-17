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
from src.api.auth_middleware import get_current_user
from src.common import db as db_module
import os

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


@router.post("/api/auth/post-login/stripe")
async def post_login_stripe(user: dict = Depends(get_current_user)):
    """Return a Stripe redirect URL for post-login billing.
    - If the user has a Stripe customer, return Billing Portal session URL
    - Otherwise, create a customer and a Checkout Session (mode=setup) URL
    """
    frontend_base = settings.FRONTEND_URL
    return_url = f"{frontend_base}/billing"
    secret_key = os.getenv("STRIPE_SECRET_KEY", "")

    if not secret_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    try:
        import stripe  # type: ignore
    except Exception:
        raise HTTPException(status_code=500, detail="Stripe SDK missing. Install 'stripe'.")

    stripe.api_key = secret_key

    user_id = user.get("user_id")
    user_email = user.get("email") or ""
    user_name = user.get("name") or ""

    # Fetch existing mapping
    record = db_module.db.get_user_by_id(user_id) if db_module.db else None
    stripe_customer_id = record.get("stripe_customer_id") if record else None

    try:
        if stripe_customer_id:
            portal = stripe.billing_portal.Session.create(
                customer=stripe_customer_id,
                return_url=return_url,
            )
            return {"redirect_url": portal.url}

        customer = stripe.Customer.create(
            email=user_email or None,
            name=user_name or None,
            metadata={"user_id": user_id},
        )
        if db_module.db:
            db_module.db.save_stripe_customer_id(user_id, customer.id)

        checkout = stripe.checkout.Session.create(
            mode="setup",
            customer=customer.id,
            success_url=f"{return_url}?setup=success",
            cancel_url=f"{return_url}?setup=cancel",
            payment_method_types=["card"],
        )
        return {"redirect_url": checkout.url}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)}")
