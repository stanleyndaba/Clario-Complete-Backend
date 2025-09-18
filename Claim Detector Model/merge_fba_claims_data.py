#!/usr/bin/env python3
"""
Script to merge FBA claims datasets for training the Claims Model
"""
import pandas as pd
import numpy as np
from pathlib import Path
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_and_merge_datasets():
    """
    Load and merge the two FBA claims datasets
    """
    logger.info("Loading FBA claims datasets...")
    
    # Load the text-based dataset (1000 samples)
    text_df = pd.read_csv('amazon_claim_dataset_1000.csv')
    logger.info(f"Loaded text dataset: {text_df.shape}")
    
    # Load the structured FBA dataset (9000 samples)
    fba_df = pd.read_csv('amazon_fba_claims_9000.csv')
    logger.info(f"Loaded FBA dataset: {fba_df.shape}")
    
    # Standardize column names and structure
    logger.info("Standardizing dataset structures...")
    
    # Process text dataset
    text_df_processed = process_text_dataset(text_df)
    
    # Process FBA dataset
    fba_df_processed = process_fba_dataset(fba_df)
    
    # Merge datasets
    logger.info("Merging datasets...")
    merged_df = pd.concat([text_df_processed, fba_df_processed], ignore_index=True)
    
    # Add dataset source identifier
    merged_df['data_source'] = ['text_dataset'] * len(text_df_processed) + ['fba_dataset'] * len(fba_df_processed)
    
    logger.info(f"Merged dataset shape: {merged_df.shape}")
    
    return merged_df

def process_text_dataset(df):
    """
    Process the text-based dataset to match the unified structure
    """
    logger.info("Processing text dataset...")
    
    # Create a standardized structure
    processed_df = pd.DataFrame()
    
    # Map existing columns
    processed_df['claim_id'] = df['id']
    processed_df['text'] = df['text']
    processed_df['claimable'] = df['label']
    processed_df['label_name'] = df['label_name']
    
    # Add missing columns with default values
    processed_df['claim_type'] = 'text_based_claim'
    processed_df['asin'] = 'N/A'
    processed_df['units'] = 1
    processed_df['amount'] = np.random.uniform(10, 500, len(df))  # Generate reasonable amounts
    processed_df['marketplace'] = 'US'  # Default to US
    processed_df['date'] = pd.Timestamp.now().strftime('%Y-%m-%d')
    
    # Extract additional features from text
    processed_df['text_length'] = df['text'].str.len()
    processed_df['word_count'] = df['text'].str.split().str.len()
    
    # Extract order numbers from text (common pattern)
    order_pattern = r'order\s+(\d{3}-\d{7}-\d{7})'
    processed_df['extracted_order_id'] = df['text'].str.extract(order_pattern, expand=False)
    
    # Extract monetary amounts from text
    amount_pattern = r'\$(\d+(?:\.\d{2})?)'
    extracted_amounts = df['text'].str.extract(amount_pattern, expand=False)
    processed_df['extracted_amount'] = pd.to_numeric(extracted_amounts, errors='coerce')
    
    # Use extracted amount if available, otherwise use generated
    processed_df['amount'] = processed_df['extracted_amount'].fillna(processed_df['amount'])
    
    return processed_df

def process_fba_dataset(df):
    """
    Process the structured FBA dataset to match the unified structure
    """
    logger.info("Processing FBA dataset...")
    
    # Create a standardized structure
    processed_df = pd.DataFrame()
    
    # Map existing columns
    processed_df['claim_id'] = df['id']
    processed_df['claimable'] = df['label']
    processed_df['claim_type'] = df['claim_type']
    processed_df['asin'] = df['asin']
    processed_df['units'] = df['units']
    processed_df['amount'] = df['amount']
    processed_df['marketplace'] = df['marketplace']
    processed_df['date'] = df['date']
    
    # Generate text descriptions based on structured data
    processed_df['text'] = df.apply(generate_fba_text_description, axis=1)
    
    # Add missing columns
    processed_df['label_name'] = 'claim'  # All FBA data are claims
    processed_df['text_length'] = processed_df['text'].str.len()
    processed_df['word_count'] = processed_df['text'].str.split().str.len()
    processed_df['extracted_order_id'] = 'N/A'
    processed_df['extracted_amount'] = processed_df['amount']
    
    return processed_df

def generate_fba_text_description(row):
    """
    Generate text description from FBA structured data
    """
    return f"Amazon warehouse lost {row['units']} units of ASIN {row['asin']} during transfer. Requesting reimbursement for ${row['amount']:.2f} in {row['marketplace']} marketplace."

def create_training_features(df):
    """
    Create additional features for training
    """
    logger.info("Creating training features...")
    
    # Create a copy to avoid modifying original
    df_features = df.copy()
    
    # Text-based features
    df_features['has_order_id'] = df_features['extracted_order_id'].notna().astype(int)
    df_features['has_amount'] = df_features['extracted_amount'].notna().astype(int)
    
    # Categorical encoding
    df_features['marketplace_encoded'] = pd.Categorical(df_features['marketplace']).codes
    df_features['claim_type_encoded'] = pd.Categorical(df_features['claim_type']).codes
    
    # Numerical features
    df_features['amount_log'] = np.log1p(df_features['amount'])
    df_features['units_log'] = np.log1p(df_features['units'])
    
    # Date features
    df_features['date'] = pd.to_datetime(df_features['date'], errors='coerce')
    df_features['year'] = df_features['date'].dt.year
    df_features['month'] = df_features['date'].dt.month
    df_features['day_of_week'] = df_features['date'].dt.dayofweek
    
    # Fill missing values
    df_features = df_features.fillna({
        'amount': df_features['amount'].median(),
        'units': df_features['units'].median(),
        'marketplace_encoded': 0,
        'claim_type_encoded': 0
    })
    
    return df_features

def save_merged_dataset(df, output_path='merged_fba_claims_dataset.csv'):
    """
    Save the merged dataset
    """
    logger.info(f"Saving merged dataset to {output_path}")
    
    # Create output directory if it doesn't exist
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    # Save to CSV
    df.to_csv(output_path, index=False)
    
    # Also save to the data directory for the training pipeline
    training_data_path = Path('claim_detector/data/merged_fba_claims_dataset.csv')
    df.to_csv(training_data_path, index=False)
    
    logger.info(f"Dataset saved to {output_path} and {training_data_path}")
    
    return output_path

def main():
    """
    Main function to merge the datasets
    """
    logger.info("Starting FBA claims dataset merge process...")
    
    try:
        # Load and merge datasets
        merged_df = load_and_merge_datasets()
        
        # Create training features
        features_df = create_training_features(merged_df)
        
        # Save merged dataset
        output_path = save_merged_dataset(features_df)
        
        # Print summary statistics
        logger.info("\n=== MERGED DATASET SUMMARY ===")
        logger.info(f"Total samples: {len(features_df)}")
        logger.info(f"Claimable samples: {features_df['claimable'].sum()}")
        logger.info(f"Non-claimable samples: {(features_df['claimable'] == 0).sum()}")
        logger.info(f"Data sources: {features_df['data_source'].value_counts().to_dict()}")
        logger.info(f"Marketplaces: {features_df['marketplace'].value_counts().to_dict()}")
        logger.info(f"Claim types: {features_df['claim_type'].value_counts().to_dict()}")
        
        logger.info(f"\nDataset successfully merged and saved to: {output_path}")
        logger.info("The merged dataset is now ready for training the Claims Model!")
        
    except Exception as e:
        logger.error(f"Error during dataset merge: {e}")
        raise

if __name__ == "__main__":
    main()
