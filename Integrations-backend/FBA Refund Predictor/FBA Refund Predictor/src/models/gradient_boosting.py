"""
Gradient boosting models for OpSide Refund Success Predictor.
High-performance models using LightGBM and XGBoost.
"""
import lightgbm as lgb
import xgboost as xgb
import numpy as np
from typing import Dict, Any, Tuple, Optional

def train_lightgbm_model(X_train, y_train, params: Optional[Dict] = None) -> lgb.LGBMClassifier:
    """
    Train LightGBM model for refund success prediction.
    
    Args:
        X_train: Training features
        y_train: Training targets
        params: LightGBM parameters
        
    Returns:
        Trained LightGBM model
    """
    # TODO: Implement LightGBM training
    # - Optimized hyperparameters
    # - Early stopping
    # - Cross-validation
    if params is None:
        params = {
            'objective': 'binary',
            'metric': 'auc',
            'boosting_type': 'gbdt',
            'num_leaves': 31,
            'learning_rate': 0.05,
            'feature_fraction': 0.9
        }
    
    model = lgb.LGBMClassifier(**params)
    model.fit(X_train, y_train)
    return model

def predict_lightgbm(model: lgb.LGBMClassifier, X_test) -> Tuple[np.ndarray, np.ndarray]:
    """
    Make predictions using LightGBM model.
    
    Args:
        model: Trained LightGBM model
        X_test: Test features
        
    Returns:
        Tuple of (predictions, probabilities)
    """
    # TODO: Implement LightGBM prediction
    predictions = model.predict(X_test)
    probabilities = model.predict_proba(X_test)
    return predictions, probabilities

def train_xgboost_model(X_train, y_train, params: Optional[Dict] = None) -> xgb.XGBClassifier:
    """
    Train XGBoost model for refund success prediction.
    
    Args:
        X_train: Training features
        y_train: Training targets
        params: XGBoost parameters
        
    Returns:
        Trained XGBoost model
    """
    # TODO: Implement XGBoost training
    if params is None:
        params = {
            'objective': 'binary:logistic',
            'eval_metric': 'auc',
            'max_depth': 6,
            'learning_rate': 0.1,
            'subsample': 0.8
        }
    
    model = xgb.XGBClassifier(**params)
    model.fit(X_train, y_train)
    return model 