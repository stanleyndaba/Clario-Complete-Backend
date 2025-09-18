"""
WebSocket Endpoints
Phase 4: Real-time WebSocket connections for Evidence Validator
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from typing import Optional, Dict, Any
import logging
import json

from src.api.auth_middleware import get_current_user_websocket
from src.websocket.websocket_manager import websocket_manager

logger = logging.getLogger(__name__)

router = APIRouter()

@router.websocket("/ws/evidence")
async def websocket_endpoint(
    websocket: WebSocket,
    user_id: str = Query(..., description="User ID for WebSocket connection"),
    client_info: Optional[str] = Query(None, description="Client information JSON")
):
    """WebSocket endpoint for real-time Evidence Validator updates"""
    
    try:
        # Parse client info if provided
        parsed_client_info = None
        if client_info:
            try:
                parsed_client_info = json.loads(client_info)
            except json.JSONDecodeError:
                logger.warning(f"Invalid client_info JSON for user {user_id}")
        
        # Handle WebSocket connection
        await websocket_manager.handle_websocket(
            websocket=websocket,
            user_id=user_id,
            client_info=parsed_client_info
        )
        
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user_id}")
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")

@router.websocket("/ws/evidence/{claim_id}")
async def websocket_claim_endpoint(
    websocket: WebSocket,
    claim_id: str,
    user_id: str = Query(..., description="User ID for WebSocket connection"),
    client_info: Optional[str] = Query(None, description="Client information JSON")
):
    """WebSocket endpoint for real-time updates for a specific claim"""
    
    try:
        # Parse client info if provided
        parsed_client_info = None
        if client_info:
            try:
                parsed_client_info = json.loads(client_info)
            except json.JSONDecodeError:
                logger.warning(f"Invalid client_info JSON for user {user_id}")
        
        # Add claim_id to client info
        if parsed_client_info is None:
            parsed_client_info = {}
        parsed_client_info["claim_id"] = claim_id
        
        # Handle WebSocket connection
        await websocket_manager.handle_websocket(
            websocket=websocket,
            user_id=user_id,
            client_info=parsed_client_info
        )
        
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user_id} on claim {claim_id}")
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id} on claim {claim_id}: {e}")

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
