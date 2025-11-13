"""
Phase 3 Complete Workflow
Validates, integrates, and retrains with expanded dataset
"""

import pandas as pd
import numpy as np
import sys
import logging
from pathlib import Path
from datetime import datetime
import json

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Get project root
project_root = script_dir.parent.parent
data_dir = project_root.parent / 'data' / 'ml-training'

def validate_expanded_data(df: pd.DataFrame) -> dict:
    """Validate expanded data quality"""
    logger.info("="*80)
    logger.info("STEP 1: VALIDATING EXPANDED DATA")
    logger.info("="*80)
    
    results = {
        'total_samples': len(df),
        'quality_score': 0.0,
        'status': 'PENDING',
        'issues': []
    }
    
    # Required fields
    required_fields = [
        'claim_id', 'seller_id', 'order_id', 'claim_date', 'order_date',
        'amount', 'order_value', 'quantity', 'category', 'marketplace',
        'fulfillment_center', 'claimable'
    ]
    
    # Check required fields
    missing_fields = [f for f in required_fields if f not in df.columns]
    if missing_fields:
        results['issues'].append(f"Missing fields: {', '.join(missing_fields)}")
        logger.error(f"Missing required fields: {', '.join(missing_fields)}")
        return results
    
    # Check missing values
    high_missing = 0
    for field in required_fields:
        missing_pct = (df[field].isna().sum() / len(df)) * 100
        if missing_pct > 5:
            high_missing += 1
            results['issues'].append(f"{field}: {missing_pct:.1f}% missing")
    
    # Check duplicates
    if 'claim_id' in df.columns:
        duplicates = df['claim_id'].duplicated().sum()
        if duplicates > 0:
            results['issues'].append(f"{duplicates} duplicate claim_ids")
    
    # Check labels
    if 'claimable' in df.columns:
        unique_labels = df['claimable'].unique()
        invalid_labels = [l for l in unique_labels if l not in [0, 1]]
        if invalid_labels:
            results['issues'].append(f"Invalid labels: {invalid_labels}")
        else:
            label_dist = df['claimable'].value_counts().to_dict()
            results['label_distribution'] = {int(k): int(v) for k, v in label_dist.items()}
            logger.info(f"Label distribution: {label_dist}")
    
    # Calculate quality score
    quality_checks = []
    quality_checks.append(1.0 if len(missing_fields) == 0 else 0.0)
    quality_checks.append(1.0 if high_missing == 0 else max(0, 1.0 - high_missing * 0.2))
    quality_checks.append(1.0 if duplicates == 0 else 0.5)
    quality_checks.append(1.0 if len(invalid_labels) == 0 else 0.0)
    
    results['quality_score'] = float(np.mean(quality_checks))
    
    if results['quality_score'] >= 0.9:
        results['status'] = 'PASS'
        logger.info(f"[OK] Quality score: {results['quality_score']:.2%} - Ready for integration")
    elif results['quality_score'] >= 0.7:
        results['status'] = 'REVIEW'
        logger.warning(f"[WARNING] Quality score: {results['quality_score']:.2%} - Review issues")
    else:
        results['status'] = 'FAIL'
        logger.error(f"[ERROR] Quality score: {results['quality_score']:.2%} - Fix issues")
    
    return results

