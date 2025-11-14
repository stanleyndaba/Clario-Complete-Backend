"""
Transparency Agent - Standalone Test
Tests Transparency Agent with sample claim statuses.
"""

import json
import logging
from pathlib import Path
from datetime import datetime
import sys

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

# Import Transparency Agent
from src.transparency.transparency_agent_service import TransparencyAgentService


def create_sample_claim_status(claim_id: str = "TEST-CLM-001", status: str = "APPROVED") -> dict:
    """Create a sample claim status for testing"""
    return {
        "claim_id": claim_id,
        "amazon_case_id": f"AMZ-{claim_id}",
        "status": status,
        "filed_at": "2025-11-14T10:00:00Z",
        "amount": 150.0,
        "quantity": 2,
        "claim_type": "lost",
        "marketplace": "US",
        "metadata": {
            "sku": "SKU-001",
            "asin": "B012345678",
            "order_id": "123-4567890-1234567"
        },
        "status_history": [
            {
                "status": "FILED",
                "timestamp": "2025-11-14T10:00:00Z",
                "amazon_case_id": f"AMZ-{claim_id}"
            },
            {
                "status": "IN_REVIEW",
                "timestamp": "2025-11-16T10:00:00Z",
                "amazon_case_id": f"AMZ-{claim_id}"
            },
            {
                "status": status,
                "timestamp": "2025-11-18T10:00:00Z",
                "amazon_case_id": f"AMZ-{claim_id}"
            }
        ],
        "approved_at": "2025-11-18T10:00:00Z" if status == "APPROVED" else None,
        "processing_timestamp": datetime.now().isoformat(),
        "agent_version": "1.0.0"
    }


def test_single_claim():
    """Test processing a single claim"""
    logger.info("\n" + "="*80)
    logger.info("TEST 1: Single Claim Processing")
    logger.info("="*80)
    
    # Create sample claim status
    claim_status = create_sample_claim_status("TEST-CLM-001", "APPROVED")
    
    # Initialize Transparency Agent
    logger.info("Initializing Transparency Agent...")
    transparency_agent = TransparencyAgentService(seed=42, reimbursement_rate=0.95)
    
    # Process claim
    logger.info(f"Processing claim {claim_status['claim_id']} through Transparency Agent")
    final_timeline = transparency_agent.process_claim_status(claim_status)
    
    # Display results
    logger.info("\n✅ Final Timeline Generated:")
    logger.info(f"   Claim ID: {final_timeline['claim_id']}")
    logger.info(f"   Current Status: {final_timeline['current_status']}")
    logger.info(f"   Timeline Events: {len(final_timeline['timeline'])}")
    logger.info(f"   Reconciliation Status: {final_timeline['reconciliation']['status']}")
    logger.info(f"   Expected Amount: ${final_timeline['reconciliation']['expected_amount']:.2f}")
    logger.info(f"   Actual Amount: ${final_timeline['reconciliation']['actual_amount']:.2f}")
    
    # Save to output
    output_dir = Path(__file__).parent.parent / 'output' / 'transparency'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    timeline_file = output_dir / f"final_timeline_{final_timeline['claim_id']}.json"
    with open(timeline_file, 'w', encoding='utf-8') as f:
        json.dump(final_timeline, f, indent=2, default=str)
    
    logger.info(f"\n✅ Final timeline saved to: {timeline_file}")
    
    return final_timeline


def test_batch_claims(count: int = 5):
    """Test processing multiple claims"""
    logger.info("\n" + "="*80)
    logger.info(f"TEST 2: Batch Processing ({count} claims)")
    logger.info("="*80)
    
    # Create sample claim statuses
    claim_statuses = []
    for i in range(count):
        claim_id = f"TEST-CLM-{i+1:03d}"
        status = "APPROVED" if i % 2 == 0 else "DENIED"
        claim_status = create_sample_claim_status(claim_id, status)
        claim_statuses.append(claim_status)
    
    # Initialize Transparency Agent
    logger.info("Initializing Transparency Agent...")
    transparency_agent = TransparencyAgentService(seed=42, reimbursement_rate=0.95)
    
    # Process batch
    logger.info(f"Processing {len(claim_statuses)} claims through Transparency Agent...")
    final_timelines = transparency_agent.process_batch_claims(claim_statuses)
    
    # Get summary
    summary = transparency_agent.get_processing_summary()
    logger.info(f"\n✅ Batch Processing Complete:")
    logger.info(f"   Processed: {summary['total_processed']} claims")
    logger.info(f"   Status Distribution: {summary['status_distribution']}")
    logger.info(f"   Total Amount: ${summary['total_amount']:.2f}")
    logger.info(f"   Reimbursed Amount: ${summary['reimbursed_amount']:.2f}")
    logger.info(f"   Reimbursement Rate: {summary['reimbursement_rate']:.1f}%")
    logger.info(f"   Reconciliation Rate: {summary['reconciliation']['reconciliation_rate']:.1f}%")
    
    # Export
    output_dir = Path(__file__).parent.parent / 'output' / 'transparency'
    export_summary = transparency_agent.export_final_timelines(final_timelines, output_dir)
    
    logger.info(f"\n✅ Exported {export_summary['total_exported']} final timelines")
    logger.info(f"   Batch File: {export_summary['batch_file']}")
    
    return final_timelines


def test_reconciliation():
    """Test reconciliation logic"""
    logger.info("\n" + "="*80)
    logger.info("TEST 3: Reconciliation Testing")
    logger.info("="*80)
    
    # Create claim with known amount
    claim_status = create_sample_claim_status("TEST-CLM-RECON", "APPROVED")
    claim_status['amount'] = 100.0
    
    # Initialize Transparency Agent
    transparency_agent = TransparencyAgentService(seed=42, reimbursement_rate=0.95)
    
    # Process claim
    final_timeline = transparency_agent.process_claim_status(claim_status)
    
    reconciliation = final_timeline.get('reconciliation', {})
    logger.info(f"Reconciliation Result:")
    logger.info(f"   Expected: ${reconciliation.get('expected_amount', 0):.2f}")
    logger.info(f"   Actual: ${reconciliation.get('actual_amount', 0):.2f}")
    logger.info(f"   Discrepancy: ${reconciliation.get('discrepancy', 0):.2f}")
    logger.info(f"   Status: {reconciliation.get('status', 'UNKNOWN')}")
    
    if reconciliation.get('status') == 'discrepancy':
        logger.info(f"   Discrepancy Type: {reconciliation.get('discrepancy_type', 'UNKNOWN')}")
        logger.info(f"   Discrepancy %: {reconciliation.get('discrepancy_percentage', 0):.2f}%")
    
    return final_timeline


def main():
    """Main test function"""
    logger.info("="*80)
    logger.info("TRANSPARENCY AGENT - STANDALONE TEST")
    logger.info("="*80)
    
    # Test 1: Single claim
    test_single_claim()
    
    # Test 2: Batch processing
    test_batch_claims(count=5)
    
    # Test 3: Reconciliation
    test_reconciliation()
    
    logger.info("\n" + "="*80)
    logger.info("✅ TRANSPARENCY AGENT TEST COMPLETE")
    logger.info("="*80)


if __name__ == '__main__':
    main()






