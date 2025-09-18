"""
Behavioral feature engineering for FBA reimbursement claim detection
"""
import pandas as pd
import numpy as np
from typing import List, Dict, Tuple
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class BehavioralFeatureEngineer:
    """Engineer behavioral features from FBA reimbursement data"""
    
    def __init__(self, windows: List[int] = None, aggregations: List[str] = None):
        """
        Initialize behavioral feature engineer
        
        Args:
            windows: List of time windows in days for feature aggregation
            aggregations: List of aggregation functions to apply
        """
        self.windows = windows or [7, 14, 30, 90]
        self.aggregations = aggregations or ['mean', 'std', 'min', 'max', 'count']
        
    def engineer_seller_behavior(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer seller-specific behavioral features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with behavioral features added
        """
        logger.info("Engineering seller behavioral features")
        
        df_features = df.copy()
        
        # Sort by seller and date
        df_features = df_features.sort_values(['seller_id', 'claim_date'])
        
        # Seller claim frequency features
        seller_stats = df_features.groupby('seller_id').agg({
            'claim_id': 'count',
            'amount': ['mean', 'std', 'sum'],
            'claimable': 'mean'
        }).reset_index()
        
        seller_stats.columns = [
            'seller_id', 'total_claims', 'avg_amount', 'std_amount', 
            'total_amount', 'claimable_rate'
        ]
        
        # Merge back to original dataframe
        df_features = df_features.merge(seller_stats, on='seller_id', how='left')
        
        # Rolling window features for each seller
        for window in self.windows:
            # Amount rolling features
            df_features[f'amount_rolling_mean_{window}d'] = (
                df_features.groupby('seller_id')['amount']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
            
            df_features[f'amount_rolling_std_{window}d'] = (
                df_features.groupby('seller_id')['amount']
                .rolling(window=window, min_periods=1)
                .std()
                .reset_index(0, drop=True)
            )
            
            # Claim frequency rolling features
            df_features[f'claim_freq_{window}d'] = (
                df_features.groupby('seller_id')['claim_id']
                .rolling(window=window, min_periods=1)
                .count()
                .reset_index(0, drop=True)
            )
            
            # Claimable rate rolling features
            df_features[f'claimable_rate_{window}d'] = (
                df_features.groupby('seller_id')['claimable']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
        
        # Time-based features
        df_features['days_since_last_claim'] = (
            df_features.groupby('seller_id')['claim_date']
            .diff()
            .dt.days
        )
        
        df_features['days_since_first_claim'] = (
            df_features.groupby('seller_id')['claim_date']
            .transform(lambda x: (x - x.min()).dt.days)
        )
        
        # Fill NaN values
        numeric_columns = df_features.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if df_features[col].isnull().sum() > 0:
                df_features[col] = df_features[col].fillna(0)
        
        logger.info(f"Added {len(df_features.columns) - len(df.columns)} behavioral features")
        
        return df_features
    
    def engineer_marketplace_behavior(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer marketplace-specific behavioral features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with marketplace behavioral features added
        """
        logger.info("Engineering marketplace behavioral features")
        
        df_features = df.copy()
        
        # Marketplace statistics
        marketplace_stats = df_features.groupby('marketplace').agg({
            'claim_id': 'count',
            'amount': ['mean', 'std', 'sum'],
            'claimable': 'mean',
            'days_since_order': 'mean'
        }).reset_index()
        
        marketplace_stats.columns = [
            'marketplace', 'mp_total_claims', 'mp_avg_amount', 'mp_std_amount',
            'mp_total_amount', 'mp_claimable_rate', 'mp_avg_days_since_order'
        ]
        
        # Merge back to original dataframe
        df_features = df_features.merge(marketplace_stats, on='marketplace', how='left')
        
        # Marketplace rolling features
        for window in self.windows:
            df_features[f'mp_amount_rolling_mean_{window}d'] = (
                df_features.groupby('marketplace')['amount']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
            
            df_features[f'mp_claimable_rate_{window}d'] = (
                df_features.groupby('marketplace')['claimable']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
        
        # Fill NaN values
        numeric_columns = df_features.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if df_features[col].isnull().sum() > 0:
                df_features[col] = df_features[col].fillna(0)
        
        return df_features
    
    def engineer_category_behavior(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer category-specific behavioral features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with category behavioral features added
        """
        logger.info("Engineering category behavioral features")
        
        df_features = df.copy()
        
        # Category statistics
        category_stats = df_features.groupby('category').agg({
            'claim_id': 'count',
            'amount': ['mean', 'std', 'sum'],
            'claimable': 'mean',
            'quantity': 'mean'
        }).reset_index()
        
        category_stats.columns = [
            'category', 'cat_total_claims', 'cat_avg_amount', 'cat_std_amount',
            'cat_total_amount', 'cat_claimable_rate', 'cat_avg_quantity'
        ]
        
        # Subcategory statistics
        subcategory_stats = df_features.groupby('subcategory').agg({
            'claim_id': 'count',
            'amount': ['mean', 'std', 'sum'],
            'claimable': 'mean'
        }).reset_index()
        
        subcategory_stats.columns = [
            'subcategory', 'subcat_total_claims', 'subcat_avg_amount', 'subcat_std_amount',
            'subcat_total_amount', 'subcat_claimable_rate'
        ]
        
        # Merge back to original dataframe
        df_features = df_features.merge(category_stats, on='category', how='left')
        df_features = df_features.merge(subcategory_stats, on='subcategory', how='left')
        
        # Category rolling features
        for window in self.windows:
            df_features[f'cat_amount_rolling_mean_{window}d'] = (
                df_features.groupby('category')['amount']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
            
            df_features[f'cat_claimable_rate_{window}d'] = (
                df_features.groupby('category')['claimable']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
        
        # Fill NaN values
        numeric_columns = df_features.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if df_features[col].isnull().sum() > 0:
                df_features[col] = df_features[col].fillna(0)
        
        return df_features
    
    def engineer_reason_behavior(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer reason code behavioral features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with reason behavioral features added
        """
        logger.info("Engineering reason code behavioral features")
        
        df_features = df.copy()
        
        # Reason code statistics
        reason_stats = df_features.groupby('reason_code').agg({
            'claim_id': 'count',
            'amount': ['mean', 'std', 'sum'],
            'claimable': 'mean',
            'days_since_order': 'mean'
        }).reset_index()
        
        reason_stats.columns = [
            'reason_code', 'reason_total_claims', 'reason_avg_amount', 'reason_std_amount',
            'reason_total_amount', 'reason_claimable_rate', 'reason_avg_days_since_order'
        ]
        
        # Merge back to original dataframe
        df_features = df_features.merge(reason_stats, on='reason_code', how='left')
        
        # Reason code rolling features
        for window in self.windows:
            df_features[f'reason_amount_rolling_mean_{window}d'] = (
                df_features.groupby('reason_code')['amount']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
            
            df_features[f'reason_claimable_rate_{window}d'] = (
                df_features.groupby('reason_code')['claimable']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
        
        # Fill NaN values
        numeric_columns = df_features.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if df_features[col].isnull().sum() > 0:
                df_features[col] = df_features[col].fillna(0)
        
        return df_features
    
    def engineer_temporal_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer temporal features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with temporal features added
        """
        logger.info("Engineering temporal features")
        
        df_features = df.copy()
        
        # Extract temporal components
        df_features['claim_year'] = df_features['claim_date'].dt.year
        df_features['claim_month'] = df_features['claim_date'].dt.month
        df_features['claim_day'] = df_features['claim_date'].dt.day
        df_features['claim_dayofweek'] = df_features['claim_date'].dt.dayofweek
        df_features['claim_quarter'] = df_features['claim_date'].dt.quarter
        
        # Seasonal features
        df_features['is_holiday_season'] = (
            (df_features['claim_month'].isin([11, 12])) | 
            (df_features['claim_month'] == 1)
        ).astype(int)
        
        # Time-based ratios
        df_features['amount_per_day'] = df_features['amount'] / (df_features['days_since_order'] + 1)
        df_features['amount_per_quantity'] = df_features['amount'] / (df_features['quantity'] + 1)
        
        # Temporal rolling features
        for window in self.windows:
            df_features[f'temporal_amount_mean_{window}d'] = (
                df_features.groupby('claim_date')['amount']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
            
            df_features[f'temporal_claimable_rate_{window}d'] = (
                df_features.groupby('claim_date')['claimable']
                .rolling(window=window, min_periods=1)
                .mean()
                .reset_index(0, drop=True)
            )
        
        # Fill NaN values
        numeric_columns = df_features.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if df_features[col].isnull().sum() > 0:
                df_features[col] = df_features[col].fillna(0)
        
        return df_features
    
    def engineer_all_behavioral_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer all behavioral features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with all behavioral features added
        """
        logger.info("Engineering all behavioral features")
        
        # Apply all feature engineering steps
        df_features = self.engineer_seller_behavior(df)
        df_features = self.engineer_marketplace_behavior(df_features)
        df_features = self.engineer_category_behavior(df_features)
        df_features = self.engineer_reason_behavior(df_features)
        df_features = self.engineer_temporal_features(df_features)
        
        # Add interaction features
        df_features['seller_marketplace_interaction'] = (
            df_features['total_claims'] * df_features['mp_total_claims']
        )
        
        df_features['amount_category_interaction'] = (
            df_features['amount'] * df_features['cat_avg_amount']
        )
        
        df_features['claimable_reason_interaction'] = (
            df_features['claimable'] * df_features['reason_claimable_rate']
        )
        
        logger.info(f"Total behavioral features added: {len(df_features.columns) - len(df.columns)}")
        
        return df_features 