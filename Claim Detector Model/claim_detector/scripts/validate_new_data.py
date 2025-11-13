"""
Data Validation Script
Validates newly collected data before integration
"""

import pandas as pd
import numpy as np
from pathlib import Path
import sys
import logging
from typing import Dict, Any

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Get project root
project_root = script_dir.parent.parent

def validate_data_quality(df: pd.DataFrame) -> Dict[str, Any]:
    """Validate data quality and completeness"""
    logger.info("="*80)
    logger.info("DATA QUALITY VALIDATION")
    logger.info("="*80)
    
    results = {
        'total_samples': len(df),
        'missing_values': {},
        'duplicates': 0,
        'date_issues': [],
        'label_issues': [],
        'diversity_metrics': {},
        'quality_score': 0.0
    }
    
    # Required fields
    required_fields = [
        'claim_id', 'seller_id', 'order_id', 'claim_date', 'order_date',
        'amount', 'order_value', 'quantity', 'category', 'marketplace',
        'fulfillment_center', 'claimable'
    ]
    
    logger.info(f"\n[1/6] Checking required fields...")
    missing_fields = [f for f in required_fields if f not in df.columns]
    if missing_fields:
        logger.error(f"   Missing required fields: {', '.join(missing_fields)}")
        results['missing_fields'] = missing_fields
    else:
        logger.info("   [OK] All required fields present")
    
    # Check missing values
    logger.info(f"\n[2/6] Checking missing values...")
    for field in required_fields:
        if field in df.columns:
            missing_count = df[field].isna().sum()
            missing_pct = (missing_count / len(df)) * 100
            results['missing_values'][field] = {
                'count': int(missing_count),
                'percentage': float(missing_pct)
            }
            if missing_pct > 5:
                logger.warning(f"   {field}: {missing_count} missing ({missing_pct:.1f}%)")
            elif missing_count > 0:
                logger.info(f"   {field}: {missing_count} missing ({missing_pct:.1f}%)")
    
    # Check duplicates
    logger.info(f"\n[3/6] Checking duplicates...")
    if 'claim_id' in df.columns:
        duplicates = df['claim_id'].duplicated().sum()
        results['duplicates'] = int(duplicates)
        if duplicates > 0:
            logger.warning(f"   Found {duplicates} duplicate claim_ids")
        else:
            logger.info("   [OK] No duplicate claim_ids")
    
    # Check date ranges
    logger.info(f"\n[4/6] Checking date ranges...")
    if 'claim_date' in df.columns:
        df['claim_date'] = pd.to_datetime(df['claim_date'], errors='coerce')
        invalid_dates = df['claim_date'].isna().sum()
        future_dates = (df['claim_date'] > pd.Timestamp.now()).sum()
        
        if invalid_dates > 0:
            logger.warning(f"   Invalid claim_date: {invalid_dates}")
            results['date_issues'].append(f"Invalid claim_date: {invalid_dates}")
        
        if future_dates > 0:
            logger.warning(f"   Future claim_date: {future_dates}")
            results['date_issues'].append(f"Future claim_date: {future_dates}")
        
        if invalid_dates == 0 and future_dates == 0:
            logger.info("   [OK] All dates valid")
            logger.info(f"   Date range: {df['claim_date'].min()} to {df['claim_date'].max()}")
    
    # Check labels
    logger.info(f"\n[5/6] Checking labels...")
    if 'claimable' in df.columns:
        unique_labels = df['claimable'].unique()
        invalid_labels = [l for l in unique_labels if l not in [0, 1]]
        
        if invalid_labels:
            logger.error(f"   Invalid labels: {invalid_labels}")
            results['label_issues'].append(f"Invalid labels: {invalid_labels}")
        else:
            logger.info("   [OK] All labels valid (0 or 1)")
        
        label_dist = df['claimable'].value_counts().to_dict()
        logger.info(f"   Label distribution: {label_dist}")
        results['label_distribution'] = {int(k): int(v) for k, v in label_dist.items()}
    
    # Check diversity
    logger.info(f"\n[6/6] Checking diversity...")
    diversity_fields = ['marketplace', 'category', 'fulfillment_center']
    for field in diversity_fields:
        if field in df.columns:
            unique_count = df[field].nunique()
            results['diversity_metrics'][field] = {
                'unique_values': int(unique_count),
                'values': df[field].value_counts().to_dict()
            }
            logger.info(f"   {field}: {unique_count} unique values")
    
    # Calculate quality score
    quality_checks = []
    
    # Missing fields check
    if 'missing_fields' not in results or len(results['missing_fields']) == 0:
        quality_checks.append(1.0)
    else:
        quality_checks.append(0.0)
    
    # Missing values check (penalty if >5% missing)
    high_missing = sum(1 for v in results['missing_values'].values() if v['percentage'] > 5)
    quality_checks.append(1.0 if high_missing == 0 else max(0, 1.0 - high_missing * 0.2))
    
    # Duplicates check
    quality_checks.append(1.0 if results['duplicates'] == 0 else 0.5)
    
    # Date issues check
    quality_checks.append(1.0 if len(results['date_issues']) == 0 else 0.5)
    
    # Label issues check
    quality_checks.append(1.0 if len(results['label_issues']) == 0 else 0.0)
    
    results['quality_score'] = float(np.mean(quality_checks))
    
    # Summary
    logger.info("\n" + "="*80)
    logger.info("VALIDATION SUMMARY")
    logger.info("="*80)
    logger.info(f"Total samples: {results['total_samples']}")
    logger.info(f"Quality score: {results['quality_score']:.2%}")
    
    if results['quality_score'] >= 0.9:
        logger.info("[OK] Data quality acceptable - ready for integration")
        results['status'] = 'PASS'
    elif results['quality_score'] >= 0.7:
        logger.warning("[WARNING] Data quality issues detected - review before integration")
        results['status'] = 'REVIEW'
    else:
        logger.error("[ERROR] Data quality poor - fix issues before integration")
        results['status'] = 'FAIL'
    
    return results

def main():
    """Main execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Validate new data before integration")
    parser.add_argument('--data-path', type=str, required=True,
                       help='Path to new data CSV file')
    parser.add_argument('--output', type=str, default=None,
                       help='Path to save validation report (JSON)')
    
    args = parser.parse_args()
    
    # Load data
    logger.info(f"Loading data from {args.data_path}")
    df = pd.read_csv(args.data_path)
    logger.info(f"Loaded {len(df)} samples")
    
    # Validate
    results = validate_data_quality(df)
    
    # Save report if requested
    if args.output:
        import json
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        logger.info(f"Validation report saved to {args.output}")
    
    return results

if __name__ == '__main__':
    results = main()

