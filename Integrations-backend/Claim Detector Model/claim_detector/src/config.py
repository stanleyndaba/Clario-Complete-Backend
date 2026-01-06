"""
Configuration settings for the Amazon FBA Reimbursement Claim Detector
"""
import os
from pathlib import Path
from typing import Dict, Any, List
from dataclasses import dataclass

# Project root directory
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
MODELS_DIR = PROJECT_ROOT / "models"
LOGS_DIR = PROJECT_ROOT / "logs"

# Data paths
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
SYNTHETIC_DATA_PATH = DATA_DIR / "synthetic_data.csv"

# Model paths
MODEL_REGISTRY_PATH = MODELS_DIR / "registry"
MODEL_METADATA_PATH = MODEL_REGISTRY_PATH / "model_metadata.json"
CLAIM_DETECTOR_MODEL_PATH = MODELS_DIR / "claim_detector_model.pkl"
PREPROCESSING_PIPELINE_PATH = MODELS_DIR / "preprocessing_pipeline.pkl"
ANOMALY_DETECTOR_PATH = MODELS_DIR / "anomaly_detector.pkl"

# API settings
API_HOST = "0.0.0.0"
API_PORT = 8000
API_WORKERS = 4
API_RELOAD = True

# Model configuration
@dataclass
class ModelConfig:
    """Model configuration settings"""
    
    # Ensemble weights
    LIGHTGBM_WEIGHT = 0.4
    CATBOOST_WEIGHT = 0.3
    TEXT_MODEL_WEIGHT = 0.2
    ANOMALY_WEIGHT = 0.1
    
    # LightGBM parameters
    LIGHTGBM_PARAMS = {
        'objective': 'binary',
        'metric': 'auc',
        'boosting_type': 'gbdt',
        'num_leaves': 31,
        'learning_rate': 0.05,
        'feature_fraction': 0.9,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'verbose': -1,
        'random_state': 42
    }
    
    # CatBoost parameters
    CATBOOST_PARAMS = {
        'iterations': 1000,
        'learning_rate': 0.05,
        'depth': 6,
        'l2_leaf_reg': 3,
        'random_seed': 42,
        'verbose': False
    }
    
    # Text model parameters
    TEXT_MODEL_NAME = "all-MiniLM-L6-v2"
    TEXT_EMBEDDING_DIM = 384
    TEXT_SIMILARITY_THRESHOLD = 0.7
    
    # Anomaly detection parameters
    ANOMALY_CONTAMINATION = 0.1
    ANOMALY_RANDOM_STATE = 42
    
    # Training parameters
    TEST_SIZE = 0.2
    VALIDATION_SIZE = 0.2
    RANDOM_STATE = 42
    N_JOBS = -1

# Feature engineering configuration
@dataclass
class FeatureConfig:
    """Feature engineering configuration"""
    
    # Behavioral features
    BEHAVIORAL_WINDOWS = [7, 14, 30, 90]  # days
    BEHAVIORAL_AGGREGATIONS = ['mean', 'std', 'min', 'max', 'count']
    
    # Text features
    TEXT_COLUMNS = ['description', 'reason', 'notes']
    TEXT_MAX_LENGTH = 512
    TEXT_BATCH_SIZE = 32
    
    # Anomaly features
    ANOMALY_FEATURES = ['amount', 'frequency', 'timing']
    ANOMALY_WINDOW_SIZE = 30
    
    # Categorical encoding
    CATEGORICAL_COLUMNS = [
        'category', 'subcategory', 'reason_code', 
        'seller_id', 'marketplace', 'fulfillment_center'
    ]
    
    # Numerical features
    NUMERICAL_COLUMNS = [
        'amount', 'quantity', 'days_since_order',
        'days_since_delivery', 'order_value', 'shipping_cost'
    ]

# Monitoring configuration
@dataclass
class MonitoringConfig:
    """Monitoring and feedback configuration"""
    
    # Drift detection
    DRIFT_DETECTION_WINDOW = 30  # days
    DRIFT_THRESHOLD = 0.05
    DRIFT_CHECK_FREQUENCY = 7  # days
    
    # Performance monitoring
    PERFORMANCE_METRICS = ['auc', 'precision', 'recall', 'f1']
    PERFORMANCE_THRESHOLD = 0.8
    
    # Feedback loop
    FEEDBACK_COLLECTION_ENABLED = True
    FEEDBACK_BATCH_SIZE = 100
    RETRAIN_THRESHOLD = 1000  # new samples
    
    # Shadow mode
    SHADOW_MODE_ENABLED = True
    SHADOW_MODE_SAMPLE_RATE = 0.1

# API configuration
@dataclass
class APIConfig:
    """API configuration settings"""
    
    # Response settings
    CONFIDENCE_THRESHOLD = 0.7
    MAX_FEATURE_CONTRIBUTIONS = 10
    
    # Rate limiting
    RATE_LIMIT_PER_MINUTE = 1000
    
    # CORS settings
    ALLOWED_ORIGINS = ["*"]
    ALLOWED_METHODS = ["GET", "POST"]
    ALLOWED_HEADERS = ["*"]

# Create directories if they don't exist
def create_directories():
    """Create necessary directories"""
    directories = [
        RAW_DATA_DIR,
        PROCESSED_DATA_DIR,
        MODEL_REGISTRY_PATH,
        LOGS_DIR
    ]
    
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)

# Initialize configuration
create_directories()

# Export configurations
model_config = ModelConfig()
feature_config = FeatureConfig()
monitoring_config = MonitoringConfig()
api_config = APIConfig() 