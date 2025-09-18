#!/usr/bin/env python3
"""
QA Evaluation Script for FBA Claims Detection System
Evaluates the trained model on synthetic data and provides performance metrics
"""

import pandas as pd
import numpy as np
import pickle
import os
import sys
from pathlib import Path
from sklearn.metrics import recall_score, precision_score, accuracy_score, f1_score, classification_report, confusion_matrix
from typing import Dict, List, Tuple
import json

# Add src to path for imports
sys.path.append(str(Path(__file__).parent / "src"))

try:
    from ml_detector.enhanced_ml_detector import ClaimsDetector
    from rules_engine.rules_engine import RulesEngine
except ImportError:
    print("Warning: Could not import system components. Using basic evaluation only.")

class QAEvaluator:
    """QA Evaluator for the FBA Claims Detection System"""
    
    def __init__(self, data_path: str, model_path: str):
        self.data_path = data_path
        self.model_path = model_path
        self.data = None
        self.model = None
        self.predictions = None
        self.results = {}
        
    def load_data(self) -> pd.DataFrame:
        """Load the synthetic dataset"""
        print("Loading synthetic dataset...")
        try:
            self.data = pd.read_csv(self.data_path)
            print(f"Loaded {len(self.data)} samples")
            print(f"Columns: {list(self.data.columns)}")
            return self.data
        except Exception as e:
            print(f"Error loading data: {e}")
            return None
    
    def load_model(self):
        """Load the trained model"""
        print("Loading trained model...")
        try:
            # Try to load the improved model first
            if os.path.exists(self.model_path):
                with open(self.model_path, 'rb') as f:
                    self.model = pickle.load(f)
                print(f"Loaded model: {self.model_path}")
            else:
                print(f"Model not found: {self.model_path}")
                return False
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False
    
    def prepare_features(self, text: str) -> Dict:
        """Prepare features for the model"""
        # Basic feature extraction
        features = {
            'text_length': len(text),
            'word_count': len(text.split()),
            'has_order_id': 1 if any(word.isdigit() and len(word) > 8 for word in text.split()) else 0,
            'has_amount': 1 if any('$' in word or word.replace('.', '').isdigit() for word in text.split()) else 0,
            'claim_keywords': sum(1 for keyword in ['damaged', 'lost', 'missing', 'wrong', 'defective', 'broken', 'leaking'] 
                                if keyword.lower() in text.lower()),
            'urgency_keywords': sum(1 for keyword in ['urgent', 'expedited', 'asap', 'immediate'] 
                                  if keyword.lower() in text.lower())
        }
        return features
    
    def run_predictions(self) -> pd.DataFrame:
        """Run predictions on all samples"""
        print("Running predictions on synthetic data...")
        
        if self.model is None:
            print("No model loaded. Using basic rule-based predictions.")
            return self._basic_rule_predictions()
        
        predictions = []
        for idx, row in self.data.iterrows():
            try:
                # Prepare features
                features = self.prepare_features(row['text'])
                
                # Make prediction
                if hasattr(self.model, 'predict'):
                    # If it's a scikit-learn model
                    feature_vector = np.array([[
                        features['text_length'],
                        features['word_count'],
                        features['has_order_id'],
                        features['has_amount'],
                        features['claim_keywords'],
                        features['urgency_keywords']
                    ]])
                    pred = self.model.predict(feature_vector)[0]
                    prob = self.model.predict_proba(feature_vector)[0][1] if hasattr(self.model, 'predict_proba') else 0.5
                else:
                    # Fallback to basic prediction
                    pred = 1 if features['claim_keywords'] > 0 else 0
                    prob = 0.8 if features['claim_keywords'] > 0 else 0.2
                
                predictions.append({
                    'id': row['claim_id'],
                    'text': row['text'][:100] + '...' if len(row['text']) > 100 else row['text'],
                    'true_label': row['claimable'],
                    'predicted_label': pred,
                    'prediction_probability': prob,
                    'error_type': self._get_error_type(row['claimable'], pred)
                })
                
            except Exception as e:
                print(f"Error predicting sample {idx}: {e}")
                predictions.append({
                    'id': row['claim_id'],
                    'text': row['text'][:100] + '...' if len(row['text']) > 100 else row['text'],
                    'true_label': row['claimable'],
                    'predicted_label': 0,
                    'prediction_probability': 0.0,
                    'error_type': 'prediction_error'
                })
        
        self.predictions = pd.DataFrame(predictions)
        return self.predictions
    
    def _basic_rule_predictions(self) -> pd.DataFrame:
        """Fallback to basic rule-based predictions"""
        print("Using basic rule-based predictions...")
        predictions = []
        
        for idx, row in self.data.iterrows():
            text = row['text'].lower()
            claimable = row['claimable']
            
            # Simple rules
            claim_keywords = ['damaged', 'lost', 'missing', 'wrong', 'defective', 'broken', 'leaking']
            has_claim_keyword = any(keyword in text for keyword in claim_keywords)
            
            pred = 1 if has_claim_keyword else 0
            prob = 0.8 if has_claim_keyword else 0.2
            
            predictions.append({
                'id': row['claim_id'],
                'text': row['text'][:100] + '...' if len(row['text']) > 100 else row['text'],
                'true_label': claimable,
                'predicted_label': pred,
                'prediction_probability': prob,
                'error_type': self._get_error_type(claimable, pred)
            })
        
        self.predictions = pd.DataFrame(predictions)
        return self.predictions
    
    def _get_error_type(self, true_label: int, predicted_label: int) -> str:
        """Determine error type"""
        if true_label == predicted_label:
            return 'correct'
        elif true_label == 1 and predicted_label == 0:
            return 'false_negative'
        else:
            return 'false_positive'
    
    def calculate_metrics(self) -> Dict:
        """Calculate performance metrics"""
        print("Calculating performance metrics...")
        
        if self.predictions is None:
            print("No predictions available. Run predictions first.")
            return {}
        
        y_true = self.predictions['true_label'].values
        y_pred = self.predictions['predicted_label'].values
        
        metrics = {
            'recall': recall_score(y_true, y_pred, zero_division=0),
            'precision': precision_score(y_true, y_pred, zero_division=0),
            'accuracy': accuracy_score(y_true, y_pred),
            'f1_score': f1_score(y_true, y_pred, zero_division=0)
        }
        
        # Additional metrics
        total_samples = len(self.predictions)
        correct_predictions = len(self.predictions[self.predictions['error_type'] == 'correct'])
        false_positives = len(self.predictions[self.predictions['error_type'] == 'false_positive'])
        false_negatives = len(self.predictions[self.predictions['error_type'] == 'false_negative'])
        
        metrics.update({
            'total_samples': total_samples,
            'correct_predictions': correct_predictions,
            'false_positives': false_positives,
            'false_negatives': false_negatives,
            'false_positive_rate': false_positives / total_samples if total_samples > 0 else 0,
            'false_negative_rate': false_negatives / total_samples if total_samples > 0 else 0
        })
        
        self.results = metrics
        return metrics
    
    def analyze_errors(self) -> Dict:
        """Analyze false positives and false negatives"""
        print("Analyzing prediction errors...")
        
        if self.predictions is None:
            return {}
        
        # False Positives (predicted claimable but not actually claimable)
        false_positives = self.predictions[self.predictions['error_type'] == 'false_positive']
        
        # False Negatives (predicted not claimable but actually claimable)
        false_negatives = self.predictions[self.predictions['error_type'] == 'false_negative']
        
        error_analysis = {
            'false_positives_count': len(false_positives),
            'false_negatives_count': len(false_negatives),
            'false_positives_samples': false_positives.head(5).to_dict('records') if len(false_positives) > 0 else [],
            'false_negatives_samples': false_negatives.head(5).to_dict('records') if len(false_negatives) > 0 else []
        }
        
        return error_analysis
    
    def generate_recommendations(self) -> List[str]:
        """Generate actionable recommendations based on error analysis"""
        print("Generating recommendations...")
        
        recommendations = []
        
        if self.results.get('recall', 0) < 0.9:
            recommendations.append("Increase focus on detecting all claimable transactions - current recall is below 90%")
        
        if self.results.get('precision', 0) < 0.8:
            recommendations.append("Reduce false positives by improving claim validation rules")
        
        if self.results.get('false_negative_rate', 0) > 0.1:
            recommendations.append("Critical: Too many missed claims. Review feature engineering and model thresholds")
        
        if self.results.get('false_positive_rate', 0) > 0.2:
            recommendations.append("High false positive rate - consider tightening claim criteria")
        
        # Analyze text patterns in errors
        if self.predictions is not None:
            false_negatives = self.predictions[self.predictions['error_type'] == 'false_negative']
            if len(false_negatives) > 0:
                # Look for common patterns in missed claims
                recommendations.append("Review false negative samples to identify missed claim patterns")
            
            false_positives = self.predictions[self.predictions['error_type'] == 'false_positive']
            if len(false_positives) > 0:
                recommendations.append("Review false positive samples to reduce unnecessary claim submissions")
        
        if not recommendations:
            recommendations.append("Model performance is good. Continue monitoring for drift.")
        
        return recommendations
    
    def print_summary_report(self):
        """Print comprehensive summary report"""
        print("\n" + "="*80)
        print("FBA CLAIMS DETECTION SYSTEM - QA EVALUATION REPORT")
        print("="*80)
        
        # Overall Metrics
        print("\n📊 OVERALL PERFORMANCE METRICS:")
        print("-" * 50)
        if self.results:
            print(f"Recall (Priority):     {self.results.get('recall', 0):.3f}")
            print(f"Precision:             {self.results.get('precision', 0):.3f}")
            print(f"Accuracy:              {self.results.get('accuracy', 0):.3f}")
            print(f"F1-Score:              {self.results.get('f1_score', 0):.3f}")
            print(f"Total Samples:         {self.results.get('total_samples', 0)}")
            print(f"Correct Predictions:   {self.results.get('correct_predictions', 0)}")
            print(f"False Positives:       {self.results.get('false_positives', 0)}")
            print(f"False Negatives:       {self.results.get('false_negatives', 0)}")
        
        # Error Analysis
        print("\n🔍 ERROR ANALYSIS:")
        print("-" * 50)
        error_analysis = self.analyze_errors()
        
        if error_analysis.get('false_positives_count', 0) > 0:
            print(f"False Positives: {error_analysis['false_positives_count']} samples")
            print("Sample False Positives:")
            for i, sample in enumerate(error_analysis['false_positives_samples'][:3], 1):
                print(f"  {i}. ID: {sample['id']}")
                print(f"     Text: {sample['text']}")
                print(f"     True: {sample['true_label']}, Predicted: {sample['predicted_label']}")
        
        if error_analysis.get('false_negatives_count', 0) > 0:
            print(f"\nFalse Negatives: {error_analysis['false_negatives_count']} samples")
            print("Sample False Negatives:")
            for i, sample in enumerate(error_analysis['false_negatives_samples'][:3], 1):
                print(f"  {i}. ID: {sample['id']}")
                print(f"     Text: {sample['text']}")
                print(f"     True: {sample['true_label']}, Predicted: {sample['predicted_label']}")
        
        # Recommendations
        print("\n💡 ACTIONABLE RECOMMENDATIONS:")
        print("-" * 50)
        recommendations = self.generate_recommendations()
        for i, rec in enumerate(recommendations, 1):
            print(f"{i}. {rec}")
        
        # Sample Predictions Table
        print("\n📋 SAMPLE PREDICTIONS TABLE (First 10):")
        print("-" * 80)
        if self.predictions is not None:
            sample_table = self.predictions.head(10)[['id', 'text', 'true_label', 'predicted_label', 'error_type']]
            print(sample_table.to_string(index=False, max_colwidth=50))
        
        print("\n" + "="*80)
    
    def save_results(self, output_path: str = "qa_evaluation_results.json"):
        """Save evaluation results to file"""
        try:
            results_data = {
                'metrics': self.results,
                'error_analysis': self.analyze_errors(),
                'recommendations': self.generate_recommendations(),
                'sample_predictions': self.predictions.head(20).to_dict('records') if self.predictions is not None else []
            }
            
            with open(output_path, 'w') as f:
                json.dump(results_data, f, indent=2, default=str)
            
            print(f"Results saved to: {output_path}")
        except Exception as e:
            print(f"Error saving results: {e}")

def main():
    """Main evaluation function"""
    print("🚀 Starting QA Evaluation of FBA Claims Detection System...")
    
    # Paths
    data_path = "data/cleaned_fba_claims_dataset.csv"
    model_path = "models/improved_fba_claims_model.pkl"
    
    # Initialize evaluator
    evaluator = QAEvaluator(data_path, model_path)
    
    # Load data
    data = evaluator.load_data()
    if data is None:
        print("❌ Failed to load data. Exiting.")
        return
    
    # Load model
    if not evaluator.load_model():
        print("⚠️  Model loading failed. Will use basic rule-based evaluation.")
    
    # Run predictions
    evaluator.run_predictions()
    
    # Calculate metrics
    evaluator.calculate_metrics()
    
    # Generate and print report
    evaluator.print_summary_report()
    
    # Save results
    evaluator.save_results()
    
    print("\n✅ QA Evaluation completed successfully!")

if __name__ == "__main__":
    main()
