"""
Amazon SP-API Service
Handles dispute submission and claim management via Amazon Selling Partner API
"""

import asyncio
import json
import uuid
from typing import Dict, Any, Optional, List
import os
from datetime import datetime, timedelta
import logging
import httpx
from dataclasses import dataclass
from enum import Enum

from src.common.config import settings
from src.common.db_postgresql import DatabaseManager
from src.api.schemas import AuditAction

logger = logging.getLogger(__name__)

class SubmissionStatus(str, Enum):
    """Dispute submission status"""
    PENDING = "pending"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    FAILED = "failed"
    RETRYING = "retrying"

@dataclass
class SPAPIClaim:
    """Amazon SP-API claim data structure"""
    order_id: str
    asin: str
    sku: str
    claim_type: str
    amount_claimed: float
    currency: str
    invoice_number: str
    invoice_date: str
    supporting_documents: List[Dict[str, Any]]
    evidence_summary: str
    seller_notes: Optional[str] = None

@dataclass
class SubmissionResult:
    """Result of dispute submission"""
    success: bool
    submission_id: Optional[str] = None
    amazon_case_id: Optional[str] = None
    status: SubmissionStatus = SubmissionStatus.PENDING
    error_message: Optional[str] = None
    retry_after: Optional[datetime] = None
    submission_timestamp: Optional[datetime] = None

