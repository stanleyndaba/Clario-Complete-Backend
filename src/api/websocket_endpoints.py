"""
WebSocket Endpoints
Phase 4: Real-time WebSocket connections for Evidence Validator
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import Optional, Dict, Any
import logging
import json

from src.api.auth_middleware import verify_jwt_token
from src.websocket.websocket_manager import websocket_manager

logger = logging.getLogger(__name__)

router = APIRouter()

@router.websocket("/ws/evidence")
async def websocket_endpoint(
    websocket: WebSocket,
    client_info: Optional[str] = Query(None, description="Client information JSON")
):
    """WebSocket endpoint for real-time Evidence Validator updates

    Requires Bearer JWT. The `user_id` is derived from the token.
    """
    try:
        # Enforce Bearer token on WebSocket handshake
        auth_header = websocket.headers.get("authorization") if hasattr(websocket, "headers") else None
        if not auth_header or not auth_header.lower().startswith("bearer "):
            await websocket.close(code=1008)
            return

        token = auth_header.split(" ", 1)[1]
        try:
            payload = verify_jwt_token(token)
            user_id = payload.get("user_id") or payload.get("id")
            if not user_id:
                await websocket.close(code=1008)
                return
        except Exception:
            await websocket.close(code=1008)
            return

        # Parse client info if provided
        parsed_client_info = None
        if client_info:
            try:
                parsed_client_info = json.loads(client_info)
            except json.JSONDecodeError:
                logger.warning("Invalid client_info JSON for WebSocket connection")

        # Handle WebSocket connection
        await websocket_manager.handle_websocket(
            websocket=websocket,
            user_id=user_id,
            client_info=parsed_client_info
        )

    except WebSocketDisconnect:
        # No user id available here reliably on disconnect
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")

@router.websocket("/ws/evidence/{claim_id}")
async def websocket_claim_endpoint(
    websocket: WebSocket,
    claim_id: str,
    client_info: Optional[str] = Query(None, description="Client information JSON")
):
    """WebSocket endpoint for real-time updates for a specific claim

    Requires Bearer JWT. The `user_id` is derived from the token.
    """
    try:
        # Enforce Bearer token on WebSocket handshake
        auth_header = websocket.headers.get("authorization") if hasattr(websocket, "headers") else None
        if not auth_header or not auth_header.lower().startswith("bearer "):
            await websocket.close(code=1008)
            return

        token = auth_header.split(" ", 1)[1]
        try:
            payload = verify_jwt_token(token)
            user_id = payload.get("user_id") or payload.get("id")
            if not user_id:
                await websocket.close(code=1008)
                return
        except Exception:
            await websocket.close(code=1008)
            return

        # Parse client info if provided
        parsed_client_info = {}
        if client_info:
            try:
                parsed_client_info = json.loads(client_info) if isinstance(json.loads(client_info), dict) else {}
            except Exception:
                logger.warning("Invalid client_info JSON for claim WebSocket connection")
        parsed_client_info["claim_id"] = claim_id

        # Handle WebSocket connection
        await websocket_manager.handle_websocket(
            websocket=websocket,
            user_id=user_id,
            client_info=parsed_client_info
        )

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for claim {claim_id}")
    except Exception as e:
        logger.error(f"WebSocket error for claim {claim_id}: {e}")

@router.get("/api/v1/websocket/status")
async def get_websocket_status():
    """Get WebSocket connection status"""
    
    try:
        return {
            "ok": True,
            "data": {
                "total_connections": websocket_manager.get_connection_count(),
                "connected_users": list(websocket_manager.get_connected_users()),
                "status": "active"
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get WebSocket status: {e}")
        return {
            "ok": False,
            "error": "Failed to get WebSocket status"
        }

@router.get("/api/v1/websocket/users/{user_id}/status")
async def get_user_websocket_status(user_id: str):
    """Get WebSocket status for a specific user"""
    
    try:
        connection_count = websocket_manager.get_user_connection_count(user_id)
        
        return {
            "ok": True,
            "data": {
                "user_id": user_id,
                "connection_count": connection_count,
                "is_connected": connection_count > 0
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get user WebSocket status: {e}")
        return {
            "ok": False,
            "error": "Failed to get user WebSocket status"
        }
