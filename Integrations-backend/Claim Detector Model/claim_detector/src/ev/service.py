"""
Evidence Validator Service
Combines rules engine and ML validator to provide comprehensive validation
"""
import uuid
from datetime import datetime
from typing import Dict, List, Any, Optional
import logging
from pathlib import Path

from .rules_engine import RulesEngine
from .ml_validator import DocValidator

# Optional database imports
try:
    from ..database import get_db, ValidationCRUD
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False
    get_db = None
    ValidationCRUD = None

logger = logging.getLogger(__name__)

class ValidationResult:
    """Result of evidence validation"""
    
    def __init__(self, claim_id: str, status: str, rules_passed: List[str], 
                 rules_failed: List[str], ml_score: float, final_confidence: float,
                 validation_id: Optional[str] = None):
        self.claim_id = claim_id
        self.status = status
        self.rules_passed = rules_passed
        self.rules_failed = rules_failed
        self.ml_score = ml_score
        self.final_confidence = final_confidence
        self.validation_id = validation_id or str(uuid.uuid4())
        self.timestamp = datetime.now().isoformat()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "validation_id": self.validation_id,
            "claim_id": self.claim_id,
            "status": self.status,
            "rules_passed": self.rules_passed,
            "rules_failed": self.rules_failed,
            "ml_score": self.ml_score,
            "final_confidence": self.final_confidence,
            "timestamp": self.timestamp
        }

