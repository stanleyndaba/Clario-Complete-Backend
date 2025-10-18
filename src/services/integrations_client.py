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
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/v1/integrations",
                json={
                    "userId": user_id,
                    "type": integration_type
                }
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to connect integration", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Integration connection failed: {e}")
            return {"error": str(e)}
    
    async def start_sync(self, user_id: str, sync_type: str = "inventory") -> Dict[str, Any]:
        """Start inventory sync"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/v1/sync/start",
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
    
    async def get_sync_status(self, user_id: str, sync_id: str) -> Dict[str, Any]:
        """Get sync status"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/sync/status/{sync_id}",
                params={"userId": user_id}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get sync status", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get sync status failed: {e}")
            return {"error": str(e)}
    
    async def get_sync_activity(self, user_id: str, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        """Get recent sync activities"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/sync/activity",
                params={"userId": user_id, "limit": limit, "offset": offset}
            )
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get sync activity", "status_code": response.status_code if response else None}
        except Exception as e:
            logger.error(f"Get sync activity failed: {e}")
            return {"error": str(e)}

    async def cancel_sync(self, sync_id: str, user_id: str) -> Dict[str, Any]:
        """Cancel a running sync job"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                f"/api/v1/sync/{sync_id}/cancel",
                json={"userId": user_id}
            )
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to cancel sync", "status_code": response.status_code if response else None}
        except Exception as e:
            logger.error(f"Cancel sync failed: {e}")
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

    async def create_notification(self, jwt_token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Create notification via Integrations service (email + in-app)."""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/notifications",
                headers={
                    "Authorization": f"Bearer {jwt_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if response and response.status_code in (200, 201):
                return response.json()
            else:
                return {"error": "Failed to create notification", "status_code": response.status_code if response else None}
        except Exception as e:
            logger.error(f"Create notification failed: {e}")
            return {"error": str(e)}

# Global client instance
integrations_client = IntegrationsClient()



