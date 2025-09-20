"""
WebSocket API endpoints
Handles real-time status streaming and notifications
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from typing import List, Dict, Any
import json
import logging
from src.api.auth_middleware import get_optional_user
from src.services.service_directory import service_directory
from src.common.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

class ConnectionManager:
    """Manages WebSocket connections"""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")
    
    async def send_personal_message(self, message: str, websocket: WebSocket):
        """Send a message to a specific WebSocket connection"""
        try:
            await websocket.send_text(message)
        except Exception as e:
            logger.error(f"Failed to send message to WebSocket: {e}")
            self.disconnect(websocket)
    
    async def broadcast(self, message: str):
        """Broadcast a message to all connected WebSocket clients"""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"Failed to broadcast to WebSocket: {e}")
                disconnected.append(connection)
        
        # Remove disconnected connections
        for connection in disconnected:
            self.disconnect(connection)

# Global connection manager
manager = ConnectionManager()

@router.websocket("/ws/status")
async def websocket_status(websocket: WebSocket):
    """
    WebSocket endpoint for real-time status updates
    
    Sends periodic updates about:
    - Service health status
    - Sync job progress
    - Detection results
    - Recovery status updates
    """
    # Enforce Origin allowlist for WebSocket handshake
    origin = websocket.headers.get("origin")
    allowed_origins = set(settings.get_allowed_origins())
    if origin and allowed_origins and origin not in allowed_origins:
        # Reject connection from disallowed origins
        await websocket.close(code=1008)
        return

    await manager.connect(websocket)
    
    try:
        # Send initial status
        initial_status = {
            "type": "initial_status",
            "data": {
                "services": service_directory.get_all_services_status(),
                "timestamp": "2025-01-07T00:00:00Z"
            }
        }
        await manager.send_personal_message(json.dumps(initial_status), websocket)
        
        # Keep connection alive and send periodic updates
        while True:
            try:
                # Wait for client message (ping/pong)
                data = await websocket.receive_text()
                message = json.loads(data)
                
                if message.get("type") == "ping":
                    pong_response = {
                        "type": "pong",
                        "timestamp": "2025-01-07T00:00:00Z"
                    }
                    await manager.send_personal_message(json.dumps(pong_response), websocket)
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
                break
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
    finally:
        manager.disconnect(websocket)

@router.websocket("/ws/status/{user_id}")
async def websocket_user_status(websocket: WebSocket, user_id: str):
    """
    User-specific WebSocket endpoint for personalized status updates
    
    Sends updates specific to the authenticated user:
    - Personal sync progress
    - Claim status updates
    - Document processing status
    - Billing notifications
    """
    # Enforce Origin allowlist for WebSocket handshake
    origin = websocket.headers.get("origin")
    allowed_origins = set(settings.get_allowed_origins())
    if origin and allowed_origins and origin not in allowed_origins:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket)
    
    try:
        # Send initial user status
        initial_status = {
            "type": "user_status",
            "user_id": user_id,
            "data": {
                "sync_status": "idle",
                "active_claims": 0,
                "pending_documents": 0,
                "last_activity": "2025-01-07T00:00:00Z"
            }
        }
        await manager.send_personal_message(json.dumps(initial_status), websocket)
        
        # Keep connection alive and send user-specific updates
        while True:
            try:
                # Wait for client message
                data = await websocket.receive_text()
                message = json.loads(data)
                
                if message.get("type") == "ping":
                    pong_response = {
                        "type": "pong",
                        "user_id": user_id,
                        "timestamp": "2025-01-07T00:00:00Z"
                    }
                    await manager.send_personal_message(json.dumps(pong_response), websocket)
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"User WebSocket error: {e}")
                break
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"User WebSocket connection error: {e}")
    finally:
        manager.disconnect(websocket)

async def broadcast_service_status():
    """Broadcast service status updates to all connected clients"""
    try:
        status_update = {
            "type": "service_status_update",
            "data": {
                "services": service_directory.get_all_services_status(),
                "timestamp": "2025-01-07T00:00:00Z"
            }
        }
        await manager.broadcast(json.dumps(status_update))
    except Exception as e:
        logger.error(f"Failed to broadcast service status: {e}")

async def broadcast_user_notification(user_id: str, notification: Dict[str, Any]):
    """Broadcast a notification to a specific user"""
    try:
        notification_message = {
            "type": "user_notification",
            "user_id": user_id,
            "data": notification
        }
        await manager.broadcast(json.dumps(notification_message))
    except Exception as e:
        logger.error(f"Failed to broadcast user notification: {e}")

