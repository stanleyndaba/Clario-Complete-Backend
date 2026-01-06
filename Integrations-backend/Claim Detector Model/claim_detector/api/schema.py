"""
API schema definitions for FBA reimbursement claim detection
"""
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum

class ReasonCode(str, Enum):
    """Enumeration of possible reason codes"""
    DAMAGED = "DAMAGED"
    LOST = "LOST"
    DESTROYED = "DESTROYED"
    EXPIRED = "EXPIRED"
    RETURNED = "RETURNED"
    OVERAGE = "OVERAGE"

class Marketplace(str, Enum):
    """Enumeration of possible marketplaces"""
    US = "US"
    CA = "CA"
    UK = "UK"
    DE = "DE"
    FR = "FR"
    IT = "IT"
    ES = "ES"
    JP = "JP"

class Category(str, Enum):
    """Enumeration of possible categories"""
    ELECTRONICS = "Electronics"
    BOOKS = "Books"
    CLOTHING = "Clothing"
    HOME_GARDEN = "Home & Garden"
    SPORTS = "Sports"
    TOYS = "Toys"

class Subcategory(str, Enum):
    """Enumeration of possible subcategories"""
    SMARTPHONES = "Smartphones"
    LAPTOPS = "Laptops"
    FICTION = "Fiction"
    NON_FICTION = "Non-fiction"
    MEN = "Men"
    WOMEN = "Women"
    KITCHEN = "Kitchen"
    GARDEN = "Garden"
    FITNESS = "Fitness"
    OUTDOOR = "Outdoor"

class ClaimRequest(BaseModel):
    """Request model for claim prediction"""
    claim_id: str = Field(..., description="Unique claim identifier")
    seller_id: str = Field(..., description="Seller identifier")
    order_id: str = Field(..., description="Order identifier")
    category: Category = Field(..., description="Product category")
    subcategory: Subcategory = Field(..., description="Product subcategory")
    reason_code: ReasonCode = Field(..., description="Reason for claim")
    marketplace: Marketplace = Field(..., description="Marketplace")
    fulfillment_center: str = Field(..., description="Fulfillment center identifier")
    amount: float = Field(..., ge=0, description="Claim amount")
    quantity: int = Field(..., ge=1, description="Quantity of items")
    order_value: float = Field(..., ge=0, description="Original order value")
    shipping_cost: float = Field(..., ge=0, description="Shipping cost")
    days_since_order: int = Field(..., ge=0, description="Days since order was placed")
    days_since_delivery: int = Field(..., ge=0, description="Days since delivery")
    description: str = Field(..., min_length=1, description="Item description")
    reason: str = Field(..., min_length=1, description="Detailed reason for claim")
    notes: Optional[str] = Field("", description="Additional notes")
    claim_date: str = Field(..., description="Claim date in ISO format")

    class Config:
        schema_extra = {
            "example": {
                "claim_id": "CLAIM_000001",
                "seller_id": "SELLER_1234",
                "order_id": "ORDER_123456",
                "category": "Electronics",
                "subcategory": "Smartphones",
                "reason_code": "DAMAGED",
                "marketplace": "US",
                "fulfillment_center": "FBA1",
                "amount": 299.99,
                "quantity": 1,
                "order_value": 299.99,
                "shipping_cost": 5.99,
                "days_since_order": 45,
                "days_since_delivery": 40,
                "description": "iPhone 13 Pro Max 256GB",
                "reason": "Item damaged during shipping",
                "notes": "Screen cracked, box dented",
                "claim_date": "2024-01-15T10:30:00Z"
            }
        }

class FeatureContribution(BaseModel):
    """Model for feature contribution in explanations"""
    feature_name: str = Field(..., description="Feature name")
    contribution: float = Field(..., description="SHAP contribution value")
    importance_rank: int = Field(..., description="Feature importance rank")

class ModelComponent(BaseModel):
    """Model for individual model component scores"""
    component_name: str = Field(..., description="Model component name")
    weight: float = Field(..., description="Component weight in ensemble")
    prediction: float = Field(..., description="Component prediction score")

