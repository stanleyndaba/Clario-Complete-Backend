#!/usr/bin/env python3
"""
Enhanced ML Detector for FBA Claims System
Combines machine learning predictions with rules engine for robust claim detection
"""

import pandas as pd
import numpy as np
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import pickle
import json
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from rules_engine.rules_engine import RulesEngine, ClaimData, RuleResult
from data_collection.data_collector import DataCollectionOrchestrator

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class MLPrediction:
    """ML model prediction result"""
    claimable_probability: float
    prediction_class: str
    confidence_score: float
    feature_importance: Dict[str, float]
    model_version: str
    prediction_timestamp: datetime

@dataclass
class CombinedDecision:
    """Combined decision from ML + Rules"""
    final_decision: str
    ml_prediction: MLPrediction
    rules_evaluation: List[RuleResult]
    rules_decision: Dict[str, Any]
    can_proceed: bool
    recommended_amount: Optional[float] = None
    evidence_required: bool = False
    confidence_level: str = "medium"
    reasoning: str = ""

class EnhancedMLDetector:
    """Enhanced ML detector that combines ML predictions with rules engine"""
    
    def __init__(self, model_path: str, rules_engine: RulesEngine):
        self.model_path = model_path
        self.rules_engine = rules_engine
        self.model = self._load_model()
        self.feature_columns = None
        self.is_loaded = False
        
        if self.model:
            self.feature_columns = self.model.get('feature_columns', [])
            self.is_loaded = True
            logger.info(f"✅ ML model loaded successfully with {len(self.feature_columns)} features")
        else:
            logger.warning("⚠️ ML model not loaded, will use rules-only mode")
    
    def _load_model(self) -> Optional[Dict[str, Any]]:
        """Load the trained ML model"""
        try:
            if Path(self.model_path).exists():
                with open(self.model_path, 'rb') as f:
                    model_data = pickle.load(f)
                    logger.info(f"✅ Model loaded from {self.model_path}")
                    return model_data
            else:
                logger.warning(f"⚠️ Model file not found: {self.model_path}")
                return None
        except Exception as e:
            logger.error(f"❌ Error loading model: {e}")
            return None
    
    def prepare_features(self, claim_data: ClaimData, additional_data: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        """Prepare features for ML prediction"""
        try:
            # Create feature dictionary
            features = {}
            
            # Basic claim features
            features['amount_requested'] = claim_data.amount_requested
            features['quantity_affected'] = claim_data.quantity_affected
            
            # Calculate derived features
            if claim_data.cost_per_unit:
                features['cost_per_unit'] = claim_data.cost_per_unit
                features['amount_per_unit'] = claim_data.amount_requested / claim_data.quantity_affected
                features['cost_ratio'] = claim_data.amount_requested / (claim_data.cost_per_unit * claim_data.quantity_affected)
            else:
                features['cost_per_unit'] = 0.0
                features['amount_per_unit'] = 0.0
                features['cost_ratio'] = 0.0
            
            # Time-based features
            if claim_data.shipment_date:
                features['days_since_shipment'] = (datetime.now() - claim_data.shipment_date).days
                features['months_since_shipment'] = features['days_since_shipment'] / 30.44
            else:
                features['days_since_shipment'] = 0
                features['months_since_shipment'] = 0
            
            # Categorical encodings
            claim_type_mapping = {
                'lost_inventory': 0, 'damaged_goods': 1, 'fee_overcharge': 2,
                'missing_reimbursement': 3, 'dimension_weight_error': 4,
                'destroyed_inventory': 5, 'high_value_edge_case': 6
            }
            features['claim_type_encoded'] = claim_type_mapping.get(claim_data.claim_type, 7)
            
            marketplace_mapping = {'US': 0, 'CA': 1, 'UK': 2, 'DE': 3, 'JP': 4}
            features['marketplace_encoded'] = marketplace_mapping.get(claim_data.marketplace, 5)
            
            # Evidence features
            features['evidence_attached'] = 1 if claim_data.evidence_attached else 0
            
            # Additional features from external data
            if additional_data:
                features.update(additional_data)
            
            # Create DataFrame
            df = pd.DataFrame([features])
            
            # Ensure all required features exist
            if self.feature_columns:
                missing_features = set(self.feature_columns) - set(df.columns)
                for feature in missing_features:
                    df[feature] = 0.0  # Default value for missing features
                
                # Select only required features in correct order
                df = df[self.feature_columns]
            
            logger.info(f"✅ Features prepared: {df.shape}")
            return df
            
        except Exception as e:
            logger.error(f"❌ Error preparing features: {e}")
            return pd.DataFrame()
    
    def predict(self, claim_data: ClaimData, additional_data: Optional[Dict[str, Any]] = None) -> MLPrediction:
        """Make ML prediction for a claim"""
        try:
            if not self.is_loaded:
                raise ValueError("ML model not loaded")
            
            # Prepare features
            features_df = self.prepare_features(claim_data, additional_data)
            if features_df.empty:
                raise ValueError("Failed to prepare features")
            
            # Make prediction using the loaded model
            if 'model' in self.model and hasattr(self.model['model'], 'predict'):
                # If it's a scikit-learn model
                prediction_prob = self.model['model'].predict_proba(features_df)[0][1]
                prediction_class = "claimable" if prediction_prob > 0.5 else "not_claimable"
            else:
                # Use our custom model logic
                prediction_prob = self._custom_predict(features_df)
                prediction_class = "claimable" if prediction_prob > 0.5 else "not_claimable"
            
            # Calculate confidence score
            confidence_score = abs(prediction_prob - 0.5) * 2
            
            # Get feature importance
            feature_importance = self._get_feature_importance(features_df)
            
            return MLPrediction(
                claimable_probability=prediction_prob,
                prediction_class=prediction_class,
                confidence_score=confidence_score,
                feature_importance=feature_importance,
                model_version=self.model.get('model_version', 'unknown'),
                prediction_timestamp=datetime.now()
            )
            
        except Exception as e:
            logger.error(f"❌ Error making ML prediction: {e}")
            # Return default prediction
            return MLPrediction(
                claimable_probability=0.5,
                prediction_class="not_claimable",
                confidence_score=0.0,
                feature_importance={},
                model_version="unknown",
                prediction_timestamp=datetime.now()
            )
    
    def _custom_predict(self, features_df: pd.DataFrame) -> float:
        """Custom prediction logic for our trained model"""
        try:
            # This would use the actual trained model logic
            # For now, using a simplified approach
            if 'amount_requested' in features_df.columns:
                amount = features_df['amount_requested'].iloc[0]
                if amount > 100:
                    return 0.8
                elif amount > 50:
                    return 0.6
                else:
                    return 0.4
            return 0.5
        except Exception as e:
            logger.error(f"❌ Error in custom prediction: {e}")
            return 0.5
    
    def _get_feature_importance(self, features_df: pd.DataFrame) -> Dict[str, float]:
        """Get feature importance scores"""
        try:
            if 'feature_importance' in self.model:
                return self.model['feature_importance']
            else:
                # Return default importance based on feature values
                importance = {}
                for col in features_df.columns:
                    value = features_df[col].iloc[0]
                    if isinstance(value, (int, float)):
                        importance[col] = abs(value) / 100  # Normalize
                    else:
                        importance[col] = 0.1
                return importance
        except Exception as e:
            logger.error(f"❌ Error getting feature importance: {e}")
            return {}

class ClaimsDetector:
    """Main claims detector that combines ML and rules"""
    
    def __init__(self, ml_detector: EnhancedMLDetector, rules_engine: RulesEngine):
        self.ml_detector = ml_detector
        self.rules_engine = rules_engine
        self.decision_history = []
        
    def detect_claim(self, claim_data: ClaimData, additional_data: Optional[Dict[str, Any]] = None) -> CombinedDecision:
        """Detect and evaluate a potential claim using ML + Rules"""
        logger.info(f"🔍 Detecting claim for SKU: {claim_data.sku}")
        
        try:
            # Step 1: ML Prediction
            ml_prediction = self.ml_detector.predict(claim_data, additional_data)
            logger.info(f"🤖 ML Prediction: {ml_prediction.prediction_class} ({ml_prediction.claimable_probability:.3f})")
            
            # Step 2: Rules Evaluation
            rules_results = self.rules_engine.evaluate_claim(claim_data)
            rules_decision = self.rules_engine.get_claim_decision(rules_results)
            logger.info(f"📋 Rules Decision: {rules_decision['decision']}")
            
            # Step 3: Combine Decisions
            combined_decision = self._combine_decisions(ml_prediction, rules_results, rules_decision)
            
            # Step 4: Store decision history
            self.decision_history.append({
                'timestamp': datetime.now(),
                'sku': claim_data.sku,
                'ml_prediction': ml_prediction.prediction_class,
                'ml_probability': ml_prediction.claimable_probability,
                'rules_decision': rules_decision['decision'],
                'final_decision': combined_decision.final_decision,
                'can_proceed': combined_decision.can_proceed
            })
            
            logger.info(f"✅ Claim detection completed. Final decision: {combined_decision.final_decision}")
            return combined_decision
            
        except Exception as e:
            logger.error(f"❌ Error in claim detection: {e}")
            # Return safe default decision
            return CombinedDecision(
                final_decision="ERROR",
                ml_prediction=MLPrediction(0.5, "not_claimable", 0.0, {}, "unknown", datetime.now()),
                rules_evaluation=[],
                rules_decision={"decision": "ERROR", "can_proceed": False},
                can_proceed=False,
                reasoning=f"Error occurred during detection: {str(e)}"
            )
    
    def _combine_decisions(self, ml_prediction: MLPrediction, rules_results: List[RuleResult], 
                          rules_decision: Dict[str, Any]) -> CombinedDecision:
        """Combine ML and rules decisions intelligently"""
        
        # Initialize combined decision
        final_decision = "UNDECIDED"
        can_proceed = False
        recommended_amount = None
        evidence_required = False
        confidence_level = "medium"
        reasoning = []
        
        # Handle rules decisions first (rules take precedence)
        if rules_decision['decision'] == "DENIED":
            final_decision = "DENIED_BY_RULES"
            can_proceed = False
            reasoning.append(f"Rules engine denied claim: {rules_decision['reason']}")
            
        elif rules_decision['decision'] == "EVIDENCE_REQUIRED":
            final_decision = "EVIDENCE_REQUIRED"
            can_proceed = False
            evidence_required = True
            reasoning.append(f"Rules require evidence: {rules_decision['reason']}")
            
        elif rules_decision['decision'] == "LIMITED":
            final_decision = "LIMITED_BY_RULES"
            can_proceed = True
            recommended_amount = rules_decision.get('recommended_amount')
            reasoning.append(f"Rules limited claim: {rules_decision['reason']}")
            
        elif rules_decision['decision'] == "WARNED":
            final_decision = "WARNED_BUT_ALLOWED"
            can_proceed = True
            reasoning.append(f"Rules warned but allowed: {rules_decision['reason']}")
            
        elif rules_decision['decision'] == "ALLOWED":
            # Rules allow, now check ML prediction
            if ml_prediction.claimable_probability > 0.7:
                final_decision = "STRONGLY_RECOMMENDED"
                can_proceed = True
                confidence_level = "high"
                reasoning.append(f"ML strongly recommends (probability: {ml_prediction.claimable_probability:.3f})")
                
            elif ml_prediction.claimable_probability > 0.5:
                final_decision = "RECOMMENDED"
                can_proceed = True
                confidence_level = "medium"
                reasoning.append(f"ML recommends (probability: {ml_prediction.claimable_probability:.3f})")
                
            else:
                final_decision = "LOW_CONFIDENCE"
                can_proceed = True
                confidence_level = "low"
                reasoning.append(f"ML has low confidence (probability: {ml_prediction.claimable_probability:.3f})")
        
        # Add ML confidence information
        if ml_prediction.confidence_score > 0.8:
            confidence_level = "high"
        elif ml_prediction.confidence_score < 0.4:
            confidence_level = "low"
        
        # Combine reasoning
        combined_reasoning = " | ".join(reasoning)
        
        return CombinedDecision(
            final_decision=final_decision,
            ml_prediction=ml_prediction,
            rules_evaluation=rules_results,
            rules_decision=rules_decision,
            can_proceed=can_proceed,
            recommended_amount=recommended_amount,
            evidence_required=evidence_required,
            confidence_level=confidence_level,
            reasoning=combined_reasoning
        )
    
    def batch_detect_claims(self, claims_data: List[ClaimData], 
                           additional_data: Optional[Dict[str, Any]] = None) -> List[CombinedDecision]:
        """Detect multiple claims in batch"""
        logger.info(f"🚀 Starting batch detection of {len(claims_data)} claims")
        
        results = []
        for i, claim_data in enumerate(claims_data):
            logger.info(f"Processing claim {i+1}/{len(claims_data)}: {claim_data.sku}")
            result = self.detect_claim(claim_data, additional_data)
            results.append(result)
        
        logger.info(f"✅ Batch detection completed. {len(results)} claims processed")
        return results
    
    def get_detection_summary(self) -> Dict[str, Any]:
        """Get summary of detection history"""
        if not self.decision_history:
            return {"message": "No detection history available"}
        
        total_claims = len(self.decision_history)
        decisions = [d['final_decision'] for d in self.decision_history]
        
        summary = {
            "total_claims_processed": total_claims,
            "decision_distribution": pd.Series(decisions).value_counts().to_dict(),
            "can_proceed_count": sum(1 for d in self.decision_history if d['can_proceed']),
            "cannot_proceed_count": sum(1 for d in self.decision_history if not d['can_proceed']),
            "ml_accuracy": self._calculate_ml_accuracy(),
            "last_processed": self.decision_history[-1]['timestamp'] if self.decision_history else None
        }
        
        return summary
    
    def _calculate_ml_accuracy(self) -> Optional[float]:
        """Calculate ML prediction accuracy if we have ground truth"""
        # This would compare ML predictions with actual outcomes
        # For now, return None as we don't have ground truth in this context
        return None
    
    def export_decisions(self, filepath: str) -> bool:
        """Export decision history to CSV"""
        try:
            if not self.decision_history:
                logger.warning("⚠️ No decision history to export")
                return False
            
            df = pd.DataFrame(self.decision_history)
            df.to_csv(filepath, index=False)
            logger.info(f"✅ Decision history exported to {filepath}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error exporting decisions: {e}")
            return False

# Example usage and testing
if __name__ == "__main__":
    # Initialize components
    rules_engine = RulesEngine()
    
    # Initialize ML detector (using the improved model we trained)
    ml_detector = EnhancedMLDetector(
        model_path="models/improved_fba_claims_model.pkl",
        rules_engine=rules_engine
    )
    
    # Initialize claims detector
    claims_detector = ClaimsDetector(ml_detector, rules_engine)
    
    # Create sample claims for testing
    sample_claims = [
        ClaimData(
            sku="TEST-SKU-001",
            asin="B08N5WRWNW",
            claim_type="lost_inventory",
            quantity_affected=5,
            amount_requested=150.00,
            shipment_date=datetime.now() - timedelta(days=200),
            cost_per_unit=30.00,
            marketplace="US",
            evidence_attached=False
        ),
        ClaimData(
            sku="TEST-SKU-002",
            asin="B08N5WRWNW",
            claim_type="damaged_goods",
            quantity_affected=2,
            amount_requested=60.00,
            shipment_date=datetime.now() - timedelta(days=50),
            cost_per_unit=30.00,
            marketplace="US",
            evidence_attached=True
        ),
        ClaimData(
            sku="TEST-SKU-003",
            asin="B08N5WRWNW",
            claim_type="fee_overcharge",
            quantity_affected=1,
            amount_requested=3.50,
            shipment_date=datetime.now() - timedelta(days=100),
            cost_per_unit=30.00,
            marketplace="US",
            evidence_attached=False
        )
    ]
    
    # Test individual claim detection
    print("🔍 Testing individual claim detection...")
    for i, claim in enumerate(sample_claims):
        print(f"\n--- Claim {i+1}: {claim.sku} ---")
        result = claims_detector.detect_claim(claim)
        
        print(f"Final Decision: {result.final_decision}")
        print(f"Can Proceed: {result.can_proceed}")
        print(f"ML Prediction: {result.ml_prediction.prediction_class} ({result.ml_prediction.claimable_probability:.3f})")
        print(f"Rules Decision: {result.rules_decision['decision']}")
        print(f"Reasoning: {result.reasoning}")
        
        if result.recommended_amount:
            print(f"Recommended Amount: ${result.recommended_amount}")
        
        if result.evidence_required:
            print("⚠️ Evidence Required!")
    
    # Test batch detection
    print(f"\n🚀 Testing batch detection of {len(sample_claims)} claims...")
    batch_results = claims_detector.batch_detect_claims(sample_claims)
    
    # Show summary
    summary = claims_detector.get_detection_summary()
    print(f"\n📊 DETECTION SUMMARY:")
    print(f"Total Claims Processed: {summary['total_claims_processed']}")
    print(f"Can Proceed: {summary['can_proceed_count']}")
    print(f"Cannot Proceed: {summary['cannot_proceed_count']}")
    print(f"Decision Distribution: {summary['decision_distribution']}")
    
    # Export results
    export_path = "claim_detection_results.csv"
    if claims_detector.export_decisions(export_path):
        print(f"✅ Results exported to {export_path}")

