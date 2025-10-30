"""
ML Detector Router
API endpoints for machine learning-based claim detection
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, Optional
import logging

from .advanced_detector_service import advanced_detector_service
from src.api.auth_middleware import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ml", tags=["ml-detection"])

@router.post("/detect/advanced")
def advanced_detect_claim(claim_data: Dict[str, Any], user: dict = Depends(get_current_user)):
    """Advanced multi-stage claim detection"""
    try:
        # Ensure service is initialized
        if not advanced_detector_service.is_initialized:
            if not advanced_detector_service.initialize():
                raise HTTPException(
                    status_code=503, 
                    detail="Advanced detector service not available"
                )
        
        # Run detection
        result = advanced_detector_service.detect_claim(claim_data)
        
        return {
            "success": True,
            "result": result,
            "message": "Advanced detection completed"
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in advanced detection: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/status")
def get_ml_status():
    """Get ML detection service status"""
    try:
        status = advanced_detector_service.get_service_status()
        return {
            "success": True,
            "status": status
        }
    except Exception as e:
        logger.error(f"Error getting ML status: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/retrain")
def retrain_model(training_data: Optional[list] = None, user: dict = Depends(get_current_user)):
    """Retrain the advanced detection model"""
    try:
        # Ensure service is initialized
        if not advanced_detector_service.is_initialized:
            if not advanced_detector_service.initialize():
                raise HTTPException(
                    status_code=503, 
                    detail="Advanced detector service not available"
                )
        
        # Retrain model
        result = advanced_detector_service.retrain_model(training_data)
        
        return result
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error retraining model: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/initialize")
def initialize_ml_service(user: dict = Depends(get_current_user)):
    """Initialize the ML detection service"""
    try:
        success = advanced_detector_service.initialize()
        
        if success:
            return {
                "success": True,
                "message": "ML detection service initialized successfully"
            }
        else:
            raise HTTPException(
                status_code=503,
                detail="Failed to initialize ML detection service"
            )
            
    except Exception as e:
        logger.error(f"Error initializing ML service: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")






