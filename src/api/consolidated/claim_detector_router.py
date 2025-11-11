"""
Claim Detector Router - Consolidated ML Claim Detection Service
Routes from Claim Detector Model/claim_detector service
"""

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import logging
from datetime import datetime
import time

# Import heuristic scorer
from .heuristic_scorer import score_claim, score_claims_batch, HeuristicScorer

logger = logging.getLogger(__name__)

# Initialize scorer
_scorer = HeuristicScorer()

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
        "model_loaded": True,
        "model_type": "heuristic_scorer",
        "model_version": "1.0.0"
    }

@claim_detector_router.get("/model/info", response_model=ModelInfo)
async def get_model_info():
    """Get model information."""
    return ModelInfo(
        model_version="1.0.0",
        training_date=datetime.utcnow().isoformat(),
        feature_count=7,  # reason_code, category, recency, financial_ratio, logistics, quantity, keywords
        model_components=[
            "reason_code_scoring",
            "category_scoring",
            "recency_scoring",
            "financial_ratio_scoring",
            "logistics_metadata_scoring",
            "quantity_scoring",
            "keyword_signals_scoring"
        ],
        performance_metrics={
            "heuristic_accuracy": 0.75,  # Estimated based on rule-based scoring
            "confidence_threshold": 0.5
        }
    )

@claim_detector_router.post("/predict", response_model=ClaimResponse)
async def predict_claim(claim: ClaimRequest):
    """Predict claimability for a single claim using heuristic scoring."""
    try:
        start_time = time.time()
        
        # Convert request to dict for scoring
        claim_dict = {
            'claim_id': claim.claim_id,
            'reason_code': claim.reason_code,
            'category': claim.category,
            'subcategory': claim.subcategory,
            'marketplace': claim.marketplace,
            'fulfillment_center': claim.fulfillment_center,
            'amount': claim.amount,
            'quantity': claim.quantity,
            'order_value': claim.order_value,
            'shipping_cost': claim.shipping_cost,
            'days_since_order': claim.days_since_order,
            'days_since_delivery': claim.days_since_delivery,
            'description': claim.description,
            'reason': claim.reason,
            'notes': claim.notes,
            'order_id': claim.order_id
        }
        
        # Score the claim using heuristic scorer
        result = score_claim(claim_dict)
        
        processing_time_ms = (time.time() - start_time) * 1000
        
        return ClaimResponse(
            claim_id=result['claim_id'],
            claimable=result['claimable'],
            probability=result['probability'],
            confidence=result['confidence'],
            feature_contributions=result['feature_contributions'],
            model_components=result['model_components'],
            processing_time_ms=processing_time_ms
        )
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

@claim_detector_router.post("/predict/batch", response_model=BatchClaimResponse)
async def predict_claims_batch(batch_request: BatchClaimRequest):
    """Predict claimability for multiple claims using heuristic scoring."""
    try:
        start_time = time.time()
        
        # Convert requests to dicts for scoring
        claims = []
        for claim in batch_request.claims:
            claim_dict = {
                'claim_id': claim.claim_id,
                'reason_code': claim.reason_code,
                'category': claim.category,
                'subcategory': claim.subcategory,
                'marketplace': claim.marketplace,
                'fulfillment_center': claim.fulfillment_center,
                'amount': claim.amount,
                'quantity': claim.quantity,
                'order_value': claim.order_value,
                'shipping_cost': claim.shipping_cost,
                'days_since_order': claim.days_since_order,
                'days_since_delivery': claim.days_since_delivery,
                'description': claim.description,
                'reason': claim.reason,
                'notes': claim.notes,
                'order_id': claim.order_id
            }
            claims.append(claim_dict)
        
        # Score all claims using heuristic scorer
        result = score_claims_batch(claims)
        
        # Convert to ClaimResponse objects
        predictions = []
        for pred in result['predictions']:
            predictions.append(ClaimResponse(
                claim_id=pred['claim_id'],
                claimable=pred['claimable'],
                probability=pred['probability'],
                confidence=pred['confidence'],
                feature_contributions=pred['feature_contributions'],
                model_components=pred['model_components'],
                processing_time_ms=pred['processing_time_ms']
            ))
        
        # Add high_confidence_count to batch metrics
        batch_metrics = result['batch_metrics'].copy()
        batch_metrics['high_confidence_count'] = batch_metrics.get('high_confidence_count', 0)
        
        return BatchClaimResponse(
            predictions=predictions,
            batch_metrics=batch_metrics
        )
    except Exception as e:
        logger.error(f"Batch prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Batch prediction error: {str(e)}")

@claim_detector_router.get("/features/importance")
async def get_feature_importance(top_n: int = 20):
    """Get feature importance from the heuristic model."""
    return {
        "feature_importance": [
            {"feature": "reason_code", "importance": 0.25, "description": "Reason code weight"},
            {"feature": "category", "importance": 0.20, "description": "Category weight"},
            {"feature": "recency", "importance": 0.15, "description": "Days since order/delivery"},
            {"feature": "financial_ratio", "importance": 0.15, "description": "Amount to order value ratio"},
            {"feature": "logistics_metadata", "importance": 0.10, "description": "Marketplace and fulfillment center"},
            {"feature": "quantity", "importance": 0.05, "description": "Claim quantity"},
            {"feature": "keyword_signals", "importance": 0.10, "description": "Keyword patterns in description"}
        ][:top_n],
        "top_n": min(top_n, 7),
        "model_type": "heuristic_scorer"
    }

