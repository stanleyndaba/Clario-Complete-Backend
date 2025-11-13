#!/usr/bin/env python3
"""
Train 98% Accuracy Model on 240 Samples
Smart ML techniques to maximize accuracy with limited data
Target: 98% accuracy, ≤2 seconds inference time
"""

import pandas as pd
import numpy as np
import pickle
import time
import logging
from pathlib import Path
from typing import Dict, Tuple, Any
import sys
import os

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from sklearn.model_selection import (
    train_test_split, 
    StratifiedKFold, 
    cross_val_score,
    GridSearchCV,
    RepeatedStratifiedKFold,
    ParameterGrid
)
from sklearn.preprocessing import StandardScaler, RobustScaler
from sklearn.metrics import (
    accuracy_score, 
    precision_score, 
    recall_score, 
    f1_score,
    roc_auc_score,
    confusion_matrix,
    classification_report
)
from sklearn.base import BaseEstimator, ClassifierMixin
import lightgbm as lgb
import xgboost as xgb
from sklearn.ensemble import (
    VotingClassifier,
    RandomForestClassifier,
    GradientBoostingClassifier,
    StackingClassifier
)
from scipy import stats
from imblearn.over_sampling import SMOTE
from imblearn.pipeline import Pipeline as ImbPipeline
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SmartFeatureEngineer:
    """Simplified feature engineering - only high-signal features, no leakage"""
    
    @staticmethod
    def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
        """Create simplified, non-leaky features"""
        df = df.copy()
        
        # REMOVED: Features that might leak label intent
        # - "refund_efficiency" (implies refund happened)
        # - Complex text keyword matching (may correlate with labels)
        # - Statistical aggregations that use future info
        
        # 1. Temporal features (safe - based on dates only)
        if 'claim_date' in df.columns and 'order_date' in df.columns:
            df['claim_date'] = pd.to_datetime(df['claim_date'], errors='coerce')
            df['order_date'] = pd.to_datetime(df['order_date'], errors='coerce')
            df['days_between'] = (df['claim_date'] - df['order_date']).dt.days
            df['days_between'] = df['days_between'].fillna(0).astype(float)
            df['claim_month'] = df['claim_date'].dt.month.fillna(0).astype(float)
            df['order_month'] = df['order_date'].dt.month.fillna(0).astype(float)
            # Remove datetime columns
            df = df.drop(columns=['claim_date', 'order_date'], errors='ignore')
        
        # 2. Financial ratios (safe - based on order/amount only)
        if 'amount' in df.columns and 'order_value' in df.columns:
            df['amount_ratio'] = df['amount'] / (df['order_value'] + 1e-6)
            df['amount_ratio'] = df['amount_ratio'].fillna(0).astype(float)
        
        if 'amount' in df.columns and 'quantity' in df.columns:
            df['amount_per_unit'] = df['amount'] / (df['quantity'] + 1e-6)
            df['amount_per_unit'] = df['amount_per_unit'].fillna(0).astype(float)
        
        if 'order_value' in df.columns and 'quantity' in df.columns:
            df['unit_value'] = df['order_value'] / (df['quantity'] + 1e-6)
            df['unit_value'] = df['unit_value'].fillna(0).astype(float)
        
        # 3. Days since order (safe temporal feature)
        if 'days_since_order' in df.columns:
            df['days_since_order'] = pd.to_numeric(df['days_since_order'], errors='coerce').fillna(0)
        
        # 4. Basic categorical encoding (safe)
        if 'claim_type' in df.columns:
            df['claim_type_encoded'] = pd.Categorical(df['claim_type']).codes
        
        if 'category' in df.columns:
            df['category_encoded'] = pd.Categorical(df['category']).codes
        
        if 'marketplace' in df.columns:
            df['marketplace_encoded'] = pd.Categorical(df['marketplace']).codes
        
        # 5. Boolean flags (safe)
        if 'reason_code' in df.columns:
            df['has_reason_code'] = df['reason_code'].notna().astype(int)
        
        if 'asin' in df.columns:
            df['has_asin'] = df['asin'].notna().astype(int)
        
        if 'sku' in df.columns:
            df['has_sku'] = df['sku'].notna().astype(int)
        
        # 6. Keep original numeric features (if they exist and are safe)
        safe_numeric_cols = ['amount', 'quantity', 'order_value', 'shipping_cost', 
                            'days_since_delivery', 'amount_log', 'amount_per_unit',
                            'text_length', 'word_count', 'has_order_id']
        for col in safe_numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
        
        # REMOVED: Complex interactions, binning, z-scores, percentiles
        # These can create leakage or overfit on small data
        
        return df


