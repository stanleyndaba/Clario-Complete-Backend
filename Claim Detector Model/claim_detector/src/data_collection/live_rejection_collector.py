#!/usr/bin/env python3
"""
Live Amazon Rejection Log Collector for Claim Detector v2.0
Ingests real-time rejection data from Amazon APIs for continuous learning
"""

import asyncio
import aiohttp
import pandas as pd
import numpy as np
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
import json
import re
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from .data_collector import AmazonAPIConfig

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class RejectionLog:
    """Structured rejection log entry"""
    rejection_id: str
    sku: str
    asin: str
    claim_type: str
    rejection_reason: str
    rejection_date: datetime
    amount_requested: float
    quantity_affected: int
    seller_id: str
    marketplace_id: str
    raw_amazon_data: Dict[str, Any]
    processing_status: str = "unprocessed"
    normalized_reason: Optional[str] = None
    confidence_score: Optional[float] = None
    is_fixable: Optional[bool] = None

@dataclass
class RejectionCollectionConfig:
    """Configuration for rejection collection"""
    collection_interval_minutes: int = 15
    max_hours_back: int = 24
    batch_size: int = 100
    retry_attempts: int = 3
    retry_delay_seconds: int = 30
    enable_real_time: bool = True
    enable_batch_collection: bool = True

