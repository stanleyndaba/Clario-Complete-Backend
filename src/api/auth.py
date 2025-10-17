"""
Authentication API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Response, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from datetime import datetime, timedelta
import jwt
import secrets
from src.api.schemas import UserProfile, AmazonLoginResponse, LogoutResponse, APIError
from src.api.auth_middleware import get_current_user, create_jwt_token
import httpx
import base64
from cryptography.fernet import Fernet
from src.common import settings
from src.common import db as db_module
from src.api.service_connector import service_connector
from src.services.stripe_client import stripe_client
import os
import json

router = APIRouter()
security = HTTPBearer()

# Crypto helper for encrypting refresh tokens at rest
def _get_fernet() -> Fernet:
    # Derive a 32-byte key from CRYPTO_SECRET (in dev, we accept non-32 length by padding)
    raw = settings.CRYPTO_SECRET.encode("utf-8")
    key = base64.urlsafe_b64encode((raw + b"0" * 32)[:32])
    return Fernet(key)

# Mock JWT secret - in production, use environment variable
JWT_SECRET = "your-secret-key-change-in-production"
JWT_ALGORITHM = "HS256"

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

@router.get("/api/auth/me", response_model=UserProfile)
def get_current_user_profile(user: dict = Depends(get_current_user)):
    """Get current user profile"""
    user_id = user["user_id"]
    
    # Get user data from database
    user_data = db_module.db.get_user_by_id(user_id)
    
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserProfile(
        id=user_id,
        email=user_data.get("email", "user@example.com"),
        name=user_data.get("company_name", "Unknown User"),
        amazon_connected=bool(user_data.get("amazon_seller_id")),
        stripe_connected=bool(user_data.get("stripe_customer_id")),
        created_at=user_data.get("created_at", "2025-01-01T00:00:00Z"),
        last_login=user_data.get("last_login", datetime.utcnow().isoformat() + "Z")
    )

@router.get("/auth/amazon/start", response_model=AmazonLoginResponse)
def amazon_login_start(response: Response):
    """Initiate Amazon OAuth login"""
    # Generate state parameter for CSRF protection
    state = secrets.token_urlsafe(32)
    
    # Amazon OAuth URL (replace with your actual client ID)
    client_id = settings.AMAZON_CLIENT_ID or "your-amazon-client-id"
    redirect_uri = settings.AMAZON_REDIRECT_URI
    scope = "profile"
    
    auth_url = (
        f"https://www.amazon.com/ap/oa?"
        f"client_id={client_id}&"
        f"scope={scope}&"
        f"response_type=code&"
        f"redirect_uri={redirect_uri}&"
        f"state={state}"
    )

    # Set state in HttpOnly cookie for CSRF validation
    response.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=600,
    )

    return AmazonLoginResponse(
        auth_url=auth_url,
        state=state
    )

@router.post("/api/auth/logout", response_model=LogoutResponse)
def logout(response: Response):
    """Logout user"""
    # Clear any cookies or session data
    response.delete_cookie("access_token")
    response.delete_cookie("session_token")
    return LogoutResponse(message="Logged out successfully")


@router.get("/api/auth/amazon/callback")
async def amazon_callback(request: Request):
    """Handle Amazon OAuth callback: validate state, exchange code, fetch seller, upsert user, set session, redirect."""
    params = request.query_params
    code = params.get("code")
    state = params.get("state")
    state_cookie = request.cookies.get("oauth_state")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing OAuth parameters")

    # CSRF validation
    if not state_cookie or state_cookie != state:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    # Preferred path: call integrations-backend to process OAuth fully
    processed = await service_connector.process_amazon_oauth(code=code, state=state)
    seller_id = None
    company_name = None
    marketplaces = []
    refresh_token = None
    if processed and not processed.get("error") and processed.get("success") and processed.get("data"):
        data = processed["data"]
        seller_id = data.get("amazon_seller_id")
        company_name = data.get("company_name")
        marketplaces = data.get("marketplaces") or []
        # integrator stores refresh token centrally; not returned
    else:
        # Fallback to direct implementation to avoid login breakage
        token_url = "https://api.amazon.com/auth/o2/token"
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                token_resp = await client.post(
                    token_url,
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "client_id": settings.AMAZON_CLIENT_ID,
                        "client_secret": settings.AMAZON_CLIENT_SECRET,
                        "redirect_uri": settings.AMAZON_REDIRECT_URI,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )
                token_resp.raise_for_status()
                token_data = token_resp.json()
            except httpx.HTTPError:
                return Response(status_code=302, headers={"Location": f"{settings.FRONTEND_URL}/auth/error?reason=token_exchange_failed"})

        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        if not access_token or not refresh_token:
            return Response(status_code=302, headers={"Location": f"{settings.FRONTEND_URL}/auth/error?reason=missing_tokens"})

        sellers_url = "https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations"
        try:
            sellers_resp = await client.get(
                sellers_url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "x-amz-access-token": access_token,
                }
            )
            sellers_resp.raise_for_status()
            sellers_data = sellers_resp.json()
        except Exception:
            return Response(status_code=302, headers={"Location": f"{settings.FRONTEND_URL}/auth/error?reason=sellers_api_failed"})

        payload = sellers_data.get("payload") or sellers_data
        participations = payload.get("marketplaceParticipations") if isinstance(payload, dict) else payload
        if isinstance(participations, list) and len(participations) > 0:
            first = participations[0]
            seller_id = (first.get("participation") or {}).get("sellerId") or first.get("sellerId")
            company_name = (first.get("participation") or {}).get("sellerName") or first.get("sellerName") or "Unknown Company"
            for p in participations:
                mp = (p.get("marketplace") or {}).get("id") or p.get("marketplaceId")
                if mp:
                    marketplaces.append(mp)

        if not seller_id:
            return Response(status_code=302, headers={"Location": f"{settings.FRONTEND_URL}/auth/error?reason=missing_seller_id"})

    # Upsert user and save encrypted refresh token
    user_id = db_module.db.upsert_user_profile(seller_id=seller_id, company_name=company_name or "", marketplaces=marketplaces)
    # Only save refresh token locally when using fallback path; otherwise integrations service owns it
    if refresh_token:
        fernet = _get_fernet()
        enc_refresh = fernet.encrypt(refresh_token.encode("utf-8")).decode("utf-8")
        db_module.db.save_oauth_refresh_token(user_id=user_id, provider="amazon", encrypted_refresh_token=enc_refresh)

    # Create session JWT and set cookie
    session_token = jwt.encode({"user_id": user_id, "exp": datetime.utcnow() + timedelta(days=7)}, settings.JWT_SECRET, algorithm="HS256")
    response = Response(status_code=302)
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7*24*3600,
    )
    response.headers["Location"] = f"{settings.FRONTEND_URL}/dashboard"
    # Fire-and-forget: first-time sync auto-trigger
    try:
        user = db_module.db.get_user_by_id(user_id)
        if user and not user.get('last_sync_completed_at'):
            # Run first-time sync in background (non-blocking)
            import asyncio
            async def _trigger_sync():
                retries = 3
                delay = 1
                job_id = None
                for i in range(retries):
                    try:
                        result = await service_connector.start_sync(sync_type="inventory", user_id=user_id)
                        job_id = result.get('id') if isinstance(result, dict) else None
                        db_module.db.record_sync_attempt(user_id, job_id)
                        break
                    except Exception:
                        await asyncio.sleep(delay)
                        delay *= 2
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(_trigger_sync())
                else:
                    loop.create_task(_trigger_sync())
            except Exception:
                pass
    except Exception:
        pass
    return response


@router.post("/api/auth/post-login/stripe")
async def post_login_stripe(user: dict = Depends(get_current_user)):
    """Return a Stripe redirect URL for post-login billing.
    - If the user has a Stripe customer, return Billing Portal session URL
    - Otherwise, create a customer and a Checkout Session (mode=setup) URL
    """
    # Config
    frontend_base = settings.FRONTEND_URL
    return_url = f"{frontend_base}/billing"
    secret_key = getattr(settings, "STRIPE_SECRET_KEY", "") or os.getenv("STRIPE_SECRET_KEY", "")

    if not secret_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    # Lazy import to avoid dependency unless needed
    try:
        import stripe  # type: ignore
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail="Stripe SDK missing. Install 'stripe' package.")

    stripe.api_key = secret_key

    user_id = user["user_id"]
    user_email = user.get("email") or ""
    user_name = user.get("name") or ""

    # Fetch existing mapping
    record = db_module.db.get_user_by_id(user_id)
    stripe_customer_id = record.get("stripe_customer_id") if record else None

    try:
        if stripe_customer_id:
            # Create Billing Portal session
            portal = stripe.billing_portal.Session.create(
                customer=stripe_customer_id,
                return_url=return_url,
            )
            return {"redirect_url": portal.url}

        # Create a Stripe Customer and persist mapping
        customer = stripe.Customer.create(
            email=user_email or None,
            name=user_name or None,
            metadata={"user_id": user_id},
        )
        db_module.db.save_stripe_customer_id(user_id, customer.id)

        # Create Checkout Session to collect a payment method
        checkout = stripe.checkout.Session.create(
            mode="setup",
            customer=customer.id,
            success_url=f"{return_url}?setup=success",
            cancel_url=f"{return_url}?setup=cancel",
            payment_method_types=["card"],
        )
        return {"redirect_url": checkout.url}
    except Exception as e:
        # Non-blocking failure
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)}")
