"""
Text embedding features for FBA reimbursement claim detection
"""
import pandas as pd
import numpy as np
from typing import List, Dict, Tuple, Optional
import logging
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import PCA
import joblib
from pathlib import Path

logger = logging.getLogger(__name__)

class TextEmbeddingEngineer:
    """Engineer text embedding features from FBA reimbursement data"""
    
    def __init__(self, model_name: str = "all-MiniLM-L6-v2", max_length: int = 512):
        """
        Initialize text embedding engineer
        
        Args:
            model_name: Name of the sentence transformer model
            max_length: Maximum sequence length for the model
        """
        self.model_name = model_name
        self.max_length = max_length
        self.model = None
        self.pca = None
        self.text_columns = ['description', 'reason', 'notes']
        
    def load_model(self):
        """Load the sentence transformer model"""
        if self.model is None:
            logger.info(f"Loading sentence transformer model: {self.model_name}")
            self.model = SentenceTransformer(self.model_name)
            logger.info("Model loaded successfully")
    
    def generate_embeddings(self, texts: List[str], batch_size: int = 32) -> np.ndarray:
        """
        Generate embeddings for a list of texts
        
        Args:
            texts: List of text strings
            batch_size: Batch size for processing
            
        Returns:
            Array of embeddings
        """
        self.load_model()
        
        # Clean and prepare texts
        cleaned_texts = [str(text) if pd.notna(text) else "" for text in texts]
        
        # Generate embeddings
        embeddings = self.model.encode(
            cleaned_texts, 
            batch_size=batch_size,
            show_progress_bar=True,
            convert_to_numpy=True
        )
        
        logger.info(f"Generated embeddings for {len(texts)} texts")
        return embeddings
    
    def engineer_text_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer text-based features from the dataset
        
        Args:
            df: DataFrame with text columns
            
        Returns:
            DataFrame with text features added
        """
        logger.info("Engineering text features")
        
        df_features = df.copy()
        
        # Generate embeddings for each text column
        for col in self.text_columns:
            if col in df_features.columns:
                logger.info(f"Generating embeddings for column: {col}")
                
                # Generate embeddings
                embeddings = self.generate_embeddings(df_features[col].tolist())
                
                # Add embedding columns
                for i in range(embeddings.shape[1]):
                    df_features[f'{col}_embedding_{i}'] = embeddings[:, i]
                
                # Add aggregated features
                df_features[f'{col}_embedding_mean'] = embeddings.mean(axis=1)
                df_features[f'{col}_embedding_std'] = embeddings.std(axis=1)
                df_features[f'{col}_embedding_max'] = embeddings.max(axis=1)
                df_features[f'{col}_embedding_min'] = embeddings.min(axis=1)
        
        # Generate combined text embeddings
        if all(col in df_features.columns for col in self.text_columns):
            logger.info("Generating combined text embeddings")
            
            # Combine all text fields
            combined_texts = []
            for _, row in df_features.iterrows():
                combined_text = " ".join([
                    str(row.get(col, "")) for col in self.text_columns
                ])
                combined_texts.append(combined_text)
            
            # Generate combined embeddings
            combined_embeddings = self.generate_embeddings(combined_texts)
            
            # Add combined embedding features
            for i in range(combined_embeddings.shape[1]):
                df_features[f'combined_text_embedding_{i}'] = combined_embeddings[:, i]
            
            df_features['combined_text_embedding_mean'] = combined_embeddings.mean(axis=1)
            df_features['combined_text_embedding_std'] = combined_embeddings.std(axis=1)
        
        return df_features
    
    def engineer_similarity_features(self, df: pd.DataFrame, reference_texts: Dict[str, str] = None) -> pd.DataFrame:
        """
        Engineer similarity features based on text embeddings
        
        Args:
            df: DataFrame with text embeddings
            reference_texts: Dictionary of reference texts for similarity comparison
            
        Returns:
            DataFrame with similarity features added
        """
        logger.info("Engineering text similarity features")
        
        df_features = df.copy()
        
        # Default reference texts for common claim scenarios
        if reference_texts is None:
            reference_texts = {
                'damaged_item': "item damaged during shipping or handling",
                'lost_item': "item lost in transit or warehouse",
                'expired_item': "item expired or past sell by date",
                'returned_item': "item returned by customer",
                'overage_item': "item received in excess quantity",
                'quality_issue': "item has quality or defect issues"
            }
        
        # Generate embeddings for reference texts
        reference_embeddings = {}
        for name, text in reference_texts.items():
            embeddings = self.generate_embeddings([text])
            reference_embeddings[name] = embeddings[0]
        
        # Calculate similarity with reference texts
        for col in self.text_columns:
            if col in df_features.columns:
                # Get embedding columns for this text column
                embedding_cols = [c for c in df_features.columns if c.startswith(f'{col}_embedding_') and c.endswith('_mean')]
                
                if embedding_cols:
                    # Use the mean embedding for similarity calculation
                    text_embeddings = df_features[embedding_cols[0]].values.reshape(-1, 1)
                    
                    for ref_name, ref_embedding in reference_embeddings.items():
                        # Calculate cosine similarity
                        similarities = cosine_similarity(
                            text_embeddings, 
                            ref_embedding.reshape(1, -1)
                        ).flatten()
                        
                        df_features[f'{col}_similarity_{ref_name}'] = similarities
        
        return df_features
    
    def reduce_embeddings(self, df: pd.DataFrame, n_components: int = 50) -> pd.DataFrame:
        """
        Reduce dimensionality of embeddings using PCA
        
        Args:
            df: DataFrame with embedding features
            n_components: Number of PCA components to keep
            
        Returns:
            DataFrame with reduced embeddings
        """
        logger.info(f"Reducing embeddings to {n_components} components using PCA")
        
        df_features = df.copy()
        
        # Find all embedding columns
        embedding_cols = []
        for col in self.text_columns:
            if col in df_features.columns:
                cols = [c for c in df_features.columns if c.startswith(f'{col}_embedding_') and not c.endswith(('_mean', '_std', '_max', '_min'))]
                embedding_cols.extend(cols)
        
        if embedding_cols:
            # Apply PCA
            pca = PCA(n_components=min(n_components, len(embedding_cols)))
            reduced_embeddings = pca.fit_transform(df_features[embedding_cols])
            
            # Add reduced embedding features
            for i in range(reduced_embeddings.shape[1]):
                df_features[f'text_pca_component_{i}'] = reduced_embeddings[:, i]
            
            # Store PCA model for later use
            self.pca = pca
            
            logger.info(f"Reduced embeddings from {len(embedding_cols)} to {reduced_embeddings.shape[1]} components")
        
        return df_features
    
    def engineer_text_statistics(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Engineer text statistics features
        
        Args:
            df: DataFrame with text columns
            
        Returns:
            DataFrame with text statistics features added
        """
        logger.info("Engineering text statistics features")
        
        df_features = df.copy()
        
        for col in self.text_columns:
            if col in df_features.columns:
                # Text length features
                df_features[f'{col}_length'] = df_features[col].str.len()
                df_features[f'{col}_word_count'] = df_features[col].str.split().str.len()
                df_features[f'{col}_char_count'] = df_features[col].str.replace(' ', '').str.len()
                
                # Text complexity features
                df_features[f'{col}_avg_word_length'] = (
                    df_features[f'{col}_char_count'] / (df_features[f'{col}_word_count'] + 1)
                )
                
                # Special character features
                df_features[f'{col}_special_char_count'] = (
                    df_features[col].str.count(r'[^a-zA-Z0-9\s]')
                )
                
                # Number features
                df_features[f'{col}_number_count'] = (
                    df_features[col].str.count(r'\d+')
                )
                
                # Uppercase features
                df_features[f'{col}_uppercase_count'] = (
                    df_features[col].str.count(r'[A-Z]')
                )
        
        # Fill NaN values
        numeric_columns = df_features.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if df_features[col].isnull().sum() > 0:
                df_features[col] = df_features[col].fillna(0)
        
        return df_features
    
    def engineer_all_text_features(self, df: pd.DataFrame, reduce_embeddings: bool = True) -> pd.DataFrame:
        """
        Engineer all text-based features
        
        Args:
            df: DataFrame with text data
            reduce_embeddings: Whether to reduce embedding dimensionality
            
        Returns:
            DataFrame with all text features added
        """
        logger.info("Engineering all text features")
        
        # Apply all text feature engineering steps
        df_features = self.engineer_text_features(df)
        df_features = self.engineer_text_statistics(df_features)
        df_features = self.engineer_similarity_features(df_features)
        
        if reduce_embeddings:
            df_features = self.reduce_embeddings(df_features)
        
        logger.info(f"Total text features added: {len(df_features.columns) - len(df.columns)}")
        
        return df_features
    
    def save_model(self, model_path: str):
        """Save the PCA model for later use"""
        if self.pca is not None:
            joblib.dump(self.pca, model_path)
            logger.info(f"PCA model saved to {model_path}")
    
    def load_model(self, model_path: str):
        """Load the PCA model"""
        if Path(model_path).exists():
            self.pca = joblib.load(model_path)
            logger.info(f"PCA model loaded from {model_path}") 