class LiveRejectionCollector:
    """Collects live rejection data from Amazon APIs"""
    
    def __init__(self, amazon_config: AmazonAPIConfig, collection_config: RejectionCollectionConfig):
        self.amazon_config = amazon_config
        self.config = collection_config
        self.base_url = "https://sellingpartnerapi-na.amazon.com"
        self.session = None
        self.access_token = None
        self.token_expiry = None
        
        # Rejection endpoints for different data sources
        self.rejection_endpoints = {
            "inventory_ledger": "/fba/inventory/v1/inventoryLedger",
            "inventory_adjustments": "/fba/inventory/v1/inventoryAdjustments",
            "inventory_summaries": "/fba/inventory/v1/inventorySummaries",
            "financial_events": "/finances/v0/financialEvents",
            "reimbursements": "/fba/inventory/v1/reimbursements"
        }
        
        # Collection statistics
        self.collection_stats = {
            "total_rejections_collected": 0,
            "last_collection_time": None,
            "collection_errors": 0,
            "successful_collections": 0
        }
    
    async def __aenter__(self):
        """Async context manager entry"""
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()
    
    async def _get_access_token(self) -> str:
        """Get OAuth access token for Amazon API"""
        if self.access_token and self.token_expiry and datetime.now() < self.token_expiry:
            return self.access_token
        
        try:
            token_url = f"{self.base_url}/oauth/token"
            payload = {
                "grant_type": "refresh_token",
                "refresh_token": self.amazon_config.refresh_token
            }
            
            async with self.session.post(token_url, json=payload) as response:
                response.raise_for_status()
                token_data = await response.json()
                
                self.access_token = token_data['access_token']
                self.token_expiry = datetime.now() + timedelta(hours=1)
                
                logger.info("✅ Amazon API access token refreshed")
                return self.access_token
                
        except Exception as e:
            logger.error(f"❌ Failed to get Amazon API token: {e}")
            raise
    
    async def collect_rejections(self, hours_back: Optional[int] = None) -> List[RejectionLog]:
        """Collect live rejection data from Amazon APIs"""
        if hours_back is None:
            hours_back = self.config.max_hours_back
        
        logger.info(f"🔄 Collecting rejections from last {hours_back} hours")
        
        all_rejections = []
        start_time = datetime.now() - timedelta(hours=hours_back)
        
        try:
            # Collect from each endpoint
            for endpoint_name, endpoint_path in self.rejection_endpoints.items():
                logger.info(f"📡 Collecting from {endpoint_name}")
                
                endpoint_rejections = await self._collect_from_endpoint(
                    endpoint_name, endpoint_path, start_time
                )
                
                if endpoint_rejections:
                    all_rejections.extend(endpoint_rejections)
                    logger.info(f"✅ Collected {len(endpoint_rejections)} rejections from {endpoint_name}")
                
                # Rate limiting between endpoints
                await asyncio.sleep(1)
            
            # Update collection statistics
            self.collection_stats["total_rejections_collected"] += len(all_rejections)
            self.collection_stats["last_collection_time"] = datetime.now()
            self.collection_stats["successful_collections"] += 1
            
            logger.info(f"🎯 Total rejections collected: {len(all_rejections)}")
            return all_rejections
            
        except Exception as e:
            logger.error(f"❌ Error during rejection collection: {e}")
            self.collection_stats["collection_errors"] += 1
            raise
    
    async def _collect_from_endpoint(self, endpoint_name: str, endpoint_path: str, start_time: datetime) -> List[RejectionLog]:
        """Collect rejections from a specific endpoint"""
        try:
            token = await self._get_access_token()
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # Build request parameters based on endpoint
            params = self._build_endpoint_params(endpoint_name, start_time)
            
            url = f"{self.base_url}{endpoint_path}"
            
            async with self.session.get(url, headers=headers, params=params) as response:
                response.raise_for_status()
                data = await response.json()
                
                # Parse rejections based on endpoint type
                rejections = self._parse_endpoint_rejections(endpoint_name, data)
                return rejections
                
        except Exception as e:
            logger.error(f"❌ Error collecting from {endpoint_name}: {e}")
            return []
    
    def _build_endpoint_params(self, endpoint_name: str, start_time: datetime) -> Dict[str, Any]:
        """Build request parameters for different endpoints"""
        base_params = {
            "marketplaceIds": self.amazon_config.marketplace_id,
            "sellerId": self.amazon_config.seller_id
        }
        
        if endpoint_name in ["inventory_ledger", "inventory_adjustments"]:
            base_params.update({
                "startDate": start_time.strftime("%Y-%m-%d"),
                "endDate": datetime.now().strftime("%Y-%m-%d")
            })
        elif endpoint_name == "financial_events":
            base_params.update({
                "postedAfter": start_time.isoformat(),
                "postedBefore": datetime.now().isoformat()
            })
        
        return base_params
    
    def _parse_endpoint_rejections(self, endpoint_name: str, raw_data: Dict[str, Any]) -> List[RejectionLog]:
        """Parse rejections from different endpoint response formats"""
        rejections = []
        
        try:
            if endpoint_name == "inventory_ledger":
                rejections = self._parse_inventory_ledger_rejections(raw_data)
            elif endpoint_name == "inventory_adjustments":
                rejections = self._parse_inventory_adjustments_rejections(raw_data)
            elif endpoint_name == "financial_events":
                rejections = self._parse_financial_events_rejections(raw_data)
            elif endpoint_name == "reimbursements":
                rejections = self._parse_reimbursements_rejections(raw_data)
            else:
                rejections = self._parse_generic_rejections(raw_data)
                
        except Exception as e:
            logger.error(f"❌ Error parsing {endpoint_name} rejections: {e}")
        
        return rejections
    
    def _parse_inventory_ledger_rejections(self, data: Dict[str, Any]) -> List[RejectionLog]:
        """Parse rejections from inventory ledger data"""
        rejections = []
        
        if "inventoryLedger" not in data:
            return rejections
        
        for entry in data["inventoryLedger"]:
            # Look for rejection indicators in inventory ledger
            if self._is_rejection_entry(entry):
                rejection = RejectionLog(
                    rejection_id=f"ledger_{entry.get('id', 'unknown')}",
                    sku=entry.get('sellerSku', ''),
                    asin=entry.get('asin', ''),
                    claim_type=self._infer_claim_type(entry),
                    rejection_reason=entry.get('reason', 'Unknown rejection'),
                    rejection_date=datetime.fromisoformat(entry.get('date', datetime.now().isoformat())),
                    amount_requested=float(entry.get('amount', 0.0)),
                    quantity_affected=int(entry.get('quantity', 0)),
                    seller_id=self.amazon_config.seller_id,
                    marketplace_id=self.amazon_config.marketplace_id,
                    raw_amazon_data=entry
                )
                rejections.append(rejection)
        
        return rejections
    
    def _parse_inventory_adjustments_rejections(self, data: Dict[str, Any]) -> List[RejectionLog]:
        """Parse rejections from inventory adjustments data"""
        rejections = []
        
        if "inventoryAdjustments" not in data:
            return rejections
        
        for adjustment in data["inventoryAdjustments"]:
            if self._is_rejection_adjustment(adjustment):
                rejection = RejectionLog(
                    rejection_id=f"adjustment_{adjustment.get('id', 'unknown')}",
                    sku=adjustment.get('sellerSku', ''),
                    asin=adjustment.get('asin', ''),
                    claim_type=self._infer_claim_type(adjustment),
                    rejection_reason=adjustment.get('reason', 'Adjustment rejection'),
                    rejection_date=datetime.fromisoformat(adjustment.get('date', datetime.now().isoformat())),
                    amount_requested=float(adjustment.get('amount', 0.0)),
                    quantity_affected=int(adjustment.get('quantity', 0)),
                    seller_id=self.amazon_config.seller_id,
                    marketplace_id=self.amazon_config.marketplace_id,
                    raw_amazon_data=adjustment
                )
                rejections.append(rejection)
        
        return rejections
    
    def _parse_financial_events_rejections(self, data: Dict[str, Any]) -> List[RejectionLog]:
        """Parse rejections from financial events data"""
        rejections = []
        
        if "financialEvents" not in data:
            return rejections
        
        for event in data["financialEvents"]:
            if self._is_rejection_event(event):
                rejection = RejectionLog(
                    rejection_id=f"financial_{event.get('id', 'unknown')}",
                    sku=event.get('sellerSku', ''),
                    asin=event.get('asin', ''),
                    claim_type=self._infer_claim_type(event),
                    rejection_reason=event.get('reason', 'Financial event rejection'),
                    rejection_date=datetime.fromisoformat(event.get('postedDate', datetime.now().isoformat())),
                    amount_requested=abs(float(event.get('amount', 0.0))),
                    quantity_affected=int(event.get('quantity', 0)),
                    seller_id=self.amazon_config.seller_id,
                    marketplace_id=self.amazon_config.marketplace_id,
                    raw_amazon_data=event
                )
                rejections.append(rejection)
        
        return rejections
    
    def _parse_reimbursements_rejections(self, data: Dict[str, Any]) -> List[RejectionLog]:
        """Parse rejections from reimbursements data"""
        rejections = []
        
        if "reimbursements" not in data:
            return rejections
        
        for reimbursement in data["reimbursements"]:
            if self._is_rejection_reimbursement(reimbursement):
                rejection = RejectionLog(
                    rejection_id=f"reimbursement_{reimbursement.get('id', 'unknown')}",
                    sku=reimbursement.get('sellerSku', ''),
                    asin=reimbursement.get('asin', ''),
                    claim_type=self._infer_claim_type(reimbursement),
                    rejection_reason=reimbursement.get('reason', 'Reimbursement rejection'),
                    rejection_date=datetime.fromisoformat(reimbursement.get('date', datetime.now().isoformat())),
                    amount_requested=float(reimbursement.get('amount', 0.0)),
                    quantity_affected=int(reimbursement.get('quantity', 0)),
                    seller_id=self.amazon_config.seller_id,
                    marketplace_id=self.amazon_config.marketplace_id,
                    raw_amazon_data=reimbursement
                )
                rejections.append(rejection)
        
        return rejections
    
    def _parse_generic_rejections(self, data: Dict[str, Any]) -> List[RejectionLog]:
        """Parse rejections from generic data format"""
        rejections = []
        
        # Generic parsing logic for unknown endpoint formats
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, list) and len(value) > 0:
                    # Try to parse as list of entries
                    for entry in value:
                        if isinstance(entry, dict) and self._is_rejection_entry(entry):
                            rejection = RejectionLog(
                                rejection_id=f"generic_{key}_{entry.get('id', 'unknown')}",
                                sku=entry.get('sellerSku', entry.get('sku', '')),
                                asin=entry.get('asin', ''),
                                claim_type=self._infer_claim_type(entry),
                                rejection_reason=entry.get('reason', 'Generic rejection'),
                                rejection_date=datetime.fromisoformat(entry.get('date', datetime.now().isoformat())),
                                amount_requested=float(entry.get('amount', 0.0)),
                                quantity_affected=int(entry.get('quantity', 0)),
                                seller_id=self.amazon_config.seller_id,
                                marketplace_id=self.amazon_config.marketplace_id,
                                raw_amazon_data=entry
                            )
                            rejections.append(rejection)
        
        return rejections
    
    def _is_rejection_entry(self, entry: Dict[str, Any]) -> bool:
        """Check if an entry represents a rejection"""
        # Look for rejection indicators
        rejection_indicators = [
            'rejected', 'denied', 'declined', 'failed', 'error',
            'not_eligible', 'ineligible', 'policy_violation'
        ]
        
        reason = str(entry.get('reason', '')).lower()
        status = str(entry.get('status', '')).lower()
        
        return any(indicator in reason or indicator in status for indicator in rejection_indicators)
    
    def _is_rejection_adjustment(self, adjustment: Dict[str, Any]) -> bool:
        """Check if an adjustment represents a rejection"""
        return self._is_rejection_entry(adjustment)
    
    def _is_rejection_event(self, event: Dict[str, Any]) -> bool:
        """Check if a financial event represents a rejection"""
        return self._is_rejection_entry(event)
    
    def _is_rejection_reimbursement(self, reimbursement: Dict[str, Any]) -> bool:
        """Check if a reimbursement represents a rejection"""
        return self._is_rejection_entry(reimbursement)
    
    def _infer_claim_type(self, entry: Dict[str, Any]) -> str:
        """Infer claim type from entry data"""
        reason = str(entry.get('reason', '')).lower()
        
        if any(word in reason for word in ['lost', 'missing', 'disappeared']):
            return 'lost'
        elif any(word in reason for word in ['damaged', 'broken', 'defective']):
            return 'damaged'
        elif any(word in reason for word in ['fee', 'charge', 'billing']):
            return 'fee_error'
        elif any(word in reason for word in ['reimbursement', 'refund', 'payment']):
            return 'missing_reimbursement'
        else:
            return 'unknown'
    
    async def start_real_time_collection(self):
        """Start real-time rejection collection"""
        if not self.config.enable_real_time:
            logger.warning("⚠️ Real-time collection disabled in config")
            return
        
        logger.info("🚀 Starting real-time rejection collection")
        
        while True:
            try:
                await self.collect_rejections()
                await asyncio.sleep(self.config.collection_interval_minutes * 60)
                
            except Exception as e:
                logger.error(f"❌ Error in real-time collection: {e}")
                await asyncio.sleep(self.config.retry_delay_seconds)
    
    def get_collection_stats(self) -> Dict[str, Any]:
        """Get collection statistics"""
        return {
            **self.collection_stats,
            "collection_interval_minutes": self.config.collection_interval_minutes,
            "max_hours_back": self.config.max_hours_back,
            "endpoints_monitored": list(self.rejection_endpoints.keys())
        }
    
    async def test_connection(self) -> bool:
        """Test Amazon API connection"""
        try:
            token = await self._get_access_token()
            logger.info("✅ Amazon API connection successful")
            return True
        except Exception as e:
            logger.error(f"❌ Amazon API connection failed: {e}")
            return False
