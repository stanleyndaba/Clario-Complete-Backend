"""
Feature Audit Script
Analyzes feature correlation and mutual information with target to detect leakage
"""

import pandas as pd
import numpy as np
from sklearn.feature_selection import mutual_info_classif
from scipy.stats import spearmanr
from pathlib import Path
import sys

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Import directly from the script file
import train_98_percent_model
SmartFeatureEngineer = train_98_percent_model.SmartFeatureEngineer

# Get project root for data path
project_root = script_dir.parent.parent

def load_data():
    """Load processed claims data"""
    data_path = project_root.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    df = pd.read_csv(data_path)
    return df

def calculate_correlations(df_features, y):
    """Calculate correlation between features and target"""
    correlations = {}
    for col in df_features.columns:
        try:
            corr, p_value = spearmanr(df_features[col], y)
            correlations[col] = {
                'correlation': corr,
                'p_value': p_value,
                'abs_correlation': abs(corr)
            }
        except:
            correlations[col] = {
                'correlation': np.nan,
                'p_value': np.nan,
                'abs_correlation': np.nan
            }
    
    return pd.DataFrame(correlations).T.sort_values('abs_correlation', ascending=False)

def calculate_mutual_information(X, y):
    """Calculate mutual information between features and target"""
    mi_scores = mutual_info_classif(X, y, random_state=42)
    mi_df = pd.DataFrame({
        'feature': X.columns,
        'mutual_info': mi_scores
    }).sort_values('mutual_info', ascending=False)
    return mi_df

def identify_suspicious_features(corr_df, mi_df, threshold_corr=0.9, threshold_mi=0.5):
    """Identify features that may be leaking label information"""
    suspicious = []
    
    # High correlation features (likely leakage or redundant encodings)
    high_corr = corr_df[corr_df['abs_correlation'] > threshold_corr]
    if len(high_corr) > 0:
        suspicious.append({
            'type': 'High Correlation (Remove)',
            'features': high_corr.index.tolist(),
            'reason': f'Correlation > {threshold_corr} with target - likely leakage or redundant',
            'action': 'REMOVE'
        })
    
    # Medium-high correlation (review carefully)
    medium_corr = corr_df[(corr_df['abs_correlation'] > 0.7) & (corr_df['abs_correlation'] <= threshold_corr)]
    if len(medium_corr) > 0:
        suspicious.append({
            'type': 'Medium-High Correlation (Review)',
            'features': medium_corr.index.tolist(),
            'reason': f'Correlation 0.7-{threshold_corr} - review for interpretability',
            'action': 'REVIEW'
        })
    
    # High mutual information features (check interpretability)
    high_mi = mi_df[mi_df['mutual_info'] > threshold_mi]
    if len(high_mi) > 0:
        suspicious.append({
            'type': 'High Mutual Information (Review)',
            'features': high_mi['feature'].tolist(),
            'reason': f'Mutual information > {threshold_mi} - check if spurious',
            'action': 'REVIEW'
        })
    
    return suspicious

