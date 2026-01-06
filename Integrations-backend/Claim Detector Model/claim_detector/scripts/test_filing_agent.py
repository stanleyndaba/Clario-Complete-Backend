"""
Filing Agent - Standalone Test
Tests Filing Agent with sample evidence packages.
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

# Import Filing Agent
from src.filing.filing_agent_service import FilingAgentService


def create_sample_evidence_package(claim_id: str = "TEST-CLM-001") -> dict:
    """Create a sample evidence package for testing"""
    return {
        "claim_id": claim_id,
        "claim_metadata": {
            "sku": "SKU-001",
            "asin": "B012345678",
            "order_id": "123-4567890-1234567",
            "amount": 150.0,
            "quantity": 2,
            "claim_type": "lost",
            "marketplace": "US",
            "fulfillment_center": "FBA1",
            "order_date": "2024-01-15T00:00:00Z",
            "claim_date": "2024-01-20T00:00:00Z"
        },
        "evidence_documents": [
            {
                "document_id": "INV-TEST-CLM-001",
                "document_type": "invoice",
                "metadata": {
                    "supplier_name": "Quality Goods Supply",
                    "invoice_number": "INV-1234567",
                    "invoice_date": "2024-01-08",
                    "total_amount": 150.0,
                    "currency": "USD"
                },
                "parsed_metadata": {
                    "supplier_name": "Quality Goods Supply",
                    "invoice_number": "INV-1234567",
                    "total_amount": 150.0
                },
                "parsing_method": "mock_generator",
                "parsing_confidence": 0.95,
                "extracted_text": "Sample invoice text"
            }
        ],
        "match_results": [
            {
                "document_id": "INV-TEST-CLM-001",
                "match_score": 0.95,
                "matched_fields": ["order_id", "amount"],
                "reasoning": "Exact Order ID match",
                "confidence": 0.95
            }
        ],
        "best_match": {
            "document_id": "INV-TEST-CLM-001",
            "match_score": 0.95,
            "confidence": 0.95
        },
        "action": "auto_submit",
        "confidence": 0.95,
        "processing_timestamp": datetime.now().isoformat(),
        "agent_version": "1.0.0"
    }


def test_single_claim():
    """Test processing a single claim"""
    logger.info("\n" + "="*80)
    logger.info("TEST 1: Single Claim Processing")
    logger.info("="*80)
    
    # Create sample evidence package
    evidence_package = create_sample_evidence_package()
    
    # Initialize Filing Agent
    logger.info("Initializing Filing Agent...")
    filing_agent = FilingAgentService(seed=42, approval_rate=0.85)
    
    # Process claim
    logger.info(f"Processing claim {evidence_package['claim_id']} through Filing Agent")
    claim_status = filing_agent.process_evidence_package(evidence_package)
    
    # Display results
    logger.info("\n✅ Claim Status Generated:")
    logger.info(f"   Claim ID: {claim_status['claim_id']}")
    logger.info(f"   Amazon Case ID: {claim_status.get('amazon_case_id', 'N/A')}")
    logger.info(f"   Status: {claim_status['status']}")
    logger.info(f"   Amount: ${claim_status['amount']:.2f}")
    logger.info(f"   Filed At: {claim_status.get('filed_at', 'N/A')}")
    
    # Save to output
    output_dir = Path(__file__).parent.parent / 'output' / 'filing'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    status_file = output_dir / f"claim_status_{claim_status['claim_id']}.json"
    with open(status_file, 'w', encoding='utf-8') as f:
        json.dump(claim_status, f, indent=2, default=str)
    
    logger.info(f"\n✅ Claim status saved to: {status_file}")
    
    return claim_status


def test_batch_claims(count: int = 5):
    """Test processing multiple claims"""
    logger.info("\n" + "="*80)
    logger.info(f"TEST 2: Batch Processing ({count} claims)")
    logger.info("="*80)
    
    # Create sample evidence packages
    evidence_packages = []
    for i in range(count):
        claim_id = f"TEST-CLM-{i+1:03d}"
        evidence_package = create_sample_evidence_package(claim_id)
        evidence_packages.append(evidence_package)
    
    # Initialize Filing Agent
    logger.info("Initializing Filing Agent...")
    filing_agent = FilingAgentService(seed=42, approval_rate=0.85)
    
    # Process batch
    logger.info(f"Processing {len(evidence_packages)} claims through Filing Agent...")
    claim_statuses = filing_agent.process_batch_claims(evidence_packages)
    
    # Get summary
    summary = filing_agent.get_processing_summary()
    logger.info(f"\n✅ Batch Processing Complete:")
    logger.info(f"   Processed: {summary['total_processed']} claims")
    logger.info(f"   Status Distribution: {summary['status_distribution']}")
    logger.info(f"   Total Amount: ${summary['total_amount']:.2f}")
    logger.info(f"   Approval Rate: {summary['approval_rate']:.1f}%")
    
    # Export
    output_dir = Path(__file__).parent.parent / 'output' / 'filing'
    export_summary = filing_agent.export_claim_statuses(claim_statuses, output_dir)
    
    logger.info(f"\n✅ Exported {export_summary['total_exported']} claim statuses")
    logger.info(f"   Batch File: {export_summary['batch_file']}")
    
    return claim_statuses


def test_status_simulation():
    """Test status lifecycle simulation"""
    logger.info("\n" + "="*80)
    logger.info("TEST 3: Status Lifecycle Simulation")
    logger.info("="*80)
    
    # Create sample evidence package
    evidence_package = create_sample_evidence_package("TEST-CLM-SIM")
    
    # Initialize Filing Agent
    filing_agent = FilingAgentService(seed=42, approval_rate=0.85)
    
    # Process claim
    claim_status = filing_agent.process_evidence_package(evidence_package)
    logger.info(f"Initial Status: {claim_status['status']}")
    
    # Simulate status updates
    logger.info("Simulating status updates (7 days forward)...")
    updated_statuses = filing_agent.simulate_status_updates(days_forward=7)
    
    if updated_statuses:
        updated_status = updated_statuses[0]
        logger.info(f"Updated Status: {updated_status['status']}")
        logger.info(f"Status History: {len(updated_status.get('status_history', []))} transitions")
        
        for history_entry in updated_status.get('status_history', []):
            logger.info(f"   - {history_entry['status']} at {history_entry.get('timestamp', 'N/A')}")
    
    return updated_statuses


def main():
    """Main test function"""
    logger.info("="*80)
    logger.info("FILING AGENT - STANDALONE TEST")
    logger.info("="*80)
    
    # Test 1: Single claim
    test_single_claim()
    
    # Test 2: Batch processing
    test_batch_claims(count=5)
    
    # Test 3: Status simulation
    test_status_simulation()
    
    logger.info("\n" + "="*80)
    logger.info("✅ FILING AGENT TEST COMPLETE")
    logger.info("="*80)


if __name__ == '__main__':
    main()






