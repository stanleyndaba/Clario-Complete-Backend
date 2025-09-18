"""
I/O utilities for file operations.
"""
import pandas as pd
import joblib
from pathlib import Path

def save_model(model, filepath: str):
    """Save model to file."""
    joblib.dump(model, filepath)

def load_model(filepath: str):
    """Load model from file."""
    return joblib.load(filepath)

def save_dataframe(df: pd.DataFrame, filepath: str):
    """Save dataframe to file."""
    df.to_csv(filepath, index=False) 