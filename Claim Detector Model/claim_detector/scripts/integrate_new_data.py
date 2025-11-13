"""
Data Integration Script
Integrates newly collected data into existing dataset while preserving chronological order
"""

import pandas as pd
import numpy as np
from pathlib import Path
import sys
import logging
from typing import Tuple
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Get project root
project_root = script_dir.parent.parent

def load_existing_data() -> pd.DataFrame:
    """Load existing processed claims data"""
    data_path = project_root.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    
    if not data_path.exists():
        logger.warning(f"Existing data not found at {data_path}")
        return pd.DataFrame()
    
    df = pd.read_csv(data_path)
    logger.info(f"Loaded {len(df)} existing samples")
    return df

def integrate_data(existing_df: pd.DataFrame, new_df: pd.DataFrame) -> pd.DataFrame:
    """
    Integrate new data into existing dataset
    
    Args:
        existing_df: Existing processed claims
        new_df: Newly collected data
    
    Returns:
        Combined dataframe in chronological order
    """
    logger.info("="*80)
    logger.info("DATA INTEGRATION")
    logger.info("="*80)
    
    logger.info(f"\n[1/4] Preparing data...")
    logger.info(f"  Existing samples: {len(existing_df)}")
    logger.info(f"  New samples: {len(new_df)}")
    
    # Ensure both have same columns
    if len(existing_df) > 0:
        common_cols = set(existing_df.columns) & set(new_df.columns)
        missing_in_new = set(existing_df.columns) - set(new_df.columns)
        missing_in_existing = set(new_df.columns) - set(existing_df.columns)
        
        if missing_in_new:
            logger.warning(f"  Missing in new data: {', '.join(missing_in_new)}")
            for col in missing_in_new:
                new_df[col] = None
        
        if missing_in_existing:
            logger.warning(f"  Missing in existing: {', '.join(missing_in_existing)}")
            for col in missing_in_existing:
                existing_df[col] = None
        
        # Align columns
        all_cols = sorted(set(existing_df.columns) | set(new_df.columns))
        existing_df = existing_df[all_cols]
        new_df = new_df[all_cols]
    
    # Combine
    logger.info(f"\n[2/4] Combining datasets...")
    combined_df = pd.concat([existing_df, new_df], ignore_index=True)
    logger.info(f"  Combined samples: {len(combined_df)}")
    
    # Remove duplicates (if any)
    if 'claim_id' in combined_df.columns:
        before_dedup = len(combined_df)
        combined_df = combined_df.drop_duplicates(subset=['claim_id'], keep='first')
        after_dedup = len(combined_df)
        if before_dedup != after_dedup:
            logger.info(f"  Removed {before_dedup - after_dedup} duplicates")
    
    # Sort chronologically
    logger.info(f"\n[3/4] Sorting chronologically...")
    if 'claim_date' in combined_df.columns:
        combined_df['claim_date'] = pd.to_datetime(combined_df['claim_date'], errors='coerce')
        combined_df = combined_df.sort_values('claim_date', na_position='last')
        combined_df = combined_df.reset_index(drop=True)
        logger.info(f"  Date range: {combined_df['claim_date'].min()} to {combined_df['claim_date'].max()}")
    else:
        logger.warning("  No claim_date column - cannot sort chronologically")
    
    # Final statistics
    logger.info(f"\n[4/4] Final statistics...")
    logger.info(f"  Total samples: {len(combined_df)}")
    if 'claimable' in combined_df.columns:
        label_dist = combined_df['claimable'].value_counts().to_dict()
        logger.info(f"  Label distribution: {label_dist}")
        logger.info(f"  Class balance: {label_dist.get(0, 0) / label_dist.get(1, 1):.2f}:1")
    
    return combined_df

def create_splits(df: pd.DataFrame, train_pct: float = 0.7, val_pct: float = 0.15) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Create chronological train/val/test splits
    
    Args:
        df: Combined dataframe
        train_pct: Percentage for training
        val_pct: Percentage for validation
    
    Returns:
        (train_df, val_df, test_df)
    """
    logger.info("\n" + "="*80)
    logger.info("CREATING CHRONOLOGICAL SPLITS")
    logger.info("="*80)
    
    n = len(df)
    train_end = int(n * train_pct)
    val_end = int(n * (train_pct + val_pct))
    
    train_df = df.iloc[:train_end].copy()
    val_df = df.iloc[train_end:val_end].copy()
    test_df = df.iloc[val_end:].copy()
    
    logger.info(f"Train: {len(train_df)} samples ({len(train_df)/n:.1%})")
    logger.info(f"Val:   {len(val_df)} samples ({len(val_df)/n:.1%})")
    logger.info(f"Test:  {len(test_df)} samples ({len(test_df)/n:.1%})")
    
    if 'claimable' in df.columns:
        logger.info(f"\nTrain label dist: {train_df['claimable'].value_counts().to_dict()}")
        logger.info(f"Val label dist:   {val_df['claimable'].value_counts().to_dict()}")
        logger.info(f"Test label dist:  {test_df['claimable'].value_counts().to_dict()}")
    
    return train_df, val_df, test_df

def main():
    """Main execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Integrate new data into existing dataset")
    parser.add_argument('--new-data', type=str, required=True,
                       help='Path to new data CSV file')
    parser.add_argument('--output', type=str, default=None,
                       help='Path to save integrated data (default: processed_claims.csv)')
    parser.add_argument('--backup', action='store_true',
                       help='Create backup of existing data')
    parser.add_argument('--create-splits', action='store_true',
                       help='Create train/val/test splits')
    
    args = parser.parse_args()
    
    # Load existing data
    existing_df = load_existing_data()
    
    # Load new data
    logger.info(f"Loading new data from {args.new_data}")
    new_df = pd.read_csv(args.new_data)
    logger.info(f"Loaded {len(new_df)} new samples")
    
    # Create backup if requested
    if args.backup and len(existing_df) > 0:
        backup_path = project_root.parent / 'data' / 'ml-training' / f'processed_claims_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
        existing_df.to_csv(backup_path, index=False)
        logger.info(f"Backup created: {backup_path}")
    
    # Integrate
    combined_df = integrate_data(existing_df, new_df)
    
    # Save integrated data
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = project_root.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    combined_df.to_csv(output_path, index=False)
    logger.info(f"\n[SUCCESS] Integrated data saved to {output_path}")
    
    # Create splits if requested
    if args.create_splits:
        train_df, val_df, test_df = create_splits(combined_df)
        
        # Save splits
        data_dir = output_path.parent
        train_df.to_csv(data_dir / 'train.csv', index=False)
        val_df.to_csv(data_dir / 'val.csv', index=False)
        test_df.to_csv(data_dir / 'test.csv', index=False)
        
        logger.info(f"\n[SUCCESS] Splits saved:")
        logger.info(f"  Train: {data_dir / 'train.csv'}")
        logger.info(f"  Val:   {data_dir / 'val.csv'}")
        logger.info(f"  Test:  {data_dir / 'test.csv'}")
    
    logger.info("\n[SUCCESS] Data integration complete!")
    logger.info("\n[INFO] Next steps:")
    logger.info("  1. Run: python scripts/feature_audit.py")
    logger.info("  2. Run: python scripts/time_series_cv.py")
    logger.info("  3. Run: python scripts/train_98_percent_model.py")
    
    return combined_df

if __name__ == '__main__':
    combined_df = main()

