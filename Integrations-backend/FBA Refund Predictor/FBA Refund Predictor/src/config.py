"""
Configuration management for the FBA Refund Success Predictor.
"""
import yaml
from pathlib import Path

def load_config(config_path: str = "config.yaml"):
    """Load YAML configuration file."""
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)

def get_data_paths():
    """Get data directory paths."""
    return {
        'raw': 'data/raw/',
        'processed': 'data/processed/',
        'interim': 'data/interim/',
        'external': 'data/external/',
        'feature_store': 'data/feature_store/'
    } 