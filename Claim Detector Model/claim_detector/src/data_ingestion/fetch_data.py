"""
Data ingestion module for Amazon FBA reimbursement claim detection
"""
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import logging
from pathlib import Path
import json

from ..config import RAW_DATA_DIR, SYNTHETIC_DATA_PATH

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DataIngestion:
    """Data ingestion class for fetching and preparing FBA reimbursement data"""
    
    def __init__(self):
        self.raw_data_path = RAW_DATA_DIR
        self.synthetic_data_path = SYNTHETIC_DATA_PATH
        
    def generate_synthetic_data(self, n_samples: int = 10000) -> pd.DataFrame:
        """
        Generate synthetic FBA reimbursement data for development and testing
        
        Args:
            n_samples: Number of samples to generate
            
        Returns:
            DataFrame with synthetic FBA reimbursement data
        """
        logger.info(f"Generating {n_samples} synthetic FBA reimbursement samples")
        
        np.random.seed(42)
        
        # Define possible values for categorical features
        categories = ['Electronics', 'Books', 'Clothing', 'Home & Garden', 'Sports', 'Toys']
        subcategories = ['Smartphones', 'Laptops', 'Fiction', 'Non-fiction', 'Men', 'Women', 'Kitchen', 'Garden', 'Fitness', 'Outdoor']
        reason_codes = ['DAMAGED', 'LOST', 'DESTROYED', 'EXPIRED', 'RETURNED', 'OVERAGE']
        marketplaces = ['US', 'CA', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP']
        fulfillment_centers = ['FBA1', 'FBA2', 'FBA3', 'FBA4', 'FBA5']
        
        # Generate synthetic data
        data = {
            'claim_id': [f'CLAIM_{i:06d}' for i in range(n_samples)],
            'seller_id': [f'SELLER_{np.random.randint(1000, 9999)}' for _ in range(n_samples)],
            'order_id': [f'ORDER_{np.random.randint(100000, 999999)}' for _ in range(n_samples)],
            'category': np.random.choice(categories, n_samples),
            'subcategory': np.random.choice(subcategories, n_samples),
            'reason_code': np.random.choice(reason_codes, n_samples),
            'marketplace': np.random.choice(marketplaces, n_samples),
            'fulfillment_center': np.random.choice(fulfillment_centers, n_samples),
            'amount': np.random.exponential(50, n_samples).round(2),
            'quantity': np.random.poisson(3, n_samples) + 1,
            'order_value': np.random.exponential(200, n_samples).round(2),
            'shipping_cost': np.random.exponential(10, n_samples).round(2),
            'days_since_order': np.random.poisson(30, n_samples),
            'days_since_delivery': np.random.poisson(25, n_samples),
            'description': [f"Item {i} description" for i in range(n_samples)],
            'reason': [f"Reason for claim {i}" for i in range(n_samples)],
            'notes': [f"Additional notes for claim {i}" for i in range(n_samples)],
            'claim_date': [
                datetime.now() - timedelta(days=np.random.randint(1, 365))
                for _ in range(n_samples)
            ]
        }
        
        # Create DataFrame
        df = pd.DataFrame(data)
        
        # Generate target variable (claimable or not)
        # More complex logic based on features
        claimable_prob = (
            (df['amount'] > 20).astype(int) * 0.3 +
            (df['days_since_order'] < 60).astype(int) * 0.2 +
            (df['reason_code'].isin(['DAMAGED', 'LOST'])).astype(int) * 0.3 +
            (df['marketplace'].isin(['US', 'CA'])).astype(int) * 0.1 +
            np.random.normal(0, 0.1, n_samples)
        )
        
        df['claimable'] = (claimable_prob > 0.5).astype(int)
        
        # Add some noise and edge cases
        df.loc[df['amount'] > 1000, 'claimable'] = 1  # High value items
        df.loc[df['days_since_order'] > 365, 'claimable'] = 0  # Too old
        
        logger.info(f"Generated synthetic data with {df['claimable'].sum()} claimable samples")
        
        return df
    
    def load_existing_data(self, file_path: str) -> pd.DataFrame:
        """
        Load existing data from file
        
        Args:
            file_path: Path to the data file
            
        Returns:
            DataFrame with loaded data
        """
        logger.info(f"Loading data from {file_path}")
        
        if file_path.endswith('.csv'):
            df = pd.read_csv(file_path)
        elif file_path.endswith('.json'):
            df = pd.read_json(file_path)
        elif file_path.endswith('.parquet'):
            df = pd.read_parquet(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")
        
        logger.info(f"Loaded {len(df)} samples from {file_path}")
        return df
    
    def fetch_from_api(self, api_endpoint: str, params: Dict = None) -> pd.DataFrame:
        """
        Fetch data from API endpoint
        
        Args:
            api_endpoint: API endpoint URL
            params: Query parameters
            
        Returns:
            DataFrame with fetched data
        """
        import requests
        
        logger.info(f"Fetching data from {api_endpoint}")
        
        try:
            response = requests.get(api_endpoint, params=params)
            response.raise_for_status()
            
            data = response.json()
            df = pd.DataFrame(data)
            
            logger.info(f"Fetched {len(df)} samples from API")
            return df
            
        except Exception as e:
            logger.error(f"Error fetching data from API: {e}")
            raise
    
    def validate_data(self, df: pd.DataFrame) -> Tuple[bool, List[str]]:
        """
        Validate data quality and structure
        
        Args:
            df: DataFrame to validate
            
        Returns:
            Tuple of (is_valid, list_of_issues)
        """
        issues = []
        
        # Check required columns
        required_columns = [
            'claim_id', 'seller_id', 'amount', 'reason_code', 
            'marketplace', 'claimable'
        ]
        
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            issues.append(f"Missing required columns: {missing_columns}")
        
        # Check data types
        if 'amount' in df.columns and not pd.api.types.is_numeric_dtype(df['amount']):
            issues.append("Amount column is not numeric")
        
        if 'claimable' in df.columns and not pd.api.types.is_numeric_dtype(df['claimable']):
            issues.append("Claimable column is not numeric")
        
        # Check for missing values in critical columns
        critical_columns = ['claim_id', 'amount', 'claimable']
        for col in critical_columns:
            if col in df.columns and df[col].isnull().sum() > 0:
                issues.append(f"Missing values in {col}")
        
        # Check for duplicates
        if 'claim_id' in df.columns and df['claim_id'].duplicated().sum() > 0:
            issues.append("Duplicate claim IDs found")
        
        # Check value ranges
        if 'amount' in df.columns:
            if (df['amount'] < 0).sum() > 0:
                issues.append("Negative amounts found")
            if (df['amount'] > 10000).sum() > 0:
                issues.append("Unusually high amounts found")
        
        is_valid = len(issues) == 0
        
        if not is_valid:
            logger.warning(f"Data validation issues found: {issues}")
        else:
            logger.info("Data validation passed")
        
        return is_valid, issues
    
    def prepare_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Prepare data for modeling
        
        Args:
            df: Raw DataFrame
            
        Returns:
            Prepared DataFrame
        """
        logger.info("Preparing data for modeling")
        
        # Create a copy to avoid modifying original
        df_prepared = df.copy()
        
        # Convert date columns to datetime
        date_columns = ['claim_date']
        for col in date_columns:
            if col in df_prepared.columns:
                df_prepared[col] = pd.to_datetime(df_prepared[col], errors='coerce')
        
        # Fill missing values
        numeric_columns = df_prepared.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if df_prepared[col].isnull().sum() > 0:
                df_prepared[col] = df_prepared[col].fillna(df_prepared[col].median())
        
        categorical_columns = df_prepared.select_dtypes(include=['object']).columns
        for col in categorical_columns:
            if df_prepared[col].isnull().sum() > 0:
                df_prepared[col] = df_prepared[col].fillna('UNKNOWN')
        
        # Ensure claimable is binary
        if 'claimable' in df_prepared.columns:
            df_prepared['claimable'] = df_prepared['claimable'].astype(int)
        
        logger.info(f"Data preparation completed. Shape: {df_prepared.shape}")
        
        return df_prepared
    
    def save_data(self, df: pd.DataFrame, file_path: str, format: str = 'csv'):
        """
        Save data to file
        
        Args:
            df: DataFrame to save
            file_path: Path to save file
            format: File format ('csv', 'json', 'parquet')
        """
        logger.info(f"Saving data to {file_path}")
        
        if format == 'csv':
            df.to_csv(file_path, index=False)
        elif format == 'json':
            df.to_json(file_path, orient='records', indent=2)
        elif format == 'parquet':
            df.to_parquet(file_path, index=False)
        else:
            raise ValueError(f"Unsupported format: {format}")
        
        logger.info(f"Data saved successfully to {file_path}")
    
    def get_data_summary(self, df: pd.DataFrame) -> Dict:
        """
        Get summary statistics for the dataset
        
        Args:
            df: DataFrame to summarize
            
        Returns:
            Dictionary with summary statistics
        """
        summary = {
            'total_samples': len(df),
            'claimable_samples': df['claimable'].sum() if 'claimable' in df.columns else 0,
            'claimable_ratio': df['claimable'].mean() if 'claimable' in df.columns else 0,
            'columns': list(df.columns),
            'missing_values': df.isnull().sum().to_dict(),
            'numeric_columns': list(df.select_dtypes(include=[np.number]).columns),
            'categorical_columns': list(df.select_dtypes(include=['object']).columns)
        }
        
        if 'amount' in df.columns:
            summary['amount_stats'] = {
                'mean': df['amount'].mean(),
                'median': df['amount'].median(),
                'std': df['amount'].std(),
                'min': df['amount'].min(),
                'max': df['amount'].max()
            }
        
        return summary

def main():
    """Main function for data ingestion"""
    ingestion = DataIngestion()
    
    # Generate synthetic data if it doesn't exist
    if not SYNTHETIC_DATA_PATH.exists():
        logger.info("Generating synthetic data...")
        synthetic_data = ingestion.generate_synthetic_data(n_samples=10000)
        
        # Validate the data
        is_valid, issues = ingestion.validate_data(synthetic_data)
        
        if is_valid:
            # Prepare and save the data
            prepared_data = ingestion.prepare_data(synthetic_data)
            ingestion.save_data(prepared_data, SYNTHETIC_DATA_PATH)
            
            # Print summary
            summary = ingestion.get_data_summary(prepared_data)
            logger.info(f"Data summary: {summary}")
        else:
            logger.error(f"Data validation failed: {issues}")
    else:
        logger.info("Synthetic data already exists")

if __name__ == "__main__":
    main() 