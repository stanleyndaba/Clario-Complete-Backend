"""
Main Evidence Validator for MCDE Evidence Validator (EV)

Orchestrates all validation components and provides unified interface:
- Compliance validation (hard rules)
- ML validity classification (intelligent assessment)
- Evidence completeness checking
- Integration with Claim Detector
"""

import logging
import time
from typing import Dict, List, Any, Optional
from datetime import datetime

from .types import (
    ValidationResult, ValidationStatus, EvidenceCompleteness, 
    ComplianceStatus, ValidationConfig, StructuredClaim
)
from .compliance_checker import ComplianceValidator
from .ml_validity_classifier import MLValidityClassifier

logger = logging.getLogger(__name__)


class EvidenceValidator:
    """
    Main Evidence Validator that orchestrates all validation components
    
    This is the critical bridge between detection (what's a claim) and 
    automation (auto-filing). Without EV, the system risks pushing 
    invalid/incomplete claims leading to high rejection rates.
    """
    
    def __init__(self, config: Optional[ValidationConfig] = None):
        self.config = config or ValidationConfig()
        
        # Initialize validation components
        self.compliance_validator = ComplianceValidator(self.config)
        self.ml_validator = MLValidityClassifier()
        
        # Track validation metrics
        self.validation_count = 0
        self.successful_validations = 0
        self.failed_validations = 0
        
        logger.info("🚀 MCDE Evidence Validator (EV) initialized")
        logger.info(f"Configuration: {self.config.to_dict()}")
    
    def validate_claim(self, claim: Dict[str, Any], evidence: List[Dict[str, Any]]) -> ValidationResult:
        """
        Main validation method - validates a claim and its evidence
        
        Args:
            claim: Structured claim object from Claim Detector
            evidence: List of evidence items (documents, photos, etc.)
            
        Returns:
            ValidationResult with comprehensive validation status
        """
        start_time = time.time()
        self.validation_count += 1
        
        try:
            logger.info(f"🔍 Validating claim {claim.get('claim_id', 'unknown')}")
            
            # Step 1: Compliance Validation (Hard Rules)
            compliance_result = self.compliance_validator.validate_claim_compliance(claim)
            
            # Step 2: ML Validity Classification (Intelligent Assessment)
            ml_result = self.ml_validator.predict_validity(claim, evidence)
            
            # Step 3: Evidence Completeness Assessment
            completeness_result = self._assess_evidence_completeness(claim, evidence)
            
            # Step 4: Calculate Overall Validation Score
            overall_score = self._calculate_overall_score(
                compliance_result, ml_result, completeness_result
            )
            
            # Step 5: Determine Final Status
            validation_status = self._determine_validation_status(
                overall_score, compliance_result, completeness_result
            )
            
            # Step 6: Generate Recommendations
            recommendations = self._generate_recommendations(
                compliance_result, ml_result, completeness_result
            )
            
            # Create validation result
            result = ValidationResult(
                claim_id=claim.get('claim_id', 'unknown'),
                validation_status=validation_status,
                evidence_completeness=completeness_result['completeness'],
                compliance_status=compliance_result.compliance_status,
                overall_score=overall_score,
                format_compliance_score=compliance_result.score,
                time_compliance_score=compliance_result.score,
                completeness_score=completeness_result['score'],
                ml_validity_score=ml_result['validity_score'],
                issues=compliance_result.issues + completeness_result['issues'],
                warnings=compliance_result.warnings + completeness_result['warnings'],
                recommendations=recommendations,
                required_evidence=completeness_result['required_evidence'],
                present_evidence=completeness_result['present_evidence'],
                missing_evidence=completeness_result['missing_evidence'],
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
            
            # Update metrics
            if result.validation_status == ValidationStatus.VALID:
                self.successful_validations += 1
            else:
                self.failed_validations += 1
            
            # Log results
            self._log_validation_result(result, claim)
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error in claim validation: {e}")
            self.failed_validations += 1
            
            return ValidationResult(
                claim_id=claim.get('claim_id', 'unknown'),
                validation_status=ValidationStatus.ERROR,
                evidence_completeness=EvidenceCompleteness.INSUFFICIENT,
                compliance_status=ComplianceStatus.NON_COMPLIANT,
                overall_score=0.0,
                issues=[f"Validation error: {str(e)}"],
                recommendations=["Contact support for validation issues"],
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
    
    def _assess_evidence_completeness(self, claim: Dict[str, Any], evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Assess evidence completeness based on claim type and requirements"""
        claim_type = claim.get('claim_type', 'other')
        required_count = self.config.required_evidence_counts.get(claim_type, 2)
        
        # Count present evidence
        present_evidence = []
        missing_evidence = []
        
        # Map claim type to required evidence types
        evidence_mapping = self._get_evidence_mapping(claim_type)
        required_evidence = evidence_mapping.copy()
        
        # Check which evidence types are present
        for ev in evidence:
            ev_type = ev.get('evidence_type', 'unknown')
            if ev_type in required_evidence:
                present_evidence.append(ev_type)
                if ev_type in required_evidence:
                    required_evidence.remove(ev_type)
        
        # Missing evidence is what's still in required_evidence
        missing_evidence = required_evidence
        
        # Calculate completeness score
        if len(evidence_mapping) == 0:
            completeness_score = 1.0
        else:
            completeness_score = len(present_evidence) / len(evidence_mapping)
        
        # Determine completeness level
        if completeness_score >= 0.9:
            completeness = EvidenceCompleteness.COMPLETE
        elif completeness_score >= 0.6:
            completeness = EvidenceCompleteness.PARTIAL
        elif completeness_score >= 0.3:
            completeness = EvidenceCompleteness.INCOMPLETE
        else:
            completeness = EvidenceCompleteness.INSUFFICIENT
        
        # Generate issues and warnings
        issues = []
        warnings = []
        
        if missing_evidence:
            issues.append(f"Missing required evidence: {', '.join(missing_evidence)}")
        
        if len(evidence) < required_count:
            issues.append(f"Insufficient evidence count: {len(evidence)}/{required_count}")
        
        if completeness_score < 0.8:
            warnings.append("Evidence package could be strengthened")
        
        return {
            'completeness': completeness,
            'score': completeness_score,
            'required_evidence': evidence_mapping,
            'present_evidence': present_evidence,
            'missing_evidence': missing_evidence,
            'issues': issues,
            'warnings': warnings
        }
    
    def _get_evidence_mapping(self, claim_type: str) -> List[str]:
        """Get required evidence types for a claim type"""
        evidence_mapping = {
            'lost': [
                'shipment_reconciliation_reports',
                'carrier_confirmation', 
                'shipping_manifests'
            ],
            'damaged': [
                'inbound_shipment_logs',
                'fc_processing_logs',
                'photo_evidence'
            ],
            'fee_error': [
                'amazon_fee_reports',
                'invoice_documentation'
            ],
            'return': [
                'return_reports',
                'invoice_documentation'
            ],
            'inventory_adjustment': [
                'inventory_reports',
                'adjustment_documentation'
            ],
            'warehouse_damage': [
                'warehouse_logs',
                'damage_photos'
            ],
            'shipping_error': [
                'carrier_documentation',
                'shipping_reports'
            ],
            'quality_issue': [
                'quality_reports',
                'product_documentation'
            ],
            'packaging_damage': [
                'packaging_photos',
                'damage_reports'
            ],
            'expired_product': [
                'expiration_documentation'
            ],
            'recalled_product': [
                'recall_notices'
            ],
            'counterfeit_item': [
                'authenticity_documentation',
                'comparison_evidence'
            ],
            'other': [
                'supporting_documentation'
            ]
        }
        
        return evidence_mapping.get(claim_type, evidence_mapping['other'])
    
    def _calculate_overall_score(self, compliance_result, ml_result, completeness_result) -> float:
        """Calculate overall validation score"""
        # Weighted combination of all scores
        weights = {
            'compliance': 0.4,      # Hard rules are most important
            'completeness': 0.35,   # Evidence completeness is critical
            'ml_validity': 0.25     # ML assessment provides intelligence
        }
        
        overall_score = (
            compliance_result.score * weights['compliance'] +
            completeness_result['score'] * weights['completeness'] +
            ml_result['validity_score'] * weights['ml_validity']
        )
        
        return min(overall_score, 1.0)
    
    def _determine_validation_status(self, overall_score: float, compliance_result, completeness_result) -> ValidationStatus:
        """Determine final validation status"""
        # Check if any critical failures occurred
        if compliance_result.compliance_status == ComplianceStatus.NON_COMPLIANT:
            return ValidationStatus.COMPLIANCE_FAILED
        
        if completeness_result['completeness'] == EvidenceCompleteness.INSUFFICIENT:
            return ValidationStatus.INCOMPLETE
        
        # Check overall score thresholds
        if overall_score >= self.config.min_overall_score:
            return ValidationStatus.VALID
        elif overall_score >= 0.6:
            return ValidationStatus.INCOMPLETE
        else:
            return ValidationStatus.INVALID
    
    def _generate_recommendations(self, compliance_result, ml_result, completeness_result) -> List[str]:
        """Generate comprehensive recommendations"""
        recommendations = []
        
        # Add compliance recommendations
        if compliance_result.recommendations:
            recommendations.extend(compliance_result.recommendations)
        
        # Add ML recommendations
        if ml_result.get('recommendations'):
            recommendations.extend(ml_result['recommendations'])
        
        # Add completeness recommendations
        if completeness_result['issues']:
            recommendations.extend([
                f"Address: {issue}" for issue in completeness_result['issues']
            ])
        
        # Add general recommendations based on scores
        if compliance_result.score < 0.8:
            recommendations.append("Review compliance requirements and business rules")
        
        if completeness_result['score'] < 0.8:
            recommendations.append("Strengthen evidence package with additional documentation")
        
        if ml_result['validity_score'] < 0.7:
            recommendations.append("Improve evidence quality and completeness")
        
        # Remove duplicates while preserving order
        seen = set()
        unique_recommendations = []
        for rec in recommendations:
            if rec not in seen:
                seen.add(rec)
                unique_recommendations.append(rec)
        
        return unique_recommendations
    
    def _log_validation_result(self, result: ValidationResult, claim: Dict[str, Any]):
        """Log validation results for monitoring and analytics"""
        claim_id = claim.get('claim_id', 'unknown')
        claim_type = claim.get('claim_type', 'unknown')
        
        if result.validation_status == ValidationStatus.VALID:
            logger.info(f"✅ Claim {claim_id} ({claim_type}) validated successfully - Score: {result.overall_score:.2f}")
        elif result.validation_status == ValidationStatus.INCOMPLETE:
            logger.warning(f"⚠️ Claim {claim_id} ({claim_type}) incomplete - Score: {result.overall_score:.2f}")
        else:
            logger.error(f"❌ Claim {claim_id} ({claim_type}) validation failed - Score: {result.overall_score:.2f}")
        
        # Log detailed issues if any
        if result.issues:
            logger.info(f"📋 Issues for claim {claim_id}: {result.issues}")
        
        # Log recommendations
        if result.recommendations:
            logger.info(f"💡 Recommendations for claim {claim_id}: {result.recommendations}")
    
    def get_validation_metrics(self) -> Dict[str, Any]:
        """Get validation performance metrics"""
        success_rate = (self.successful_validations / self.validation_count * 100) if self.validation_count > 0 else 0
        
        return {
            'total_validations': self.validation_count,
            'successful_validations': self.successful_validations,
            'failed_validations': self.failed_validations,
            'success_rate_percent': round(success_rate, 2),
            'config': self.config.to_dict()
        }
    
    def validate_batch(self, claims: List[Dict[str, Any]], evidence_map: Dict[str, List[Dict[str, Any]]]) -> List[ValidationResult]:
        """Validate multiple claims in batch"""
        results = []
        
        logger.info(f"🔄 Starting batch validation of {len(claims)} claims")
        
        for claim in claims:
            claim_id = claim.get('claim_id', 'unknown')
            evidence = evidence_map.get(claim_id, [])
            
            result = self.validate_claim(claim, evidence)
            results.append(result)
        
        # Log batch summary
        valid_count = sum(1 for r in results if r.validation_status == ValidationStatus.VALID)
        logger.info(f"📊 Batch validation complete: {valid_count}/{len(claims)} claims valid")
        
        return results
    
    def is_ready_for_auto_filing(self, validation_result: ValidationResult) -> bool:
        """Check if a claim is ready for automatic filing"""
        return validation_result.is_ready_for_auto_filing()
    
    def get_auto_filing_candidates(self, validation_results: List[ValidationResult]) -> List[ValidationResult]:
        """Get list of claims ready for automatic filing"""
        return [result for result in validation_results if self.is_ready_for_auto_filing(result)]
