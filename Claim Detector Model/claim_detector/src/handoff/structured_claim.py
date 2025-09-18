# -*- coding: utf-8 -*-
"""
Structured Claim Object Definition for Claim Detector → MCDE Handoff

This module defines the standardized format for claims that will be consumed
by the MCDE Evidence Validator, ensuring seamless handoff between systems.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Union
from enum import Enum
import json
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ClaimType(Enum):
    """Standardized claim types with controlled vocabulary"""
    LOST = "lost"
    DAMAGED = "damaged"
    FEE_ERROR = "fee_error"
    RETURN = "return"
    INVENTORY_ADJUSTMENT = "inventory_adjustment"
    WAREHOUSE_DAMAGE = "warehouse_damage"
    SHIPPING_ERROR = "shipping_error"
    QUALITY_ISSUE = "quality_issue"
    PACKAGING_DAMAGE = "packaging_damage"
    EXPIRED_PRODUCT = "expired_product"
    RECALLED_PRODUCT = "recalled_product"
    COUNTERFEIT_ITEM = "counterfeit_item"
    OTHER = "other"

class EvidenceSource(Enum):
    """Standardized evidence sources"""
    SHIPMENT_RECONCILIATION_REPORTS = "shipment_reconciliation_reports"
    INBOUND_SHIPMENT_LOGS = "inbound_shipment_logs"
    FC_PROCESSING_LOGS = "fc_processing_logs"
    AMAZON_FEE_REPORTS = "amazon_fee_reports"
    RETURN_REPORTS = "return_reports"
    INVOICES = "invoices"
    CARRIER_CONFIRMATION = "carrier_confirmation"
    PHOTO_EVIDENCE = "photo_evidence"
    QUALITY_INSPECTION_REPORTS = "quality_inspection_reports"
    INVENTORY_COUNT_REPORTS = "inventory_count_reports"
    WAREHOUSE_DAMAGE_REPORTS = "warehouse_damage_reports"
    SHIPPING_MANIFESTS = "shipping_manifests"
    CUSTOMER_FEEDBACK = "customer_feedback"
    SUPPLIER_DOCUMENTATION = "supplier_documentation"

# Evidence source mapping for each claim type
EVIDENCE_SOURCES_MAPPING = {
    ClaimType.LOST: [
        EvidenceSource.SHIPMENT_RECONCILIATION_REPORTS,
        EvidenceSource.CARRIER_CONFIRMATION,
        EvidenceSource.SHIPPING_MANIFESTS
    ],
    ClaimType.DAMAGED: [
        EvidenceSource.INBOUND_SHIPMENT_LOGS,
        EvidenceSource.FC_PROCESSING_LOGS,
        EvidenceSource.PHOTO_EVIDENCE,
        EvidenceSource.CARRIER_CONFIRMATION
    ],
    ClaimType.FEE_ERROR: [
        EvidenceSource.AMAZON_FEE_REPORTS,
        EvidenceSource.INVOICES
    ],
    ClaimType.RETURN: [
        EvidenceSource.RETURN_REPORTS,
        EvidenceSource.INVOICES,
        EvidenceSource.CUSTOMER_FEEDBACK
    ],
    ClaimType.INVENTORY_ADJUSTMENT: [
        EvidenceSource.INVENTORY_COUNT_REPORTS,
        EvidenceSource.SHIPMENT_RECONCILIATION_REPORTS
    ],
    ClaimType.WAREHOUSE_DAMAGE: [
        EvidenceSource.WAREHOUSE_DAMAGE_REPORTS,
        EvidenceSource.FC_PROCESSING_LOGS,
        EvidenceSource.PHOTO_EVIDENCE
    ],
    ClaimType.SHIPPING_ERROR: [
        EvidenceSource.SHIPPING_MANIFESTS,
        EvidenceSource.CARRIER_CONFIRMATION,
        EvidenceSource.SHIPMENT_RECONCILIATION_REPORTS
    ],
    ClaimType.QUALITY_ISSUE: [
        EvidenceSource.QUALITY_INSPECTION_REPORTS,
        EvidenceSource.SUPPLIER_DOCUMENTATION,
        EvidenceSource.CUSTOMER_FEEDBACK
    ],
    ClaimType.PACKAGING_DAMAGE: [
        EvidenceSource.INBOUND_SHIPMENT_LOGS,
        EvidenceSource.PHOTO_EVIDENCE,
        EvidenceSource.CARRIER_CONFIRMATION
    ],
    ClaimType.EXPIRED_PRODUCT: [
        EvidenceSource.INVENTORY_COUNT_REPORTS,
        EvidenceSource.SUPPLIER_DOCUMENTATION
    ],
    ClaimType.RECALLED_PRODUCT: [
        EvidenceSource.SUPPLIER_DOCUMENTATION,
        EvidenceSource.INVENTORY_COUNT_REPORTS
    ],
    ClaimType.COUNTERFEIT_ITEM: [
        EvidenceSource.QUALITY_INSPECTION_REPORTS,
        EvidenceSource.SUPPLIER_DOCUMENTATION,
        EvidenceSource.CUSTOMER_FEEDBACK
    ],
    ClaimType.OTHER: [
        EvidenceSource.INVOICES,
        EvidenceSource.SHIPMENT_RECONCILIATION_REPORTS
    ]
}

@dataclass
class ClaimMetadata:
    """Structured metadata for claims"""
    order_id: Optional[str] = None
    sku: Optional[str] = None
    fnsku: Optional[str] = None
    shipment_id: Optional[str] = None
    asin: Optional[str] = None
    merchant_id: Optional[str] = None
    marketplace_id: Optional[str] = None
    claim_amount: Optional[float] = None
    currency: str = "USD"
    filing_date: Optional[str] = None
    incident_date: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary, handling None values"""
        result = {}
        for field_name, value in self.__dict__.items():
            if value is not None:
                result[field_name] = value
        return result

