"""
Timeline Manager
Manages claim timeline and status history for Transparency Agent.
Tracks full lifecycle from filing to reimbursement.
"""

import logging
from datetime import datetime
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class TimelineManager:
    """
    Manages claim timelines and status history
    
    Tracks complete claim lifecycle for transparency and reconciliation.
    """
    
    def __init__(self, seed: Optional[int] = None):
        """
        Initialize timeline manager
        
        Args:
            seed: Random seed for deterministic behavior (unused but kept for consistency)
        """
        self.seed = seed or 42
        
        # Store registered timelines
        self.timelines: Dict[str, Dict[str, Any]] = {}
        
        logger.info(f"Timeline Manager initialized (seed={self.seed})")
    
    def register_claim(self, claim_status: Dict[str, Any]):
        """
        Register a claim for timeline tracking
        
        Args:
            claim_status: Initial claim status (from Filing Agent)
        """
        claim_id = claim_status.get('claim_id', 'UNKNOWN')
        
        # Initialize timeline from claim status
        timeline = {
            'claim_id': claim_id,
            'amazon_case_id': claim_status.get('amazon_case_id'),
            'status_history': claim_status.get('status_history', []),
            'filed_at': claim_status.get('filed_at'),
            'amount': claim_status.get('amount', 0),
            'metadata': claim_status.get('metadata', {})
        }
        
        self.timelines[claim_id] = timeline
        logger.debug(f"Registered claim {claim_id} for timeline tracking")
    
    def update_timeline(self, claim_id: str, final_timeline: Dict[str, Any]):
        """
        Update timeline with final timeline data
        
        Args:
            claim_id: Claim identifier
            final_timeline: Final timeline structure
        """
        self.timelines[claim_id] = final_timeline
        logger.debug(f"Updated timeline for claim {claim_id}")
    
    def get_timeline(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """
        Get current timeline for a claim
        
        Args:
            claim_id: Claim identifier
            
        Returns:
            Current timeline or None if not found
        """
        return self.timelines.get(claim_id)
    
    def get_all_timelines(self) -> List[Dict[str, Any]]:
        """Get all registered timelines"""
        return list(self.timelines.values())
    
    def add_timeline_event(self, claim_id: str, event: Dict[str, Any]):
        """
        Add an event to a claim's timeline
        
        Args:
            claim_id: Claim identifier
            event: Timeline event dictionary
        """
        if claim_id not in self.timelines:
            logger.warning(f"Claim {claim_id} not found in timelines, creating new entry")
            self.timelines[claim_id] = {
                'claim_id': claim_id,
                'timeline': []
            }
        
        timeline = self.timelines[claim_id]
        if 'timeline' not in timeline:
            timeline['timeline'] = []
        
        timeline['timeline'].append(event)
        timeline['timeline'].sort(key=lambda x: x.get('timestamp', ''))
        
        logger.debug(f"Added event to timeline for claim {claim_id}: {event.get('event', 'UNKNOWN')}")

