"""
Cost Documentation Client
"""

import httpx
from typing import Dict, Any, Optional
import logging
from src.services.service_directory import service_directory

logger = logging.getLogger(__name__)

class CostDocsClient:
    """Client for Cost Documentation service"""
    
    def __init__(self):
        self.service_name = "cost-docs"
    
    async def generate_document(self, user_id: str, evidence_data: Dict[str, Any], auto_enqueue: bool = False) -> Dict[str, Any]:
        """Generate cost documentation PDF"""
        try:
            endpoint = "/api/v1/cost-documentation/generate/auto" if auto_enqueue else "/api/v1/cost-documentation/generate/manual"
            
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                endpoint,
                json={
                    "userId": user_id,
                    "evidence": evidence_data
                }
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to generate document", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Generate document failed: {e}")
            return {"error": str(e)}
    
    async def get_document(self, user_id: str, document_id: str) -> Dict[str, Any]:
        """Get document by ID"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/cost-documentation/document/{document_id}",
                params={"userId": user_id}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get document", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get document failed: {e}")
            return {"error": str(e)}
    
    async def get_documents_by_anomaly(self, user_id: str, anomaly_id: str) -> Dict[str, Any]:
        """Get documents by anomaly ID"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/cost-documentation/anomaly/{anomaly_id}",
                params={"userId": user_id}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get documents by anomaly", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get documents by anomaly failed: {e}")
            return {"error": str(e)}
    
    async def get_documents_by_seller(self, user_id: str, seller_id: str, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        """Get documents by seller ID"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/cost-documentation/seller/{seller_id}",
                params={"userId": user_id, "limit": limit, "offset": offset}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get documents by seller", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get documents by seller failed: {e}")
            return {"error": str(e)}
    
    async def get_job_status(self, user_id: str, job_id: str) -> Dict[str, Any]:
        """Get job status"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/cost-documentation/job/{job_id}",
                params={"userId": user_id}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get job status", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get job status failed: {e}")
            return {"error": str(e)}

# Global client instance
cost_docs_client = CostDocsClient()



