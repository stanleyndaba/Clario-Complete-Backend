"""
Refund Engine Client
"""

import httpx
from typing import Dict, Any, Optional, List
import logging
from src.services.service_directory import service_directory
from src.services.mock_clients import mock_refund_engine

logger = logging.getLogger(__name__)

class RefundEngineClient:
    """Client for Refund Engine service"""
    
    def __init__(self):
        self.service_name = "refund-engine"
    
    async def create_claim(self, user_id: str, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new refund claim"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/v1/claims",
                json={
                    "userId": user_id,
                    **claim_data
                }
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to create claim", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Create claim failed: {e}")
            return {"error": str(e)}
    
    async def get_claims(self, user_id: str, status: Optional[str] = None, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        """Get user's claims"""
        try:
            params = {"userId": user_id, "limit": limit, "offset": offset}
            if status:
                params["status"] = status
                
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/claims",
                params=params
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                logger.warning(f"Refund engine unavailable, using mock data for user {user_id}")
                return await mock_refund_engine.get_claims(user_id, status, limit, offset)
                
        except Exception as e:
            logger.warning(f"Refund engine failed, using mock data: {e}")
            return await mock_refund_engine.get_claims(user_id, status, limit, offset)
    
    async def get_claim(self, user_id: str, claim_id: str) -> Dict[str, Any]:
        """Get specific claim"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/claims/{claim_id}",
                params={"userId": user_id}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                logger.warning(f"Refund engine unavailable, using mock data for claim {claim_id}")
                return await mock_refund_engine.get_claim(user_id, claim_id)
                
        except Exception as e:
            logger.warning(f"Refund engine failed, using mock data: {e}")
            return await mock_refund_engine.get_claim(user_id, claim_id)
    
    async def get_discrepancies(self, user_id: str, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        """Get ML-powered discrepancy detection results"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/discrepancies",
                params={"userId": user_id, "limit": limit, "offset": offset}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get discrepancies", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get discrepancies failed: {e}")
            return {"error": str(e)}
    
    async def get_ledger(self, user_id: str, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        """Get ledger entries"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/ledger",
                params={"userId": user_id, "limit": limit, "offset": offset}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get ledger", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get ledger failed: {e}")
            return {"error": str(e)}
    
    async def get_claim_stats(self, user_id: str) -> Dict[str, Any]:
        """Get claims statistics"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                "/api/v1/claims/stats",
                params={"userId": user_id}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                logger.warning(f"Refund engine unavailable, using mock data for user {user_id}")
                return await mock_refund_engine.get_claim_stats(user_id)
                
        except Exception as e:
            logger.warning(f"Refund engine failed, using mock data: {e}")
            return await mock_refund_engine.get_claim_stats(user_id)

# Global client instance
refund_engine_client = RefundEngineClient()



