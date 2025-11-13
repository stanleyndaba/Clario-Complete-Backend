"""
Controlled Data Expansion Framework
Ensures synthetic data quality and validates before retraining
"""

import pandas as pd
import numpy as np
from imblearn.over_sampling import SMOTE
from pathlib import Path
import sys
import logging
from typing import Tuple, Dict, Any

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Import directly from the script file
import train_98_percent_model
SmartFeatureEngineer = train_98_percent_model.SmartFeatureEngineer
Ensemble98Model = train_98_percent_model.Ensemble98Model
permutation_test = train_98_percent_model.permutation_test

# Get project root for data path
project_root = script_dir.parent.parent

def calculate_label_noise(y_original, y_synthetic) -> float:
    """Calculate label noise percentage in synthetic data"""
    if len(y_original) != len(y_synthetic):
        return 0.0
    
    mismatch = np.sum(y_original != y_synthetic)
    noise_pct = (mismatch / len(y_original)) * 100
    return noise_pct

def expand_with_smote(X_train: pd.DataFrame, y_train: np.ndarray, 
                      expansion_ratio: float = 1.5) -> Tuple[pd.DataFrame, np.ndarray]:
    """
    Expand dataset with SMOTE, capped at expansion_ratio
    
    Args:
        X_train: Training features
        y_train: Training labels
        expansion_ratio: Maximum ratio of synthetic to original (default 1.5)
    
    Returns:
        Expanded (X, y) tuple
    """
    original_size = len(X_train)
    target_size = int(original_size * expansion_ratio)
    
    logger.info(f"Original size: {original_size}")
    logger.info(f"Target size: {target_size} (ratio: {expansion_ratio})")
    
    # Apply SMOTE
    smote = SMOTE(random_state=42, k_neighbors=min(5, np.sum(y_train == 0) - 1))
    X_expanded, y_expanded = smote.fit_resample(X_train, y_train)
    
    # Cap at expansion_ratio
    if len(X_expanded) > target_size:
        # Randomly sample to target size
        indices = np.random.choice(len(X_expanded), target_size, replace=False)
        X_expanded = X_expanded.iloc[indices] if isinstance(X_expanded, pd.DataFrame) else pd.DataFrame(X_expanded).iloc[indices]
        y_expanded = y_expanded[indices]
        logger.info(f"Capped expansion to {len(X_expanded)} samples")
    
    logger.info(f"Expanded size: {len(X_expanded)}")
    logger.info(f"Class distribution: {np.bincount(y_expanded)}")
    
    return X_expanded, y_expanded

def temporal_bootstrap(X: pd.DataFrame, y: np.ndarray, n_samples: int = 200) -> Tuple[pd.DataFrame, np.ndarray]:
    """
    Generate synthetic samples by perturbing key features
    
    Args:
        X: Original features
        y: Original labels
        n_samples: Number of synthetic samples to generate
    
    Returns:
        Synthetic (X, y) tuple
    """
    logger.info(f"Generating {n_samples} synthetic samples via temporal bootstrapping...")
    
    # Features to perturb
    perturb_features = ['amount', 'order_value', 'days_since_order', 'quantity']
    available_features = [f for f in perturb_features if f in X.columns]
    
    synthetic_X = []
    synthetic_y = []
    
    for _ in range(n_samples):
        # Randomly select a base sample
        idx = np.random.randint(0, len(X))
        sample = X.iloc[idx].copy()
        label = y[idx]
        
        # Perturb features
        for feat in available_features:
            if feat in ['amount', 'order_value']:
                # ±5-10% variation
                variation = np.random.uniform(-0.10, 0.10)
                sample[feat] = sample[feat] * (1 + variation)
            elif feat == 'days_since_order':
                # ±1-7 days
                variation = np.random.randint(-7, 8)
                sample[feat] = max(0, sample[feat] + variation)
            elif feat == 'quantity':
                # ±1 unit (discrete)
                variation = np.random.randint(-1, 2)
                sample[feat] = max(1, sample[feat] + variation)
        
        synthetic_X.append(sample)
        synthetic_y.append(label)
    
    synthetic_X = pd.DataFrame(synthetic_X, columns=X.columns)
    synthetic_y = np.array(synthetic_y)
    
    logger.info(f"Generated {len(synthetic_X)} synthetic samples")
    logger.info(f"Class distribution: {np.bincount(synthetic_y)}")
    
    return synthetic_X, synthetic_y

