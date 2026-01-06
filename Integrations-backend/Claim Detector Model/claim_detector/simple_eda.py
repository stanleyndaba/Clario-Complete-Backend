#!/usr/bin/env python3
"""
Simple EDA and Data Cleaning for FBA Claims Dataset (No plotting dependencies)
"""
import pandas as pd
import numpy as np
from pathlib import Path
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def run_simple_eda():
    """Run simple EDA without plotting dependencies"""
    logger.info("🚀 Starting Simple EDA for FBA Claims Dataset...")
    
    # Load the merged dataset
    try:
        df = pd.read_csv('../merged_fba_claims_dataset.csv')
        logger.info(f"✅ Data loaded successfully! Shape: {df.shape}")
    except Exception as e:
        logger.error(f"❌ Error loading data: {e}")
        return False
    
    # 1. BASIC OVERVIEW
    logger.info("\n" + "="*50)
    logger.info("📊 BASIC DATASET OVERVIEW")
    logger.info("="*50)
    
    logger.info(f"Dataset shape: {df.shape}")
    logger.info(f"Memory usage: {df.memory_usage(deep=True).sum() / 1024**2:.2f} MB")
    logger.info(f"Columns: {list(df.columns)}")
    
    # 2. MISSING VALUES ANALYSIS
    logger.info("\n" + "="*50)
    logger.info("🔍 MISSING VALUES ANALYSIS")
    logger.info("="*50)
    
    missing_data = df.isnull().sum()
    missing_percent = (missing_data / len(df)) * 100
    missing_summary = pd.DataFrame({
        'Missing_Count': missing_data,
        'Missing_Percent': missing_percent
    })
    
    missing_issues = missing_summary[missing_summary['Missing_Count'] > 0]
    if len(missing_issues) > 0:
        logger.warning("Missing values found:")
        for col, row in missing_issues.iterrows():
            logger.warning(f"  {col}: {row['Missing_Count']} ({row['Missing_Percent']:.2f}%)")
    else:
        logger.info("✅ No missing values found!")
    
    # 3. TARGET VARIABLE ANALYSIS
    logger.info("\n" + "="*50)
    logger.info("🎯 TARGET VARIABLE ANALYSIS")
    logger.info("="*50)
    
    if 'claimable' in df.columns:
        target_counts = df['claimable'].value_counts()
        target_percent = df['claimable'].value_counts(normalize=True) * 100
        
        logger.info(f"Target distribution:")
        logger.info(f"  Claimable (1): {target_counts[1]} ({target_percent[1]:.2f}%)")
        logger.info(f"  Non-claimable (0): {target_counts[0]} ({target_percent[0]:.2f}%)")
        
        # Check for class imbalance
        imbalance_ratio = target_counts[1] / target_counts[0]
        logger.info(f"Class imbalance ratio: {imbalance_ratio:.2f}:1")
        
        if imbalance_ratio > 2:
            logger.warning("⚠️  Significant class imbalance detected!")
        else:
            logger.info("✅ Balanced dataset")
    else:
        logger.error("❌ Target column 'claimable' not found!")
    
    # 4. CATEGORICAL FEATURES ANALYSIS
    logger.info("\n" + "="*50)
    logger.info("📝 CATEGORICAL FEATURES ANALYSIS")
    logger.info("="*50)
    
    categorical_cols = df.select_dtypes(include=['object', 'category']).columns
    logger.info(f"Categorical columns: {list(categorical_cols)}")
    
    for col in categorical_cols:
        if col in df.columns:
            unique_values = df[col].nunique()
            value_counts = df[col].value_counts()
            
            logger.info(f"\n{col}:")
            logger.info(f"  Unique values: {unique_values}")
            logger.info(f"  Top 5 values:")
            for val, count in value_counts.head().items():
                logger.info(f"    {val}: {count}")
    
    # 5. NUMERICAL FEATURES ANALYSIS
    logger.info("\n" + "="*50)
    logger.info("🔢 NUMERICAL FEATURES ANALYSIS")
    logger.info("="*50)
    
    numerical_cols = df.select_dtypes(include=[np.number]).columns
    logger.info(f"Numerical columns: {list(numerical_cols)}")
    
    for col in numerical_cols:
        if col in df.columns:
            stats = df[col].describe()
            
            logger.info(f"\n{col}:")
            logger.info(f"  Mean: {stats['mean']:.4f}")
            logger.info(f"  Std: {stats['std']:.4f}")
            logger.info(f"  Min: {stats['min']:.4f}")
            logger.info(f"  Max: {stats['max']:.4f}")
            logger.info(f"  Missing: {df[col].isnull().sum()}")
            
            # Check for outliers using IQR method
            Q1 = stats['25%']
            Q3 = stats['75%']
            IQR = Q3 - Q1
            lower_bound = Q1 - 1.5 * IQR
            upper_bound = Q3 + 1.5 * IQR
            outliers = ((df[col] < lower_bound) | (df[col] > upper_bound)).sum()
            
            logger.info(f"  Outliers (IQR method): {outliers}")
            
            if outliers > 0:
                logger.warning(f"  ⚠️  {outliers} outliers detected in {col}")
    
    # 6. DATA QUALITY ISSUES
    logger.info("\n" + "="*50)
    logger.info("⚠️  DATA QUALITY ISSUES")
    logger.info("="*50)
    
    issues = []
    
    # Check for inconsistent data types
    if 'amount' in df.columns and not pd.api.types.is_numeric_dtype(df['amount']):
        issues.append("Column 'amount' is not numeric")
    if 'claimable' in df.columns and not pd.api.types.is_numeric_dtype(df['claimable']):
        issues.append("Column 'claimable' is not numeric")
    
    # Check for invalid values
    if 'claimable' in df.columns:
        invalid_targets = ~df['claimable'].isin([0, 1])
        if invalid_targets.sum() > 0:
            issues.append(f"Invalid target values found: {invalid_targets.sum()}")
    
    if 'amount' in df.columns:
        negative_amounts = (df['amount'] < 0).sum()
        if negative_amounts > 0:
            issues.append(f"Negative amounts found: {negative_amounts}")
    
    # Check for duplicates
    duplicates = df.duplicated().sum()
    if duplicates > 0:
        issues.append(f"Duplicate rows found: {duplicates}")
    
    if issues:
        logger.warning("Data quality issues found:")
        for issue in issues:
            logger.warning(f"  - {issue}")
    else:
        logger.info("✅ No major data quality issues found")
    
    # 7. DATA CLEANING
    logger.info("\n" + "="*50)
    logger.info("🧹 DATA CLEANING")
    logger.info("="*50)
    
    df_cleaned = df.copy()
    
    # Handle missing values
    logger.info("Handling missing values...")
    
    # For categorical columns, fill with mode or 'Unknown'
    for col in categorical_cols:
        if df_cleaned[col].isnull().sum() > 0:
            mode_val = df_cleaned[col].mode()[0] if len(df_cleaned[col].mode()) > 0 else 'Unknown'
            df_cleaned[col] = df_cleaned[col].fillna(mode_val)
            logger.info(f"  Filled missing values in {col} with '{mode_val}'")
    
    # For numerical columns, fill with median
    for col in numerical_cols:
        if df_cleaned[col].isnull().sum() > 0:
            median_val = df_cleaned[col].median()
            df_cleaned[col] = df_cleaned[col].fillna(median_val)
            logger.info(f"  Filled missing values in {col} with median: {median_val:.2f}")
    
    # Handle outliers (cap them)
    if 'amount' in df_cleaned.columns:
        Q1 = df_cleaned['amount'].quantile(0.25)
        Q3 = df_cleaned['amount'].quantile(0.75)
        IQR = Q3 - Q1
        lower_bound = Q1 - 1.5 * IQR
        upper_bound = Q3 + 1.5 * IQR
        
        outliers_mask = (df_cleaned['amount'] < lower_bound) | (df_cleaned['amount'] > upper_bound)
        outlier_count = outliers_mask.sum()
        
        if outlier_count > 0:
            df_cleaned.loc[df_cleaned['amount'] < lower_bound, 'amount'] = lower_bound
            df_cleaned.loc[df_cleaned['amount'] > upper_bound, 'amount'] = upper_bound
            logger.info(f"  Capped {outlier_count} outliers in 'amount' column")
    
    # Data type conversions
    if 'claimable' in df_cleaned.columns:
        df_cleaned['claimable'] = df_cleaned['claimable'].astype(int)
        logger.info("  Converted 'claimable' to integer")
    
    if 'amount' in df_cleaned.columns:
        df_cleaned['amount'] = pd.to_numeric(df_cleaned['amount'], errors='coerce')
        logger.info("  Converted 'amount' to numeric")
    
    # Remove duplicates
    initial_rows = len(df_cleaned)
    df_cleaned = df_cleaned.drop_duplicates()
    final_rows = len(df_cleaned)
    removed_duplicates = initial_rows - final_rows
    
    if removed_duplicates > 0:
        logger.info(f"  Removed {removed_duplicates} duplicate rows")
    
    # 8. SAVE CLEANED DATA
    logger.info("\n" + "="*50)
    logger.info("💾 SAVING CLEANED DATA")
    logger.info("="*50)
    
    # Save cleaned dataset
    cleaned_path = 'data/cleaned_fba_claims_dataset.csv'
    Path('data').mkdir(exist_ok=True)
    df_cleaned.to_csv(cleaned_path, index=False)
    
    logger.info(f"✅ Cleaned dataset saved to: {cleaned_path}")
    logger.info(f"Final shape: {df_cleaned.shape}")
    
    # 9. SUMMARY REPORT
    logger.info("\n" + "="*50)
    logger.info("📋 SUMMARY REPORT")
    logger.info("="*50)
    
    summary = {
        'Original_shape': df.shape,
        'Cleaned_shape': df_cleaned.shape,
        'Missing_values_handled': missing_data.sum(),
        'Outliers_capped': outlier_count if 'amount' in df.columns else 0,
        'Duplicates_removed': removed_duplicates,
        'Target_distribution': target_counts.to_dict() if 'claimable' in df.columns else {},
        'Class_imbalance_ratio': imbalance_ratio if 'claimable' in df.columns else 0
    }
    
    for key, value in summary.items():
        logger.info(f"{key}: {value}")
    
    # 10. RECOMMENDATIONS
    logger.info("\n" + "="*50)
    logger.info("💡 RECOMMENDATIONS FOR MODELING")
    logger.info("="*50)
    
    if summary.get('Class_imbalance_ratio', 0) > 2:
        logger.info("  - Use class weights or SMOTE to handle class imbalance")
    
    if 'text' in df.columns:
        logger.info("  - Consider text feature engineering (TF-IDF, embeddings)")
    
    logger.info("  - Validate data quality before training")
    logger.info("  - Monitor for data drift in production")
    
    logger.info("\n🎉 EDA and data cleaning completed successfully!")
    logger.info("🚀 Your dataset is now ready for model training!")
    
    return True

if __name__ == "__main__":
    run_simple_eda()

