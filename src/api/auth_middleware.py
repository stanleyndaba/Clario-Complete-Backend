"""
JWT Authentication Middleware and Utilities
Handles JWT token validation and user extraction for all API endpoints
"""

import jwt
from fastapi import HTTPException, Depends, status
from fastapi import WebSocket
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
import logging
from src.common.config import settings

logger = logging.getLogger(__name__)

# HTTP Bearer token scheme
security = HTTPBearer()

class JWTError(Exception):
    """Custom JWT error"""
    pass

def verify_jwt_token(token: str) -> dict:
    """
    Verify and decode JWT token
    
    Args:
        token: JWT token string
        
    Returns:
        dict: Decoded token payload
        
    Raises:
        JWTError: If token is invalid or expired
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise JWTError("Token has expired")
    except jwt.InvalidTokenError:
        raise JWTError("Invalid token")
    except Exception as e:
        logger.error(f"JWT verification error: {str(e)}")
        raise JWTError("Token verification failed")

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    Extract and validate current user from JWT token
    
    Args:
        credentials: HTTP Bearer credentials
        
    Returns:
        dict: User information from token
        
    Raises:
        HTTPException: If authentication fails
    """
    try:
        token = credentials.credentials
        payload = verify_jwt_token(token)
        
        # Extract user information
        user_id = payload.get("user_id")
        if not user_id:
            raise JWTError("Missing user_id in token")
            
        return {
            "user_id": user_id,
            "email": payload.get("email"),
            "name": payload.get("name"),
            "amazon_seller_id": payload.get("amazon_seller_id"),
            "exp": payload.get("exp")
        }
        
    except JWTError as e:
        logger.warning(f"Authentication failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"Unexpected authentication error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service error"
        )

def get_optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[dict]:
    """
    Extract user from JWT token, but don't fail if no token provided
    
    Args:
        credentials: Optional HTTP Bearer credentials
        
    Returns:
        dict or None: User information if token is valid, None otherwise
    """
    if not credentials:
        return None
        
    try:
        return get_current_user(credentials)
    except HTTPException:
        return None

def create_jwt_token(user_data: dict) -> str:
    """
    Create JWT token for user
    
    Args:
        user_data: User information to include in token
        
    Returns:
        str: JWT token
    """
    payload = {
        "user_id": user_data.get("user_id"),
        "email": user_data.get("email"),
        "name": user_data.get("name"),
        "amazon_seller_id": user_data.get("amazon_seller_id"),
        "exp": user_data.get("exp")
    }
    
    return jwt.encode(
        payload,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM
    )

def validate_user_permissions(user: dict, required_permissions: list = None) -> bool:
    """
    Validate user has required permissions
    
    Args:
        user: User information from JWT
        required_permissions: List of required permissions
        
    Returns:
        bool: True if user has permissions
    """
    if not required_permissions:
        return True
        
    user_permissions = user.get("permissions", [])
    return all(perm in user_permissions for perm in required_permissions)

# Optional helper for WebSocket auth (compatibility for imports)
async def get_current_user_websocket(websocket: WebSocket) -> Optional[dict]:
    """
    Best-effort user extraction for WebSocket connections.
    Accepts connection even if no/invalid token; returns decoded user dict if present.
    """
    try:
        auth_header = websocket.headers.get("authorization") or websocket.headers.get("Authorization")
        if not auth_header:
            return None
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
            return verify_jwt_token(token)
        return None
    except Exception:
        return None

