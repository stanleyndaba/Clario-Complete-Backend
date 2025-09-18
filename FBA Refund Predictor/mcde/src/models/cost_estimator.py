"""
Cost estimator models for MCDE.
ML models for predicting manufacturing costs from document data.
"""
import joblib
import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Any, Tuple
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from src.logger import get_logger, log_cost_estimation
from src.config import settings

logger = get_logger(__name__)


class CostEstimatorModel:
    """ML model for estimating manufacturing costs."""
    
    def __init__(self):
        self.model = None
        self.feature_names = [
            "material_cost",
            "labor_cost", 
            "overhead_cost",
            "shipping_cost",
            "tax_cost",
            "quantity",
            "complexity_score",
            "supplier_rating"
        ]
        self.model_path = settings.models.cost_estimator.model_path
        self.version = settings.models.cost_estimator.version
    
    def train_model(self, training_data: pd.DataFrame) -> Dict[str, float]:
        """
        Train the cost estimation model.
        
        Args:
            training_data: Training dataset with features and target
            
        Returns:
            Dictionary with training metrics
        """
        try:
            # Prepare features and target
            X = training_data[self.feature_names]
            y = training_data['total_cost']
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42
            )
            
            # Initialize and train model
            self.model = GradientBoostingRegressor(
                n_estimators=100,
                learning_rate=0.1,
                max_depth=6,
                random_state=42
            )
            
            self.model.fit(X_train, y_train)
            
            # Evaluate model
            y_pred = self.model.predict(X_test)
            
            metrics = {
                "mae": mean_absolute_error(y_test, y_pred),
                "mse": mean_squared_error(y_test, y_pred),
                "rmse": np.sqrt(mean_squared_error(y_test, y_pred)),
                "r2": r2_score(y_test, y_pred)
            }
            
            # Cross-validation
            cv_scores = cross_val_score(self.model, X, y, cv=5)
            metrics["cv_mean"] = cv_scores.mean()
            metrics["cv_std"] = cv_scores.std()
            
            logger.info(f"Model training completed. R²: {metrics['r2']:.3f}")
            
            return metrics
            
        except Exception as e:
            logger.error(f"Model training failed: {str(e)}")
            raise
    
    def predict_cost(self, features: Dict[str, float]) -> Tuple[float, float]:
        """
        Predict manufacturing cost.
        
        Args:
            features: Dictionary with feature values
            
        Returns:
            Tuple of (predicted_cost, confidence_score)
        """
        try:
            if self.model is None:
                self.load_model()
            
            # Prepare feature vector
            feature_vector = np.array([
                features.get(feature, 0.0) for feature in self.feature_names
            ]).reshape(1, -1)
            
            # Make prediction
            predicted_cost = self.model.predict(feature_vector)[0]
            
            # Calculate confidence (simplified)
            confidence = 0.85  # TODO: Implement proper confidence calculation
            
            return predicted_cost, confidence
            
        except Exception as e:
            logger.error(f"Cost prediction failed: {str(e)}")
            return 0.0, 0.0
    
    def save_model(self) -> None:
        """Save the trained model to disk."""
        try:
            if self.model is not None:
                joblib.dump(self.model, self.model_path)
                logger.info(f"Model saved to {self.model_path}")
            else:
                logger.warning("No model to save")
                
        except Exception as e:
            logger.error(f"Model save failed: {str(e)}")
            raise
    
    def load_model(self) -> None:
        """Load the trained model from disk."""
        try:
            self.model = joblib.load(self.model_path)
            logger.info(f"Model loaded from {self.model_path}")
            
        except Exception as e:
            logger.error(f"Model load failed: {str(e)}")
            raise
    
    def get_feature_importance(self) -> Dict[str, float]:
        """
        Get feature importance scores.
        
        Returns:
            Dictionary with feature importance scores
        """
        try:
            if self.model is None:
                self.load_model()
            
            importance = self.model.feature_importances_
            feature_importance = dict(zip(self.feature_names, importance))
            
            return feature_importance
            
        except Exception as e:
            logger.error(f"Feature importance calculation failed: {str(e)}")
            return {}


# Global model instance
cost_estimator = CostEstimatorModel() 