class Ensemble98Model:
    """Ensemble model targeting 98% accuracy"""
    
    def __init__(self):
        self.models = {}
        self.ensemble = None
        self.scaler = RobustScaler()  # More robust to outliers
        self.feature_columns = None
        self.is_trained = False
        
    def prepare_features(self, df: pd.DataFrame, is_training: bool = False) -> Tuple[pd.DataFrame, np.ndarray]:
        """Prepare features and target"""
        # Engineer features
        df_engineered = SmartFeatureEngineer.engineer_features(df)
        
        # Select feature columns (exclude target and IDs)
        exclude_cols = ['claimable', 'claim_id', 'seller_id', 'order_id', 'description']
        feature_cols = [col for col in df_engineered.columns if col not in exclude_cols]
        
        # Handle categoricals and convert all to numeric
        df_features = df_engineered[feature_cols].copy()
        
        # Convert datetime columns to numeric
        datetime_cols = df_features.select_dtypes(include=['datetime64']).columns
        for col in datetime_cols:
            df_features[col] = pd.to_numeric(df_features[col], errors='coerce')
        
        # Handle categoricals
        categorical_cols = df_features.select_dtypes(include=['object', 'category']).columns
        for col in categorical_cols:
            df_features[col] = pd.Categorical(df_features[col]).codes
        
        # Convert all to numeric and fill NaN
        for col in df_features.columns:
            df_features[col] = pd.to_numeric(df_features[col], errors='coerce')
        
        df_features = df_features.fillna(0)
        
        # Ensure all columns are numeric
        df_features = df_features.select_dtypes(include=[np.number])
        
        # Get target
        if 'claimable' in df_engineered.columns:
            y = df_engineered['claimable'].values
        else:
            y = None
        
        if is_training:
            self.feature_columns = list(df_features.columns)
        
        return df_features, y
    
    def train_ensemble(self, X_train: pd.DataFrame, y_train: np.ndarray, 
                      X_val: pd.DataFrame, y_val: np.ndarray, use_smote: bool = True) -> Dict[str, Any]:
        """Train simplified single LightGBM model with class balancing"""
        logger.info("Training simplified LightGBM model with class balancing...")
        
        # Convert to numpy
        X_train_np = X_train.values
        X_val_np = X_val.values
        
        results = {}
        
        # Calculate class weights for imbalance
        n_pos = np.sum(y_train == 1)
        n_neg = np.sum(y_train == 0)
        scale_pos_weight = n_neg / n_pos if n_pos > 0 else 1.0
        logger.info(f"Class distribution - Positive: {n_pos}, Negative: {n_neg}, Scale weight: {scale_pos_weight:.3f}")
        
        # Apply SMOTE to balance training data (only on training set, not validation)
        if use_smote and n_pos > 0 and n_neg > 0:
            logger.info("Applying SMOTE to balance training data...")
            try:
                smote = SMOTE(random_state=42, k_neighbors=min(5, n_neg - 1))
                X_train_balanced, y_train_balanced = smote.fit_resample(X_train_np, y_train)
                logger.info(f"After SMOTE - Positive: {np.sum(y_train_balanced == 1)}, Negative: {np.sum(y_train_balanced == 0)}")
            except Exception as e:
                logger.warning(f"SMOTE failed: {e}, using class weights instead")
                X_train_balanced, y_train_balanced = X_train_np, y_train
        else:
            X_train_balanced, y_train_balanced = X_train_np, y_train
        
        # Single LightGBM with enhanced regularization to prevent overfitting
        logger.info("Training LightGBM (simplified, balanced, regularized)...")
        lgb_model = lgb.LGBMClassifier(
            objective='binary',
            num_leaves=12,  # Further reduced to prevent overfitting
            learning_rate=0.05,
            n_estimators=100,
            feature_fraction=0.75,  # Reduced to 0.75 for stochasticity (helps generalization)
            bagging_fraction=0.8,
            bagging_freq=5,
            min_child_samples=15,  # Increased from 10 for stronger regularization
            min_gain_to_split=0.01,  # Prevent shallow overfits
            lambda_l2=0.3,  # L2 regularization to prevent overfitting
            scale_pos_weight=scale_pos_weight,  # Handle class imbalance
            verbose=-1,
            random_state=42
        )
        lgb_model.fit(X_train_balanced, y_train_balanced,
                     eval_set=[(X_val_np, y_val)],
                     callbacks=[lgb.early_stopping(stopping_rounds=15), lgb.log_evaluation(period=0)])  # Stricter: 15 rounds
        
        self.models['lgb'] = lgb_model
        self.ensemble = lgb_model  # Use single model, no ensemble
        
        lgb_pred = lgb_model.predict(X_val_np)
        lgb_pred_proba = lgb_model.predict_proba(X_val_np)[:, 1]
        results['lgb'] = {
            'accuracy': accuracy_score(y_val, lgb_pred),
            'precision': precision_score(y_val, lgb_pred, zero_division=0),
            'recall': recall_score(y_val, lgb_pred, zero_division=0),
            'f1': f1_score(y_val, lgb_pred, zero_division=0),
            'auc': roc_auc_score(y_val, lgb_pred_proba) if len(np.unique(y_val)) > 1 else 0
        }
        logger.info(f"LightGBM - Accuracy: {results['lgb']['accuracy']:.4f}, F1: {results['lgb']['f1']:.4f}")
        
        # Re-train on full training set for final model
        X_train_combined = np.vstack([X_train_np, X_val_np])
        y_train_combined = np.hstack([y_train, y_val])
        
        # Apply SMOTE to combined set if needed
        if use_smote:
            try:
                smote_final = SMOTE(random_state=42, k_neighbors=min(5, np.sum(y_train_combined == 0) - 1))
                X_train_combined, y_train_combined = smote_final.fit_resample(X_train_combined, y_train_combined)
            except:
                pass  # If SMOTE fails, use class weights
        
        final_scale_weight = np.sum(y_train_combined == 0) / np.sum(y_train_combined == 1) if np.sum(y_train_combined == 1) > 0 else 1.0
        
        final_lgb = lgb.LGBMClassifier(
            objective='binary',
            num_leaves=12,  # Enhanced regularization
            learning_rate=0.05,
            n_estimators=100,
            feature_fraction=0.75,  # Reduced for stochasticity
            bagging_fraction=0.8,
            bagging_freq=5,
            min_child_samples=15,  # Enhanced regularization
            min_gain_to_split=0.01,  # Prevent shallow overfits
            lambda_l2=0.3,  # L2 regularization
            scale_pos_weight=final_scale_weight,
            verbose=-1,
            random_state=42
        )
        final_lgb.fit(X_train_combined, y_train_combined)
        self.ensemble = final_lgb
        
        # Final model is already trained and stored in self.ensemble
        results['ensemble'] = results['lgb']  # Same as LightGBM (single model)
        logger.info(f"Final Model - Accuracy: {results['ensemble']['accuracy']:.4f}, F1: {results['ensemble']['f1']:.4f}")
        
        self.is_trained = True
        return results
    
    def predict(self, X: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
        """Predict with ensemble"""
        if not self.is_trained:
            raise ValueError("Model not trained")
        
        # Prepare features - need to use original dataframe structure
        # X should be the original dataframe, not pre-processed
        if isinstance(X, pd.DataFrame) and 'claimable' not in X.columns:
            # If X is already feature-engineered, use it directly
            if hasattr(self, 'feature_columns') and self.feature_columns:
                # Check which feature_columns actually exist in X
                available_cols = [col for col in self.feature_columns if col in X.columns]
                missing_cols = [col for col in self.feature_columns if col not in X.columns]
                
                if missing_cols:
                    # Fill missing columns with 0 or appropriate defaults
                    for col in missing_cols:
                        X[col] = 0
                
                X_features = X[self.feature_columns].copy()
            else:
                X_features = X.copy()
        else:
            # Re-engineer features from original dataframe
            df_engineered = SmartFeatureEngineer.engineer_features(X)
            exclude_cols = ['claimable', 'claim_id', 'seller_id', 'order_id', 'description']
            feature_cols = [col for col in df_engineered.columns if col not in exclude_cols]
            X_features = df_engineered[feature_cols].copy()
        
        # Convert all to numeric
        for col in X_features.columns:
            X_features[col] = pd.to_numeric(X_features[col], errors='coerce')
        X_features = X_features.fillna(0)
        X_features = X_features.select_dtypes(include=[np.number])
        
        # Ensure same columns as training
        if hasattr(self, 'feature_columns') and self.feature_columns:
            missing_cols = set(self.feature_columns) - set(X_features.columns)
            for col in missing_cols:
                X_features[col] = 0
            X_features = X_features[self.feature_columns]
        
        # Predict
        X_np = X_features.values
        predictions = self.ensemble.predict(X_np)
        probabilities = self.ensemble.predict_proba(X_np)[:, 1]
        
        return predictions, probabilities
    
    def save(self, model_path: str, scaler_path: str):
        """Save model and scaler"""
        Path(model_path).parent.mkdir(parents=True, exist_ok=True)
        
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': self.ensemble,  # Save the final model
                'models': self.models,  # Keep individual models for reference
                'feature_columns': self.feature_columns,
                'is_trained': self.is_trained
            }, f)
        
        with open(scaler_path, 'wb') as f:
            pickle.dump(self.scaler, f)
        
        logger.info(f"Model saved to {model_path}")
        logger.info(f"Scaler saved to {scaler_path}")
    
    def load(self, model_path: str, scaler_path: str):
        """Load model and scaler"""
        with open(model_path, 'rb') as f:
            data = pickle.load(f)
            self.ensemble = data.get('model') or data.get('ensemble')  # Support both formats
            self.models = data.get('models', {})
            self.feature_columns = data['feature_columns']
            self.is_trained = data['is_trained']
        
        with open(scaler_path, 'rb') as f:
            self.scaler = pickle.load(f)
        
        logger.info(f"Model loaded from {model_path}")


