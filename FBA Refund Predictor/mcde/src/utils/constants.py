"""
Constants for MCDE.
Project-wide constants and configuration values.
"""
from pathlib import Path

# Data paths
DATA_DIR = Path("data")
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
INTERIM_DATA_DIR = DATA_DIR / "interim"
EXTRACTED_DOCS_DIR = DATA_DIR / "extracted_docs"
AUDIT_TRAILS_DIR = DATA_DIR / "audit_trails"

# Model paths
MODELS_DIR = Path("models")
COST_MODEL_PATH = MODELS_DIR / "cost_model.pkl"
VALIDATION_MODEL_PATH = MODELS_DIR / "validation_model.pkl"
ENSEMBLE_MODEL_PATH = MODELS_DIR / "ensemble_model.pkl"

# API constants
DEFAULT_PREDICTION_THRESHOLD = 0.5
MAX_BATCH_SIZE = 1000
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# Document processing constants
SUPPORTED_FORMATS = ["pdf", "jpg", "jpeg", "png", "tiff"]
OCR_CONFIDENCE_THRESHOLD = 0.8
IMAGE_RESIZE_WIDTH = 1920
IMAGE_RESIZE_HEIGHT = 1080
OCR_DPI = 300

# Cost estimation constants
COST_COMPONENTS = [
    "material_cost",
    "labor_cost", 
    "overhead_cost",
    "shipping_cost",
    "tax_cost"
]

# Compliance validation constants
AMAZON_REQUIREMENTS = [
    "document_authenticity",
    "cost_validation",
    "manufacturing_verification"
]

VALIDATION_RULES = {
    "min_cost_threshold": 0.01,
    "max_cost_threshold": 10000.00,
    "required_fields": [
        "invoice_number",
        "date", 
        "supplier",
        "total_amount"
    ]
}

# Feature store constants
FEATURE_STORE_PREFIX = "mcde_features"
FEATURE_STORE_TTL = 86400  # 24 hours

# Logging constants
LOG_FORMAT = "{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} | {message}"
AUDIT_LOG_FORMAT = "{time:YYYY-MM-DD HH:mm:ss} | AUDIT | {extra[user_id]} | {extra[action]} | {message}"

# Security constants
ENCRYPTION_ALGORITHM = "AES-256-GCM"
JWT_ALGORITHM = "HS256"
PASSWORD_HASH_ALGORITHM = "bcrypt"

# Monitoring constants
METRICS_PORT = 9090
HEALTH_CHECK_INTERVAL = 30
PERFORMANCE_THRESHOLDS = {
    "document_processing_time": 60,  # seconds
    "ocr_accuracy": 0.85,
    "cost_prediction_accuracy": 0.90
}

# Integration constants
REFUND_ENGINE_ENDPOINTS = {
    "health": "/health",
    "validate_cost": "/validate-cost-estimate",
    "request_document": "/request-document",
    "claim_features": "/claim-features/{claim_id}",
    "update_claim": "/update-claim",
    "predict_success": "/predict-success",
    "store_features": "/store-features"
}

AMAZON_API_ENDPOINTS = {
    "orders": "/orders/v0/orders",
    "items": "/catalog/v0/items",
    "inventory": "/fba/inventory/v1/summaries"
}

# Error messages
ERROR_MESSAGES = {
    "file_too_large": "File too large. Maximum size: 50MB",
    "unsupported_format": "Unsupported file format",
    "empty_file": "File is empty",
    "processing_failed": "Document processing failed",
    "validation_failed": "Cost validation failed",
    "model_not_found": "Model not found",
    "service_unavailable": "Service temporarily unavailable"
}

# Success messages
SUCCESS_MESSAGES = {
    "upload_successful": "Document uploaded successfully",
    "processing_completed": "Document processing completed",
    "validation_passed": "Cost validation passed",
    "document_generated": "Document generated successfully"
} 