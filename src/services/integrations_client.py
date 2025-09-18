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



