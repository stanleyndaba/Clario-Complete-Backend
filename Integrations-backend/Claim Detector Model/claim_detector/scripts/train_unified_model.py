#!/usr/bin/env python3
"""
Training script for the unified Claim Detector Model
"""
import os
import sys
import logging
import argparse
from pathlib import Path
import pandas as pd
import numpy as np
from datetime import datetime

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.models.unified_model import UnifiedClaimDetectorModel
from src.data_ingestion.fetch_data import DataIngestion
from src.config import model_config, feature_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(project_root / 'logs' / 'training.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def load_training_data(data_path: str = None) -> tuple:
    """Load training data"""
    if data_path and Path(data_path).exists():
        logger.info(f"Loading data from {data_path}")
        df = pd.read_csv(data_path)
    else:
        logger.info("Generating synthetic training data")
        df = generate_synthetic_data()
    
    # Ensure required columns exist
    required_columns = [
        'claim_id', 'seller_id', 'order_id', 'category', 'subcategory',
        'reason_code', 'marketplace', 'fulfillment_center', 'amount',
        'quantity', 'order_value', 'shipping_cost', 'days_since_order',
        'days_since_delivery', 'description', 'reason', 'notes', 'claim_date'
    ]
    
    missing_columns = set(required_columns) - set(df.columns)
    if missing_columns:
        logger.warning(f"Missing columns: {missing_columns}")
        # Add missing columns with default values
        for col in missing_columns:
            if col in ['claim_id', 'seller_id', 'order_id']:
                df[col] = f"default_{col}"
            elif col in ['category', 'subcategory', 'reason_code', 'marketplace', 'fulfillment_center']:
                df[col] = "unknown"
            elif col in ['amount', 'order_value', 'shipping_cost']:
                df[col] = 0.0
            elif col in ['quantity', 'days_since_order', 'days_since_delivery']:
                df[col] = 0
            elif col in ['description', 'reason', 'notes']:
                df[col] = "No description"
            elif col == 'claim_date':
                df['claim_date'] = pd.Timestamp.now().strftime('%Y-%m-%d')
    
    # Ensure target column exists
    if 'claimable' not in df.columns:
        logger.info("Generating target variable 'claimable'")
        # Simple rule-based target generation
        df['claimable'] = (
            (df['amount'] > 10) & 
            (df['days_since_order'] > 7) & 
            (df['days_since_delivery'] > 3)
        ).astype(int)
    
    return df

def generate_synthetic_data(n_samples: int = 10000) -> pd.DataFrame:
    """Generate synthetic training data"""
    logger.info(f"Generating {n_samples} synthetic samples")
    
    np.random.seed(model_config.RANDOM_STATE)
    
    # Generate synthetic data
    data = {
        'claim_id': [f"claim_{i:06d}" for i in range(n_samples)],
        'seller_id': [f"seller_{np.random.randint(1, 1000):04d}" for _ in range(n_samples)],
        'order_id': [f"order_{np.random.randint(1, 100000):06d}" for _ in range(n_samples)],
        'category': np.random.choice(['Electronics', 'Clothing', 'Books', 'Home', 'Sports'], n_samples),
        'subcategory': np.random.choice(['Smartphones', 'Laptops', 'T-Shirts', 'Jeans', 'Fiction', 'Non-Fiction'], n_samples),
        'reason_code': np.random.choice(['FBA_LOST', 'FBA_DAMAGED', 'FBA_OVERCHARGED', 'FBA_UNDERCHARGED'], n_samples),
        'marketplace': np.random.choice(['US', 'CA', 'UK', 'DE', 'JP'], n_samples),
        'fulfillment_center': np.random.choice(['SDF1', 'SDF2', 'SDF3', 'SDF4'], n_samples),
        'amount': np.random.uniform(5, 500, n_samples),
        'quantity': np.random.randint(1, 10, n_samples),
        'order_value': np.random.uniform(10, 1000, n_samples),
        'shipping_cost': np.random.uniform(0, 50, n_samples),
        'days_since_order': np.random.randint(1, 365, n_samples),
        'days_since_delivery': np.random.randint(0, 30, n_samples),
        'description': [f"Product description {i}" for i in range(n_samples)],
        'reason': [f"Claim reason {i}" for i in range(n_samples)],
        'notes': [f"Additional notes {i}" for i in range(n_samples)],
        'claim_date': pd.date_range(start='2023-01-01', periods=n_samples, freq='D').strftime('%Y-%m-%d')
    }
    
    df = pd.DataFrame(data)
    
    # Generate target variable based on business rules
    df['claimable'] = (
        (df['amount'] > 20) & 
        (df['days_since_order'] > 14) & 
        (df['days_since_delivery'] > 7) &
        (df['reason_code'].isin(['FBA_LOST', 'FBA_DAMAGED']))
    ).astype(int)
    
    # Add some noise to make it more realistic
    noise = np.random.random(n_samples) < 0.1
    df.loc[noise, 'claimable'] = 1 - df.loc[noise, 'claimable']
    
    logger.info(f"Generated synthetic data with {df['claimable'].sum()} claimable samples")
    return df

def train_model(df: pd.DataFrame, model_path: str, pipeline_path: str) -> UnifiedClaimDetectorModel:
    """Train the unified model"""
    logger.info("Starting model training...")
    
    # Prepare features and target
    feature_columns = [col for col in df.columns if col not in ['claimable', 'claim_id']]
    X = df[feature_columns]
    y = df['claimable']
    
    logger.info(f"Training with {len(feature_columns)} features and {len(df)} samples")
    logger.info(f"Target distribution: {y.value_counts().to_dict()}")
    
    # Initialize and train model
    model = UnifiedClaimDetectorModel()
    
    # Split data for validation
    from sklearn.model_selection import train_test_split
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, 
        test_size=model_config.VALIDATION_SIZE,
        random_state=model_config.RANDOM_STATE,
        stratify=y
    )
    
    # Train model
    training_results = model.train(
        X_train, y_train, 
        validation_data=(X_val, y_val)
    )
    
    logger.info(f"Training completed in {training_results['training_time']:.2f} seconds")
    logger.info(f"Final feature count: {training_results['feature_count']}")
    logger.info(f"Performance metrics: {training_results['performance_metrics']}")
    
    # Save model
    model.save_model(model_path)
    logger.info(f"Model saved to {model_path}")
    
    return model

