"""
Stripe Payments Client
"""

import httpx
from typing import Dict, Any, Optional
import logging
from src.services.service_directory import service_directory

logger = logging.getLogger(__name__)

class StripeClient:
    """Client for Stripe Payments service"""
    
    def __init__(self):
        self.service_name = "stripe"
    
    async def create_customer_setup(self, user_id: str, email: str) -> Dict[str, Any]:
        """Create Stripe customer and setup intent"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/v1/stripe/create-customer-setup",
                json={
                    "userId": user_id,
                    "email": email
                }
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to create customer setup", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Create customer setup failed: {e}")
            return {"error": str(e)}
    
    async def create_subscription(self, user_id: str, customer_id: str, price_id: Optional[str] = None) -> Dict[str, Any]:
        """Create Stripe subscription"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/v1/stripe/create-subscription",
                json={
                    "userId": user_id,
                    "customerId": customer_id,
                    "priceId": price_id
                }
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to create subscription", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Create subscription failed: {e}")
            return {"error": str(e)}
    
    async def charge_commission(self, user_id: str, claim_id: str, amount_cents: int, currency: str = "usd") -> Dict[str, Any]:
        """Charge 20% platform commission"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "POST",
                "/api/v1/stripe/charge-commission",
                json={
                    "userId": user_id,
                    "claimId": claim_id,
                    "amountRecoveredCents": amount_cents,
                    "currency": currency
                }
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to charge commission", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Charge commission failed: {e}")
            return {"error": str(e)}
    
    async def get_transactions(self, user_id: str, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        """Get user transactions"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/stripe/transactions/{user_id}",
                params={"limit": limit, "offset": offset}
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get transactions", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get transactions failed: {e}")
            return {"error": str(e)}
    
    async def get_stripe_status(self, user_id: str) -> Dict[str, Any]:
        """Get Stripe account status"""
        try:
            response = await service_directory.call_service(
                self.service_name,
                "GET",
                f"/api/v1/stripe/status/{user_id}"
            )
            
            if response and response.status_code == 200:
                return response.json()
            else:
                return {"error": "Failed to get Stripe status", "status_code": response.status_code if response else None}
                
        except Exception as e:
            logger.error(f"Get Stripe status failed: {e}")
            return {"error": str(e)}

# Global client instance
stripe_client = StripeClient()



