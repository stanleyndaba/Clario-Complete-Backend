"""
Evidence Validator Router
FastAPI router for evidence validation endpoints
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
import logging

from .service import EvidenceValidatorService, ValidationResult

logger = logging.getLogger(__name__)

# Create router
ev_router = APIRouter(tags=["Evidence Validation"])

# Initialize service
ev_service = EvidenceValidatorService()

# Pydantic models
class DocumentMetadata(BaseModel):
    """Document metadata model"""
    document_type: str
    file_path: str
    file_size_mb: float
    file_quality: float = 0.8
    document_date: Optional[str] = None
    shipment_id: Optional[str] = None
    quantity: Optional[float] = None
    amount: Optional[float] = None
    hash: Optional[str] = None
    hash_verified: bool = True

class Document(BaseModel):
    """Document model"""
    metadata: DocumentMetadata
    extracted_text: str = ""

class ValidationRequest(BaseModel):
    """Validation request model"""
    claim_id: str
    metadata: Dict[str, Any]
    documents: List[Document]

class ValidationResponse(BaseModel):
    """Validation response model"""
    validation_id: str
    claim_id: str
    status: str
    rules_passed: List[str]
    rules_failed: List[str]
    ml_score: float
    final_confidence: float
    timestamp: str

class ValidationHistoryResponse(BaseModel):
    """Validation history response model"""
    claim_id: str
    validations: List[ValidationResponse]

class ValidationStatsResponse(BaseModel):
    """Validation statistics response model"""
    total_validations: int
    valid_count: int
    invalid_count: int
    review_count: int
    average_confidence: float
    average_ml_score: float

@ev_router.post("/validate", response_model=ValidationResponse)
async def validate_evidence(request: ValidationRequest):
    """
    Validate claim evidence using rules engine and ML validator
    
    Args:
        request: Validation request with claim metadata and documents
        
    Returns:
        Validation result with status and confidence scores
    """
    try:
        logger.info(f"Received validation request for claim {request.claim_id}")
        
        # Convert documents to dict format
        docs = []
        for doc in request.documents:
            doc_dict = {
                "metadata": doc.metadata.dict(),
                "extracted_text": doc.extracted_text
            }
            docs.append(doc_dict)
        
        # Run validation
        validation_result = ev_service.validate_evidence(
            claim_id=request.claim_id,
            metadata=request.metadata,
            docs=docs
        )
        
        # Convert to response model
        response = ValidationResponse(
            validation_id=validation_result.validation_id,
            claim_id=validation_result.claim_id,
            status=validation_result.status,
            rules_passed=validation_result.rules_passed,
            rules_failed=validation_result.rules_failed,
            ml_score=validation_result.ml_score,
            final_confidence=validation_result.final_confidence,
            timestamp=validation_result.timestamp
        )
        
        logger.info(f"Validation completed for claim {request.claim_id}: {validation_result.status}")
        return response
        
    except Exception as e:
        logger.error(f"Error validating evidence for claim {request.claim_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")

@ev_router.get("/validate/{claim_id}", response_model=ValidationResponse)
async def get_latest_validation(claim_id: str):
    """
    Get the latest validation result for a claim
    
    Args:
        claim_id: Unique claim identifier
        
    Returns:
        Latest validation result
    """
    try:
        # Get validation history
        history = ev_service.get_validation_history(claim_id)
        
        if not history:
            raise HTTPException(status_code=404, detail=f"No validation found for claim {claim_id}")
        
        # Return the most recent validation
        latest = max(history, key=lambda x: x.timestamp)
        
        response = ValidationResponse(
            validation_id=latest.validation_id,
            claim_id=latest.claim_id,
            status=latest.status,
            rules_passed=latest.rules_passed,
            rules_failed=latest.rules_failed,
            ml_score=latest.ml_score,
            final_confidence=latest.final_confidence,
            timestamp=latest.timestamp
        )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving validation for claim {claim_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve validation: {str(e)}")

@ev_router.get("/validate/{claim_id}/history", response_model=ValidationHistoryResponse)
async def get_validation_history(claim_id: str):
    """
    Get complete validation history for a claim
    
    Args:
        claim_id: Unique claim identifier
        
    Returns:
        Complete validation history
    """
    try:
        # Get validation history
        history = ev_service.get_validation_history(claim_id)
        
        if not history:
            raise HTTPException(status_code=404, detail=f"No validation history found for claim {claim_id}")
        
        # Convert to response models
        validations = []
        for validation in history:
            validation_response = ValidationResponse(
                validation_id=validation.validation_id,
                claim_id=validation.claim_id,
                status=validation.status,
                rules_passed=validation.rules_passed,
                rules_failed=validation.rules_failed,
                ml_score=validation.ml_score,
                final_confidence=validation.final_confidence,
                timestamp=validation.timestamp
            )
            validations.append(validation_response)
        
        response = ValidationHistoryResponse(
            claim_id=claim_id,
            validations=validations
        )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving validation history for claim {claim_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve validation history: {str(e)}")

@ev_router.get("/stats", response_model=ValidationStatsResponse)
async def get_validation_stats():
    """
    Get validation statistics
    
    Returns:
        Validation statistics
    """
    try:
        stats = ev_service.get_validation_stats()
        
        response = ValidationStatsResponse(
            total_validations=stats['total_validations'],
            valid_count=stats['valid_count'],
            invalid_count=stats['invalid_count'],
            review_count=stats['review_count'],
            average_confidence=stats['average_confidence'],
            average_ml_score=stats['average_ml_score']
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error retrieving validation stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve validation stats: {str(e)}")

@ev_router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Evidence Validator",
        "components": {
            "rules_engine": "active",
            "ml_validator": "active",
            "database": "active"
        }
    }

