from src.common.schemas import ClaimPacket, FilingResult
from datetime import datetime
import uuid
import random

class SPAmazonAdapter:
    """Mock SP-API adapter for development/testing"""
    
    def submit(self, packet: ClaimPacket) -> FilingResult:
        """Submit a claim packet to Amazon SP-API (mock implementation)"""
        # MOCK: emulate 90% success, 10% soft fail (retryable)
        success = random.random() > 0.1
        
        if success:
            return FilingResult(
                claim_id=packet.claim_id,
                submitted=True,
                amazon_case_id=str(uuid.uuid4()),
                status="submitted",
                message="Mock submission successful",
                filed_at=datetime.utcnow()
            )
        else:
            return FilingResult(
                claim_id=packet.claim_id,
                submitted=False,
                amazon_case_id=None,
                status="failed",
                message="SP-API transient error (mock)",
                filed_at=None
            )