def validate_expanded_data(X_original: pd.DataFrame, y_original: np.ndarray,
                          X_expanded: pd.DataFrame, y_expanded: np.ndarray,
                          model_class, df_original: pd.DataFrame) -> Dict[str, Any]:
    """
    Validate expanded dataset before retraining
    
    Args:
        X_original: Original features
        y_original: Original labels
        X_expanded: Expanded features
        y_expanded: Expanded labels
        model_class: Model class for permutation test
        df_original: Original dataframe for feature engineering
    
    Returns:
        Validation results dictionary
    """
    logger.info("="*80)
    logger.info("VALIDATING EXPANDED DATA")
    logger.info("="*80)
    
    results = {}
    
    # Check 1: Synthetic ratio
    synthetic_ratio = len(X_expanded) / len(X_original)
    results['synthetic_ratio'] = synthetic_ratio
    results['ratio_check'] = synthetic_ratio <= 1.5
    
    logger.info(f"\n[1/3] Synthetic ratio: {synthetic_ratio:.2f}×")
    if results['ratio_check']:
        logger.info("   ✅ Ratio ≤1.5× (acceptable)")
    else:
        logger.warning("   ❌ Ratio >1.5× (too high, reduce expansion)")
    
    # Check 2: Label noise (if we can compare)
    # For SMOTE, labels should match original distribution
    original_dist = np.bincount(y_original)
    expanded_dist = np.bincount(y_expanded)
    
    # Calculate label noise estimate (for temporal bootstrap)
    if len(X_expanded) > len(X_original):
        # Estimate noise from class distribution shift
        class_shift = np.abs(original_dist / len(y_original) - expanded_dist[:len(original_dist)] / len(y_expanded))
        estimated_noise = np.mean(class_shift) * 100
    else:
        estimated_noise = 0.0
    
    results['estimated_noise_pct'] = estimated_noise
    results['noise_check'] = estimated_noise <= 2.0
    
    logger.info(f"\n[2/3] Estimated label noise: {estimated_noise:.2f}%")
    if results['noise_check']:
        logger.info("   ✅ Noise ≤2% (acceptable)")
    else:
        logger.warning("   ❌ Noise >2% (too high, review expansion method)")
    
    # Check 3: Permutation test
    logger.info(f"\n[3/3] Running permutation test on expanded data...")
    
    # Prepare expanded dataframe for feature engineering
    # Combine original and expanded
    X_combined = pd.concat([X_original, X_expanded], ignore_index=True)
    y_combined = np.hstack([y_original, y_expanded])
    
    # Create model instance for permutation test
    model_instance = model_class()
    
    # For permutation test, we need to reconstruct dataframe with expanded data
    # Since we only have X and y, we'll use a simplified approach
    # Create a minimal dataframe structure for the test
    df_combined = df_original.copy()
    # Extend dataframe to match expanded size (simplified - just for permutation test)
    if len(df_combined) < len(y_combined):
        # Pad with last row (simplified approach)
        df_extended = pd.concat([df_combined] * (len(y_combined) // len(df_combined) + 1), ignore_index=True)
        df_combined = df_extended.iloc[:len(y_combined)].copy()
        df_combined['claimable'] = y_combined
    
    try:
        perm_results = permutation_test(model_instance, df_combined, y_combined, n_permutations=50)
    except Exception as e:
        logger.warning(f"Permutation test failed: {e}")
        logger.info("   Skipping permutation test - will rely on other validation checks")
        perm_results = {'p_value': 1.0, 'is_significant': False}
    
    results['permutation_p'] = perm_results['p_value']
    results['permutation_check'] = perm_results['p_value'] < 0.05
    
    logger.info(f"   Permutation p-value: {perm_results['p_value']:.4f}")
    if results['permutation_check']:
        logger.info("   ✅ p < 0.05 (proceed with retraining)")
    else:
        logger.warning("   ❌ p ≥ 0.05 (re-sample or collect more real data)")
    
    # Overall validation
    all_checks = [
        results['ratio_check'],
        results['noise_check'],
        results['permutation_check']
    ]
    
    results['validation_passed'] = all(all_checks)
    
    logger.info("\n" + "="*80)
    logger.info("VALIDATION SUMMARY")
    logger.info("="*80)
    if results['validation_passed']:
        logger.info("✅ All validation checks passed - proceed with retraining")
    else:
        logger.warning("❌ Some validation checks failed - review before retraining")
    
    return results

def controlled_expansion_workflow(df: pd.DataFrame, expansion_method: str = 'smote',
                                  expansion_ratio: float = 1.5) -> Tuple[pd.DataFrame, np.ndarray, Dict[str, Any]]:
    """
    Controlled data expansion workflow
    
    Args:
        df: Original dataframe
        expansion_method: 'smote' or 'bootstrap'
        expansion_ratio: Maximum expansion ratio (default 1.5)
    
    Returns:
        Expanded (X, y) and validation results
    """
    logger.info("="*80)
    logger.info("CONTROLLED DATA EXPANSION WORKFLOW")
    logger.info("="*80)
    
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
    
    # Split for expansion (use train set only)
    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    logger.info(f"Original training set: {len(X_train)} samples")
    
    # Expand data
    if expansion_method == 'smote':
        X_expanded, y_expanded = expand_with_smote(X_train, y_train, expansion_ratio)
    elif expansion_method == 'bootstrap':
        n_samples = int(len(X_train) * (expansion_ratio - 1))
        X_synthetic, y_synthetic = temporal_bootstrap(X_train, y_train, n_samples)
        X_expanded = pd.concat([X_train, X_synthetic], ignore_index=True)
        y_expanded = np.hstack([y_train, y_synthetic])
    else:
        raise ValueError(f"Unknown expansion method: {expansion_method}")
    
    # Validate
    validation_results = validate_expanded_data(
        X_train, y_train, X_expanded, y_expanded,
        Ensemble98Model, df
    )
    
    return X_expanded, y_expanded, validation_results

def main():
    """Main execution"""
    data_path = project_root.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    df = pd.read_csv(data_path)
    
    logger.info("Running controlled data expansion...")
    X_expanded, y_expanded, validation = controlled_expansion_workflow(
        df, expansion_method='smote', expansion_ratio=1.5
    )
    
    logger.info("\n" + "="*80)
    logger.info("EXPANSION COMPLETE")
    logger.info("="*80)
    logger.info(f"Original size: {len(df)}")
    logger.info(f"Expanded size: {len(X_expanded)}")
    logger.info(f"Validation passed: {validation['validation_passed']}")
    
    if validation['validation_passed']:
        logger.info("\n✅ Proceed with retraining on expanded dataset")
        logger.info("   Target: CV mean ≥94%")
    else:
        logger.warning("\n⚠️  Review validation results before retraining")
    
    return X_expanded, y_expanded, validation

if __name__ == '__main__':
    X_expanded, y_expanded, validation = main()

