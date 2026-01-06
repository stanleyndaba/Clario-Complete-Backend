# -*- coding: utf-8 -*-
"""
Multi-Class Classification for Claim Detector v2.0 - Step 2

This module implements multi-class classification for 13 claim types
with evidence requirements and claimability scoring.
"""

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    precision_score, recall_score, f1_score, accuracy_score,
    confusion_matrix, classification_report
)
from sklearn.pipeline import Pipeline
import joblib
import logging
from typing import Dict, List, Tuple, Any, Optional
from dataclasses import dataclass
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class ClaimClassification:
    """Result of claim classification"""
    claim_type: str
    confidence_score: float
    claimability: str  # 'High', 'Medium', 'Low'
    required_evidence: List[str]
    risk_factors: List[str]
    recommendations: List[str]

@dataclass
class EvidenceRequirement:
    """Evidence requirement for a claim type"""
    evidence_type: str
    required: bool
    format_constraints: List[str]
    time_constraints: Optional[str]

class MultiClassClassifier:
    """Multi-class classifier for 13 claim types"""
    
    def __init__(self):
        self.model = None
        self.vectorizer = None
        self.claim_types = [
            'lost_inventory', 'damaged_inventory', 'fee_error', 
            'missing_reimbursement', 'warehouse_error', 'shipping_delay',
            'quality_issue', 'packaging_damage', 'expired_product',
            'recalled_item', 'counterfeit_item', 'inventory_adjustment',
            'processing_error'
        ]
        
        # Evidence mapping for each claim type
        self.evidence_mapping = {
            'lost_inventory': ['inventory_report', 'shipping_documentation', 'loss_affidavit'],
            'damaged_inventory': ['damage_photos', 'inspection_report', 'packaging_evidence'],
            'fee_error': ['invoice', 'fee_statement', 'payment_records'],
            'missing_reimbursement': ['return_documentation', 'refund_request', 'communication_logs'],
            'warehouse_error': ['warehouse_logs', 'processing_records', 'error_reports'],
            'shipping_delay': ['tracking_info', 'delay_notification', 'impact_assessment'],
            'quality_issue': ['quality_report', 'product_testing', 'customer_feedback'],
            'packaging_damage': ['packaging_photos', 'damage_assessment', 'handling_records'],
            'expired_product': ['expiration_dates', 'inventory_records', 'disposal_documentation'],
            'recalled_item': ['recall_notice', 'inventory_audit', 'disposal_records'],
            'counterfeit_item': ['authenticity_report', 'purchase_records', 'expert_opinion'],
            'inventory_adjustment': ['adjustment_request', 'inventory_records', 'approval_documentation'],
            'processing_error': ['error_logs', 'process_documentation', 'correction_records']
        }
        
        # Risk factors for each claim type
        self.risk_factors = {
            'lost_inventory': ['no_tracking', 'delayed_reporting', 'insufficient_documentation'],
            'damaged_inventory': ['poor_packaging', 'rough_handling', 'inadequate_insurance'],
            'fee_error': ['complex_fee_structure', 'multiple_charges', 'timing_issues'],
            'missing_reimbursement': ['delayed_return', 'incomplete_documentation', 'policy_violation'],
            'warehouse_error': ['system_failure', 'human_error', 'process_breakdown'],
            'shipping_delay': ['carrier_issues', 'weather_conditions', 'customs_delays'],
            'quality_issue': ['product_defects', 'storage_conditions', 'handling_damage'],
            'packaging_damage': ['fragile_items', 'inadequate_protection', 'rough_transport'],
            'expired_product': ['slow_turnover', 'poor_forecasting', 'storage_conditions'],
            'recalled_item': ['delayed_notification', 'continued_sales', 'inadequate_recall'],
            'counterfeit_item': ['unverified_supplier', 'price_discrepancy', 'quality_issues'],
            'inventory_adjustment': ['discrepancy_size', 'timing_issues', 'documentation_gaps'],
            'processing_error': ['system_issues', 'training_gaps', 'process_complexity']
        }
        
        self.results = {}
    
    def create_model_pipeline(self) -> Pipeline:
        """Create TF-IDF + Random Forest pipeline"""
        pipeline = Pipeline([
            ('tfidf', TfidfVectorizer(
                max_features=10000,
                ngram_range=(1, 3),
                stop_words='english',
                min_df=2,
                max_df=0.9
            )),
            ('classifier', RandomForestClassifier(
                n_estimators=100,
                max_depth=20,
                random_state=42,
                class_weight='balanced'
            ))
        ])
        return pipeline
    
    def generate_multi_class_data(self, n_samples: int = 2000) -> Tuple[np.ndarray, np.ndarray]:
        """Generate mock training data for multi-class classification"""
        logger.info(f"Generating {n_samples} multi-class samples...")
        
        # Templates for each claim type
        claim_templates = {
            'lost_inventory': [
                "Inventory lost during shipment to Amazon",
                "Package never arrived at warehouse",
                "Missing inventory from last shipment",
                "Lost during transit to fulfillment center"
            ],
            'damaged_inventory': [
                "Product damaged during shipping",
                "Packaging destroyed in transit",
                "Items broken during warehouse handling",
                "Damaged during fulfillment process"
            ],
            'fee_error': [
                "Incorrect fee charged by Amazon",
                "Wrong storage fee calculation",
                "Processing fee error in billing",
                "Incorrect referral fee charged"
            ],
            'missing_reimbursement': [
                "No reimbursement for returned items",
                "Missing refund for damaged goods",
                "Reimbursement not processed",
                "Refund missing for customer return"
            ],
            'warehouse_error': [
                "Warehouse processing mistake",
                "FC error in inventory handling",
                "Warehouse system malfunction",
                "Processing error in fulfillment center"
            ],
            'shipping_delay': [
                "Shipment delayed by carrier",
                "Delivery behind schedule",
                "Shipping delay causing issues",
                "Late arrival at destination"
            ],
            'quality_issue': [
                "Product quality problems",
                "Defective items received",
                "Quality control failure",
                "Substandard product condition"
            ],
            'packaging_damage': [
                "Packaging damaged in warehouse",
                "Boxes crushed during handling",
                "Packaging integrity compromised",
                "Container damage in FC"
            ],
            'expired_product': [
                "Product expired before sale",
                "Expired inventory in warehouse",
                "Shelf life exceeded",
                "Expired goods in storage"
            ],
            'recalled_item': [
                "Recalled product still in inventory",
                "Safety recall not processed",
                "Recalled item in warehouse",
                "Recall notice not followed"
            ],
            'counterfeit_item': [
                "Counterfeit product detected",
                "Fake items in inventory",
                "Authenticity verification failed",
                "Counterfeit goods identified"
            ],
            'inventory_adjustment': [
                "Inventory adjustment needed",
                "Stock level correction required",
                "Inventory reconciliation issue",
                "Stock adjustment request"
            ],
            'processing_error': [
                "Processing system error",
                "Order processing failure",
                "System malfunction in processing",
                "Processing workflow error"
            ]
        }
        
        np.random.seed(42)
        X = []
        y = []
        
        samples_per_class = n_samples // len(self.claim_types)
        
        for claim_type in self.claim_types:
            templates = claim_templates[claim_type]
            class_samples = samples_per_class
            
            for _ in range(class_samples):
                # Select random template
                template = np.random.choice(templates)
                
                # Add some variation
                variations = [
                    "urgent", "important", "review needed", "escalation required",
                    "immediate attention", "critical issue", "priority case"
                ]
                
                if np.random.random() < 0.3:
                    variation = np.random.choice(variations)
                    text = f"{template}, {variation}"
                else:
                    text = template
                
                X.append(text)
                y.append(self.claim_types.index(claim_type))
        
        # Shuffle data
        indices = np.random.permutation(len(X))
        X = np.array(X)[indices]
        y = np.array(y)[indices]
        
        logger.info(f"Generated {len(X)} samples across {len(self.claim_types)} classes")
        return X, y
    
    def train_model(self, X: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
        """Train multi-class classifier"""
        logger.info("Training multi-class classifier...")
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Create and train pipeline
        self.model = self.create_model_pipeline()
        self.model.fit(X_train, y_train)
        
        # Evaluate model
        y_pred = self.model.predict(X_test)
        y_pred_proba = self.model.predict_proba(X_test)
        
        # Calculate metrics
        metrics = {
            'accuracy': accuracy_score(y_test, y_pred),
            'precision_macro': precision_score(y_test, y_pred, average='macro', zero_division=0),
            'recall_macro': recall_score(y_test, y_pred, average='macro', zero_division=0),
            'f1_macro': f1_score(y_test, y_pred, average='macro', zero_division=0),
            'precision_weighted': precision_score(y_test, y_pred, average='weighted', zero_division=0),
            'recall_weighted': recall_score(y_test, y_pred, average='weighted', zero_division=0),
            'f1_weighted': f1_score(y_test, y_pred, average='weighted', zero_division=0),
            'confusion_matrix': confusion_matrix(y_test, y_pred).tolist()
        }
        
        # Per-class metrics
        per_class_metrics = {}
        for i, claim_type in enumerate(self.claim_types):
            class_mask = (y_test == i)
            if class_mask.sum() > 0:
                per_class_metrics[claim_type] = {
                    'precision': precision_score(y_test == i, y_pred == i, zero_division=0),
                    'recall': recall_score(y_test == i, y_pred == i, zero_division=0),
                    'f1': f1_score(y_test == i, y_pred == i, zero_division=0),
                    'support': int(class_mask.sum())
                }
        
        metrics['per_class'] = per_class_metrics
        
        # Cross-validation
        cv_scores = cross_val_score(self.model, X_train, y_train, cv=5, scoring='f1_macro')
        metrics['cv_f1_macro_mean'] = cv_scores.mean()
        metrics['cv_f1_macro_std'] = cv_scores.std()
        
        self.results = metrics
        logger.info(f"Training complete. F1 Macro: {metrics['f1_macro']:.3f}")
        
        return metrics
    
    def classify_claim(self, text: str) -> ClaimClassification:
        """Classify a claim and return detailed classification"""
        if self.model is None:
            raise ValueError("Model not trained yet!")
        
        # Get prediction and probabilities
        prediction_idx = self.model.predict([text])[0]
        probabilities = self.model.predict_proba([text])[0]
        
        claim_type = self.claim_types[prediction_idx]
        confidence_score = probabilities[prediction_idx]
        
        # Determine claimability
        claimability = self._calculate_claimability_score(claim_type, confidence_score)
        
        # Get required evidence
        required_evidence = self.evidence_mapping.get(claim_type, [])
        
        # Get risk factors
        risk_factors = self.risk_factors.get(claim_type, [])
        
        # Generate recommendations
        recommendations = self._generate_recommendations(claim_type, confidence_score, claimability)
        
        return ClaimClassification(
            claim_type=claim_type,
            confidence_score=confidence_score,
            claimability=claimability,
            required_evidence=required_evidence,
            risk_factors=risk_factors,
            recommendations=recommendations
        )
    
    def _calculate_claimability_score(self, claim_type: str, confidence: float) -> str:
        """Calculate claimability level (High, Medium, Low)"""
        # Base claimability by type
        base_claimability = {
            'lost_inventory': 0.8,
            'damaged_inventory': 0.7,
            'fee_error': 0.9,
            'missing_reimbursement': 0.8,
            'warehouse_error': 0.6,
            'shipping_delay': 0.5,
            'quality_issue': 0.4,
            'packaging_damage': 0.6,
            'expired_product': 0.3,
            'recalled_item': 0.2,
            'counterfeit_item': 0.1,
            'inventory_adjustment': 0.7,
            'processing_error': 0.5
        }
        
        base_score = base_claimability.get(claim_type, 0.5)
        
        # Adjust by confidence
        adjusted_score = base_score * confidence
        
        if adjusted_score >= 0.7:
            return 'High'
        elif adjusted_score >= 0.4:
            return 'Medium'
        else:
            return 'Low'
    
    def _generate_recommendations(self, claim_type: str, confidence: float, claimability: str) -> List[str]:
        """Generate recommendations based on classification"""
        recommendations = []
        
        if confidence < 0.6:
            recommendations.append("Consider manual review due to low confidence")
        
        if claimability == 'Low':
            recommendations.append("Review claim policy - may not be eligible")
            recommendations.append("Consider alternative resolution methods")
        elif claimability == 'Medium':
            recommendations.append("Gather additional evidence to strengthen claim")
            recommendations.append("Review similar successful claims for guidance")
        else:  # High
            recommendations.append("Proceed with claim submission")
            recommendations.append("Ensure all required evidence is included")
        
        # Type-specific recommendations
        if claim_type == 'lost_inventory':
            recommendations.append("Verify tracking information and delivery confirmation")
        elif claim_type == 'damaged_inventory':
            recommendations.append("Document damage with photos and inspection reports")
        elif claim_type == 'fee_error':
            recommendations.append("Review fee structure and billing documentation")
        
        return recommendations
    
    def save_model(self, output_dir: str = "models"):
        """Save trained model to disk"""
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        filepath = os.path.join(output_dir, "multi_class_classifier.pkl")
        joblib.dump(self.model, filepath)
        logger.info(f"Saved model to {filepath}")
    
    def load_model(self, models_dir: str = "models"):
        """Load trained model from disk"""
        filepath = os.path.join(models_dir, "multi_class_classifier.pkl")
        if os.path.exists(filepath):
            self.model = joblib.load(filepath)
            logger.info(f"Loaded model from {filepath}")
    
    def get_performance_summary(self) -> Dict[str, Any]:
        """Get comprehensive performance summary"""
        if not self.results:
            return {"error": "Model not trained yet"}
        
        return {
            "overall_metrics": {
                "accuracy": self.results['accuracy'],
                "f1_macro": self.results['f1_macro'],
                "f1_weighted": self.results['f1_weighted'],
                "cv_f1_macro": f"{self.results['cv_f1_macro_mean']:.3f} ± {self.results['cv_f1_macro_std']:.3f}"
            },
            "per_class_performance": self.results['per_class'],
            "total_classes": len(self.claim_types),
            "claim_types": self.claim_types
        }
    
    def print_detailed_results(self):
        """Print detailed classification results"""
        if not self.results:
            print("Model not trained yet!")
            return
        
        print("\n" + "="*80)
        print("MULTI-CLASS CLASSIFICATION RESULTS")
        print("="*80)
        
        print(f"\n📊 OVERALL PERFORMANCE:")
        print(f"Accuracy:     {self.results['accuracy']:.4f}")
        print(f"F1 Macro:     {self.results['f1_macro']:.4f}")
        print(f"F1 Weighted:  {self.results['f1_weighted']:.4f}")
        print(f"CV F1 Macro:  {self.results['cv_f1_macro_mean']:.4f} ± {self.results['cv_f1_macro_std']:.4f}")
        
        print(f"\n📋 PER-CLASS PERFORMANCE:")
        for claim_type, metrics in self.results['per_class'].items():
            print(f"\n{claim_type.replace('_', ' ').title()}:")
            print(f"  Precision: {metrics['precision']:.3f}")
            print(f"  Recall:    {metrics['recall']:.3f}")
            print(f"  F1:        {metrics['f1']:.3f}")
            print(f"  Support:   {metrics['support']}")

def main():
    """Main function to run multi-class classification training"""
    print("🚀 Starting Multi-Class Classification Training (Step 2)")
    print("=" * 60)
    
    try:
        # Initialize classifier
        classifier = MultiClassClassifier()
        
        # Generate training data
        X, y = classifier.generate_multi_class_data(n_samples=2000)
        
        # Train model
        results = classifier.train_model(X, y)
        
        # Print results
        classifier.print_detailed_results()
        
        # Save model
        classifier.save_model()
        
        # Test classification
        test_texts = [
            "Inventory lost during shipment to Amazon",
            "Product damaged during shipping",
            "Incorrect fee charged by Amazon"
        ]
        
        print(f"\n🧪 Test Classifications:")
        for text in test_texts:
            classification = classifier.classify_claim(text)
            print(f"\nText: {text}")
            print(f"Type: {classification.claim_type}")
            print(f"Confidence: {classification.confidence_score:.3f}")
            print(f"Claimability: {classification.claimability}")
            print(f"Evidence: {', '.join(classification.required_evidence[:2])}...")
        
        print("\n✅ Multi-Class Classification Complete!")
        print("📊 Model saved to 'models/' directory")
        print("🔹 Ready for Step 3: Confidence Calibration")
        
        return True
        
    except Exception as e:
        logger.error(f"Error in multi-class training: {e}")
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)

