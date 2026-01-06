"""
Target Refinement Path (Optional)
If model hovers between 97.7-98.3%, use advanced ensembling to stabilize
"""

import pandas as pd
import numpy as np
import lightgbm as lgb
import xgboost as xgb
from sklearn.ensemble import VotingClassifier
from scipy import stats
import logging
from pathlib import Path
import sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add parent directory to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from scripts.train_98_percent_model import SmartFeatureEngineer, Ensemble98Model

def bayesian_ensemble(models, X, method='average_proba'):
    """
    Bayesian ensembling across multiple models
    
    Args:
        models: List of trained models
        X: Features
        method: 'average_proba' or 'weighted_proba'
    
    Returns:
        Ensemble predictions and probabilities
    """
    all_probas = []
    
    for model in models:
        if hasattr(model, 'predict_proba'):
            proba = model.predict_proba(X)[:, 1]
        else:
            # LightGBM native API
            proba = model.predict(X)
        all_probas.append(proba)
    
    all_probas = np.array(all_probas)
    
    if method == 'average_proba':
        ensemble_proba = np.mean(all_probas, axis=0)
    elif method == 'weighted_proba':
        # Weight by model confidence (inverse variance)
        weights = 1.0 / (np.var(all_probas, axis=0) + 1e-6)
        weights = weights / np.sum(weights)
        ensemble_proba = np.average(all_probas, axis=0, weights=weights)
    else:
        ensemble_proba = np.mean(all_probas, axis=0)
    
    ensemble_pred = (ensemble_proba > 0.5).astype(int)
    
    return ensemble_pred, ensemble_proba

def hybrid_lightgbm_tabnet(X_train, y_train, X_val, y_val):
    """
    LightGBM + TabNet hybrid ensemble
    
    Note: TabNet requires separate installation (pip install pytorch-tabnet)
    This is a placeholder implementation - install TabNet for full functionality
    """
    logger.info("Training LightGBM + TabNet hybrid...")
    
    # Train LightGBM
    lgb_model = lgb.LGBMClassifier(
        objective='binary',
        num_leaves=12,
        learning_rate=0.05,
        n_estimators=100,
        feature_fraction=0.75,
        min_child_samples=15,
        min_gain_to_split=0.01,
        lambda_l2=0.3,
        verbose=-1,
        random_state=42
    )
    lgb_model.fit(X_train, y_train, eval_set=[(X_val, y_val)],
                  callbacks=[lgb.early_stopping(stopping_rounds=15), lgb.log_evaluation(period=0)])
    
    # TabNet (placeholder - requires installation)
    try:
        from pytorch_tabnet.tab_model import TabNetClassifier
        tabnet = TabNetClassifier(
            n_d=16, n_a=16,
            n_steps=3,
            gamma=1.5,
            n_independent=2,
            n_shared=2,
            seed=42
        )
        tabnet.fit(X_train.values, y_train, eval_set=[(X_val.values, y_val)],
                  max_epochs=100, patience=15)
        
        models = [lgb_model, tabnet]
        logger.info("✅ TabNet installed - using hybrid ensemble")
    except ImportError:
        logger.warning("⚠️  TabNet not installed - using LightGBM only")
        logger.info("   Install with: pip install pytorch-tabnet")
        models = [lgb_model]
    
    return models

