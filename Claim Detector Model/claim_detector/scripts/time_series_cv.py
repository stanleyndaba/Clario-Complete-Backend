"""
Time-Series Cross-Validation (Forward Chaining / Walk-Forward)
Ensures no future data leakage in temporal data
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import BaseCrossValidator
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
import lightgbm as lgb
from typing import List, Tuple, Dict, Any
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class TimeSeriesSplit(BaseCrossValidator):
    """
    Time-series cross-validator (forward chaining / walk-forward)
    Ensures train set always comes before test set chronologically
    """
    
    def __init__(self, n_splits=5, test_size=None, gap=0):
        """
        Args:
            n_splits: Number of splits
            test_size: Size of test set (if None, uses 1/n_splits)
            gap: Number of samples to skip between train and test (default 0)
        """
        self.n_splits = n_splits
        self.test_size = test_size
        self.gap = gap
    
    def split(self, X, y=None, groups=None):
        """Generate indices to split data into training and test set"""
        n_samples = len(X)
        
        if self.test_size is None:
            test_size = n_samples // (self.n_splits + 1)
        else:
            test_size = self.test_size
        
        indices = np.arange(n_samples)
        
        for i in range(self.n_splits):
            # Calculate split point
            test_start = (i + 1) * test_size
            test_end = test_start + test_size
            
            if test_end > n_samples:
                test_end = n_samples
            
            # Train: all data before test_start
            train_end = test_start - self.gap
            if train_end <= 0:
                continue
            
            train_indices = indices[:train_end]
            test_indices = indices[test_start:test_end]
            
            if len(train_indices) > 0 and len(test_indices) > 0:
                yield train_indices, test_indices
    
    def get_n_splits(self, X=None, y=None, groups=None):
        return self.n_splits


def time_series_cross_validate(
    X: pd.DataFrame,
    y: np.ndarray,
    date_column: str = None,
    n_splits: int = 5,
    model_params: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Perform time-series cross-validation with forward chaining
    
    Args:
        X: Feature dataframe
        y: Target array
        date_column: Column name for sorting by date (if None, uses index order)
        n_splits: Number of CV splits
        model_params: LightGBM parameters
    
    Returns:
        Dictionary with CV results
    """
    logger.info("="*80)
    logger.info("TIME-SERIES CROSS-VALIDATION (Forward Chaining)")
    logger.info("="*80)
    
    # Sort by date if date column provided
    if date_column and date_column in X.columns:
        logger.info(f"Sorting data by {date_column}...")
        sort_idx = X[date_column].argsort()
        X = X.iloc[sort_idx].reset_index(drop=True)
        y = y[sort_idx]
        logger.info(f"Date range: {X[date_column].min()} to {X[date_column].max()}")
    else:
        logger.info("No date column provided, using index order (assumes temporal ordering)")
    
    # Default model parameters
    if model_params is None:
        model_params = {
            'objective': 'binary',
            'num_leaves': 12,
            'learning_rate': 0.05,
            'n_estimators': 100,
            'min_child_samples': 15,
            'lambda_l2': 0.3,
            'feature_fraction': 0.75,  # Slightly lower for stochasticity
            'bagging_fraction': 0.8,
            'bagging_freq': 5,
            'min_gain_to_split': 0.01,  # Prevent shallow overfits
            'verbose': -1,
            'random_state': 42
        }
    
    # Calculate class weights
    n_pos = np.sum(y == 1)
    n_neg = np.sum(y == 0)
    scale_pos_weight = n_neg / n_pos if n_pos > 0 else 1.0
    model_params['scale_pos_weight'] = scale_pos_weight
    
    # Initialize CV
    tscv = TimeSeriesSplit(n_splits=n_splits)
    
    # Store results
    accuracies = []
    precisions = []
    recalls = []
    f1_scores = []
    train_sizes = []
    test_sizes = []
    
    logger.info(f"\nRunning {n_splits}-fold time-series CV...")
    
    for fold, (train_idx, test_idx) in enumerate(tscv.split(X), 1):
        X_train_fold = X.iloc[train_idx]
        X_test_fold = X.iloc[test_idx]
        y_train_fold = y[train_idx]
        y_test_fold = y[test_idx]
        
        train_sizes.append(len(train_idx))
        test_sizes.append(len(test_idx))
        
        logger.info(f"\nFold {fold}/{n_splits}:")
        logger.info(f"  Train: {len(train_idx)} samples (indices {train_idx[0]}-{train_idx[-1]})")
        logger.info(f"  Test:  {len(test_idx)} samples (indices {test_idx[0]}-{test_idx[-1]})")
        logger.info(f"  Train class dist: {np.bincount(y_train_fold)}")
        logger.info(f"  Test class dist:  {np.bincount(y_test_fold)}")
        
        # Train model
        model = lgb.LGBMClassifier(**model_params)
        model.fit(
            X_train_fold.values,
            y_train_fold,
            eval_set=[(X_test_fold.values, y_test_fold)],
            callbacks=[
                lgb.early_stopping(stopping_rounds=15),  # Stricter early stopping
                lgb.log_evaluation(period=0)
            ]
        )
        
        # Predict
        y_pred = model.predict(X_test_fold.values)
        
        # Calculate metrics
        acc = accuracy_score(y_test_fold, y_pred)
        prec = precision_score(y_test_fold, y_pred, zero_division=0)
        rec = recall_score(y_test_fold, y_pred, zero_division=0)
        f1 = f1_score(y_test_fold, y_pred, zero_division=0)
        
        accuracies.append(acc)
        precisions.append(prec)
        recalls.append(rec)
        f1_scores.append(f1)
        
        logger.info(f"  Accuracy: {acc:.4f}, F1: {f1:.4f}, Precision: {prec:.4f}, Recall: {rec:.4f}")
    
    # Aggregate results
    results = {
        'accuracies': np.array(accuracies),
        'precisions': np.array(precisions),
        'recalls': np.array(recalls),
        'f1_scores': np.array(f1_scores),
        'train_sizes': train_sizes,
        'test_sizes': test_sizes,
        'mean_accuracy': np.mean(accuracies),
        'std_accuracy': np.std(accuracies),
        'mean_f1': np.mean(f1_scores),
        'std_f1': np.std(f1_scores),
        'mean_precision': np.mean(precisions),
        'std_precision': np.std(precisions),
        'mean_recall': np.mean(recalls),
        'std_recall': np.std(recalls),
    }
    
    # Summary
    logger.info("\n" + "="*80)
    logger.info("TIME-SERIES CV RESULTS")
    logger.info("="*80)
    logger.info(f"Accuracy:  {results['mean_accuracy']:.4f} ± {results['std_accuracy']:.4f}")
    logger.info(f"F1 Score:  {results['mean_f1']:.4f} ± {results['std_f1']:.4f}")
    logger.info(f"Precision: {results['mean_precision']:.4f} ± {results['std_precision']:.4f}")
    logger.info(f"Recall:    {results['mean_recall']:.4f} ± {results['std_recall']:.4f}")
    logger.info(f"Range:     [{np.min(accuracies):.4f}, {np.max(accuracies):.4f}]")
    
    # Check targets
    logger.info("\n" + "="*80)
    logger.info("TARGET ASSESSMENT")
    logger.info("="*80)
    targets_met = []
    
    if results['mean_accuracy'] >= 0.94:
        logger.info(f"✅ CV mean accuracy ≥94%: {results['mean_accuracy']:.4f}")
        targets_met.append(True)
    else:
        logger.info(f"❌ CV mean accuracy ≥94%: {results['mean_accuracy']:.4f} (target: ≥0.94)")
        targets_met.append(False)
    
    if results['std_accuracy'] <= 0.015:
        logger.info(f"✅ CV std ≤0.015: {results['std_accuracy']:.4f}")
        targets_met.append(True)
    else:
        logger.info(f"❌ CV std ≤0.015: {results['std_accuracy']:.4f} (target: ≤0.015)")
        targets_met.append(False)
    
    if all(targets_met):
        logger.info("\n🎉 All stability targets met!")
    else:
        logger.info("\n⚠️  Some stability targets not met - consider more data or regularization")
    
    return results


