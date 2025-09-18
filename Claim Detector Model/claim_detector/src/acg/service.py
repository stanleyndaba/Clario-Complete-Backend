"""
Auto-Claims Generator Service
Generates and submits claims to Amazon SP-API after EV validation
"""
import uuid
from datetime import datetime
from typing import Dict, List, Any, Optional
import logging
from pathlib import Path

from .sp_api_adapter import SPAmazonAdapter

# Import EV service
try:
    from ..ev.service import EvidenceValidatorService
    EV_AVAILABLE = True
except ImportError:
    EV_AVAILABLE = False
    EvidenceValidatorService = None

# Optional database imports
try:
    from ..database import get_db, FilingCRUD, ClaimCRUD
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False
    get_db = None
    FilingCRUD = None
    ClaimCRUD = None

logger = logging.getLogger(__name__)

class FilingResult:
    """Result of claim filing"""
    
    def __init__(self, claim_id: str, success: bool, amazon_case_id: Optional[str] = None,
                 status: str = "pending", error: Optional[str] = None,
                 filing_id: Optional[str] = None):
        self.claim_id = claim_id
        self.success = success
        self.amazon_case_id = amazon_case_id
        self.status = status
        self.error = error
        self.filing_id = filing_id or str(uuid.uuid4())
        self.timestamp = datetime.now().isoformat()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "filing_id": self.filing_id,
            "claim_id": self.claim_id,
            "success": self.success,
            "amazon_case_id": self.amazon_case_id,
            "status": self.status,
            "error": self.error,
            "timestamp": self.timestamp
        }

