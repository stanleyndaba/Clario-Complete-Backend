import logging
from src.common.db_postgresql import DatabaseManager

# Initialize database manager
db = DatabaseManager()
from src.acg.builder import build_packet
from src.acg.sp_api_adapter import SPAmazonAdapter

logger = logging.getLogger(__name__)

# Initialize SP-API adapter
adapter = SPAmazonAdapter()

def enqueue_filing(claim_id: str):
    """Enqueue a filing job (pseudo-enqueue for now)"""
    # TODO: Replace with proper background job queue (RQ/Arq/APScheduler)
    logger.info(f"Enqueuing filing for claim {claim_id}")
    # For now, run filing immediately
    file_claim(claim_id)

def file_claim(claim_id: str):
    """File a claim by building packet and submitting via SP-API"""
    try:
        logger.info(f"Starting filing process for claim {claim_id}")
        
        # Load claim and validation data
        claim = db.load_claim(claim_id)
        if not claim:
            logger.error(f"Claim {claim_id} not found in database")
            return
        
        validation = db.load_latest_validation(claim_id)
        if not validation:
            logger.error(f"No validation found for claim {claim_id}")
            return
        
        # Fetch evidence links
        evidence_links = db.fetch_evidence_links(claim_id)
        
        # Build claim packet
        from src.common.schemas import ClaimDetection, ValidationResult
        claim_obj = ClaimDetection(**claim)
        validation_obj = ValidationResult(**validation)
        
        packet = build_packet(claim_obj, validation_obj, evidence_links)
        
        # Submit via SP-API adapter
        result = adapter.submit(packet)
        
        # Save filing result and update claim status
        db.save_filing(claim_id, result, packet)
        
        if result.submitted:
            db.update_claim_status(claim_id, "submitted")
            logger.info(f"Claim {claim_id} successfully submitted to Amazon (Case ID: {result.amazon_case_id})")
        else:
            # For failed submissions, mark as failed
            # TODO: Implement retry policy with backoff
            db.update_claim_status(claim_id, "failed")
            logger.warning(f"Claim {claim_id} failed to submit: {result.message}")
            
    except Exception as e:
        logger.error(f"Error during filing of claim {claim_id}: {str(e)}")
        # Update claim status to failed
        db.update_claim_status(claim_id, "filing_failed")