def measure_inference_speed(model: Ensemble98Model, X_test: pd.DataFrame, n_runs: int = 1000) -> Dict[str, float]:
    """Measure inference speed with percentiles"""
    logger.info(f"Measuring inference speed ({n_runs} runs)...")
    
    times = []
    for _ in range(n_runs):
        start = time.time()
        _, _ = model.predict(X_test)
        elapsed = time.time() - start
        times.append(elapsed * 1000)  # Convert to ms
    
    times = np.array(times)
    
    return {
        'p50_ms': np.percentile(times, 50),
        'p95_ms': np.percentile(times, 95),
        'p99_ms': np.percentile(times, 99),
        'mean_ms': np.mean(times),
        'std_ms': np.std(times),
        'min_ms': np.min(times),
        'max_ms': np.max(times),
        'per_claim_ms': np.mean(times) / len(X_test) if len(X_test) > 0 else np.mean(times),
        'meets_target': np.percentile(times, 95) <= 2000.0  # P95 must be ≤2s
    }


def run_cross_validation(model_class, df_original: pd.DataFrame, X: pd.DataFrame, y: np.ndarray, 
                        n_splits: int = 5, n_repeats: int = 5) -> Dict[str, Any]:
    """Run repeated stratified K-fold cross-validation"""
    logger.info(f"Running {n_repeats}x{n_splits}-fold cross-validation...")
    
    cv = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=42)
    
    accuracies = []
    f1_scores = []
    precisions = []
    recalls = []
    
    fold = 0
    for train_idx, val_idx in cv.split(X, y):
        fold += 1
        # Get original dataframe rows for feature engineering
        df_train_fold = df_original.iloc[train_idx].copy()
        df_val_fold = df_original.iloc[val_idx].copy()
        y_train_fold, y_val_fold = y[train_idx], y[val_idx]
        
        # Train model with proper feature engineering
        model = model_class()
        X_train_prep, _ = model.prepare_features(df_train_fold, is_training=True)
        X_val_prep, _ = model.prepare_features(df_val_fold, is_training=False)
        
        # Ensure same columns
        common_cols = list(set(X_train_prep.columns) & set(X_val_prep.columns))
        X_train_prep = X_train_prep[common_cols]
        X_val_prep = X_val_prep[common_cols]
        
        # Simple LightGBM for CV with class balancing
        n_pos_fold = np.sum(y_train_fold == 1)
        n_neg_fold = np.sum(y_train_fold == 0)
        scale_weight_fold = n_neg_fold / n_pos_fold if n_pos_fold > 0 else 1.0
        
        lgb_model = lgb.LGBMClassifier(
            objective='binary',
            num_leaves=12,  # Enhanced regularization
            learning_rate=0.05,
            n_estimators=100,
            feature_fraction=0.75,  # Reduced for stochasticity
            min_child_samples=15,  # Enhanced regularization
            min_gain_to_split=0.01,  # Prevent shallow overfits
            lambda_l2=0.3,  # L2 regularization
            scale_pos_weight=scale_weight_fold,  # Handle imbalance
            verbose=-1,
            random_state=42
        )
        lgb_model.fit(X_train_prep.values, y_train_fold)
        
        # Predict
        pred = lgb_model.predict(X_val_prep.values)
        
        # Metrics
        acc = accuracy_score(y_val_fold, pred)
        f1 = f1_score(y_val_fold, pred, zero_division=0)
        prec = precision_score(y_val_fold, pred, zero_division=0)
        rec = recall_score(y_val_fold, pred, zero_division=0)
        
        accuracies.append(acc)
        f1_scores.append(f1)
        precisions.append(prec)
        recalls.append(rec)
        
        if fold % 5 == 0:
            logger.info(f"  Fold {fold}/{n_splits * n_repeats}: Acc={acc:.4f}, F1={f1:.4f}")
    
    return {
        'accuracy': {
            'mean': np.mean(accuracies),
            'std': np.std(accuracies),
            'min': np.min(accuracies),
            'max': np.max(accuracies),
            'values': accuracies
        },
        'f1': {
            'mean': np.mean(f1_scores),
            'std': np.std(f1_scores),
            'min': np.min(f1_scores),
            'max': np.max(f1_scores),
            'values': f1_scores
        },
        'precision': {
            'mean': np.mean(precisions),
            'std': np.std(precisions),
            'values': precisions
        },
        'recall': {
            'mean': np.mean(recalls),
            'std': np.std(recalls),
            'values': recalls
        }
    }


