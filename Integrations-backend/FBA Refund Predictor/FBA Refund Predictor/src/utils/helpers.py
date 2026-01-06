"""
Helper utility functions.
"""
import numpy as np
from typing import List, Dict, Any

def calculate_metrics(y_true: List, y_pred: List) -> Dict[str, float]:
    """Calculate common ML metrics."""
    # TODO: Implement metric calculation
    return {"accuracy": 0.0, "precision": 0.0, "recall": 0.0}

def format_timestamp(timestamp) -> str:
    """Format timestamp for logging."""
    return timestamp.strftime("%Y-%m-%d %H:%M:%S") 