def target_refinement_workflow(df, target_range=(0.977, 0.983)):
    """
    Target refinement workflow for models hovering 97.7-98.3%
    
    Args:
        df: Training dataframe
        target_range: (min, max) accuracy range to trigger refinement
    
    Returns:
        Refined model and metrics
    """
    logger.info("="*80)
    logger.info("TARGET REFINEMENT WORKFLOW")
    logger.info("="*80)
    logger.info(f"Target range: {target_range[0]:.1%} - {target_range[1]:.1%}")
    
    # Prepare features
    df_engineered = SmartFeatureEngineer.engineer_features(df)
    exclude_cols = ['claimable', 'claim_id', 'seller_id', 'order_id', 'description']
    feature_cols = [col for col in df_engineered.columns if col not in exclude_cols]
    X = df_engineered[feature_cols].copy()
    
    for col in X.columns:
        X[col] = pd.to_numeric(X[col], errors='coerce')
    X = X.fillna(0)
    X = X.select_dtypes(include=[np.number])
    
    y = df_engineered['claimable'].values
    
    # Split data
    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    X_train_fit, X_val, y_train_fit, y_val = train_test_split(
        X_train, y_train, test_size=0.2, random_state=42, stratify=y_train
    )
    
    # Check if baseline is in target range
    logger.info("\n[1/3] Checking baseline performance...")
    baseline_model = Ensemble98Model()
    X_prep, y_prep = baseline_model.prepare_features(df_engineered.iloc[X_train.index], is_training=True)
    train_results = baseline_model.train_ensemble(X_prep.iloc[:len(X_train_fit)], y_train_fit,
                                                  X_prep.iloc[len(X_train_fit):len(X_train_fit)+len(X_val)], y_val,
                                                  use_smote=True)
    
    baseline_acc = train_results['ensemble']['accuracy']
    logger.info(f"Baseline accuracy: {baseline_acc:.4f}")
    
    if target_range[0] <= baseline_acc <= target_range[1]:
        logger.info(f"✅ Baseline in target range - applying refinement...")
    else:
        logger.info(f"⚠️  Baseline outside target range ({baseline_acc:.4f})")
        logger.info("   Refinement may not be necessary")
    
    # Method 1: Bayesian Ensembling
    logger.info("\n[2/3] Training Bayesian ensemble...")
    
    # Train multiple models
    models = []
    
    # LightGBM
    lgb1 = lgb.LGBMClassifier(
        objective='binary', num_leaves=12, learning_rate=0.05,
        n_estimators=100, feature_fraction=0.75, min_child_samples=15,
        min_gain_to_split=0.01, lambda_l2=0.3, verbose=-1, random_state=42
    )
    lgb1.fit(X_train_fit, y_train_fit, eval_set=[(X_val, y_val)],
             callbacks=[lgb.early_stopping(stopping_rounds=15), lgb.log_evaluation(period=0)])
    models.append(lgb1)
    
    # XGBoost
    xgb_model = xgb.XGBClassifier(
        n_estimators=100, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8, early_stopping_rounds=15,
        random_state=42, eval_metric='logloss'
    )
    xgb_model.fit(X_train_fit, y_train_fit, eval_set=[(X_val, y_val)], verbose=False)
    models.append(xgb_model)
    
    # Another LightGBM with different params
    lgb2 = lgb.LGBMClassifier(
        objective='binary', num_leaves=10, learning_rate=0.03,
        n_estimators=150, feature_fraction=0.7, min_child_samples=20,
        min_gain_to_split=0.02, lambda_l2=0.5, verbose=-1, random_state=123
    )
    lgb2.fit(X_train_fit, y_train_fit, eval_set=[(X_val, y_val)],
             callbacks=[lgb.early_stopping(stopping_rounds=15), lgb.log_evaluation(period=0)])
    models.append(lgb2)
    
    # Bayesian ensemble
    bayesian_pred, bayesian_proba = bayesian_ensemble(models, X_val, method='average_proba')
    
    from sklearn.metrics import accuracy_score, f1_score
    bayesian_acc = accuracy_score(y_val, bayesian_pred)
    bayesian_f1 = f1_score(y_val, bayesian_pred, zero_division=0)
    
    logger.info(f"Bayesian ensemble - Accuracy: {bayesian_acc:.4f}, F1: {bayesian_f1:.4f}")
    
    # Method 2: Hybrid LightGBM + TabNet (if available)
    logger.info("\n[3/3] Training hybrid LightGBM + TabNet...")
    hybrid_models = hybrid_lightgbm_tabnet(X_train_fit.values, y_train_fit,
                                          X_val.values, y_val)
    
    if len(hybrid_models) > 1:
        hybrid_pred, hybrid_proba = bayesian_ensemble(hybrid_models, X_val.values)
        hybrid_acc = accuracy_score(y_val, hybrid_pred)
        hybrid_f1 = f1_score(y_val, hybrid_pred, zero_division=0)
        logger.info(f"Hybrid ensemble - Accuracy: {hybrid_acc:.4f}, F1: {hybrid_f1:.4f}")
    else:
        hybrid_acc = baseline_acc
        hybrid_f1 = train_results['ensemble']['f1']
        logger.info("Using LightGBM only (TabNet not available)")
    
    # Compare results
    logger.info("\n" + "="*80)
    logger.info("REFINEMENT RESULTS")
    logger.info("="*80)
    logger.info(f"Baseline:        {baseline_acc:.4f}")
    logger.info(f"Bayesian:        {bayesian_acc:.4f} (Δ{bayesian_acc-baseline_acc:+.4f})")
    if len(hybrid_models) > 1:
        logger.info(f"Hybrid:          {hybrid_acc:.4f} (Δ{hybrid_acc-baseline_acc:+.4f})")
    
    # Select best method
    best_method = 'baseline'
    best_acc = baseline_acc
    
    if bayesian_acc > best_acc:
        best_method = 'bayesian'
        best_acc = bayesian_acc
    
    if len(hybrid_models) > 1 and hybrid_acc > best_acc:
        best_method = 'hybrid'
        best_acc = hybrid_acc
    
    logger.info(f"\n✅ Best method: {best_method} (accuracy: {best_acc:.4f})")
    
    if best_acc >= 0.98:
        logger.info("🎉 Target 98% achieved with refinement!")
    else:
        improvement = best_acc - baseline_acc
        logger.info(f"📈 Improvement: {improvement:+.4f} ({improvement*100:+.2f}%)")
        logger.info("   May need more data for stable 98%")
    
    return {
        'baseline_acc': baseline_acc,
        'bayesian_acc': bayesian_acc,
        'hybrid_acc': hybrid_acc if len(hybrid_models) > 1 else baseline_acc,
        'best_method': best_method,
        'best_acc': best_acc,
        'models': models if best_method == 'bayesian' else hybrid_models
    }

def main():
    """Main execution"""
    data_path = project_root.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    df = pd.read_csv(data_path)
    
    logger.info("Running target refinement workflow...")
    results = target_refinement_workflow(df, target_range=(0.977, 0.983))
    
    logger.info("\n✅ Target refinement complete!")
    return results

if __name__ == '__main__':
    results = main()

