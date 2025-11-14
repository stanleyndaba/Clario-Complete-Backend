"""
Discovery Agent → Evidence Agent Integration
Runs Discovery Agent predictions, then processes through Evidence Agent
"""

import pandas as pd
import numpy as np
import sys
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional
import json

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))
sys.path.insert(0, str(script_dir.parent))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import Discovery Agent functions
from daily_operations import (
    load_production_model,
    predict_claims,
    export_claims_to_evidence_agent
)

# Import Evidence Agent
try:
    from src.evidence.evidence_agent_service import EvidenceAgentService
except ImportError:
    sys.path.insert(0, str(script_dir.parent / 'claim_detector'))
    from src.evidence.evidence_agent_service import EvidenceAgentService


def run_discovery_agent(df: pd.DataFrame, model, scaler, 
                       confidence_threshold: float = 0.50) -> pd.DataFrame:
    """
    Run Discovery Agent predictions on dataset
    
    Args:
        df: DataFrame with claim data
        model: Trained model
        scaler: Feature scaler
        confidence_threshold: Minimum confidence for claimable claims
        
    Returns:
        DataFrame with predictions and metadata
    """
    logger.info("="*80)
    logger.info("STEP 1: DISCOVERY AGENT - Running Predictions")
    logger.info("="*80)
    
    # Make predictions
    logger.info(f"Making predictions on {len(df)} claims...")
    predictions, probabilities, latency = predict_claims(df, model, scaler)
    
    # Handle probabilities format
    if isinstance(probabilities, np.ndarray):
        if probabilities.ndim == 1:
            # 1D array: probability of class 1
            confidence_scores = probabilities
        else:
            # 2D array: probabilities for each class
            confidence_scores = probabilities[:, 1] if probabilities.shape[1] > 1 else probabilities[:, 0]
    else:
        confidence_scores = np.array([0.95] * len(predictions))
    
    # Add predictions to dataframe
    df_result = df.copy()
    df_result['model_prediction'] = predictions
    df_result['confidence'] = confidence_scores
    
    # Log summary
    claimable_count = int(predictions.sum())
    non_claimable_count = len(predictions) - claimable_count
    
    logger.info(f"\n✅ Discovery Agent Complete:")
    logger.info(f"   Total Claims: {len(df)}")
    logger.info(f"   Claimable (1): {claimable_count}")
    logger.info(f"   Not Claimable (0): {non_claimable_count}")
    logger.info(f"   Avg Confidence: {confidence_scores.mean():.2%}")
    logger.info(f"   Latency: {latency:.2f}ms")
    
    return df_result


def run_evidence_agent(claimable_df: pd.DataFrame, 
                      limit: Optional[int] = None) -> list:
    """
    Run Evidence Agent on claimable claims
    
    Args:
        claimable_df: DataFrame with claimable claims
        limit: Optional limit for testing
        
    Returns:
        List of evidence packages
    """
    logger.info("\n" + "="*80)
    logger.info("STEP 2: EVIDENCE AGENT - Processing Claims")
    logger.info("="*80)
    
    # Limit for testing if specified
    if limit:
        claimable_df = claimable_df.head(limit)
        logger.info(f"Processing first {limit} claims (testing mode)")
    
    # Convert to list of dicts
    claims = claimable_df.to_dict('records')
    
    # Initialize Evidence Agent
    logger.info("Initializing Evidence Agent...")
    evidence_agent = EvidenceAgentService(seed=42)
    
    # Process batch
    logger.info(f"Processing {len(claims)} claims through Evidence Agent...")
    evidence_packages = evidence_agent.process_batch_claims(claims)
    
    # Get summary
    summary = evidence_agent.get_processing_summary()
    logger.info(f"\n✅ Evidence Agent Complete:")
    logger.info(f"   Processed: {summary['total_processed']} claims")
    logger.info(f"   Action Distribution: {summary['action_distribution']}")
    logger.info(f"   Avg Confidence: {summary['avg_confidence']:.2%}")
    
    return evidence_packages


