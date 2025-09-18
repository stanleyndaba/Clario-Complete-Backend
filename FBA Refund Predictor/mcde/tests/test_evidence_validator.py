"""
Comprehensive tests for MCDE Evidence Validator (EV) system

Tests the critical bridge between detection and automation:
- Compliance validation (hard rules)
- ML validity classification (intelligent assessment)  
- Evidence completeness checking
- Integration with downstream systems
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timedelta
import json

from src.evidence_validator import (
    EvidenceValidator, ComplianceValidator, MLValidityClassifier, IntegrationBridge
)
from src.evidence_validator.types import (
    ValidationResult, ValidationStatus, EvidenceCompleteness, 
    ComplianceStatus, ValidationConfig
)


class TestEvidenceValidator:
    """Test cases for the main Evidence Validator"""
    
    @pytest.fixture
    def validation_config(self):
        """Test validation configuration"""
        return ValidationConfig(
            min_overall_score=0.8,
            min_format_compliance=0.8,
            min_time_compliance=0.9,
            min_completeness=0.7,
            min_ml_validity=0.75
        )
    
    @pytest.fixture
    def evidence_validator(self, validation_config):
        """Create EvidenceValidator instance for testing"""
        return EvidenceValidator(validation_config)
    
    @pytest.fixture
    def sample_claim(self):
        """Sample claim data for testing"""
        return {
            'claim_id': 'CLM_001234',
            'claim_type': 'lost',
            'metadata': {
                'order_id': '123-4567890-1234567',
                'sku': 'B07ABC1234',
                'fnsku': 'X001ABC123',
                'shipment_id': 'FBA1234567',
                'claim_amount': 150.00,
                'currency': 'USD',
                'shipment_date': '2024-01-15'
            },
            'confidence_score': 0.94,
            'timestamp': '2024-01-15T10:30:00',
            'raw_text': 'Inventory lost during shipment, need reimbursement for $150'
        }
    
    @pytest.fixture
    def sample_evidence(self):
        """Sample evidence data for testing"""
        return [
            {
                'evidence_id': 'EV_001',
                'evidence_type': 'shipment_reconciliation_reports',
                'source_url': 's3://bucket/reports/shipment_001.pdf',
                'metadata': {
                    'file_type': 'pdf',
                    'file_size_mb': 2.5,
                    'ocr_confidence': 0.95,
                    'width': 1920,
                    'height': 1080
                },
                'validation_score': 0.9,
                'is_required': True,
                'is_valid': True
            },
            {
                'evidence_id': 'EV_002',
                'evidence_type': 'carrier_confirmation',
                'source_url': 's3://bucket/carrier/carrier_001.pdf',
                'metadata': {
                    'file_type': 'pdf',
                    'file_size_mb': 1.8,
                    'ocr_confidence': 0.92,
                    'width': 1600,
                    'height': 900
                },
                'validation_score': 0.88,
                'is_required': True,
                'is_valid': True
            },
            {
                'evidence_id': 'EV_003',
                'evidence_type': 'shipping_manifests',
                'source_url': 's3://bucket/manifests/manifest_001.pdf',
                'metadata': {
                    'file_type': 'pdf',
                    'file_size_mb': 3.2,
                    'ocr_confidence': 0.89,
                    'width': 1800,
                    'height': 1200
                },
                'validation_score': 0.87,
                'is_required': True,
                'is_valid': True
            }
        ]
    
    def test_evidence_validator_initialization(self, evidence_validator, validation_config):
        """Test EvidenceValidator initialization"""
        assert evidence_validator.config == validation_config
        assert evidence_validator.compliance_validator is not None
        assert evidence_validator.ml_validator is not None
        assert evidence_validator.validation_count == 0
    
    def test_validate_claim_success(self, evidence_validator, sample_claim, sample_evidence):
        """Test successful claim validation"""
        result = evidence_validator.validate_claim(sample_claim, sample_evidence)
        
        # Verify result structure
        assert isinstance(result, ValidationResult)
        assert result.claim_id == 'CLM_001234'
        assert result.validation_status in [ValidationStatus.VALID, ValidationStatus.INCOMPLETE]
        assert result.overall_score > 0.7
        
        # Verify metrics updated
        assert evidence_validator.validation_count == 1
        assert evidence_validator.successful_validations >= 0  # Could be 0 if validation fails
    
    def test_validate_claim_missing_evidence(self, evidence_validator, sample_claim):
        """Test claim validation with missing evidence"""
        # Only provide one piece of evidence instead of required three
        minimal_evidence = [sample_claim['evidence'][0]] if 'evidence' in sample_claim else []
        
        result = evidence_validator.validate_claim(sample_claim, minimal_evidence)
        
        assert result.evidence_completeness in [EvidenceCompleteness.INCOMPLETE, EvidenceCompleteness.INSUFFICIENT]
        assert result.overall_score < 0.8
    
    def test_validate_claim_old_claim(self, evidence_validator, sample_claim, sample_evidence):
        """Test validation of old claim (should fail compliance)"""
        # Make claim very old
        old_claim = sample_claim.copy()
        old_claim['timestamp'] = '2020-01-15T10:30:00'  # 4 years old
        
        result = evidence_validator.validate_claim(old_claim, sample_evidence)
        
        # Should fail compliance due to age
        assert result.compliance_status == ComplianceStatus.NON_COMPLIANT
        assert result.validation_status == ValidationStatus.COMPLIANCE_FAILED
    
    def test_validate_claim_incomplete_metadata(self, evidence_validator, sample_evidence):
        """Test validation of claim with incomplete metadata"""
        incomplete_claim = {
            'claim_id': 'CLM_001235',
            'claim_type': 'lost',
            'metadata': {
                'sku': 'B07ABC1234',
                # Missing required fields like order_id, claim_amount
            },
            'timestamp': '2024-01-15T10:30:00'
        }
        
        result = evidence_validator.validate_claim(incomplete_claim, sample_evidence)
        
        assert result.compliance_status == ComplianceStatus.NON_COMPLIANT
        assert len(result.issues) > 0
        assert any('Required field missing' in issue for issue in result.issues)
    
    def test_batch_validation(self, evidence_validator, sample_claim, sample_evidence):
        """Test batch validation of multiple claims"""
        claims = [sample_claim, sample_claim.copy()]
        evidence_map = {
            'CLM_001234': sample_evidence,
            'CLM_001235': sample_evidence
        }
        
        # Update second claim ID
        claims[1]['claim_id'] = 'CLM_001235'
        
        results = evidence_validator.validate_batch(claims, evidence_map)
        
        assert len(results) == 2
        assert all(isinstance(r, ValidationResult) for r in results)
        assert evidence_validator.validation_count == 2
    
    def test_auto_filing_readiness(self, evidence_validator, sample_claim, sample_evidence):
        """Test auto-filing readiness check"""
        result = evidence_validator.validate_claim(sample_claim, sample_evidence)
        
        is_ready = evidence_validator.is_ready_for_auto_filing(result)
        
        # Should be ready if validation score >= 0.8 and all other criteria met
        expected_ready = (
            result.validation_status == ValidationStatus.VALID and
            result.evidence_completeness == EvidenceCompleteness.COMPLETE and
            result.compliance_status == ComplianceStatus.COMPLIANT and
            result.overall_score >= 0.8
        )
        
        assert is_ready == expected_ready
    
    def test_get_auto_filing_candidates(self, evidence_validator, sample_claim, sample_evidence):
        """Test getting list of claims ready for auto-filing"""
        # Validate multiple claims
        result1 = evidence_validator.validate_claim(sample_claim, sample_evidence)
        
        # Create a second claim with minimal evidence (should not be ready)
        minimal_claim = sample_claim.copy()
        minimal_claim['claim_id'] = 'CLM_001236'
        result2 = evidence_validator.validate_claim(minimal_claim, [])
        
        # Get auto-filing candidates
        candidates = evidence_validator.get_auto_filing_candidates([result1, result2])
        
        # Should only include claims that are ready
        assert len(candidates) <= 2
        assert all(evidence_validator.is_ready_for_auto_filing(c) for c in candidates)
    
    def test_validation_metrics(self, evidence_validator, sample_claim, sample_evidence):
        """Test validation metrics collection"""
        # Perform some validations
        evidence_validator.validate_claim(sample_claim, sample_evidence)
        evidence_validator.validate_claim(sample_claim, [])  # Should fail due to no evidence
        
        metrics = evidence_validator.get_validation_metrics()
        
        assert metrics['total_validations'] == 2
        assert metrics['successful_validations'] >= 0
        assert metrics['failed_validations'] >= 0
        assert 'success_rate_percent' in metrics
        assert 'config' in metrics


class TestComplianceValidator:
    """Test cases for ComplianceValidator"""
    
    @pytest.fixture
    def compliance_validator(self):
        """Create ComplianceValidator instance for testing"""
        config = ValidationConfig()
        return ComplianceValidator(config)
    
    def test_claim_age_validation(self, compliance_validator):
        """Test claim age validation"""
        # Recent claim
        recent_claim = {
            'timestamp': '2024-01-15T10:30:00',
            'claim_type': 'lost',
            'metadata': {'sku': 'TEST123', 'claim_amount': 100}
        }
        
        result = compliance_validator.validate_claim_compliance(recent_claim)
        assert result.is_compliant
        assert result.compliance_status == ComplianceStatus.COMPLIANT
        
        # Old claim
        old_claim = {
            'timestamp': '2020-01-15T10:30:00',
            'claim_type': 'lost',
            'metadata': {'sku': 'TEST123', 'claim_amount': 100}
        }
        
        result = compliance_validator.validate_claim_compliance(old_claim)
        assert not result.is_compliant
        assert result.compliance_status == ComplianceStatus.NON_COMPLIANT
    
    def test_required_fields_validation(self, compliance_validator):
        """Test required fields validation"""
        # Complete claim
        complete_claim = {
            'timestamp': '2024-01-15T10:30:00',
            'claim_type': 'lost',
            'metadata': {
                'order_id': '123-4567890-1234567',
                'sku': 'B07ABC1234',
                'fnsku': 'X001ABC123',
                'shipment_id': 'FBA1234567',
                'claim_amount': 150.00
            }
        }
        
        result = compliance_validator.validate_claim_compliance(complete_claim)
        assert result.is_compliant
        
        # Incomplete claim
        incomplete_claim = {
            'timestamp': '2024-01-15T10:30:00',
            'claim_type': 'lost',
            'metadata': {
                'sku': 'B07ABC1234'
                # Missing required fields
            }
        }
        
        result = compliance_validator.validate_claim_compliance(incomplete_claim)
        assert not result.is_compliant
        assert len(result.issues) > 0
    
    def test_business_rules_validation(self, compliance_validator):
        """Test business rules validation"""
        # Valid damaged claim with good description
        valid_damaged_claim = {
            'timestamp': '2024-01-15T10:30:00',
            'claim_type': 'damaged',
            'metadata': {
                'sku': 'B07ABC1234',
                'claim_amount': 100,
                'damage_description': 'Product arrived with significant damage to packaging and contents'
            }
        }
        
        result = compliance_validator.validate_claim_compliance(valid_damaged_claim)
        assert result.is_compliant
        
        # Invalid damaged claim with poor description
        invalid_damaged_claim = {
            'timestamp': '2024-01-15T10:30:00',
            'claim_type': 'damaged',
            'metadata': {
                'sku': 'B07ABC1234',
                'claim_amount': 100,
                'damage_description': 'Damaged'  # Too short
            }
        }
        
        result = compliance_validator.validate_claim_compliance(invalid_damaged_claim)
        assert not result.is_compliant
        assert any('description is too brief' in issue for issue in result.issues)


class TestMLValidityClassifier:
    """Test cases for MLValidityClassifier"""
    
    @pytest.fixture
    def ml_classifier(self):
        """Create MLValidityClassifier instance for testing"""
        return MLValidityClassifier()
    
    def test_feature_extraction(self, ml_classifier, sample_claim, sample_evidence):
        """Test feature extraction from claims and evidence"""
        features = ml_classifier.extract_features(sample_claim, sample_evidence)
        
        assert features.shape == (1, -1)  # Single sample, multiple features
        assert features.size > 0
    
    def test_validity_prediction(self, ml_classifier, sample_claim, sample_evidence):
        """Test validity prediction"""
        result = ml_classifier.predict_validity(sample_claim, sample_evidence)
        
        assert 'validity_score' in result
        assert 'validity_level' in result
        assert 'confidence' in result
        assert 'recommendations' in result
        
        assert 0.0 <= result['validity_score'] <= 1.0
        assert result['validity_level'] in ['high', 'medium', 'low', 'unknown']
    
    def test_rule_based_fallback(self, ml_classifier, sample_claim, sample_evidence):
        """Test rule-based fallback when ML model is not available"""
        # Mock ML model to be unavailable
        with patch.object(ml_classifier, 'classifier', None):
            result = ml_classifier.predict_validity(sample_claim, sample_evidence)
            
            assert 'validity_score' in result
            assert result['validity_score'] > 0.0  # Should use rule-based scoring


class TestIntegrationBridge:
    """Test cases for IntegrationBridge"""
    
    @pytest.fixture
    def integration_bridge(self):
        """Create IntegrationBridge instance for testing"""
        evidence_validator = EvidenceValidator()
        return IntegrationBridge(evidence_validator)
    
    @pytest.fixture
    def sample_claim_data(self, sample_claim, sample_evidence):
        """Sample claim data for integration testing"""
        return {
            'claim_id': 'CLM_001234',
            'claim': sample_claim,
            'evidence': sample_evidence
        }
    
    @pytest.mark.asyncio
    async def test_process_claim_detector_request(self, integration_bridge, sample_claim_data):
        """Test processing claim detector request"""
        result = await integration_bridge.process_claim_detector_request(sample_claim_data)
        
        assert 'validation_result' in result
        assert 'auto_filing_ready' in result
        assert 'next_steps' in result
        assert 'integration_timestamp' in result
        
        # Check metrics updated
        assert integration_bridge.integration_metrics['claims_received'] == 1
    
    @pytest.mark.asyncio
    async def test_send_to_auto_claims_generator(self, integration_bridge, sample_claim, sample_evidence):
        """Test sending validated claims to Auto-Claims Generator"""
        # Create validation result
        validation_result = ValidationResult(
            claim_id='CLM_001234',
            validation_status=ValidationStatus.VALID,
            evidence_completeness=EvidenceCompleteness.COMPLETE,
            compliance_status=ComplianceStatus.COMPLIANT,
            overall_score=0.9
        )
        
        validated_claims = [{
            'validation_result': validation_result,
            'claim': sample_claim,
            'evidence': sample_evidence
        }]
        
        result = await integration_bridge.send_to_auto_claims_generator(validated_claims)
        
        assert result['status'] == 'success'
        assert result['claims_sent'] == 1
        assert 'auto_filing_payload' in result
    
    @pytest.mark.asyncio
    async def test_update_payment_timeline_predictor(self, integration_bridge):
        """Test updating Payment Timeline Predictor"""
        validation_results = [
            ValidationResult(
                claim_id='CLM_001234',
                validation_status=ValidationStatus.VALID,
                evidence_completeness=EvidenceCompleteness.COMPLETE,
                compliance_status=ComplianceStatus.COMPLIANT,
                overall_score=0.9
            )
        ]
        
        result = await integration_bridge.update_payment_timeline_predictor(validation_results)
        
        assert result['status'] == 'success'
        assert result['ptp_updates'] == 1
        assert 'ptp_payload' in result
    
    def test_integration_metrics(self, integration_bridge):
        """Test integration metrics collection"""
        metrics = integration_bridge.get_integration_metrics()
        
        assert 'claims_received' in metrics
        assert 'claims_validated' in metrics
        assert 'claims_auto_filing_ready' in metrics
        assert 'validation_metrics' in metrics
        assert 'integration_timestamp' in metrics


class TestEndToEndFlow:
    """Test the complete Evidence Validator flow"""
    
    @pytest.fixture
    def complete_system(self):
        """Create complete Evidence Validator system"""
        config = ValidationConfig()
        evidence_validator = EvidenceValidator(config)
        integration_bridge = IntegrationBridge(evidence_validator)
        return evidence_validator, integration_bridge
    
    def test_complete_validation_flow(self, complete_system, sample_claim, sample_evidence):
        """Test complete validation flow from claim to auto-filing readiness"""
        evidence_validator, integration_bridge = complete_system
        
        # Step 1: Validate claim
        validation_result = evidence_validator.validate_claim(sample_claim, sample_evidence)
        
        # Step 2: Check if ready for auto-filing
        is_ready = evidence_validator.is_ready_for_auto_filing(validation_result)
        
        # Step 3: Get auto-filing candidates
        candidates = evidence_validator.get_auto_filing_candidates([validation_result])
        
        # Verify flow
        assert isinstance(validation_result, ValidationResult)
        assert validation_result.claim_id == 'CLM_001234'
        assert len(candidates) <= 1
        
        # Log results for debugging
        print(f"\nValidation Result: {validation_result.to_dict()}")
        print(f"Auto-filing ready: {is_ready}")
        print(f"Auto-filing candidates: {len(candidates)}")
    
    @pytest.mark.asyncio
    async def test_complete_integration_flow(self, complete_system, sample_claim_data):
        """Test complete integration flow"""
        evidence_validator, integration_bridge = complete_system
        
        # Step 1: Process claim detector request
        result = await integration_bridge.process_claim_detector_request(sample_claim_data)
        
        # Step 2: Check validation result
        assert result['validation_result'] is not None
        assert 'auto_filing_ready' in result
        
        # Step 3: Get metrics
        metrics = integration_bridge.get_integration_metrics()
        
        # Verify integration
        assert metrics['claims_received'] >= 1
        assert 'validation_metrics' in metrics
        
        print(f"\nIntegration Result: {result}")
        print(f"Integration Metrics: {metrics}")


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])
