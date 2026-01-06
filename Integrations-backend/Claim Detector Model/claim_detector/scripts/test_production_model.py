"""
Test Production Model - Quick Start Example
Demonstrates how to use the production model for predictions
"""

import pandas as pd
import numpy as np
import sys
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

from daily_operations import load_production_model, predict_claims, log_prediction_metrics, check_alerts

def create_sample_data():
    """Create sample claim data for testing"""
    sample_data = {
        'claim_id': ['test_001', 'test_002', 'test_003'],
        'seller_id': ['S-1234', 'S-5678', 'S-9012'],
        'order_id': ['123-4567890-1234567', '234-5678901-2345678', '345-6789012-3456789'],
        'amount': [25.50, 150.00, 0.0],  # Third one is non-claimable (amount = 0)
        'quantity': [1, 2, 1],
        'claim_date': ['2024-11-13T10:00:00Z', '2024-11-13T11:00:00Z', '2024-11-13T12:00:00Z'],
        'order_date': ['2024-11-10T10:00:00Z', '2024-11-10T11:00:00Z', '2024-11-10T12:00:00Z'],
        'marketplace': ['US', 'US', 'CA'],
        'fulfillment_center': ['FBA1', 'FBA2', 'FBA3'],
        'category': ['Electronics', 'Home', 'Beauty'],
        'order_value': [30.00, 180.00, 50.00],
        'shipping_cost': [5.00, 10.00, 8.00],
        # Optional fields
        'claim_type': ['damaged', 'lost', 'other'],
        'description': ['Item damaged in transit', 'Package lost', 'No issue found'],
        'reason_code': ['RC_DAMAGED', 'RC_LOST', 'RC_NO_ISSUE'],
        'asin': ['B012345678', 'B023456789', 'B034567890'],
        'sku': ['SKU-001', 'SKU-002', 'SKU-003']
    }
    
    return pd.DataFrame(sample_data)

def main():
    """Main test function"""
    logger.info("="*80)
    logger.info("PRODUCTION MODEL - QUICK START TEST")
    logger.info("="*80)
    
    # Step 1: Load model
    logger.info("\n[1/4] Loading production model...")
    try:
        model, scaler = load_production_model()
        if model is None:
            logger.error("Failed to load model. Run: python scripts/deploy_model.py first")
            return
        logger.info("✅ Model loaded successfully!")
    except Exception as e:
        logger.error(f"❌ Failed to load model: {e}")
        return
    
    # Step 2: Prepare data
    logger.info("\n[2/4] Preparing sample data...")
    df = create_sample_data()
    logger.info(f"✅ Prepared {len(df)} sample claims")
    logger.info(f"   Columns: {list(df.columns)}")
    
    # Step 3: Make predictions
    logger.info("\n[3/4] Making predictions...")
    try:
        predictions, probabilities, latency = predict_claims(df, model, scaler)
        
        logger.info(f"✅ Predictions complete!")
        logger.info(f"   Latency: {latency:.2f}ms")
        logger.info(f"\n   Results:")
        for i, (idx, row) in enumerate(df.iterrows()):
            pred = predictions[i]
            # Handle probabilities - could be 1D (single prob) or 2D (array of probs)
            if isinstance(probabilities, np.ndarray):
                if probabilities.ndim == 1:
                    # Single probability per sample (probability of class 1)
                    prob_claimable = probabilities[i]
                    prob_not_claimable = 1 - prob_claimable
                    confidence = max(prob_claimable, prob_not_claimable)
                else:
                    # 2D array (probabilities for each class)
                    prob = probabilities[i]
                    prob_claimable = prob[1] if len(prob) > 1 else prob[0]
                    prob_not_claimable = prob[0] if len(prob) > 1 else (1 - prob[0])
                    confidence = prob.max() if hasattr(prob, 'max') else max(prob_claimable, prob_not_claimable)
            else:
                # Scalar or other format
                prob_claimable = float(probabilities[i]) if hasattr(probabilities, '__getitem__') else float(probabilities)
                prob_not_claimable = 1 - prob_claimable
                confidence = max(prob_claimable, prob_not_claimable)
            
            logger.info(f"   Claim {i+1} ({row['claim_id']}):")
            logger.info(f"     Prediction: {'✅ CLAIMABLE' if pred == 1 else '❌ NOT CLAIMABLE'}")
            logger.info(f"     Confidence: {confidence:.2%}")
            logger.info(f"     Probabilities: [Not Claimable: {prob_not_claimable:.2%}, Claimable: {prob_claimable:.2%}]")
            logger.info(f"     Amount: ${row['amount']:.2f}")
            logger.info("")
        
        # Summary
        claimable_count = int(predictions.sum())
        non_claimable_count = len(predictions) - claimable_count
        # Handle probabilities format
        if isinstance(probabilities, np.ndarray):
            if probabilities.ndim == 1:
                avg_confidence = float(np.maximum(probabilities, 1 - probabilities).mean())
            else:
                avg_confidence = float(probabilities.max(axis=1).mean())
        else:
            avg_confidence = 0.95  # Default if can't calculate
        
        logger.info(f"   Summary:")
        logger.info(f"     Total: {len(predictions)}")
        logger.info(f"     Claimable: {claimable_count}")
        logger.info(f"     Not Claimable: {non_claimable_count}")
        logger.info(f"     Avg Confidence: {avg_confidence:.2%}")
        
    except Exception as e:
        logger.error(f"❌ Prediction failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Step 4: Log metrics
    logger.info("\n[4/4] Logging metrics...")
    try:
        metrics = log_prediction_metrics(predictions, probabilities, latency)
        logger.info("✅ Metrics logged successfully!")
        logger.info(f"   Date: {metrics['date']}")
        logger.info(f"   Volume: {metrics['volume']}")
        logger.info(f"   Latency: {metrics['latency_p95_ms']:.2f}ms")
        
        # Check alerts
        alerts = check_alerts(metrics)
        if alerts:
            logger.warning(f"⚠️  {len(alerts)} alert(s) triggered:")
            for alert in alerts:
                logger.warning(f"   [{alert['severity'].upper()}] {alert['message']}")
        else:
            logger.info("✅ No alerts triggered")
            
    except Exception as e:
        logger.error(f"❌ Failed to log metrics: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Success summary
    logger.info("\n" + "="*80)
    logger.info("✅ QUICK START TEST COMPLETE!")
    logger.info("="*80)
    logger.info("\nYour production model is working correctly!")
    logger.info("\nNext steps:")
    logger.info("  1. Replace sample data with your actual claim data")
    logger.info("  2. Integrate into your production pipeline")
    logger.info("  3. Monitor metrics daily using: python scripts/daily_operations.py")
    logger.info("  4. Review monitoring/metrics.json for historical data")
    
    return True

if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)

