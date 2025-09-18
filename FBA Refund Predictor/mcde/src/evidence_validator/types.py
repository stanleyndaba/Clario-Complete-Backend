"""
Data types for MCDE Evidence Validator (EV)
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Union
from enum import Enum
from datetime import datetime
import json


class ValidationStatus(Enum):
    """Validation status for claims"""
    PENDING = "pending"
    VALIDATING = "validating"
    VALID = "valid"
    INVALID = "invalid"
    INCOMPLETE = "incomplete"
    COMPLIANCE_FAILED = "compliance_failed"
    ML_VALIDATION_FAILED = "ml_validation_failed"
    ERROR = "error"


class EvidenceCompleteness(Enum):
    """Evidence completeness levels"""
    COMPLETE = "complete"           # All required evidence present
    PARTIAL = "partial"             # Some required evidence missing
    INCOMPLETE = "incomplete"       # Most required evidence missing
    INSUFFICIENT = "insufficient"   # Critical evidence missing


class ComplianceStatus(Enum):
    """Compliance validation status"""
    COMPLIANT = "compliant"
    NON_COMPLIANT = "non_compliant"
    PENDING_VERIFICATION = "pending_verification"
    EXEMPT = "exempt"


@dataclass
class ValidationResult:
    """Result of evidence validation"""
    claim_id: str
    validation_status: ValidationStatus
    evidence_completeness: EvidenceCompleteness
    compliance_status: ComplianceStatus
    overall_score: float  # 0.0 - 1.0
    
    # Validation details
    format_compliance_score: float = 0.0
    time_compliance_score: float = 0.0
    completeness_score: float = 0.0
    ml_validity_score: float = 0.0
    
    # Issues and recommendations
    issues: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    
    # Evidence tracking
    required_evidence: List[str] = field(default_factory=list)
    present_evidence: List[str] = field(default_factory=list)
    missing_evidence: List[str] = field(default_factory=list)
    
    # Metadata
    validation_timestamp: datetime = field(default_factory=datetime.utcnow)
    validator_version: str = "1.0.0"
    processing_time_ms: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format"""
        return {
            "claim_id": self.claim_id,
            "validation_status": self.validation_status.value,
            "evidence_completeness": self.evidence_completeness.value,
            "compliance_status": self.compliance_status.value,
            "overall_score": self.overall_score,
            "format_compliance_score": self.format_compliance_score,
            "time_compliance_score": self.time_compliance_score,
            "completeness_score": self.completeness_score,
            "ml_validity_score": self.ml_validity_score,
            "issues": self.issues,
            "warnings": self.warnings,
            "recommendations": self.recommendations,
            "required_evidence": self.required_evidence,
            "present_evidence": self.present_evidence,
            "missing_evidence": self.missing_evidence,
            "validation_timestamp": self.validation_timestamp.isoformat(),
            "validator_version": self.validator_version,
            "processing_time_ms": self.processing_time_ms
        }
    
    def to_json(self) -> str:
        """Convert to JSON string"""
        return json.dumps(self.to_dict(), indent=2, default=str)
    
    def is_ready_for_auto_filing(self) -> bool:
        """Check if claim is ready for automatic filing"""
        return (
            self.validation_status == ValidationStatus.VALID and
            self.evidence_completeness == EvidenceCompleteness.COMPLETE and
            self.compliance_status == ComplianceStatus.COMPLIANT and
            self.overall_score >= 0.8
        )


@dataclass
class StructuredClaim:
    """Structured claim object from Claim Detector"""
    claim_type: str
    metadata: Dict[str, Any]
    confidence_score: float
    evidence_sources: List[str]
    claim_id: str
    timestamp: str
    raw_text: Optional[str] = None
    classification_confidence: Optional[float] = None
    risk_factors: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format"""
        return {
            "claim_type": self.claim_type,
            "metadata": self.metadata,
            "confidence_score": self.confidence_score,
            "evidence_sources": self.evidence_sources,
            "claim_id": self.claim_id,
            "timestamp": self.timestamp,
            "raw_text": self.raw_text,
            "classification_confidence": self.classification_confidence,
            "risk_factors": self.risk_factors,
            "recommendations": self.recommendations
        }


@dataclass
class EvidenceItem:
    """Individual evidence item"""
    evidence_id: str
    evidence_type: str
    source_url: str
    metadata: Dict[str, Any]
    validation_score: float
    is_required: bool
    is_valid: bool
    issues: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format"""
        return {
            "evidence_id": self.evidence_id,
            "evidence_type": self.evidence_type,
            "source_url": self.source_url,
            "metadata": self.metadata,
            "validation_score": self.validation_score,
            "is_required": self.is_required,
            "is_valid": self.is_valid,
            "issues": self.issues
        }


@dataclass
class ValidationConfig:
    """Configuration for validation thresholds"""
    min_overall_score: float = 0.8
    min_format_compliance: float = 0.8
    min_time_compliance: float = 0.9
    min_completeness: float = 0.7
    min_ml_validity: float = 0.75
    
    # Time constraints (days)
    max_claim_age_days: int = 365
    max_evidence_age_days: int = 90
    
    # File size limits (MB)
    max_file_size_mb: int = 50
    
    # Required evidence counts by claim type
    required_evidence_counts: Dict[str, int] = field(default_factory=lambda: {
        "lost": 3,
        "damaged": 2,
        "fee_error": 2,
        "return": 2,
        "inventory_adjustment": 2,
        "warehouse_damage": 2,
        "shipping_error": 2,
        "quality_issue": 2,
        "packaging_damage": 2,
        "expired_product": 1,
        "recalled_product": 1,
        "counterfeit_item": 2,
        "other": 2
    })
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format"""
        return {
            "min_overall_score": self.min_overall_score,
            "min_format_compliance": self.min_format_compliance,
            "min_time_compliance": self.min_time_compliance,
            "min_completeness": self.min_completeness,
            "min_ml_validity": self.min_ml_validity,
            "max_claim_age_days": self.max_claim_age_days,
            "max_evidence_age_days": self.max_evidence_age_days,
            "max_file_size_mb": self.max_file_size_mb,
            "required_evidence_counts": self.required_evidence_counts
        }
