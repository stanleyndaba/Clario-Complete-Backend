"""
Database module for the Claim Detector Model
"""
from .models import Base, Feedback, Metrics, Prediction
from .session import get_db, engine
from .crud import FeedbackCRUD, MetricsCRUD, PredictionCRUD

__all__ = [
    "Base", "Feedback", "Metrics", "Prediction",
    "get_db", "engine",
    "FeedbackCRUD", "MetricsCRUD", "PredictionCRUD"
]

