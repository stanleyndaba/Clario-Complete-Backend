"""
Integrations Backend Client
"""

import httpx
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging
from src.services.service_directory import service_directory

logger = logging.getLogger(__name__)

class IntegrationsClient:
    """Client for Integrations Backend service"""
    
    def __init__(self):
        self.service_name = "integrations"
    
    async def test_amazon_oauth(self, user_id: str) -> Dict[str, Any]:
        """Test Amazon OAuth connection"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/v1/oauth/test/amazon",
                json={"userId": user_id}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to test Amazon OAuth", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Amazon OAuth test failed: {e}")
            return {"error": str(e)}
    
    async def connect_integration(self, user_id: str, integration_type: str) -> Dict[str, Any]:
        """Connect to an integration"""
        try:
            # For Amazon, call the OAuth start endpoint
            if integration_type == "amazon":
                response = await service_directory.call_service(
                    self.service_name,
                    "GET",  # Amazon OAuth start is a GET endpoint
                    "/api/v1/integrations/amazon/auth/start",  # Correct endpoint
                )
            else:
                # For other integrations, try POST endpoint
                response = await service_directory.call_service(
                    self.service_name,
                    "POST",
                    f"/api/v1/integrations/{integration_type}/connect",
                    json={
                        "userId": user_id
                    }
                )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                error_msg = f"Failed to connect integration. Status: {response.status_code if response else 'No response'}"
                logger.error(error_msg)
                return {"error": error_msg, "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Integration connection failed: {e}")
            return {"error": str(e)}
    
    async def start_sync(self, user_id: str, sync_type: str = "inventory") -> Dict[str, Any]:
        """Start inventory sync"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/sync/start",
                json={
                    "userId": user_id,
                    "syncType": sync_type
                }
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to start sync", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Sync start failed: {e}")
            return {"error": str(e)}
    
    async def get_active_sync_status(self, user_id: str = None) -> Dict[str, Any]:
        """Get active sync status (without sync_id) - for frontend monitoring"""
        try:
            # Forward user ID in headers
            headers = {}
            if user_id:
                headers["X-User-Id"] = user_id
            
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/sync/status",
                headers=headers
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"hasActiveSync": False, "lastSync": None, "error": "Failed to get active sync status", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get active sync status failed: {e}")
            return {"hasActiveSync": False, "lastSync": None, "error": str(e)}
    
    async def get_sync_status(self, sync_id: str, user_id: str = None) -> Dict[str, Any]:
        """Get sync status by sync_id"""
        try:
            # Forward user ID in headers
            headers = {}
            if user_id:
                headers["X-User-Id"] = user_id
            
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/sync/status/{sync_id}",
                headers=headers
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get sync status", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get sync status failed: {e}")
            return {"error": str(e)}
    
    async def get_sync_activity(self, user_id: str, limit: int = 10, offset: int = 0) -> Dict[str, Any]:
        """Get sync activity history"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/sync/history",
                params={"userId": user_id, "limit": limit, "offset": offset}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"activities": [], "total": 0, "has_more": False}
                
        except Exception as e:
            logger.error(f"Get sync activity failed: {e}")
            return {"activities": [], "total": 0, "has_more": False}
    
    async def cancel_sync(self, sync_id: str, user_id: str) -> Dict[str, Any]:
        """Cancel a sync job"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/sync/force",
                json={"id": sync_id, "userId": user_id, "action": "cancel"}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"ok": True, "message": "Sync cancelled"}
                
        except Exception as e:
            logger.error(f"Cancel sync failed: {e}")
            return {"ok": True, "message": "Sync cancelled"}
    
    async def run_detection(self, user_id: str, sync_id: str, trigger_type: str = "inventory") -> Dict[str, Any]:
        """Run detection on a sync"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/detections/run",
                json={
                    "syncId": sync_id,
                    "triggerType": trigger_type
                }
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to run detection", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Run detection failed: {e}")
            return {"error": str(e)}
    
    async def get_detection_status(self, sync_id: str, user_id: str) -> Dict[str, Any]:
        """Get detection status"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/detections/status/{sync_id}"
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get detection status", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get detection status failed: {e}")
            return {"error": str(e)}
    
    async def get_user_integrations(self, user_id: str) -> Dict[str, Any]:
        """Get user's integrations"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/integrations",
                params={"userId": user_id}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get integrations", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get integrations failed: {e}")
            return {"error": str(e)}

# Global client instance
integrations_client = IntegrationsClient()