def main():
    print("="*80)
    print("FEATURE AUDIT - Detecting Label Leakage")
    print("="*80)
    
    # Load and prepare data
    print("\n[1/4] Loading data...")
    df = load_data()
    print(f"Loaded {len(df)} samples with {len(df.columns)} columns")
    
    # Engineer features
    print("\n[2/4] Engineering features...")
    df_engineered = SmartFeatureEngineer.engineer_features(df)
    
    # Prepare features and target
    exclude_cols = ['claimable', 'claim_id', 'seller_id', 'order_id', 'description']
    feature_cols = [col for col in df_engineered.columns if col not in exclude_cols]
    df_features = df_engineered[feature_cols].copy()
    
    # Convert all to numeric
    for col in df_features.columns:
        df_features[col] = pd.to_numeric(df_features[col], errors='coerce')
    df_features = df_features.fillna(0)
    df_features = df_features.select_dtypes(include=[np.number])
    
    y = df_engineered['claimable'].values
    
    print(f"Feature engineering complete: {len(df_features.columns)} features")
    
    # Calculate correlations
    print("\n[3/4] Calculating correlations...")
    corr_df = calculate_correlations(df_features, y)
    print(f"\nTop 10 Features by Absolute Correlation:")
    print(corr_df.head(10)[['correlation', 'abs_correlation', 'p_value']])
    
    # Calculate mutual information
    print("\n[4/4] Calculating mutual information...")
    mi_df = calculate_mutual_information(df_features, y)
    print(f"\nTop 10 Features by Mutual Information:")
    print(mi_df.head(10))
    
    # Identify suspicious features
    print("\n" + "="*80)
    print("SUSPICIOUS FEATURES (Potential Leakage)")
    print("="*80)
    suspicious = identify_suspicious_features(corr_df, mi_df, threshold_corr=0.9, threshold_mi=0.5)
    
    if suspicious:
        for item in suspicious:
            print(f"\n{item['type']}:")
            print(f"  Reason: {item['reason']}")
            print(f"  Features: {', '.join(item['features'])}")
    else:
        print("\n[OK] No highly suspicious features detected (correlation < 0.9, MI < 0.5)")
    
    # Summary statistics
    print("\n" + "="*80)
    print("SUMMARY STATISTICS")
    print("="*80)
    print(f"\nTotal features analyzed: {len(df_features.columns)}")
    print(f"Features with |correlation| > 0.7: {len(corr_df[corr_df['abs_correlation'] > 0.7])}")
    print(f"Features with |correlation| > 0.9: {len(corr_df[corr_df['abs_correlation'] > 0.9])}")
    print(f"Features with MI > 0.3: {len(mi_df[mi_df['mutual_info'] > 0.3])}")
    print(f"Features with MI > 0.5: {len(mi_df[mi_df['mutual_info'] > 0.5])}")
    
    # Recommendations with actionable guidance
    print("\n" + "="*80)
    print("ACTIONABLE RECOMMENDATIONS")
    print("="*80)
    
    # Features to remove (correlation >0.9)
    remove_features = corr_df[corr_df['abs_correlation'] > 0.9].index.tolist()
    if remove_features:
        print(f"\n[REMOVE] These features (correlation >0.9, likely leakage):")
        for feat in remove_features:
            corr_val = corr_df.loc[feat, 'abs_correlation']
            print(f"  - {feat}: {corr_val:.3f}")
        print(f"\n  → Goal: Drop {len(remove_features)} features ({len(remove_features)/len(df_features.columns)*100:.1f}% of total)")
    
    # Features to review (correlation 0.7-0.9)
    review_features = corr_df[(corr_df['abs_correlation'] > 0.7) & (corr_df['abs_correlation'] <= 0.9)].index.tolist()
    if review_features:
        print(f"\n[REVIEW] These features (correlation 0.7-0.9, check interpretability):")
        for feat in review_features[:10]:
            corr_val = corr_df.loc[feat, 'abs_correlation']
            print(f"  - {feat}: {corr_val:.3f}")
    
    # High MI features (check if spurious)
    high_mi_features = mi_df[mi_df['mutual_info'] > 0.3]['feature'].tolist()
    if high_mi_features:
        print(f"\n[REVIEW] These high-MI features (>0.3, check if spurious):")
        for feat in high_mi_features[:10]:
            mi_val = mi_df[mi_df['feature'] == feat]['mutual_info'].values[0]
            print(f"  - {feat}: {mi_val:.3f}")
    
    # Calculate target removal percentage
    total_features = len(df_features.columns)
    target_removal = int(total_features * 0.10)  # 10% removal target
    print(f"\n[INFO] Feature Pruning Strategy:")
    print(f"  - Current features: {total_features}")
    print(f"  - Target removal: {target_removal} features (10-15% for stability)")
    print(f"  - Features to remove: {len(remove_features)}")
    print(f"  - Additional review needed: {max(0, target_removal - len(remove_features))} features")
    
    print("\n[SUCCESS] Feature audit complete!")
    print("\n[INFO] Next step: Remove high-correlation features and re-train to check CV variance improvement")
    
    return corr_df, mi_df, suspicious

if __name__ == '__main__':
    corr_df, mi_df, suspicious = main()

