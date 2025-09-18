"""
Database models for the Claim Detector Model
"""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
from datetime import datetime

Base = declarative_base()

class Feedback(Base):
    """Feedback model for storing user feedback on predictions"""
    __tablename__ = "feedback"
    
    id = Column(Integer, primary_key=True, index=True)
    claim_id = Column(String(255), nullable=False, index=True)
    actual_claimable = Column(Boolean, nullable=False)
    predicted_claimable = Column(Boolean, nullable=False)
    predicted_probability = Column(Float, nullable=False)
    confidence = Column(Float, nullable=True)
    user_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class Metrics(Base):
    """Model performance metrics storage"""
    __tablename__ = "metrics"
    
    id = Column(Integer, primary_key=True, index=True)
    metric_name = Column(String(100), nullable=False, index=True)
    metric_value = Column(Float, nullable=False)
    metric_type = Column(String(50), nullable=False)  # training, validation, production
    model_version = Column(String(50), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    metadata = Column(JSON, nullable=True)

class Prediction(Base):
    """Prediction history storage"""
    __tablename__ = "predictions"
    
    id = Column(Integer, primary_key=True, index=True)
    claim_id = Column(String(255), nullable=False, index=True)
    seller_id = Column(String(255), nullable=False, index=True)
    predicted_claimable = Column(Boolean, nullable=False)
    probability = Column(Float, nullable=False)
    confidence = Column(Float, nullable=False)
    feature_contributions = Column(JSON, nullable=True)
    model_components = Column(JSON, nullable=True)
    processing_time_ms = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    ip_address = Column(String(45), nullable=True)  # IPv6 compatible
    user_agent = Column(Text, nullable=True)

