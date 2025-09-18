#!/usr/bin/env python3
"""
Enhanced Certainty Engine for OpSide
Advanced timeline prediction and risk assessment with uncertainty estimation
"""

import pickle
import numpy as np
import pandas as pd
from typing import Dict, Any
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
import xgboost as xgb
import lightgbm as lgb
from catboost import CatBoostClassifier, CatBoostRegressor
import joblib
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EnhancedCertaintyEngine:
    """Enhanced Certainty Engine with advanced timeline prediction and risk assessment"""
    
    def __init__(self, models_dir: str = "models"):
        self.models_dir = Path(models_dir)
        self.models_dir.mkdir(exist_ok=True)
        
        # Timeline models (specialized by complexity)
        self.quick_refund_model = None      # <7 days
        self.standard_refund_model = None   # 7-30 days
        self.complex_refund_model = None    # >30 days
        
        # Risk assessment models
        self.initial_screener = None
        self.detailed_analyzer = None
        self.calibrator = None
        
        # Preprocessing
        self.scaler = StandardScaler()
        self.label_encoders = {}
        self.is_trained = False
        
    def train_models(self, n_samples: int = 20000) -> Dict[str, Any]:
        """Train all enhanced certainty engine models"""
        logger.info("Starting enhanced certainty engine training...")
        
        # Generate training data
        X, timeline_targets, success_targets = self._generate_training_data(n_samples)
        
        # Split data
        X_train, X_val, timeline_train, timeline_val, success_train, success_val = train_test_split(
            X, timeline_targets, success_targets, test_size=0.2, random_state=42
        )
        
        # Train timeline models
        timeline_metrics = self._train_timeline_models(X_train, timeline_train, X_val, timeline_val)
        
        # Train risk models
        risk_metrics = self._train_risk_models(X_train, success_train, X_val, success_val)
        
        # Save models
        self._save_models()
        
        self.is_trained = True
        logger.info("Enhanced certainty engine training completed")
        
        return {
            'timeline': timeline_metrics,
            'risk': risk_metrics
        }
    
    def predict_refund_timeline(self, claim_features: Dict[str, Any]) -> Dict[str, Any]:
        """Predict refund timeline with confidence intervals"""
        if not self.is_trained:
            raise ValueError("Models must be trained before making predictions")
        
        df = pd.DataFrame([claim_features])
        df_processed = self._preprocess_features(df, is_training=False)
        
        # Assess complexity and route to appropriate model
        complexity_score = self._assess_complexity(df_processed)
        
        if complexity_score < 0.3:
            model = self.quick_refund_model
            model_name = "quick_refund"
        elif complexity_score < 0.7:
            model = self.standard_refund_model
            model_name = "standard_refund"
        else:
            model = self.complex_refund_model
            model_name = "complex_refund"
        
        # Make prediction
        prediction = model.predict(df_processed)[0]
        prediction = max(1, prediction)  # Ensure positive timeline
        
        # Calculate confidence interval
        confidence_interval = self._calculate_confidence_interval(prediction, complexity_score)
        
        return {
            'timeline_days': prediction,
            'confidence_interval': confidence_interval,
            'complexity_score': complexity_score,
            'model_used': model_name
        }
    
    def assess_claim_risk(self, claim_features: Dict[str, Any]) -> Dict[str, Any]:
        """Assess claim risk with calibrated probabilities"""
        if not self.is_trained:
            raise ValueError("Models must be trained before making predictions")
        
        df = pd.DataFrame([claim_features])
        df_processed = self._preprocess_features(df, is_training=False)
        
        # Multi-stage assessment
        initial_score = self.initial_screener.predict_proba(df_processed)[0, 1]
        
        if 0.3 < initial_score < 0.7:
            detailed_score = self.detailed_analyzer.predict_proba(df_processed)[0, 1]
            final_score = 0.6 * initial_score + 0.4 * detailed_score
        else:
            final_score = initial_score
        
        # Calibrated probability
        calibrated_score = self.calibrator.predict_proba(df_processed)[0, 1]
        
        return {
            'success_probability': calibrated_score,
            'risk_category': self._categorize_risk(calibrated_score),
            'confidence_level': 0.9 if abs(calibrated_score - 0.5) > 0.3 else 0.7,
            'stage_scores': {
                'initial_screening': initial_score,
                'detailed_analysis': detailed_score if 0.3 < initial_score < 0.7 else None,
                'calibrated': calibrated_score
            }
        }
    
    def assess_with_evidence(self, claim_features: Dict[str, Any], evidence_result: Dict[str, Any]) -> Dict[str, Any]:
        """Enhanced risk assessment incorporating evidence quality"""
        base_assessment = self.assess_claim_risk(claim_features)
        
        # Enhance with evidence quality
        evidence_quality = evidence_result.get('evidenceQuality', {}).get('overall_confidence', 0.5)
        evidence_enhancement = (evidence_quality - 0.5) * 0.2  # ±10% adjustment
        
        adjusted_probability = base_assessment['success_probability'] + evidence_enhancement
        adjusted_probability = np.clip(adjusted_probability, 0.01, 0.99)
        
        return {
            **base_assessment,
            'success_probability': adjusted_probability,
            'evidence_enhancement': evidence_enhancement,
            'evidence_quality': evidence_result.get('evidenceQuality', {}),
            'risk_category': self._categorize_risk(adjusted_probability)
        }
    
    def _generate_training_data(self, n_samples: int) -> tuple:
        """Generate comprehensive training data"""
        np.random.seed(42)
        
        discrepancy_types = ['missing_refund', 'late_shipment', 'damaged_item', 'wrong_item', 'overcharge']
        marketplaces = ['amazon', 'shopify', 'stripe', 'ebay', 'walmart']
        
        data = {
            'discrepancy_type': np.random.choice(discrepancy_types, n_samples),
            'discrepancy_size': np.random.exponential(150, n_samples),
            'days_outstanding': np.random.poisson(45, n_samples),
            'marketplace': np.random.choice(marketplaces, n_samples),
            'historical_payout_rate': np.random.beta(3, 2, n_samples),
            'seller_rating': np.random.normal(4.2, 0.8, n_samples).clip(1, 5),
            'evidence_quality': np.random.beta(2, 1, n_samples)
        }
        
        df = pd.DataFrame(data)
        
        # Generate success probability
        success_prob = self._calculate_success_probability(df)
        success_labels = (np.random.random(n_samples) < success_prob).astype(int)
        
        # Generate timeline
        timeline_labels = self._calculate_timeline(df, success_labels)
        
        return df, pd.Series(timeline_labels), pd.Series(success_labels)
    
    def _calculate_success_probability(self, df: pd.DataFrame) -> np.ndarray:
        """Calculate realistic success probability"""
        prob = np.zeros(len(df))
        prob += 0.4  # Base probability
        
        # Type effects
        type_effects = {'missing_refund': 0.25, 'late_shipment': 0.15, 'damaged_item': 0.20, 
                       'wrong_item': 0.30, 'overcharge': 0.35}
        for claim_type, effect in type_effects.items():
            prob += effect * (df['discrepancy_type'] == claim_type)
        
        # Marketplace effects
        marketplace_effects = {'amazon': 0.15, 'shopify': 0.10, 'stripe': 0.12, 'ebay': -0.05, 'walmart': 0.08}
        for marketplace, effect in marketplace_effects.items():
            prob += effect * (df['marketplace'] == marketplace)
        
        # Other effects
        prob -= 0.0002 * df['discrepancy_size']
        prob -= 0.008 * df['days_outstanding']
        prob += 0.4 * df['historical_payout_rate']
        prob += 0.1 * (df['seller_rating'] - 3) / 2
        prob += 0.3 * df['evidence_quality']
        
        return np.clip(prob, 0.01, 0.99)
    
    def _calculate_timeline(self, df: pd.DataFrame, success_labels: pd.Series) -> np.ndarray:
        """Calculate realistic timeline"""
        timeline = np.zeros(len(df))
        timeline += 20  # Base timeline
        timeline -= 8 * success_labels  # Success effect
        
        # Type effects
        type_effects = {'missing_refund': -5, 'late_shipment': -3, 'damaged_item': 2, 
                       'wrong_item': -2, 'overcharge': -4}
        for claim_type, effect in type_effects.items():
            timeline += effect * (df['discrepancy_type'] == claim_type)
        
        # Marketplace effects
        marketplace_effects = {'amazon': -3, 'shopify': -1, 'stripe': -2, 'ebay': 5, 'walmart': 2}
        for marketplace, effect in marketplace_effects.items():
            timeline += effect * (df['marketplace'] == marketplace)
        
        # Other effects
        timeline += 0.01 * df['discrepancy_size']
        timeline += 0.1 * df['days_outstanding']
        timeline -= 5 * df['evidence_quality']
        timeline -= 2 * (df['seller_rating'] - 3) / 2
        
        return np.clip(timeline, 1, 90)
    
    def _train_timeline_models(self, X_train: pd.DataFrame, y_train: pd.Series, 
                              X_val: pd.DataFrame, y_val: pd.Series) -> Dict[str, float]:
        """Train specialized timeline models"""
        X_train_processed = self._preprocess_features(X_train, is_training=True)
        X_val_processed = self._preprocess_features(X_val, is_training=False)
        
        # Quick refund model
        self.quick_refund_model = CatBoostRegressor(iterations=300, depth=6, learning_rate=0.05, verbose=False)
        quick_mask = y_train < 7
        if quick_mask.sum() > 0:
            self.quick_refund_model.fit(X_train_processed[quick_mask], y_train[quick_mask])
        
        # Standard refund model
        self.standard_refund_model = LightGBMRegressor(objective='regression', max_depth=8, learning_rate=0.03, n_estimators=400)
        standard_mask = (y_train >= 7) & (y_train <= 30)
        if standard_mask.sum() > 0:
            self.standard_refund_model.fit(X_train_processed[standard_mask], y_train[standard_mask])
        
        # Complex refund model
        self.complex_refund_model = XGBoostRegressor(objective='reg:squarederror', max_depth=7, learning_rate=0.02, n_estimators=500)
        complex_mask = y_train > 30
        if complex_mask.sum() > 0:
            self.complex_refund_model.fit(X_train_processed[complex_mask], y_train[complex_mask])
        
        # Evaluate
        val_predictions = []
        for i, row in X_val_processed.iterrows():
            complexity = self._assess_complexity(row.to_frame().T)
            if complexity < 0.3:
                pred = self.quick_refund_model.predict(row.to_frame().T)[0]
            elif complexity < 0.7:
                pred = self.standard_refund_model.predict(row.to_frame().T)[0]
            else:
                pred = self.complex_refund_model.predict(row.to_frame().T)[0]
            val_predictions.append(pred)
        
        mae = mean_squared_error(y_val, val_predictions, squared=False)
        r2 = r2_score(y_val, val_predictions)
        
        return {'mae': mae, 'r2': r2}
    
    def _train_risk_models(self, X_train: pd.DataFrame, y_train: pd.Series,
                          X_val: pd.DataFrame, y_val: pd.Series) -> Dict[str, float]:
        """Train risk assessment models"""
        X_train_processed = self._preprocess_features(X_train, is_training=True)
        X_val_processed = self._preprocess_features(X_val, is_training=False)
        
        # Initial screener
        self.initial_screener = RandomForestClassifier(n_estimators=200, max_depth=10, class_weight='balanced')
        self.initial_screener.fit(X_train_processed, y_train)
        
        # Detailed analyzer
        self.detailed_analyzer = XGBoostClassifier(objective='binary:logistic', max_depth=8, learning_rate=0.05, n_estimators=300)
        self.detailed_analyzer.fit(X_train_processed, y_train)
        
        # Calibrator
        from sklearn.calibration import CalibratedClassifierCV
        self.calibrator = CalibratedClassifierCV(self.detailed_analyzer, cv=5, method='isotonic')
        self.calibrator.fit(X_train_processed, y_train)
        
        # Evaluate
        val_predictions = self.calibrator.predict(X_val_processed)
        val_probabilities = self.calibrator.predict_proba(X_val_processed)[:, 1]
        
        accuracy = accuracy_score(y_val, val_predictions)
        
        return {'accuracy': accuracy}
    
    def _assess_complexity(self, df: pd.DataFrame) -> float:
        """Assess claim complexity"""
        complexity = 0.0
        
        if 'discrepancy_size' in df.columns:
            size = df['discrepancy_size'].iloc[0]
            complexity += min(0.3, size / 1000)
        
        if 'days_outstanding' in df.columns:
            days = df['days_outstanding'].iloc[0]
            complexity += min(0.2, days / 100)
        
        if 'evidence_quality' in df.columns:
            quality = df['evidence_quality'].iloc[0]
            complexity += (1 - quality) * 0.3
        
        return min(1.0, complexity)
    
    def _calculate_confidence_interval(self, prediction: float, complexity: float) -> Dict[str, float]:
        """Calculate confidence interval"""
        uncertainty = 0.1 + complexity * 0.2
        return {
            'lower': max(1, prediction * (1 - uncertainty)),
            'upper': min(90, prediction * (1 + uncertainty)),
            'confidence_level': 0.95
        }
    
    def _categorize_risk(self, probability: float) -> str:
        """Categorize risk"""
        if probability < 0.3:
            return 'Low'
        elif probability < 0.7:
            return 'Medium'
        else:
            return 'High'
    
    def _preprocess_features(self, df: pd.DataFrame, is_training: bool) -> pd.DataFrame:
        """Preprocess features"""
        df_processed = df.copy()
        
        # Encode categorical variables
        categorical_cols = ['discrepancy_type', 'marketplace']
        for col in categorical_cols:
            if col in df_processed.columns:
                if is_training:
                    le = LabelEncoder()
                    df_processed[col] = le.fit_transform(df_processed[col].fillna('unknown'))
                    self.label_encoders[col] = le
                else:
                    if col in self.label_encoders:
                        unique_values = self.label_encoders[col].classes_
                        df_processed[col] = df_processed[col].map(
                            lambda x: x if x in unique_values else unique_values[0]
                        )
                        df_processed[col] = self.label_encoders[col].transform(df_processed[col])
        
        # Scale numerical features
        numerical_cols = ['discrepancy_size', 'days_outstanding', 'historical_payout_rate', 
                         'seller_rating', 'evidence_quality']
        available_numerical = [col for col in numerical_cols if col in df_processed.columns]
        
        if available_numerical:
            if is_training:
                df_processed[available_numerical] = self.scaler.fit_transform(df_processed[available_numerical])
            else:
                df_processed[available_numerical] = self.scaler.transform(df_processed[available_numerical])
        
        return df_processed
    
    def _save_models(self):
        """Save trained models"""
        joblib.dump(self.quick_refund_model, self.models_dir / 'enhanced_quick_refund_model.pkl')
        joblib.dump(self.standard_refund_model, self.models_dir / 'enhanced_standard_refund_model.pkl')
        joblib.dump(self.complex_refund_model, self.models_dir / 'enhanced_complex_refund_model.pkl')
        joblib.dump(self.initial_screener, self.models_dir / 'enhanced_initial_screener.pkl')
        joblib.dump(self.detailed_analyzer, self.models_dir / 'enhanced_detailed_analyzer.pkl')
        joblib.dump(self.calibrator, self.models_dir / 'enhanced_calibrator.pkl')
        joblib.dump(self.scaler, self.models_dir / 'enhanced_scaler.pkl')
        joblib.dump(self.label_encoders, self.models_dir / 'enhanced_label_encoders.pkl')
        logger.info(f"Enhanced models saved to {self.models_dir}")
    
    def load_models(self):
        """Load trained models"""
        try:
            self.quick_refund_model = joblib.load(self.models_dir / 'enhanced_quick_refund_model.pkl')
            self.standard_refund_model = joblib.load(self.models_dir / 'enhanced_standard_refund_model.pkl')
            self.complex_refund_model = joblib.load(self.models_dir / 'enhanced_complex_refund_model.pkl')
            self.initial_screener = joblib.load(self.models_dir / 'enhanced_initial_screener.pkl')
            self.detailed_analyzer = joblib.load(self.models_dir / 'enhanced_detailed_analyzer.pkl')
            self.calibrator = joblib.load(self.models_dir / 'enhanced_calibrator.pkl')
            self.scaler = joblib.load(self.models_dir / 'enhanced_scaler.pkl')
            self.label_encoders = joblib.load(self.models_dir / 'enhanced_label_encoders.pkl')
            self.is_trained = True
            logger.info("Enhanced models loaded successfully")
        except Exception as e:
            logger.error(f"Error loading enhanced models: {e}")
            raise


if __name__ == "__main__":
    # Example usage
    engine = EnhancedCertaintyEngine()
    
    # Train models
    results = engine.train_models(n_samples=5000)
    print(f"Training results: {results}")
    
    # Test predictions
    test_features = {
        'discrepancy_type': 'missing_refund',
        'discrepancy_size': 150.0,
        'days_outstanding': 30,
        'marketplace': 'amazon',
        'historical_payout_rate': 0.8,
        'seller_rating': 4.5,
        'evidence_quality': 0.9
    }
    
    timeline_result = engine.predict_refund_timeline(test_features)
    risk_result = engine.assess_claim_risk(test_features)
    
    print(f"Timeline: {timeline_result}")
    print(f"Risk: {risk_result}")

