"""
MCDE Evidence Validator (EV) - Critical Bridge Between Detection and Automation

This module validates claims flagged by the Claim Detector to ensure they have
sufficient evidence before proceeding to auto-filing. Without EV, the system
risks pushing invalid/incomplete claims leading to high rejection rates.

Key Components:
- StructuredClaimValidator: Validates claim objects from Claim Detector
- EvidenceCompletenessChecker: Ensures all required evidence is present
- ComplianceValidator: Hard compliance checks (date windows, matching docs)
- MLValidityClassifier: Lightweight ML classifier for doc completeness/validity
- IntegrationBridge: Connects with Claim Detector and downstream systems
"""

from .validator import EvidenceValidator
from .compliance_checker import ComplianceValidator
from .ml_validity_classifier import MLValidityClassifier
from .integration_bridge import IntegrationBridge
from .types import ValidationResult, ValidationStatus, EvidenceCompleteness

__all__ = [
    'EvidenceValidator',
    'ComplianceValidator', 
    'MLValidityClassifier',
    'IntegrationBridge',
    'ValidationResult',
    'ValidationStatus',
    'EvidenceCompleteness'
]
