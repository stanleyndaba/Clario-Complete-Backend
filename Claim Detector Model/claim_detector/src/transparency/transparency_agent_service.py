"""
Unified Transparency Agent Service
Tracks claim status updates, simulates reimbursements, and reconciles amounts.
Standalone mode - no database dependencies, all in-memory.

Input: claim_status.json + reimbursement events
Output: final_timeline.json
"""

import json
import logging
import hashlib
import random
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from pathlib import Path
import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from .reimbursement_simulator import ReimbursementSimulator
from .timeline_manager import TimelineManager

logger = logging.getLogger(__name__)


class TransparencyAgentService:
    """
    Unified Transparency Agent Service
    
    Tracks claim lifecycle, simulates reimbursements, and reconciles amounts
    to produce final timeline records.
    """
    
    def __init__(self, seed: Optional[int] = None, reimbursement_rate: float = 0.95):
        """
        Initialize Transparency Agent Service
        
        Args:
            seed: Random seed for deterministic behavior (default: 42)
            reimbursement_rate: Probability of reimbursement after approval (default: 0.95 = 95%)
        """
        self.seed = seed or 42
        random.seed(self.seed)
        self.reimbursement_rate = reimbursement_rate
        
        # Initialize components
        self.reimbursement_simulator = ReimbursementSimulator(seed=self.seed, reimbursement_rate=reimbursement_rate)
        self.timeline_manager = TimelineManager(seed=self.seed)
        
        logger.info(f"Transparency Agent Service initialized (seed={self.seed}, reimbursement_rate={reimbursement_rate})")
    
    def process_claim_status(self, claim_status: Dict[str, Any], 
                            reimbursement_events: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        Process a claim status and generate final timeline
        
        Args:
            claim_status: Claim status from Filing Agent
            reimbursement_events: Optional list of reimbursement events
            
        Returns:
            final_timeline.json structure
        """
        claim_id = claim_status.get('claim_id', 'UNKNOWN')
        logger.info(f"Processing claim status for claim {claim_id}")
        
        try:
            # Step 1: Register claim with timeline manager
            self.timeline_manager.register_claim(claim_status)
            
            # Step 2: Process status updates
            timeline_events = self._process_status_updates(claim_status)
            
            # Step 3: Simulate reimbursement if approved
            reimbursement_event = None
            if claim_status.get('status') == 'APPROVED':
                reimbursement_event = self.reimbursement_simulator.simulate_reimbursement(claim_status)
                if reimbursement_event:
                    timeline_events.append(reimbursement_event)
                    logger.info(f"✅ Simulated reimbursement for claim {claim_id}: ${reimbursement_event.get('amount', 0):.2f}")
            
            # Step 4: Reconcile amounts
            reconciliation = self._reconcile_amounts(claim_status, reimbursement_event)
            
            # Step 5: Build final timeline
            final_timeline = self._build_final_timeline(
                claim_status=claim_status,
                timeline_events=timeline_events,
                reconciliation=reconciliation
            )
            
            # Step 6: Update timeline manager
            self.timeline_manager.update_timeline(claim_id, final_timeline)
            
            logger.info(f"✅ Successfully processed claim {claim_id}: {final_timeline.get('current_status', 'UNKNOWN')}")
            return final_timeline
            
        except Exception as e:
            logger.error(f"❌ Error processing claim status for {claim_id}: {e}")
            return self._create_error_timeline(claim_id, str(e))
    
    def _process_status_updates(self, claim_status: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Process status updates from claim status history"""
        timeline_events = []
        
        # Get status history from claim_status
        status_history = claim_status.get('status_history', [])
        
        for history_entry in status_history:
            event = {
                'event': history_entry.get('status', 'UNKNOWN'),
                'timestamp': history_entry.get('timestamp'),
                'amazon_case_id': history_entry.get('amazon_case_id'),
                'metadata': {
                    'source': 'filing_agent',
                    'status_history_entry': True
                }
            }
            
            # Add amount if available
            if history_entry.get('status') == 'APPROVED':
                event['amount'] = claim_status.get('amount', 0)
            
            timeline_events.append(event)
        
        return timeline_events
    
    def _reconcile_amounts(self, claim_status: Dict[str, Any], 
                          reimbursement_event: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Reconcile expected vs actual reimbursement amounts
        
        Args:
            claim_status: Claim status with expected amount
            reimbursement_event: Reimbursement event with actual amount
            
        Returns:
            Reconciliation result
        """
        expected_amount = claim_status.get('amount', 0)
        actual_amount = reimbursement_event.get('amount', 0) if reimbursement_event else 0
        
        discrepancy = abs(expected_amount - actual_amount)
        threshold = 0.01  # 1 cent threshold
        
        reconciliation = {
            'expected_amount': expected_amount,
            'actual_amount': actual_amount,
            'discrepancy': discrepancy,
            'status': 'reconciled' if discrepancy <= threshold else 'discrepancy',
            'reconciled_at': datetime.now().isoformat() if reimbursement_event else None
        }
        
        if discrepancy > threshold:
            reconciliation['discrepancy_type'] = 'underpaid' if actual_amount < expected_amount else 'overpaid'
            reconciliation['discrepancy_percentage'] = (discrepancy / expected_amount * 100) if expected_amount > 0 else 0
            logger.warning(f"⚠️ Payment discrepancy detected: Expected ${expected_amount:.2f}, Actual ${actual_amount:.2f}, Difference ${discrepancy:.2f}")
        else:
            logger.info(f"✅ Payment reconciled: ${actual_amount:.2f} matches expected ${expected_amount:.2f}")
        
        return reconciliation
    
    def _build_final_timeline(self, claim_status: Dict[str, Any],
                             timeline_events: List[Dict[str, Any]],
                             reconciliation: Dict[str, Any]) -> Dict[str, Any]:
        """Build final_timeline.json structure"""
        
        # Sort timeline events by timestamp
        timeline_events.sort(key=lambda x: x.get('timestamp', ''))
        
        # Get current status
        current_status = claim_status.get('status', 'UNKNOWN')
        if reconciliation.get('status') == 'reconciled' and current_status == 'APPROVED':
            # Check if reimbursement event exists
            has_reimbursement = any(e.get('event') == 'REIMBURSED' for e in timeline_events)
            if has_reimbursement:
                current_status = 'REIMBURSED'
        
        final_timeline = {
            "claim_id": claim_status.get('claim_id'),
            "amazon_case_id": claim_status.get('amazon_case_id'),
            "current_status": current_status,
            "timeline": timeline_events,
            "reconciliation": reconciliation,
            "metadata": {
                "claim_type": claim_status.get('claim_type', 'unknown'),
                "marketplace": claim_status.get('marketplace', 'US'),
                "amount": claim_status.get('amount', 0),
                "quantity": claim_status.get('quantity', 0),
                "filed_at": claim_status.get('filed_at'),
                "approved_at": claim_status.get('approved_at'),
                "reimbursed_at": reconciliation.get('reconciled_at'),
                "total_timeline_events": len(timeline_events),
                "processing_timestamp": datetime.now().isoformat()
            },
            "processing_timestamp": datetime.now().isoformat(),
            "agent_version": "1.0.0"
        }
        
        return final_timeline
    
    def _create_error_timeline(self, claim_id: str, error: str) -> Dict[str, Any]:
        """Create error timeline for failed processing"""
        return {
            "claim_id": claim_id,
            "amazon_case_id": None,
            "current_status": "ERROR",
            "timeline": [
                {
                    "event": "ERROR",
                    "timestamp": datetime.now().isoformat(),
                    "error": error
                }
            ],
            "reconciliation": {
                "expected_amount": 0,
                "actual_amount": 0,
                "discrepancy": 0,
                "status": "error"
            },
            "metadata": {
                "error": error,
                "processing_timestamp": datetime.now().isoformat()
            },
            "processing_timestamp": datetime.now().isoformat(),
            "agent_version": "1.0.0"
        }
    
    def process_batch_claims(self, claim_statuses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Process multiple claim statuses in batch
        
        Args:
            claim_statuses: List of claim status dictionaries
            
        Returns:
            List of final_timeline.json structures
        """
        logger.info(f"Processing batch of {len(claim_statuses)} claims")
        
        final_timelines = []
        for i, claim_status in enumerate(claim_statuses):
            logger.debug(f"Processing claim {i+1}/{len(claim_statuses)}")
            final_timeline = self.process_claim_status(claim_status)
            final_timelines.append(final_timeline)
        
        logger.info(f"✅ Processed {len(final_timelines)} claims")
        return final_timelines
    
    def get_timeline(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Get current timeline for a claim"""
        return self.timeline_manager.get_timeline(claim_id)
    
    def export_final_timelines(self, final_timelines: List[Dict[str, Any]], 
                              output_dir: Path) -> Dict[str, Any]:
        """
        Export final timelines to files
        
        Args:
            final_timelines: List of final timeline dictionaries
            output_dir: Directory to export files
            
        Returns:
            Summary of export
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Export individual timeline files
        for timeline in final_timelines:
            claim_id = timeline.get('claim_id', 'UNKNOWN')
            timeline_file = output_dir / f"final_timeline_{claim_id}.json"
            
            with open(timeline_file, 'w', encoding='utf-8') as f:
                json.dump(timeline, f, indent=2, default=str)
        
        # Export batch summary
        batch_file = output_dir / "final_timelines_batch.json"
        batch_data = {
            "export_timestamp": datetime.now().isoformat(),
            "total_timelines": len(final_timelines),
            "status_distribution": self._get_status_distribution(final_timelines),
            "reconciliation_summary": self._get_reconciliation_summary(final_timelines),
            "final_timelines": final_timelines
        }
        
        with open(batch_file, 'w', encoding='utf-8') as f:
            json.dump(batch_data, f, indent=2, default=str)
        
        logger.info(f"✅ Exported {len(final_timelines)} final timelines to {output_dir}")
        
        return {
            "total_exported": len(final_timelines),
            "output_dir": str(output_dir),
            "batch_file": str(batch_file),
            "status_distribution": self._get_status_distribution(final_timelines),
            "reconciliation_summary": self._get_reconciliation_summary(final_timelines)
        }
    
    def _get_status_distribution(self, final_timelines: List[Dict[str, Any]]) -> Dict[str, int]:
        """Get distribution of claim statuses"""
        distribution = {}
        for timeline in final_timelines:
            status = timeline.get('current_status', 'UNKNOWN')
            distribution[status] = distribution.get(status, 0) + 1
        return distribution
    
    def _get_reconciliation_summary(self, final_timelines: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Get reconciliation summary statistics"""
        total = len(final_timelines)
        reconciled = sum(1 for t in final_timelines if t.get('reconciliation', {}).get('status') == 'reconciled')
        discrepancies = sum(1 for t in final_timelines if t.get('reconciliation', {}).get('status') == 'discrepancy')
        
        total_expected = sum(t.get('reconciliation', {}).get('expected_amount', 0) for t in final_timelines)
        total_actual = sum(t.get('reconciliation', {}).get('actual_amount', 0) for t in final_timelines)
        total_discrepancy = sum(t.get('reconciliation', {}).get('discrepancy', 0) for t in final_timelines)
        
        return {
            "total_claims": total,
            "reconciled": reconciled,
            "discrepancies": discrepancies,
            "reconciliation_rate": (reconciled / total * 100) if total > 0 else 0.0,
            "total_expected_amount": total_expected,
            "total_actual_amount": total_actual,
            "total_discrepancy": total_discrepancy
        }
    
    def get_processing_summary(self) -> Dict[str, Any]:
        """Get processing summary statistics"""
        all_timelines = self.timeline_manager.get_all_timelines()
        
        total = len(all_timelines)
        filed = sum(1 for t in all_timelines if t.get('current_status') == 'FILED')
        in_review = sum(1 for t in all_timelines if t.get('current_status') == 'IN_REVIEW')
        approved = sum(1 for t in all_timelines if t.get('current_status') == 'APPROVED')
        reimbursed = sum(1 for t in all_timelines if t.get('current_status') == 'REIMBURSED')
        denied = sum(1 for t in all_timelines if t.get('current_status') == 'DENIED')
        
        total_amount = sum(t.get('metadata', {}).get('amount', 0) for t in all_timelines)
        reimbursed_amount = sum(t.get('reconciliation', {}).get('actual_amount', 0) for t in all_timelines)
        
        reconciliation_summary = self._get_reconciliation_summary(all_timelines)
        
        return {
            "total_processed": total,
            "filed": filed,
            "in_review": in_review,
            "approved": approved,
            "reimbursed": reimbursed,
            "denied": denied,
            "total_amount": total_amount,
            "reimbursed_amount": reimbursed_amount,
            "reimbursement_rate": (reimbursed / approved * 100) if approved > 0 else 0.0,
            "status_distribution": {
                "FILED": filed,
                "IN_REVIEW": in_review,
                "APPROVED": approved,
                "REIMBURSED": reimbursed,
                "DENIED": denied
            },
            "reconciliation": reconciliation_summary
        }






