#!/usr/bin/env python3
"""
Feedback Loop System for FBA Claims
Captures Amazon's outcomes and retrains the model to maintain accuracy
"""

import pandas as pd
import numpy as np
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import json
from pathlib import Path
import pickle
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class AmazonOutcome:
    """Amazon's decision on a submitted claim"""
    claim_id: str
    sku: str
    asin: str
    outcome: str  # approved, partial, denied
    amount_approved: Optional[float] = None
    amount_requested: Optional[float] = None
    decision_date: Optional[datetime] = None
    amazon_case_id: Optional[str] = None
    amazon_reason: Optional[str] = None
    notes: Optional[str] = None

@dataclass
class FeedbackData:
    """Combined data for feedback loop"""
    claim_data: Any  # ClaimData type
    ml_prediction: Dict[str, Any]
    rules_decision: Dict[str, Any]
    amazon_outcome: AmazonOutcome
    accuracy_score: float
    drift_detected: bool = False

class DriftDetector:
    """Detects model drift and data distribution changes"""
    
    def __init__(self, window_size: int = 100):
        self.window_size = window_size
        self.accuracy_history = []
        self.feature_distributions = {}
        self.drift_threshold = 0.1  # 10% drop in accuracy triggers drift alert
        
    def add_accuracy_score(self, accuracy: float):
        """Add new accuracy score to history"""
        self.accuracy_history.append({
            'timestamp': datetime.now(),
            'accuracy': accuracy
        })
        
        # Keep only recent scores
        if len(self.accuracy_history) > self.window_size:
            self.accuracy_history.pop(0)
    
    def detect_accuracy_drift(self) -> Tuple[bool, float, float]:
        """Detect accuracy drift"""
        if len(self.accuracy_history) < 20:  # Need minimum data points
            return False, 0.0, 0.0
        
        recent_scores = [h['accuracy'] for h in self.accuracy_history[-20:]]
        older_scores = [h['accuracy'] for h in self.accuracy_history[:-20]]
        
        if not older_scores:
            return False, 0.0, 0.0
        
        recent_avg = np.mean(recent_scores)
        older_avg = np.mean(older_scores)
        
        drift_magnitude = older_avg - recent_avg
        drift_detected = drift_magnitude > self.drift_threshold
        
        return drift_detected, drift_magnitude, recent_avg
    
    def update_feature_distributions(self, features: Dict[str, Any]):
        """Update feature distribution tracking"""
        for feature_name, value in features.items():
            if feature_name not in self.feature_distributions:
                self.feature_distributions[feature_name] = []
            
            self.feature_distributions[feature_name].append(value)
            
            # Keep only recent values
            if len(self.feature_distributions[feature_name]) > self.window_size:
                self.feature_distributions[feature_name].pop(0)
    
    def detect_feature_drift(self) -> Dict[str, bool]:
        """Detect feature distribution drift"""
        drift_results = {}
        
        for feature_name, values in self.feature_distributions.items():
            if len(values) < 20:
                drift_results[feature_name] = False
                continue
            
            # Split into recent and older
            recent_values = values[-20:]
            older_values = values[:-20]
            
            if not older_values:
                drift_results[feature_name] = False
                continue
            
            # Calculate distribution statistics
            recent_mean = np.mean(recent_values)
            older_mean = np.mean(older_values)
            recent_std = np.std(recent_values)
            older_std = np.std(older_values)
            
            # Detect significant changes
            mean_change = abs(recent_mean - older_mean) / (older_std + 1e-8)
            std_change = abs(recent_std - older_std) / (older_std + 1e-8)
            
            drift_detected = mean_change > 2.0 or std_change > 1.5  # 2 sigma threshold
            drift_results[feature_name] = drift_detected
        
        return drift_results

