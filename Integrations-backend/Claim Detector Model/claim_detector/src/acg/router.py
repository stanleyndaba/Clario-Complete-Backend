"""
Auto-Claims Generator Router
FastAPI router for ACG endpoints
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
import logging
from datetime import datetime

from .service import AutoClaimsGeneratorService, FilingResult

logger = logging.getLogger(__name__)

# Create router
acg_router = APIRouter(tags=["Auto-Claims Generator"])

# Pydantic models
class ClaimSubmissionRequest(BaseModel):
    """Request model for claim submission"""
    claim_id: str
    metadata: Dict[str, Any]
    documents: List[Dict[str, Any]]

class ClaimSubmissionResponse(BaseModel):
    """Response model for claim submission"""
    filing_id: str
    claim_id: str
    success: bool
    amazon_case_id: Optional[str] = None
    status: str
    error: Optional[str] = None
    timestamp: str

class FilingStatusResponse(BaseModel):
    """Response model for filing status"""
    filing_id: str
    claim_id: str
    success: bool
    amazon_case_id: Optional[str] = None
    status: str
    error: Optional[str] = None
    timestamp: str

class ACGStatsResponse(BaseModel):
    """Response model for ACG statistics"""
    total_filings: int
    successful_filings: int
    failed_filings: int
    pending_filings: int
    success_rate: float
    average_processing_time_hours: float
    ev_available: bool
    sp_api_available: bool

# Global ACG service instance
acg_service = None

def get_acg_service() -> AutoClaimsGeneratorService:
    """Get ACG service instance"""
    global acg_service
    if acg_service is None:
        acg_service = AutoClaimsGeneratorService(use_mock_sp_api=True)
    return acg_service

@acg_router.post("/submit", response_model=ClaimSubmissionResponse)
async def submit_claim(request: ClaimSubmissionRequest, 
                      acg: AutoClaimsGeneratorService = Depends(get_acg_service)):
    """
    Submit a claim for processing through the ACG pipeline
    
    Args:
        request: Claim submission request with metadata and documents
        
    Returns:
        Filing result with status and Amazon case ID
    """
    try:
        # Prepare claim data
        claim_data = {
            "claim_id": request.claim_id,
            "metadata": request.metadata,
            "documents": request.documents
        }
        
        # Process claim through ACG pipeline
        filing_result = acg.process_claim(claim_data)
        
        logger.info(f"Claim {request.claim_id} processed: {filing_result.status}")
        
        return ClaimSubmissionResponse(
            filing_id=filing_result.filing_id,
            claim_id=filing_result.claim_id,
            success=filing_result.success,
            amazon_case_id=filing_result.amazon_case_id,
            status=filing_result.status,
            error=filing_result.error,
            timestamp=filing_result.timestamp
        )
        
    except Exception as e:
        logger.error(f"Error processing claim {request.claim_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process claim: {str(e)}")

@acg_router.get("/status/{claim_id}", response_model=FilingStatusResponse)
async def get_filing_status(claim_id: str, 
                           acg: AutoClaimsGeneratorService = Depends(get_acg_service)):
    """
    Get filing status for a specific claim
    
    Args:
        claim_id: Unique claim identifier
        
    Returns:
        Current filing status and details
    """
    try:
        filing_result = acg.get_filing_status(claim_id)
        
        if not filing_result:
            raise HTTPException(status_code=404, detail=f"Filing not found for claim {claim_id}")
        
        return FilingStatusResponse(
            filing_id=filing_result.filing_id,
            claim_id=filing_result.claim_id,
            success=filing_result.success,
            amazon_case_id=filing_result.amazon_case_id,
            status=filing_result.status,
            error=filing_result.error,
            timestamp=filing_result.timestamp
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting filing status for {claim_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get filing status: {str(e)}")

@acg_router.get("/stats", response_model=ACGStatsResponse)
async def get_acg_stats(acg: AutoClaimsGeneratorService = Depends(get_acg_service)):
    """
    Get ACG pipeline statistics
    
    Returns:
        Comprehensive ACG statistics and system status
    """
    try:
        stats = acg.get_filing_stats()
        
        return ACGStatsResponse(
            total_filings=stats['total_filings'],
            successful_filings=stats['successful_filings'],
            failed_filings=stats['failed_filings'],
            pending_filings=stats['pending_filings'],
            success_rate=stats['success_rate'],
            average_processing_time_hours=stats['average_processing_time_hours'],
            ev_available=acg.is_ev_available(),
            sp_api_available=acg.is_sp_api_available()
        )
        
    except Exception as e:
        logger.error(f"Error getting ACG stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get ACG stats: {str(e)}")

@acg_router.get("/health")
async def get_acg_health(acg: AutoClaimsGeneratorService = Depends(get_acg_service)):
    """Get ACG system health status"""
    try:
        health_data = {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "components": {
                "evidence_validator": acg.is_ev_available(),
                "sp_api_adapter": acg.is_sp_api_available(),
                "database": True  # Assume available if we get here
            },
            "service": "Auto-Claims Generator"
        }
        
        # Check if critical components are available
        if not acg.is_ev_available():
            health_data["status"] = "degraded"
            health_data["warnings"] = ["Evidence Validator not available"]
        
        if not acg.is_sp_api_available():
            health_data["status"] = "degraded"
            health_data["warnings"] = health_data.get("warnings", []) + ["SP-API not available"]
        
        return health_data
        
    except Exception as e:
        logger.error(f"Error getting ACG health: {e}")
        return {
            "status": "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "error": str(e),
            "service": "Auto-Claims Generator"
        }
