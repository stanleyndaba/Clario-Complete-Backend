#!/usr/bin/env python3
"""
Comprehensive EDA and Data Cleaning for FBA Claims Dataset
"""
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import logging
import warnings
from datetime import datetime
import re

# Configure logging and warnings
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
warnings.filterwarnings('ignore')

# Set style for plots
plt.style.use('default')
sns.set_palette("husl")

class FBAClaimsEDA:
    """Comprehensive EDA and data cleaning for FBA claims dataset"""
    
    def __init__(self, data_path='merged_fba_claims_dataset.csv'):
        self.data_path = data_path
        self.df = None
        self.df_cleaned = None
        self.analysis_results = {}
        
    def load_data(self):
        """Load the merged dataset"""
        logger.info(f"Loading data from {self.data_path}")
        
        try:
            self.df = pd.read_csv(self.data_path)
            logger.info(f"Data loaded successfully. Shape: {self.df.shape}")
            logger.info(f"Columns: {list(self.df.columns)}")
            return True
        except Exception as e:
            logger.error(f"Error loading data: {e}")
            return False
    
    def initial_data_overview(self):
        """Initial data overview and basic statistics"""
        logger.info("=== INITIAL DATA OVERVIEW ===")
        
        # Basic info
        logger.info(f"Dataset shape: {self.df.shape}")
        logger.info(f"Memory usage: {self.df.memory_usage(deep=True).sum() / 1024**2:.2f} MB")
        
        # Data types
        logger.info("\nData types:")
        logger.info(self.df.dtypes)
        
        # Missing values
        missing_data = self.df.isnull().sum()
        missing_percent = (missing_data / len(self.df)) * 100
        missing_summary = pd.DataFrame({
            'Missing_Count': missing_data,
            'Missing_Percent': missing_percent
        })
        logger.info("\nMissing values summary:")
        logger.info(missing_summary[missing_summary['Missing_Count'] > 0])
        
        # Duplicate check
        duplicates = self.df.duplicated().sum()
        logger.info(f"\nDuplicate rows: {duplicates}")
        
        # Store results
        self.analysis_results['initial_overview'] = {
            'shape': self.df.shape,
            'memory_mb': self.df.memory_usage(deep=True).sum() / 1024**2,
            'missing_summary': missing_summary,
            'duplicates': duplicates
        }
        
        return missing_summary
    
    def analyze_target_variable(self):
        """Analyze the target variable (claimable)"""
        logger.info("\n=== TARGET VARIABLE ANALYSIS ===")
        
        target_col = 'claimable'
        if target_col not in self.df.columns:
            logger.error(f"Target column '{target_col}' not found!")
            return None
        
        # Target distribution
        target_counts = self.df[target_col].value_counts()
        target_percent = self.df[target_col].value_counts(normalize=True) * 100
        
        logger.info(f"Target distribution:")
        logger.info(f"Claimable (1): {target_counts[1]} ({target_percent[1]:.2f}%)")
        logger.info(f"Non-claimable (0): {target_counts[0]} ({target_percent[0]:.2f}%)")
        
        # Check for class imbalance
        imbalance_ratio = target_counts[1] / target_counts[0]
        logger.info(f"Class imbalance ratio: {imbalance_ratio:.2f}:1")
        
        # Store results
        self.analysis_results['target_analysis'] = {
            'distribution': target_counts.to_dict(),
            'percentages': target_percent.to_dict(),
            'imbalance_ratio': imbalance_ratio
        }
        
        return target_counts
    
    def analyze_categorical_features(self):
        """Analyze categorical features"""
        logger.info("\n=== CATEGORICAL FEATURES ANALYSIS ===")
        
        categorical_cols = self.df.select_dtypes(include=['object', 'category']).columns
        logger.info(f"Categorical columns: {list(categorical_cols)}")
        
        categorical_analysis = {}
        
        for col in categorical_cols:
            if col in self.df.columns:
                unique_values = self.df[col].nunique()
                value_counts = self.df[col].value_counts()
                
                logger.info(f"\n{col}:")
                logger.info(f"  Unique values: {unique_values}")
                logger.info(f"  Top 5 values:")
                for val, count in value_counts.head().items():
                    logger.info(f"    {val}: {count}")
                
                categorical_analysis[col] = {
                    'unique_count': unique_values,
                    'value_counts': value_counts.to_dict(),
                    'missing_count': self.df[col].isnull().sum()
                }
        
        self.analysis_results['categorical_analysis'] = categorical_analysis
        return categorical_analysis
    
    def analyze_numerical_features(self):
        """Analyze numerical features"""
        logger.info("\n=== NUMERICAL FEATURES ANALYSIS ===")
        
        numerical_cols = self.df.select_dtypes(include=[np.number]).columns
        logger.info(f"Numerical columns: {list(numerical_cols)}")
        
        numerical_analysis = {}
        
        for col in numerical_cols:
            if col in self.df.columns:
                stats = self.df[col].describe()
                
                logger.info(f"\n{col}:")
                logger.info(f"  Mean: {stats['mean']:.4f}")
                logger.info(f"  Std: {stats['std']:.4f}")
                logger.info(f"  Min: {stats['min']:.4f}")
                logger.info(f"  Max: {stats['max']:.4f}")
                logger.info(f"  Missing: {self.df[col].isnull().sum()}")
                
                # Check for outliers using IQR method
                Q1 = stats['25%']
                Q3 = stats['75%']
                IQR = Q3 - Q1
                lower_bound = Q1 - 1.5 * IQR
                upper_bound = Q3 + 1.5 * IQR
                outliers = ((self.df[col] < lower_bound) | (self.df[col] > upper_bound)).sum()
                
                logger.info(f"  Outliers (IQR method): {outliers}")
                
                numerical_analysis[col] = {
                    'statistics': stats.to_dict(),
                    'missing_count': self.df[col].isnull().sum(),
                    'outliers_count': outliers,
                    'outlier_bounds': {'lower': lower_bound, 'upper': upper_bound}
                }
        
        self.analysis_results['numerical_analysis'] = numerical_analysis
        return numerical_analysis
    
    def analyze_text_features(self):
        """Analyze text features"""
        logger.info("\n=== TEXT FEATURES ANALYSIS ===")
        
        text_cols = ['text'] if 'text' in self.df.columns else []
        logger.info(f"Text columns: {text_cols}")
        
        text_analysis = {}
        
        for col in text_cols:
            if col in self.df.columns:
                # Text length statistics
                text_lengths = self.df[col].str.len()
                word_counts = self.df[col].str.split().str.len()
                
                logger.info(f"\n{col}:")
                logger.info(f"  Average text length: {text_lengths.mean():.2f} characters")
                logger.info(f"  Average word count: {word_counts.mean():.2f} words")
                logger.info(f"  Min text length: {text_lengths.min()} characters")
                logger.info(f"  Max text length: {text_lengths.max()} characters")
                
                # Check for empty or very short texts
                empty_texts = (text_lengths == 0).sum()
                short_texts = (text_lengths < 10).sum()
                
                logger.info(f"  Empty texts: {empty_texts}")
                logger.info(f"  Very short texts (<10 chars): {short_texts}")
                
                text_analysis[col] = {
                    'length_stats': text_lengths.describe().to_dict(),
                    'word_count_stats': word_counts.describe().to_dict(),
                    'empty_count': empty_texts,
                    'short_count': short_texts
                }
        
        self.analysis_results['text_analysis'] = text_analysis
        return text_analysis
    
    def check_data_quality_issues(self):
        """Check for data quality issues"""
        logger.info("\n=== DATA QUALITY ISSUES ===")
        
        issues = []
        
        # Check for inconsistent data types
        for col in self.df.columns:
            if col == 'amount' and not pd.api.types.is_numeric_dtype(self.df[col]):
                issues.append(f"Column 'amount' is not numeric")
            elif col == 'claimable' and not pd.api.types.is_numeric_dtype(self.df[col]):
                issues.append(f"Column 'claimable' is not numeric")
        
        # Check for invalid values
        if 'claimable' in self.df.columns:
            invalid_targets = ~self.df['claimable'].isin([0, 1])
            if invalid_targets.sum() > 0:
                issues.append(f"Invalid target values found: {invalid_targets.sum()}")
        
        if 'amount' in self.df.columns:
            negative_amounts = (self.df['amount'] < 0).sum()
            if negative_amounts > 0:
                issues.append(f"Negative amounts found: {negative_amounts}")
        
        # Check for unrealistic values
        if 'units' in self.df.columns:
            unrealistic_units = (self.df['units'] > 10000).sum()
            if unrealistic_units > 0:
                issues.append(f"Unrealistic unit counts (>10000): {unrealistic_units}")
        
        # Check date consistency
        if 'date' in self.df.columns:
            try:
                dates = pd.to_datetime(self.df['date'], errors='coerce')
                invalid_dates = dates.isna().sum()
                if invalid_dates > 0:
                    issues.append(f"Invalid dates found: {invalid_dates}")
                
                future_dates = (dates > pd.Timestamp.now()).sum()
                if future_dates > 0:
                    issues.append(f"Future dates found: {future_dates}")
            except:
                issues.append("Date column cannot be parsed")
        
        if issues:
            logger.warning("Data quality issues found:")
            for issue in issues:
                logger.warning(f"  - {issue}")
        else:
            logger.info("No major data quality issues found")
        
        self.analysis_results['data_quality_issues'] = issues
        return issues
    
    def create_visualizations(self, output_dir='eda_plots'):
        """Create EDA visualizations"""
        logger.info(f"\n=== CREATING VISUALIZATIONS ===")
        
        # Create output directory
        Path(output_dir).mkdir(exist_ok=True)
        
        # Set up the plotting style
        plt.rcParams['figure.figsize'] = (12, 8)
        
        # 1. Target variable distribution
        if 'claimable' in self.df.columns:
            plt.figure(figsize=(10, 6))
            target_counts = self.df['claimable'].value_counts()
            plt.pie(target_counts.values, labels=['Non-claimable', 'Claimable'], autopct='%1.1f%%')
            plt.title('Distribution of Target Variable (Claimable)')
            plt.savefig(f'{output_dir}/target_distribution.png', dpi=300, bbox_inches='tight')
            plt.close()
        
        # 2. Amount distribution by claimable status
        if 'amount' in self.df.columns and 'claimable' in self.df.columns:
            plt.figure(figsize=(12, 6))
            plt.subplot(1, 2, 1)
            self.df[self.df['claimable'] == 0]['amount'].hist(bins=50, alpha=0.7, label='Non-claimable')
            plt.title('Amount Distribution - Non-claimable')
            plt.xlabel('Amount ($)')
            plt.ylabel('Frequency')
            
            plt.subplot(1, 2, 2)
            self.df[self.df['claimable'] == 1]['amount'].hist(bins=50, alpha=0.7, label='Claimable')
            plt.title('Amount Distribution - Claimable')
            plt.xlabel('Amount ($)')
            plt.ylabel('Frequency')
            
            plt.tight_layout()
            plt.savefig(f'{output_dir}/amount_distribution.png', dpi=300, bbox_inches='tight')
            plt.close()
        
        # 3. Marketplace distribution
        if 'marketplace' in self.df.columns:
            plt.figure(figsize=(10, 6))
            marketplace_counts = self.df['marketplace'].value_counts()
            plt.bar(marketplace_counts.index, marketplace_counts.values)
            plt.title('Distribution by Marketplace')
            plt.xlabel('Marketplace')
            plt.ylabel('Count')
            plt.xticks(rotation=45)
            plt.tight_layout()
            plt.savefig(f'{output_dir}/marketplace_distribution.png', dpi=300, bbox_inches='tight')
            plt.close()
        
        # 4. Claim type distribution
        if 'claim_type' in self.df.columns:
            plt.figure(figsize=(12, 6))
            claim_type_counts = self.df['claim_type'].value_counts()
            plt.bar(range(len(claim_type_counts)), claim_type_counts.values)
            plt.title('Distribution by Claim Type')
            plt.xlabel('Claim Type')
            plt.ylabel('Count')
            plt.xticks(range(len(claim_type_counts)), claim_type_counts.index, rotation=45, ha='right')
            plt.tight_layout()
            plt.savefig(f'{output_dir}/claim_type_distribution.png', dpi=300, bbox_inches='tight')
            plt.close()
        
        # 5. Correlation matrix for numerical features
        numerical_cols = self.df.select_dtypes(include=[np.number]).columns
        if len(numerical_cols) > 1:
            plt.figure(figsize=(10, 8))
            correlation_matrix = self.df[numerical_cols].corr()
            sns.heatmap(correlation_matrix, annot=True, cmap='coolwarm', center=0)
            plt.title('Correlation Matrix of Numerical Features')
            plt.tight_layout()
            plt.savefig(f'{output_dir}/correlation_matrix.png', dpi=300, bbox_inches='tight')
            plt.close()
        
        logger.info(f"Visualizations saved to {output_dir}/")
    
    def clean_data(self):
        """Clean the dataset based on EDA findings"""
        logger.info("\n=== DATA CLEANING ===")
        
        # Create a copy for cleaning
        self.df_cleaned = self.df.copy()
        
        # 1. Handle missing values
        logger.info("Handling missing values...")
        
        # For categorical columns, fill with mode or 'Unknown'
        categorical_cols = self.df_cleaned.select_dtypes(include=['object', 'category']).columns
        for col in categorical_cols:
            if self.df_cleaned[col].isnull().sum() > 0:
                mode_val = self.df_cleaned[col].mode()[0] if len(self.df_cleaned[col].mode()) > 0 else 'Unknown'
                self.df_cleaned[col] = self.df_cleaned[col].fillna(mode_val)
                logger.info(f"  Filled missing values in {col} with '{mode_val}'")
        
        # For numerical columns, fill with median
        numerical_cols = self.df_cleaned.select_dtypes(include=[np.number]).columns
        for col in numerical_cols:
            if self.df_cleaned[col].isnull().sum() > 0:
                median_val = self.df_cleaned[col].median()
                self.df_cleaned[col] = self.df_cleaned[col].fillna(median_val)
                logger.info(f"  Filled missing values in {col} with median: {median_val:.2f}")
        
        # 2. Handle outliers
        logger.info("Handling outliers...")
        
        if 'amount' in self.df_cleaned.columns:
            Q1 = self.df_cleaned['amount'].quantile(0.25)
            Q3 = self.df_cleaned['amount'].quantile(0.75)
            IQR = Q3 - Q1
            lower_bound = Q1 - 1.5 * IQR
            upper_bound = Q3 + 1.5 * IQR
            
            outliers_mask = (self.df_cleaned['amount'] < lower_bound) | (self.df_cleaned['amount'] > upper_bound)
            outlier_count = outliers_mask.sum()
            
            if outlier_count > 0:
                # Cap outliers instead of removing them
                self.df_cleaned.loc[self.df_cleaned['amount'] < lower_bound, 'amount'] = lower_bound
                self.df_cleaned.loc[self.df_cleaned['amount'] > upper_bound, 'amount'] = upper_bound
                logger.info(f"  Capped {outlier_count} outliers in 'amount' column")
        
        # 3. Data type conversions
        logger.info("Converting data types...")
        
        # Ensure claimable is integer
        if 'claimable' in self.df_cleaned.columns:
            self.df_cleaned['claimable'] = self.df_cleaned['claimable'].astype(int)
            logger.info("  Converted 'claimable' to integer")
        
        # Ensure amount is float
        if 'amount' in self.df_cleaned.columns:
            self.df_cleaned['amount'] = pd.to_numeric(self.df_cleaned['amount'], errors='coerce')
            logger.info("  Converted 'amount' to numeric")
        
        # Convert date to datetime
        if 'date' in self.df_cleaned.columns:
            self.df_cleaned['date'] = pd.to_datetime(self.df_cleaned['date'], errors='coerce')
            logger.info("  Converted 'date' to datetime")
        
        # 4. Remove duplicates
        initial_rows = len(self.df_cleaned)
        self.df_cleaned = self.df_cleaned.drop_duplicates()
        final_rows = len(self.df_cleaned)
        removed_duplicates = initial_rows - final_rows
        
        if removed_duplicates > 0:
            logger.info(f"  Removed {removed_duplicates} duplicate rows")
        
        # 5. Validate data integrity
        logger.info("Validating data integrity...")
        
        # Check for remaining missing values
        remaining_missing = self.df_cleaned.isnull().sum().sum()
        if remaining_missing == 0:
            logger.info("  No missing values remaining")
        else:
            logger.warning(f"  {remaining_missing} missing values still present")
        
        # Check target variable distribution
        if 'claimable' in self.df_cleaned.columns:
            target_dist = self.df_cleaned['claimable'].value_counts()
            logger.info(f"  Final target distribution: {target_dist.to_dict()}")
        
        logger.info(f"Data cleaning completed. Final shape: {self.df_cleaned.shape}")
        
        return self.df_cleaned
    
    def save_cleaned_data(self, output_path='cleaned_fba_claims_dataset.csv'):
        """Save the cleaned dataset"""
        logger.info(f"Saving cleaned dataset to {output_path}")
        
        if self.df_cleaned is not None:
            self.df_cleaned.to_csv(output_path, index=False)
            
            # Also save to the data directory for training
            training_data_path = Path('data/cleaned_fba_claims_dataset.csv')
            self.df_cleaned.to_csv(training_data_path, index=False)
            
            logger.info(f"Cleaned dataset saved to {output_path} and {training_data_path}")
            return output_path
        else:
            logger.error("No cleaned data available. Run clean_data() first.")
            return None
    
    def generate_eda_report(self, output_path='eda_report.txt'):
        """Generate a comprehensive EDA report"""
        logger.info(f"Generating EDA report to {output_path}")
        
        with open(output_path, 'w') as f:
            f.write("FBA CLAIMS DATASET - EXPLORATORY DATA ANALYSIS REPORT\n")
            f.write("=" * 60 + "\n\n")
            f.write(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            
            # Dataset overview
            f.write("1. DATASET OVERVIEW\n")
            f.write("-" * 30 + "\n")
            f.write(f"Shape: {self.df.shape}\n")
            f.write(f"Memory usage: {self.analysis_results.get('initial_overview', {}).get('memory_mb', 'N/A'):.2f} MB\n")
            f.write(f"Columns: {list(self.df.columns)}\n\n")
            
            # Target analysis
            if 'target_analysis' in self.analysis_results:
                f.write("2. TARGET VARIABLE ANALYSIS\n")
                f.write("-" * 30 + "\n")
                target_analysis = self.analysis_results['target_analysis']
                f.write(f"Distribution: {target_analysis['distribution']}\n")
                f.write(f"Class imbalance ratio: {target_analysis['imbalance_ratio']:.2f}:1\n\n")
            
            # Data quality issues
            if 'data_quality_issues' in self.analysis_results:
                f.write("3. DATA QUALITY ISSUES\n")
                f.write("-" * 30 + "\n")
                issues = self.analysis_results['data_quality_issues']
                if issues:
                    for issue in issues:
                        f.write(f"- {issue}\n")
                else:
                    f.write("No major issues found\n")
                f.write("\n")
            
            # Recommendations
            f.write("4. RECOMMENDATIONS FOR MODELING\n")
            f.write("-" * 30 + "\n")
            f.write("- Handle class imbalance using techniques like SMOTE or class weights\n")
            f.write("- Consider feature engineering for text data (TF-IDF, embeddings)\n")
            f.write("- Validate data quality before training\n")
            f.write("- Monitor for data drift in production\n\n")
            
            # Summary
            f.write("5. SUMMARY\n")
            f.write("-" * 30 + "\n")
            f.write("The dataset has been analyzed and cleaned for training.\n")
            f.write("Key preprocessing steps have been applied to ensure data quality.\n")
            f.write("The cleaned dataset is ready for feature engineering and model training.\n")
        
        logger.info(f"EDA report saved to {output_path}")
    
    def run_complete_eda(self):
        """Run the complete EDA pipeline"""
        logger.info("Starting comprehensive EDA and data cleaning pipeline...")
        
        # Load data
        if not self.load_data():
            return False
        
        # Run EDA
        self.initial_data_overview()
        self.analyze_target_variable()
        self.analyze_categorical_features()
        self.analyze_numerical_features()
        self.analyze_text_features()
        self.check_data_quality_issues()
        
        # Create visualizations
        self.create_visualizations()
        
        # Clean data
        self.clean_data()
        
        # Save cleaned data
        cleaned_path = self.save_cleaned_data()
        
        # Generate report
        self.generate_eda_report()
        
        logger.info("EDA and data cleaning pipeline completed successfully!")
        logger.info(f"Cleaned dataset saved to: {cleaned_path}")
        
        return True

def main():
    """Main function to run EDA"""
    eda = FBAClaimsEDA()
    success = eda.run_complete_eda()
    
    if success:
        print("\n✅ EDA and data cleaning completed successfully!")
        print("📊 Check the 'eda_plots/' directory for visualizations")
        print("📝 Check 'eda_report.txt' for the comprehensive report")
        print("🧹 Cleaned dataset saved and ready for training!")
    else:
        print("\n❌ EDA pipeline failed. Check the logs above.")

if __name__ == "__main__":
    main()