def main():
    """Main execution function"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Discovery Agent → Evidence Agent Pipeline")
    parser.add_argument('--data-path', type=str,
                       default=None,
                       help='Path to processed_claims.csv (default: data/ml-training/processed_claims.csv)')
    parser.add_argument('--limit', type=int,
                       default=None,
                       help='Limit number of claims to process (for testing)')
    parser.add_argument('--confidence-threshold', type=float,
                       default=0.50,
                       help='Minimum confidence for claimable claims (default: 0.50)')
    parser.add_argument('--output-dir', type=str,
                       default=None,
                       help='Output directory (default: output/)')
    
    args = parser.parse_args()
    
    logger.info("="*80)
    logger.info("DISCOVERY AGENT → EVIDENCE AGENT PIPELINE")
    logger.info("="*80)
    
    # Get paths
    project_root = Path(__file__).parent.parent
    if args.data_path:
        data_path = Path(args.data_path)
    else:
        # Try relative to claim_detector first, then workspace root
        data_path = project_root.parent.parent / 'data' / 'ml-training' / 'processed_claims.csv'
        if not data_path.exists():
            data_path = Path(__file__).parent.parent.parent.parent / 'data' / 'ml-training' / 'processed_claims.csv'
    
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = project_root / 'output'
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Load data
    logger.info(f"\n[1/4] Loading data from {data_path}")
    if not data_path.exists():
        logger.error(f"❌ Data file not found: {data_path}")
        logger.info("\nPlease ensure processed_claims.csv exists at:")
        logger.info(f"   {data_path}")
        return
    
    df = pd.read_csv(data_path)
    logger.info(f"✅ Loaded {len(df)} claims from dataset")
    
    # Step 2: Load Discovery Agent model
    logger.info("\n[2/4] Loading Discovery Agent model...")
    model, scaler = load_production_model()
    if model is None:
        logger.error("❌ Failed to load Discovery Agent model")
        logger.info("Run: python scripts/deploy_model.py first")
        return
    logger.info("✅ Discovery Agent model loaded")
    
    # Step 3: Run Discovery Agent
    logger.info("\n[3/4] Running Discovery Agent predictions...")
    df_with_predictions = run_discovery_agent(df, model, scaler, args.confidence_threshold)
    
    # Export Discovery Agent results
    discovery_output_dir = output_dir / 'discovery'
    export_result = export_claims_to_evidence_agent(
        df_with_predictions,
        output_dir=discovery_output_dir,
        confidence_threshold=args.confidence_threshold
    )
    
    if export_result:
        logger.info(f"\n✅ Discovery Agent exports:")
        logger.info(f"   Claimable: {export_result['claimable_count']} claims")
        logger.info(f"   Not Claimable: {export_result['non_claimable_count']} claims")
        logger.info(f"   Evidence Queue: {export_result['evidence_queue_path']}")
    
    # Step 4: Run Evidence Agent
    logger.info("\n[4/4] Running Evidence Agent...")
    
    # Load claimable claims
    claimable_path = discovery_output_dir / 'claimable_claims.csv'
    if not claimable_path.exists():
        logger.error(f"❌ claimable_claims.csv not found at {claimable_path}")
        return
    
    claimable_df = pd.read_csv(claimable_path)
    logger.info(f"✅ Loaded {len(claimable_df)} claimable claims")
    
    # Process through Evidence Agent
    evidence_packages = run_evidence_agent(claimable_df, limit=args.limit)
    
    # Export Evidence Agent results
    evidence_output_dir = output_dir / 'evidence'
    evidence_agent = EvidenceAgentService(seed=42)
    export_summary = evidence_agent.export_evidence_packages(evidence_packages, evidence_output_dir)
    
    logger.info(f"\n✅ Evidence Agent exports:")
    logger.info(f"   Packages: {export_summary['total_packages']} files")
    logger.info(f"   Batch File: {export_summary['batch_file']}")
    
    # Final summary
    logger.info("\n" + "="*80)
    logger.info("PIPELINE SUMMARY")
    logger.info("="*80)
    logger.info(f"Discovery Agent:")
    logger.info(f"   Input: {len(df)} claims")
    logger.info(f"   Claimable: {export_result['claimable_count']} claims")
    logger.info(f"   Output: {export_result['evidence_queue_path']}")
    logger.info(f"\nEvidence Agent:")
    logger.info(f"   Input: {len(claimable_df)} claimable claims")
    logger.info(f"   Processed: {len(evidence_packages)} claims")
    logger.info(f"   Output: {export_summary['total_packages']} evidence packages")
    logger.info(f"\nOutput Directory: {output_dir}")
    logger.info("\n✅ DISCOVERY → EVIDENCE PIPELINE COMPLETE!")
    logger.info("="*80)


if __name__ == '__main__':
    main()

