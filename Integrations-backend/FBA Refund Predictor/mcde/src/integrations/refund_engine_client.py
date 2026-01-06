"""
Refund Engine client for MCDE.
Handles bidirectional communication with the Refund Engine service.
"""
import asyncio
import json
from datetime import datetime
from typing import Dict, List, Optional, Any
import httpx
from src.logger import get_logger, log_integration_event
from src.config import settings

logger = get_logger(__name__)


class RefundEngineClient:
    """Client for communicating with the Refund Engine service."""
    
    def __init__(self):
        self.base_url = settings.refund_engine.base_url
        self.timeout = settings.refund_engine.timeout
        self.retry_attempts = settings.refund_engine.retry_attempts
        self.api_key = settings.refund_engine.api_key
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "MCDE/1.0.0"
        }
    
    async def get_cost_estimate_for_claim(
        self,
        claim_id: str,
        cost_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Get cost estimate validation from Refund Engine.
        
        Args:
            claim_id: Refund claim identifier
            cost_data: Manufacturing cost data from MCDE
            
        Returns:
            Dictionary with cost validation results
        """
        try:
            payload = {
                "claim_id": claim_id,
                "cost_data": cost_data,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/validate-cost-estimate",
                    headers=self.headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    result = response.json()
                    log_integration_event(
                        service="refund_engine",
                        event_type="cost_validation",
                        success=True,
                        details={"claim_id": claim_id, "status": "validated"}
                    )
                    return result
                else:
                    logger.error(f"Refund Engine validation failed: {response.status_code}")
                    return {"error": "Validation failed", "status_code": response.status_code}
                    
        except Exception as e:
            logger.error(f"Refund Engine communication error: {str(e)}")
            log_integration_event(
                service="refund_engine",
                event_type="cost_validation",
                success=False,
                details={"claim_id": claim_id, "error": str(e)}
            )
            return {"error": str(e)}
    
    async def request_document_generation(
        self,
        claim_id: str,
        document_type: str,
        cost_estimate: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Request document generation from Refund Engine.
        
        Args:
            claim_id: Refund claim identifier
            document_type: Type of document to generate
            cost_estimate: Cost estimation data
            
        Returns:
            Dictionary with document generation request results
        """
        try:
            payload = {
                "claim_id": claim_id,
                "document_type": document_type,
                "cost_estimate": cost_estimate,
                "requested_at": datetime.utcnow().isoformat()
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/request-document",
                    headers=self.headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    result = response.json()
                    log_integration_event(
                        service="refund_engine",
                        event_type="document_request",
                        success=True,
                        details={"claim_id": claim_id, "document_type": document_type}
                    )
                    return result
                else:
                    logger.error(f"Document request failed: {response.status_code}")
                    return {"error": "Document request failed", "status_code": response.status_code}
                    
        except Exception as e:
            logger.error(f"Document request error: {str(e)}")
            log_integration_event(
                service="refund_engine",
                event_type="document_request",
                success=False,
                details={"claim_id": claim_id, "error": str(e)}
            )
            return {"error": str(e)}
    
    async def get_claim_features(
        self,
        claim_id: str
    ) -> Dict[str, Any]:
        """
        Get claim features from Refund Engine for cost prediction.
        
        Args:
            claim_id: Refund claim identifier
            
        Returns:
            Dictionary with claim features
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/claim-features/{claim_id}",
                    headers=self.headers
                )
                
                if response.status_code == 200:
                    result = response.json()
                    log_integration_event(
                        service="refund_engine",
                        event_type="feature_retrieval",
                        success=True,
                        details={"claim_id": claim_id}
                    )
                    return result
                else:
                    logger.error(f"Feature retrieval failed: {response.status_code}")
                    return {"error": "Feature retrieval failed", "status_code": response.status_code}
                    
        except Exception as e:
            logger.error(f"Feature retrieval error: {str(e)}")
            log_integration_event(
                service="refund_engine",
                event_type="feature_retrieval",
                success=False,
                details={"claim_id": claim_id, "error": str(e)}
            )
            return {"error": str(e)}
    
    async def update_claim_with_cost_data(
        self,
        claim_id: str,
        cost_data: Dict[str, Any],
        document_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Update claim with cost data and document information.
        
        Args:
            claim_id: Refund claim identifier
            cost_data: Manufacturing cost data
            document_url: URL to generated document (optional)
            
        Returns:
            Dictionary with update results
        """
        try:
            payload = {
                "claim_id": claim_id,
                "cost_data": cost_data,
                "document_url": document_url,
                "updated_at": datetime.utcnow().isoformat()
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.put(
                    f"{self.base_url}/update-claim",
                    headers=self.headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    result = response.json()
                    log_integration_event(
                        service="refund_engine",
                        event_type="claim_update",
                        success=True,
                        details={"claim_id": claim_id}
                    )
                    return result
                else:
                    logger.error(f"Claim update failed: {response.status_code}")
                    return {"error": "Claim update failed", "status_code": response.status_code}
                    
        except Exception as e:
            logger.error(f"Claim update error: {str(e)}")
            log_integration_event(
                service="refund_engine",
                event_type="claim_update",
                success=False,
                details={"claim_id": claim_id, "error": str(e)}
            )
            return {"error": str(e)}
    
    async def get_prediction_for_claim(
        self,
        claim_id: str,
        cost_estimate: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Get refund success prediction from Refund Engine.
        
        Args:
            claim_id: Refund claim identifier
            cost_estimate: Cost estimation data
            
        Returns:
            Dictionary with prediction results
        """
        try:
            payload = {
                "claim_id": claim_id,
                "cost_estimate": cost_estimate,
                "requested_at": datetime.utcnow().isoformat()
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/predict-success",
                    headers=self.headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    result = response.json()
                    log_integration_event(
                        service="refund_engine",
                        event_type="prediction_request",
                        success=True,
                        details={"claim_id": claim_id}
                    )
                    return result
                else:
                    logger.error(f"Prediction request failed: {response.status_code}")
                    return {"error": "Prediction request failed", "status_code": response.status_code}
                    
        except Exception as e:
            logger.error(f"Prediction request error: {str(e)}")
            log_integration_event(
                service="refund_engine",
                event_type="prediction_request",
                success=False,
                details={"claim_id": claim_id, "error": str(e)}
            )
            return {"error": str(e)}
    
    async def health_check(self) -> Dict[str, Any]:
        """
        Check Refund Engine service health.
        
        Returns:
            Dictionary with health status
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/health",
                    headers=self.headers
                )
                
                if response.status_code == 200:
                    return {
                        "status": "healthy",
                        "service": "refund_engine",
                        "response_time": response.elapsed.total_seconds()
                    }
                else:
                    return {
                        "status": "unhealthy",
                        "service": "refund_engine",
                        "status_code": response.status_code
                    }
                    
        except Exception as e:
            logger.error(f"Health check failed: {str(e)}")
            return {
                "status": "unhealthy",
                "service": "refund_engine",
                "error": str(e)
            }
    
    async def store_shared_features(
        self,
        claim_id: str,
        features: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Store features in shared feature store with Refund Engine.
        
        Args:
            claim_id: Refund claim identifier
            features: Features to store
            
        Returns:
            Dictionary with storage results
        """
        try:
            payload = {
                "claim_id": claim_id,
                "features": features,
                "stored_at": datetime.utcnow().isoformat()
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/store-features",
                    headers=self.headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    result = response.json()
                    log_integration_event(
                        service="refund_engine",
                        event_type="feature_storage",
                        success=True,
                        details={"claim_id": claim_id}
                    )
                    return result
                else:
                    logger.error(f"Feature storage failed: {response.status_code}")
                    return {"error": "Feature storage failed", "status_code": response.status_code}
                    
        except Exception as e:
            logger.error(f"Feature storage error: {str(e)}")
            log_integration_event(
                service="refund_engine",
                event_type="feature_storage",
                success=False,
                details={"claim_id": claim_id, "error": str(e)}
            )
            return {"error": str(e)}


# Global client instance
refund_engine_client = RefundEngineClient() 