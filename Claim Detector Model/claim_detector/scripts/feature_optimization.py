"""
Phase-2 Feature Optimization Plan
After removing unstable features, validate entropy drop and selectively restore if needed
"""

import pandas as pd
import numpy as np
from sklearn.feature_selection import mutual_info_classif
from pathlib import Path
import sys
import json
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Import directly from the script file
import train_98_percent_model
SmartFeatureEngineer = train_98_percent_model.SmartFeatureEngineer

# Get project root for data path
project_root = script_dir.parent.parent

def calculate_feature_entropy(X, y):
    """Calculate mutual information entropy for feature set"""
    mi_scores = mutual_info_classif(X, y, random_state=42)
    total_entropy = np.sum(mi_scores)
    return total_entropy, mi_scores

def feature_optimization_workflow(df, remove_features=None, review_features=None):
    """
    Phase-2 Feature Optimization Workflow
    
    Args:
        df: Original dataframe
        remove_features: List of features to remove (from feature audit)
        review_features: List of features to review (from feature audit)
    
    Returns:
        Dictionary with optimization results and recommendations
    """
    logger.info("="*80)
    logger.info("PHASE-2 FEATURE OPTIMIZATION")
    logger.info("="*80)
    
    # Step 1: Engineer features
    logger.info("\n[1/4] Engineering features...")
    df_engineered = SmartFeatureEngineer.engineer_features(df)
    
    # Prepare base feature set
    exclude_cols = ['claimable', 'claim_id', 'seller_id', 'order_id', 'description']
    feature_cols = [col for col in df_engineered.columns if col not in exclude_cols]
    df_features = df_engineered[feature_cols].copy()
    
    # Convert to numeric
    for col in df_features.columns:
        df_features[col] = pd.to_numeric(df_features[col], errors='coerce')
    df_features = df_features.fillna(0)
    df_features = df_features.select_dtypes(include=[np.number])
    
    y = df_engineered['claimable'].values
    
    logger.info(f"Base feature set: {len(df_features.columns)} features")
    
    # Step 2: Calculate baseline entropy
    logger.info("\n[2/4] Calculating baseline entropy...")
    baseline_entropy, baseline_mi = calculate_feature_entropy(df_features, y)
    logger.info(f"Baseline total entropy: {baseline_entropy:.4f}")
    
    # Step 3: Remove unstable features
    if remove_features is None:
        remove_features = []
    
    logger.info(f"\n[3/4] Removing {len(remove_features)} unstable features...")
    if remove_features:
        logger.info(f"Features to remove: {', '.join(remove_features)}")
        df_features_optimized = df_features.drop(columns=remove_features, errors='ignore')
    else:
        df_features_optimized = df_features.copy()
        logger.info("No features specified for removal - using all features")
    
    # Step 4: Calculate optimized entropy
    logger.info("\n[4/4] Calculating optimized entropy...")
    optimized_entropy, optimized_mi = calculate_feature_entropy(df_features_optimized, y)
    logger.info(f"Optimized total entropy: {optimized_entropy:.4f}")
    
    # Calculate entropy drop
    entropy_drop = baseline_entropy - optimized_entropy
    entropy_drop_pct = (entropy_drop / baseline_entropy) * 100 if baseline_entropy > 0 else 0
    
    logger.info("\n" + "="*80)
    logger.info("ENTROPY ANALYSIS")
    logger.info("="*80)
    logger.info(f"Baseline entropy:  {baseline_entropy:.4f}")
    logger.info(f"Optimized entropy: {optimized_entropy:.4f}")
    logger.info(f"Entropy drop:      {entropy_drop:.4f} ({entropy_drop_pct:.2f}%)")
    
    # Interpretation
    logger.info("\n" + "="*80)
    logger.info("INTERPRETATION")
    logger.info("="*80)
    
    if entropy_drop_pct < 5:
        logger.info("[OK] Entropy drop <5%: Removed noise correctly")
        logger.info("   -> Proceed with optimized feature set")
        action = "PROCEED"
    elif entropy_drop_pct <= 10:
        logger.info("[WARNING] Entropy drop 5-10%: Some signal may have been removed")
        logger.info("   -> Review removed features, consider selective restoration")
        action = "REVIEW"
    else:
        logger.info("[ERROR] Entropy drop >10%: Significant signal removed")
        logger.info("   -> Restore some 'REVIEW' features selectively")
        action = "RESTORE"
    
    # Feature restoration recommendations
    recommendations = {
        'action': action,
        'entropy_drop_pct': entropy_drop_pct,
        'baseline_entropy': float(baseline_entropy),
        'optimized_entropy': float(optimized_entropy),
        'removed_features': remove_features,
        'optimized_features': list(df_features_optimized.columns),
        'baseline_count': len(df_features.columns),
        'optimized_count': len(df_features_optimized.columns)
    }
    
    if action == "RESTORE" and review_features:
        logger.info("\n" + "="*80)
        logger.info("RESTORATION RECOMMENDATIONS")
        logger.info("="*80)
        logger.info("Consider restoring these high-MI features from 'REVIEW' list:")
        
        # Calculate MI for review features
        review_mi = {}
        for feat in review_features:
            if feat in df_features.columns:
                feat_idx = list(df_features.columns).index(feat)
                review_mi[feat] = baseline_mi[feat_idx]
        
        # Sort by MI and recommend top 3-5
        sorted_review = sorted(review_mi.items(), key=lambda x: x[1], reverse=True)
        top_restore = sorted_review[:min(5, len(sorted_review))]
        
        for feat, mi_val in top_restore:
            logger.info(f"  - {feat}: MI={mi_val:.4f}")
        
        recommendations['restore_candidates'] = [f[0] for f in top_restore]
    
    # Final feature set
    logger.info("\n" + "="*80)
    logger.info("FINAL FEATURE SET")
    logger.info("="*80)
    logger.info(f"Feature count: {len(df_features_optimized.columns)} (reduced from {len(df_features.columns)})")
    logger.info(f"Features: {', '.join(df_features_optimized.columns.tolist())}")
    
    # Save feature schema
    feature_schema = {
        'version': '1.0',
        'feature_count': len(df_features_optimized.columns),
        'features': list(df_features_optimized.columns),
        'removed_features': remove_features,
        'entropy_drop_pct': entropy_drop_pct,
        'optimization_date': pd.Timestamp.now().isoformat()
    }
    
    schema_path = project_root / 'models' / 'feature_schema_v1.0.json'
    schema_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(schema_path, 'w') as f:
        json.dump(feature_schema, f, indent=2)
    
    logger.info(f"\n[SUCCESS] Feature schema saved to: {schema_path}")
    logger.info("   → This is your v1.0 certified schema (no new features allowed during tuning)")
    
    return recommendations, df_features_optimized, feature_schema

