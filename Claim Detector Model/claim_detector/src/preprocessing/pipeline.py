"""
Preprocessing pipeline for the Claim Detector Model
"""
import pandas as pd
import numpy as np
import joblib
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
import logging

from ..features.behavioral_features import BehavioralFeatureEngineer
from ..features.text_embeddings import TextEmbeddingEngineer
from ..features.anomaly_signals import AnomalySignalEngineer
from ..config import feature_config

logger = logging.getLogger(__name__)

class PreprocessingPipeline:
    """Complete preprocessing pipeline for claim data"""
    
    def __init__(self, pipeline_path: Optional[str] = None):
        """Initialize the preprocessing pipeline"""
        self.behavioral_engineer = BehavioralFeatureEngineer()
        self.text_engineer = TextEmbeddingEngineer()
        self.anomaly_engineer = AnomalySignalEngineer()
        
        # Load saved pipeline if path provided
        self.pipeline_path = pipeline_path
        self.fitted_pipeline = None
        self.feature_names = []
        self.categorical_encoders = {}
        self.scalers = {}
        
        if pipeline_path and Path(pipeline_path).exists():
            self.load_pipeline(pipeline_path)
    
    def fit(self, df: pd.DataFrame) -> 'PreprocessingPipeline':
        """Fit the preprocessing pipeline on training data"""
        logger.info("Fitting preprocessing pipeline...")
        
        # Store original column names
        self.original_columns = df.columns.tolist()
        
        # Fit behavioral features
        df_behavioral = self.behavioral_engineer.fit_transform(df)
        
        # Fit text features
        df_text = self.text_engineer.fit_transform(df_behavioral)
        
        # Fit anomaly features
        ml_features = ['amount', 'quantity', 'days_since_order', 'days_since_delivery']
        df_anomaly = self.anomaly_engineer.fit_transform(df_text, ml_features)
        
        # Store feature names
        self.feature_names = df_anomaly.columns.tolist()
        
        # Fit categorical encoders
        self._fit_categorical_encoders(df_anomaly)
        
        # Fit scalers
        self._fit_scalers(df_anomaly)
        
        logger.info(f"Pipeline fitted with {len(self.feature_names)} features")
        return self
    
    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """Transform data using the fitted pipeline"""
        if not self.feature_names:
            raise ValueError("Pipeline must be fitted before transformation")
        
        logger.info("Transforming data through preprocessing pipeline...")
        
        # Apply behavioral features
        df_behavioral = self.behavioral_engineer.transform(df)
        
        # Apply text features
        df_text = self.text_engineer.transform(df_behavioral)
        
        # Apply anomaly features
        ml_features = ['amount', 'quantity', 'days_since_order', 'days_since_delivery']
        df_anomaly = self.anomaly_engineer.transform(df_text, ml_features)
        
        # Apply categorical encoding
        df_encoded = self._apply_categorical_encoding(df_anomaly)
        
        # Apply scaling
        df_scaled = self._apply_scaling(df_encoded)
        
        # Ensure all expected features are present
        df_final = self._ensure_feature_consistency(df_scaled)
        
        logger.info(f"Data transformed to {df_final.shape[1]} features")
        return df_final
    
    def fit_transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """Fit the pipeline and transform the data"""
        return self.fit(df).transform(df)
    
    def _fit_categorical_encoders(self, df: pd.DataFrame):
        """Fit categorical encoders for categorical columns"""
        from sklearn.preprocessing import LabelEncoder
        
        for col in feature_config.CATEGORICAL_COLUMNS:
            if col in df.columns:
                encoder = LabelEncoder()
                # Handle missing values
                df_clean = df[col].fillna('unknown')
                encoder.fit(df_clean)
                self.categorical_encoders[col] = encoder
    
    def _fit_scalers(self, df: pd.DataFrame):
        """Fit scalers for numerical columns"""
        from sklearn.preprocessing import StandardScaler
        
        for col in feature_config.NUMERICAL_COLUMNS:
            if col in df.columns:
                scaler = StandardScaler()
                # Handle missing values
                df_clean = df[col].fillna(df[col].median())
                scaler.fit(df_clean.values.reshape(-1, 1))
                self.scalers[col] = scaler
    
    def _apply_categorical_encoding(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply categorical encoding to the data"""
        df_encoded = df.copy()
        
        for col, encoder in self.categorical_encoders.items():
            if col in df_encoded.columns:
                # Handle missing values
                df_clean = df_encoded[col].fillna('unknown')
                df_encoded[col] = encoder.transform(df_clean)
        
        return df_encoded
    
    def _apply_scaling(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply scaling to numerical columns"""
        df_scaled = df.copy()
        
        for col, scaler in self.scalers.items():
            if col in df_scaled.columns:
                # Handle missing values
                df_clean = df_scaled[col].fillna(df_scaled[col].median())
                df_scaled[col] = scaler.transform(df_clean.values.reshape(-1, 1)).flatten()
        
        return df_scaled
    
    def _ensure_feature_consistency(self, df: pd.DataFrame) -> pd.DataFrame:
        """Ensure all expected features are present in the output"""
        missing_features = set(self.feature_names) - set(df.columns)
        
        if missing_features:
            logger.warning(f"Missing features: {missing_features}")
            # Add missing features with default values
            for feature in missing_features:
                df[feature] = 0.0
        
        # Ensure correct column order
        df_final = df.reindex(columns=self.feature_names, fill_value=0.0)
        
        return df_final
    
    def get_feature_names(self) -> list:
        """Get the list of feature names"""
        return self.feature_names.copy()
    
    def save_pipeline(self, path: str):
        """Save the fitted pipeline"""
        pipeline_data = {
            'feature_names': self.feature_names,
            'categorical_encoders': self.categorical_encoders,
            'scalers': self.scalers,
            'original_columns': self.original_columns
        }
        
        joblib.dump(pipeline_data, path)
        logger.info(f"Pipeline saved to {path}")
    
    def load_pipeline(self, path: str):
        """Load a saved pipeline"""
        pipeline_data = joblib.load(path)
        
        self.feature_names = pipeline_data['feature_names']
        self.categorical_encoders = pipeline_data['categorical_encoders']
        self.scalers = pipeline_data['scalers']
        self.original_columns = pipeline_data.get('original_columns', [])
        
        logger.info(f"Pipeline loaded from {path} with {len(self.feature_names)} features")
    
    def get_feature_importance_mapping(self) -> Dict[str, str]:
        """Get mapping of engineered features to original features"""
        mapping = {}
        
        for feature in self.feature_names:
            if feature in self.original_columns:
                mapping[feature] = feature
            elif '_' in feature:
                # Try to map engineered features to original ones
                parts = feature.split('_')
                for part in parts:
                    if part in self.original_columns:
                        mapping[feature] = part
                        break
                else:
                    mapping[feature] = 'unknown'
            else:
                mapping[feature] = 'unknown'
        
        return mapping





