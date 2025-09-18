"""
Service Connector - Wires existing services to API endpoints
Connects the existing microservices to the unified API layer
"""

import os
import sys
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import asyncio
import aiohttp
import json

logger = logging.getLogger(__name__)

class ServiceConnector:
    """Connects existing services to API endpoints"""
    
    def __init__(self):
        self.services = {
            'smart_sync': {
                'base_url': os.getenv('SMART_SYNC_URL', 'http://localhost:3001'),
                'enabled': True
            },
            'dispute_automation': {
                'base_url': os.getenv('DISPUTE_AUTOMATION_URL', 'http://localhost:3002'),
                'enabled': True
            },
            'cost_documentation': {
                'base_url': os.getenv('COST_DOC_URL', 'http://localhost:3003'),
                'enabled': True
            },
            'stripe_payments': {
                'base_url': os.getenv('STRIPE_PAYMENTS_URL', 'http://localhost:4000'),
                'enabled': True
            }
        }
    
    async def call_service(self, service_name: str, endpoint: str, method: str = 'GET', data: Dict = None, headers: Dict[str, str] = None) -> Dict[str, Any]:
        """Call a microservice endpoint"""
        if service_name not in self.services:
            raise ValueError(f"Unknown service: {service_name}")
        
        service = self.services[service_name]
        if not service['enabled']:
            logger.warning(f"Service {service_name} is disabled")
            return {"error": f"Service {service_name} is disabled"}
        
        url = f"{service['base_url']}{endpoint}"
        
        try:
            async with aiohttp.ClientSession() as session:
                if method.upper() == 'GET':
                    async with session.get(url, headers=headers) as response:
                        return await response.json()
                elif method.upper() == 'POST':
                    async with session.post(url, json=data, headers=headers) as response:
                        return await response.json()
                elif method.upper() == 'PUT':
                    async with session.put(url, json=data, headers=headers) as response:
                        return await response.json()
                else:
                    raise ValueError(f"Unsupported method: {method}")
        except Exception as e:
            logger.error(f"Error calling {service_name}: {e}")
            return {"error": str(e)}
    
    # Smart Inventory Sync Integration
    async def start_sync(self, user_id: str, sync_type: str = "inventory") -> Dict[str, Any]:
        """Start inventory sync"""
        return await self.call_service(
            'smart_sync',
            '/api/v1/sync/start',
            'POST',
            {'userId': user_id, 'type': sync_type}
        )
    
    async def get_sync_status(self, sync_id: str) -> Dict[str, Any]:
        """Get sync status"""
        return await self.call_service(
            'smart_sync',
            f'/api/v1/sync/status/{sync_id}',
            'GET'
        )
    
    async def get_sync_activity(self, user_id: str, limit: int = 10) -> Dict[str, Any]:
        """Get sync activity"""
        return await self.call_service(
            'smart_sync',
            f'/api/v1/sync/activity?userId={user_id}&limit={limit}',
            'GET'
        )
    
    # Dispute Automation Integration
    async def create_dispute_case(self, user_id: str, detection_result_id: str, case_type: str, claim_amount: float) -> Dict[str, Any]:
        """Create dispute case"""
        return await self.call_service(
            'dispute_automation',
            '/api/v1/disputes',
            'POST',
            {
                'sellerId': user_id,
                'detectionResultId': detection_result_id,
                'caseType': case_type,
                'claimAmount': claim_amount
            }
        )
    
    async def submit_dispute_case(self, case_id: str, submission_data: Dict) -> Dict[str, Any]:
        """Submit dispute case"""
        return await self.call_service(
            'dispute_automation',
            f'/api/v1/disputes/{case_id}/submit',
            'POST',
            submission_data
        )
    
    # Cost Documentation Integration
    async def generate_cost_documentation(self, evidence: Dict, template_version: str = "1.0") -> Dict[str, Any]:
        """Generate cost documentation PDF"""
        return await self.call_service(
            'cost_documentation',
            '/api/v1/cost-docs/generate/manual',
            'POST',
            {
                'evidence': evidence,
                'templateVersion': template_version
            }
        )
    
    async def get_cost_documentation_status(self, job_id: str) -> Dict[str, Any]:
        """Get cost documentation job status"""
        return await self.call_service(
            'cost_documentation',
            f'/api/v1/cost-docs/status/{job_id}',
            'GET'
        )
    
    # Stripe Payments Integration
    async def charge_commission(self, user_id: str, claim_id: str, amount_recovered: float) -> Dict[str, Any]:
        """Charge platform commission"""
        return await self.call_service(
            'stripe_payments',
            '/api/v1/stripe/charge-commission',
            'POST',
            {
                'userId': user_id,
                'claimId': claim_id,
                'amountRecoveredCents': int(amount_recovered * 100),
                'currency': 'usd'
            }
        )
    
    async def get_payment_status(self, transaction_id: str) -> Dict[str, Any]:
        """Get payment status"""
        return await self.call_service(
            'stripe_payments',
            f'/api/v1/stripe/transaction/{transaction_id}',
            'GET'
        )

    # OAuth processing via integrations-backend
    async def process_amazon_oauth(self, code: str, state: str) -> Dict[str, Any]:
        base = os.getenv('INTEGRATIONS_URL', 'http://localhost:3001')
        headers = {}
        api_key = os.getenv('INTEGRATIONS_API_KEY', '')
        if api_key:
            headers['x-internal-api-key'] = api_key
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{base}/integrations-api/amazon/oauth/process"
                async with session.post(url, json={'code': code, 'state': state}, headers=headers, timeout=15) as resp:
                    resp.raise_for_status()
                    return await resp.json()
        except Exception as e:
            logger.error(f"process_amazon_oauth failed: {e}")
            return {"error": str(e)}

# Global service connector instance
service_connector = ServiceConnector()

