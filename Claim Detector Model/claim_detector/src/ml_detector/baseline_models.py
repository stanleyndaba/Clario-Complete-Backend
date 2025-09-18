# -*- coding: utf-8 -*-
"""
Baseline Models for Claim Detector v2.0 - Step 1

This module implements and validates baseline models (Logistic Regression, TF-IDF)
to establish performance benchmarks before expanding to multi-class classification.
"""

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    precision_score, recall_score, f1_score, accuracy_score,
    confusion_matrix, classification_report, roc_auc_score
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import joblib
import logging
from typing import Dict, List, Tuple, Any
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class BaselineModels:
    """Baseline models for binary classification (approved vs rejected)"""
    
    def __init__(self):
        self.models = {}
        self.vectorizer = None
        self.scaler = StandardScaler()
        self.results = {}
        
    def create_tfidf_logistic_pipeline(self) -> Pipeline:
        """Create TF-IDF + Logistic Regression pipeline"""
        pipeline = Pipeline([
            ('tfidf', TfidfVectorizer(
                max_features=5000,
                ngram_range=(1, 2),
                stop_words='english',
                min_df=2,
                max_df=0.95
            )),
            ('classifier', LogisticRegression(
                random_state=42,
                max_iter=1000,
                C=1.0
            ))
        ])
        return pipeline
    
    def create_simple_logistic_pipeline(self) -> Pipeline:
        """Create simple Logistic Regression pipeline"""
        pipeline = Pipeline([
            ('classifier', LogisticRegression(
                random_state=42,
                max_iter=1000,
                C=1.0
            ))
        ])
        return pipeline
    
    def generate_mock_data(self, n_samples: int = 1000) -> Tuple[np.ndarray, np.ndarray]:
        """Generate mock training data for baseline testing"""
        logger.info(f"Generating {n_samples} mock samples...")
        
        # Mock claim descriptions
        claim_descriptions = [
            "Inventory lost during shipment",
            "Package damaged in transit",
            "Wrong fee charged by Amazon",
            "Missing reimbursement for return",
            "Warehouse processing error",
            "Shipping delay caused damage",
            "Quality issue with product",
            "Packaging damaged in FC",
            "Product expired before sale",
            "Recalled item still in inventory",
            "Counterfeit item detected",
            "Inventory adjustment needed",
            "Fee calculation error",
            "Return processing delay",
            "Shipment reconciliation issue"
        ]
        
        # Generate random text combinations
        np.random.seed(42)
        X = []
        y = []
        
        for i in range(n_samples):
            # Randomly select 1-3 claim descriptions
            num_descriptions = np.random.randint(1, 4)
            selected_descriptions = np.random.choice(claim_descriptions, num_descriptions, replace=False)
            
            # Combine with some random noise
            text = " ".join(selected_descriptions)
            if np.random.random() < 0.3:  # 30% chance to add noise
                noise_words = ["urgent", "important", "review", "check", "verify"]
                text += " " + " ".join(np.random.choice(noise_words, np.random.randint(1, 3)))
            
            X.append(text)
            
            # Generate labels (0 = approved, 1 = rejected)
            # Simple rule: if contains certain keywords, more likely to be rejected
            rejection_keywords = ["damaged", "lost", "error", "missing", "expired", "recalled", "counterfeit"]
            rejection_score = sum(1 for keyword in rejection_keywords if keyword in text.lower())
            
            # Higher rejection score = higher probability of rejection
            prob_rejection = min(0.9, 0.3 + (rejection_score * 0.15))
            y.append(np.random.binomial(1, prob_rejection))
        
        logger.info(f"Generated {len(X)} samples with {sum(y)} rejections ({sum(y)/len(y)*100:.1f}%)")
        return np.array(X), np.array(y)
    
    def train_baseline_models(self, X: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
        """Train baseline models and collect metrics"""
        logger.info("Training baseline models...")
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Train TF-IDF + Logistic Regression
        tfidf_pipeline = self.create_tfidf_logistic_pipeline()
        tfidf_pipeline.fit(X_train, y_train)
        
        # Train simple Logistic Regression
        simple_pipeline = self.create_simple_logistic_pipeline()
        simple_pipeline.fit(X_train, y_train)
        
        # Store models
        self.models['tfidf_logistic'] = tfidf_pipeline
        self.models['simple_logistic'] = simple_pipeline
        
        # Evaluate models
        results = {}
        for name, model in self.models.items():
            logger.info(f"Evaluating {name}...")
            
            # Predictions
            y_pred = model.predict(X_test)
            y_pred_proba = model.predict_proba(X_test)[:, 1] if hasattr(model, 'predict_proba') else None
            
            # Calculate metrics
            metrics = {
                'accuracy': accuracy_score(y_test, y_pred),
                'precision': precision_score(y_test, y_pred, zero_division=0),
                'recall': recall_score(y_test, y_pred, zero_division=0),
                'f1': f1_score(y_test, y_pred, zero_division=0),
                'confusion_matrix': confusion_matrix(y_test, y_pred).tolist()
            }
            
            # Add ROC AUC if probabilities available
            if y_pred_proba is not None:
                try:
                    metrics['roc_auc'] = roc_auc_score(y_test, y_pred_proba)
                except:
                    metrics['roc_auc'] = None
            
            # Cross-validation scores
            cv_scores = cross_val_score(model, X_train, y_train, cv=5, scoring='f1')
            metrics['cv_f1_mean'] = cv_scores.mean()
            metrics['cv_f1_std'] = cv_scores.std()
            
            results[name] = metrics
            
            logger.info(f"{name} - F1: {metrics['f1']:.3f}, Accuracy: {metrics['accuracy']:.3f}")
        
        self.results = results
        return results
    
    def save_models(self, output_dir: str = "models"):
        """Save trained models to disk"""
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        for name, model in self.models.items():
            filepath = os.path.join(output_dir, f"{name}_baseline.pkl")
            joblib.dump(model, filepath)
            logger.info(f"Saved {name} to {filepath}")
    
    def load_models(self, models_dir: str = "models"):
        """Load trained models from disk"""
        for name in ['tfidf_logistic', 'simple_logistic']:
            filepath = os.path.join(models_dir, f"{name}_baseline.pkl")
            if os.path.exists(filepath):
                self.models[name] = joblib.load(filepath)
                logger.info(f"Loaded {name} from {filepath}")
    
    def predict_claim(self, text: str, model_name: str = 'tfidf_logistic') -> Dict[str, Any]:
        """Predict claim approval/rejection using specified model"""
        if model_name not in self.models:
            raise ValueError(f"Model {model_name} not found. Available: {list(self.models.keys())}")
        
        model = self.models[model_name]
        
        # Make prediction
        prediction = model.predict([text])[0]
        probability = model.predict_proba([text])[0] if hasattr(model, 'predict_proba') else None
        
        result = {
            'text': text,
            'prediction': 'rejected' if prediction == 1 else 'approved',
            'confidence': probability[1] if probability is not None else 0.5,
            'model_used': model_name
        }
        
        return result
    
    def get_performance_summary(self) -> Dict[str, Any]:
        """Get comprehensive performance summary"""
        if not self.results:
            return {"error": "No models trained yet"}
        
        summary = {
            "total_models": len(self.results),
            "models": list(self.results.keys()),
            "performance_comparison": {},
            "best_model": None,
            "overall_metrics": {}
        }
        
        # Compare models
        best_f1 = 0
        best_model = None
        
        for name, metrics in self.results.items():
            summary["performance_comparison"][name] = {
                "f1_score": metrics['f1'],
                "accuracy": metrics['accuracy'],
                "precision": metrics['precision'],
                "recall": metrics['recall'],
                "roc_auc": metrics.get('roc_auc', 'N/A'),
                "cv_f1_mean": metrics['cv_f1_mean'],
                "cv_f1_std": metrics['cv_f1_std']
            }
            
            if metrics['f1'] > best_f1:
                best_f1 = metrics['f1']
                best_model = name
        
        summary["best_model"] = best_model
        summary["best_f1_score"] = best_f1
        
        # Overall metrics
        if self.results:
            summary["overall_metrics"] = {
                "avg_f1": np.mean([m['f1'] for m in self.results.values()]),
                "avg_accuracy": np.mean([m['accuracy'] for m in self.results.values()]),
                "avg_precision": np.mean([m['precision'] for m in self.results.values()]),
                "avg_recall": np.mean([m['recall'] for m in self.results.values()])
            }
        
        return summary
    
    def print_detailed_results(self):
        """Print detailed results for each model"""
        if not self.results:
            print("No models trained yet!")
            return
        
        print("\n" + "="*80)
        print("BASELINE MODELS PERFORMANCE RESULTS")
        print("="*80)
        
        for name, metrics in self.results.items():
            print(f"\n📊 {name.upper()}")
            print("-" * 40)
            print(f"Accuracy:  {metrics['accuracy']:.4f}")
            print(f"Precision: {metrics['precision']:.4f}")
            print(f"Recall:    {metrics['recall']:.4f}")
            print(f"F1-Score:  {metrics['f1']:.4f}")
            if metrics.get('roc_auc'):
                print(f"ROC AUC:   {metrics['roc_auc']:.4f}")
            print(f"CV F1:     {metrics['cv_f1_mean']:.4f} ± {metrics['cv_f1_std']:.4f}")
            
            # Confusion matrix
            cm = np.array(metrics['confusion_matrix'])
            print(f"\nConfusion Matrix:")
            print(f"                Predicted")
            print(f"                Approved  Rejected")
            print(f"Actual Approved  {cm[0,0]:8d}  {cm[0,1]:8d}")
            print(f"      Rejected   {cm[1,0]:8d}  {cm[1,1]:8d}")
        
        # Summary
        summary = self.get_performance_summary()
        print(f"\n🏆 BEST MODEL: {summary['best_model']}")
        print(f"   Best F1 Score: {summary['best_f1_score']:.4f}")
        
        print(f"\n📈 OVERALL AVERAGES:")
        overall = summary['overall_metrics']
        print(f"   F1: {overall['avg_f1']:.4f}")
        print(f"   Accuracy: {overall['avg_accuracy']:.4f}")
        print(f"   Precision: {overall['avg_precision']:.4f}")
        print(f"   Recall: {overall['avg_recall']:.4f}")

def main():
    """Main function to run baseline model training and evaluation"""
    print("🚀 Starting Baseline Models Training (Step 1)")
    print("=" * 60)
    
    try:
        # Initialize baseline models
        baseline = BaselineModels()
        
        # Generate mock data
        X, y = baseline.generate_mock_data(n_samples=1000)
        
        # Train models
        results = baseline.train_baseline_models(X, y)
        
        # Print results
        baseline.print_detailed_results()
        
        # Save models
        baseline.save_models()
        
        # Test prediction
        test_text = "Inventory lost during shipment, need reimbursement"
        prediction = baseline.predict_claim(test_text)
        print(f"\n🧪 Test Prediction:")
        print(f"Text: {test_text}")
        print(f"Prediction: {prediction['prediction']}")
        print(f"Confidence: {prediction['confidence']:.3f}")
        
        print("\n✅ Baseline Models Training Complete!")
        print("📊 Models saved to 'models/' directory")
        print("🔹 Ready for Step 2: Multi-class Classification")
        
        return True
        
    except Exception as e:
        logger.error(f"Error in baseline training: {e}")
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
