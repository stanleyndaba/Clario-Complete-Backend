"""
Project constants and configuration values.
"""
from pathlib import Path

# Data paths
DATA_DIR = Path("data")
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
INTERIM_DATA_DIR = DATA_DIR / "interim"
EXTERNAL_DATA_DIR = DATA_DIR / "external"
FEATURE_STORE_DIR = DATA_DIR / "feature_store"

# Model paths
MODELS_DIR = Path("models")
BASELINE_MODEL_PATH = MODELS_DIR / "baseline_model.pkl"
LGBM_MODEL_PATH = MODELS_DIR / "lgbm_model.pkl"
TRANSFORMER_MODEL_PATH = MODELS_DIR / "transformer_model.pkl"
ENSEMBLE_MODEL_PATH = MODELS_DIR / "ensemble_model.pkl"

MODEL_PATHS = {
    'baseline': str(BASELINE_MODEL_PATH),
    'lgbm': str(LGBM_MODEL_PATH),
    'transformer': str(TRANSFORMER_MODEL_PATH),
    'ensemble': str(ENSEMBLE_MODEL_PATH)
}

# API constants
DEFAULT_PREDICTION_THRESHOLD = 0.5
MAX_BATCH_SIZE = 1000 