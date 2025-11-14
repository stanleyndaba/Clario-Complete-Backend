"""
Daily Operations Script
Quick reference implementation for daily model operations
"""

import pickle
import pandas as pd
import json
import logging
from pathlib import Path
from datetime import datetime
import sys
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Get project root
project_root = script_dir.parent.parent
deployment_dir = project_root / 'deployment'
monitoring_dir = project_root / 'monitoring'

def load_production_model():
    """Load production model"""
    from train_98_percent_model import Ensemble98Model
    
    model_path = deployment_dir / 'claim_detector.pkl'
    scaler_path = deployment_dir / 'scaler.pkl'
    
    if not model_path.exists():
        logger.error(f"Model not found: {model_path}")
        logger.info("Run: python scripts/deploy_model.py first")
        return None, None
    
    # Load using Ensemble98Model.load (it expects model_path and scaler_path)
    try:
        model = Ensemble98Model()
        model.load(str(model_path), str(scaler_path))
    except Exception as e:
        logger.warning(f"Failed to load using Ensemble98Model.load: {e}")
        # Fallback to direct pickle load
        with open(model_path, 'rb') as f:
            model_dict = pickle.load(f)
            # If it's a dict, extract the model
            if isinstance(model_dict, dict):
                model = model_dict.get('ensemble') or model_dict.get('model')
            else:
                model = model_dict
    
    with open(scaler_path, 'rb') as f:
        scaler = pickle.load(f)
    
    logger.info("Production model loaded successfully")
    return model, scaler

def predict_claims(df: pd.DataFrame, model, scaler):
    """
    Predict claims using production model
    
    Args:
        df: DataFrame with claim data (required columns: see PRODUCTION_DEPLOYMENT_GUIDE.md)
        model: Trained model (Ensemble98Model instance)
        scaler: Feature scaler
    
    Returns:
        predictions: Array of predictions (0 or 1)
        probabilities: Array of probability arrays [prob_class_0, prob_class_1]
        latency_ms: Inference latency in milliseconds
    """
    from train_98_percent_model import SmartFeatureEngineer
    
    start_time = time.time()
    
    # Engineer features
    engineer = SmartFeatureEngineer()
    features = engineer.engineer_features(df)
    
    # Use model's predict method which handles feature engineering internally
    # The model's predict method expects a DataFrame and will use its internal feature engineering
    if hasattr(model, 'predict') and hasattr(model, 'is_trained') and model.is_trained:
        # Use the model's predict method which handles feature columns
        predictions, probabilities = model.predict(features)
    else:
        # Fallback: direct prediction if model is just the LightGBM model
        predictions = model.predict(features.values)
        probabilities = model.predict_proba(features.values)
    
    latency_ms = (time.time() - start_time) * 1000
    
    return predictions, probabilities, latency_ms

def log_prediction_metrics(predictions, probabilities, latency_ms, date=None):
    """Log prediction metrics for monitoring"""
    if date is None:
        date = datetime.now().date().isoformat()
    
    metrics_path = monitoring_dir / 'metrics.json'
    
    # Load existing metrics
    if metrics_path.exists():
        with open(metrics_path, 'r') as f:
            metrics = json.load(f)
    else:
        metrics = {
            'daily_metrics': [],
            'weekly_metrics': [],
            'monthly_metrics': [],
            'alerts': []
        }
    
    # Calculate metrics
    import numpy as np
    volume = len(predictions)
    claimable_count = int(predictions.sum())
    non_claimable_count = volume - claimable_count
    
    # Handle probabilities format (could be 1D or 2D)
    if isinstance(probabilities, np.ndarray):
        if probabilities.ndim == 1:
            # 1D array: probability of class 1 for each sample
            avg_confidence = float(np.maximum(probabilities, 1 - probabilities).mean())
        else:
            # 2D array: probabilities for each class
            avg_confidence = float(probabilities.max(axis=1).mean())
    else:
        avg_confidence = 0.95  # Default
    
    daily_metric = {
        'date': date,
        'volume': volume,
        'claimable_count': claimable_count,
        'non_claimable_count': non_claimable_count,
        'avg_confidence': avg_confidence,
        'latency_p50_ms': latency_ms,  # Simplified - should calculate from batch
        'latency_p95_ms': latency_ms,
        'latency_p99_ms': latency_ms
    }
    
    # Add to daily metrics
    metrics['daily_metrics'].append(daily_metric)
    metrics['last_updated'] = datetime.now().isoformat()
    
    # Keep only last 90 days
    if len(metrics['daily_metrics']) > 90:
        metrics['daily_metrics'] = metrics['daily_metrics'][-90:]
    
    # Save
    with open(metrics_path, 'w') as f:
        json.dump(metrics, f, indent=2)
    
    logger.info(f"Metrics logged: {volume} predictions, {claimable_count} claimable, latency: {latency_ms:.2f}ms")
    
    return daily_metric

def check_alerts(metrics):
    """Check if any alerts should be triggered"""
    config_path = monitoring_dir / 'monitoring_config.json'
    
    if not config_path.exists():
        logger.warning("Monitoring config not found - skipping alert checks")
        return []
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    alerts = []
    thresholds = config.get('alert_thresholds', {})
    
    # Check latency
    if metrics.get('latency_p95_ms', 0) > thresholds.get('critical', {}).get('latency_p95_exceeds_ms', 2000):
        alerts.append({
            'severity': 'critical',
            'type': 'latency_spike',
            'message': f"Latency P95 exceeds threshold: {metrics['latency_p95_ms']:.2f}ms"
        })
    
    # Add more alert checks as needed
    
    if alerts:
        logger.warning(f"Alerts triggered: {len(alerts)}")
        for alert in alerts:
            logger.warning(f"  [{alert['severity'].upper()}] {alert['message']}")
    
    return alerts

