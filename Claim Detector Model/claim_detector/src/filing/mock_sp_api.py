"""
Mock SP-API Adapter
Deterministic mock implementation of Amazon SP-API for claim filing.
Uses seed-based generation for reproducible results.
"""

import hashlib
import time
import random
import logging
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class MockSPAPIAdapter:
    """
    Mock Amazon SP-API Adapter
    
    Simulates SP-API claim filing with deterministic behavior.
    """
    
    def __init__(self, seed: Optional[int] = None, approval_rate: float = 0.85):
        """
        Initialize mock SP-API adapter
        
        Args:
            seed: Random seed for deterministic behavior
            approval_rate: Probability of claim approval (0.0-1.0)
        """
        self.seed = seed or 42
        self.approval_rate = approval_rate
        random.seed(self.seed)
        
        logger.info(f"Mock SP-API Adapter initialized (seed={self.seed}, approval_rate={approval_rate})")
    
    def _get_claim_seed(self, claim_id: str) -> int:
        """Generate deterministic seed from claim_id"""
        hash_obj = hashlib.md5(claim_id.encode())
        return int(hash_obj.hexdigest()[:8], 16)
    
    def file_claim(self, claim_payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        File a claim via mock SP-API
        
        Args:
            claim_payload: Claim payload prepared for SP-API
            
        Returns:
            Filing result with status and Amazon case ID
        """
        claim_id = claim_payload.get('claim_id', 'UNKNOWN')
        claim_seed = self._get_claim_seed(claim_id)
        random.seed(claim_seed)
        
        # Simulate processing time (deterministic based on claim_id)
        processing_time_ms = (claim_seed % 500) + 100  # 100-600ms
        
        # Generate deterministic Amazon case ID
        timestamp = int(time.time())
        case_id_hash = abs(hash(claim_id)) % 10000
        amazon_case_id = f"AMZ-{timestamp}-{case_id_hash:04d}"
        
        # Determine success based on approval rate (deterministic)
        # Use claim_seed to make it deterministic per claim
        success_prob = (claim_seed % 1000) / 1000.0
        success = success_prob < self.approval_rate
        
        if success:
            logger.info(f"✅ Mock SP-API: Claim {claim_id} filed successfully: {amazon_case_id}")
            return {
                'success': True,
                'claim_id': claim_id,
                'amazon_case_id': amazon_case_id,
                'status': 'submitted',
                'response': {
                    'case_id': amazon_case_id,
                    'status': 'submitted',
                    'message': 'Mock claim submitted successfully',
                    'estimated_response_time': '2-5 business days'
                },
                'timestamp': datetime.now().isoformat(),
                'processing_time_ms': processing_time_ms
            }
        else:
            logger.warning(f"❌ Mock SP-API: Claim {claim_id} filing failed")
            return {
                'success': False,
                'claim_id': claim_id,
                'amazon_case_id': None,
                'error': 'Mock submission failed (simulated rejection)',
                'status': 'failed',
                'timestamp': datetime.now().isoformat(),
                'processing_time_ms': processing_time_ms
            }
    
    def get_claim_status(self, amazon_case_id: str) -> Dict[str, Any]:
        """
        Get status of a filed claim
        
        Args:
            amazon_case_id: Amazon case ID
            
        Returns:
            Current claim status
        """
        # Extract claim_id from case_id if possible, otherwise use case_id
        claim_id = amazon_case_id.split('-')[-1] if '-' in amazon_case_id else amazon_case_id
        claim_seed = self._get_claim_seed(claim_id)
        random.seed(claim_seed)
        
        # Deterministic status based on case_id
        status_seed = claim_seed % 5
        status_map = {
            0: 'submitted',
            1: 'under_review',
            2: 'under_review',
            3: 'approved',
            4: 'rejected'
        }
        status = status_map.get(status_seed, 'submitted')
        
        return {
            'success': True,
            'case_id': amazon_case_id,
            'status': status,
            'last_updated': datetime.now().isoformat(),
            'estimated_completion': (datetime.now()).isoformat()
        }
    
    def is_available(self) -> bool:
        """Check if SP-API is available (always True for mock)"""
        return True

