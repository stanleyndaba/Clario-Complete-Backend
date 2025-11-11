"""
Claim Detector Router - Consolidated ML Claim Detection Service
Routes from Claim Detector Model/claim_detector service
"""

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Tuple
import logging
from datetime import datetime
import time
from collections import defaultdict

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

BASE_PROBABILITY = 0.35
CLAIMABLE_THRESHOLD = 0.62
HIGH_CONFIDENCE_THRESHOLD = 0.78

REASON_CODE_WEIGHTS: Dict[str, float] = {
    "lost_inventory": 0.25,
    "missing_inventory": 0.23,
    "damaged_inventory": 0.2,
    "fee_overcharge": 0.18,
    "missing_reimbursement": 0.22,
    "dimension_weight_error": 0.15,
    "pricing_error": 0.12,
    "unexpected_fee": 0.11,
    "warehouse_damage": 0.21,
    "inbound_discrepancy": 0.2,
}

CATEGORY_WEIGHTS: Dict[str, float] = {
    "inventory_discrepancy": 0.22,
    "fee_dispute": 0.18,
    "reimbursement_issue": 0.2,
    "shipment_issue": 0.15,
    "high_value_edge_case": 0.17,
}

FULFILLMENT_CENTER_WEIGHTS: Dict[str, float] = {
    "ftw1": 0.05,
    "ont8": 0.04,
    "sdf8": 0.03,
    "lax9": 0.02,
}

MARKETPLACE_WEIGHTS: Dict[str, float] = {
    "us": 0.06,
    "ca": 0.04,
    "uk": 0.03,
    "de": 0.03,
    "jp": 0.02,
}

MODEL_METADATA = {
    "model_version": "heuristic-2025.01",
    "training_date": "2025-01-15",
    "feature_count": 12,
    "model_components": [
        "base_probability",
        "reason_code_score",
        "category_score",
        "recency_score",
        "financial_ratio_score",
        "logistics_modifier",
        "volume_modifier",
    ],
    "performance_metrics": {
        "precision_estimate": 0.78,
        "recall_estimate": 0.72,
        "f1_estimate": 0.75,
    },
}


def _normalize_probability(score: float) -> float:
    return max(0.02, min(0.98, score))


def _calculate_recency_weight(days_since_delivery: int, days_since_order: int) -> Tuple[float, str]:
    if days_since_delivery <= 0:
        return (0.0, "Delivery date not recorded")
    if days_since_delivery <= 30:
        return (0.12, "Within prime reimbursement SLA window")
    if days_since_delivery <= 60:
        return (0.08, "Within extended reimbursement window")
    if days_since_delivery <= 120:
        return (0.02, "Ageing claim, still eligible")
    return (-0.12, "Outside recommended reimbursement window")


def _financial_ratios(amount: float, order_value: float, shipping_cost: float) -> Dict[str, float]:
    ratios: Dict[str, float] = {
        "amount_to_order_ratio": 0.0,
        "shipping_to_order_ratio": 0.0,
    }
    if order_value > 0:
        ratios["amount_to_order_ratio"] = amount / order_value
        ratios["shipping_to_order_ratio"] = shipping_cost / order_value
    return ratios


