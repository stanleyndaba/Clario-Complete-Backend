"""
Claim Status Manager
Manages claim status lifecycle: FILED → IN_REVIEW → APPROVED/DENIED
Simulates status transitions over time with deterministic behavior.
"""

import hashlib
import random
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class ClaimStatusManager:
    """
    Manages claim status lifecycle and transitions
    
    Simulates realistic status progression:
    FILED → IN_REVIEW → APPROVED/DENIED
    """
    
    def __init__(self, seed: Optional[int] = None, approval_rate: float = 0.85):
        """
        Initialize claim status manager
        
        Args:
            seed: Random seed for deterministic behavior
            approval_rate: Probability of approval (0.0-1.0)
        """
        self.seed = seed or 42
        self.approval_rate = approval_rate
        random.seed(self.seed)
        
        # Store registered claims
        self.claims: Dict[str, Dict[str, Any]] = {}
        
        logger.info(f"Claim Status Manager initialized (seed={self.seed}, approval_rate={approval_rate})")
    
    def _get_claim_seed(self, claim_id: str) -> int:
        """Generate deterministic seed from claim_id"""
        hash_obj = hashlib.md5(claim_id.encode())
        return int(hash_obj.hexdigest()[:8], 16)
    
    def register_claim(self, claim_status: Dict[str, Any]):
        """
        Register a claim for status tracking
        
        Args:
            claim_status: Initial claim status (FILED)
        """
        claim_id = claim_status.get('claim_id', 'UNKNOWN')
        self.claims[claim_id] = claim_status.copy()
        logger.debug(f"Registered claim {claim_id} for status tracking")
    
    def get_claim_status(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """
        Get current status of a claim
        
        Args:
            claim_id: Claim identifier
            
        Returns:
            Current claim status or None if not found
        """
        return self.claims.get(claim_id)
    
    def get_all_statuses(self) -> List[Dict[str, Any]]:
        """Get all registered claim statuses"""
        return list(self.claims.values())
    
    def simulate_updates(self, days_forward: int = 7) -> List[Dict[str, Any]]:
        """
        Simulate status updates for all registered claims
        
        Args:
            days_forward: Number of days to simulate forward
            
        Returns:
            List of updated claim statuses
        """
        updated_statuses = []
        
        for claim_id, claim_status in self.claims.items():
            current_status = claim_status.get('status', 'FILED')
            
            # Only update claims that are not in final states
            if current_status in ['APPROVED', 'DENIED', 'FILING_FAILED']:
                updated_statuses.append(claim_status)
                continue
            
            # Determine next status based on deterministic logic
            claim_seed = self._get_claim_seed(claim_id)
            random.seed(claim_seed)
            
            # Simulate status transition
            updated_status = self._simulate_status_transition(
                claim_status, 
                days_forward,
                claim_seed
            )
            
            self.claims[claim_id] = updated_status
            updated_statuses.append(updated_status)
        
        logger.info(f"Simulated status updates for {len(updated_statuses)} claims")
        return updated_statuses
    
    def _simulate_status_transition(self, claim_status: Dict[str, Any],
                                   days_forward: int,
                                   claim_seed: int) -> Dict[str, Any]:
        """
        Simulate status transition for a single claim
        
        Args:
            claim_status: Current claim status
            days_forward: Days to simulate forward
            claim_seed: Deterministic seed for this claim
            
        Returns:
            Updated claim status
        """
        current_status = claim_status.get('status', 'FILED')
        filed_at = claim_status.get('filed_at')
        
        if not filed_at:
            return claim_status
        
        try:
            filed_date = datetime.fromisoformat(filed_at.replace('Z', '+00:00'))
        except:
            filed_date = datetime.now()
        
        # Calculate days since filing
        days_since_filing = (datetime.now() - filed_date.replace(tzinfo=None)).days + days_forward
        
        # Deterministic status progression based on claim_seed
        # Claims transition at different rates based on their seed
        transition_day = (claim_seed % 5) + 2  # 2-6 days
        
        if current_status == 'FILED':
            if days_since_filing >= transition_day:
                # Move to IN_REVIEW
                new_status = 'IN_REVIEW'
                review_timestamp = (filed_date + timedelta(days=transition_day)).isoformat()
                
                # Add to status history
                status_history = claim_status.get('status_history', [])
                status_history.append({
                    "status": "IN_REVIEW",
                    "timestamp": review_timestamp,
                    "amazon_case_id": claim_status.get('amazon_case_id')
                })
                
                claim_status['status'] = new_status
                claim_status['status_history'] = status_history
                claim_status['in_review_at'] = review_timestamp
                
                # Check if enough time has passed for final decision
                decision_day = transition_day + ((claim_seed % 3) + 2)  # 4-8 days total
                if days_since_filing >= decision_day:
                    # Make final decision (deterministic based on approval_rate)
                    approval_prob = (claim_seed % 1000) / 1000.0
                    final_status = 'APPROVED' if approval_prob < self.approval_rate else 'DENIED'
                    
                    decision_timestamp = (filed_date + timedelta(days=decision_day)).isoformat()
                    status_history.append({
                        "status": final_status,
                        "timestamp": decision_timestamp,
                        "amazon_case_id": claim_status.get('amazon_case_id')
                    })
                    
                    claim_status['status'] = final_status
                    claim_status['status_history'] = status_history
                    claim_status['decided_at'] = decision_timestamp
                    
                    if final_status == 'APPROVED':
                        claim_status['approved_at'] = decision_timestamp
                    else:
                        claim_status['denied_at'] = decision_timestamp
        
        elif current_status == 'IN_REVIEW':
            # Check if enough time has passed for final decision
            review_at = claim_status.get('in_review_at', filed_at)
            try:
                review_date = datetime.fromisoformat(review_at.replace('Z', '+00:00'))
            except:
                review_date = filed_date
            
            days_since_review = (datetime.now() - review_date.replace(tzinfo=None)).days + days_forward
            decision_day = (claim_seed % 3) + 2  # 2-4 days in review
            
            if days_since_review >= decision_day:
                # Make final decision
                approval_prob = (claim_seed % 1000) / 1000.0
                final_status = 'APPROVED' if approval_prob < self.approval_rate else 'DENIED'
                
                decision_timestamp = (review_date + timedelta(days=decision_day)).isoformat()
                status_history = claim_status.get('status_history', [])
                status_history.append({
                    "status": final_status,
                    "timestamp": decision_timestamp,
                    "amazon_case_id": claim_status.get('amazon_case_id')
                })
                
                claim_status['status'] = final_status
                claim_status['status_history'] = status_history
                claim_status['decided_at'] = decision_timestamp
                
                if final_status == 'APPROVED':
                    claim_status['approved_at'] = decision_timestamp
                else:
                    claim_status['denied_at'] = decision_timestamp
        
        return claim_status






