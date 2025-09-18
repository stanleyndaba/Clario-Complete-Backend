"""
Advanced Claim Detector Service
Integration service for the advanced multi-stage claim detection pipeline
"""

import sys
import os
from typing import Dict, Any, Optional
from datetime import datetime
import logging

# Add the claim detector model path to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'Claim Detector Model', 'claim_detector', 'src'))

try:
    from models.advanced_detector_fixed import AdvancedClaimDetector, DetectionResult, generate_advanced_mock_data
    ADVANCED_DETECTOR_AVAILABLE = True
except ImportError as e:
    print(f"Advanced detector not available: {e}")
    ADVANCED_DETECTOR_AVAILABLE = False

logger = logging.getLogger(__name__)

class AdvancedDetectorService:
    """Service for advanced claim detection"""
    
    def __init__(self):
        self.detector: Optional[AdvancedClaimDetector] = None
        self.is_initialized = False
        
    def initialize(self) -> bool:
        """Initialize the advanced detector service"""
        if not ADVANCED_DETECTOR_AVAILABLE:
            logger.error("Advanced detector dependencies not available")
            return False
        
        try:
            self.detector = AdvancedClaimDetector()
            self.detector.create_detection_pipeline()
            
            # Try to load existing model, otherwise train with mock data
            if not self.detector.load_pipeline("advanced_claim_detector"):
                logger.info("No existing model found, training with mock data...")
                mock_data = generate_advanced_mock_data(1000)
                training_results = self.detector.train_pipeline(mock_data)
                
                if training_results['overall_trained']:
                    self.detector.save_pipeline("advanced_claim_detector")
                    logger.info("Model trained and saved successfully")
                else:
                    logger.error("Failed to train model")
                    return False
            
            self.is_initialized = True
            logger.info("Advanced detector service initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize advanced detector service: {e}")
            return False
    
    def detect_claim(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """Detect a claim using the advanced pipeline"""
        if not self.is_initialized or not self.detector:
            raise ValueError("Advanced detector service not initialized")
        
        try:
            # Convert claim data to expected format
            formatted_claim = self._format_claim_data(claim_data)
            
            # Run detection
            result: DetectionResult = self.detector.detect_claims(formatted_claim)
            
            # Convert result to API format
            return {
                "claim_id": result.claim_id,
                "detected": result.final_prediction,
                "confidence": result.confidence_score,
                "ensemble_score": result.ensemble_score,
                "anomaly_score": result.anomaly_score,
                "text_similarity_score": result.text_similarity_score,
                "stage_predictions": result.stage_predictions,
                "stage_confidences": result.stage_confidences,
                "processing_time_ms": result.processing_time_ms,
                "timestamp": result.timestamp.isoformat(),
                "model_versions": result.model_versions,
                "detection_method": "advanced_multi_stage"
            }
            
        except Exception as e:
            logger.error(f"Error in claim detection: {e}")
            raise
    
    def _format_claim_data(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """Format claim data for the advanced detector"""
        # Extract metadata if it exists
        metadata = claim_data.get('metadata', {})
        if isinstance(metadata, dict):
            # Ensure detected_at is present
            if 'detected_at' not in metadata:
                metadata['detected_at'] = datetime.now().isoformat()
        else:
            metadata = {
                'marketplace_id': 'ATVPDKIKX0DER',
                'seller_id': 'A123456789',
                'detected_at': datetime.now().isoformat()
            }
        
        # Format the claim data
        formatted = {
            'claim_id': claim_data.get('claim_id', 'unknown'),
            'claim_type': claim_data.get('claim_type', 'other'),
            'confidence': claim_data.get('confidence', 0.5),
            'amount_estimate': claim_data.get('amount_estimate', 0.0),
            'quantity_affected': claim_data.get('quantity_affected', 1),
            'age_days': claim_data.get('features', {}).get('age_days', 30),
            'units': claim_data.get('quantity_affected', 1),
            'text_excerpt': claim_data.get('text_excerpt', ''),
            'metadata': metadata,
            'status': 'pending'  # Default status for detection
        }
        
        return formatted
    
    def get_service_status(self) -> Dict[str, Any]:
        """Get the status of the advanced detector service"""
        return {
            "initialized": self.is_initialized,
            "detector_available": ADVANCED_DETECTOR_AVAILABLE,
            "model_trained": self.detector.is_trained if self.detector else False,
            "model_versions": self.detector.model_versions if self.detector else {},
            "timestamp": datetime.now().isoformat()
        }
    
    def retrain_model(self, training_data: Optional[list] = None) -> Dict[str, Any]:
        """Retrain the model with new data"""
        if not self.is_initialized or not self.detector:
            raise ValueError("Advanced detector service not initialized")
        
        try:
            # Use provided data or generate mock data
            if training_data is None:
                training_data = generate_advanced_mock_data(2000)
            
            # Train the model
            training_results = self.detector.train_pipeline(training_data)
            
            if training_results['overall_trained']:
                # Save the retrained model
                self.detector.save_pipeline("advanced_claim_detector")
                
                return {
                    "success": True,
                    "message": "Model retrained successfully",
                    "training_results": training_results,
                    "timestamp": datetime.now().isoformat()
                }
            else:
                return {
                    "success": False,
                    "message": "Failed to train model",
                    "training_results": training_results,
                    "timestamp": datetime.now().isoformat()
                }
                
        except Exception as e:
            logger.error(f"Error retraining model: {e}")
            return {
                "success": False,
                "message": f"Error retraining model: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }

# Global service instance
advanced_detector_service = AdvancedDetectorService()
