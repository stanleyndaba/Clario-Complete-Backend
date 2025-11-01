"""
Mock Service Clients - Fallback when real services are unavailable
"""

from typing import Dict, Any, List
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

class MockRefundEngineClient:
    """Mock refund engine client with realistic data"""
    
    async def get_claim_stats(self, user_id: str) -> Dict[str, Any]:
        """Return mock claim statistics"""
        return {
            "total_claims": 47,
            "total_amount": 3847.50,
            "approved_claims": 32,
            "approved_amount": 2856.75,
            "pending_claims": 12,
            "pending_amount": 890.25,
            "rejected_claims": 3,
            "rejected_amount": 100.50,
            "success_rate": 91.5,
            "average_claim_amount": 81.86,
            "this_month_amount": 1247.50,
            "claims_this_week": 8,
            "amount_this_week": 456.75,
            "avg_processing_time_days": 5.2,
            "evidence_documents": 23,
            "integrations_connected": 2,
            "recent_activity": [
                {
                    "id": "act_001",
                    "type": "claim_approved",
                    "description": "Lost inventory claim approved",
                    "amount": 89.99,
                    "timestamp": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z"
                },
                {
                    "id": "act_002", 
                    "type": "claim_submitted",
                    "description": "Damaged goods claim submitted",
                    "amount": 156.50,
                    "timestamp": (datetime.utcnow() - timedelta(hours=6)).isoformat() + "Z"
                }
            ],
            "upcoming_payouts": [
                {
                    "id": "payout_001",
                    "amount": 234.75,
                    "expected_date": (datetime.utcnow() + timedelta(days=3)).isoformat() + "Z",
                    "status": "processing"
                }
            ],
            "monthly_breakdown": [
                {"month": "2025-01", "claims": 15, "amount": 1247.50},
                {"month": "2024-12", "claims": 18, "amount": 1456.25},
                {"month": "2024-11", "claims": 14, "amount": 1143.75}
            ],
            "top_claim_types": [
                {"type": "lost_inventory", "count": 18, "amount": 1456.75},
                {"type": "damaged_goods", "count": 12, "amount": 987.25},
                {"type": "fee_overcharge", "count": 17, "amount": 1403.50}
            ]
        }
    
    async def get_claims(self, user_id: str, status: str = None, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        """Return mock claims list"""
        claims = [
            {
                "id": "claim_001",
                "order_id": "123-4567890-1234567",
                "asin": "B08N5WRWNW",
                "sku": "TEST-SKU-001",
                "claim_type": "lost_inventory",
                "amount": 89.99,
                "currency": "USD",
                "status": "approved",
                "confidence_score": 0.94,
                "created_at": (datetime.utcnow() - timedelta(days=5)).isoformat() + "Z",
                "updated_at": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z",
                "amazon_case_id": "AMZ-CASE-001",
                "expected_payout_date": (datetime.utcnow() + timedelta(days=2)).isoformat() + "Z"
            },
            {
                "id": "claim_002",
                "order_id": "123-7890123-4567890",
                "asin": "B07XYZ1234",
                "sku": "TEST-SKU-002", 
                "claim_type": "damaged_goods",
                "amount": 156.50,
                "currency": "USD",
                "status": "pending",
                "confidence_score": 0.87,
                "created_at": (datetime.utcnow() - timedelta(days=2)).isoformat() + "Z",
                "updated_at": (datetime.utcnow() - timedelta(hours=6)).isoformat() + "Z",
                "amazon_case_id": "AMZ-CASE-002",
                "expected_payout_date": (datetime.utcnow() + timedelta(days=5)).isoformat() + "Z"
            }
        ]
        
        # Filter by status if provided
        if status:
            claims = [c for c in claims if c["status"] == status]
        
        # Apply pagination
        total = len(claims)
        claims = claims[offset:offset + limit]
        
        return {
            "recoveries": claims,
            "total": total,
            "has_more": offset + len(claims) < total
        }
    
    async def get_claim(self, user_id: str, claim_id: str) -> Dict[str, Any]:
        """Return mock claim details"""
        return {
            "id": claim_id,
            "order_id": "123-4567890-1234567",
            "asin": "B08N5WRWNW",
            "sku": "TEST-SKU-001",
            "claim_type": "lost_inventory",
            "amount": 89.99,
            "currency": "USD",
            "status": "approved",
            "confidence_score": 0.94,
            "created_at": (datetime.utcnow() - timedelta(days=5)).isoformat() + "Z",
            "updated_at": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z",
            "amazon_case_id": "AMZ-CASE-001",
            "amazon_status": "Approved",
            "expected_payout_date": (datetime.utcnow() + timedelta(days=2)).isoformat() + "Z",
            "timeline": [
                {
                    "status": "created",
                    "timestamp": (datetime.utcnow() - timedelta(days=5)).isoformat() + "Z",
                    "description": "Claim created and evidence gathered"
                },
                {
                    "status": "submitted",
                    "timestamp": (datetime.utcnow() - timedelta(days=4)).isoformat() + "Z", 
                    "description": "Claim submitted to Amazon SP-API"
                },
                {
                    "status": "approved",
                    "timestamp": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z",
                    "description": "Claim approved by Amazon"
                }
            ]
        }

class MockStripeClient:
    """Mock Stripe client with realistic transaction data"""
    
    async def get_transactions(self, user_id: str, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        """Return mock transaction data"""
        transactions = [
            {
                "id": "txn_001",
                "amount": 17.99,
                "currency": "USD",
                "status": "completed",
                "type": "commission",
                "description": "20% commission on $89.99 recovery",
                "created_at": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z",
                "claim_id": "claim_001"
            },
            {
                "id": "txn_002",
                "amount": 31.30,
                "currency": "USD", 
                "status": "completed",
                "type": "commission",
                "description": "20% commission on $156.50 recovery",
                "created_at": (datetime.utcnow() - timedelta(days=1)).isoformat() + "Z",
                "claim_id": "claim_002"
            }
        ]
        
        return {
            "transactions": transactions[offset:offset + limit],
            "total": len(transactions),
            "has_more": offset + limit < len(transactions),
            "commission_breakdown": {
                "this_month": 49.29,
                "last_month": 87.45,
                "total": 136.74
            }
        }

class MockIntegrationsClient:
    """Mock integrations client"""
    
    async def get_user_integrations(self, user_id: str) -> Dict[str, Any]:
        """Return mock integration status"""
        return {
            "integrations": [
                {
                    "type": "amazon",
                    "status": "connected",
                    "connected_at": (datetime.utcnow() - timedelta(days=7)).isoformat() + "Z",
                    "last_sync": (datetime.utcnow() - timedelta(hours=1)).isoformat() + "Z",
                    "seller_id": "A1SANDBOX123"
                },
                {
                    "type": "gmail",
                    "status": "disconnected",
                    "connected_at": None,
                    "last_sync": None
                },
                {
                    "type": "stripe",
                    "status": "connected", 
                    "connected_at": (datetime.utcnow() - timedelta(days=6)).isoformat() + "Z",
                    "customer_id": "cus_sandbox123"
                }
            ]
        }
    
    async def start_sync(self, user_id: str, sync_type: str = "inventory") -> Dict[str, Any]:
        """Return mock sync job"""
        return {
            "id": f"sync_{int(datetime.utcnow().timestamp())}",
            "status": "processing",
            "sync_type": sync_type,
            "started_at": datetime.utcnow().isoformat() + "Z",
            "estimated_completion": (datetime.utcnow() + timedelta(minutes=5)).isoformat() + "Z",
            "message": f"Started {sync_type} sync for user {user_id}"
        }
    
    async def get_sync_status(self, sync_id: str, user_id: str) -> Dict[str, Any]:
        """Return mock sync status"""
        return {
            "id": sync_id,
            "status": "completed",
            "sync_type": "inventory",
            "started_at": (datetime.utcnow() - timedelta(minutes=5)).isoformat() + "Z",
            "completed_at": datetime.utcnow().isoformat() + "Z",
            "records_processed": 1247,
            "claims_found": 23,
            "message": "Sync completed successfully"
        }

# Global mock instances
mock_refund_engine = MockRefundEngineClient()
mock_stripe_client = MockStripeClient()
mock_integrations_client = MockIntegrationsClient()