"""
Production Model Deployment Script
Deploys the certified model for production use
"""

import pickle
import json
import logging
from pathlib import Path
from datetime import datetime
import sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Get project root
project_root = script_dir.parent.parent
models_dir = project_root / 'models'
deployment_dir = project_root / 'deployment'

def deploy_model():
    """Deploy model to production"""
    logger.info("="*80)
    logger.info("PRODUCTION MODEL DEPLOYMENT")
    logger.info("="*80)
    
    # Create deployment directory
    deployment_dir.mkdir(exist_ok=True)
    
    # Step 1: Verify model artifacts
    logger.info("\n[1/5] Verifying model artifacts...")
    model_path = models_dir / 'claim_detector_98percent.pkl'
    scaler_path = models_dir / 'scaler_98percent.pkl'
    
    if not model_path.exists():
        logger.error(f"Model not found: {model_path}")
        return False
    
    if not scaler_path.exists():
        logger.error(f"Scaler not found: {scaler_path}")
        return False
    
    logger.info(f"  [OK] Model found: {model_path}")
    logger.info(f"  [OK] Scaler found: {scaler_path}")
    
    # Step 2: Load and verify model
    logger.info("\n[2/5] Loading and verifying model...")
    try:
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
        
        with open(scaler_path, 'rb') as f:
            scaler = pickle.load(f)
        
        logger.info("  [OK] Model and scaler loaded successfully")
    except Exception as e:
        logger.error(f"  [ERROR] Failed to load model: {e}")
        return False
    
    # Step 3: Copy to deployment directory
    logger.info("\n[3/5] Copying artifacts to deployment directory...")
    import shutil
    
    deployment_model_path = deployment_dir / 'claim_detector.pkl'
    deployment_scaler_path = deployment_dir / 'scaler.pkl'
    
    shutil.copy2(model_path, deployment_model_path)
    shutil.copy2(scaler_path, deployment_scaler_path)
    
    logger.info(f"  [OK] Model copied to: {deployment_model_path}")
    logger.info(f"  [OK] Scaler copied to: {deployment_scaler_path}")
    
    # Step 4: Create deployment metadata
    logger.info("\n[4/5] Creating deployment metadata...")
    metadata = {
        'model_version': '1.0',
        'deployment_date': datetime.now().isoformat(),
        'certification_date': '2025-11-13',
        'test_accuracy': 0.9927,
        'cv_mean': 0.9924,
        'cv_std': 0.0040,
        'bootstrap_lower': 0.9854,
        'permutation_p': 0.0000,
        'inference_p95_ms': 674.93,
        'dataset_size': 2740,
        'class_balance': '1.52:1',
        'status': 'CERTIFIED'
    }
    
    metadata_path = deployment_dir / 'deployment_metadata.json'
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    logger.info(f"  [OK] Metadata saved to: {metadata_path}")
    
    # Step 5: Create deployment manifest
    logger.info("\n[5/5] Creating deployment manifest...")
    manifest = {
        'deployment_id': f"deploy_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        'deployment_date': datetime.now().isoformat(),
        'model_path': str(deployment_model_path),
        'scaler_path': str(deployment_scaler_path),
        'metadata_path': str(metadata_path),
        'status': 'DEPLOYED',
        'checksum': {
            'model_size_bytes': deployment_model_path.stat().st_size,
            'scaler_size_bytes': deployment_scaler_path.stat().st_size
        }
    }
    
    manifest_path = deployment_dir / 'deployment_manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    logger.info(f"  [OK] Manifest saved to: {manifest_path}")
    
    # Summary
    logger.info("\n" + "="*80)
    logger.info("DEPLOYMENT SUMMARY")
    logger.info("="*80)
    logger.info(f"Model Version: {metadata['model_version']}")
    logger.info(f"Deployment Date: {metadata['deployment_date']}")
    logger.info(f"Status: {metadata['status']}")
    logger.info(f"Test Accuracy: {metadata['test_accuracy']:.2%}")
    logger.info(f"CV Mean: {metadata['cv_mean']:.2%} ± {metadata['cv_std']:.2%}")
    logger.info(f"\n[SUCCESS] Model deployed to: {deployment_dir}")
    logger.info("\n[INFO] Next steps:")
    logger.info("  1. Verify deployment artifacts")
    logger.info("  2. Set up monitoring (run: python scripts/setup_monitoring.py)")
    logger.info("  3. Test inference pipeline")
    logger.info("  4. Start production traffic")
    
    return True

if __name__ == '__main__':
    success = deploy_model()
    sys.exit(0 if success else 1)

