"""
Reimbursement Simulator
Deterministic simulation of reimbursement events after claim approval.
Uses seed-based generation for reproducible results.
"""

import hashlib
import random
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class ReimbursementSimulator:
    """
    Simulates reimbursement events for approved claims
    
    Deterministic behavior based on claim_id seed.
    """
    
    def __init__(self, seed: Optional[int] = None, reimbursement_rate: float = 0.95):
        """
        Initialize reimbursement simulator
        
        Args:
            seed: Random seed for deterministic behavior
            reimbursement_rate: Probability of reimbursement (0.0-1.0)
        """
        self.seed = seed or 42
        self.reimbursement_rate = reimbursement_rate
        random.seed(self.seed)
        
        logger.info(f"Reimbursement Simulator initialized (seed={self.seed}, reimbursement_rate={reimbursement_rate})")
    
    def _get_claim_seed(self, claim_id: str) -> int:
        """Generate deterministic seed from claim_id"""
        hash_obj = hashlib.md5(claim_id.encode())
        return int(hash_obj.hexdigest()[:8], 16)
    
    def simulate_reimbursement(self, claim_status: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Simulate reimbursement event for an approved claim
        
        Args:
            claim_status: Claim status with approval information
            
        Returns:
            Reimbursement event dictionary or None if not reimbursed
        """
        claim_id = claim_status.get('claim_id', 'UNKNOWN')
        claim_seed = self._get_claim_seed(claim_id)
        random.seed(claim_seed)
        
        # Determine if reimbursement occurs (deterministic)
        reimbursement_prob = (claim_seed % 1000) / 1000.0
        will_reimburse = reimbursement_prob < self.reimbursement_rate
        
        if not will_reimburse:
            logger.debug(f"Claim {claim_id} will not be reimbursed (simulated)")
            return None
        
        # Get approval timestamp
        approved_at = claim_status.get('approved_at') or claim_status.get('decided_at')
        if not approved_at:
            # Fallback to filed_at + estimated approval time
            filed_at = claim_status.get('filed_at')
            if filed_at:
                try:
                    filed_date = datetime.fromisoformat(filed_at.replace('Z', '+00:00'))
                    approved_at = (filed_date + timedelta(days=4)).isoformat()
                except:
                    approved_at = datetime.now().isoformat()
            else:
                approved_at = datetime.now().isoformat()
        
        # Calculate reimbursement delay (deterministic, 1-7 days after approval)
        delay_days = (claim_seed % 7) + 1
        try:
            approved_date = datetime.fromisoformat(approved_at.replace('Z', '+00:00'))
            reimbursed_at = (approved_date + timedelta(days=delay_days)).isoformat()
        except:
            reimbursed_at = datetime.now().isoformat()
        
        # Get claim amount
        claim_amount = claim_status.get('amount', 0)
        
        # Simulate partial payment possibility (5% chance of partial payment)
        partial_prob = (claim_seed % 100) / 100.0
        if partial_prob < 0.05:  # 5% chance
            # Partial payment (80-99% of claim amount)
            payment_percentage = 0.80 + ((claim_seed % 20) / 100.0)  # 80-99%
            actual_amount = claim_amount * payment_percentage
            is_partial = True
        else:
            # Full payment
            actual_amount = claim_amount
            is_partial = False
        
        reimbursement_event = {
            'event': 'REIMBURSED',
            'timestamp': reimbursed_at,
            'amount': round(actual_amount, 2),
            'expected_amount': claim_amount,
            'is_partial': is_partial,
            'payment_percentage': (actual_amount / claim_amount * 100) if claim_amount > 0 else 100.0,
            'delay_days': delay_days,
            'metadata': {
                'claim_id': claim_id,
                'amazon_case_id': claim_status.get('amazon_case_id'),
                'reimbursement_method': 'wire_transfer',
                'transaction_id': f"TXN-{claim_id[:8]}-{int(hash(claim_id) % 10000):04d}"
            }
        }
        
        logger.info(f"✅ Simulated reimbursement for claim {claim_id}: ${actual_amount:.2f} (delay: {delay_days} days)")
        return reimbursement_event






