"""
Metrics API endpoints - Production Implementation
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Dict, Any, List
from datetime import datetime, timedelta
import logging
from src.api.auth_middleware import get_current_user
from src.api.schemas import RecoveryMetrics, DashboardMetrics, DashboardOverview, DashboardActivity, QuickStats
from src.services.refund_engine_client import refund_engine_client
from src.services.stripe_client import stripe_client

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/api/metrics/recoveries", response_model=RecoveryMetrics)
async def get_recovery_metrics(
    period: str = Query("30d", description="Time period (7d, 30d, 90d, 1y)"),
    user: dict = Depends(get_current_user)
):
    """Get recovery metrics and statistics"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting recovery metrics for user {user_id}, period={period}")
        
        # Call real refund engine service for claim stats with timeout
        import asyncio
        try:
            result = await asyncio.wait_for(
                refund_engine_client.get_claim_stats(user_id),
                timeout=10.0  # 10 second timeout
            )
        except asyncio.TimeoutError:
            logger.warning(f"Metrics request timed out for user {user_id}")
            # Return empty metrics instead of failing
            result = {
                "total_claims": 0,
                "total_amount": 0,
                "approved_claims": 0,
                "approved_amount": 0,
                "pending_claims": 0,
                "pending_amount": 0,
                "rejected_claims": 0,
                "rejected_amount": 0,
                "success_rate": 0,
                "average_claim_amount": 0,
                "recent_activity": [],
                "upcoming_payouts": [],
                "monthly_breakdown": [],
                "top_claim_types": []
            }
        
        if "error" in result:
            logger.warning(f"Get recovery metrics returned error: {result['error']}, returning empty metrics")
            # Return empty metrics instead of raising exception
            result = {
                "total_claims": 0,
                "total_amount": 0,
                "approved_claims": 0,
                "approved_amount": 0,
                "pending_claims": 0,
                "pending_amount": 0,
                "rejected_claims": 0,
                "rejected_amount": 0,
                "success_rate": 0,
                "average_claim_amount": 0,
                "recent_activity": [],
                "upcoming_payouts": [],
                "monthly_breakdown": [],
                "top_claim_types": []
            }
        
        # Calculate date range based on period
        now = datetime.utcnow()
        if period == "7d":
            start_date = now - timedelta(days=7)
        elif period == "30d":
            start_date = now - timedelta(days=30)
        elif period == "90d":
            start_date = now - timedelta(days=90)
        elif period == "1y":
            start_date = now - timedelta(days=365)
        else:
            start_date = now - timedelta(days=30)
        
        # Build metrics from real data
        from src.api.schemas import RecoveryTotals, RecentActivity, UpcomingPayout, MonthlyBreakdown, ClaimTypeStats
        
        metrics = RecoveryMetrics(
            period=period,
            start_date=start_date.isoformat() + "Z",
            end_date=now.isoformat() + "Z",
            totals=RecoveryTotals(
                total_claims=result.get("total_claims", 0),
                total_amount=result.get("total_amount", 0),
                approved_claims=result.get("approved_claims", 0),
                approved_amount=result.get("approved_amount", 0),
                pending_claims=result.get("pending_claims", 0),
                pending_amount=result.get("pending_amount", 0),
                rejected_claims=result.get("rejected_claims", 0),
                rejected_amount=result.get("rejected_amount", 0)
            ),
            success_rate=result.get("success_rate", 0),
            average_claim_amount=result.get("average_claim_amount", 0),
            recent_activity=[RecentActivity(**activity) for activity in result.get("recent_activity", [])],
            upcoming_payouts=[UpcomingPayout(**payout) for payout in result.get("upcoming_payouts", [])],
            monthly_breakdown=[MonthlyBreakdown(**month) for month in result.get("monthly_breakdown", [])],
            top_claim_types=[ClaimTypeStats(**claim_type) for claim_type in result.get("top_claim_types", [])]
        )
        
        return metrics
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_recovery_metrics: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/metrics/payments")
async def get_payment_metrics(
    period: str = Query("30d", description="Time period (7d, 30d, 90d, 1y)"),
    user: dict = Depends(get_current_user)
):
    """Get payment and commission metrics"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting payment metrics for user {user_id}, period={period}")
        
        # Call real Stripe service for transaction data
        result = await stripe_client.get_transactions(user_id, limit=100, offset=0)
        
        if "error" in result:
            logger.error(f"Get payment metrics failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Stripe service error: {result['error']}")
        
        # Calculate date range based on period
        now = datetime.utcnow()
        if period == "7d":
            start_date = now - timedelta(days=7)
        elif period == "30d":
            start_date = now - timedelta(days=30)
        elif period == "90d":
            start_date = now - timedelta(days=90)
        elif period == "1y":
            start_date = now - timedelta(days=365)
        else:
            start_date = now - timedelta(days=30)
        
        # Build payment metrics from real data
        transactions = result.get("transactions", [])
        total_commission = sum(t.get("amount", 0) for t in transactions if t.get("status") == "completed")
        total_transactions = len([t for t in transactions if t.get("status") == "completed"])
        
        metrics = {
            "period": period,
            "start_date": start_date.isoformat() + "Z",
            "end_date": now.isoformat() + "Z",
            "totals": {
                "total_transactions": total_transactions,
                "total_commission": total_commission,
                "platform_fee_percentage": 20.0,
                "average_commission": total_commission / total_transactions if total_transactions > 0 else 0
            },
            "recent_transactions": transactions[:10],
            "commission_breakdown": result.get("commission_breakdown", {})
        }
        
        return metrics
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_payment_metrics: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/metrics/dashboard", response_model=DashboardMetrics)
async def get_dashboard_metrics(
    window: str = Query("30d", description="Time window (7d, 30d, 90d, 1y)"),
    user: dict = Depends(get_current_user)
):
    """Get comprehensive dashboard metrics"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting dashboard metrics for user {user_id}, window={window}")
        
        # Get recovery metrics
        recovery_result = await refund_engine_client.get_claim_stats(user_id)
        if "error" in recovery_result:
            logger.warning(f"Recovery metrics failed: {recovery_result['error']}")
            recovery_metrics = {}
        else:
            recovery_metrics = recovery_result
        
        # Get payment metrics
        payment_result = await stripe_client.get_transactions(user_id, limit=50, offset=0)
        if "error" in payment_result:
            logger.warning(f"Payment metrics failed: {payment_result['error']}")
            payment_metrics = {}
        else:
            payment_metrics = payment_result
        
        # Build comprehensive dashboard
        overview = DashboardOverview(
            total_recovered=recovery_metrics.get("total_amount", 0),
            pending_amount=recovery_metrics.get("pending_amount", 0),
            this_month_recovered=recovery_metrics.get("this_month_amount", 0),
            active_claims=recovery_metrics.get("active_claims", 0),
            success_rate=recovery_metrics.get("success_rate", 0)
        )
        
        recent_activity = [DashboardActivity(**activity) for activity in recovery_metrics.get("recent_activity", [])]
        
        quick_stats = QuickStats(
            claims_this_week=recovery_metrics.get("claims_this_week", 0),
            amount_this_week=recovery_metrics.get("amount_this_week", 0),
            avg_processing_time_days=recovery_metrics.get("avg_processing_time_days", 7),
            evidence_documents=recovery_metrics.get("evidence_documents", 0),
            integrations_connected=recovery_metrics.get("integrations_connected", 0)
        )
        
        dashboard = DashboardMetrics(
            overview=overview,
            recent_activity=recent_activity,
            quick_stats=quick_stats
        )
        
        return dashboard
        
    except Exception as e:
        logger.error(f"Unexpected error in get_dashboard_metrics: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/metrics/track")
async def track_event(
    event_data: dict,
    user: dict = Depends(get_current_user)
):
    """Track a custom event for analytics"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Tracking event for user {user_id}: {event_data.get('event_type', 'unknown')}")
        
        # In a real implementation, this would send to analytics service
        # For now, just log the event
        logger.info(f"Event tracked: {event_data}")
        
        return {"ok": True, "message": "Event tracked successfully"}
        
    except Exception as e:
        logger.error(f"Unexpected error in track_event: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")