def main():
    """Main execution"""
    # Import feature audit functions directly
    script_dir = Path(__file__).parent
    sys.path.insert(0, str(script_dir))
    import feature_audit
    audit_main = feature_audit.main
    
    # Step 1: Run feature audit
    logger.info("Step 1: Running feature audit...")
    corr_df, mi_df, suspicious = audit_main()
    
    # Extract features to remove and review
    remove_features = []
    review_features = []
    
    for item in suspicious:
        if item['action'] == 'REMOVE':
            remove_features.extend(item['features'])
        elif item['action'] == 'REVIEW':
            review_features.extend(item['features'])
    
    # Step 2: Run optimization workflow
    logger.info("\n" + "="*80)
    logger.info("Step 2: Running feature optimization...")
    
    data_path = project_root.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    df = pd.read_csv(data_path)
    
    recommendations, df_optimized, schema = feature_optimization_workflow(
        df, 
        remove_features=remove_features,
        review_features=review_features
    )
    
    logger.info("\n" + "="*80)
    logger.info("OPTIMIZATION COMPLETE")
    logger.info("="*80)
    logger.info(f"Action: {recommendations['action']}")
    logger.info(f"Entropy drop: {recommendations['entropy_drop_pct']:.2f}%")
    logger.info(f"Final feature count: {recommendations['optimized_count']}")
    
    return recommendations, df_optimized, schema

if __name__ == '__main__':
    recommendations, df_optimized, schema = main()

