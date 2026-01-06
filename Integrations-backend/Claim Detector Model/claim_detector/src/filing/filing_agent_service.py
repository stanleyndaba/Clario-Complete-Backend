"""
Unified Filing Agent Service
Processes evidence packages and files claims via mock SP-API.
Standalone mode - no database dependencies, all in-memory.

Input: evidence_package.json
Output: claim_status.json
"""

import json
import logging
import hashlib
import random
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from pathlib import Path
import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from .mock_sp_api import MockSPAPIAdapter
from .claim_status_manager import ClaimStatusManager

logger = logging.getLogger(__name__)


class FilingAgentService:
    """
    Unified Filing Agent Service
    
    Processes evidence packages from Evidence Agent and files claims
    via mock SP-API, tracking status lifecycle.
    """
    
    def __init__(self, seed: Optional[int] = None, approval_rate: float = 0.85):
        """
        Initialize Filing Agent Service
        
        Args:
            seed: Random seed for deterministic behavior (default: 42)
            approval_rate: Probability of claim approval (default: 0.85 = 85%)
        """
        self.seed = seed or 42
        random.seed(self.seed)
        self.approval_rate = approval_rate
        
        # Initialize components
        self.sp_api = MockSPAPIAdapter(seed=self.seed, approval_rate=approval_rate)
        self.status_manager = ClaimStatusManager(seed=self.seed)
        
        logger.info(f"Filing Agent Service initialized (seed={self.seed}, approval_rate={approval_rate})")
    
    def process_evidence_package(self, evidence_package: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process an evidence package and file the claim
        
        Args:
            evidence_package: Evidence package from Evidence Agent
            
        Returns:
            claim_status.json structure
        """
        claim_id = evidence_package.get('claim_id', 'UNKNOWN')
        logger.info(f"Processing evidence package for claim {claim_id}")
        
        try:
            # Step 1: Extract claim data from evidence package
            claim_data = self._extract_claim_data(evidence_package)
            
            # Step 2: Prepare claim payload for SP-API
            sp_api_payload = self._prepare_claim_payload(claim_data, evidence_package)
            
            # Step 3: File claim via mock SP-API
            filing_result = self.sp_api.file_claim(sp_api_payload)
            
            # Step 4: Create initial claim status
            claim_status = self._create_claim_status(
                claim_data=claim_data,
                filing_result=filing_result,
                evidence_package=evidence_package
            )
            
            # Step 5: Register with status manager for lifecycle tracking
            self.status_manager.register_claim(claim_status)
            
            logger.info(f"✅ Successfully filed claim {claim_id}: {claim_status['status']}")
            return claim_status
            
        except Exception as e:
            logger.error(f"❌ Error processing evidence package for {claim_id}: {e}")
            return self._create_error_status(claim_id, str(e))
    
    def _extract_claim_data(self, evidence_package: Dict[str, Any]) -> Dict[str, Any]:
        """Extract claim data from evidence package"""
        claim_metadata = evidence_package.get('claim_metadata', {})
        
        return {
            'claim_id': evidence_package.get('claim_id'),
            'sku': claim_metadata.get('sku'),
            'asin': claim_metadata.get('asin'),
            'order_id': claim_metadata.get('order_id'),
            'amount': claim_metadata.get('amount', 0),
            'quantity': claim_metadata.get('quantity', 1),
            'claim_type': claim_metadata.get('claim_type', 'lost'),
            'marketplace': claim_metadata.get('marketplace', 'US'),
            'fulfillment_center': claim_metadata.get('fulfillment_center', 'FBA1'),
            'order_date': claim_metadata.get('order_date'),
            'claim_date': claim_metadata.get('claim_date'),
            'evidence_documents': evidence_package.get('evidence_documents', []),
            'best_match': evidence_package.get('best_match'),
            'confidence': evidence_package.get('confidence', 0.0)
        }
    
    def _prepare_claim_payload(self, claim_data: Dict[str, Any], 
                              evidence_package: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare claim payload for SP-API submission"""
        
        # Map claim type to SP-API case type
        claim_type = claim_data.get('claim_type', 'lost')
        case_type_map = {
            'lost': 'FBA_LOST_INVENTORY',
            'damaged': 'FBA_DAMAGED_GOODS',
            'other': 'FBA_GENERAL',
            'overcharge': 'FBA_FEE_ERROR'
        }
        case_type = case_type_map.get(claim_type.lower(), 'FBA_GENERAL')
        
        # Map marketplace to marketplace ID
        marketplace = claim_data.get('marketplace', 'US')
        marketplace_map = {
            'US': 'ATVPDKIKX0DER',
            'CA': 'A2EUQ1WTGCTBG2',
            'UK': 'A1F83G8C2ARO7P',
            'DE': 'A1PA6795UKMFR9',
            'FR': 'A13V1IB3VIYZZH',
            'IT': 'APJ6JRA9NG5V4',
            'ES': 'A1RKKUPIHCS9HS',
            'JP': 'A1VC38T7YXB528'
        }
        marketplace_id = marketplace_map.get(marketplace, 'ATVPDKIKX0DER')
        
        # Generate claim content
        content = self._generate_claim_content(claim_data, evidence_package)
        
        # Prepare attachments from evidence documents
        attachments = self._prepare_attachments(evidence_package.get('evidence_documents', []))
        
        payload = {
            'claim_id': claim_data.get('claim_id'),
            'case_type': case_type,
            'marketplace_id': marketplace_id,
            'marketplace': marketplace,
            'subject': f"FBA Reimbursement Claim - {claim_type.replace('_', ' ').title()}",
            'content': content,
            'attachments': attachments,
            'metadata': {
                'sku': claim_data.get('sku'),
                'asin': claim_data.get('asin'),
                'order_id': claim_data.get('order_id'),
                'amount': claim_data.get('amount'),
                'quantity': claim_data.get('quantity'),
                'fulfillment_center': claim_data.get('fulfillment_center'),
                'evidence_confidence': evidence_package.get('confidence', 0.0),
                'action': evidence_package.get('action', 'auto_submit')
            }
        }
        
        return payload
    
    def _generate_claim_content(self, claim_data: Dict[str, Any], 
                               evidence_package: Dict[str, Any]) -> str:
        """Generate claim content for SP-API submission"""
        claim_id = claim_data.get('claim_id', 'UNKNOWN')
        claim_type = claim_data.get('claim_type', 'lost').replace('_', ' ').title()
        amount = claim_data.get('amount', 0)
        quantity = claim_data.get('quantity', 1)
        sku = claim_data.get('sku', 'N/A')
        asin = claim_data.get('asin', 'N/A')
        order_id = claim_data.get('order_id', 'N/A')
        
        content = f"""Dear Amazon Seller Support,

I am filing a claim for FBA reimbursement regarding the following issue:

Claim ID: {claim_id}
Claim Type: {claim_type}
Amount: ${amount:.2f}
Quantity: {quantity}
SKU: {sku}
ASIN: {asin}
Order ID: {order_id}

I have attached supporting documentation including invoices, shipping labels, and other relevant evidence to support this claim.

Please review this claim and process the appropriate reimbursement.

Thank you for your attention to this matter.

Best regards,
Seller Support Team"""
        
        return content
    
    def _prepare_attachments(self, evidence_documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Prepare document attachments for SP-API"""
        attachments = []
        
        for doc in evidence_documents:
            doc_type = doc.get('document_type', 'document')
            doc_id = doc.get('document_id', 'UNKNOWN')
            
            attachment = {
                'name': f"{doc_type}_{doc_id}.pdf",
                'document_type': doc_type,
                'document_id': doc_id,
                'metadata': doc.get('metadata', {}),
                'parsing_confidence': doc.get('parsing_confidence', 0.0)
            }
            attachments.append(attachment)
        
        return attachments
    
    def _create_claim_status(self, claim_data: Dict[str, Any],
                            filing_result: Dict[str, Any],
                            evidence_package: Dict[str, Any]) -> Dict[str, Any]:
        """Create claim_status.json structure"""
        
        claim_status = {
            "claim_id": claim_data.get('claim_id'),
            "amazon_case_id": filing_result.get('amazon_case_id'),
            "status": "FILED",  # Initial status
            "filed_at": datetime.now().isoformat(),
            "amount": claim_data.get('amount', 0),
            "quantity": claim_data.get('quantity', 1),
            "claim_type": claim_data.get('claim_type', 'lost'),
            "marketplace": claim_data.get('marketplace', 'US'),
            "metadata": {
                "sku": claim_data.get('sku'),
                "asin": claim_data.get('asin'),
                "order_id": claim_data.get('order_id'),
                "fulfillment_center": claim_data.get('fulfillment_center'),
                "evidence_confidence": evidence_package.get('confidence', 0.0),
                "evidence_action": evidence_package.get('action', 'auto_submit'),
                "filing_success": filing_result.get('success', False),
                "filing_timestamp": filing_result.get('timestamp'),
                "processing_time_ms": filing_result.get('processing_time_ms', 0)
            },
            "status_history": [
                {
                    "status": "FILED",
                    "timestamp": datetime.now().isoformat(),
                    "amazon_case_id": filing_result.get('amazon_case_id')
                }
            ],
            "processing_timestamp": datetime.now().isoformat(),
            "agent_version": "1.0.0"
        }
        
        return claim_status
    
    def _create_error_status(self, claim_id: str, error: str) -> Dict[str, Any]:
        """Create error status for failed claims"""
        return {
            "claim_id": claim_id,
            "amazon_case_id": None,
            "status": "FILING_FAILED",
            "filed_at": None,
            "amount": 0,
            "quantity": 0,
            "claim_type": "unknown",
            "marketplace": "US",
            "metadata": {
                "error": error,
                "filing_success": False
            },
            "status_history": [
                {
                    "status": "FILING_FAILED",
                    "timestamp": datetime.now().isoformat(),
                    "error": error
                }
            ],
            "processing_timestamp": datetime.now().isoformat(),
            "agent_version": "1.0.0"
        }
    
    def process_batch_claims(self, evidence_packages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Process multiple evidence packages in batch
        
        Args:
            evidence_packages: List of evidence packages
            
        Returns:
            List of claim_status.json structures
        """
        logger.info(f"Processing batch of {len(evidence_packages)} claims")
        
        claim_statuses = []
        for i, evidence_package in enumerate(evidence_packages):
            logger.debug(f"Processing claim {i+1}/{len(evidence_packages)}")
            claim_status = self.process_evidence_package(evidence_package)
            claim_statuses.append(claim_status)
        
        logger.info(f"✅ Processed {len(claim_statuses)} claims")
        return claim_statuses
    
    def get_claim_status(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Get current status of a claim"""
        return self.status_manager.get_claim_status(claim_id)
    
    def simulate_status_updates(self, days_forward: int = 7) -> List[Dict[str, Any]]:
        """
        Simulate status updates for all registered claims
        
        Args:
            days_forward: Number of days to simulate forward
            
        Returns:
            List of updated claim statuses
        """
        return self.status_manager.simulate_updates(days_forward=days_forward)
    
    def export_claim_statuses(self, claim_statuses: List[Dict[str, Any]], 
                             output_dir: Path) -> Dict[str, Any]:
        """
        Export claim statuses to files
        
        Args:
            claim_statuses: List of claim status dictionaries
            output_dir: Directory to export files
            
        Returns:
            Summary of export
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Export individual claim status files
        for claim_status in claim_statuses:
            claim_id = claim_status.get('claim_id', 'UNKNOWN')
            status_file = output_dir / f"claim_status_{claim_id}.json"
            
            with open(status_file, 'w', encoding='utf-8') as f:
                json.dump(claim_status, f, indent=2, default=str)
        
        # Export batch summary
        batch_file = output_dir / "claim_statuses_batch.json"
        batch_data = {
            "export_timestamp": datetime.now().isoformat(),
            "total_claims": len(claim_statuses),
            "status_distribution": self._get_status_distribution(claim_statuses),
            "claim_statuses": claim_statuses
        }
        
        with open(batch_file, 'w', encoding='utf-8') as f:
            json.dump(batch_data, f, indent=2, default=str)
        
        logger.info(f"✅ Exported {len(claim_statuses)} claim statuses to {output_dir}")
        
        return {
            "total_exported": len(claim_statuses),
            "output_dir": str(output_dir),
            "batch_file": str(batch_file),
            "status_distribution": self._get_status_distribution(claim_statuses)
        }
    
    def _get_status_distribution(self, claim_statuses: List[Dict[str, Any]]) -> Dict[str, int]:
        """Get distribution of claim statuses"""
        distribution = {}
        for status in claim_statuses:
            status_value = status.get('status', 'UNKNOWN')
            distribution[status_value] = distribution.get(status_value, 0) + 1
        return distribution
    
    def get_processing_summary(self) -> Dict[str, Any]:
        """Get processing summary statistics"""
        all_statuses = self.status_manager.get_all_statuses()
        
        total = len(all_statuses)
        filed = sum(1 for s in all_statuses if s.get('status') == 'FILED')
        in_review = sum(1 for s in all_statuses if s.get('status') == 'IN_REVIEW')
        approved = sum(1 for s in all_statuses if s.get('status') == 'APPROVED')
        denied = sum(1 for s in all_statuses if s.get('status') == 'DENIED')
        failed = sum(1 for s in all_statuses if s.get('status') == 'FILING_FAILED')
        
        total_amount = sum(s.get('amount', 0) for s in all_statuses)
        approved_amount = sum(s.get('amount', 0) for s in all_statuses if s.get('status') == 'APPROVED')
        
        return {
            "total_processed": total,
            "filed": filed,
            "in_review": in_review,
            "approved": approved,
            "denied": denied,
            "failed": failed,
            "total_amount": total_amount,
            "approved_amount": approved_amount,
            "approval_rate": (approved / total * 100) if total > 0 else 0.0,
            "status_distribution": {
                "FILED": filed,
                "IN_REVIEW": in_review,
                "APPROVED": approved,
                "DENIED": denied,
                "FILING_FAILED": failed
            }
        }






