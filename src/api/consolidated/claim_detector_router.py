"""
Claim Detector Router - Consolidated ML Claim Detection Service
Routes from Claim Detector Model/claim_detector service
"""

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Create router
claim_detector_router = APIRouter(prefix="/api/v1/claim-detector", tags=["Claim Detector - ML Service"])

# Pydantic models
class ClaimRequest(BaseModel):
    """Request model for claim prediction"""
    claim_id: str
    seller_id: str
    order_id: str
    category: str
    subcategory: str
    reason_code: str
    marketplace: str
    fulfillment_center: str
    amount: float
    quantity: int
    order_value: float
    shipping_cost: float
    days_since_order: int
    days_since_delivery: int
    description: str
    reason: str
    notes: Optional[str] = ""
    claim_date: str

class ClaimResponse(BaseModel):
    """Response model for claim prediction"""
    model_config = {"protected_namespaces": ()}
    
    claim_id: str
    claimable: bool
    probability: float
    confidence: float
    feature_contributions: List[Dict[str, Any]]
    model_components: Dict[str, float]
    processing_time_ms: Optional[float] = None

class BatchClaimRequest(BaseModel):
    """Request model for batch predictions"""
    claims: List[ClaimRequest]

class BatchClaimResponse(BaseModel):
    """Response model for batch predictions"""
    predictions: List[ClaimResponse]
    batch_metrics: Dict[str, Any]

class ModelInfo(BaseModel):
    """Model information response"""
    model_config = {"protected_namespaces": ()}
    
    model_version: str
    training_date: str
    feature_count: int
    model_components: List[str]
    performance_metrics: Dict[str, float]

@claim_detector_router.get("/health")
async def health_check():
    """Health check endpoint for Claim Detector."""
    return {
        "status": "healthy",
        "service": "Claim Detector",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "model_loaded": False  # TODO: Check actual model status
    }

@claim_detector_router.get("/model/info", response_model=ModelInfo)
async def get_model_info():
    """Get model information."""
    # TODO: Import actual model from claim-detector service
    return ModelInfo(
        model_version="1.0.0",
        training_date="Unknown",
        feature_count=0,
        model_components=[],
        performance_metrics={}
    )

@claim_detector_router.post("/predict", response_model=ClaimResponse)
async def predict_claim(claim: ClaimRequest):
    """Predict claimability for a single claim."""
    try:
        # TODO: Import actual model and prediction logic from claim-detector service
        # For now, return a placeholder response
        return ClaimResponse(
            claim_id=claim.claim_id,
            claimable=False,
            probability=0.5,
            confidence=0.5,
            feature_contributions=[],
            model_components={},
            processing_time_ms=0.0
        )
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

@claim_detector_router.post("/predict/batch", response_model=BatchClaimResponse)
async def predict_claims_batch(batch_request: BatchClaimRequest):
    """Predict claimability for multiple claims."""
    try:
        # TODO: Import actual batch prediction logic
        predictions = []
        for claim in batch_request.claims:
            predictions.append(ClaimResponse(
                claim_id=claim.claim_id,
                claimable=False,
                probability=0.5,
                confidence=0.5,
                feature_contributions=[],
                model_components={},
                processing_time_ms=0.0
            ))
        
        return BatchClaimResponse(
            predictions=predictions,
            batch_metrics={
                "total_claims": len(predictions),
                "claimable_count": 0,
                "avg_probability": 0.5
            }
        )
    except Exception as e:
        logger.error(f"Batch prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Batch prediction error: {str(e)}")

@claim_detector_router.get("/features/importance")
async def get_feature_importance(top_n: int = 20):
    """Get feature importance from the model."""
    # TODO: Import actual feature importance logic
    return {
        "feature_importance": [],
        "top_n": top_n
    }