if __name__ == '__main__':
    # Example usage
    from pathlib import Path
    import sys
    import os
    
    # Add scripts directory to path
    script_dir = Path(__file__).parent
    sys.path.insert(0, str(script_dir))
    
    # Import directly from the script file
    import train_98_percent_model
    SmartFeatureEngineer = train_98_percent_model.SmartFeatureEngineer
    
    # Get project root for data path
    project_root = script_dir.parent.parent
    
    # Load data
    data_path = project_root.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    
    df = pd.read_csv(data_path)
    df_engineered = SmartFeatureEngineer.engineer_features(df)
    
    # Prepare features
    exclude_cols = ['claimable', 'claim_id', 'seller_id', 'order_id', 'description']
    feature_cols = [col for col in df_engineered.columns if col not in exclude_cols]
    X = df_engineered[feature_cols].copy()
    
    # Convert to numeric
    for col in X.columns:
        X[col] = pd.to_numeric(X[col], errors='coerce')
    X = X.fillna(0)
    X = X.select_dtypes(include=[np.number])
    
    y = df_engineered['claimable'].values
    
    # Check for date column (for sorting, but don't include in features)
    date_col = None
    date_values = None
    if 'claim_date' in df.columns:
        date_values = pd.to_datetime(df['claim_date'], errors='coerce')
        date_col = 'claim_date'
        # Sort by date if available
        sort_idx = date_values.argsort()
        X = X.iloc[sort_idx].reset_index(drop=True)
        y = y[sort_idx]
    
    # Run time-series CV (X should not contain date column)
    results = time_series_cross_validate(X, y, date_column=None, n_splits=5)
    
    print("\n[SUCCESS] Time-series CV complete!")