class AutoClaimsGeneratorService:
    """Main service for auto-claims generation and filing"""
    
    def __init__(self, use_mock_sp_api: bool = True, ev_model_path: Optional[str] = None):
        """
        Initialize the auto-claims generator service
        
        Args:
            use_mock_sp_api: Use mock SP-API instead of real integration
            ev_model_path: Path to EV ML model (optional)
        """
        self.sp_adapter = SPAmazonAdapter(use_mock=use_mock_sp_api)
        
        # Initialize EV service
        if EV_AVAILABLE:
            self.ev_service = EvidenceValidatorService(ml_model_path=ev_model_path)
            logger.info("Evidence Validator service initialized")
        else:
            self.ev_service = None
            logger.warning("Evidence Validator service not available")
        
        logger.info("Auto-Claims Generator Service initialized")
    
    def process_claim(self, claim_data: Dict[str, Any]) -> FilingResult:
        """
        Process a claim through the complete pipeline
        
        Args:
            claim_data: Complete claim data including metadata and documents
            
        Returns:
            FilingResult with submission status and details
        """
        claim_id = claim_data.get('claim_id', 'unknown')
        logger.info(f"Processing claim {claim_id} through ACG pipeline")
        
        # Step 1: Validate claim with EV
        if not self.ev_service:
            logger.error("Evidence Validator not available, skipping claim")
            return FilingResult(
                claim_id=claim_id,
                success=False,
                error="Evidence Validator not available"
            )
        
        validation_result = self.ev_service.validate_claim(claim_data)
        logger.info(f"EV validation result: {validation_result.status} (confidence: {validation_result.final_confidence:.3f})")
        
        # Step 2: Check if claim should be filed based on EV decision
        if validation_result.status == "invalid":
            logger.info(f"Claim {claim_id} rejected by EV (invalid)")
            return FilingResult(
                claim_id=claim_id,
                success=False,
                status="rejected",
                error="Claim failed EV validation"
            )
        
        if validation_result.status == "review":
            logger.info(f"Claim {claim_id} flagged for review by EV")
            return FilingResult(
                claim_id=claim_id,
                success=False,
                status="review",
                error="Claim requires manual review"
            )
        
        # Step 3: Generate claim packet
        if validation_result.status == "valid":
            logger.info(f"Claim {claim_id} validated by EV, proceeding to filing")
            return self._file_validated_claim(claim_data, validation_result)
        
        # Fallback for unknown status
        logger.warning(f"Unknown EV status: {validation_result.status}")
        return FilingResult(
            claim_id=claim_id,
            success=False,
            error=f"Unknown EV status: {validation_result.status}"
        )
    
    def _file_validated_claim(self, claim_data: Dict[str, Any], 
                             validation_result: Any) -> FilingResult:
        """File a validated claim with Amazon SP-API"""
        claim_id = claim_data.get('claim_id', 'unknown')
        
        try:
            # Prepare claim data for SP-API
            sp_api_data = self._prepare_claim_for_sp_api(claim_data, validation_result)
            
            # Submit to SP-API
            sp_result = self.sp_adapter.file_claim(sp_api_data)
            
            # Create filing result
            filing_result = FilingResult(
                claim_id=claim_id,
                success=sp_result.get('success', False),
                amazon_case_id=sp_result.get('amazon_case_id'),
                status=sp_result.get('status', 'failed'),
                error=sp_result.get('error')
            )
            
            # Save filing record
            self._save_filing_record(filing_result, validation_result)
            
            if filing_result.success:
                logger.info(f"Claim {claim_id} successfully filed with Amazon: {filing_result.amazon_case_id}")
            else:
                logger.error(f"Failed to file claim {claim_id}: {filing_result.error}")
            
            return filing_result
            
        except Exception as e:
            logger.error(f"Error filing claim {claim_id}: {e}")
            return FilingResult(
                claim_id=claim_id,
                success=False,
                error=str(e)
            )
    
    def _prepare_claim_for_sp_api(self, claim_data: Dict[str, Any], 
                                  validation_result: Any) -> Dict[str, Any]:
        """Prepare claim data for SP-API submission"""
        # Extract basic claim information
        sp_api_data = {
            'claim_id': claim_data.get('claim_id'),
            'seller_id': claim_data.get('metadata', {}).get('seller_id'),
            'marketplace': claim_data.get('metadata', {}).get('marketplace', 'US'),
            'claim_type': claim_data.get('metadata', {}).get('claim_type', 'lost_inventory'),
            'amount': claim_data.get('metadata', {}).get('amount', 0),
            'quantity': claim_data.get('metadata', {}).get('quantity', 1),
            'sku': claim_data.get('metadata', {}).get('sku'),
            'asin': claim_data.get('metadata', {}).get('asin'),
            'shipment_id': claim_data.get('metadata', {}).get('shipment_id'),
            'description': claim_data.get('metadata', {}).get('description', ''),
            'documents': claim_data.get('documents', []),
            'validation_details': {
                'validation_id': validation_result.validation_id,
                'ev_status': validation_result.status,
                'ev_confidence': validation_result.final_confidence,
                'rules_passed': validation_result.rules_passed,
                'rules_failed': validation_result.rules_failed,
                'ml_score': validation_result.ml_score
            }
        }
        
        return sp_api_data
    
    def _save_filing_record(self, filing_result: FilingResult, 
                           validation_result: Any):
        """Save filing record to database"""
        if not DATABASE_AVAILABLE:
            logger.warning("Database not available, skipping filing record save")
            return
            
        try:
            db = next(get_db())
            
            # Prepare filing data
            filing_data = {
                "filing_id": filing_result.filing_id,
                "claim_id": filing_result.claim_id,
                "amazon_case_id": filing_result.amazon_case_id,
                "status": filing_result.status,
                "success": filing_result.success,
                "error": filing_result.error,
                "validation_id": validation_result.validation_id,
                "filing_details": {
                    "ev_status": validation_result.status,
                    "ev_confidence": validation_result.final_confidence,
                    "sp_api_response": filing_result.to_dict()
                },
                "timestamp": filing_result.timestamp
            }
            
            # Save to database
            FilingCRUD.create_filing(db, filing_data)
            logger.info(f"Filing record saved to database: {filing_result.filing_id}")
            
        except Exception as e:
            logger.error(f"Error saving filing record to database: {e}")
    
    def get_filing_status(self, claim_id: str) -> Optional[FilingResult]:
        """Get filing status for a claim"""
        if not DATABASE_AVAILABLE:
            logger.warning("Database not available, cannot retrieve filing status")
            return None
            
        try:
            db = next(get_db())
            filing = FilingCRUD.get_filing_by_claim_id(db, claim_id)
            
            if filing:
                return FilingResult(
                    claim_id=filing['claim_id'],
                    success=filing['success'],
                    amazon_case_id=filing['amazon_case_id'],
                    status=filing['status'],
                    error=filing.get('error'),
                    filing_id=filing['filing_id']
                )
            
            return None
            
        except Exception as e:
            logger.error(f"Error retrieving filing status: {e}")
            return None
    
    def get_filing_stats(self) -> Dict[str, Any]:
        """Get filing statistics"""
        if not DATABASE_AVAILABLE:
            logger.warning("Database not available, returning default filing stats")
            return {
                "total_filings": 0,
                "successful_filings": 0,
                "failed_filings": 0,
                "pending_filings": 0,
                "success_rate": 0.0,
                "average_processing_time_hours": 0.0
            }
            
        try:
            db = next(get_db())
            stats = FilingCRUD.get_filing_stats(db)
            
            return {
                "total_filings": stats.get('total', 0),
                "successful_filings": stats.get('successful', 0),
                "failed_filings": stats.get('failed', 0),
                "pending_filings": stats.get('pending', 0),
                "success_rate": stats.get('success_rate', 0.0),
                "average_processing_time_hours": stats.get('avg_processing_time', 0.0)
            }
            
        except Exception as e:
            logger.error(f"Error retrieving filing stats: {e}")
            return {
                "total_filings": 0,
                "successful_filings": 0,
                "failed_filings": 0,
                "pending_filings": 0,
                "success_rate": 0.0,
                "average_processing_time_hours": 0.0
            }
    
    def is_ev_available(self) -> bool:
        """Check if Evidence Validator is available"""
        return self.ev_service is not None
    
    def is_sp_api_available(self) -> bool:
        """Check if SP-API is available"""
        return self.sp_adapter.is_available()
