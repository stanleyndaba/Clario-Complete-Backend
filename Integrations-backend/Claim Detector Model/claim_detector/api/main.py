"""
FastAPI application for FBA reimbursement claim detection
"""
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import pandas as pd
import numpy as np
import logging
import json
import time
from pathlib import Path
import uvicorn

# Import unified components
from ..src.config import API_HOST, API_PORT, api_config
from ..src.models.unified_model import UnifiedClaimDetectorModel
from ..improved_training import ImprovedFBAClaimsModel
from ..src.database import get_db, FeedbackCRUD, MetricsCRUD, PredictionCRUD
from ..src.security import get_current_user, SecurityMiddleware, HTTPSRedirectMiddleware
from ..src.security.rate_limiter import check_rate_limit, get_remaining_requests
from ..src.evidence.controllers import evidence_router
from ..src.ev.router import ev_router
from ..src.monitoring.router import monitoring_router
from ..src.acg.router import acg_router

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Amazon FBA Reimbursement Claim Detector",
    description="ML API for detecting claimable FBA reimbursement opportunities",
    version="1.0.0"
)

# Add security middleware
app.add_middleware(SecurityMiddleware, rate_limit_enabled=True)
app.add_middleware(HTTPSRedirectMiddleware)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=api_config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=api_config.ALLOWED_METHODS,
    allow_headers=api_config.ALLOWED_HEADERS,
)

# Mount Evidence & Value Engine routes
app.include_router(evidence_router)
app.include_router(ev_router, prefix="/ev")
app.include_router(monitoring_router, prefix="/monitoring")
app.include_router(acg_router, prefix="/acg")

# Initialize unified model
model = None
# Use the working improved model instead of empty unified model
model_path = Path("models/improved_fba_claims_model.pkl")
pipeline_path = Path("models/preprocessing_pipeline.pkl")

# Pydantic models for API requests/responses
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
    model_version: str
    training_date: str
    feature_count: int
    model_components: List[str]
    performance_metrics: Dict[str, float]

class FeedbackRequest(BaseModel):
    """Request model for feedback submission"""
    claim_id: str
    actual_claimable: bool
    confidence: Optional[float] = None
    user_notes: Optional[str] = None

class LoginRequest(BaseModel):
    """Request model for user login"""
    username: str
    password: str

class TokenResponse(BaseModel):
    """Response model for authentication token"""
    access_token: str
    token_type: str

@app.on_event("startup")
async def startup_event():
    """Initialize the model on startup"""
    global model
    try:
        # Try to load the improved model first (working model)
        if model_path.exists():
            model = ImprovedFBAClaimsModel()
            model.load_model(str(model_path))
            logger.info("Improved FBA Claims Model loaded successfully")
        else:
            # Fallback to unified model if improved model doesn't exist
            model = UnifiedClaimDetectorModel(
                model_path=str(model_path) if model_path.exists() else None,
                pipeline_path=str(pipeline_path) if pipeline_path.exists() else None
            )
            
            if model_path.exists() and model.is_trained:
                logger.info("Unified model loaded successfully")
            else:
                logger.warning("No trained model found. Please train the model first.")
    except Exception as e:
        logger.error(f"Error loading model: {e}")

def prepare_single_claim(claim_data: ClaimRequest) -> pd.DataFrame:
    """Prepare a single claim for prediction"""
    # Convert to DataFrame
    df = pd.DataFrame([claim_data.dict()])
    
    # Convert date string to datetime
    df['claim_date'] = pd.to_datetime(df['claim_date'])
    
    # Add dummy target for feature engineering
    df['claimable'] = 0
    
    return df

async def log_prediction_to_db(
    db,
    claim_id: str,
    seller_id: str,
    predicted_claimable: bool,
    probability: float,
    confidence: float,
    feature_contributions: List[Dict[str, Any]],
    model_components: Dict[str, float],
    processing_time_ms: float,
    request: Request
):
    """Log prediction to database"""
    try:
        # Get client IP and user agent
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "unknown")
        
        # Create prediction record
        PredictionCRUD.create_prediction(
            db=db,
            claim_id=claim_id,
            seller_id=seller_id,
            predicted_claimable=predicted_claimable,
            probability=probability,
            confidence=confidence,
            feature_contributions=feature_contributions,
            model_components=model_components,
            processing_time_ms=processing_time_ms,
            ip_address=client_ip,
            user_agent=user_agent
        )
    except Exception as e:
        logger.error(f"Error logging prediction to database: {e}")

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Amazon FBA Reimbursement Claim Detector API",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "model_loaded": model is not None and model.is_trained,
        "timestamp": pd.Timestamp.now().isoformat()
    }