@dataclass
class StructuredClaim:
    """Standardized claim object for MCDE handoff"""
    claim_type: ClaimType
    metadata: ClaimMetadata
    confidence_score: float
    evidence_sources: List[str] = field(default_factory=list)
    claim_id: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    raw_text: Optional[str] = None
    classification_confidence: Optional[float] = None
    risk_factors: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    
    def __post_init__(self):
        """Auto-populate evidence sources based on claim type"""
        if not self.evidence_sources:
            self.evidence_sources = self._get_evidence_sources()
    
    def _get_evidence_sources(self) -> List[str]:
        """Get evidence sources for this claim type"""
        sources = EVIDENCE_SOURCES_MAPPING.get(self.claim_type, [])
        return [source.value for source in sources]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format for MCDE consumption"""
        return {
            "claim_type": self.claim_type.value,
            "metadata": self.metadata.to_dict(),
            "confidence_score": self.confidence_score,
            "evidence_sources": self.evidence_sources,
            "claim_id": self.claim_id,
            "timestamp": self.timestamp,
            "raw_text": self.raw_text,
            "classification_confidence": self.classification_confidence,
            "risk_factors": self.risk_factors,
            "recommendations": self.recommendations
        }
    
    def to_json(self) -> str:
        """Convert to JSON string"""
        return json.dumps(self.to_dict(), indent=2, default=str)
    
    def validate(self) -> bool:
        """Validate the structured claim object"""
        if not isinstance(self.confidence_score, (int, float)):
            logger.error("Confidence score must be numeric")
            return False
        
        if not (0.0 <= self.confidence_score <= 1.0):
            logger.error("Confidence score must be between 0.0 and 1.0")
            return False
        
        if not self.evidence_sources:
            logger.error("Evidence sources cannot be empty")
            return False
        
        if not self.claim_type:
            logger.error("Claim type is required")
            return False
        
        return True

class ClaimHandoffFormatter:
    """Formats claims from Claim Detector into structured objects for MCDE"""
    
    def __init__(self):
        self.claim_type_mapping = self._create_claim_type_mapping()
    
    def _create_claim_type_mapping(self) -> Dict[str, ClaimType]:
        """Create mapping from raw text to standardized claim types"""
        return {
            "lost": ClaimType.LOST,
            "damage": ClaimType.DAMAGED,
            "damaged": ClaimType.DAMAGED,
            "fee": ClaimType.FEE_ERROR,
            "fee_error": ClaimType.FEE_ERROR,
            "return": ClaimType.RETURN,
            "inventory": ClaimType.INVENTORY_ADJUSTMENT,
            "warehouse": ClaimType.WAREHOUSE_DAMAGE,
            "shipping": ClaimType.SHIPPING_ERROR,
            "quality": ClaimType.QUALITY_ISSUE,
            "packaging": ClaimType.PACKAGING_DAMAGE,
            "expired": ClaimType.EXPIRED_PRODUCT,
            "recall": ClaimType.RECALLED_PRODUCT,
            "counterfeit": ClaimType.COUNTERFEIT_ITEM
        }
    
    def format_claim(self, 
                    raw_claim_data: Dict[str, Any],
                    classification_result: Dict[str, Any]) -> StructuredClaim:
        """
        Format raw claim data into structured claim object
        
        Args:
            raw_claim_data: Raw claim data from Claim Detector
            classification_result: Classification result with confidence scores
            
        Returns:
            StructuredClaim object ready for MCDE
        """
        try:
            # Extract claim type
            claim_type = self._determine_claim_type(raw_claim_data, classification_result)
            
            # Create metadata
            metadata = self._extract_metadata(raw_claim_data)
            
            # Get confidence score
            confidence_score = self._extract_confidence_score(classification_result)
            
            # Create structured claim
            structured_claim = StructuredClaim(
                claim_type=claim_type,
                metadata=metadata,
                confidence_score=confidence_score,
                claim_id=raw_claim_data.get('claim_id'),
                raw_text=raw_claim_data.get('claim_description'),
                classification_confidence=classification_result.get('confidence'),
                risk_factors=classification_result.get('risk_factors', []),
                recommendations=classification_result.get('recommendations', [])
            )
            
            # Validate the claim
            if not structured_claim.validate():
                logger.error(f"Invalid structured claim: {structured_claim.claim_id}")
                raise ValueError("Invalid structured claim")
            
            logger.info(f"Successfully formatted claim {structured_claim.claim_id} for MCDE handoff")
            return structured_claim
            
        except Exception as e:
            logger.error(f"Error formatting claim: {e}")
            raise
    
    def _determine_claim_type(self, 
                             raw_data: Dict[str, Any], 
                             classification: Dict[str, Any]) -> ClaimType:
        """Determine standardized claim type from raw data and classification"""
        # Try to get from classification first
        if 'claim_type' in classification:
            raw_type = classification['claim_type'].lower()
            if raw_type in self.claim_type_mapping:
                return self.claim_type_mapping[raw_type]
        
        # Try to infer from raw text
        if 'claim_description' in raw_data:
            text = raw_data['claim_description'].lower()
            for key, claim_type in self.claim_type_mapping.items():
                if key in text:
                    return claim_type
        
        # Try to infer from rejection reason
        if 'rejection_reason' in raw_data:
            text = raw_data['rejection_reason'].lower()
            for key, claim_type in self.claim_type_mapping.items():
                if key in text:
                    return claim_type
        
        # Default to other if we can't determine
        logger.warning("Could not determine claim type, defaulting to OTHER")
        return ClaimType.OTHER
    
    def _extract_metadata(self, raw_data: Dict[str, Any]) -> ClaimMetadata:
        """Extract metadata from raw claim data"""
        return ClaimMetadata(
            order_id=raw_data.get('order_id'),
            sku=raw_data.get('sku'),
            fnsku=raw_data.get('fnsku'),
            shipment_id=raw_data.get('shipment_id'),
            asin=raw_data.get('asin'),
            merchant_id=raw_data.get('merchant_id'),
            marketplace_id=raw_data.get('marketplace_id'),
            claim_amount=raw_data.get('claim_amount'),
            filing_date=raw_data.get('filing_date'),
            incident_date=raw_data.get('incident_date')
        )
    
    def _extract_confidence_score(self, classification: Dict[str, Any]) -> float:
        """Extract confidence score from classification result"""
        # Try different possible confidence fields
        confidence_fields = ['confidence', 'confidence_score', 'probability', 'score']
        
        for field in confidence_fields:
            if field in classification:
                score = classification[field]
                if isinstance(score, (int, float)) and 0.0 <= score <= 1.0:
                    return float(score)
        
        # Default confidence if none found
        logger.warning("No valid confidence score found, defaulting to 0.5")
        return 0.5
    
    def batch_format_claims(self, 
                           raw_claims: List[Dict[str, Any]], 
                           classifications: List[Dict[str, Any]]) -> List[StructuredClaim]:
        """Format multiple claims at once"""
        if len(raw_claims) != len(classifications):
            raise ValueError("Raw claims and classifications must have same length")
        
        formatted_claims = []
        for raw_claim, classification in zip(raw_claims, classifications):
            try:
                formatted_claim = self.format_claim(raw_claim, classification)
                formatted_claims.append(formatted_claim)
            except Exception as e:
                logger.error(f"Error formatting claim {raw_claim.get('claim_id', 'unknown')}: {e}")
                continue
        
        logger.info(f"Successfully formatted {len(formatted_claims)} out of {len(raw_claims)} claims")
        return formatted_claims

def create_mock_structured_claim() -> StructuredClaim:
    """Create a mock structured claim for testing"""
    metadata = ClaimMetadata(
        order_id="123-4567890-1234567",
        sku="B07ABC1234",
        fnsku="X001ABC123",
        shipment_id="FBA1234567",
        claim_amount=150.00,
        filing_date="2024-01-15"
    )
    
    return StructuredClaim(
        claim_type=ClaimType.LOST,
        metadata=metadata,
        confidence_score=0.94,
        claim_id="CLM_001234",
        raw_text="Inventory lost during shipment, need reimbursement for $150",
        classification_confidence=0.94,
        risk_factors=["Missing carrier confirmation", "Delayed filing"],
        recommendations=["Submit carrier documentation", "File within 30 days"]
    )

if __name__ == "__main__":
    # Test the structured claim system
    print("Testing Structured Claim System...")
    
    # Create mock claim
    mock_claim = create_mock_structured_claim()
    print(f"Created mock claim: {mock_claim.claim_id}")
    
    # Test validation
    is_valid = mock_claim.validate()
    print(f"Claim validation: {'PASS' if is_valid else 'FAIL'}")
    
    # Test JSON conversion
    json_output = mock_claim.to_json()
    print(f"JSON output length: {len(json_output)} characters")
    
    # Test handoff formatter
    formatter = ClaimHandoffFormatter()
    
    # Mock raw data and classification
    raw_data = {
        "claim_id": "CLM_001235",
        "claim_description": "Package damaged in transit",
        "order_id": "123-4567890-1234568",
        "sku": "B07ABC1235"
    }
    
    classification = {
        "claim_type": "damaged",
        "confidence": 0.87
    }
    
    formatted_claim = formatter.format_claim(raw_data, classification)
    print(f"Formatted claim type: {formatted_claim.claim_type.value}")
    print(f"Evidence sources: {formatted_claim.evidence_sources}")
    
    print("\n✅ Structured Claim System Test Complete!")