class FeedbackLoop:
    """Main feedback loop system"""
    
    def __init__(self, rules_engine=None):
        self.rules_engine = rules_engine
        self.drift_detector = DriftDetector()
        self.feedback_data = []
        self.retraining_schedule = {
            'frequency': 'monthly',  # monthly, quarterly, on_drift
            'last_retrain': None,
            'min_samples': 100,
            'drift_threshold': 0.1
        }
        
    def capture_outcome(self, claim_data, amazon_outcome: AmazonOutcome, 
                       original_decision) -> FeedbackData:
        """Capture Amazon's outcome and create feedback data"""
        logger.info(f"📥 Capturing outcome for SKU: {claim_data.sku}")
        
        try:
            # Calculate accuracy score
            accuracy_score = self._calculate_accuracy_score(amazon_outcome, original_decision)
            
            # Create feedback data
            feedback_data = FeedbackData(
                claim_data=claim_data,
                ml_prediction={
                    'prediction_class': original_decision.ml_prediction.prediction_class,
                    'probability': original_decision.ml_prediction.claimable_probability,
                    'confidence': original_decision.ml_prediction.confidence_score
                },
                rules_decision={
                    'decision': original_decision.rules_decision['decision'],
                    'can_proceed': original_decision.rules_decision['can_proceed']
                },
                amazon_outcome=amazon_outcome,
                accuracy_score=accuracy_score
            )
            
            # Add to feedback history
            self.feedback_data.append(feedback_data)
            
            # Update drift detection
            self.drift_detector.add_accuracy_score(accuracy_score)
            
            # Check for drift
            drift_detected, drift_magnitude, current_accuracy = self.drift_detector.detect_accuracy_drift()
            feedback_data.drift_detected = drift_detected
            
            if drift_detected:
                logger.warning(f"⚠️ Model drift detected! Magnitude: {drift_magnitude:.3f}")
                logger.warning(f"Current accuracy: {current_accuracy:.3f}")
            
            logger.info(f"✅ Outcome captured. Accuracy: {accuracy_score:.3f}")
            return feedback_data
            
        except Exception as e:
            logger.error(f"❌ Error capturing outcome: {e}")
            return None
    
    def _calculate_accuracy_score(self, amazon_outcome: AmazonOutcome, 
                                original_decision) -> float:
        """Calculate accuracy score based on Amazon's outcome"""
        try:
            # Binary accuracy: did we correctly predict if claim would be approved?
            if amazon_outcome.outcome == 'approved':
                # We predicted claimable and it was approved
                if original_decision.ml_prediction.prediction_class == 'claimable':
                    return 1.0
                else:
                    return 0.0
            elif amazon_outcome.outcome == 'partial':
                # Partial approval - give partial credit
                if original_decision.ml_prediction.prediction_class == 'claimable':
                    return 0.7
                else:
                    return 0.3
            elif amazon_outcome.outcome == 'denied':
                # We predicted not claimable and it was denied
                if original_decision.ml_prediction.prediction_class == 'not_claimable':
                    return 1.0
                else:
                    return 0.0
            else:
                return 0.5  # Unknown outcome
                
        except Exception as e:
            logger.error(f"❌ Error calculating accuracy score: {e}")
            return 0.5
    
    def should_retrain(self) -> Tuple[bool, str]:
        """Determine if model should be retrained"""
        reasons = []
        
        # Check sample size
        if len(self.feedback_data) < self.retraining_schedule['min_samples']:
            return False, f"Insufficient samples ({len(self.feedback_data)} < {self.retraining_schedule['min_samples']})"
        
        # Check frequency
        if self.retraining_schedule['frequency'] == 'monthly':
            if self.retraining_schedule['last_retrain']:
                days_since_retrain = (datetime.now() - self.retraining_schedule['last_retrain']).days
                if days_since_retrain < 30:
                    return False, f"Monthly retraining not due yet ({days_since_retrain} days since last)"
        
        elif self.retraining_schedule['frequency'] == 'quarterly':
            if self.retraining_schedule['last_retrain']:
                days_since_retrain = (datetime.now() - self.retraining_schedule['last_retrain']).days
                if days_since_retrain < 90:
                    return False, f"Quarterly retraining not due yet ({days_since_retrain} days since last)"
        
        # Check for drift
        drift_detected, drift_magnitude, current_accuracy = self.drift_detector.detect_accuracy_drift()
        if drift_detected and drift_magnitude > self.retraining_schedule['drift_threshold']:
            reasons.append(f"Accuracy drift detected (magnitude: {drift_magnitude:.3f})")
        
        # Check overall accuracy trend
        recent_accuracy = np.mean([f.accuracy_score for f in self.feedback_data[-50:]])
        if recent_accuracy < 0.7:  # Below 70% accuracy
            reasons.append(f"Low recent accuracy ({recent_accuracy:.3f})")
        
        if reasons:
            return True, " | ".join(reasons)
        else:
            return False, "No retraining needed"
    
    def prepare_retraining_data(self) -> pd.DataFrame:
        """Prepare data for model retraining"""
        logger.info("🔄 Preparing retraining data...")
        
        try:
            retraining_data = []
            
            for feedback in self.feedback_data:
                # Extract features from claim data
                features = {
                    'amount_requested': feedback.claim_data.amount_requested,
                    'quantity_affected': feedback.claim_data.quantity_affected,
                    'cost_per_unit': feedback.claim_data.cost_per_unit or 0.0,
                    'evidence_attached': 1 if feedback.claim_data.evidence_attached else 0
                }
                
                # Add derived features
                if feedback.claim_data.cost_per_unit:
                    features['amount_per_unit'] = feedback.claim_data.amount_requested / feedback.claim_data.quantity_affected
                    features['cost_ratio'] = feedback.claim_data.amount_requested / (feedback.claim_data.cost_per_unit * feedback.claim_data.quantity_affected)
                else:
                    features['amount_per_unit'] = 0.0
                    features['cost_ratio'] = 0.0
                
                # Add time-based features
                if feedback.claim_data.shipment_date:
                    features['days_since_shipment'] = (datetime.now() - feedback.claim_data.shipment_date).days
                else:
                    features['days_since_shipment'] = 0
                
                # Add categorical encodings
                claim_type_mapping = {
                    'lost_inventory': 0, 'damaged_goods': 1, 'fee_overcharge': 2,
                    'missing_reimbursement': 3, 'dimension_weight_error': 4,
                    'destroyed_inventory': 5, 'high_value_edge_case': 6
                }
                features['claim_type_encoded'] = claim_type_mapping.get(feedback.claim_data.claim_type, 7)
                
                marketplace_mapping = {'US': 0, 'CA': 1, 'UK': 2, 'DE': 3, 'JP': 4}
                features['marketplace_encoded'] = marketplace_mapping.get(feedback.claim_data.marketplace, 5)
                
                # Add target variable (Amazon's outcome)
                if feedback.amazon_outcome.outcome == 'approved':
                    target = 1
                elif feedback.amazon_outcome.outcome == 'partial':
                    target = 1  # Treat partial as positive
                else:  # denied
                    target = 0
                
                features['target'] = target
                features['accuracy_score'] = feedback.accuracy_score
                features['drift_detected'] = 1 if feedback.drift_detected else 0
                
                retraining_data.append(features)
            
            df = pd.DataFrame(retraining_data)
            logger.info(f"✅ Retraining data prepared: {df.shape}")
            return df
            
        except Exception as e:
            logger.error(f"❌ Error preparing retraining data: {e}")
            return pd.DataFrame()
    
    def retrain_model(self) -> bool:
        """Retrain the ML model with new feedback data"""
        logger.info("🔄 Starting model retraining...")
        
        try:
            # Check if retraining is needed
            should_retrain, reason = self.should_retrain()
            if not should_retrain:
                logger.info(f"ℹ️ {reason}")
                return False
            
            # Prepare retraining data
            retraining_df = self.prepare_retraining_data()
            if retraining_df.empty:
                logger.error("❌ No retraining data available")
                return False
            
            # Split data
            from sklearn.model_selection import train_test_split
            X = retraining_df.drop(['target', 'accuracy_score', 'drift_detected'], axis=1)
            y = retraining_df['target']
            
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            # Train new model (using our improved training approach)
            from improved_training import ImprovedFBAClaimsModel
            
            new_model = ImprovedFBAClaimsModel()
            new_model.feature_columns = X.columns.tolist()
            
            # Train the model
            training_results = new_model.train_improved_model(X_train, y_train)
            
            # Evaluate on test set
            evaluation_results = new_model.evaluate(X_test, y_test)
            
            # Save new model
            new_model_path = f"models/retrained_model_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pkl"
            Path('models').mkdir(exist_ok=True)
            new_model.save_model(new_model_path)
            
            # Update retraining schedule
            self.retraining_schedule['last_retrain'] = datetime.now()
            
            # Log results
            logger.info(f"✅ Model retraining completed!")
            logger.info(f"New model saved to: {new_model_path}")
            logger.info(f"Test accuracy: {evaluation_results['accuracy']:.4f}")
            logger.info(f"Test F1: {evaluation_results['f1_score']:.4f}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error during model retraining: {e}")
            return False
    
    def get_feedback_summary(self) -> Dict[str, Any]:
        """Get summary of feedback data"""
        if not self.feedback_data:
            return {"message": "No feedback data available"}
        
        total_feedback = len(self.feedback_data)
        accuracy_scores = [f.accuracy_score for f in self.feedback_data]
        
        # Calculate statistics
        avg_accuracy = np.mean(accuracy_scores)
        recent_accuracy = np.mean(accuracy_scores[-50:]) if len(accuracy_scores) >= 50 else avg_accuracy
        
        # Outcome distribution
        outcomes = [f.amazon_outcome.outcome for f in self.feedback_data]
        outcome_distribution = pd.Series(outcomes).value_counts().to_dict()
        
        # Drift detection
        drift_detected, drift_magnitude, current_accuracy = self.drift_detector.detect_accuracy_drift()
        
        # Retraining status
        should_retrain, reason = self.should_retrain()
        
        summary = {
            "total_feedback_samples": total_feedback,
            "overall_accuracy": avg_accuracy,
            "recent_accuracy": recent_accuracy,
            "outcome_distribution": outcome_distribution,
            "drift_detected": drift_detected,
            "drift_magnitude": drift_magnitude,
            "current_accuracy": current_accuracy,
            "should_retrain": should_retrain,
            "retraining_reason": reason,
            "last_retrain": self.retraining_schedule['last_retrain'],
            "retraining_frequency": self.retraining_schedule['frequency']
        }
        
        return summary
    
    def export_feedback_data(self, filepath: str) -> bool:
        """Export feedback data to CSV"""
        try:
            if not self.feedback_data:
                logger.warning("⚠️ No feedback data to export")
                return False
            
            # Convert to DataFrame
            export_data = []
            for feedback in self.feedback_data:
                export_data.append({
                    'timestamp': datetime.now(),
                    'sku': feedback.claim_data.sku,
                    'asin': feedback.claim_data.asin,
                    'claim_type': feedback.claim_data.claim_type,
                    'amount_requested': feedback.claim_data.amount_requested,
                    'ml_prediction': feedback.ml_prediction['prediction_class'],
                    'ml_probability': feedback.ml_prediction['probability'],
                    'rules_decision': feedback.rules_decision['decision'],
                    'amazon_outcome': feedback.amazon_outcome.outcome,
                    'amount_approved': feedback.amazon_outcome.amount_approved,
                    'accuracy_score': feedback.accuracy_score,
                    'drift_detected': feedback.drift_detected
                })
            
            df = pd.DataFrame(export_data)
            df.to_csv(filepath, index=False)
            
            logger.info(f"✅ Feedback data exported to {filepath}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error exporting feedback data: {e}")
            return False