class AmazonSPAPIService:
    """Service for Amazon SP-API dispute submission"""
    
    def __init__(self):
        self.db = DatabaseManager()
        # Robust settings load with environment fallbacks to avoid attribute errors
        self.base_url = getattr(settings, "AMAZON_SPAPI_BASE_URL", os.getenv("AMAZON_SPAPI_BASE_URL", "https://sellingpartnerapi-na.amazon.com"))
        self.client_id = getattr(settings, "AMAZON_SPAPI_CLIENT_ID", os.getenv("AMAZON_SPAPI_CLIENT_ID", ""))
        self.client_secret = getattr(settings, "AMAZON_SPAPI_CLIENT_SECRET", os.getenv("AMAZON_SPAPI_CLIENT_SECRET", ""))
        self.refresh_token = getattr(settings, "AMAZON_SPAPI_REFRESH_TOKEN", os.getenv("AMAZON_SPAPI_REFRESH_TOKEN", ""))
        self.access_token = None
        self.token_expires_at = None
        self.rate_limiter = RateLimiter()
        
    async def submit_dispute(
        self, 
        claim: SPAPIClaim, 
        user_id: str,
        evidence_documents: List[Dict[str, Any]],
        confidence_score: float
    ) -> SubmissionResult:
        """Submit dispute to Amazon SP-API"""
        try:
            # Check rate limits
            await self.rate_limiter.wait_if_needed()
            
            # Get valid access token
            await self._ensure_valid_token()
            
            # Prepare submission payload
            payload = await self._prepare_submission_payload(claim, evidence_documents)
            
            # Submit to SP-API
            response = await self._submit_to_spapi(payload, user_id)
            
            if response["success"]:
                # Log successful submission
                await self._log_submission_success(
                    user_id, claim, response, confidence_score
                )
                
                return SubmissionResult(
                    success=True,
                    submission_id=response["submission_id"],
                    amazon_case_id=response["amazon_case_id"],
                    status=SubmissionStatus.SUBMITTED,
                    submission_timestamp=datetime.utcnow()
                )
            else:
                # Handle submission failure
                return await self._handle_submission_failure(
                    user_id, claim, response, confidence_score
                )
                
        except Exception as e:
            logger.error(f"SP-API submission failed for user {user_id}: {e}")
            return SubmissionResult(
                success=False,
                status=SubmissionStatus.FAILED,
                error_message=str(e)
            )
    
    async def check_submission_status(
        self, 
        submission_id: str, 
        user_id: str
    ) -> Dict[str, Any]:
        """Check status of submitted dispute"""
        try:
            await self._ensure_valid_token()
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/disputes/{submission_id}",
                    headers={
                        "Authorization": f"Bearer {self.access_token}",
                        "Content-Type": "application/json"
                    },
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "success": True,
                        "status": data.get("status"),
                        "amazon_case_id": data.get("case_id"),
                        "resolution": data.get("resolution"),
                        "amount_approved": data.get("amount_approved"),
                        "last_updated": data.get("last_updated")
                    }
                else:
                    return {
                        "success": False,
                        "error": f"SP-API error: {response.status_code} - {response.text}"
                    }
                    
        except Exception as e:
            logger.error(f"Failed to check submission status {submission_id}: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def get_inventory_summaries(self, marketplace_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Get FBA inventory summaries from Amazon SP-API"""
        try:
            await self._ensure_valid_token()
            
            if not marketplace_ids:
                # Try to get marketplace IDs from sellers info first
                sellers_info = await self.get_sellers_info()
                if sellers_info.get("success") and sellers_info.get("marketplaces"):
                    marketplace_ids = [mp["id"] for mp in sellers_info.get("marketplaces", [])]
                else:
                    # Fallback to default US marketplace
                    marketplace_ids = ["ATVPDKIKX0DER"]
            
            inventory_url = f"{self.base_url}/fba/inventory/v1/summaries"
            # For sandbox, the API format might be different - try without granularityType first
            params = {
                "marketplaceIds": ",".join(marketplace_ids)
            }
            
            # Try with granularityType for production, but sandbox may not support it
            if "sandbox" not in self.base_url.lower():
                params["granularityType"] = "Marketplace"
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    inventory_url,
                    headers={
                        "Authorization": f"Bearer {self.access_token}",
                        "x-amz-access-token": self.access_token,
                    },
                    params=params,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    payload = data.get("payload") or data
                    summaries = payload.get("inventorySummaries", []) if isinstance(payload, dict) else []
                    
                    return {
                        "success": True,
                        "total_items": len(summaries),
                        "inventory_summaries": summaries[:10],  # Return first 10 for verification
                        "marketplace_ids": marketplace_ids
                    }
                else:
                    error_text = response.text
                    logger.error(f"Inventory API failed: {response.status_code} - {error_text}")
                    return {
                        "success": False,
                        "error": f"Inventory API error: {response.status_code}",
                        "details": error_text
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get inventory summaries: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def get_user_submissions(
        self, 
        user_id: str, 
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Get user's dispute submissions"""
        try:
            with self.db._connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, submission_id, amazon_case_id, order_id, asin, sku,
                               claim_type, amount_claimed, currency, status, confidence_score,
                               submission_timestamp, resolution_timestamp, error_message,
                               created_at, updated_at
                        FROM dispute_submissions 
                        WHERE user_id = %s
                        ORDER BY created_at DESC
                        LIMIT %s OFFSET %s
                    """, (user_id, limit, offset))
                    
                    submissions = []
                    for row in cursor.fetchall():
                        submissions.append({
                            "id": str(row[0]),
                            "submission_id": row[1],
                            "amazon_case_id": row[2],
                            "order_id": row[3],
                            "asin": row[4],
                            "sku": row[5],
                            "claim_type": row[6],
                            "amount_claimed": row[7],
                            "currency": row[8],
                            "status": row[9],
                            "confidence_score": row[10],
                            "submission_timestamp": row[11].isoformat() + "Z" if row[11] else None,
                            "resolution_timestamp": row[12].isoformat() + "Z" if row[12] else None,
                            "error_message": row[13],
                            "created_at": row[14].isoformat() + "Z",
                            "updated_at": row[15].isoformat() + "Z"
                        })
                    
                    # Get total count
                    cursor.execute("""
                        SELECT COUNT(*) FROM dispute_submissions WHERE user_id = %s
                    """, (user_id,))
                    total = cursor.fetchone()[0]
                    
                    return {
                        "submissions": submissions,
                        "total": total,
                        "has_more": offset + len(submissions) < total
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get user submissions: {e}")
            raise
    
    async def _ensure_valid_token(self):
        """Ensure we have a valid access token"""
        if not self.access_token or (self.token_expires_at and datetime.utcnow() >= self.token_expires_at):
            await self._refresh_access_token()
    
    async def _refresh_access_token(self):
        """Refresh SP-API access token"""
        try:
            # Use LWA (Login with Amazon) token endpoint, NOT SP-API endpoint
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.amazon.com/auth/o2/token",  # LWA endpoint
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": self.refresh_token,
                        "client_id": self.client_id,
                        "client_secret": self.client_secret
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    self.access_token = data["access_token"]
                    expires_in = data.get("expires_in", 3600)
                    self.token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in - 60)
                    logger.info("SP-API access token refreshed successfully")
                    return True
                else:
                    error_text = response.text
                    logger.error(f"Token refresh failed: {response.status_code} - {error_text}")
                    raise Exception(f"Token refresh failed: {response.status_code} - {error_text}")
                    
        except Exception as e:
            logger.error(f"Failed to refresh SP-API token: {e}")
            raise
    
    async def test_connection(self) -> Dict[str, Any]:
        """Test Amazon SP-API connection - verifies credentials and API access"""
        try:
            # Step 1: Refresh access token
            logger.info("Testing Amazon SP-API connection - refreshing token...")
            await self._refresh_access_token()
            
            if not self.access_token:
                return {
                    "success": False,
                    "error": "Failed to obtain access token",
                    "details": "Token refresh returned no access token"
                }
            
            # Step 2: Test Sellers API (marketplaceParticipations) - this is the key test
            logger.info("Testing Sellers API (marketplaceParticipations)...")
            sellers_result = await self.get_sellers_info()
            
            if not sellers_result.get("success"):
                return {
                    "success": False,
                    "error": "Sellers API test failed",
                    "details": sellers_result.get("error"),
                    "token_obtained": True
                }
            
            # Step 3: Try to fetch inventory (optional - may not have permissions)
            inventory_result = None
            try:
                logger.info("Testing Inventory API...")
                inventory_result = await self.get_inventory_summaries()
            except Exception as inv_error:
                logger.warning(f"Inventory API test failed (may not have permissions): {inv_error}")
                inventory_result = {"success": False, "error": str(inv_error), "optional": True}
            
            return {
                "success": True,
                "message": "Amazon SP-API connection successful",
                "base_url": self.base_url,
                "is_sandbox": "sandbox" in self.base_url.lower(),
                "token_status": "valid",
                "token_expires_at": self.token_expires_at.isoformat() if self.token_expires_at else None,
                "sellers_info": sellers_result,
                "inventory_test": inventory_result,
                "permissions": {
                    "sellers_api": sellers_result.get("success", False),
                    "inventory_api": inventory_result.get("success", False) if inventory_result else False
                }
            }
            
        except Exception as e:
            logger.error(f"Amazon SP-API connection test failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "details": "Connection test exception"
            }
    
    async def get_sellers_info(self) -> Dict[str, Any]:
        """Get seller information and marketplace participations"""
        try:
            await self._ensure_valid_token()
            
            sellers_url = f"{self.base_url}/sellers/v1/marketplaceParticipations"
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    sellers_url,
                    headers={
                        "Authorization": f"Bearer {self.access_token}",
                        "x-amz-access-token": self.access_token,
                    },
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    payload = data.get("payload") or data
                    
                    # Handle both formats:
                    # Production: {"payload": {"marketplaceParticipations": [...]}}
                    # Sandbox: {"payload": [...]} or just [...]
                    participations = []
                    if isinstance(payload, dict):
                        participations = payload.get("marketplaceParticipations", [])
                        # If payload is the participation itself
                        if not participations and "marketplace" in payload:
                            participations = [payload]
                    elif isinstance(payload, list):
                        participations = payload
                    
                    # Extract seller info
                    seller_info = {}
                    marketplaces = []
                    
                    if isinstance(participations, list) and len(participations) > 0:
                        first = participations[0]
                        
                        # Extract seller/store info
                        seller_id = (first.get("participation") or {}).get("sellerId") or first.get("sellerId")
                        seller_name = (
                            first.get("participation") or {}
                        ).get("sellerName") or first.get("storeName") or first.get("sellerName")
                        has_suspended = (
                            (first.get("participation") or {}).get("hasSuspendedParticipation", False) or
                            (first.get("participation") or {}).get("hasSuspendedListings", False)
                        )
                        
                        seller_info = {
                            "seller_id": seller_id,
                            "seller_name": seller_name,
                            "store_name": first.get("storeName"),
                            "has_suspended_participation": has_suspended
                        }
                        
                        # Extract marketplace info
                        for p in participations:
                            mp_data = p.get("marketplace") or {}
                            if mp_data:
                                mp_id = mp_data.get("id")
                                mp_name = mp_data.get("name")
                                if mp_id:
                                    marketplaces.append({
                                        "id": mp_id,
                                        "name": mp_name,
                                        "country_code": mp_data.get("countryCode"),
                                        "currency_code": mp_data.get("defaultCurrencyCode"),
                                        "language_code": mp_data.get("defaultLanguageCode"),
                                        "domain": mp_data.get("domainName")
                                    })
                    
                    return {
                        "success": True,
                        "seller_info": seller_info,
                        "marketplaces": marketplaces,
                        "total_marketplaces": len(marketplaces),
                        "raw_response": data  # Include for debugging
                    }
                else:
                    error_text = response.text
                    logger.error(f"Sellers API failed: {response.status_code} - {error_text}")
                    return {
                        "success": False,
                        "error": f"Sellers API error: {response.status_code}",
                        "details": error_text
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get sellers info: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def _prepare_submission_payload(
        self, 
        claim: SPAPIClaim, 
        evidence_documents: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Prepare SP-API submission payload"""
        # Prepare supporting documents
        supporting_docs = []
        for doc in evidence_documents:
            supporting_docs.append({
                "document_type": "invoice",
                "document_url": doc["download_url"],
                "document_name": doc["filename"],
                "document_size": doc["size_bytes"],
                "content_type": doc["content_type"]
            })
        
        return {
            "order_id": claim.order_id,
            "asin": claim.asin,
            "sku": claim.sku,
            "claim_type": claim.claim_type,
            "amount_claimed": claim.amount_claimed,
            "currency": claim.currency,
            "invoice_number": claim.invoice_number,
            "invoice_date": claim.invoice_date,
            "supporting_documents": supporting_docs,
            "evidence_summary": claim.evidence_summary,
            "seller_notes": claim.seller_notes,
            "submission_metadata": {
                "submitted_via": "opside_automation",
                "confidence_score": getattr(claim, 'confidence_score', None),
                "submission_timestamp": datetime.utcnow().isoformat() + "Z"
            }
        }
    
    async def _submit_to_spapi(
        self, 
        payload: Dict[str, Any], 
        user_id: str
    ) -> Dict[str, Any]:
        """Submit dispute to SP-API"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/disputes",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.access_token}",
                        "Content-Type": "application/json",
                        "X-Amz-SP-API-User": user_id
                    },
                    timeout=60.0
                )
                
                if response.status_code == 201:
                    data = response.json()
                    return {
                        "success": True,
                        "submission_id": data.get("submission_id"),
                        "amazon_case_id": data.get("case_id"),
                        "status": data.get("status"),
                        "message": "Dispute submitted successfully"
                    }
                elif response.status_code == 429:
                    # Rate limited
                    retry_after = int(response.headers.get("Retry-After", 60))
                    return {
                        "success": False,
                        "error": "Rate limited",
                        "retry_after": retry_after
                    }
                else:
                    return {
                        "success": False,
                        "error": f"SP-API error: {response.status_code} - {response.text}"
                    }
                    
        except httpx.TimeoutException:
            return {
                "success": False,
                "error": "SP-API request timeout"
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"SP-API request failed: {str(e)}"
            }
    
    async def _log_submission_success(
        self, 
        user_id: str, 
        claim: SPAPIClaim, 
        response: Dict[str, Any],
        confidence_score: float
    ):
        """Log successful submission"""
        submission_id = str(uuid.uuid4())
        
        with self.db._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO dispute_submissions 
                    (id, user_id, submission_id, amazon_case_id, order_id, asin, sku,
                     claim_type, amount_claimed, currency, status, confidence_score,
                     submission_timestamp, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    submission_id, user_id, response["submission_id"], 
                    response["amazon_case_id"], claim.order_id, claim.asin, claim.sku,
                    claim.claim_type, claim.amount_claimed, claim.currency,
                    SubmissionStatus.SUBMITTED.value, confidence_score,
                    datetime.utcnow(), datetime.utcnow(), datetime.utcnow()
                ))
        
        # Log audit event
        await self._log_audit_event(
            user_id=user_id,
            action=AuditAction.PACKET_GENERATED,  # Reuse for submission
            entity_type="dispute_submission",
            entity_id=submission_id,
            details={
                "submission_id": response["submission_id"],
                "amazon_case_id": response["amazon_case_id"],
                "order_id": claim.order_id,
                "amount_claimed": claim.amount_claimed,
                "confidence_score": confidence_score,
                "submitted_at": datetime.utcnow().isoformat() + "Z"
            }
        )
    
    async def _handle_submission_failure(
        self, 
        user_id: str, 
        claim: SPAPIClaim, 
        response: Dict[str, Any],
        confidence_score: float
    ) -> SubmissionResult:
        """Handle submission failure with retry logic"""
        error_message = response.get("error", "Unknown error")
        retry_after = response.get("retry_after")
        
        # Log failure
        await self._log_submission_failure(user_id, claim, error_message, confidence_score)
        
        # Determine if we should retry
        if retry_after and retry_after < 3600:  # Retry if less than 1 hour
            retry_time = datetime.utcnow() + timedelta(seconds=retry_after)
            return SubmissionResult(
                success=False,
                status=SubmissionStatus.RETRYING,
                error_message=error_message,
                retry_after=retry_time
            )
        else:
            return SubmissionResult(
                success=False,
                status=SubmissionStatus.FAILED,
                error_message=error_message
            )
    
    async def _log_submission_failure(
        self, 
        user_id: str, 
        claim: SPAPIClaim, 
        error_message: str,
        confidence_score: float
    ):
        """Log submission failure"""
        submission_id = str(uuid.uuid4())
        
        with self.db._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO dispute_submissions 
                    (id, user_id, order_id, asin, sku, claim_type, amount_claimed, 
                     currency, status, confidence_score, error_message, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    submission_id, user_id, claim.order_id, claim.asin, claim.sku,
                    claim.claim_type, claim.amount_claimed, claim.currency,
                    SubmissionStatus.FAILED.value, confidence_score, error_message,
                    datetime.utcnow(), datetime.utcnow()
                ))
    
    async def _log_audit_event(
        self,
        user_id: str,
        action: AuditAction,
        entity_type: str,
        entity_id: str,
        details: Dict[str, Any]
    ):
        """Log audit event"""
        try:
            with self.db._connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT log_audit_event(%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        user_id, None, action.value, entity_type, entity_id,
                        json.dumps(details), None, None
                    ))
        except Exception as e:
            logger.error(f"Failed to log audit event: {e}")

class RateLimiter:
    """Rate limiter for SP-API calls"""
    
    def __init__(self):
        self.last_request_time = None
        self.min_interval = 1.0  # Minimum 1 second between requests
        self.burst_limit = 10
        self.burst_window = 60  # 10 requests per minute
        self.request_times = []
    
    async def wait_if_needed(self):
        """Wait if rate limit would be exceeded"""
        now = datetime.utcnow()
        
        # Clean old request times
        cutoff = now - timedelta(seconds=self.burst_window)
        self.request_times = [t for t in self.request_times if t > cutoff]
        
        # Check burst limit
        if len(self.request_times) >= self.burst_limit:
            sleep_time = (self.request_times[0] + timedelta(seconds=self.burst_window) - now).total_seconds()
            if sleep_time > 0:
                logger.info(f"Rate limit reached, waiting {sleep_time:.2f} seconds")
                await asyncio.sleep(sleep_time)
        
        # Check minimum interval
        if self.last_request_time:
            time_since_last = (now - self.last_request_time).total_seconds()
            if time_since_last < self.min_interval:
                sleep_time = self.min_interval - time_since_last
                await asyncio.sleep(sleep_time)
        
        # Record this request
        self.request_times.append(now)
        self.last_request_time = now

# Global instance
amazon_spapi_service = AmazonSPAPIService()
