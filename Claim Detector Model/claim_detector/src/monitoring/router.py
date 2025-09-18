"""
Monitoring Router
FastAPI router for monitoring and dashboard endpoints
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
import logging
from datetime import datetime, timedelta

# Optional database imports
try:
    from ..database import get_db, ClaimCRUD, ValidationCRUD, FilingCRUD
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False
    get_db = None
    ClaimCRUD = None
    ValidationCRUD = None
    FilingCRUD = None

logger = logging.getLogger(__name__)

# Create router
monitoring_router = APIRouter(tags=["Monitoring"])

# Pydantic models
class ClaimSummary(BaseModel):
    """Claim summary model"""
    total_claims: int
    detected: int
    validated: int
    filed: int
    rejected: int
    pending: int
    success_rate: float
    avg_processing_time_hours: float

class ClaimDetail(BaseModel):
    """Detailed claim information"""
    claim_id: str
    seller_id: str
    status: str
    claim_type: str
    amount: float
    created_at: str
    updated_at: str
    pipeline_stage: str
    validation_status: Optional[str] = None
    filing_status: Optional[str] = None
    amazon_case_id: Optional[str] = None

class PipelineStats(BaseModel):
    """Pipeline statistics"""
    total_claims: int
    success_rate: float
    avg_payout_timeline_days: float
    rejection_rate: float
    avg_claim_amount: float
    top_claim_types: List[Dict[str, Any]]
    marketplace_distribution: List[Dict[str, Any]]

class MonitoringStats(BaseModel):
    """Overall monitoring statistics"""
    claims_summary: ClaimSummary
    pipeline_stats: PipelineStats
    recent_activity: List[Dict[str, Any]]
    system_health: Dict[str, Any]

@monitoring_router.get("/claims/summary", response_model=ClaimSummary)
async def get_claims_summary():
    """
    Get aggregate claim counts by status
    
    Returns:
        Summary of claims by status with success rates
    """
    if not DATABASE_AVAILABLE:
        # Return mock data when database is not available
        return ClaimSummary(
            total_claims=100,
            detected=20,
            validated=30,
            filed=40,
            rejected=5,
            pending=5,
            success_rate=40.0,
            avg_processing_time_hours=2.5
        )
    
    try:
        db = next(get_db())
        
        # Get claim counts by status
        status_counts = ClaimCRUD.get_claims_by_status(db)
        
        # Calculate totals
        total_claims = sum(status_counts.values())
        detected = status_counts.get('detected', 0)
        validated = status_counts.get('validated', 0)
        filed = status_counts.get('filed', 0)
        rejected = status_counts.get('rejected', 0)
        pending = status_counts.get('pending', 0)
        
        # Calculate success rate (filed / total)
        success_rate = (filed / total_claims * 100) if total_claims > 0 else 0.0
        
        # Get average processing time
        avg_processing_time = ClaimCRUD.get_avg_processing_time(db)
        
        return ClaimSummary(
            total_claims=total_claims,
            detected=detected,
            validated=validated,
            filed=filed,
            rejected=rejected,
            pending=pending,
            success_rate=success_rate,
            avg_processing_time_hours=avg_processing_time
        )
        
    except Exception as e:
        logger.error(f"Error getting claims summary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get claims summary: {str(e)}")

@monitoring_router.get("/claims/{claim_id}", response_model=ClaimDetail)
async def get_claim_detail(claim_id: str):
    """
    Get detailed pipeline status for a single claim
    
    Args:
        claim_id: Unique claim identifier
        
    Returns:
        Detailed claim information with pipeline status
    """
    try:
        db = next(get_db())
        
        # Get claim details
        claim = ClaimCRUD.get_claim_by_id(db, claim_id)
        if not claim:
            raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")
        
        # Get validation status
        validation = ValidationCRUD.get_latest_validation_by_claim_id(db, claim_id)
        
        # Get filing status
        filing = FilingCRUD.get_filing_by_claim_id(db, claim_id)
        
        # Determine pipeline stage
        pipeline_stage = self._determine_pipeline_stage(claim, validation, filing)
        
        return ClaimDetail(
            claim_id=claim['claim_id'],
            seller_id=claim['seller_id'],
            status=claim['status'],
            claim_type=claim['claim_type'],
            amount=claim['amount'],
            created_at=claim['created_at'],
            updated_at=claim['updated_at'],
            pipeline_stage=pipeline_stage,
            validation_status=validation['status'] if validation else None,
            filing_status=filing['status'] if filing else None,
            amazon_case_id=filing['amazon_case_id'] if filing else None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting claim detail for {claim_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get claim detail: {str(e)}")

@monitoring_router.get("/stats", response_model=PipelineStats)
async def get_pipeline_stats():
    """
    Get comprehensive pipeline statistics
    
    Returns:
        Pipeline statistics including success rates and timelines
    """
    try:
        db = next(get_db())
        
        # Get basic stats
        total_claims = ClaimCRUD.get_total_claims(db)
        success_rate = ClaimCRUD.get_success_rate(db)
        avg_payout_timeline = ClaimCRUD.get_avg_payout_timeline(db)
        rejection_rate = ClaimCRUD.get_rejection_rate(db)
        avg_claim_amount = ClaimCRUD.get_avg_claim_amount(db)
        
        # Get top claim types
        top_claim_types = ClaimCRUD.get_top_claim_types(db, limit=5)
        
        # Get marketplace distribution
        marketplace_distribution = ClaimCRUD.get_marketplace_distribution(db)
        
        return PipelineStats(
            total_claims=total_claims,
            success_rate=success_rate,
            avg_payout_timeline_days=avg_payout_timeline,
            rejection_rate=rejection_rate,
            avg_claim_amount=avg_claim_amount,
            top_claim_types=top_claim_types,
            marketplace_distribution=marketplace_distribution
        )
        
    except Exception as e:
        logger.error(f"Error getting pipeline stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get pipeline stats: {str(e)}")

@monitoring_router.get("/dashboard", response_model=MonitoringStats)
async def get_dashboard_data():
    """
    Get comprehensive dashboard data
    
    Returns:
        Complete monitoring dashboard data
    """
    try:
        db = next(get_db())
        
        # Get claims summary
        status_counts = ClaimCRUD.get_claims_by_status(db)
        total_claims = sum(status_counts.values())
        success_rate = (status_counts.get('filed', 0) / total_claims * 100) if total_claims > 0 else 0.0
        avg_processing_time = ClaimCRUD.get_avg_processing_time(db)
        
        claims_summary = ClaimSummary(
            total_claims=total_claims,
            detected=status_counts.get('detected', 0),
            validated=status_counts.get('validated', 0),
            filed=status_counts.get('filed', 0),
            rejected=status_counts.get('rejected', 0),
            pending=status_counts.get('pending', 0),
            success_rate=success_rate,
            avg_processing_time_hours=avg_processing_time
        )
        
        # Get pipeline stats
        pipeline_stats = PipelineStats(
            total_claims=total_claims,
            success_rate=success_rate,
            avg_payout_timeline_days=ClaimCRUD.get_avg_payout_timeline(db),
            rejection_rate=ClaimCRUD.get_rejection_rate(db),
            avg_claim_amount=ClaimCRUD.get_avg_claim_amount(db),
            top_claim_types=ClaimCRUD.get_top_claim_types(db, limit=5),
            marketplace_distribution=ClaimCRUD.get_marketplace_distribution(db)
        )
        
        # Get recent activity
        recent_activity = self._get_recent_activity(db)
        
        # Get system health
        system_health = self._get_system_health(db)
        
        return MonitoringStats(
            claims_summary=claims_summary,
            pipeline_stats=pipeline_stats,
            recent_activity=recent_activity,
            system_health=system_health
        )
        
    except Exception as e:
        logger.error(f"Error getting dashboard data: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get dashboard data: {str(e)}")

@monitoring_router.get("/health")
async def get_system_health():
    """Get system health status"""
    try:
        db = next(get_db())
        
        health_data = self._get_system_health(db)
        
        return {
            "status": "healthy" if health_data['database_connected'] else "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "components": health_data
        }
        
    except Exception as e:
        logger.error(f"Error getting system health: {e}")
        return {
            "status": "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "error": str(e)
        }

def _determine_pipeline_stage(self, claim: Dict[str, Any], validation: Optional[Dict[str, Any]], 
                            filing: Optional[Dict[str, Any]]) -> str:
    """Determine current pipeline stage for a claim"""
    if filing and filing['status'] == 'submitted':
        return 'filed'
    elif validation and validation['status'] == 'valid':
        return 'validated'
    elif validation and validation['status'] == 'invalid':
        return 'rejected'
    elif validation and validation['status'] == 'review':
        return 'under_review'
    else:
        return 'detected'

def _get_recent_activity(self, db) -> List[Dict[str, Any]]:
    """Get recent activity for dashboard"""
    try:
        # Get recent claims
        recent_claims = ClaimCRUD.get_recent_claims(db, limit=10)
        
        activity = []
        for claim in recent_claims:
            activity.append({
                'type': 'claim_created',
                'claim_id': claim['claim_id'],
                'timestamp': claim['created_at'],
                'description': f"New {claim['claim_type']} claim for ${claim['amount']:.2f}"
            })
        
        # Get recent validations
        recent_validations = ValidationCRUD.get_recent_validations(db, limit=5)
        for validation in recent_validations:
            activity.append({
                'type': 'claim_validated',
                'claim_id': validation['claim_id'],
                'timestamp': validation['timestamp'],
                'description': f"Claim validated with status: {validation['status']}"
            })
        
        # Get recent filings
        recent_filings = FilingCRUD.get_recent_filings(db, limit=5)
        for filing in recent_filings:
            activity.append({
                'type': 'claim_filed',
                'claim_id': filing['claim_id'],
                'timestamp': filing['timestamp'],
                'description': f"Claim filed with Amazon: {filing['amazon_case_id']}"
            })
        
        # Sort by timestamp
        activity.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return activity[:20]  # Return top 20 activities
        
    except Exception as e:
        logger.error(f"Error getting recent activity: {e}")
        return []

def _get_system_health(self, db) -> Dict[str, Any]:
    """Get system health information"""
    try:
        # Check database connection
        db_connected = True
        try:
            ClaimCRUD.get_total_claims(db)
        except:
            db_connected = False
        
        # Get component status
        health_data = {
            'database_connected': db_connected,
            'evidence_validator': True,  # Assume EV is running
            'sp_api_adapter': True,      # Assume SP-API is available
            'claim_detector': True,      # Assume CD is running
            'last_claim_processed': ClaimCRUD.get_last_claim_timestamp(db),
            'total_claims_today': ClaimCRUD.get_claims_count_since(db, datetime.now().date()),
            'avg_response_time_ms': 150,  # Mock value
            'uptime_hours': 24.5         # Mock value
        }
        
        return health_data
        
    except Exception as e:
        logger.error(f"Error getting system health: {e}")
        return {
            'database_connected': False,
            'evidence_validator': False,
            'sp_api_adapter': False,
            'claim_detector': False,
            'error': str(e)
        }

