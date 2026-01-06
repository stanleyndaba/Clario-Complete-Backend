#!/usr/bin/env python3
"""
Improved Training Script for FBA Claims Model with Better Class Imbalance Handling
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

class ImprovedFBAClaimsModel:
    """Improved FBA claims detection model with better class imbalance handling"""
    
    def __init__(self):
        self.model = None
        self.feature_columns = None
        self.is_trained = False
        self.feature_importance = {}
        self.threshold = 0.5
        
    def prepare_features(self, df):
        """Prepare features with better engineering"""
        logger.info("Preparing improved features for training...")
        
        # Create a copy to avoid modifying original
        df_features = df.copy()
        
        # 1. Create interaction features
        df_features['amount_per_unit'] = df_features['amount'] / (df_features['units'] + 1)
        df_features['amount_per_unit'] = df_features['amount_per_unit'].fillna(df_features['amount_per_unit'].median())
        
        # 2. Create ratio features
        df_features['text_density'] = df_features['word_count'] / (df_features['text_length'] + 1)
        
        # 3. Create binned features
        df_features['amount_bin'] = pd.cut(df_features['amount'], bins=5, labels=False)
        df_features['units_bin'] = pd.cut(df_features['units'], bins=5, labels=False)
        
        # 4. Create time-based features
        if 'date' in df_features.columns:
            df_features['date'] = pd.to_datetime(df_features['date'], errors='coerce')
            df_features['days_since_epoch'] = (df_features['date'] - pd.Timestamp('2020-01-01')).dt.days
            df_features['days_since_epoch'] = df_features['days_since_epoch'].fillna(df_features['days_since_epoch'].median())
        
        # 5. Create marketplace-specific features
        marketplace_mapping = {'US': 0, 'CA': 1, 'UK': 2, 'DE': 3, 'JP': 4}
        df_features['marketplace_numeric'] = df_features['marketplace'].map(marketplace_mapping)
        
        # 6. Create claim type features
        claim_type_mapping = {
            'fba_lost_inventory': 0,
            'fba_fee_overcharges': 1,
            'fba_damaged_goods': 2,
            'text_based_claim': 3,
            'missing_reimbursements': 4,
            'dimension_weight_errors': 5,
            'destroyed_inventory': 6,
            'high_value_edge_cases': 7,
            'non-claim': 8
        }
        df_features['claim_type_numeric'] = df_features['claim_type'].map(claim_type_mapping)
        
        # Select numerical features (excluding target and text)
        exclude_cols = ['claimable', 'claim_id', 'text', 'date', 'marketplace', 'claim_type']
        feature_cols = [col for col in df_features.columns if col not in exclude_cols]
        
        # Ensure all features are numeric
        X = df_features[feature_cols].copy()
        
        # Convert any remaining non-numeric columns
        for col in X.columns:
            if not pd.api.types.is_numeric_dtype(X[col]):
                X[col] = pd.Categorical(X[col]).codes
        
        # Fill any remaining NaN values
        X = X.fillna(X.median())
        
        # Handle infinite values
        X = X.replace([np.inf, -np.inf], np.nan)
        X = X.fillna(X.median())
        
        self.feature_columns = X.columns.tolist()
        logger.info(f"Prepared {len(self.feature_columns)} improved features")
        
        return X
    
    def train_improved_model(self, X, y):
        """Train an improved model with better class imbalance handling"""
        logger.info("Training improved FBA claims model...")
        
        # Calculate class weights to handle imbalance
        class_counts = y.value_counts()
        total_samples = len(y)
        class_weight_0 = total_samples / (2 * class_counts[0])
        class_weight_1 = total_samples / (2 * class_counts[1])
        
        logger.info(f"Class weights - Non-claimable: {class_weight_0:.3f}, Claimable: {class_weight_1:.3f}")
        
        # Create weighted ensemble of rules
        predictions = np.zeros(len(X))
        feature_scores = {}
        
        # Rule 1: Amount-based rule (weighted by class)
        amount_threshold = X['amount'].quantile(0.7)
        amount_rule = (X['amount'] > amount_threshold).astype(int)
        amount_weight = 0.25 * class_weight_1
        predictions += amount_rule * amount_weight
        feature_scores['amount_rule'] = amount_weight
        
        # Rule 2: Units-based rule
        units_threshold = X['units'].quantile(0.75)
        units_rule = (X['units'] > units_threshold).astype(int)
        units_weight = 0.20 * class_weight_1
        predictions += units_rule * units_weight
        feature_scores['units_rule'] = units_weight
        
        # Rule 3: Amount per unit rule
        if 'amount_per_unit' in X.columns:
            apu_threshold = X['amount_per_unit'].quantile(0.8)
            apu_rule = (X['amount_per_unit'] > apu_threshold).astype(int)
            apu_weight = 0.15 * class_weight_1
            predictions += apu_rule * apu_weight
            feature_scores['amount_per_unit_rule'] = apu_weight
        
        # Rule 4: Marketplace rule (US/CA more likely)
        if 'marketplace_numeric' in X.columns:
            marketplace_rule = (X['marketplace_numeric'].isin([0, 1])).astype(int)
            marketplace_weight = 0.15 * class_weight_1
            predictions += marketplace_rule * marketplace_weight
            feature_scores['marketplace_rule'] = marketplace_weight
        
        # Rule 5: Claim type rule
        if 'claim_type_numeric' in X.columns:
            claim_type_rule = (X['claim_type_numeric'] < 4).astype(int)
            claim_type_weight = 0.15 * class_weight_1
            predictions += claim_type_rule * claim_type_weight
            feature_scores['claim_type_rule'] = claim_type_weight
        
        # Rule 6: Text features rule
        if 'text_length' in X.columns:
            text_threshold = X['text_length'].quantile(0.6)
            text_rule = (X['text_length'] > text_threshold).astype(int)
            text_weight = 0.10 * class_weight_1
            predictions += text_rule * text_weight
            feature_scores['text_rule'] = text_weight
        
        # Normalize predictions
        max_pred = predictions.max()
        if max_pred > 0:
            predictions = predictions / max_pred
        
        # Apply sigmoid-like transformation for better probability distribution
        predictions = 1 / (1 + np.exp(-2 * (predictions - 0.5)))
        
        # Find optimal threshold using ROC analysis
        thresholds = np.linspace(0.1, 0.9, 100)
        best_f1 = 0
        best_threshold = 0.5
        
        for threshold in thresholds:
            binary_preds = (predictions > threshold).astype(int)
            
            # Calculate F1 score
            tp = ((binary_preds == 1) & (y == 1)).sum()
            fp = ((binary_preds == 1) & (y == 0)).sum()
            fn = ((binary_preds == 0) & (y == 1)).sum()
            
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0
            f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
            
            if f1 > best_f1:
                best_f1 = f1
                best_threshold = threshold
        
        self.threshold = best_threshold
        logger.info(f"Optimal threshold found: {best_threshold:.3f} (F1: {best_f1:.3f})")
        
        # Calculate final predictions
        binary_predictions = (predictions > best_threshold).astype(int)
        accuracy = (binary_predictions == y).mean()
        
        # Store model info
        self.model = {
            'predictions': predictions,
            'binary_predictions': binary_predictions,
            'threshold': best_threshold,
            'feature_scores': feature_scores,
            'accuracy': accuracy,
            'class_weights': {'non_claimable': class_weight_0, 'claimable': class_weight_1}
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
        amount_threshold = X['amount'].quantile(0.7)
        amount_rule = (X['amount'] > amount_threshold).astype(int)
        amount_weight = self.model['feature_scores'].get('amount_rule', 0.25)
        predictions += amount_rule * amount_weight
        
        # Units rule
        units_threshold = X['units'].quantile(0.75)
        units_rule = (X['units'] > units_threshold).astype(int)
        units_weight = self.model['feature_scores'].get('units_rule', 0.20)
        predictions += units_rule * units_weight
        
        # Amount per unit rule
        if 'amount_per_unit' in X.columns:
            apu_threshold = X['amount_per_unit'].quantile(0.8)
            apu_rule = (X['amount_per_unit'] > apu_threshold).astype(int)
            apu_weight = self.model['feature_scores'].get('amount_per_unit_rule', 0.15)
            predictions += apu_rule * apu_weight
        
        # Marketplace rule
        if 'marketplace_numeric' in X.columns:
            marketplace_rule = (X['marketplace_numeric'].isin([0, 1])).astype(int)
            marketplace_weight = self.model['feature_scores'].get('marketplace_rule', 0.15)
            predictions += marketplace_rule * marketplace_weight
        
        # Claim type rule
        if 'claim_type_numeric' in X.columns:
            claim_type_rule = (X['claim_type_numeric'] < 4).astype(int)
            claim_type_weight = self.model['feature_scores'].get('claim_type_rule', 0.15)
            predictions += claim_type_rule * claim_type_weight
        
        # Text rule
        if 'text_length' in X.columns:
            text_threshold = X['text_length'].quantile(0.6)
            text_rule = (X['text_length'] > text_threshold).astype(int)
            text_weight = self.model['feature_scores'].get('text_rule', 0.10)
            predictions += text_rule * text_weight
        
        # Normalize and apply sigmoid transformation
        max_pred = predictions.max()
        if max_pred > 0:
            predictions = predictions / max_pred
        
        predictions = 1 / (1 + np.exp(-2 * (predictions - 0.5)))
        
        # Convert to binary predictions
        binary_predictions = (predictions > self.threshold).astype(int)
        
        return {
            'predictions': binary_predictions,
            'probabilities': predictions,
            'confidence': np.abs(predictions - 0.5) * 2
        }
    
    def evaluate(self, X, y_true):
        """Evaluate model performance with detailed metrics"""
        if not self.is_trained:
            raise ValueError("Model not trained yet!")
        
        predictions = self.predict(X)
        y_pred = predictions['predictions']
        y_prob = predictions['probabilities']
        
        # Calculate basic metrics
        accuracy = (y_pred == y_true).mean()
        
        # Calculate confusion matrix
        tp = ((y_pred == 1) & (y_true == 1)).sum()
        fp = ((y_pred == 1) & (y_true == 0)).sum()
        fn = ((y_pred == 0) & (y_true == 1)).sum()
        tn = ((y_pred == 0) & (y_true == 0)).sum()
        
        # Calculate precision, recall, F1
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
        
        # Calculate specificity and sensitivity
        specificity = tn / (tn + fp) if (tn + fp) > 0 else 0
        sensitivity = recall  # Same as recall
        
        # Calculate balanced accuracy
        balanced_accuracy = (sensitivity + specificity) / 2
        
        # Calculate AUC (simplified)
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
            'specificity': specificity,
            'sensitivity': sensitivity,
            'balanced_accuracy': balanced_accuracy,
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
            'threshold': self.threshold,
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
        self.threshold = model_data.get('threshold', 0.5)
        
        logger.info(f"Model loaded from {filepath}")

def train_improved_fba_claims_model():
    """Main training function for improved model"""
    logger.info("🚀 Starting Improved FBA Claims Model Training...")
    
    # Load the cleaned dataset
    try:
        df = pd.read_csv('data/cleaned_fba_claims_dataset.csv')
        logger.info(f"✅ Loaded cleaned dataset: {df.shape}")
    except Exception as e:
        logger.error(f"❌ Error loading data: {e}")
        return False
    
    # Initialize improved model
    model = ImprovedFBAClaimsModel()
    
    # Prepare improved features
    X = model.prepare_features(df)
    y = df['claimable']
    
    # Split data (80/20 split)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    logger.info(f"Training set: {X_train.shape}, Test set: {X_test.shape}")
    
    # Train improved model
    training_results = model.train_improved_model(X_train, y_train)
    
    # Evaluate on test set
    evaluation_results = model.evaluate(X_test, y_test)
    
    # Print comprehensive results
    logger.info("\n" + "="*60)
    logger.info("📊 IMPROVED MODEL PERFORMANCE RESULTS")
    logger.info("="*60)
    
    logger.info(f"Accuracy: {evaluation_results['accuracy']:.4f}")
    logger.info(f"Precision: {evaluation_results['precision']:.4f}")
    logger.info(f"Recall: {evaluation_results['recall']:.4f}")
    logger.info(f"F1 Score: {evaluation_results['f1_score']:.4f}")
    logger.info(f"Specificity: {evaluation_results['specificity']:.4f}")
    logger.info(f"Sensitivity: {evaluation_results['sensitivity']:.4f}")
    logger.info(f"Balanced Accuracy: {evaluation_results['balanced_accuracy']:.4f}")
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
    
    # Save improved model
    model_path = 'models/improved_fba_claims_model.pkl'
    Path('models').mkdir(exist_ok=True)
    model.save_model(model_path)
    
    # Save comprehensive training report
    report = {
        'training_results': training_results,
        'evaluation_results': evaluation_results,
        'feature_importance': model.feature_importance,
        'optimal_threshold': model.threshold,
        'training_date': datetime.now().isoformat(),
        'data_info': {
            'total_samples': len(df),
            'training_samples': len(X_train),
            'test_samples': len(X_test),
            'feature_count': len(model.feature_columns),
            'class_distribution': y.value_counts().to_dict()
        }
    }
    
    report_path = 'models/improved_training_report.json'
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    
    logger.info(f"\n✅ Improved model saved to: {model_path}")
    logger.info(f"📋 Training report saved to: {report_path}")
    logger.info("\n🎉 Improved training completed successfully!")
    
    return True

if __name__ == "__main__":
    train_improved_fba_claims_model()


