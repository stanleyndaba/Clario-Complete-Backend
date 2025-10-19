"""
Refund Engine Client
"""

import httpx
from typing import Dict, Any, Optional, List
import logging
from src.services.service_directory import service_directory

logger = logging.getLogger(__name__)

class RefundEngineClient:
    """Client for Refund Engine service"""
    
    def __init__(self):
        self.service_name = "refund-engine"
    
    async def create_claim(self, user_id: str, claim_data: Dict[str, Any], jwt_token: Optional[str] = None) -> Dict[str, Any]:
        """Create a new refund claim"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/v1/claims",
                json={
                    "userId": user_id,
                    **claim_data
                },
                headers={"Authorization": f"Bearer {jwt_token}"} if jwt_token else None
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to create claim", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Create claim failed: {e}")
            return {"error": str(e)}
    
    async def get_claims(self, user_id: str, status: Optional[str] = None, limit: int = 20, offset: int = 0, jwt_token: Optional[str] = None) -> Dict[str, Any]:
        """Get user's claims"""
        try:
            params = {"userId": user_id, "limit": limit, "offset": offset}
            if status:
                params["status"] = status
                
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/claims",
                params=params,
                headers={"Authorization": f"Bearer {jwt_token}"} if jwt_token else None
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get claims", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get claims failed: {e}")
            return {"error": str(e)}
    
    async def get_claim(self, user_id: str, claim_id: str, jwt_token: Optional[str] = None) -> Dict[str, Any]:
        """Get specific claim"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/claims/{claim_id}",
                params={"userId": user_id},
                headers={"Authorization": f"Bearer {jwt_token}"} if jwt_token else None
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get claim", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get claim failed: {e}")
            return {"error": str(e)}
    
    async def get_discrepancies(self, user_id: str, limit: int = 20, offset: int = 0, jwt_token: Optional[str] = None) -> Dict[str, Any]:
        """Get ML-powered discrepancy detection results"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/discrepancies",
                params={"userId": user_id, "limit": limit, "offset": offset},
                headers={"Authorization": f"Bearer {jwt_token}"} if jwt_token else None
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get discrepancies", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get discrepancies failed: {e}")
            return {"error": str(e)}
    
    async def get_ledger(self, user_id: str, limit: int = 20, offset: int = 0, jwt_token: Optional[str] = None) -> Dict[str, Any]:
        """Get ledger entries"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/ledger",
                params={"userId": user_id, "limit": limit, "offset": offset},
                headers={"Authorization": f"Bearer {jwt_token}"} if jwt_token else None
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get ledger", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get ledger failed: {e}")
            return {"error": str(e)}
    
    async def get_claim_stats(self, user_id: str, jwt_token: Optional[str] = None) -> Dict[str, Any]:
        """Get claims statistics"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/claims/stats",
                params={"userId": user_id},
                headers={"Authorization": f"Bearer {jwt_token}"} if jwt_token else None
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get claim stats", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get claim stats failed: {e}")
            return {"error": str(e)}

# Global client instance
refund_engine_client = RefundEngineClient()



