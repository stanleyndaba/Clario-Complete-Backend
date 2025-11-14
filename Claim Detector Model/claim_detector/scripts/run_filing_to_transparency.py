"""
Filing Agent → Transparency Agent Integration
Runs Filing Agent outputs through Transparency Agent to generate final_timeline.json files.
"""

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

# Import Transparency Agent
from src.transparency.transparency_agent_service import TransparencyAgentService


def load_claim_statuses(filing_dir: Path, limit: Optional[int] = None) -> list:
    """
    Load claim statuses from filing directory
    
    Args:
        filing_dir: Directory containing claim_status_*.json files
        limit: Optional limit for testing
        
    Returns:
        List of claim status dictionaries
    """
    logger.info(f"Loading claim statuses from {filing_dir}")
    
    if not filing_dir.exists():
        logger.error(f"❌ Filing directory not found: {filing_dir}")
        return []
    
    # Find all claim status files
    status_files = list(filing_dir.glob("claim_status_*.json"))
    
    if not status_files:
        logger.warning(f"⚠️  No claim status files found in {filing_dir}")
        return []
    
    # Sort by filename for consistency
    status_files.sort()
    
    # Apply limit if specified
    if limit:
        status_files = status_files[:limit]
        logger.info(f"Processing first {limit} claim statuses (testing mode)")
    
    # Load claim statuses
    claim_statuses = []
    for status_file in status_files:
        try:
            with open(status_file, 'r', encoding='utf-8') as f:
                claim_status = json.load(f)
                claim_statuses.append(claim_status)
        except Exception as e:
            logger.error(f"❌ Error loading {status_file}: {e}")
    
    logger.info(f"✅ Loaded {len(claim_statuses)} claim statuses")
    return claim_statuses


def run_transparency_agent(claim_statuses: list, 
                          seed: int = 42,
                          reimbursement_rate: float = 0.95) -> list:
    """
    Run Transparency Agent on claim statuses
    
    Args:
        claim_statuses: List of claim status dictionaries
        seed: Random seed for deterministic behavior
        reimbursement_rate: Probability of reimbursement after approval
        
    Returns:
        List of final timeline dictionaries
    """
    logger.info("\n" + "="*80)
    logger.info("STEP 2: TRANSPARENCY AGENT - Processing Claims")
    logger.info("="*80)
    
    # Initialize Transparency Agent
    logger.info("Initializing Transparency Agent...")
    transparency_agent = TransparencyAgentService(seed=seed, reimbursement_rate=reimbursement_rate)
    
    # Process batch
    logger.info(f"Processing {len(claim_statuses)} claims through Transparency Agent...")
    final_timelines = transparency_agent.process_batch_claims(claim_statuses)
    
    # Get summary
    summary = transparency_agent.get_processing_summary()
    logger.info(f"\n✅ Transparency Agent Complete:")
    logger.info(f"   Processed: {summary['total_processed']} claims")
    logger.info(f"   Status Distribution: {summary['status_distribution']}")
    logger.info(f"   Total Amount: ${summary['total_amount']:.2f}")
    logger.info(f"   Reimbursed Amount: ${summary['reimbursed_amount']:.2f}")
    logger.info(f"   Reimbursement Rate: {summary['reimbursement_rate']:.1f}%")
    logger.info(f"   Reconciliation Rate: {summary['reconciliation']['reconciliation_rate']:.1f}%")
    
    return final_timelines


def main():
    """Main execution function"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Filing Agent → Transparency Agent Pipeline")
    parser.add_argument('--filing-dir', type=str,
                       default=None,
                       help='Directory containing claim status files (default: output/filing)')
    parser.add_argument('--limit', type=int,
                       default=None,
                       help='Limit number of claims to process (for testing)')
    parser.add_argument('--seed', type=int,
                       default=42,
                       help='Random seed for deterministic behavior (default: 42)')
    parser.add_argument('--reimbursement-rate', type=float,
                       default=0.95,
                       help='Probability of reimbursement after approval (default: 0.95)')
    parser.add_argument('--output-dir', type=str,
                       default=None,
                       help='Output directory (default: output/transparency)')
    
    args = parser.parse_args()
    
    logger.info("="*80)
    logger.info("FILING AGENT → TRANSPARENCY AGENT PIPELINE")
    logger.info("="*80)
    
    # Get paths
    project_root = Path(__file__).parent.parent
    if args.filing_dir:
        filing_dir = Path(args.filing_dir)
    else:
        filing_dir = project_root / 'output' / 'filing'
    
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = project_root / 'output' / 'transparency'
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Load claim statuses
    logger.info(f"\n[1/3] Loading claim statuses from {filing_dir}")
    claim_statuses = load_claim_statuses(filing_dir, limit=args.limit)
    
    if not claim_statuses:
        logger.error("❌ No claim statuses found. Run Filing Agent first.")
        logger.info("\nPlease ensure claim status files exist at:")
        logger.info(f"   {filing_dir}")
        logger.info("\nOr run: python scripts/run_evidence_to_filing.py")
        return
    
    # Step 2: Run Transparency Agent
    logger.info("\n[2/3] Running Transparency Agent...")
    final_timelines = run_transparency_agent(
        claim_statuses,
        seed=args.seed,
        reimbursement_rate=args.reimbursement_rate
    )
    
    # Step 3: Export final timelines
    logger.info("\n[3/3] Exporting final timelines...")
    transparency_agent = TransparencyAgentService(seed=args.seed, reimbursement_rate=args.reimbursement_rate)
    export_summary = transparency_agent.export_final_timelines(final_timelines, output_dir)
    
    logger.info(f"\n✅ Transparency Agent exports:")
    logger.info(f"   Packages: {export_summary['total_exported']} files")
    logger.info(f"   Batch File: {export_summary['batch_file']}")
    logger.info(f"   Status Distribution: {export_summary['status_distribution']}")
    logger.info(f"   Reconciliation Summary: {export_summary['reconciliation_summary']}")
    
    logger.info("\n" + "="*80)
    logger.info("PIPELINE SUMMARY")
    logger.info("="*80)
    logger.info("Filing Agent:")
    logger.info(f"   Input: {len(claim_statuses)} claim statuses")
    logger.info(f"   Source: {filing_dir}")
    logger.info("\nTransparency Agent:")
    logger.info(f"   Processed: {len(final_timelines)} claims")
    logger.info(f"   Output: {export_summary['total_exported']} final timeline files")
    logger.info(f"   Status Distribution: {export_summary['status_distribution']}")
    logger.info(f"   Reconciliation Rate: {export_summary['reconciliation_summary']['reconciliation_rate']:.1f}%")
    logger.info(f"\nOutput Directory: {output_dir}")
    logger.info("\n✅ FILING → TRANSPARENCY PIPELINE COMPLETE!")
    logger.info("="*80)


if __name__ == '__main__':
    main()

