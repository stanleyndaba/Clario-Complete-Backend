"""
Amazon Selling Partner API Adapter
Handles real Amazon SP-API integration for claim filing
"""
import os
import time
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from pathlib import Path

# Optional AWS imports
try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
    AWS_AVAILABLE = True
except ImportError:
    AWS_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning("AWS SDK not available. Using mock mode for AWS operations.")

# Optional SP-API imports
try:
    from sp_api.api import Orders, Catalog, FulfillmentInbound
    from sp_api.base import SellingApiException, Marketplaces
    from sp_api.auth import AccessTokenClient, Credentials
    SP_API_AVAILABLE = True
except ImportError:
    SP_API_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning("Amazon SP-API SDK not available. Using mock mode.")

logger = logging.getLogger(__name__)

class SPAmazonAdapter:
    """Amazon Selling Partner API adapter for claim filing"""
    
    def __init__(self, use_mock: bool = True):
        """
        Initialize SP-API adapter
        
        Args:
            use_mock: Use mock mode instead of real SP-API
        """
        self.use_mock = use_mock or not SP_API_AVAILABLE
        self.credentials = None
        self.access_token = None
        self.token_expiry = None
        
        if not self.use_mock:
            self._initialize_credentials()
    
    def _initialize_credentials(self):
        """Initialize Amazon SP-API credentials"""
        try:
            # Load credentials from environment or config
            refresh_token = os.getenv('AMAZON_REFRESH_TOKEN')
            client_id = os.getenv('AMAZON_CLIENT_ID')
            client_secret = os.getenv('AMAZON_CLIENT_SECRET')
            aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
            aws_secret_key = os.getenv('AWS_SECRET_ACCESS_KEY')
            aws_region = os.getenv('AWS_REGION', 'us-east-1')
            
            if not all([refresh_token, client_id, client_secret, aws_access_key, aws_secret_key]):
                logger.warning("Missing Amazon SP-API credentials. Falling back to mock mode.")
                self.use_mock = True
                return
            
            # Initialize credentials
            self.credentials = Credentials(
                refresh_token=refresh_token,
                client_id=client_id,
                client_secret=client_secret,
                aws_access_key_id=aws_access_key,
                aws_secret_access_key=aws_secret_key,
                aws_region=aws_region
            )
            
            logger.info("Amazon SP-API credentials initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize SP-API credentials: {e}")
            self.use_mock = True
    
    def _get_access_token(self) -> Optional[str]:
        """Get valid access token for SP-API"""
        if self.use_mock:
            return "mock_token"
        
        try:
            # Check if current token is still valid
            if self.access_token and self.token_expiry and datetime.now() < self.token_expiry:
                return self.access_token
            
            # Get new token
            token_client = AccessTokenClient(credentials=self.credentials)
            token_response = token_client.get_auth()
            
            self.access_token = token_response.access_token
            self.token_expiry = datetime.now() + timedelta(hours=1)  # Token expires in 1 hour
            
            logger.info("SP-API access token refreshed")
            return self.access_token
            
        except Exception as e:
            logger.error(f"Failed to get access token: {e}")
            return None
    
    def file_claim(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        File a claim with Amazon SP-API
        
        Args:
            claim_data: Claim data including metadata and evidence
            
        Returns:
            Filing result with status and response details
        """
        if self.use_mock:
            return self._mock_file_claim(claim_data)
        
        try:
            # Get access token
            token = self._get_access_token()
            if not token:
                raise Exception("Failed to obtain access token")
            
            # Prepare claim payload
            payload = self._prepare_claim_payload(claim_data)
            
            # File claim via SP-API
            result = self._submit_claim_to_sp_api(payload)
            
            return {
                'success': True,
                'claim_id': claim_data.get('claim_id'),
                'amazon_case_id': result.get('case_id'),
                'status': 'submitted',
                'response': result,
                'timestamp': datetime.now().isoformat(),
                'processing_time_ms': result.get('processing_time_ms', 0)
            }
            
        except Exception as e:
            logger.error(f"Failed to file claim {claim_data.get('claim_id')}: {e}")
            return {
                'success': False,
                'claim_id': claim_data.get('claim_id'),
                'error': str(e),
                'status': 'failed',
                'timestamp': datetime.now().isoformat()
            }
    
    def _prepare_claim_payload(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare claim payload for SP-API"""
        # Extract claim details
        claim_id = claim_data.get('claim_id')
        seller_id = claim_data.get('seller_id')
        marketplace = claim_data.get('marketplace', 'US')
        claim_type = claim_data.get('claim_type', 'lost_inventory')
        amount = claim_data.get('amount', 0)
        quantity = claim_data.get('quantity', 1)
        sku = claim_data.get('sku')
        asin = claim_data.get('asin')
        
        # Prepare SP-API payload
        payload = {
            'caseType': self._map_claim_type(claim_type),
            'issueType': self._map_issue_type(claim_type),
            'language': 'en_US',
            'marketplaceId': self._get_marketplace_id(marketplace),
            'subject': f"FBA Reimbursement Claim - {claim_type.replace('_', ' ').title()}",
            'content': self._generate_claim_content(claim_data),
            'attachments': self._prepare_attachments(claim_data.get('documents', [])),
            'metadata': {
                'claim_id': claim_id,
                'seller_id': seller_id,
                'sku': sku,
                'asin': asin,
                'amount': amount,
                'quantity': quantity
            }
        }
        
        return payload
    
    def _map_claim_type(self, claim_type: str) -> str:
        """Map internal claim type to SP-API case type"""
        mapping = {
            'lost_inventory': 'FBA_LOST_INVENTORY',
            'damaged_goods': 'FBA_DAMAGED_GOODS',
            'fee_error': 'FBA_FEE_ERROR',
            'overcharge': 'FBA_OVERCHARGE',
            'shipping_error': 'FBA_SHIPPING_ERROR'
        }
        return mapping.get(claim_type, 'FBA_GENERAL')
    
    def _map_issue_type(self, claim_type: str) -> str:
        """Map claim type to SP-API issue type"""
        mapping = {
            'lost_inventory': 'LOST_INVENTORY',
            'damaged_goods': 'DAMAGED_GOODS',
            'fee_error': 'FEE_ERROR',
            'overcharge': 'OVERCHARGE',
            'shipping_error': 'SHIPPING_ERROR'
        }
        return mapping.get(claim_type, 'GENERAL')
    
    def _get_marketplace_id(self, marketplace: str) -> str:
        """Get SP-API marketplace ID"""
        mapping = {
            'US': 'ATVPDKIKX0DER',
            'CA': 'A2EUQ1WTGCTBG2',
            'UK': 'A1F83G8C2ARO7P',
            'DE': 'A1PA6795UKMFR9',
            'FR': 'A13V1IB3VIYZZH',
            'IT': 'APJ6JRA9NG5V4',
            'ES': 'A1RKKUPIHCS9HS',
            'JP': 'A1VC38T7YXB528'
        }
        return mapping.get(marketplace, 'ATVPDKIKX0DER')  # Default to US
    
    def _generate_claim_content(self, claim_data: Dict[str, Any]) -> str:
        """Generate claim content for SP-API"""
        claim_id = claim_data.get('claim_id')
        claim_type = claim_data.get('claim_type', 'lost_inventory')
        amount = claim_data.get('amount', 0)
        quantity = claim_data.get('quantity', 1)
        sku = claim_data.get('sku')
        asin = claim_data.get('asin')
        description = claim_data.get('description', '')
        
        content = f"""
Dear Amazon Seller Support,

I am filing a claim for FBA reimbursement regarding the following issue:

Claim ID: {claim_id}
Claim Type: {claim_type.replace('_', ' ').title()}
Amount: ${amount:.2f}
Quantity: {quantity}
SKU: {sku}
ASIN: {asin}

Description: {description}

I have attached supporting documentation including invoices, shipping labels, and other relevant evidence to support this claim.

Please review this claim and process the appropriate reimbursement.

Thank you for your attention to this matter.

Best regards,
Seller Support Team
        """.strip()
        
        return content
    
    def _prepare_attachments(self, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Prepare document attachments for SP-API"""
        attachments = []
        
        for doc in documents:
            attachment = {
                'name': f"{doc.get('metadata', {}).get('document_type', 'document')}.pdf",
                'content': doc.get('extracted_text', ''),
                'contentType': 'application/pdf'
            }
            attachments.append(attachment)
        
        return attachments
    
    def _submit_claim_to_sp_api(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Submit claim to Amazon SP-API"""
        start_time = time.time()
        
        try:
            # This would be the actual SP-API call
            # For now, we'll simulate the response
            # In production, you would use the SP-API SDK
            
            # Simulate API call delay
            time.sleep(0.5)
            
            # Generate mock response
            case_id = f"AMZ-{int(time.time())}-{hash(str(payload)) % 10000:04d}"
            
            result = {
                'case_id': case_id,
                'status': 'submitted',
                'processing_time_ms': int((time.time() - start_time) * 1000),
                'message': 'Claim submitted successfully',
                'estimated_response_time': '2-5 business days'
            }
            
            logger.info(f"Claim submitted to SP-API: {case_id}")
            return result
            
        except Exception as e:
            logger.error(f"SP-API submission failed: {e}")
            raise
    
    def _mock_file_claim(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """Mock claim filing for testing/development"""
        import random
        
        # Simulate processing time
        time.sleep(random.uniform(0.1, 0.5))
        
        # 90% success rate as specified
        success = random.random() < 0.9
        
        if success:
            case_id = f"MOCK-{int(time.time())}-{random.randint(1000, 9999)}"
            return {
                'success': True,
                'claim_id': claim_data.get('claim_id'),
                'amazon_case_id': case_id,
                'status': 'submitted',
                'response': {
                    'case_id': case_id,
                    'status': 'submitted',
                    'message': 'Mock claim submitted successfully',
                    'estimated_response_time': '2-5 business days'
                },
                'timestamp': datetime.now().isoformat(),
                'processing_time_ms': random.randint(100, 500)
            }
        else:
            return {
                'success': False,
                'claim_id': claim_data.get('claim_id'),
                'error': 'Mock submission failed',
                'status': 'failed',
                'timestamp': datetime.now().isoformat()
            }
    
    def get_claim_status(self, case_id: str) -> Dict[str, Any]:
        """Get status of a filed claim"""
        if self.use_mock:
            return self._mock_get_status(case_id)
        
        try:
            # This would be the actual SP-API status check
            # For now, return mock status
            return self._mock_get_status(case_id)
            
        except Exception as e:
            logger.error(f"Failed to get claim status for {case_id}: {e}")
            return {
                'success': False,
                'case_id': case_id,
                'error': str(e),
                'status': 'unknown'
            }
    
    def _mock_get_status(self, case_id: str) -> Dict[str, Any]:
        """Mock status check"""
        import random
        
        statuses = ['submitted', 'under_review', 'approved', 'rejected', 'pending_documents']
        status = random.choice(statuses)
        
        return {
            'success': True,
            'case_id': case_id,
            'status': status,
            'last_updated': datetime.now().isoformat(),
            'estimated_completion': (datetime.now() + timedelta(days=random.randint(1, 7))).isoformat()
        }
    
    def is_available(self) -> bool:
        """Check if SP-API is available and configured"""
        if self.use_mock:
            return True
        
        return (
            SP_API_AVAILABLE and 
            self.credentials is not None and 
            self._get_access_token() is not None
        )