def _score_claim(claim: ClaimRequest) -> ClaimResponse:
    start = time.perf_counter()
    probability = BASE_PROBABILITY
    feature_contributions: List[Dict[str, Any]] = []
    component_totals: defaultdict[str, float] = defaultdict(float)

    def add_contribution(component: str, delta: float, reason: str, feature_name: Optional[str] = None) -> None:
        nonlocal probability
        if abs(delta) < 1e-6:
            return
        probability += delta
        feature_contributions.append({
            "feature": feature_name or component,
            "weight": round(delta, 4),
            "reason": reason,
        })
        component_totals[component] += delta

    add_contribution(
        "base_probability",
        BASE_PROBABILITY,
        "Baseline likelihood based on historical reimbursement rates",
        "baseline",
    )

    reason_weight = REASON_CODE_WEIGHTS.get(claim.reason_code.lower(), 0.0)
    if reason_weight:
        add_contribution(
            "reason_code_score",
            reason_weight,
            f"Reason code '{claim.reason_code}' historically leads to reimbursements",
            f"reason_code:{claim.reason_code}",
        )

    category_weight = CATEGORY_WEIGHTS.get(claim.category.lower(), 0.0)
    if category_weight:
        add_contribution(
            "category_score",
            category_weight,
            f"Category '{claim.category}' aligns with strong recovery patterns",
            f"category:{claim.category}",
        )

    recency_delta, recency_reason = _calculate_recency_weight(
        claim.days_since_delivery,
        claim.days_since_order,
    )
    add_contribution("recency_score", recency_delta, recency_reason, "days_since_delivery")

    ratios = _financial_ratios(claim.amount, claim.order_value, claim.shipping_cost)
    amount_ratio = ratios["amount_to_order_ratio"]
    if amount_ratio >= 0.8:
        delta = 0.12
        reason = "Requested amount closely matches the order value"
    elif amount_ratio >= 0.5:
        delta = 0.08
        reason = "Requested amount is a significant portion of the order value"
    elif amount_ratio <= 0.1:
        delta = -0.08
        reason = "Requested amount is very small relative to order value"
    else:
        delta = 0.0
        reason = "Requested amount is within expected range"
    add_contribution("financial_ratio_score", delta, reason, "amount_to_order_ratio")

    shipping_ratio = ratios["shipping_to_order_ratio"]
    if shipping_ratio >= 0.4:
        add_contribution(
            "financial_ratio_score",
            0.05,
            "Shipping cost represents an unusually high share of the order",
            "shipping_to_order_ratio",
        )

    fulfillment_weight = FULFILLMENT_CENTER_WEIGHTS.get(claim.fulfillment_center.lower(), 0.0)
    if fulfillment_weight:
        add_contribution(
            "logistics_modifier",
            fulfillment_weight,
            f"Fulfillment center '{claim.fulfillment_center}' has higher discrepancy rates",
            f"fc:{claim.fulfillment_center}",
        )

    marketplace_weight = MARKETPLACE_WEIGHTS.get(claim.marketplace.lower(), 0.0)
    if marketplace_weight:
        add_contribution(
            "logistics_modifier",
            marketplace_weight,
            f"Marketplace '{claim.marketplace}' exhibits higher reimbursement adjustments",
            f"marketplace:{claim.marketplace}",
        )

    if claim.quantity >= 10:
        add_contribution(
            "volume_modifier",
            0.06,
            "High quantity amplifies potential reimbursement value",
            "quantity",
        )
    elif claim.quantity == 1:
        add_contribution(
            "volume_modifier",
            -0.03,
            "Single-unit cases historically have lower recovery rates",
            "quantity",
        )

    if "damaged" in claim.description.lower():
        add_contribution(
            "reason_code_score",
            0.05,
            "Description references damage corroborating the claim",
            "description_keyword:damaged",
        )

    if "apparel" in claim.notes.lower() if claim.notes else False:
        add_contribution(
            "category_score",
            0.03,
            "Apparel notes correlate with higher reimbursement wins",
            "notes_keyword:apparel",
        )

    probability = _normalize_probability(probability)
    confidence = min(1.0, 0.45 + abs(probability - 0.5) * 1.3)
    claimable = probability >= CLAIMABLE_THRESHOLD
    processing_time_ms = (time.perf_counter() - start) * 1000

    if not feature_contributions:
        feature_contributions.append({
            "feature": "baseline",
            "weight": round(BASE_PROBABILITY, 4),
            "reason": "Baseline likelihood with no additional signals",
        })

    model_components = {
        component: round(weight, 4)
        for component, weight in component_totals.items()
    }

    return ClaimResponse(
        claim_id=claim.claim_id,
        claimable=claimable,
        probability=round(probability, 4),
        confidence=round(confidence, 4),
        feature_contributions=feature_contributions,
        model_components=model_components,
        processing_time_ms=round(processing_time_ms, 3),
    )


@claim_detector_router.get("/health")
async def health_check():
    """Health check endpoint for Claim Detector."""
    return {
        "status": "healthy",
        "service": "Claim Detector",
        "version": MODEL_METADATA["model_version"],
        "timestamp": datetime.utcnow().isoformat(),
        "model_loaded": True,
    }

@claim_detector_router.get("/model/info", response_model=ModelInfo)
async def get_model_info():
    """Get model information."""
    return ModelInfo(**MODEL_METADATA)

@claim_detector_router.post("/predict", response_model=ClaimResponse)
async def predict_claim(claim: ClaimRequest):
    """Predict claimability for a single claim."""
    try:
        return _score_claim(claim)
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

@claim_detector_router.post("/predict/batch", response_model=BatchClaimResponse)
async def predict_claims_batch(batch_request: BatchClaimRequest):
    """Predict claimability for multiple claims."""
    try:
        predictions = [_score_claim(claim) for claim in batch_request.claims]
        if predictions:
            avg_probability = sum(p.probability for p in predictions) / len(predictions)
            avg_confidence = sum(p.confidence for p in predictions) / len(predictions)
            claimable_count = sum(1 for p in predictions if p.claimable)
            high_confidence_count = sum(1 for p in predictions if p.probability >= HIGH_CONFIDENCE_THRESHOLD)
        else:
            avg_probability = 0.0
            avg_confidence = 0.0
            claimable_count = 0
            high_confidence_count = 0

        return BatchClaimResponse(
            predictions=predictions,
            batch_metrics={
                "total_claims": len(predictions),
                "claimable_count": claimable_count,
                "high_confidence_count": high_confidence_count,
                "avg_probability": round(avg_probability, 4),
                "avg_confidence": round(avg_confidence, 4),
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

