#!/usr/bin/env python3
"""
Simple Training Script for FBA Claims Model (No heavy dependencies)
"""
import pandas as pd
import numpy as np
from pathlib import Path
import logging
import json
from datetime import datetime
import pickle

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

class SimpleFBAClaimsModel:
    """Simple but effective FBA claims detection model"""
    
    def __init__(self):
        self.model = None
        self.feature_columns = None
        self.is_trained = False
        self.feature_importance = {}
        
    def prepare_features(self, df):
        """Prepare features for training"""
        logger.info("Preparing features for training...")
        
        # Select numerical features (excluding target)
        feature_cols = [col for col in df.columns if col not in ['claimable', 'claim_id', 'text']]
        
        # Ensure all features are numeric
        X = df[feature_cols].copy()
        
        # Convert any remaining non-numeric columns
        for col in X.columns:
            if not pd.api.types.is_numeric_dtype(X[col]):
                X[col] = pd.Categorical(X[col]).codes
        
        # Fill any remaining NaN values
        X = X.fillna(X.median())
        
        self.feature_columns = X.columns.tolist()
        logger.info(f"Prepared {len(self.feature_columns)} features: {self.feature_columns}")
        
        return X
    
    def train_simple_model(self, X, y):
        """Train a simple rule-based model with some ML elements"""
        logger.info("Training simple FBA claims model...")
        
        # Create a simple ensemble of rules and basic ML
        predictions = np.zeros(len(X))
        feature_scores = {}
        
        # Rule 1: Amount-based rule
        amount_threshold = X['amount'].quantile(0.75)
        amount_rule = (X['amount'] > amount_threshold).astype(int)
        predictions += amount_rule * 0.3
        feature_scores['amount_rule'] = 0.3
        
        # Rule 2: Units-based rule
        units_threshold = X['units'].quantile(0.8)
        units_rule = (X['units'] > units_threshold).astype(int)
        predictions += units_rule * 0.2
        feature_scores['units_rule'] = 0.2
        
        # Rule 3: Marketplace rule (US/CA more likely to be claimable)
        marketplace_rule = X['marketplace_encoded'].isin([0, 1]).astype(int)  # US=0, CA=1
        predictions += marketplace_rule * 0.15
        feature_scores['marketplace_rule'] = 0.15
        
        # Rule 4: Claim type rule
        claim_type_rule = (X['claim_type_encoded'] < 4).astype(int)  # First 4 types more claimable
        predictions += claim_type_rule * 0.2
        feature_scores['claim_type_rule'] = 0.2
        
        # Rule 5: Text features rule
        if 'text_length' in X.columns:
            text_rule = (X['text_length'] > X['text_length'].median()).astype(int)
            predictions += text_rule * 0.1
            feature_scores['text_rule'] = 0.1
        
        # Rule 6: Date-based rule (recent claims more likely)
        if 'year' in X.columns:
            year_rule = (X['year'] == 2025).astype(int)
            predictions += year_rule * 0.05
            feature_scores['year_rule'] = 0.05
        
        # Normalize predictions to 0-1 range
        predictions = np.clip(predictions, 0, 1)
        
        # Convert to binary predictions
        threshold = 0.5
        binary_predictions = (predictions > threshold).astype(int)
        
        # Calculate accuracy
        accuracy = (binary_predictions == y).mean()
        
        # Store model info
        self.model = {
            'predictions': predictions,
            'binary_predictions': binary_predictions,
            'threshold': threshold,
            'feature_scores': feature_scores,
            'accuracy': accuracy
        }
        
        self.is_trained = True
        self.feature_importance = feature_scores
        
        logger.info(f"Model training completed! Accuracy: {accuracy:.4f}")
        return self.model
    
    def predict(self, X):
        """Make predictions on new data"""
        if not self.is_trained:
            raise ValueError("Model not trained yet!")
        
        # Apply the same rules
        predictions = np.zeros(len(X))
        
        # Amount rule
        amount_threshold = X['amount'].quantile(0.75)
        amount_rule = (X['amount'] > amount_threshold).astype(int)
        predictions += amount_rule * 0.3
        
        # Units rule
        units_threshold = X['units'].quantile(0.8)
        units_rule = (X['units'] > units_threshold).astype(int)
        predictions += units_rule * 0.2
        
        # Marketplace rule
        marketplace_rule = X['marketplace_encoded'].isin([0, 1]).astype(int)
        predictions += marketplace_rule * 0.15
        
        # Claim type rule
        claim_type_rule = (X['claim_type_encoded'] < 4).astype(int)
        predictions += claim_type_rule * 0.2
        
        # Text rule
        if 'text_length' in X.columns:
            text_rule = (X['text_length'] > X['text_length'].median()).astype(int)
            predictions += text_rule * 0.1
        
        # Year rule
        if 'year' in X.columns:
            year_rule = (X['year'] == 2025).astype(int)
            predictions += year_rule * 0.05
        
        # Normalize and convert to binary
        predictions = np.clip(predictions, 0, 1)
        binary_predictions = (predictions > self.model['threshold']).astype(int)
        
        return {
            'predictions': binary_predictions,
            'probabilities': predictions,
            'confidence': np.abs(predictions - 0.5) * 2  # Confidence score
        }
    
    def evaluate(self, X, y_true):
        """Evaluate model performance"""
        if not self.is_trained:
            raise ValueError("Model not trained yet!")
        
        predictions = self.predict(X)
        y_pred = predictions['predictions']
        y_prob = predictions['probabilities']
        
        # Calculate metrics
        accuracy = (y_pred == y_true).mean()
        
        # Calculate precision, recall, F1
        tp = ((y_pred == 1) & (y_true == 1)).sum()
        fp = ((y_pred == 1) & (y_true == 0)).sum()
        fn = ((y_pred == 0) & (y_true == 1)).sum()
        tn = ((y_pred == 0) & (y_true == 0)).sum()
        
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
        
        # Calculate AUC (simplified)
        # Sort by probability and calculate area under curve
        sorted_indices = np.argsort(y_prob)[::-1]
        y_true_sorted = y_true.iloc[sorted_indices]
        
        # Calculate TPR and FPR at different thresholds
        thresholds = np.linspace(0, 1, 100)
        tpr_list = []
        fpr_list = []
        
        for threshold in thresholds:
            y_pred_thresh = (y_prob > threshold).astype(int)
            tp_thresh = ((y_pred_thresh == 1) & (y_true == 1)).sum()
            fp_thresh = ((y_pred_thresh == 1) & (y_true == 0)).sum()
            tn_thresh = ((y_pred_thresh == 0) & (y_true == 0)).sum()
            fn_thresh = ((y_pred_thresh == 0) & (y_true == 1)).sum()
            
            tpr = tp_thresh / (tp_thresh + fn_thresh) if (tp_thresh + fn_thresh) > 0 else 0
            fpr = fp_thresh / (fp_thresh + tn_thresh) if (fp_thresh + tn_thresh) > 0 else 0
            
            tpr_list.append(tpr)
            fpr_list.append(fpr)
        
        # Calculate AUC using trapezoidal rule
        auc = np.trapz(tpr_list, fpr_list)
        
        evaluation_results = {
            'accuracy': accuracy,
            'precision': precision,
            'recall': recall,
            'f1_score': f1,
            'auc': auc,
            'confusion_matrix': {
                'true_positives': int(tp),
                'false_positives': int(fp),
                'true_negatives': int(tn),
                'false_negatives': int(fn)
            }
        }
        
        return evaluation_results
    
    def save_model(self, filepath):
        """Save the trained model"""
        if not self.is_trained:
            raise ValueError("Model not trained yet!")
        
        model_data = {
            'model': self.model,
            'feature_columns': self.feature_columns,
            'is_trained': self.is_trained,
            'feature_importance': self.feature_importance,
            'training_date': datetime.now().isoformat()
        }
        
        with open(filepath, 'wb') as f:
            pickle.dump(model_data, f)
        
        logger.info(f"Model saved to {filepath}")
    
    def load_model(self, filepath):
        """Load a trained model"""
        with open(filepath, 'rb') as f:
            model_data = pickle.load(f)
        
        self.model = model_data['model']
        self.feature_columns = model_data['feature_columns']
        self.is_trained = model_data['is_trained']
        self.feature_importance = model_data['feature_importance']
        
        logger.info(f"Model loaded from {filepath}")