def integrate_data(existing_path: Path, new_df: pd.DataFrame) -> pd.DataFrame:
    """Integrate new data with existing"""
    logger.info("\n" + "="*80)
    logger.info("STEP 2: INTEGRATING DATA")
    logger.info("="*80)
    
    # Load existing
    if existing_path.exists():
        existing_df = pd.read_csv(existing_path)
        logger.info(f"Loaded {len(existing_df)} existing samples")
    else:
        existing_df = pd.DataFrame()
        logger.info("No existing data found - starting fresh")
    
    # Combine
    if len(existing_df) > 0:
        # Align columns - add missing columns to both dataframes
        all_cols = sorted(set(existing_df.columns) | set(new_df.columns))
        
        # Add missing columns to existing_df
        for col in all_cols:
            if col not in existing_df.columns:
                existing_df[col] = None
        
        # Add missing columns to new_df
        for col in all_cols:
            if col not in new_df.columns:
                new_df[col] = None
        
        # Reorder columns to match
        existing_df = existing_df[all_cols]
        new_df = new_df[all_cols]
    
    combined_df = pd.concat([existing_df, new_df], ignore_index=True)
    logger.info(f"Combined: {len(combined_df)} total samples")
    
    # Remove duplicates
    if 'claim_id' in combined_df.columns:
        before = len(combined_df)
        combined_df = combined_df.drop_duplicates(subset=['claim_id'], keep='first')
        if len(combined_df) < before:
            logger.info(f"Removed {before - len(combined_df)} duplicates")
    
    # Sort chronologically
    if 'claim_date' in combined_df.columns:
        combined_df['claim_date'] = pd.to_datetime(combined_df['claim_date'], errors='coerce')
        combined_df = combined_df.sort_values('claim_date', na_position='last')
        combined_df = combined_df.reset_index(drop=True)
        logger.info(f"Date range: {combined_df['claim_date'].min()} to {combined_df['claim_date'].max()}")
    
    # Create splits
    logger.info("\nCreating chronological splits...")
    n = len(combined_df)
    train_end = int(n * 0.7)
    val_end = int(n * 0.85)
    
    train_df = combined_df.iloc[:train_end].copy()
    val_df = combined_df.iloc[train_end:val_end].copy()
    test_df = combined_df.iloc[val_end:].copy()
    
    logger.info(f"Train: {len(train_df)} ({len(train_df)/n:.1%})")
    logger.info(f"Val:   {len(val_df)} ({len(val_df)/n:.1%})")
    logger.info(f"Test:  {len(test_df)} ({len(test_df)/n:.1%})")
    
    # Save
    combined_df.to_csv(existing_path, index=False)
    train_df.to_csv(data_dir / 'train.csv', index=False)
    val_df.to_csv(data_dir / 'val.csv', index=False)
    test_df.to_csv(data_dir / 'test.csv', index=False)
    
    logger.info(f"\n[SUCCESS] Data saved:")
    logger.info(f"  Main: {existing_path}")
    logger.info(f"  Train: {data_dir / 'train.csv'}")
    logger.info(f"  Val: {data_dir / 'val.csv'}")
    logger.info(f"  Test: {data_dir / 'test.csv'}")
    
    return combined_df

def main():
    """Main execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Phase 3 complete workflow")
    parser.add_argument('--expanded-data', type=str, 
                       default=str(data_dir / 'expanded_claims.csv'),
                       help='Path to expanded_claims.csv')
    parser.add_argument('--backup', action='store_true',
                       help='Create backup of existing data')
    
    args = parser.parse_args()
    
    expanded_path = Path(args.expanded_data)
    
    # Check if file exists
    if not expanded_path.exists():
        logger.error(f"File not found: {expanded_path}")
        logger.info(f"\nPlease place expanded_claims.csv in one of these locations:")
        logger.info(f"  1. {expanded_path}")
        logger.info(f"  2. {data_dir / 'expanded_claims.csv'}")
        logger.info(f"  3. Or specify path with --expanded-data")
        return
    
    # Load expanded data
    logger.info(f"Loading expanded data from {expanded_path}")
    expanded_df = pd.read_csv(expanded_path)
    logger.info(f"Loaded {len(expanded_df)} samples")
    
    # Step 1: Validate
    validation_results = validate_expanded_data(expanded_df)
    
    if validation_results['status'] == 'FAIL':
        logger.error("Validation failed - fix issues before integration")
        return
    
    if validation_results['status'] == 'REVIEW':
        logger.warning("Validation issues detected - review before proceeding")
        response = input("Continue anyway? (y/n): ")
        if response.lower() != 'y':
            return
    
    # Create backup
    existing_path = data_dir / 'processed_claims.csv'
    if args.backup and existing_path.exists():
        backup_path = data_dir / f'processed_claims_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
        pd.read_csv(existing_path).to_csv(backup_path, index=False)
        logger.info(f"Backup created: {backup_path}")
    
    # Step 2: Integrate
    combined_df = integrate_data(existing_path, expanded_df)
    
    # Summary
    logger.info("\n" + "="*80)
    logger.info("INTEGRATION SUMMARY")
    logger.info("="*80)
    logger.info(f"Total samples: {len(combined_df)}")
    if 'claimable' in combined_df.columns:
        label_dist = combined_df['claimable'].value_counts().to_dict()
        logger.info(f"Label distribution: {label_dist}")
        logger.info(f"Class balance: {label_dist.get(0, 0) / label_dist.get(1, 1):.2f}:1")
    
    logger.info("\n[SUCCESS] Phase 3 integration complete!")
    logger.info("\n[INFO] Next steps:")
    logger.info("  1. Run: python scripts/feature_audit.py")
    logger.info("  2. Run: python scripts/time_series_cv.py")
    logger.info("  3. Run: python scripts/train_98_percent_model.py")
    
    # Save summary
    summary = {
        'integration_date': datetime.now().isoformat(),
        'total_samples': int(len(combined_df)),
        'label_distribution': {int(k): int(v) for k, v in label_dist.items()} if 'claimable' in combined_df.columns else {},
        'validation_results': validation_results,
        'status': 'INTEGRATED'
    }
    
    summary_path = data_dir / 'phase3_integration_summary.json'
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2, default=str)
    logger.info(f"\nSummary saved: {summary_path}")

if __name__ == '__main__':
    main()

