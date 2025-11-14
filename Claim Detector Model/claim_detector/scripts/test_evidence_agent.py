"""
Test Evidence Agent Standalone
Tests the Evidence Agent with claims from Discovery Agent output
"""

import pandas as pd
import json
import sys
import logging
from pathlib import Path
from datetime import datetime

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

# Import Evidence Agent
try:
    from src.evidence.evidence_agent_service import EvidenceAgentService
except ImportError:
    # Try alternative path
    sys.path.insert(0, str(script_dir.parent / 'claim_detector'))
    from src.evidence.evidence_agent_service import EvidenceAgentService


def load_claimable_claims(csv_path: Path) -> pd.DataFrame:
    """Load claimable claims from Discovery Agent output"""
    logger.info(f"Loading claimable claims from {csv_path}")
    
    if not csv_path.exists():
        logger.error(f"File not found: {csv_path}")
        logger.info(f"Expected location: {csv_path}")
        logger.info("Run Discovery Agent first to generate claimable_claims.csv")
        return pd.DataFrame()
    
    df = pd.read_csv(csv_path)
    logger.info(f"✅ Loaded {len(df)} claimable claims")
    
    return df


def test_single_claim():
    """Test Evidence Agent with a single sample claim"""
    logger.info("="*80)
    logger.info("TEST 1: Single Claim Processing")
    logger.info("="*80)
    
    # Create sample claim
    sample_claim = {
        'claim_id': 'TEST-CLM-001',
        'sku': 'SKU-001',
        'asin': 'B012345678',
        'order_id': '123-4567890-1234567',
        'amount': 150.00,
        'quantity': 2,
        'claim_type': 'lost',
        'marketplace': 'US',
        'fulfillment_center': 'FBA1',
        'order_date': '2024-01-15T00:00:00Z',
        'claim_date': '2024-01-20T00:00:00Z',
        'shipping_cost': 10.00
    }
    
    # Initialize Evidence Agent
    evidence_agent = EvidenceAgentService(seed=42)
    
    # Process claim
    evidence_package = evidence_agent.process_claim_for_evidence(sample_claim)
    
    # Display results
    logger.info(f"\n✅ Evidence Package Generated:")
    logger.info(f"   Claim ID: {evidence_package['claim_id']}")
    logger.info(f"   Documents: {len(evidence_package['evidence_documents'])}")
    logger.info(f"   Best Match Confidence: {evidence_package.get('confidence', 0.0):.2%}")
    logger.info(f"   Action: {evidence_package.get('action', 'unknown')}")
    logger.info(f"   Bundle Status: {evidence_package['evidence_bundle']['bundle_status']}")
    
    # Save to file
    output_dir = Path(__file__).parent.parent / 'output' / 'evidence'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    output_file = output_dir / f"evidence_package_{sample_claim['claim_id']}.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(evidence_package, f, indent=2, default=str)
    
    logger.info(f"\n✅ Evidence package saved to: {output_file}")
    
    return evidence_package


def test_batch_claims(csv_path: Path, limit: int = 10):
    """Test Evidence Agent with batch of claims"""
    logger.info("\n" + "="*80)
    logger.info(f"TEST 2: Batch Processing (First {limit} Claims)")
    logger.info("="*80)
    
    # Load claims
    df = load_claimable_claims(csv_path)
    if df.empty:
        return []
    
    # Limit for testing
    df = df.head(limit)
    
    # Convert to list of dicts
    claims = df.to_dict('records')
    
    # Initialize Evidence Agent
    evidence_agent = EvidenceAgentService(seed=42)
    
    # Process batch
    evidence_packages = evidence_agent.process_batch_claims(claims)
    
    # Export
    output_dir = Path(__file__).parent.parent / 'output' / 'evidence'
    export_summary = evidence_agent.export_evidence_packages(evidence_packages, output_dir)
    
    # Display summary
    logger.info(f"\n✅ Batch Processing Complete:")
    logger.info(f"   Processed: {len(evidence_packages)} claims")
    logger.info(f"   Exported: {export_summary['total_packages']} packages")
    logger.info(f"   Output Directory: {output_dir}")
    
    # Get processing summary
    summary = evidence_agent.get_processing_summary()
    logger.info(f"\n📊 Processing Summary:")
    logger.info(f"   Total Processed: {summary['total_processed']}")
    logger.info(f"   Action Distribution: {summary['action_distribution']}")
    logger.info(f"   Avg Confidence: {summary['avg_confidence']:.2%}")
    
    return evidence_packages


def main():
    """Main test function"""
    logger.info("="*80)
    logger.info("EVIDENCE AGENT - STANDALONE TEST")
    logger.info("="*80)
    
    # Get project root
    project_root = Path(__file__).parent.parent
    data_dir = project_root.parent / 'data' / 'ml-training'
    
    # Test 1: Single claim
    test_single_claim()
    
    # Test 2: Batch processing (if claimable_claims.csv exists)
    claimable_csv = project_root / 'exports' / 'claimable_claims.csv'
    if not claimable_csv.exists():
        # Try alternative location
        claimable_csv = data_dir / 'claimable_claims.csv'
    
    if claimable_csv.exists():
        test_batch_claims(claimable_csv, limit=10)
    else:
        logger.warning(f"\n⚠️  claimable_claims.csv not found at {claimable_csv}")
        logger.info("   Run Discovery Agent first to generate claimable_claims.csv")
        logger.info("   Or use: python scripts/daily_operations.py")
    
    logger.info("\n" + "="*80)
    logger.info("✅ EVIDENCE AGENT TEST COMPLETE")
    logger.info("="*80)


if __name__ == '__main__':
    main()

