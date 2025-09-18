"""
WebSocket Manager
Phase 4: Real-time event broadcasting for Evidence Validator
"""

import json
import asyncio
import logging
from typing import Dict, Any, Set, Optional
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect
from collections import defaultdict

logger = logging.getLogger(__name__)

class WebSocketManager:
    """Manages WebSocket connections and real-time event broadcasting"""
    
    def __init__(self):
        # Store active connections by user_id
        self.active_connections: Dict[str, Set[WebSocket]] = defaultdict(set)
        # Store connection metadata
        self.connection_metadata: Dict[WebSocket, Dict[str, Any]] = {}
        
    async def connect(self, websocket: WebSocket, user_id: str, client_info: Optional[Dict[str, Any]] = None):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        
        # Add to active connections
        self.active_connections[user_id].add(websocket)
        
        # Store connection metadata
        self.connection_metadata[websocket] = {
            "user_id": user_id,
            "connected_at": datetime.utcnow().isoformat() + "Z",
            "client_info": client_info or {}
        }
        
        logger.info(f"WebSocket connected for user {user_id}")
        
        # Send welcome message
        await self.send_to_connection(websocket, {
            "event": "connected",
            "data": {
                "message": "Connected to Evidence Validator real-time updates",
                "connected_at": datetime.utcnow().isoformat() + "Z"
            }
        })
    
    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        if websocket in self.connection_metadata:
            user_id = self.connection_metadata[websocket]["user_id"]
            
            # Remove from active connections
            self.active_connections[user_id].discard(websocket)
            
            # Clean up empty user sets
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
            
            # Remove metadata
            del self.connection_metadata[websocket]
            
            logger.info(f"WebSocket disconnected for user {user_id}")
    
    async def send_to_connection(self, websocket: WebSocket, message: Dict[str, Any]):
        """Send message to a specific WebSocket connection"""
        try:
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error(f"Failed to send message to WebSocket: {e}")
            # Remove the connection if it's broken
            self.disconnect(websocket)
    
    async def broadcast_to_user(self, user_id: str, event: str, data: Dict[str, Any]):
        """Broadcast event to all connections for a specific user"""
        if user_id in self.active_connections:
            message = {
                "event": event,
                "data": data,
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
            
            # Send to all connections for this user
            disconnected_connections = set()
            for websocket in self.active_connections[user_id]:
                try:
                    await self.send_to_connection(websocket, message)
                except Exception as e:
                    logger.error(f"Failed to broadcast to user {user_id}: {e}")
                    disconnected_connections.add(websocket)
            
            # Clean up disconnected connections
            for websocket in disconnected_connections:
                self.disconnect(websocket)
    
    async def broadcast_to_all(self, event: str, data: Dict[str, Any]):
        """Broadcast event to all connected users"""
        message = {
            "event": event,
            "data": data,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        
        # Send to all users
        for user_id in list(self.active_connections.keys()):
            await self.broadcast_to_user(user_id, event, data)
    
    async def send_heartbeat(self, websocket: WebSocket):
        """Send heartbeat to keep connection alive"""
        try:
            await self.send_to_connection(websocket, {
                "event": "heartbeat",
                "data": {
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
            })
        except Exception as e:
            logger.error(f"Failed to send heartbeat: {e}")
            self.disconnect(websocket)
    
    async def start_heartbeat_scheduler(self):
        """Start background task for sending heartbeats"""
        while True:
            try:
                await asyncio.sleep(30)  # Send heartbeat every 30 seconds
                
                # Send heartbeat to all connections
                for user_id, connections in list(self.active_connections.items()):
                    for websocket in list(connections):
                        await self.send_heartbeat(websocket)
                        
            except Exception as e:
                logger.error(f"Heartbeat scheduler error: {e}")
    
    def get_connection_count(self) -> int:
        """Get total number of active connections"""
        return sum(len(connections) for connections in self.active_connections.values())
    
    def get_user_connection_count(self, user_id: str) -> int:
        """Get number of connections for a specific user"""
        return len(self.active_connections.get(user_id, set()))
    
    def get_connected_users(self) -> Set[str]:
        """Get set of all connected user IDs"""
        return set(self.active_connections.keys())
    
    async def handle_websocket(self, websocket: WebSocket, user_id: str, client_info: Optional[Dict[str, Any]] = None):
        """Handle WebSocket connection lifecycle"""
        await self.connect(websocket, user_id, client_info)
        
        try:
            while True:
                # Wait for messages from client
                data = await websocket.receive_text()
                message = json.loads(data)
                
                # Handle different message types
                await self._handle_client_message(websocket, user_id, message)
                
        except WebSocketDisconnect:
            self.disconnect(websocket)
        except Exception as e:
            logger.error(f"WebSocket error for user {user_id}: {e}")
            self.disconnect(websocket)
    
    async def _handle_client_message(self, websocket: WebSocket, user_id: str, message: Dict[str, Any]):
        """Handle messages received from client"""
        try:
            message_type = message.get("type", "unknown")
            
            if message_type == "ping":
                # Respond to ping with pong
                await self.send_to_connection(websocket, {
                    "event": "pong",
                    "data": {
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }
                })
            
            elif message_type == "subscribe":
                # Handle subscription to specific events
                events = message.get("events", [])
                # Store subscription preferences in connection metadata
                if websocket in self.connection_metadata:
                    self.connection_metadata[websocket]["subscribed_events"] = events
                
                await self.send_to_connection(websocket, {
                    "event": "subscribed",
                    "data": {
                        "events": events,
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }
                })
            
            elif message_type == "unsubscribe":
                # Handle unsubscription from events
                events = message.get("events", [])
                if websocket in self.connection_metadata:
                    current_events = self.connection_metadata[websocket].get("subscribed_events", [])
                    self.connection_metadata[websocket]["subscribed_events"] = [
                        e for e in current_events if e not in events
                    ]
                
                await self.send_to_connection(websocket, {
                    "event": "unsubscribed",
                    "data": {
                        "events": events,
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }
                })
            
            else:
                # Unknown message type
                await self.send_to_connection(websocket, {
                    "event": "error",
                    "data": {
                        "message": f"Unknown message type: {message_type}",
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }
                })
                
        except Exception as e:
            logger.error(f"Failed to handle client message: {e}")
            await self.send_to_connection(websocket, {
                "event": "error",
                "data": {
                    "message": "Failed to process message",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
            })
    
    async def broadcast_prompt_event(
        self, 
        user_id: str, 
        event_type: str, 
        prompt_id: str, 
        claim_id: str, 
        data: Dict[str, Any]
    ):
        """Broadcast prompt-related events"""
        await self.broadcast_to_user(user_id, event_type, {
            "prompt_id": prompt_id,
            "claim_id": claim_id,
            **data
        })
    
    async def broadcast_packet_event(
        self, 
        user_id: str, 
        event_type: str, 
        claim_id: str, 
        data: Dict[str, Any]
    ):
        """Broadcast proof packet events"""
        await self.broadcast_to_user(user_id, event_type, {
            "claim_id": claim_id,
            **data
        })
    
    async def broadcast_audit_event(
        self, 
        user_id: str, 
        event_type: str, 
        claim_id: str, 
        data: Dict[str, Any]
    ):
        """Broadcast audit events"""
        await self.broadcast_to_user(user_id, event_type, {
            "claim_id": claim_id,
            **data
        })

# Global instance
websocket_manager = WebSocketManager()
