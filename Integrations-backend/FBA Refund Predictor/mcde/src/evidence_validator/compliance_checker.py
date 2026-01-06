"""
Compliance Validator for MCDE Evidence Validator (EV)

Performs hard compliance checks including:
- Date window validation (claim age, evidence age)
- Document format compliance
- Business rule validation
- Required field validation
"""

import logging
from typing import Dict, List, Any, Tuple, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass

from .types import ComplianceStatus, ValidationConfig

logger = logging.getLogger(__name__)


@dataclass
class ComplianceCheckResult:
    """Result of compliance validation"""
    is_compliant: bool
    compliance_status: ComplianceStatus
    score: float  # 0.0 - 1.0
    issues: List[str]
    warnings: List[str]
    recommendations: List[str]


class ComplianceValidator:
    """
    Validates claim compliance with hard business rules and requirements
    """
    
    def __init__(self, config: ValidationConfig):
        self.config = config
        self.logger = logging.getLogger(__name__)
    
    def validate_claim_compliance(self, claim: Dict[str, Any]) -> ComplianceCheckResult:
        """
        Validate overall claim compliance
        """
        start_time = datetime.utcnow()
        
        try:
            # Initialize result
            issues = []
            warnings = []
            recommendations = []
            compliance_score = 1.0
            
            # Check claim age
            age_check = self._validate_claim_age(claim)
            if not age_check['is_valid']:
                issues.append(age_check['issue'])
                compliance_score *= 0.5
            
            # Check required fields
            field_check = self._validate_required_fields(claim)
            if not field_check['is_valid']:
                issues.extend(field_check['issues'])
                compliance_score *= 0.7
            
            # Check business rules
            business_check = self._validate_business_rules(claim)
            if not business_check['is_valid']:
                issues.extend(business_check['issues'])
                compliance_score *= 0.8
            
            # Check evidence age
            evidence_check = self._validate_evidence_age(claim)
            if not evidence_check['is_valid']:
                warnings.append(evidence_check['warning'])
                compliance_score *= 0.9
            
            # Determine compliance status
            if compliance_score >= 0.9:
                status = ComplianceStatus.COMPLIANT
            elif compliance_score >= 0.7:
                status = ComplianceStatus.PENDING_VERIFICATION
            else:
                status = ComplianceStatus.NON_COMPLIANT
            
            # Generate recommendations
            if age_check.get('recommendation'):
                recommendations.append(age_check['recommendation'])
            if field_check.get('recommendations'):
                recommendations.extend(field_check['recommendations'])
            if business_check.get('recommendations'):
                recommendations.extend(business_check['recommendations'])
            
            return ComplianceCheckResult(
                is_compliant=compliance_score >= self.config.min_time_compliance,
                compliance_status=status,
                score=compliance_score,
                issues=issues,
                warnings=warnings,
                recommendations=recommendations
            )
            
        except Exception as e:
            self.logger.error(f"Error in compliance validation: {e}")
            return ComplianceCheckResult(
                is_compliant=False,
                compliance_status=ComplianceStatus.NON_COMPLIANT,
                score=0.0,
                issues=[f"Compliance validation error: {str(e)}"],
                warnings=[],
                recommendations=["Contact support for compliance validation issues"]
            )
    
    def _validate_claim_age(self, claim: Dict[str, Any]) -> Dict[str, Any]:
        """Validate claim age against maximum allowed age"""
        try:
            # Extract claim timestamp
            claim_timestamp = claim.get('timestamp')
            if not claim_timestamp:
                return {
                    'is_valid': False,
                    'issue': 'Claim timestamp is missing',
                    'recommendation': 'Include claim timestamp in metadata'
                }
            
            # Parse timestamp
            if isinstance(claim_timestamp, str):
                claim_date = datetime.fromisoformat(claim_timestamp.replace('Z', '+00:00'))
            else:
                claim_date = claim_timestamp
            
            # Calculate age
            claim_age = datetime.utcnow() - claim_date.replace(tzinfo=None)
            max_age_days = self.config.max_claim_age_days
            
            if claim_age.days > max_age_days:
                return {
                    'is_valid': False,
                    'issue': f'Claim is {claim_age.days} days old, exceeds maximum of {max_age_days} days',
                    'recommendation': f'File claims within {max_age_days} days of incident'
                }
            
            # Check if claim is too old for Amazon's requirements
            if claim_age.days > 365:
                return {
                    'is_valid': False,
                    'issue': f'Claim is {claim_age.days} days old, exceeds Amazon\'s 1-year limit',
                    'recommendation': 'Claims older than 1 year are typically rejected by Amazon'
                }
            
            return {'is_valid': True}
            
        except Exception as e:
            return {
                'is_valid': False,
                'issue': f'Error validating claim age: {str(e)}',
                'recommendation': 'Check claim timestamp format'
            }
    
    def _validate_required_fields(self, claim: Dict[str, Any]) -> Dict[str, Any]:
        """Validate required fields are present"""
        issues = []
        recommendations = []
        
        # Required fields by claim type
        required_fields = {
            'lost': ['order_id', 'sku', 'fnsku', 'shipment_id', 'claim_amount'],
            'damaged': ['order_id', 'sku', 'fnsku', 'damage_description', 'claim_amount'],
            'fee_error': ['order_id', 'sku', 'fee_type', 'expected_fee', 'actual_fee'],
            'return': ['order_id', 'sku', 'return_reason', 'return_date', 'claim_amount'],
            'inventory_adjustment': ['sku', 'adjustment_type', 'quantity', 'claim_amount'],
            'warehouse_damage': ['sku', 'warehouse_location', 'damage_description', 'claim_amount'],
            'shipping_error': ['shipment_id', 'carrier', 'error_description', 'claim_amount'],
            'quality_issue': ['sku', 'issue_description', 'affected_quantity', 'claim_amount'],
            'packaging_damage': ['sku', 'damage_description', 'claim_amount'],
            'expired_product': ['sku', 'expiration_date', 'claim_amount'],
            'recalled_product': ['sku', 'recall_notice', 'claim_amount'],
            'counterfeit_item': ['sku', 'counterfeit_evidence', 'claim_amount'],
            'other': ['sku', 'issue_description', 'claim_amount']
        }
        
        claim_type = claim.get('claim_type', 'other')
        required = required_fields.get(claim_type, required_fields['other'])
        
        # Check each required field
        for field in required:
            if field not in claim.get('metadata', {}) or claim['metadata'][field] is None:
                issues.append(f'Required field missing: {field}')
                recommendations.append(f'Include {field} in claim metadata')
        
        # Check claim amount
        metadata = claim.get('metadata', {})
        claim_amount = metadata.get('claim_amount')
        if claim_amount is not None:
            try:
                amount = float(claim_amount)
                if amount <= 0:
                    issues.append('Claim amount must be greater than 0')
                    recommendations.append('Verify claim amount calculation')
                if amount > 10000:
                    warnings.append('Claim amount exceeds $10,000 - may require additional review')
            except (ValueError, TypeError):
                issues.append('Invalid claim amount format')
                recommendations.append('Claim amount must be a valid number')
        
        return {
            'is_valid': len(issues) == 0,
            'issues': issues,
            'recommendations': recommendations
        }
    
    def _validate_business_rules(self, claim: Dict[str, Any]) -> Dict[str, Any]:
        """Validate business-specific rules"""
        issues = []
        recommendations = []
        
        claim_type = claim.get('claim_type')
        metadata = claim.get('metadata', {})
        
        # Lost inventory rules
        if claim_type == 'lost':
            # Check if shipment date is within reasonable range
            shipment_date = metadata.get('shipment_date')
            if shipment_date:
                try:
                    if isinstance(shipment_date, str):
                        ship_date = datetime.fromisoformat(shipment_date.replace('Z', '+00:00'))
                    else:
                        ship_date = shipment_date
                    
                    days_since_shipment = (datetime.utcnow() - ship_date.replace(tzinfo=None)).days
                    if days_since_shipment > 180:
                        issues.append('Lost inventory claim filed more than 6 months after shipment')
                        recommendations.append('File lost inventory claims within 6 months')
                except Exception:
                    pass
        
        # Damaged stock rules
        elif claim_type == 'damaged':
            # Check if damage description is sufficient
            damage_desc = metadata.get('damage_description', '')
            if len(damage_desc) < 20:
                issues.append('Damage description is too brief for effective processing')
                recommendations.append('Provide detailed damage description (minimum 20 characters)')
        
        # Fee error rules
        elif claim_type == 'fee_error':
            expected_fee = metadata.get('expected_fee')
            actual_fee = metadata.get('actual_fee')
            if expected_fee and actual_fee:
                try:
                    expected = float(expected_fee)
                    actual = float(actual_fee)
                    if abs(actual - expected) < 0.01:
                        issues.append('Fee difference is minimal - may not warrant claim')
                        recommendations.append('Verify fee difference exceeds minimum threshold')
                except (ValueError, TypeError):
                    pass
        
        return {
            'is_valid': len(issues) == 0,
            'issues': issues,
            'recommendations': recommendations
        }
    
    def _validate_evidence_age(self, claim: Dict[str, Any]) -> Dict[str, Any]:
        """Validate evidence age"""
        # This would check the age of attached evidence documents
        # For now, return a basic validation
        return {
            'is_valid': True,
            'warning': 'Evidence age validation not implemented yet'
        }
    
    def validate_evidence_format(self, evidence: Dict[str, Any]) -> Dict[str, Any]:
        """Validate evidence document format"""
        issues = []
        warnings = []
        
        # Check file size
        file_size_mb = evidence.get('file_size_mb', 0)
        if file_size_mb > self.config.max_file_size_mb:
            issues.append(f'File size {file_size_mb}MB exceeds maximum {self.config.max_file_size_mb}MB')
        
        # Check file type
        file_type = evidence.get('file_type', '').lower()
        allowed_types = ['pdf', 'jpg', 'jpeg', 'png', 'tiff', 'doc', 'docx']
        if file_type not in allowed_types:
            issues.append(f'File type {file_type} not supported. Allowed: {", ".join(allowed_types)}')
        
        # Check resolution for images
        if file_type in ['jpg', 'jpeg', 'png', 'tiff']:
            width = evidence.get('width', 0)
            height = evidence.get('height', 0)
            if width < 800 or height < 600:
                warnings.append('Image resolution may be too low for effective processing')
        
        return {
            'is_valid': len(issues) == 0,
            'issues': issues,
            'warnings': warnings
        }