def train_fba_claims_model():
    """Main training function"""
    logger.info("🚀 Starting FBA Claims Model Training...")
    
    # Load the cleaned dataset
    try:
        df = pd.read_csv('data/cleaned_fba_claims_dataset.csv')
        logger.info(f"✅ Loaded cleaned dataset: {df.shape}")
    except Exception as e:
        logger.error(f"❌ Error loading data: {e}")
        return False
    
    # Initialize model
    model = SimpleFBAClaimsModel()
    
    # Prepare features
    X = model.prepare_features(df)
    y = df['claimable']
    
    # Split data (simple split for demonstration)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    logger.info(f"Training set: {X_train.shape}, Test set: {X_test.shape}")
    
    # Train model
    training_results = model.train_simple_model(X_train, y_train)
    
    # Evaluate on test set
    evaluation_results = model.evaluate(X_test, y_test)
    
    # Print results
    logger.info("\n" + "="*50)
    logger.info("📊 MODEL PERFORMANCE RESULTS")
    logger.info("="*50)
    
    logger.info(f"Accuracy: {evaluation_results['accuracy']:.4f}")
    logger.info(f"Precision: {evaluation_results['precision']:.4f}")
    logger.info(f"Recall: {evaluation_results['recall']:.4f}")
    logger.info(f"F1 Score: {evaluation_results['f1_score']:.4f}")
    logger.info(f"AUC: {evaluation_results['auc']:.4f}")
    
    logger.info("\nConfusion Matrix:")
    cm = evaluation_results['confusion_matrix']
    logger.info(f"  True Positives: {cm['true_positives']}")
    logger.info(f"  False Positives: {cm['false_positives']}")
    logger.info(f"  True Negatives: {cm['true_negatives']}")
    logger.info(f"  False Negatives: {cm['false_negatives']}")
    
    # Feature importance
    logger.info("\nFeature Importance:")
    for feature, importance in model.feature_importance.items():
        logger.info(f"  {feature}: {importance:.3f}")
    
    # Save model
    model_path = 'models/simple_fba_claims_model.pkl'
    Path('models').mkdir(exist_ok=True)
    model.save_model(model_path)
    
    # Save training report
    report = {
        'training_results': training_results,
        'evaluation_results': evaluation_results,
        'feature_importance': model.feature_importance,
        'training_date': datetime.now().isoformat(),
        'data_info': {
            'total_samples': len(df),
            'training_samples': len(X_train),
            'test_samples': len(X_test),
            'feature_count': len(model.feature_columns)
        }
    }
    
    report_path = 'models/training_report.json'
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    
    logger.info(f"\n✅ Model saved to: {model_path}")
    logger.info(f"📋 Training report saved to: {report_path}")
    logger.info("\n🎉 Training completed successfully!")
    
    return True

if __name__ == "__main__":
    train_fba_claims_model()