class EvidenceValidatorService:
    """Main service for evidence validation"""
    
    def __init__(self, ml_model_path: Optional[str] = None):
        """
        Initialize the evidence validator service
        
        Args:
            ml_model_path: Path to ML model file (optional)
        """
        self.rules_engine = RulesEngine()
        self.doc_validator = DocValidator(ml_model_path)
        logger.info("Evidence Validator Service initialized")
    
    def validate_claim(self, claim: Dict[str, Any]) -> ValidationResult:
        """
        Clean interface for claim validation
        
        Args:
            claim: Complete claim data including metadata and documents
            
        Returns:
            ValidationResult with status, confidence, and evidence details
        """
        claim_id = claim.get('claim_id', 'unknown')
        metadata = claim.get('metadata', {})
        docs = claim.get('documents', [])
        
        logger.info(f"Validating claim {claim_id}")
        
        # Run comprehensive validation
        validation_result = self.validate_evidence(claim_id, metadata, docs)
        
        return validation_result
    
    def validate_evidence(self, claim_id: str, metadata: Dict[str, Any], 
                         docs: List[Dict[str, Any]]) -> ValidationResult:
        """
        Validate claim evidence using rules engine and ML validator
        
        Args:
            claim_id: Unique claim identifier
            metadata: Claim metadata (shipment_id, SKU, ASIN, etc.)
            docs: List of document metadata and content
            
        Returns:
            ValidationResult with comprehensive validation results
        """
        logger.info(f"Starting evidence validation for claim {claim_id}")
        
        # Step 1: Run rules engine validation
        rules_result = self.rules_engine.validate_claim(metadata, docs)
        logger.info(f"Rules validation completed: {rules_result['status']}")
        
        # Step 2: Run ML document validation
        ml_result = self.doc_validator.validate_documents(docs)
        logger.info(f"ML validation completed: score={ml_result['ml_score']:.3f}")
        
        # Step 3: Combine results and determine final status
        final_status = self._combine_validation_results(rules_result, ml_result)
        
        # Step 4: Calculate final confidence
        final_confidence = self._calculate_final_confidence(rules_result, ml_result)
        
        # Step 5: Create validation result
        validation_result = ValidationResult(
            claim_id=claim_id,
            status=final_status,
            rules_passed=rules_result['rules_passed'],
            rules_failed=rules_result['rules_failed'],
            ml_score=ml_result['ml_score'],
            final_confidence=final_confidence
        )
        
        # Step 6: Save to database
        self._save_validation_result(validation_result, rules_result, ml_result)
        
        logger.info(f"Evidence validation completed for claim {claim_id}: {final_status}")
        return validation_result
    
    def _combine_validation_results(self, rules_result: Dict[str, Any], 
                                   ml_result: Dict[str, Any]) -> str:
        """Combine rules and ML results to determine final status"""
        rules_status = rules_result['status']
        ml_valid = ml_result['ml_valid']
        ml_score = ml_result['ml_score']
        
        # If rules say invalid, ML can't override
        if rules_status == 'invalid':
            return 'invalid'
        
        # If rules say valid but ML is suspicious, downgrade to review
        if rules_status == 'valid' and ml_score < 0.6:
            return 'review'
        
        # If rules say review, ML can upgrade to valid if very confident
        if rules_status == 'review' and ml_score > 0.9:
            return 'valid'
        
        # Otherwise, keep rules status
        return rules_status
    
    def _calculate_final_confidence(self, rules_result: Dict[str, Any], 
                                  ml_result: Dict[str, Any]) -> float:
        """Calculate final confidence score combining rules and ML"""
        # Calculate rules confidence based on passed vs failed rules
        total_rules = len(rules_result['rules_passed']) + len(rules_result['rules_failed'])
        rules_confidence = len(rules_result['rules_passed']) / total_rules if total_rules > 0 else 0.0
        
        # Get ML confidence
        ml_confidence = ml_result['confidence']
        
        # Weight rules more heavily than ML (70% rules, 30% ML)
        final_confidence = (0.7 * rules_confidence) + (0.3 * ml_confidence)
        
        return min(1.0, max(0.0, final_confidence))
    
    def _save_validation_result(self, validation_result: ValidationResult,
                                rules_result: Dict[str, Any], 
                                ml_result: Dict[str, Any]):
        """Save validation result to database"""
        if not DATABASE_AVAILABLE:
            logger.warning("Database not available, skipping validation result save")
            return
            
        try:
            # Get database connection
            db = next(get_db())
            
            # Prepare data for database
            validation_data = {
                "validation_id": validation_result.validation_id,
                "claim_id": validation_result.claim_id,
                "status": validation_result.status,
                "rules_passed": validation_result.rules_passed,
                "rules_failed": validation_result.rules_failed,
                "ml_score": validation_result.ml_score,
                "final_confidence": validation_result.final_confidence,
                "validation_details": {
                    "rules_validation": rules_result,
                    "ml_validation": ml_result
                },
                "timestamp": validation_result.timestamp
            }
            
            # Save to database
            ValidationCRUD.create_validation(db, validation_data)
            logger.info(f"Validation result saved to database: {validation_result.validation_id}")
            
        except Exception as e:
            logger.error(f"Error saving validation result to database: {e}")
            # Don't fail the validation if database save fails
    
    def get_validation_history(self, claim_id: str) -> List[ValidationResult]:
        """Get validation history for a claim"""
        if not DATABASE_AVAILABLE:
            logger.warning("Database not available, returning empty validation history")
            return []
            
        try:
            db = next(get_db())
            validations = ValidationCRUD.get_validations_by_claim_id(db, claim_id)
            
            results = []
            for validation in validations:
                result = ValidationResult(
                    claim_id=validation['claim_id'],
                    status=validation['status'],
                    rules_passed=validation['rules_passed'],
                    rules_failed=validation['rules_failed'],
                    ml_score=validation['ml_score'],
                    final_confidence=validation['final_confidence'],
                    validation_id=validation['validation_id']
                )
                results.append(result)
            
            return results
            
        except Exception as e:
            logger.error(f"Error retrieving validation history: {e}")
            return []
    
    def get_validation_stats(self) -> Dict[str, Any]:
        """Get validation statistics"""
        if not DATABASE_AVAILABLE:
            logger.warning("Database not available, returning default validation stats")
            return {
                "total_validations": 0,
                "valid_count": 0,
                "invalid_count": 0,
                "review_count": 0,
                "average_confidence": 0.0,
                "average_ml_score": 0.0
            }
            
        try:
            db = next(get_db())
            stats = ValidationCRUD.get_validation_stats(db)
            
            return {
                "total_validations": stats.get('total', 0),
                "valid_count": stats.get('valid', 0),
                "invalid_count": stats.get('invalid', 0),
                "review_count": stats.get('review', 0),
                "average_confidence": stats.get('avg_confidence', 0.0),
                "average_ml_score": stats.get('avg_ml_score', 0.0)
            }
            
        except Exception as e:
            logger.error(f"Error retrieving validation stats: {e}")
            return {
                "total_validations": 0,
                "valid_count": 0,
                "invalid_count": 0,
                "review_count": 0,
                "average_confidence": 0.0,
                "average_ml_score": 0.0
            }
