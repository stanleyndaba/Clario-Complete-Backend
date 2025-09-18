"""
Real-time Event System
Handles WebSocket and SSE events for zero-effort evidence loop
"""

import asyncio
import json
import uuid
from typing import Dict, Any, List, Optional, Callable
from datetime import datetime
import logging
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

class ConnectionManager:
    """Manages WebSocket connections for real-time events"""
    
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.event_handlers: List[Callable] = []
    
    async def connect(self, websocket: WebSocket, user_id: str):
        """Accept a WebSocket connection for a user"""
        await websocket.accept()
        
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        
        self.active_connections[user_id].append(websocket)
        logger.info(f"WebSocket connected for user {user_id}")
    
    def disconnect(self, websocket: WebSocket, user_id: str):
        """Remove a WebSocket connection"""
        if user_id in self.active_connections:
            try:
                self.active_connections[user_id].remove(websocket)
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
                logger.info(f"WebSocket disconnected for user {user_id}")
            except ValueError:
                pass
    
    async def send_personal_message(self, message: str, user_id: str):
        """Send a message to a specific user"""
        if user_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_text(message)
                except:
                    disconnected.append(connection)
            
            # Remove disconnected connections
            for connection in disconnected:
                self.active_connections[user_id].remove(connection)
    
    async def broadcast_to_user(self, user_id: str, event_type: str, data: Dict[str, Any]):
        """Broadcast an event to a specific user"""
        message = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        
        await self.send_personal_message(json.dumps(message), user_id)
    
    async def broadcast_to_all(self, event_type: str, data: Dict[str, Any]):
        """Broadcast an event to all connected users"""
        message = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        
        for user_id, connections in self.active_connections.items():
            await self.send_personal_message(json.dumps(message), user_id)

class EventSystem:
    """Central event system for zero-effort evidence loop"""
    
    def __init__(self):
        self.connection_manager = ConnectionManager()
        self.event_handlers: Dict[str, List[Callable]] = {}
        self.sse_connections: Dict[str, List[Any]] = {}
    
    def register_handler(self, event_type: str, handler: Callable):
        """Register an event handler"""
        if event_type not in self.event_handlers:
            self.event_handlers[event_type] = []
        self.event_handlers[event_type].append(handler)
    
    async def emit_event(self, event_type: str, data: Dict[str, Any], user_id: Optional[str] = None):
        """Emit an event to registered handlers and connected clients"""
        event = {
            "id": str(uuid.uuid4()),
            "type": event_type,
            "data": data,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        
        # Call registered handlers
        if event_type in self.event_handlers:
            for handler in self.event_handlers[event_type]:
                try:
                    await handler(event)
                except Exception as e:
                    logger.error(f"Event handler error for {event_type}: {e}")
        
        # Send to WebSocket connections
        if user_id:
            await self.connection_manager.broadcast_to_user(user_id, event_type, data)
        else:
            await self.connection_manager.broadcast_to_all(event_type, data)
        
        # Send to SSE connections
        await self._send_to_sse_connections(event, user_id)
    
    async def _send_to_sse_connections(self, event: Dict[str, Any], user_id: Optional[str] = None):
        """Send event to SSE connections"""
        if user_id and user_id in self.sse_connections:
            for connection in self.sse_connections[user_id]:
                try:
                    await connection.put(event)
                except:
                    # Remove dead connections
                    self.sse_connections[user_id].remove(connection)
    
    async def create_sse_connection(self, user_id: str):
        """Create a Server-Sent Events connection for a user"""
        if user_id not in self.sse_connections:
            self.sse_connections[user_id] = []
        
        queue = asyncio.Queue()
        self.sse_connections[user_id].append(queue)
        
        return queue
    
    def remove_sse_connection(self, user_id: str, queue: asyncio.Queue):
        """Remove an SSE connection"""
        if user_id in self.sse_connections:
            try:
                self.sse_connections[user_id].remove(queue)
            except ValueError:
                pass
    
    async def get_websocket_endpoint(self, websocket: WebSocket, user_id: str):
        """WebSocket endpoint for real-time events"""
        await self.connection_manager.connect(websocket, user_id)
        try:
            while True:
                # Keep connection alive and handle incoming messages
                data = await websocket.receive_text()
                try:
                    message = json.loads(data)
                    await self._handle_websocket_message(websocket, user_id, message)
                except json.JSONDecodeError:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Invalid JSON"
                    }))
        except WebSocketDisconnect:
            self.connection_manager.disconnect(websocket, user_id)
    
    async def _handle_websocket_message(self, websocket: WebSocket, user_id: str, message: Dict[str, Any]):
        """Handle incoming WebSocket messages"""
        message_type = message.get("type")
        
        if message_type == "ping":
            await websocket.send_text(json.dumps({"type": "pong"}))
        elif message_type == "subscribe":
            # Handle subscription to specific event types
            event_types = message.get("event_types", [])
            # Implementation would depend on specific requirements
            await websocket.send_text(json.dumps({
                "type": "subscribed",
                "event_types": event_types
            }))
        else:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": f"Unknown message type: {message_type}"
            }))
    
    async def get_sse_endpoint(self, user_id: str):
        """Server-Sent Events endpoint for real-time events"""
        queue = await self.create_sse_connection(user_id)
        
        async def event_generator():
            try:
                while True:
                    # Wait for events
                    event = await queue.get()
                    yield f"data: {json.dumps(event)}\n\n"
            except asyncio.CancelledError:
                self.remove_sse_connection(user_id, queue)
                raise
        
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Cache-Control"
            }
        )

# Global event system instance
event_system = EventSystem()

# Event types for zero-effort evidence loop
EVENT_TYPES = {
    "PROMPT_CREATED": "prompt_created",
    "PROMPT_ANSWERED": "prompt_answered", 
    "PROMPT_DISMISSED": "prompt_dismissed",
    "PROMPT_EXPIRED": "prompt_expired",
    "PROMPT_EXPIRING_SOON": "prompt_expiring_soon",
    "AUTO_SUBMIT_TRIGGERED": "auto_submit_triggered",
    "AUTO_SUBMIT_SUCCESS": "auto_submit_success",
    "AUTO_SUBMIT_FAILED": "auto_submit_failed",
    "PROOF_PACKET_READY": "proof_packet_ready",
    "EVIDENCE_MATCHED": "evidence_matched",
    "DISPUTE_STATUS_UPDATED": "dispute_status_updated"
}

# Event handlers for zero-effort evidence loop
async def handle_prompt_created(event: Dict[str, Any]):
    """Handle prompt created event"""
    logger.info(f"Smart prompt created: {event['data']['prompt_id']}")

async def handle_prompt_answered(event: Dict[str, Any]):
    """Handle prompt answered event"""
    logger.info(f"Smart prompt answered: {event['data']['prompt_id']}")

async def handle_auto_submit_triggered(event: Dict[str, Any]):
    """Handle auto-submit triggered event"""
    logger.info(f"Auto-submit triggered: {event['data']['dispute_id']}")

async def handle_proof_packet_ready(event: Dict[str, Any]):
    """Handle proof packet ready event"""
    logger.info(f"Proof packet ready: {event['data']['packet_id']}")

# Register event handlers
event_system.register_handler(EVENT_TYPES["PROMPT_CREATED"], handle_prompt_created)
event_system.register_handler(EVENT_TYPES["PROMPT_ANSWERED"], handle_prompt_answered)
event_system.register_handler(EVENT_TYPES["AUTO_SUBMIT_TRIGGERED"], handle_auto_submit_triggered)
event_system.register_handler(EVENT_TYPES["PROOF_PACKET_READY"], handle_proof_packet_ready)