class ClaimResponse(BaseModel):
    """Response model for claim prediction"""
    claim_id: str = Field(..., description="Claim identifier")
    claimable: bool = Field(..., description="Whether the claim is claimable")
    probability: float = Field(..., ge=0, le=1, description="Prediction probability")
    confidence: float = Field(..., ge=0, le=1, description="Model confidence score")
    feature_contributions: List[FeatureContribution] = Field(..., description="Top feature contributions")
    model_components: Dict[str, float] = Field(..., description="Individual model component scores")
    prediction_timestamp: datetime = Field(default_factory=datetime.now, description="Prediction timestamp")

    class Config:
        schema_extra = {
            "example": {
                "claim_id": "CLAIM_000001",
                "claimable": True,
                "probability": 0.85,
                "confidence": 0.92,
                "feature_contributions": [
                    {"feature_name": "amount", "contribution": 0.15, "importance_rank": 1},
                    {"feature_name": "days_since_order", "contribution": 0.08, "importance_rank": 2}
                ],
                "model_components": {
                    "lightgbm": 0.4,
                    "catboost": 0.3,
                    "text_model": 0.2,
                    "anomaly_detector": 0.1
                },
                "prediction_timestamp": "2024-01-15T10:30:00Z"
            }
        }

class BatchClaimRequest(BaseModel):
    """Request model for batch predictions"""
    claims: List[ClaimRequest] = Field(..., description="List of claims to predict")

class BatchMetrics(BaseModel):
    """Model for batch prediction metrics"""
    total_claims: int = Field(..., description="Total number of claims")
    claimable_count: int = Field(..., description="Number of claimable claims")
    claimable_rate: float = Field(..., ge=0, le=1, description="Rate of claimable claims")
    avg_probability: float = Field(..., ge=0, le=1, description="Average prediction probability")
    avg_confidence: float = Field(..., ge=0, le=1, description="Average confidence score")
    high_confidence_count: int = Field(..., description="Number of high confidence predictions")

class BatchClaimResponse(BaseModel):
    """Response model for batch predictions"""
    predictions: List[ClaimResponse] = Field(..., description="List of predictions")
    batch_metrics: BatchMetrics = Field(..., description="Batch-level metrics")
    processing_time: float = Field(..., description="Processing time in seconds")

class ModelInfo(BaseModel):
    """Model information response"""
    model_version: str = Field(..., description="Model version")
    training_date: str = Field(..., description="Model training date")
    feature_count: int = Field(..., description="Number of features")
    model_components: List[str] = Field(..., description="List of model components")
    performance_metrics: Dict[str, float] = Field(..., description="Model performance metrics")
    last_updated: datetime = Field(default_factory=datetime.now, description="Last model update")

class FeedbackRequest(BaseModel):
    """Request model for feedback submission"""
    claim_id: str = Field(..., description="Claim identifier")
    actual_claimable: bool = Field(..., description="Actual claimability")
    confidence: Optional[float] = Field(None, ge=0, le=1, description="User confidence in feedback")
    notes: Optional[str] = Field(None, description="Additional feedback notes")

class FeedbackResponse(BaseModel):
    """Response model for feedback submission"""
    message: str = Field(..., description="Feedback submission message")
    claim_id: str = Field(..., description="Claim identifier")
    feedback_id: str = Field(..., description="Feedback identifier")
    timestamp: datetime = Field(default_factory=datetime.now, description="Feedback timestamp")

class HealthCheck(BaseModel):
    """Health check response"""
    status: str = Field(..., description="Service status")
    model_loaded: bool = Field(..., description="Whether model is loaded")
    timestamp: datetime = Field(default_factory=datetime.now, description="Health check timestamp")
    version: str = Field(..., description="API version")

class ErrorResponse(BaseModel):
    """Error response model"""
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Error details")
    timestamp: datetime = Field(default_factory=datetime.now, description="Error timestamp")
    request_id: Optional[str] = Field(None, description="Request identifier for tracking")

class FeatureImportance(BaseModel):
    """Feature importance response"""
    model_name: str = Field(..., description="Model name")
    features: List[Dict[str, Any]] = Field(..., description="Feature importance list")
    top_n: int = Field(..., description="Number of top features returned")

class MetricsResponse(BaseModel):
    """Model metrics response"""
    model_metrics: Dict[str, float] = Field(..., description="Model performance metrics")
    model_loaded: bool = Field(..., description="Whether model is loaded")
    feature_count: int = Field(..., description="Number of features")
    last_evaluation: Optional[datetime] = Field(None, description="Last evaluation timestamp") 