def evaluate_model(model: UnifiedClaimDetectorModel, X_test: pd.DataFrame, y_test: pd.Series):
    """Evaluate the trained model"""
    logger.info("Evaluating model performance...")
    
    # Make predictions
    predictions = model.predict(X_test)
    
    # Calculate metrics
    from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
    
    y_pred = predictions['predictions']
    y_proba = predictions['probabilities']
    
    # Classification report
    logger.info("Classification Report:")
    logger.info("\n" + classification_report(y_test, y_pred))
    
    # Confusion matrix
    cm = confusion_matrix(y_test, y_pred)
    logger.info("Confusion Matrix:")
    logger.info(f"\n{cm}")
    
    # ROC AUC
    try:
        auc = roc_auc_score(y_test, y_proba)
        logger.info(f"ROC AUC: {auc:.4f}")
    except:
        logger.warning("Could not calculate ROC AUC")
    
    # Feature importance
    feature_importance = model.get_feature_importance(top_n=20)
    logger.info("Top 20 Feature Importance:")
    for i, feature in enumerate(feature_importance[:20]):
        logger.info(f"{i+1:2d}. {feature['feature']}: {feature['importance']:.4f}")

def main():
    """Main training function"""
    parser = argparse.ArgumentParser(description="Train the unified Claim Detector Model")
    parser.add_argument("--data-path", type=str, help="Path to training data CSV")
    parser.add_argument("--model-path", type=str, default="models/claim_detector_model.pkl", 
                       help="Path to save the trained model")
    parser.add_argument("--pipeline-path", type=str, default="models/preprocessing_pipeline.pkl",
                       help="Path to save the preprocessing pipeline")
    parser.add_argument("--synthetic-samples", type=int, default=10000,
                       help="Number of synthetic samples to generate if no data provided")
    parser.add_argument("--evaluate", action="store_true", help="Evaluate model after training")
    
    args = parser.parse_args()
    
    # Create output directories
    model_dir = Path(args.model_path).parent
    model_dir.mkdir(parents=True, exist_ok=True)
    
    pipeline_dir = Path(args.pipeline_path).parent
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    
    logs_dir = project_root / 'logs'
    logs_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        # Load or generate training data
        df = load_training_data(args.data_path)
        
        if args.data_path is None:
            # Save synthetic data for future use
            synthetic_data_path = project_root / 'data' / 'synthetic_training_data.csv'
            synthetic_data_path.parent.mkdir(parents=True, exist_ok=True)
            df.to_csv(synthetic_data_path, index=False)
            logger.info(f"Synthetic data saved to {synthetic_data_path}")
        
        # Train model
        model = train_model(df, args.model_path, args.pipeline_path)
        
        # Evaluate if requested
        if args.evaluate:
            from sklearn.model_selection import train_test_split
            feature_columns = [col for col in df.columns if col not in ['claimable', 'claim_id']]
            X = df[feature_columns]
            y = df['claimable']
            
            _, X_test, _, y_test = train_test_split(
                X, y, 
                test_size=0.2,
                random_state=model_config.RANDOM_STATE,
                stratify=y
            )
            
            evaluate_model(model, X_test, y_test)
        
        logger.info("Training completed successfully!")
        
    except Exception as e:
        logger.error(f"Training failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