@app.post("/auth/login", response_model=TokenResponse)
async def login(login_request: LoginRequest):
    """User login endpoint"""
    from ..src.security.auth import authenticate_user, create_access_token, fake_users_db
    
    user = authenticate_user(fake_users_db, login_request.username, login_request.password)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/model/info", response_model=ModelInfo)
async def get_model_info():
    """Get model information"""
    if model is None or not model.is_trained:
        raise HTTPException(status_code=503, detail="Model not loaded or trained")
    
    return ModelInfo(
        model_version=model.metadata.get('model_version', '1.0.0'),
        training_date=model.metadata.get('training_date', 'Unknown'),
        feature_count=len(model.feature_names),
        model_components=list(model.models.keys()),
        performance_metrics=model.metadata.get('performance_metrics', {})
    )

@app.post("/predict", response_model=ClaimResponse)
async def predict_claim(
    claim: ClaimRequest,
    request: Request,
    db=Depends(get_db)
):
    """Predict claimability for a single claim"""
    if model is None or not model.is_trained:
        raise HTTPException(status_code=503, detail="Model not loaded or trained")
    
    try:
        # Rate limiting check
        client_ip = request.client.host if request.client else "unknown"
        if not check_rate_limit(client_ip, "predict"):
            remaining = get_remaining_requests(client_ip, "predict")
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Retry after 60 seconds. Remaining: {remaining}"
            )
        
        # Prepare claim data
        df = prepare_single_claim(claim)
        
        # Make prediction using unified model (includes preprocessing)
        prediction_results = model.predict(df)
        
        # Get feature explanations
        explanation = model.explain_prediction(df)
        
        # Prepare response
        response = ClaimResponse(
            claim_id=claim.claim_id,
            claimable=bool(prediction_results['predictions'][0]),
            probability=float(prediction_results['probabilities'][0]),
            confidence=float(prediction_results['confidence'][0]),
            feature_contributions=explanation['feature_contributions'],
            model_components=model.weights,
            processing_time_ms=prediction_results['processing_time_ms']
        )
        
        # Log prediction to database
        await log_prediction_to_db(
            db=db,
            claim_id=claim.claim_id,
            seller_id=claim.seller_id,
            predicted_claimable=response.claimable,
            probability=response.probability,
            confidence=response.confidence,
            feature_contributions=response.feature_contributions,
            model_components=response.model_components,
            processing_time_ms=response.processing_time_ms,
            request=request
        )
        
        return response
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error making prediction: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