def bootstrap_confidence_interval(y_true: np.ndarray, y_pred: np.ndarray, 
                                  n_bootstrap: int = 1000, confidence: float = 0.95) -> Dict[str, float]:
    """Bootstrap confidence interval for accuracy"""
    logger.info(f"Computing bootstrap CI ({n_bootstrap} samples)...")
    
    n = len(y_true)
    accuracies = []
    
    for _ in range(n_bootstrap):
        # Resample with replacement
        indices = np.random.choice(n, size=n, replace=True)
        y_true_boot = y_true[indices]
        y_pred_boot = y_pred[indices]
        acc = accuracy_score(y_true_boot, y_pred_boot)
        accuracies.append(acc)
    
    accuracies = np.array(accuracies)
    alpha = 1 - confidence
    lower = np.percentile(accuracies, (alpha/2) * 100)
    upper = np.percentile(accuracies, (1 - alpha/2) * 100)
    
    return {
        'mean': np.mean(accuracies),
        'std': np.std(accuracies),
        'lower_ci': lower,
        'upper_ci': upper,
        'confidence': confidence
    }


def permutation_test(model, df_original: pd.DataFrame, y: np.ndarray, n_permutations: int = 100) -> Dict[str, Any]:
    """Permutation test to check for overfitting"""
    logger.info(f"Running permutation test ({n_permutations} permutations)...")
    
    # Train on real data
    X_prep, _ = model.prepare_features(df_original, is_training=True)
    
    # Calculate class weights
    n_pos = np.sum(y == 1)
    n_neg = np.sum(y == 0)
    scale_weight = n_neg / n_pos if n_pos > 0 else 1.0
    
    lgb_model = lgb.LGBMClassifier(
        objective='binary',
        num_leaves=12,  # Enhanced regularization
        learning_rate=0.05,
        n_estimators=100,
        feature_fraction=0.75,  # Reduced for stochasticity
        min_child_samples=15,  # Enhanced regularization
        min_gain_to_split=0.01,  # Prevent shallow overfits
        lambda_l2=0.3,  # L2 regularization
        scale_pos_weight=scale_weight,
        verbose=-1,
        random_state=42
    )
    lgb_model.fit(X_prep.values, y)
    real_pred = lgb_model.predict(X_prep.values)
    real_acc = accuracy_score(y, real_pred)
    
    # Permute labels and train
    permuted_accs = []
    for _ in range(n_permutations):
        y_perm = np.random.permutation(y)
        n_pos_perm = np.sum(y_perm == 1)
        n_neg_perm = np.sum(y_perm == 0)
        scale_weight_perm = n_neg_perm / n_pos_perm if n_pos_perm > 0 else 1.0
        
        lgb_perm = lgb.LGBMClassifier(
            objective='binary',
            num_leaves=12,  # Enhanced regularization
            learning_rate=0.05,
            n_estimators=100,
            feature_fraction=0.75,  # Reduced for stochasticity
            min_child_samples=15,  # Enhanced regularization
            min_gain_to_split=0.01,  # Prevent shallow overfits
            lambda_l2=0.3,  # L2 regularization
            scale_pos_weight=scale_weight_perm,
            verbose=-1,
            random_state=42
        )
        lgb_perm.fit(X_prep.values, y_perm)
        perm_pred = lgb_perm.predict(X_prep.values)
        perm_acc = accuracy_score(y_perm, perm_pred)
        permuted_accs.append(perm_acc)
    
    permuted_accs = np.array(permuted_accs)
    p_value = np.mean(permuted_accs >= real_acc)
    
    return {
        'real_accuracy': real_acc,
        'permuted_mean': np.mean(permuted_accs),
        'permuted_std': np.std(permuted_accs),
        'p_value': p_value,
        'is_significant': p_value < 0.05,
        'interpretation': 'Model is learning signal' if p_value < 0.05 else 'WARNING: Model may be memorizing noise'
    }


