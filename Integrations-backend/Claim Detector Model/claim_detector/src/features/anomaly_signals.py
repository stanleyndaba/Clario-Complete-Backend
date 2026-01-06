"""
Anomaly detection features for FBA reimbursement claim detection
"""
import pandas as pd
import numpy as np
from typing import List, Dict, Tuple, Optional
import logging
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.covariance import EllipticEnvelope
from sklearn.preprocessing import StandardScaler
from scipy import stats
import joblib
from pathlib import Path

logger = logging.getLogger(__name__)

class AnomalySignalEngineer:
    """Engineer anomaly detection features from FBA reimbursement data"""
    
    def __init__(self, contamination: float = 0.1, random_state: int = 42):
        """
        Initialize anomaly signal engineer
        
        Args:
            contamination: Expected proportion of anomalies
            random_state: Random state for reproducibility
        """
        self.contamination = contamination
        self.random_state = random_state
        self.scaler = StandardScaler()
        self.isolation_forest = None
        self.lof = None
        self.elliptic_envelope = None
        
    def engineer_statistical_anomalies(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer statistical anomaly features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with statistical anomaly features added
        """
        logger.info("Engineering statistical anomaly features")
        
        df_features = df.copy()
        
        # Z-score based anomalies
        numeric_features = ['amount', 'quantity', 'days_since_order', 'days_since_delivery']
        
        for feature in numeric_features:
            if feature in df_features.columns:
                # Calculate z-scores
                z_scores = np.abs(stats.zscore(df_features[feature], nan_policy='omit'))
                df_features[f'{feature}_z_score'] = z_scores
                df_features[f'{feature}_is_anomaly_z'] = (z_scores > 3).astype(int)
                
                # Calculate IQR-based anomalies
                Q1 = df_features[feature].quantile(0.25)
                Q3 = df_features[feature].quantile(0.75)
                IQR = Q3 - Q1
                lower_bound = Q1 - 1.5 * IQR
                upper_bound = Q3 + 1.5 * IQR
                
                df_features[f'{feature}_is_anomaly_iqr'] = (
                    (df_features[feature] < lower_bound) | 
                    (df_features[feature] > upper_bound)
                ).astype(int)
        
        # Multi-dimensional statistical anomalies
        if all(feature in df_features.columns for feature in ['amount', 'quantity']):
            # Mahalanobis distance for amount-quantity relationship
            features_for_mahal = df_features[['amount', 'quantity']].dropna()
            
            if len(features_for_mahal) > 0:
                # Calculate covariance matrix
                cov_matrix = features_for_mahal.cov()
                
                # Calculate Mahalanobis distance
                mean_vector = features_for_mahal.mean()
                mahal_distances = []
                
                for _, row in features_for_mahal.iterrows():
                    diff = row - mean_vector
                    try:
                        inv_cov_matrix = np.linalg.inv(cov_matrix.values)
                        mahal_dist = np.sqrt(diff.dot(inv_cov_matrix).dot(diff))
                        mahal_distances.append(mahal_dist)
                    except:
                        mahal_distances.append(0)
                
                # Add Mahalanobis distance features
                df_features['mahalanobis_distance'] = 0
                df_features.loc[features_for_mahal.index, 'mahalanobis_distance'] = mahal_distances
                
                # Anomaly threshold (95th percentile)
                threshold = np.percentile(mahal_distances, 95)
                df_features['is_anomaly_mahalanobis'] = (
                    df_features['mahalanobis_distance'] > threshold
                ).astype(int)
        
        return df_features
    
    def engineer_behavioral_anomalies(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer behavioral anomaly features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with behavioral anomaly features added
        """
        logger.info("Engineering behavioral anomaly features")
        
        df_features = df.copy()
        
        # Seller behavioral anomalies
        if 'seller_id' in df_features.columns:
            # Calculate seller-specific statistics
            seller_stats = df_features.groupby('seller_id').agg({
                'amount': ['mean', 'std', 'count'],
                'claimable': 'mean'
            }).reset_index()
            
            seller_stats.columns = ['seller_id', 'seller_avg_amount', 'seller_std_amount', 'seller_claim_count', 'seller_claimable_rate']
            
            # Merge back to original dataframe
            df_features = df_features.merge(seller_stats, on='seller_id', how='left')
            
            # Calculate deviation from seller average
            df_features['amount_deviation_from_seller_avg'] = (
                df_features['amount'] - df_features['seller_avg_amount']
            )
            
            df_features['amount_deviation_from_seller_avg_pct'] = (
                df_features['amount_deviation_from_seller_avg'] / (df_features['seller_avg_amount'] + 1e-8)
            )
            
            # Anomaly flags
            df_features['is_seller_amount_anomaly'] = (
                np.abs(df_features['amount_deviation_from_seller_avg_pct']) > 2
            ).astype(int)
        
        # Marketplace behavioral anomalies
        if 'marketplace' in df_features.columns:
            # Calculate marketplace-specific statistics
            marketplace_stats = df_features.groupby('marketplace').agg({
                'amount': ['mean', 'std', 'count'],
                'claimable': 'mean'
            }).reset_index()
            
            marketplace_stats.columns = ['marketplace', 'mp_avg_amount', 'mp_std_amount', 'mp_claim_count', 'mp_claimable_rate']
            
            # Merge back to original dataframe
            df_features = df_features.merge(marketplace_stats, on='marketplace', how='left')
            
            # Calculate deviation from marketplace average
            df_features['amount_deviation_from_mp_avg'] = (
                df_features['amount'] - df_features['mp_avg_amount']
            )
            
            df_features['amount_deviation_from_mp_avg_pct'] = (
                df_features['amount_deviation_from_mp_avg'] / (df_features['mp_avg_amount'] + 1e-8)
            )
            
            # Anomaly flags
            df_features['is_mp_amount_anomaly'] = (
                np.abs(df_features['amount_deviation_from_mp_avg_pct']) > 2
            ).astype(int)
        
        # Category behavioral anomalies
        if 'category' in df_features.columns:
            # Calculate category-specific statistics
            category_stats = df_features.groupby('category').agg({
                'amount': ['mean', 'std', 'count'],
                'claimable': 'mean'
            }).reset_index()
            
            category_stats.columns = ['category', 'cat_avg_amount', 'cat_std_amount', 'cat_claim_count', 'cat_claimable_rate']
            
            # Merge back to original dataframe
            df_features = df_features.merge(category_stats, on='category', how='left')
            
            # Calculate deviation from category average
            df_features['amount_deviation_from_cat_avg'] = (
                df_features['amount'] - df_features['cat_avg_amount']
            )
            
            df_features['amount_deviation_from_cat_avg_pct'] = (
                df_features['amount_deviation_from_cat_avg'] / (df_features['cat_avg_amount'] + 1e-8)
            )
            
            # Anomaly flags
            df_features['is_cat_amount_anomaly'] = (
                np.abs(df_features['amount_deviation_from_cat_avg_pct']) > 2
            ).astype(int)
        
        return df_features
    
    def engineer_temporal_anomalies(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer temporal anomaly features
        
        Args:
            df: DataFrame with claim data
            
        Returns:
            DataFrame with temporal anomaly features added
        """
        logger.info("Engineering temporal anomaly features")
        
        df_features = df.copy()
        
        # Sort by date for temporal analysis
        if 'claim_date' in df_features.columns:
            df_features = df_features.sort_values('claim_date')
            
            # Rolling window anomalies
            windows = [7, 14, 30]
            
            for window in windows:
                # Rolling statistics
                rolling_mean = df_features['amount'].rolling(window=window, min_periods=1).mean()
                rolling_std = df_features['amount'].rolling(window=window, min_periods=1).std()
                
                # Deviation from rolling average
                df_features[f'amount_deviation_from_rolling_mean_{window}d'] = (
                    df_features['amount'] - rolling_mean
                )
                
                df_features[f'amount_deviation_from_rolling_mean_{window}d_pct'] = (
                    df_features[f'amount_deviation_from_rolling_mean_{window}d'] / (rolling_mean + 1e-8)
                )
                
                # Anomaly flags
                df_features[f'is_temporal_anomaly_{window}d'] = (
                    np.abs(df_features[f'amount_deviation_from_rolling_mean_{window}d_pct']) > 2
                ).astype(int)
            
            # Seasonal anomalies
            df_features['claim_month'] = df_features['claim_date'].dt.month
            
            # Calculate monthly averages
            monthly_stats = df_features.groupby('claim_month').agg({
                'amount': ['mean', 'std', 'count']
            }).reset_index()
            
            monthly_stats.columns = ['claim_month', 'monthly_avg_amount', 'monthly_std_amount', 'monthly_claim_count']
            
            # Merge back to original dataframe
            df_features = df_features.merge(monthly_stats, on='claim_month', how='left')
            
            # Deviation from monthly average
            df_features['amount_deviation_from_monthly_avg'] = (
                df_features['amount'] - df_features['monthly_avg_amount']
            )
            
            df_features['amount_deviation_from_monthly_avg_pct'] = (
                df_features['amount_deviation_from_monthly_avg'] / (df_features['monthly_avg_amount'] + 1e-8)
            )
            
            # Monthly anomaly flags
            df_features['is_monthly_anomaly'] = (
                np.abs(df_features['amount_deviation_from_monthly_avg_pct']) > 2
            ).astype(int)
        
        return df_features
    
    def train_ml_anomaly_detectors(self, df: pd.DataFrame, features: List[str]) -> pd.DataFrame:
        """
        Train and apply ML-based anomaly detectors
        
        Args:
            df: DataFrame with features
            features: List of features to use for anomaly detection
            
        Returns:
            DataFrame with ML anomaly features added
        """
        logger.info("Training ML-based anomaly detectors")
        
        df_features = df.copy()
        
        # Prepare features for anomaly detection
        feature_data = df_features[features].fillna(0)
        
        # Scale features
        feature_data_scaled = self.scaler.fit_transform(feature_data)
        
        # Train Isolation Forest
        self.isolation_forest = IsolationForest(
            contamination=self.contamination,
            random_state=self.random_state,
            n_estimators=100
        )
        isolation_scores = self.isolation_forest.fit_predict(feature_data_scaled)
        df_features['isolation_forest_anomaly'] = (isolation_scores == -1).astype(int)
        df_features['isolation_forest_score'] = self.isolation_forest.score_samples(feature_data_scaled)
        
        # Train Local Outlier Factor
        self.lof = LocalOutlierFactor(
            contamination=self.contamination,
            n_neighbors=20,
            random_state=self.random_state
        )
        lof_scores = self.lof.fit_predict(feature_data_scaled)
        df_features['lof_anomaly'] = (lof_scores == -1).astype(int)
        df_features['lof_score'] = self.lof.negative_outlier_factor_
        
        # Train Elliptic Envelope
        self.elliptic_envelope = EllipticEnvelope(
            contamination=self.contamination,
            random_state=self.random_state
        )
        elliptic_scores = self.elliptic_envelope.fit_predict(feature_data_scaled)
        df_features['elliptic_envelope_anomaly'] = (elliptic_scores == -1).astype(int)
        df_features['elliptic_envelope_score'] = self.elliptic_envelope.score_samples(feature_data_scaled)
        
        # Combined anomaly score
        df_features['combined_anomaly_score'] = (
            df_features['isolation_forest_anomaly'] +
            df_features['lof_anomaly'] +
            df_features['elliptic_envelope_anomaly']
        )
        
        df_features['is_ml_anomaly'] = (df_features['combined_anomaly_score'] >= 2).astype(int)
        
        logger.info(f"Trained ML anomaly detectors on {len(features)} features")
        
        return df_features
    
    def engineer_all_anomaly_features(self, df: pd.DataFrame, ml_features: List[str] = None) -> pd.DataFrame:
        """
        Engineer all anomaly detection features
        
        Args:
            df: DataFrame with claim data
            ml_features: List of features to use for ML anomaly detection
            
        Returns:
            DataFrame with all anomaly features added
        """
        logger.info("Engineering all anomaly detection features")
        
        # Apply all anomaly detection steps
        df_features = self.engineer_statistical_anomalies(df)
        df_features = self.engineer_behavioral_anomalies(df_features)
        df_features = self.engineer_temporal_anomalies(df_features)
        
        # Apply ML-based anomaly detection
        if ml_features is None:
            ml_features = ['amount', 'quantity', 'days_since_order', 'days_since_delivery']
        
        # Filter to features that exist in the dataframe
        ml_features = [f for f in ml_features if f in df_features.columns]
        
        if len(ml_features) > 0:
            df_features = self.train_ml_anomaly_detectors(df_features, ml_features)
        
        # Fill NaN values
        numeric_columns = df_features.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if df_features[col].isnull().sum() > 0:
                df_features[col] = df_features[col].fillna(0)
        
        logger.info(f"Total anomaly features added: {len(df_features.columns) - len(df.columns)}")
        
        return df_features
    
    def save_models(self, model_dir: str):
        """Save trained anomaly detection models"""
        model_dir = Path(model_dir)
        model_dir.mkdir(parents=True, exist_ok=True)
        
        if self.scaler is not None:
            joblib.dump(self.scaler, model_dir / "anomaly_scaler.pkl")
        
        if self.isolation_forest is not None:
            joblib.dump(self.isolation_forest, model_dir / "isolation_forest.pkl")
        
        if self.lof is not None:
            joblib.dump(self.lof, model_dir / "lof.pkl")
        
        if self.elliptic_envelope is not None:
            joblib.dump(self.elliptic_envelope, model_dir / "elliptic_envelope.pkl")
        
        logger.info(f"Anomaly detection models saved to {model_dir}")
    
    def load_models(self, model_dir: str):
        """Load trained anomaly detection models"""
        model_dir = Path(model_dir)
        
        if (model_dir / "anomaly_scaler.pkl").exists():
            self.scaler = joblib.load(model_dir / "anomaly_scaler.pkl")
        
        if (model_dir / "isolation_forest.pkl").exists():
            self.isolation_forest = joblib.load(model_dir / "isolation_forest.pkl")
        
        if (model_dir / "lof.pkl").exists():
            self.lof = joblib.load(model_dir / "lof.pkl")
        
        if (model_dir / "elliptic_envelope.pkl").exists():
            self.elliptic_envelope = joblib.load(model_dir / "elliptic_envelope.pkl")
        
        logger.info(f"Anomaly detection models loaded from {model_dir}") 