#!/usr/bin/env python3
"""
Claim Risk Scoring Logic for OpSide Certainty Engine
ML models for predicting claim success probability and refund timeline
"""

import pickle
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
import json
import os
from typing import Dict, Any, Tuple, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ClaimRiskScoringEngine:
    """
    ML-based claim risk scoring engine for OpSide
    Predicts success probability and refund timeline for claims
    """
    
    def __init__(self, models_dir: str = "models"):
        self.models_dir = models_dir
        self.success_model = None
        self.timeline_model = None
        self.label_encoders = {}
        self.scaler = None
        self.is_trained = False
        
        # Ensure models directory exists
        os.makedirs(models_dir, exist_ok=True)
        
        # Load existing models if available
        self._load_models()
    
    def _load_models(self) -> None:
        """Load pre-trained models from disk"""
        try:
            model_files = {
                'success_model': 'success_probability_model.pkl',
                'timeline_model': 'refund_timeline_model.pkl',
                'label_encoders': 'label_encoders.pkl',
                'scaler': 'feature_scaler.pkl'
            }
            
            # Check if all model files exist
            all_exist = all(
                os.path.exists(os.path.join(self.models_dir, filename))
                for filename in model_files.values()
            )
            
            if all_exist:
                logger.info("Loading pre-trained models...")
                
                with open(os.path.join(self.models_dir, model_files['success_model']), 'rb') as f:
                    self.success_model = pickle.load(f)
                
                with open(os.path.join(self.models_dir, model_files['timeline_model']), 'rb') as f:
                    self.timeline_model = pickle.load(f)
                
                with open(os.path.join(self.models_dir, model_files['label_encoders']), 'rb') as f:
                    self.label_encoders = pickle.load(f)
                
                with open(os.path.join(self.models_dir, model_files['scaler']), 'rb') as f:
                    self.scaler = pickle.load(f)
                
                self.is_trained = True
                logger.info("Models loaded successfully")
            else:
                logger.info("No pre-trained models found. Will train new models.")
                
        except Exception as e:
            logger.warning(f"Error loading models: {e}. Will train new models.")
    
    def _save_models(self) -> None:
        """Save trained models to disk"""
        try:
            model_files = {
                'success_model': 'success_probability_model.pkl',
                'timeline_model': 'refund_timeline_model.pkl',
                'label_encoders': 'label_encoders.pkl',
                'scaler': 'feature_scaler.pkl'
            }
            
            with open(os.path.join(self.models_dir, model_files['success_model']), 'wb') as f:
                pickle.dump(self.success_model, f)
            
            with open(os.path.join(self.models_dir, model_files['timeline_model']), 'wb') as f:
                pickle.dump(self.timeline_model, f)
            
            with open(os.path.join(self.models_dir, model_files['label_encoders']), 'wb') as f:
                pickle.dump(self.label_encoders, f)
            
            with open(os.path.join(self.models_dir, model_files['scaler']), 'wb') as f:
                pickle.dump(self.scaler, f)
            
            logger.info("Models saved successfully")
            
        except Exception as e:
            logger.error(f"Error saving models: {e}")
            raise
    
    def _generate_synthetic_data(self, n_samples: int = 10000) -> Tuple[pd.DataFrame, pd.Series, pd.Series]:
        """
        Generate synthetic training data for claim risk scoring
        Returns: (features_df, success_labels, timeline_labels)
        """
        np.random.seed(42)  # For reproducibility
        
        # Define categorical values
        discrepancy_types = ['missing_refund', 'late_shipment', 'damaged_item', 'wrong_item', 'overcharge', 'duplicate_charge']
        marketplaces = ['amazon', 'shopify', 'stripe', 'ebay', 'walmart', 'etsy']
        
        # Generate synthetic features
        data = {
            'discrepancy_type': np.random.choice(discrepancy_types, n_samples),
            'discrepancy_size': np.random.exponential(100, n_samples),  # Exponential distribution for claim amounts
            'days_outstanding': np.random.poisson(30, n_samples),  # Poisson distribution for days
            'marketplace': np.random.choice(marketplaces, n_samples),
            'historical_payout_rate': np.random.beta(2, 3, n_samples)  # Beta distribution for rates (0-1)
        }
        
        df = pd.DataFrame(data)
        
        # Generate success probability based on features
        success_prob = self._calculate_synthetic_success_probability(df)
        success_labels = (np.random.random(n_samples) < success_prob).astype(int)
        
        # Generate refund timeline based on features and success
        timeline_labels = self._calculate_synthetic_timeline(df, success_labels)
        
        return df, pd.Series(success_labels), pd.Series(timeline_labels)
    
    def _calculate_synthetic_success_probability(self, df: pd.DataFrame) -> np.ndarray:
        """Calculate synthetic success probability based on features"""
        prob = np.zeros(len(df))
        
        # Base probability
        prob += 0.5
        
        # Discrepancy type effects
        type_effects = {
            'missing_refund': 0.2,
            'late_shipment': 0.1,
            'damaged_item': 0.15,
            'wrong_item': 0.25,
            'overcharge': 0.3,
            'duplicate_charge': 0.35
        }
        
        for claim_type, effect in type_effects.items():
            prob += effect * (df['discrepancy_type'] == claim_type)
        
        # Marketplace effects
        marketplace_effects = {
            'amazon': 0.1,
            'shopify': 0.05,
            'stripe': 0.08,
            'ebay': -0.05,
            'walmart': 0.02,
            'etsy': -0.1
        }
        
        for marketplace, effect in marketplace_effects.items():
            prob += effect * (df['marketplace'] == marketplace)
        
        # Size effects (smaller claims more likely to succeed)
        prob -= 0.0001 * df['discrepancy_size']
        
        # Days outstanding effects (older claims less likely to succeed)
        prob -= 0.005 * df['days_outstanding']
        
        # Historical payout rate effects
        prob += 0.3 * df['historical_payout_rate']
        
        # Ensure probabilities are between 0 and 1
        prob = np.clip(prob, 0.01, 0.99)
        
        return prob
    
    def _calculate_synthetic_timeline(self, df: pd.DataFrame, success_labels: pd.Series) -> np.ndarray:
        """Calculate synthetic refund timeline based on features"""
        timeline = np.zeros(len(df))
        
        # Base timeline (days)
        timeline += 15
        
        # Success effect (successful claims processed faster)
        timeline -= 5 * success_labels
        
        # Discrepancy type effects
        type_timeline_effects = {
            'missing_refund': -2,
            'late_shipment': 3,
            'damaged_item': 5,
            'wrong_item': 2,
            'overcharge': -1,
            'duplicate_charge': -3
        }
        
        for claim_type, effect in type_timeline_effects.items():
            timeline += effect * (df['discrepancy_type'] == claim_type)
        
        # Marketplace effects
        marketplace_timeline_effects = {
            'amazon': -3,
            'shopify': 2,
            'stripe': -1,
            'ebay': 5,
            'walmart': 3,
            'etsy': 7
        }
        
        for marketplace, effect in marketplace_timeline_effects.items():
            timeline += effect * (df['marketplace'] == marketplace)
        
        # Size effects (larger claims take longer)
        timeline += 0.01 * df['discrepancy_size']
        
        # Days outstanding effects (older claims take longer)
        timeline += 0.1 * df['days_outstanding']
        
        # Historical payout rate effects (higher rates = faster processing)
        timeline -= 5 * df['historical_payout_rate']
        
        # Add some noise
        timeline += np.random.normal(0, 2, len(df))
        
        # Ensure timeline is positive and reasonable
        timeline = np.clip(timeline, 1, 90)
        
        return timeline
    
    def _preprocess_features(self, df: pd.DataFrame, is_training: bool = False) -> np.ndarray:
        """Preprocess features for ML models"""
        df_processed = df.copy()
        
        # Encode categorical variables
        categorical_cols = ['discrepancy_type', 'marketplace']
        
        for col in categorical_cols:
            if is_training:
                le = LabelEncoder()
                df_processed[col] = le.fit_transform(df_processed[col])
                self.label_encoders[col] = le
            else:
                if col in self.label_encoders:
                    # Handle unseen categories
                    unique_values = self.label_encoders[col].classes_
                    df_processed[col] = df_processed[col].map(
                        lambda x: x if x in unique_values else unique_values[0]
                    )
                    df_processed[col] = self.label_encoders[col].transform(df_processed[col])
                else:
                    raise ValueError(f"Label encoder for {col} not found. Train the model first.")
        
        # Scale numerical features
        numerical_cols = ['discrepancy_size', 'days_outstanding', 'historical_payout_rate']
        
        if is_training:
            self.scaler = StandardScaler()
            df_processed[numerical_cols] = self.scaler.fit_transform(df_processed[numerical_cols])
        else:
            if self.scaler is not None:
                df_processed[numerical_cols] = self.scaler.transform(df_processed[numerical_cols])
            else:
                raise ValueError("Scaler not found. Train the model first.")
        
        return df_processed.values
    
    def train_models(self, n_samples: int = 10000) -> Dict[str, float]:
        """
        Train the ML models on synthetic data
        Returns: Dictionary with training metrics
        """
        logger.info(f"Training models with {n_samples} synthetic samples...")
        
        # Generate synthetic data
        df, success_labels, timeline_labels = self._generate_synthetic_data(n_samples)
        
        # Preprocess features
        X = self._preprocess_features(df, is_training=True)
        
        # Split data
        X_train, X_test, y_success_train, y_success_test, y_timeline_train, y_timeline_test = train_test_split(
            X, success_labels, timeline_labels, test_size=0.2, random_state=42
        )
        
        # Train success probability model (Logistic Regression)
        logger.info("Training success probability model...")
        self.success_model = LogisticRegression(random_state=42, max_iter=1000)
        self.success_model.fit(X_train, y_success_train)
        
        # Train refund timeline model (Linear Regression)
        logger.info("Training refund timeline model...")
        self.timeline_model = LinearRegression()
        self.timeline_model.fit(X_train, y_timeline_train)
        
        # Evaluate models
        success_pred = self.success_model.predict(X_test)
        success_prob_pred = self.success_model.predict_proba(X_test)[:, 1]
        timeline_pred = self.timeline_model.predict(X_test)
        
        metrics = {
            'success_accuracy': accuracy_score(y_success_test, success_pred),
            'success_auc': np.mean(success_prob_pred),  # Simplified AUC approximation
            'timeline_rmse': np.sqrt(mean_squared_error(y_timeline_test, timeline_pred)),
            'timeline_r2': r2_score(y_timeline_test, timeline_pred)
        }
        
        logger.info(f"Training completed. Metrics: {metrics}")
        
        # Save models
        self._save_models()
        self.is_trained = True
        
        return metrics
    
    def score_claim(self, claim: Dict[str, Any]) -> Dict[str, Any]:
        """
        Score a claim and return success probability and refund timeline
        
        Args:
            claim: Dictionary with claim features
                - discrepancy_type: str
                - discrepancy_size: float
                - days_outstanding: int
                - marketplace: str
                - historical_payout_rate: float
        
        Returns:
            Dictionary with scoring results
                - success_probability: float (0-1)
                - refund_timeline_days: float
                - confidence_score: float (0-1)
                - risk_level: str (Low, Medium, High)
        """
        if not self.is_trained:
            logger.warning("Models not trained. Training with synthetic data...")
            self.train_models()
        
        # Validate input
        required_fields = ['discrepancy_type', 'discrepancy_size', 'days_outstanding', 'marketplace', 'historical_payout_rate']
        for field in required_fields:
            if field not in claim:
                raise ValueError(f"Missing required field: {field}")
        
        # Convert to DataFrame
        df = pd.DataFrame([claim])
        
        # Preprocess features
        X = self._preprocess_features(df, is_training=False)
        
        # Make predictions
        success_probability = float(self.success_model.predict_proba(X)[0, 1])
        refund_timeline_days = float(self.timeline_model.predict(X)[0])
        
        # Calculate confidence score (simplified)
        confidence_score = 0.8  # Placeholder - could be based on model uncertainty
        
        # Determine risk level
        if success_probability < 0.3:
            risk_level = "Low"
        elif success_probability < 0.7:
            risk_level = "Medium"
        else:
            risk_level = "High"
        
        # Ensure timeline is reasonable
        refund_timeline_days = max(1, min(90, refund_timeline_days))
        
        result = {
            'success_probability': round(success_probability, 4),
            'refund_timeline_days': round(refund_timeline_days, 1),
            'confidence_score': round(confidence_score, 4),
            'risk_level': risk_level,
            'model_version': '1.0.0',
            'features_used': list(claim.keys())
        }
        
        logger.info(f"Claim scored: {result}")
        return result
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the trained models"""
        return {
            'is_trained': self.is_trained,
            'models_dir': self.models_dir,
            'success_model_type': type(self.success_model).__name__ if self.success_model else None,
            'timeline_model_type': type(self.timeline_model).__name__ if self.timeline_model else None,
            'categorical_features': list(self.label_encoders.keys()) if self.label_encoders else [],
            'numerical_features': ['discrepancy_size', 'days_outstanding', 'historical_payout_rate']
        }

# Global instance
scoring_engine = ClaimRiskScoringEngine()

def score_claim(claim: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to score a claim
    This is the main function that will be called from the backend
    """
    return scoring_engine.score_claim(claim)