@app.post("/predict/batch", response_model=BatchClaimResponse)
async def predict_claims_batch(
    batch_request: BatchClaimRequest,
    request: Request,
    db=Depends(get_db)
):
    """Predict claimability for multiple claims"""
    if model is None or not model.is_trained:
        raise HTTPException(status_code=503, detail="Model not loaded or trained")
    
    try:
        # Rate limiting check
        client_ip = request.client.host if request.client else "unknown"
        if not check_rate_limit(client_ip, "batch_predict"):
            remaining = get_remaining_requests(client_ip, "batch_predict")
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Retry after 60 seconds. Remaining: {remaining}"
            )
        
        predictions = []
        total_processing_time = 0
        
        for claim in batch_request.claims:
            # Prepare claim data
            df = prepare_single_claim(claim)
            
            # Make prediction
            prediction_results = model.predict(df)
            
            # Get feature explanations
            explanation = model.explain_prediction(df)
            
            # Prepare response
            prediction_response = ClaimResponse(
                claim_id=claim.claim_id,
                claimable=bool(prediction_results['predictions'][0]),
                probability=float(prediction_results['probabilities'][0]),
                confidence=float(prediction_results['confidence'][0]),
                feature_contributions=explanation['feature_contributions'],
                model_components=model.weights,
                processing_time_ms=prediction_results['processing_time_ms']
            )
            
            predictions.append(prediction_response)
            total_processing_time += prediction_results['processing_time_ms']
            
            # Log prediction to database
            await log_prediction_to_db(
                db=db,
                claim_id=claim.claim_id,
                seller_id=claim.seller_id,
                predicted_claimable=prediction_response.claimable,
                probability=prediction_response.probability,
                confidence=prediction_response.confidence,
                feature_contributions=prediction_response.feature_contributions,
                model_components=prediction_response.model_components,
                processing_time_ms=prediction_response.processing_time_ms,
                request=request
            )
        
        # Calculate batch metrics
        probabilities = [p.probability for p in predictions]
        confidences = [p.confidence for p in predictions]
        
        batch_metrics = {
            "total_claims": len(predictions),
            "claimable_count": sum(1 for p in predictions if p.claimable),
            "claimable_rate": sum(1 for p in predictions if p.claimable) / len(predictions),
            "avg_probability": np.mean(probabilities),
            "avg_confidence": np.mean(confidences),
            "high_confidence_count": sum(1 for c in confidences if c > 0.8),
            "total_processing_time_ms": total_processing_time,
            "avg_processing_time_ms": total_processing_time / len(predictions)
        }
        
        return BatchClaimResponse(
            predictions=predictions,
            batch_metrics=batch_metrics
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error making batch predictions: {e}")
        raise HTTPException(status_code=500, detail=f"Batch prediction error: {str(e)}")

@app.get("/features/importance")
async def get_feature_importance(top_n: int = 20):
    """Get feature importance from the model"""
    if model is None or not model.is_trained:
        raise HTTPException(status_code=503, detail="Model not loaded or trained")
    
    try:
        feature_importance = model.get_feature_importance(top_n=top_n)
        return {
            "feature_importance": feature_importance,
            "top_n": top_n
        }
    except Exception as e:
        logger.error(f"Error getting feature importance: {e}")
        raise HTTPException(status_code=500, detail=f"Feature importance error: {str(e)}")

@app.post("/feedback")
async def submit_feedback(
    feedback_request: FeedbackRequest,
    request: Request,
    db=Depends(get_db)
):
    """Submit feedback for model improvement"""
    try:
        # Rate limiting check
        client_ip = request.client.host if request.client else "unknown"
        if not check_rate_limit(client_ip, "feedback"):
            remaining = get_remaining_requests(client_ip, "feedback")
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Retry after 60 seconds. Remaining: {remaining}"
            )
        
        # Get prediction from database
        prediction = PredictionCRUD.get_prediction_by_claim_id(db, feedback_request.claim_id)
        if not prediction:
            raise HTTPException(status_code=404, detail="Prediction not found for this claim ID")
        
        # Create feedback record
        FeedbackCRUD.create_feedback(
            db=db,
            claim_id=feedback_request.claim_id,
            actual_claimable=feedback_request.actual_claimable,
            predicted_claimable=prediction.predicted_claimable,
            predicted_probability=prediction.probability,
            confidence=feedback_request.confidence,
            user_notes=feedback_request.user_notes
        )
        
        return {"message": "Feedback submitted successfully", "claim_id": feedback_request.claim_id}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting feedback: {e}")
        raise HTTPException(status_code=500, detail=f"Feedback submission error: {str(e)}")

@app.get("/feedback/stats")
async def get_feedback_stats(days: int = 30, db=Depends(get_db)):
    """Get feedback statistics"""
    try:
        stats = FeedbackCRUD.get_feedback_stats(db, days)
        return {
            "feedback_stats": stats,
            "period_days": days
        }
    except Exception as e:
        logger.error(f"Error getting feedback stats: {e}")
        raise HTTPException(status_code=500, detail=f"Feedback stats error: {str(e)}")

@app.get("/metrics")
async def get_model_metrics(db=Depends(get_db)):
    """Get current model performance metrics"""
    if model is None or not model.is_trained:
        raise HTTPException(status_code=503, detail="Model not loaded or trained")
    
    try:
        # Get model metadata
        model_metrics = model.metadata.get('performance_metrics', {})
        
        # Get prediction stats from database
        prediction_stats = PredictionCRUD.get_prediction_stats(db, days=30)
        
        # Get feedback stats from database
        feedback_stats = FeedbackCRUD.get_feedback_stats(db, days=30)
        
        return {
            "model_metrics": model_metrics,
            "prediction_stats": prediction_stats,
            "feedback_stats": feedback_stats,
            "model_loaded": True,
            "feature_count": len(model.feature_names)
        }
    
    except Exception as e:
        logger.error(f"Error getting metrics: {e}")
        raise HTTPException(status_code=500, detail=f"Metrics error: {str(e)}")

@app.get("/metrics/history")
async def get_metrics_history(
    metric_name: str,
    metric_type: str = "production",
    days: int = 30,
    db=Depends(get_db)
):
    """Get metrics history"""
    try:
        metrics_history = MetricsCRUD.get_metrics_history(db, metric_name, metric_type, days)
        return {
            "metric_name": metric_name,
            "metric_type": metric_type,
            "period_days": days,
            "metrics_history": [
                {
                    "timestamp": metric.timestamp.isoformat(),
                    "value": metric.metric_value,
                    "metadata": metric.metadata
                }
                for metric in metrics_history
            ]
        }
    except Exception as e:
        logger.error(f"Error getting metrics history: {e}")
        raise HTTPException(status_code=500, detail=f"Metrics history error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        reload=api_config.SHADOW_MODE_ENABLED,
        workers=1
    ) 