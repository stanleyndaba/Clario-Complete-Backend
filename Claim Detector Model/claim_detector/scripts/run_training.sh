#!/bin/bash

# Training script for FBA reimbursement claim detection model

set -e  # Exit on any error

echo "Starting FBA reimbursement claim detection model training..."

# Set environment variables
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
export CUDA_VISIBLE_DEVICES=0  # Use first GPU if available

# Create necessary directories
mkdir -p data/raw data/processed models/registry logs

# Run data ingestion and preparation
echo "Step 1: Data ingestion and preparation..."
python -m src.data_ingestion.fetch_data

# Run feature engineering
echo "Step 2: Feature engineering..."
python -c "
from src.features.behavioral_features import BehavioralFeatureEngineer
from src.features.text_embeddings import TextEmbeddingEngineer
from src.features.anomaly_signals import AnomalySignalEngineer
from src.data_ingestion.fetch_data import DataIngestion
import pandas as pd

# Load data
ingestion = DataIngestion()
df = ingestion.generate_synthetic_data(n_samples=10000)

# Engineer features
behavioral_engineer = BehavioralFeatureEngineer()
text_engineer = TextEmbeddingEngineer()
anomaly_engineer = AnomalySignalEngineer()

# Apply feature engineering
df_features = behavioral_engineer.engineer_all_behavioral_features(df)
df_features = text_engineer.engineer_all_text_features(df_features)
df_features = anomaly_engineer.engineer_all_anomaly_features(df_features)

# Save processed data
df_features.to_csv('data/processed/engineered_features.csv', index=False)
print(f'Feature engineering completed. Shape: {df_features.shape}')
"

# Run model training
echo "Step 3: Model training..."
python -c "
from src.models.train_model import ModelTrainer
import pandas as pd

# Load engineered data
df = pd.read_csv('data/processed/engineered_features.csv')

# Train model
trainer = ModelTrainer()
results = trainer.run_complete_training_pipeline()

print('Training completed successfully!')
print(f'Test AUC: {results[\"training_results\"][\"training_results\"][\"test_auc\"]:.4f}')
print(f'Feature count: {results[\"data_info\"][\"feature_count\"]}')
"

# Run model evaluation
echo "Step 4: Model evaluation..."
python -c "
from src.models.ensemble import HybridEnsembleModel
from src.data_ingestion.fetch_data import DataIngestion
import pandas as pd

# Load model
model = HybridEnsembleModel()
model.load_model('models/claim_detector_model.pkl')

# Load test data
ingestion = DataIngestion()
test_data = ingestion.generate_synthetic_data(n_samples=1000)

# Make predictions
predictions = model.predict(test_data)

print('Model evaluation completed!')
print(f'Predictions shape: {len(predictions[\"predictions\"])}')
print(f'Average probability: {predictions[\"probabilities\"].mean():.4f}')
"

# Generate model documentation
echo "Step 5: Generating model documentation..."
python -c "
import json
from pathlib import Path

# Load model metadata
metadata_path = Path('models/registry/model_metadata.json')
if metadata_path.exists():
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
    
    # Create documentation
    doc = f'''
# Model Training Report

## Training Date
{metadata.get('model_info', {}).get('training_date', 'Unknown')}

## Model Components
{', '.join(metadata.get('model_info', {}).get('model_components', []))}

## Feature Count
{metadata.get('model_info', {}).get('feature_count', 0)}

## Performance Metrics
{json.dumps(metadata.get('training_results', {}).get('training_results', {}), indent=2)}
'''
    
    with open('models/README.md', 'w') as f:
        f.write(doc)
    
    print('Model documentation generated!')
"

echo "Training pipeline completed successfully!"
echo "Model saved to: models/claim_detector_model.pkl"
echo "Metadata saved to: models/registry/model_metadata.json"
echo "Documentation saved to: models/README.md"

# Optional: Run tests
if [ "$1" = "--test" ]; then
    echo "Running tests..."
    python -m pytest tests/ -v
fi

echo "All done! 🎉" 