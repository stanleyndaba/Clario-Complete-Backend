"""
CRUD operations for the Claim Detector Model database
"""
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from .models import Feedback, Metrics, Prediction

class FeedbackCRUD:
    """CRUD operations for feedback"""
    
    @staticmethod
    def create_feedback(
        db: Session,
        claim_id: str,
        actual_claimable: bool,
        predicted_claimable: bool,
        predicted_probability: float,
        confidence: Optional[float] = None,
        user_notes: Optional[str] = None
    ) -> Feedback:
        """Create new feedback entry"""
        feedback = Feedback(
            claim_id=claim_id,
            actual_claimable=actual_claimable,
            predicted_claimable=predicted_claimable,
            predicted_probability=predicted_probability,
            confidence=confidence,
            user_notes=user_notes
        )
        db.add(feedback)
        db.commit()
        db.refresh(feedback)
        return feedback
    
    @staticmethod
    def get_feedback_by_claim_id(db: Session, claim_id: str) -> Optional[Feedback]:
        """Get feedback by claim ID"""
        return db.query(Feedback).filter(Feedback.claim_id == claim_id).first()
    
    @staticmethod
    def get_feedback_stats(db: Session, days: int = 30) -> Dict[str, Any]:
        """Get feedback statistics for the last N days"""
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        total_feedback = db.query(Feedback).filter(
            Feedback.created_at >= cutoff_date
        ).count()
        
        if total_feedback == 0:
            return {
                "total_feedback": 0,
                "accuracy": 0.0,
                "false_positives": 0,
                "false_negatives": 0
            }
        
        correct_predictions = db.query(Feedback).filter(
            Feedback.created_at >= cutoff_date,
            Feedback.actual_claimable == Feedback.predicted_claimable
        ).count()
        
        false_positives = db.query(Feedback).filter(
            Feedback.created_at >= cutoff_date,
            Feedback.predicted_claimable == True,
            Feedback.actual_claimable == False
        ).count()
        
        false_negatives = db.query(Feedback).filter(
            Feedback.created_at >= cutoff_date,
            Feedback.predicted_claimable == False,
            Feedback.actual_claimable == True
        ).count()
        
        return {
            "total_feedback": total_feedback,
            "accuracy": correct_predictions / total_feedback,
            "false_positives": false_positives,
            "false_negatives": false_negatives
        }

class MetricsCRUD:
    """CRUD operations for metrics"""
    
    @staticmethod
    def create_metric(
        db: Session,
        metric_name: str,
        metric_value: float,
        metric_type: str,
        model_version: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Metrics:
        """Create new metric entry"""
        metric = Metrics(
            metric_name=metric_name,
            metric_value=metric_value,
            metric_type=metric_type,
            model_version=model_version,
            metadata=metadata
        )
        db.add(metric)
        db.commit()
        db.refresh(metric)
        return metric
    
    @staticmethod
    def get_latest_metrics(
        db: Session, 
        metric_name: str, 
        metric_type: str = "production"
    ) -> Optional[Metrics]:
        """Get latest metric by name and type"""
        return db.query(Metrics).filter(
            Metrics.metric_name == metric_name,
            Metrics.metric_type == metric_type
        ).order_by(desc(Metrics.timestamp)).first()
    
    @staticmethod
    def get_metrics_history(
        db: Session,
        metric_name: str,
        metric_type: str = "production",
        days: int = 30
    ) -> List[Metrics]:
        """Get metrics history for the last N days"""
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        return db.query(Metrics).filter(
            Metrics.metric_name == metric_name,
            Metrics.metric_type == metric_type,
            Metrics.timestamp >= cutoff_date
        ).order_by(Metrics.timestamp).all()

class PredictionCRUD:
    """CRUD operations for predictions"""
    
    @staticmethod
    def create_prediction(
        db: Session,
        claim_id: str,
        seller_id: str,
        predicted_claimable: bool,
        probability: float,
        confidence: float,
        feature_contributions: Optional[Dict[str, Any]] = None,
        model_components: Optional[Dict[str, Any]] = None,
        processing_time_ms: Optional[float] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> Prediction:
        """Create new prediction entry"""
        prediction = Prediction(
            claim_id=claim_id,
            seller_id=seller_id,
            predicted_claimable=predicted_claimable,
            probability=probability,
            confidence=confidence,
            feature_contributions=feature_contributions,
            model_components=model_components,
            processing_time_ms=processing_time_ms,
            ip_address=ip_address,
            user_agent=user_agent
        )
        db.add(prediction)
        db.commit()
        db.refresh(prediction)
        return prediction
    
    @staticmethod
    def get_prediction_by_claim_id(db: Session, claim_id: str) -> Optional[Prediction]:
        """Get prediction by claim ID"""
        return db.query(Prediction).filter(Prediction.claim_id == claim_id).first()
    
    @staticmethod
    def get_prediction_stats(db: Session, days: int = 30) -> Dict[str, Any]:
        """Get prediction statistics for the last N days"""
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        total_predictions = db.query(Prediction).filter(
            Prediction.created_at >= cutoff_date
        ).count()
        
        if total_predictions == 0:
            return {
                "total_predictions": 0,
                "avg_processing_time": 0.0,
                "avg_confidence": 0.0,
                "claimable_rate": 0.0
            }
        
        avg_processing_time = db.query(
            func.avg(Prediction.processing_time_ms)
        ).filter(
            Prediction.created_at >= cutoff_date,
            Prediction.processing_time_ms.isnot(None)
        ).scalar() or 0.0
        
        avg_confidence = db.query(
            func.avg(Prediction.confidence)
        ).filter(
            Prediction.created_at >= cutoff_date
        ).scalar() or 0.0
        
        claimable_count = db.query(Prediction).filter(
            Prediction.created_at >= cutoff_date,
            Prediction.predicted_claimable == True
        ).count()
        
        return {
            "total_predictions": total_predictions,
            "avg_processing_time": avg_processing_time,
            "avg_confidence": avg_confidence,
            "claimable_rate": claimable_count / total_predictions
        }

