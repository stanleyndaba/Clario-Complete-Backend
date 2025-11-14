"""
Evidence Agent → Filing Agent Integration
Runs Evidence Agent outputs through Filing Agent to generate claim_status.json files.
"""

import pandas as pd
import json
import sys
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional

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


def load_evidence_packages(evidence_dir: Path, limit: Optional[int] = None) -> list:
    """
    Load evidence packages from evidence directory
    
    Args:
        evidence_dir: Directory containing evidence_package_*.json files
        limit: Optional limit for testing
        
    Returns:
        List of evidence package dictionaries
    """
    logger.info(f"Loading evidence packages from {evidence_dir}")
    
    if not evidence_dir.exists():
        logger.error(f"❌ Evidence directory not found: {evidence_dir}")
        return []
    
    # Find all evidence package files
    evidence_files = list(evidence_dir.glob("evidence_package_*.json"))
    
    if not evidence_files:
        logger.warning(f"⚠️  No evidence package files found in {evidence_dir}")
        return []
    
    # Sort by filename for consistency
    evidence_files.sort()
    
    # Apply limit if specified
    if limit:
        evidence_files = evidence_files[:limit]
        logger.info(f"Processing first {limit} evidence packages (testing mode)")
    
    # Load evidence packages
    evidence_packages = []
    for evidence_file in evidence_files:
        try:
            with open(evidence_file, 'r', encoding='utf-8') as f:
                evidence_package = json.load(f)
                evidence_packages.append(evidence_package)
        except Exception as e:
            logger.error(f"❌ Error loading {evidence_file}: {e}")
    
    logger.info(f"✅ Loaded {len(evidence_packages)} evidence packages")
    return evidence_packages


def run_filing_agent(evidence_packages: list, 
                    seed: int = 42,
                    approval_rate: float = 0.85) -> list:
    """
    Run Filing Agent on evidence packages
    
    Args:
        evidence_packages: List of evidence package dictionaries
        seed: Random seed for deterministic behavior
        approval_rate: Probability of claim approval
        
    Returns:
        List of claim status dictionaries
    """
    logger.info("\n" + "="*80)
    logger.info("STEP 2: FILING AGENT - Processing Claims")
    logger.info("="*80)
    
    # Initialize Filing Agent
    logger.info("Initializing Filing Agent...")
    filing_agent = FilingAgentService(seed=seed, approval_rate=approval_rate)
    
    # Process batch
    logger.info(f"Processing {len(evidence_packages)} claims through Filing Agent...")
    claim_statuses = filing_agent.process_batch_claims(evidence_packages)
    
    # Get summary
    summary = filing_agent.get_processing_summary()
    logger.info(f"\n✅ Filing Agent Complete:")
    logger.info(f"   Processed: {summary['total_processed']} claims")
    logger.info(f"   Filed: {summary['filed']} claims")
    logger.info(f"   Status Distribution: {summary['status_distribution']}")
    logger.info(f"   Total Amount: ${summary['total_amount']:.2f}")
    logger.info(f"   Approval Rate: {summary['approval_rate']:.1f}%")
    
    return claim_statuses


def main():
    """Main execution function"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Evidence Agent → Filing Agent Pipeline")
    parser.add_argument('--evidence-dir', type=str,
                       default=None,
                       help='Directory containing evidence packages (default: output/evidence)')
    parser.add_argument('--limit', type=int,
                       default=None,
                       help='Limit number of claims to process (for testing)')
    parser.add_argument('--seed', type=int,
                       default=42,
                       help='Random seed for deterministic behavior (default: 42)')
    parser.add_argument('--approval-rate', type=float,
                       default=0.85,
                       help='Probability of claim approval (default: 0.85)')
    parser.add_argument('--output-dir', type=str,
                       default=None,
                       help='Output directory (default: output/filing)')
    parser.add_argument('--simulate-days', type=int,
                       default=0,
                       help='Simulate status updates forward N days (default: 0)')
    
    args = parser.parse_args()
    
    logger.info("="*80)
    logger.info("EVIDENCE AGENT → FILING AGENT PIPELINE")
    logger.info("="*80)
    
    # Get paths
    project_root = Path(__file__).parent.parent
    if args.evidence_dir:
        evidence_dir = Path(args.evidence_dir)
    else:
        evidence_dir = project_root / 'output' / 'evidence'
    
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = project_root / 'output' / 'filing'
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Load evidence packages
    logger.info(f"\n[1/3] Loading evidence packages from {evidence_dir}")
    evidence_packages = load_evidence_packages(evidence_dir, limit=args.limit)
    
    if not evidence_packages:
        logger.error("❌ No evidence packages found. Run Evidence Agent first.")
        logger.info("\nPlease ensure evidence packages exist at:")
        logger.info(f"   {evidence_dir}")
        logger.info("\nOr run: python scripts/run_discovery_to_evidence.py")
        return
    
    # Step 2: Run Filing Agent
    logger.info("\n[2/3] Running Filing Agent...")
    claim_statuses = run_filing_agent(
        evidence_packages,
        seed=args.seed,
        approval_rate=args.approval_rate
    )
    
    # Step 3: Simulate status updates if requested
    if args.simulate_days > 0:
        logger.info(f"\n[2.5/3] Simulating status updates for {args.simulate_days} days...")
        filing_agent = FilingAgentService(seed=args.seed, approval_rate=args.approval_rate)
        for claim_status in claim_statuses:
            filing_agent.status_manager.register_claim(claim_status)
        claim_statuses = filing_agent.simulate_status_updates(days_forward=args.simulate_days)
        logger.info("✅ Status updates simulated")
    
    # Step 4: Export claim statuses
    logger.info("\n[3/3] Exporting claim statuses...")
    filing_agent = FilingAgentService(seed=args.seed, approval_rate=args.approval_rate)
    export_summary = filing_agent.export_claim_statuses(claim_statuses, output_dir)
    
    logger.info(f"\n✅ Filing Agent exports:")
    logger.info(f"   Packages: {export_summary['total_exported']} files")
    logger.info(f"   Batch File: {export_summary['batch_file']}")
    logger.info(f"   Status Distribution: {export_summary['status_distribution']}")
    
    logger.info("\n" + "="*80)
    logger.info("PIPELINE SUMMARY")
    logger.info("="*80)
    logger.info("Evidence Agent:")
    logger.info(f"   Input: {len(evidence_packages)} evidence packages")
    logger.info(f"   Source: {evidence_dir}")
    logger.info("\nFiling Agent:")
    logger.info(f"   Processed: {len(claim_statuses)} claims")
    logger.info(f"   Output: {export_summary['total_exported']} claim status files")
    logger.info(f"   Status Distribution: {export_summary['status_distribution']}")
    logger.info(f"\nOutput Directory: {output_dir}")
    logger.info("\n✅ EVIDENCE → FILING PIPELINE COMPLETE!")
    logger.info("="*80)


if __name__ == '__main__':
    main()