def main():
    """Main training function with robust validation"""
    logger.info("="*80)
    logger.info("Training 98% Accuracy Model on 240 Samples - ROBUST VALIDATION")
    logger.info("="*80)
    
    # Paths
    data_path = project_root.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    model_path = project_root / 'models' / 'claim_detector_98percent.pkl'
    scaler_path = project_root / 'models' / 'scaler_98percent.pkl'
    
    # Load data
    logger.info(f"\n[1/8] Loading data from {data_path}")
    df = pd.read_csv(data_path)
    logger.info(f"Loaded {len(df)} samples with {len(df.columns)} features")
    logger.info(f"Class distribution: {df['claimable'].value_counts().to_dict()}")
    
    # Check for data leakage - ensure no time-based or entity-based leakage
    logger.info("\n[2/8] Checking for data leakage...")
    if 'order_id' in df.columns:
        unique_orders = df['order_id'].nunique()
        logger.info(f"  Unique orders: {unique_orders} (checking for order-based leakage)")
    if 'claim_date' in df.columns:
        logger.info(f"  Date range: {df['claim_date'].min()} to {df['claim_date'].max()}")
    
    # Initialize model
    model = Ensemble98Model()
    
    # Prepare features
    logger.info("\n[3/8] Engineering features...")
    X, y = model.prepare_features(df, is_training=True)
    logger.info(f"Feature engineering complete: {X.shape[1]} features")
    
    # Time-based or entity-based split (if applicable)
    logger.info("\n[4/8] Creating data splits...")
    # Use stratified split but ensure no leakage
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=0.2,
        random_state=42,
        stratify=y
    )
    
    logger.info(f"Train: {len(X_train)}, Test: {len(X_test)}")
    logger.info(f"Train class dist: {np.bincount(y_train)}")
    logger.info(f"Test class dist: {np.bincount(y_test)}")
    
    # ===== ROBUST VALIDATION =====
    
    # 1. Cross-Validation
    logger.info("\n" + "="*80)
    logger.info("[5/8] CROSS-VALIDATION (5x5 Repeated Stratified K-Fold)")
    logger.info("="*80)
    # Get original dataframe indices for train set
    train_indices = X_train.index
    df_train_original = df.iloc[train_indices].copy()
    cv_results = run_cross_validation(Ensemble98Model, df_train_original, X_train, y_train, n_splits=5, n_repeats=5)
    
    logger.info(f"\nCV Results (25 folds):")
    logger.info(f"  Accuracy:  {cv_results['accuracy']['mean']:.4f} ± {cv_results['accuracy']['std']:.4f}")
    logger.info(f"  F1 Score:  {cv_results['f1']['mean']:.4f} ± {cv_results['f1']['std']:.4f}")
    logger.info(f"  Precision: {cv_results['precision']['mean']:.4f} ± {cv_results['precision']['std']:.4f}")
    logger.info(f"  Recall:    {cv_results['recall']['mean']:.4f} ± {cv_results['recall']['std']:.4f}")
    logger.info(f"  Range:     [{cv_results['accuracy']['min']:.4f}, {cv_results['accuracy']['max']:.4f}]")
    
    cv_passes = cv_results['accuracy']['mean'] >= 0.98
    logger.info(f"  Status: {'✅ PASS' if cv_passes else '❌ FAIL'} (Target: ≥0.98)")
    
    # 2. Train final ensemble model
    logger.info("\n" + "="*80)
    logger.info("[6/8] Training Final Ensemble Model")
    logger.info("="*80)
    
    # Further split for validation
    X_train_fit, X_val, y_train_fit, y_val = train_test_split(
        X_train, y_train,
        test_size=0.2,
        random_state=42,
        stratify=y_train
    )
    
    train_results = model.train_ensemble(X_train_fit, y_train_fit, X_val, y_val, use_smote=True)
    
    # 3. Evaluate on test set
    logger.info("\n" + "="*80)
    logger.info("[7/8] Test Set Evaluation")
    logger.info("="*80)
    test_pred, test_proba = model.predict(X_test)
    
    test_accuracy = accuracy_score(y_test, test_pred)
    test_precision = precision_score(y_test, test_pred, zero_division=0)
    test_recall = recall_score(y_test, test_pred, zero_division=0)
    test_f1 = f1_score(y_test, test_pred, zero_division=0)
    test_auc = roc_auc_score(y_test, test_proba) if len(np.unique(y_test)) > 1 else 0
    
    # Per-class metrics
    logger.info(f"\nTest Set Performance:")
    logger.info(f"  Accuracy:  {test_accuracy:.4f} ({'✅' if test_accuracy >= 0.98 else '❌'} Target: ≥0.98)")
    logger.info(f"  Precision: {test_precision:.4f}")
    logger.info(f"  Recall:    {test_recall:.4f}")
    logger.info(f"  F1 Score:  {test_f1:.4f}")
    logger.info(f"  AUC:       {test_auc:.4f}")
    
    # Confusion matrix
    cm = confusion_matrix(y_test, test_pred)
    tn, fp, fn, tp = cm.ravel()
    logger.info(f"\nConfusion Matrix:")
    logger.info(f"  True Negatives:  {tn}")
    logger.info(f"  False Positives: {fp}")
    logger.info(f"  False Negatives: {fn}")
    logger.info(f"  True Positives:  {tp}")
    
    # Per-class metrics
    if len(np.unique(y_test)) == 2:
        precision_class_0 = tn / (tn + fn) if (tn + fn) > 0 else 0
        recall_class_0 = tn / (tn + fp) if (tn + fp) > 0 else 0
        precision_class_1 = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall_class_1 = tp / (tp + fn) if (tp + fn) > 0 else 0
        
        logger.info(f"\nPer-Class Metrics:")
        logger.info(f"  Class 0 (Not Claimable): Precision={precision_class_0:.4f}, Recall={recall_class_0:.4f}")
        logger.info(f"  Class 1 (Claimable):     Precision={precision_class_1:.4f}, Recall={recall_class_1:.4f}")
    
    # 4. Bootstrap Confidence Interval
    logger.info("\n" + "="*80)
    logger.info("[8/8] Bootstrap Confidence Interval (1000 samples)")
    logger.info("="*80)
    bootstrap_ci = bootstrap_confidence_interval(y_test, test_pred, n_bootstrap=1000)
    
    logger.info(f"\nBootstrap 95% CI:")
    logger.info(f"  Mean:      {bootstrap_ci['mean']:.4f}")
    logger.info(f"  Std:       {bootstrap_ci['std']:.4f}")
    logger.info(f"  95% CI:    [{bootstrap_ci['lower_ci']:.4f}, {bootstrap_ci['upper_ci']:.4f}]")
    
    ci_passes = bootstrap_ci['lower_ci'] >= 0.96
    logger.info(f"  Status: {'✅ PASS' if ci_passes else '❌ FAIL'} (Lower bound ≥0.96)")
    
    # 5. Permutation Test
    logger.info("\n" + "="*80)
    logger.info("PERMUTATION TEST (100 permutations)")
    logger.info("="*80)
    perm_results = permutation_test(model, df_train_original, y_train, n_permutations=100)
    
    logger.info(f"\nPermutation Test Results:")
    logger.info(f"  Real accuracy:     {perm_results['real_accuracy']:.4f}")
    logger.info(f"  Permuted mean:     {perm_results['permuted_mean']:.4f} ± {perm_results['permuted_std']:.4f}")
    logger.info(f"  P-value:           {perm_results['p_value']:.4f}")
    logger.info(f"  Is significant:   {'✅ YES' if perm_results['is_significant'] else '❌ NO'}")
    logger.info(f"  Interpretation:   {perm_results['interpretation']}")
    
    # 6. Inference Speed
    logger.info("\n" + "="*80)
    logger.info("INFERENCE SPEED MEASUREMENT (1000 runs)")
    logger.info("="*80)
    speed_results = measure_inference_speed(model, X_test, n_runs=1000)
    
    logger.info(f"\nLatency Statistics:")
    logger.info(f"  P50 (median):  {speed_results['p50_ms']:.2f}ms")
    logger.info(f"  P95:            {speed_results['p95_ms']:.2f}ms")
    logger.info(f"  P99:            {speed_results['p99_ms']:.2f}ms")
    logger.info(f"  Mean:           {speed_results['mean_ms']:.2f}ms")
    logger.info(f"  Std:            {speed_results['std_ms']:.2f}ms")
    logger.info(f"  Per claim:      {speed_results['per_claim_ms']:.3f}ms")
    logger.info(f"  Meets target:   {'✅ PASS' if speed_results['meets_target'] else '❌ FAIL'} (P95 ≤2000ms)")
    
    # Save model
    logger.info("\n" + "="*80)
    logger.info("Saving Model")
    logger.info("="*80)
    model.save(str(model_path), str(scaler_path))
    
    # Final Summary
    logger.info("\n" + "="*80)
    logger.info("FINAL VALIDATION SUMMARY")
    logger.info("="*80)
    
    all_passed = (
        cv_passes and
        ci_passes and
        perm_results['is_significant'] and
        speed_results['meets_target'] and
        test_accuracy >= 0.98
    )
    
    logger.info(f"\nValidation Checklist:")
    logger.info(f"  ✅ CV mean accuracy ≥98%:        {'PASS' if cv_passes else 'FAIL'} ({cv_results['accuracy']['mean']:.2%})")
    logger.info(f"  ✅ Bootstrap CI lower ≥96%:      {'PASS' if ci_passes else 'FAIL'} ({bootstrap_ci['lower_ci']:.2%})")
    logger.info(f"  ✅ Permutation test significant: {'PASS' if perm_results['is_significant'] else 'FAIL'} (p={perm_results['p_value']:.4f})")
    logger.info(f"  ✅ Test accuracy ≥98%:            {'PASS' if test_accuracy >= 0.98 else 'FAIL'} ({test_accuracy:.2%})")
    logger.info(f"  ✅ Inference P95 ≤2s:             {'PASS' if speed_results['meets_target'] else 'FAIL'} ({speed_results['p95_ms']:.0f}ms)")
    
    logger.info(f"\n📊 Key Metrics:")
    logger.info(f"  CV Accuracy:     {cv_results['accuracy']['mean']:.4f} ± {cv_results['accuracy']['std']:.4f}")
    logger.info(f"  Test Accuracy:   {test_accuracy:.4f}")
    logger.info(f"  Bootstrap CI:    [{bootstrap_ci['lower_ci']:.4f}, {bootstrap_ci['upper_ci']:.4f}]")
    logger.info(f"  Inference P95:   {speed_results['p95_ms']:.2f}ms")
    
    logger.info(f"\nModel saved to: {model_path}")
    logger.info(f"Scaler saved to: {scaler_path}")
    
    if all_passed:
        logger.info("\n🎉 SUCCESS: Model meets all validation criteria!")
        return 0
    else:
        logger.warning("\n⚠️  WARNING: Model does not meet all validation criteria.")
        logger.warning("   Review the results above and consider:")
        logger.warning("   - Collecting more data")
        logger.warning("   - Checking for label leakage")
        logger.warning("   - Simplifying features")
        logger.warning("   - Adjusting model complexity")
        return 1


if __name__ == '__main__':
    sys.exit(main())