def export_claims_to_evidence_agent(predictions_df: pd.DataFrame, 
                                     output_dir: Path = None,
                                     confidence_threshold: float = 0.50):
    """
    Export claims to Evidence Agent
    
    Args:
        predictions_df: DataFrame with predictions, probabilities, and claim data
        output_dir: Directory to export files (default: project_root/exports)
        confidence_threshold: Minimum confidence for claimable claims (default: 0.50)
    
    Returns:
        dict with export paths and counts
    """
    import numpy as np
    
    if output_dir is None:
        output_dir = project_root / 'exports'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Ensure predictions_df has required columns
    if 'model_prediction' not in predictions_df.columns:
        logger.error("predictions_df must have 'model_prediction' column")
        return None
    
    if 'confidence' not in predictions_df.columns:
        # Calculate confidence from probabilities if available
        if 'probabilities' in predictions_df.columns:
            probs = predictions_df['probabilities']
            if isinstance(probs.iloc[0], (list, np.ndarray)):
                predictions_df['confidence'] = probs.apply(lambda x: max(x) if isinstance(x, (list, np.ndarray)) else x)
            else:
                predictions_df['confidence'] = probs
        else:
            logger.warning("No confidence column found, using default confidence=0.95")
            predictions_df['confidence'] = 0.95
    
    # Split into claimable and non-claimable
    claimable_df = predictions_df[
        (predictions_df['model_prediction'] == 1) & 
        (predictions_df['confidence'] >= confidence_threshold)
    ].copy()
    
    non_claimable_df = predictions_df[
        (predictions_df['model_prediction'] == 0) | 
        (predictions_df['confidence'] < confidence_threshold)
    ].copy()
    
    # Export claimable claims CSV
    claimable_path = output_dir / 'claimable_claims.csv'
    claimable_df.to_csv(claimable_path, index=False)
    logger.info(f"Exported {len(claimable_df)} claimable claims to {claimable_path}")
    
    # Export non-claimable claims CSV
    non_claimable_path = output_dir / 'non_claimable_claims.csv'
    non_claimable_df.to_csv(non_claimable_path, index=False)
    logger.info(f"Exported {len(non_claimable_df)} non-claimable claims to {non_claimable_path}")
    
    # Export evidence queue JSON
    evidence_queue_path = output_dir / 'evidence_queue.json'
    evidence_queue = {
        "export_timestamp": datetime.now().isoformat(),
        "total_claims": len(claimable_df),
        "filters_applied": {
            "confidence_threshold": confidence_threshold,
            "model_prediction": 1
        },
        "claims": claimable_df.to_dict('records')
    }
    
    with open(evidence_queue_path, 'w', encoding='utf-8') as f:
        json.dump(evidence_queue, f, indent=2, default=str)
    
    logger.info(f"Exported evidence queue to {evidence_queue_path}")
    
    return {
        'claimable_path': str(claimable_path),
        'non_claimable_path': str(non_claimable_path),
        'evidence_queue_path': str(evidence_queue_path),
        'claimable_count': len(claimable_df),
        'non_claimable_count': len(non_claimable_df),
        'total_count': len(predictions_df)
    }

def main():
    """Main daily operations function"""
    logger.info("="*80)
    logger.info("DAILY OPERATIONS - CLAIM DETECTOR MODEL")
    logger.info("="*80)
    
    # Load model
    logger.info("\n[1/3] Loading production model...")
    model, scaler = load_production_model()
    if model is None:
        return
    
    # Example: Predict on sample data
    logger.info("\n[2/3] Example prediction...")
    logger.info("  (In production, load your actual claim data here)")
    
    # Create sample data structure
    sample_data = {
        'claim_id': ['sample_1'],
        'seller_id': ['S-1234'],
        'order_id': ['123-4567890-1234567'],
        'amount': [25.50],
        'quantity': [1],
        'claim_date': ['2024-11-13T10:00:00Z'],
        'order_date': ['2024-11-10T10:00:00Z'],
        'marketplace': ['US'],
        'fulfillment_center': ['FBA1'],
        'category': ['Electronics'],
        'order_value': [30.00],
        'shipping_cost': [5.00]
    }
    
    df = pd.DataFrame(sample_data)
    
    try:
        predictions, probabilities, latency_ms = predict_claims(df, model, scaler)
        logger.info(f"  Prediction: {'Claimable' if predictions[0] == 1 else 'Not Claimable'}")
        logger.info(f"  Confidence: {probabilities[0].max():.2%}")
        logger.info(f"  Latency: {latency_ms:.2f}ms")
    except Exception as e:
        logger.error(f"  Prediction failed: {e}")
        return
    
    # Log metrics
    logger.info("\n[3/3] Logging metrics...")
    metrics = log_prediction_metrics(predictions, probabilities, latency_ms)
    
    # Check alerts
    alerts = check_alerts(metrics)
    
    # Summary
    logger.info("\n" + "="*80)
    logger.info("DAILY OPERATIONS SUMMARY")
    logger.info("="*80)
    logger.info(f"Model Status: ✅ Loaded")
    logger.info(f"Predictions: {len(predictions)}")
    logger.info(f"Alerts: {len(alerts)}")
    logger.info("\n[SUCCESS] Daily operations complete!")
    
    return metrics

if __name__ == '__main__':
    main()