def train_models(n_samples: int = 10000) -> Dict[str, float]:
    """Convenience function to train models"""
    return scoring_engine.train_models(n_samples)

def get_model_info() -> Dict[str, Any]:
    """Convenience function to get model information"""
    return scoring_engine.get_model_info()

if __name__ == "__main__":
    import argparse
    import sys
    
    parser = argparse.ArgumentParser(description='OpSide Claim Risk Scoring Engine')
    parser.add_argument('--function', required=True, help='Function to call')
    parser.add_argument('--args', required=True, help='JSON arguments')
    
    args = parser.parse_args()
    
    try:
        function_args = json.loads(args.args)
        
        if args.function == 'score_claim':
            result = score_claim(function_args)
            print(f"JSON_RESULT:{json.dumps(result)}")
            
        elif args.function == 'train_models':
            n_samples = function_args.get('n_samples', 10000)
            result = train_models(n_samples)
            print(f"JSON_RESULT:{json.dumps(result)}")
            
        elif args.function == 'get_model_info':
            result = get_model_info()
            print(f"JSON_RESULT:{json.dumps(result)}")
            
        elif args.function == 'check_environment':
            # Check if required packages are available
            try:
                import sklearn
                import pandas
                import numpy
                result = {'available': True, 'packages': ['sklearn', 'pandas', 'numpy']}
            except ImportError as e:
                result = {'available': False, 'error': str(e)}
            print(f"JSON_RESULT:{json.dumps(result)}")
            
        else:
            print(f"JSON_RESULT:{json.dumps({'error': f'Unknown function: {args.function}'})}")
            sys.exit(1)
            
    except Exception as e:
        print(f"JSON_RESULT:{json.dumps({'error': str(e)})}")
        sys.exit(1)