# Example usage and testing
if __name__ == "__main__":
    # Initialize feedback loop
    feedback_loop = FeedbackLoop()
    
    # Simulate feedback data
    print("🔄 Testing feedback loop system...")
    
    # Create sample feedback data
    from dataclasses import dataclass
    
    @dataclass
    class MockClaimData:
        sku: str
        asin: str
        claim_type: str
        quantity_affected: int
        amount_requested: float
        shipment_date: datetime
        cost_per_unit: float
        marketplace: str
        evidence_attached: bool
    
    @dataclass
    class MockMLPrediction:
        prediction_class: str
        claimable_probability: float
        confidence_score: float
    
    @dataclass
    class MockCombinedDecision:
        ml_prediction: MockMLPrediction
        rules_decision: Dict[str, Any]
    
    sample_claims = [
        MockClaimData(
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
        MockClaimData(
            sku="TEST-SKU-002",
            asin="B08N5WRWNW",
            claim_type="damaged_goods",
            quantity_affected=2,
            amount_requested=60.00,
            shipment_date=datetime.now() - timedelta(days=50),
            cost_per_unit=30.00,
            marketplace="US",
            evidence_attached=True
        )
    ]
    
    sample_outcomes = [
        AmazonOutcome(
            claim_id="claim_001",
            sku="TEST-SKU-001",
            asin="B08N5WRWNW",
            outcome="approved",
            amount_approved=150.00,
            amount_requested=150.00,
            decision_date=datetime.now() - timedelta(days=5)
        ),
        AmazonOutcome(
            claim_id="claim_002",
            sku="TEST-SKU-002",
            asin="B08N5WRWNW",
            outcome="denied",
            amount_approved=0.00,
            amount_requested=60.00,
            decision_date=datetime.now() - timedelta(days=3)
        )
    ]
    
    # Simulate capturing outcomes
    for i, (claim, outcome) in enumerate(zip(sample_claims, sample_outcomes)):
        print(f"\n--- Processing feedback {i+1} ---")
        
        # Simulate original decision
        mock_decision = MockCombinedDecision(
            ml_prediction=MockMLPrediction(
                prediction_class="claimable" if i == 0 else "not_claimable",
                claimable_probability=0.8 if i == 0 else 0.3,
                confidence_score=0.7
            ),
            rules_decision={
                'decision': 'ALLOWED',
                'can_proceed': True
            }
        )
        
        # Capture outcome
        feedback_data = feedback_loop.capture_outcome(claim, outcome, mock_decision)
        
        if feedback_data:
            print(f"SKU: {feedback_data.claim_data.sku}")
            print(f"ML Prediction: {feedback_data.ml_prediction['prediction_class']}")
            print(f"Amazon Outcome: {feedback_data.amazon_outcome.outcome}")
            print(f"Accuracy Score: {feedback_data.accuracy_score:.3f}")
            print(f"Drift Detected: {feedback_data.drift_detected}")
    
    # Show feedback summary
    summary = feedback_loop.get_feedback_summary()
    print(f"\n📊 FEEDBACK SUMMARY:")
    print(f"Total Samples: {summary['total_feedback_samples']}")
    print(f"Overall Accuracy: {summary['overall_accuracy']:.3f}")
    print(f"Recent Accuracy: {summary['recent_accuracy']:.3f}")
    print(f"Outcome Distribution: {summary['outcome_distribution']}")
    print(f"Drift Detected: {summary['drift_detected']}")
    print(f"Should Retrain: {summary['should_retrain']}")
    print(f"Reason: {summary['retraining_reason']}")
    
    # Check retraining status
    should_retrain, reason = feedback_loop.should_retrain()
    print(f"\n🔄 RETRAINING STATUS:")
    print(f"Should Retrain: {should_retrain}")
    print(f"Reason: {reason}")
    
    if should_retrain:
        print("🚀 Initiating model retraining...")
        # feedback_loop.retrain_model()  # Uncomment to actually retrain
    else:
        print("✅ No retraining needed at this time")
    
    # Export feedback data
    export_path = "feedback_data.csv"
    if feedback_loop.export_feedback_data(export_path):
        print(f"✅ Feedback data exported to {export_path}")
