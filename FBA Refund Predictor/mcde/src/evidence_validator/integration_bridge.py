"""
Integration Bridge for MCDE Evidence Validator (EV)

Connects Evidence Validator with:
- Claim Detector (input validation requests)
- Auto-Claims Generator (validated claims output)
- Payment Timeline Predictor (validation results)
- Reimbursement Optimizer (evidence quality metrics)
- Claim Prioritization Model (success probability × claim value)
"""

import logging
import asyncio
from typing import Dict, List, Any, Optional, Callable
from datetime import datetime
import json

from .types import ValidationResult, ValidationStatus
from .validator import EvidenceValidator

logger = logging.getLogger(__name__)


class IntegrationBridge:
    """
    Bridge between Evidence Validator and downstream systems
    
    This enables the critical flow:
    Claim Detector → Evidence Validator → Auto-Claims Generator
    """
    
    def __init__(self, evidence_validator: EvidenceValidator):
        self.evidence_validator = evidence_validator
        
        # Integration endpoints
        self.claim_detector_endpoint = None
        self.auto_claims_generator_endpoint = None
        self.payment_timeline_predictor_endpoint = None
        self.reimbursement_optimizer_endpoint = None
        self.claim_prioritization_model_endpoint = None
        
        # Callback functions for real-time integration
        self.on_validation_complete: Optional[Callable] = None
        self.on_auto_filing_ready: Optional[Callable] = None
        self.on_validation_failed: Optional[Callable] = None
        
        # Integration metrics
        self.integration_metrics = {
            'claims_received': 0,
            'claims_validated': 0,
            'claims_auto_filing_ready': 0,
            'claims_rejected': 0,
            'integration_errors': 0
        }
        
        logger.info("🌉 MCDE Evidence Validator Integration Bridge initialized")
    
    async def process_claim_detector_request(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process validation request from Claim Detector
        
        This is the main entry point for the integration flow
        """
        try:
            self.integration_metrics['claims_received'] += 1
            claim_id = claim_data.get('claim_id', 'unknown')
            
            logger.info(f"📥 Processing validation request from Claim Detector: {claim_id}")
            
            # Extract claim and evidence
            claim = claim_data.get('claim', {})
            evidence = claim_data.get('evidence', [])
            
            # Validate the claim
            validation_result = self.evidence_validator.validate_claim(claim, evidence)
            
            # Update metrics
            if validation_result.validation_status == ValidationStatus.VALID:
                self.integration_metrics['claims_validated'] += 1
            else:
                self.integration_metrics['claims_rejected'] += 1
            
            # Check if ready for auto-filing
            if self.evidence_validator.is_ready_for_auto_filing(validation_result):
                self.integration_metrics['claims_auto_filing_ready'] += 1
                
                # Trigger auto-filing callback
                if self.on_auto_filing_ready:
                    await self._trigger_auto_filing_callback(validation_result, claim, evidence)
            
            # Trigger validation complete callback
            if self.on_validation_complete:
                await self._trigger_validation_callback(validation_result, claim, evidence)
            
            # Prepare response
            response = {
                'validation_result': validation_result.to_dict(),
                'auto_filing_ready': self.evidence_validator.is_ready_for_auto_filing(validation_result),
                'next_steps': self._get_next_steps(validation_result),
                'integration_timestamp': datetime.utcnow().isoformat()
            }
            
            logger.info(f"✅ Validation complete for claim {claim_id}: {validation_result.validation_status.value}")
            return response
            
        except Exception as e:
            self.integration_metrics['integration_errors'] += 1
            logger.error(f"❌ Error processing Claim Detector request: {e}")
            
            return {
                'error': str(e),
                'validation_result': None,
                'auto_filing_ready': False,
                'integration_timestamp': datetime.utcnow().isoformat()
            }
    
    async def _trigger_auto_filing_callback(self, validation_result: ValidationResult, claim: Dict[str, Any], evidence: List[Dict[str, Any]]):
        """Trigger callback for claims ready for auto-filing"""
        try:
            if self.on_auto_filing_ready:
                await self.on_auto_filing_ready({
                    'validation_result': validation_result,
                    'claim': claim,
                    'evidence': evidence,
                    'timestamp': datetime.utcnow().isoformat()
                })
                logger.info(f"🚀 Auto-filing callback triggered for claim {validation_result.claim_id}")
        except Exception as e:
            logger.error(f"Error in auto-filing callback: {e}")
    
    async def _trigger_validation_callback(self, validation_result: ValidationResult, claim: Dict[str, Any], evidence: List[Dict[str, Any]]):
        """Trigger callback for validation completion"""
        try:
            if self.on_validation_complete:
                await self.on_validation_complete({
                    'validation_result': validation_result,
                    'claim': claim,
                    'evidence': evidence,
                    'timestamp': datetime.utcnow().isoformat()
                })
        except Exception as e:
            logger.error(f"Error in validation callback: {e}")
    
    def _get_next_steps(self, validation_result: ValidationResult) -> List[str]:
        """Get next steps based on validation result"""
        next_steps = []
        
        if validation_result.validation_status == ValidationStatus.VALID:
            next_steps.append("Proceed to Auto-Claims Generator")
            next_steps.append("Update Payment Timeline Predictor")
            next_steps.append("Queue for Reimbursement Optimizer")
        elif validation_result.validation_status == ValidationStatus.INCOMPLETE:
            next_steps.append("Address missing evidence requirements")
            next_steps.append("Review compliance issues")
            next_steps.append("Resubmit for validation")
        elif validation_result.validation_status == ValidationStatus.COMPLIANCE_FAILED:
            next_steps.append("Review business rule violations")
            next_steps.append("Update claim data")
            next_steps.append("Resubmit for validation")
        else:
            next_steps.append("Review validation errors")
            next_steps.append("Contact support if issues persist")
        
        return next_steps
    
    async def send_to_auto_claims_generator(self, validated_claims: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Send validated claims to Auto-Claims Generator
        
        This unlocks the automated filing flow
        """
        try:
            if not validated_claims:
                return {'status': 'no_claims', 'message': 'No validated claims to send'}
            
            logger.info(f"🚀 Sending {len(validated_claims)} validated claims to Auto-Claims Generator")
            
            # Prepare claims for auto-filing
            auto_filing_payload = []
            for claim_data in validated_claims:
                validation_result = claim_data['validation_result']
                claim = claim_data['claim']
                evidence = claim_data['evidence']
                
                # Only send claims ready for auto-filing
                if self.evidence_validator.is_ready_for_auto_filing(validation_result):
                    auto_filing_payload.append({
                        'claim_id': validation_result.claim_id,
                        'claim_type': claim.get('claim_type'),
                        'metadata': claim.get('metadata', {}),
                        'evidence_summary': self._create_evidence_summary(evidence),
                        'validation_metrics': {
                            'overall_score': validation_result.overall_score,
                            'compliance_score': validation_result.format_compliance_score,
                            'completeness_score': validation_result.completeness_score,
                            'ml_validity_score': validation_result.ml_validity_score
                        },
                        'auto_filing_timestamp': datetime.utcnow().isoformat()
                    })
            
            if not auto_filing_payload:
                return {'status': 'no_auto_filing_claims', 'message': 'No claims ready for auto-filing'}
            
            # Send to Auto-Claims Generator
            # This would be an actual API call in production
            logger.info(f"📤 Sent {len(auto_filing_payload)} claims to Auto-Claims Generator")
            
            return {
                'status': 'success',
                'claims_sent': len(auto_filing_payload),
                'auto_filing_payload': auto_filing_payload
            }
            
        except Exception as e:
            logger.error(f"❌ Error sending claims to Auto-Claims Generator: {e}")
            return {'status': 'error', 'error': str(e)}
    
    async def update_payment_timeline_predictor(self, validation_results: List[ValidationResult]) -> Dict[str, Any]:
        """
        Update Payment Timeline Predictor with validation results
        
        PTP needs EV outputs because it depends on confirmed valid claims
        """
        try:
            logger.info(f"⏰ Updating Payment Timeline Predictor with {len(validation_results)} validation results")
            
            # Prepare PTP update payload
            ptp_payload = []
            for result in validation_results:
                ptp_payload.append({
                    'claim_id': result.claim_id,
                    'validation_status': result.validation_status.value,
                    'overall_score': result.overall_score,
                    'evidence_completeness': result.evidence_completeness.value,
                    'compliance_status': result.compliance_status.value,
                    'estimated_processing_time': self._estimate_processing_time(result),
                    'confidence_level': self._calculate_confidence_level(result),
                    'update_timestamp': datetime.utcnow().isoformat()
                })
            
            # Send to Payment Timeline Predictor
            # This would be an actual API call in production
            logger.info(f"📤 Updated Payment Timeline Predictor with {len(ptp_payload)} results")
            
            return {
                'status': 'success',
                'ptp_updates': len(ptp_payload),
                'ptp_payload': ptp_payload
            }
            
        except Exception as e:
            logger.error(f"❌ Error updating Payment Timeline Predictor: {e}")
            return {'status': 'error', 'error': str(e)}
    
    async def update_reimbursement_optimizer(self, validation_results: List[ValidationResult]) -> Dict[str, Any]:
        """
        Update Reimbursement Optimizer with evidence quality metrics
        
        RO needs EV outputs for optimal reimbursement strategies
        """
        try:
            logger.info(f"💰 Updating Reimbursement Optimizer with {len(validation_results)} validation results")
            
            # Prepare RO update payload
            ro_payload = []
            for result in validation_results:
                ro_payload.append({
                    'claim_id': result.claim_id,
                    'evidence_quality_metrics': {
                        'completeness_score': result.completeness_score,
                        'ml_validity_score': result.ml_validity_score,
                        'format_compliance_score': result.format_compliance_score,
                        'time_compliance_score': result.time_compliance_score
                    },
                    'optimization_recommendations': result.recommendations,
                    'risk_assessment': self._assess_risk_level(result),
                    'update_timestamp': datetime.utcnow().isoformat()
                })
            
            # Send to Reimbursement Optimizer
            # This would be an actual API call in production
            logger.info(f"📤 Updated Reimbursement Optimizer with {len(ro_payload)} results")
            
            return {
                'status': 'success',
                'ro_updates': len(ro_payload),
                'ro_payload': ro_payload
            }
            
        except Exception as e:
            logger.error(f"❌ Error updating Reimbursement Optimizer: {e}")
            return {'status': 'error', 'error': str(e)}
    
    async def update_claim_prioritization_model(self, validation_results: List[ValidationResult], claims: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Update Claim Prioritization Model with validation results
        
        CPM works best when CDM + EV are integrated (probability of success × claim value)
        """
        try:
            logger.info(f"🎯 Updating Claim Prioritization Model with {len(validation_results)} validation results")
            
            # Prepare CPM update payload
            cpm_payload = []
            for result in validation_results:
                # Find corresponding claim data
                claim = next((c for c in claims if c.get('claim_id') == result.claim_id), {})
                
                # Calculate priority score: success probability × claim value
                success_probability = result.overall_score
                claim_value = float(claim.get('metadata', {}).get('claim_amount', 0))
                priority_score = success_probability * claim_value
                
                cpm_payload.append({
                    'claim_id': result.claim_id,
                    'priority_score': priority_score,
                    'success_probability': success_probability,
                    'claim_value': claim_value,
                    'validation_confidence': result.overall_score,
                    'evidence_quality': result.completeness_score,
                    'compliance_status': result.compliance_status.value,
                    'priority_ranking': 0,  # Will be set by CPM
                    'update_timestamp': datetime.utcnow().isoformat()
                })
            
            # Sort by priority score (highest first)
            cpm_payload.sort(key=lambda x: x['priority_score'], reverse=True)
            
            # Add ranking
            for i, item in enumerate(cpm_payload):
                item['priority_ranking'] = i + 1
            
            # Send to Claim Prioritization Model
            # This would be an actual API call in production
            logger.info(f"📤 Updated Claim Prioritization Model with {len(cpm_payload)} results")
            
            return {
                'status': 'success',
                'cpm_updates': len(cpm_payload),
                'cpm_payload': cpm_payload
            }
            
        except Exception as e:
            logger.error(f"❌ Error updating Claim Prioritization Model: {e}")
            return {'status': 'error', 'error': str(e)}
    
    def _create_evidence_summary(self, evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Create summary of evidence for auto-filing"""
        if not evidence:
            return {'count': 0, 'types': [], 'total_size_mb': 0}
        
        evidence_types = list(set(ev.get('evidence_type', 'unknown') for ev in evidence))
        total_size = sum(ev.get('file_size_mb', 0) for ev in evidence)
        
        return {
            'count': len(evidence),
            'types': evidence_types,
            'total_size_mb': total_size,
            'quality_score': sum(ev.get('quality_score', 0.8) for ev in evidence) / len(evidence)
        }
    
    def _estimate_processing_time(self, validation_result: ValidationResult) -> str:
        """Estimate processing time based on validation result"""
        if validation_result.overall_score >= 0.9:
            return "1-3 business days"
        elif validation_result.overall_score >= 0.8:
            return "3-5 business days"
        elif validation_result.overall_score >= 0.7:
            return "5-7 business days"
        else:
            return "7-10 business days"
    
    def _calculate_confidence_level(self, validation_result: ValidationResult) -> str:
        """Calculate confidence level for timeline prediction"""
        if validation_result.overall_score >= 0.9:
            return "high"
        elif validation_result.overall_score >= 0.8:
            return "medium-high"
        elif validation_result.overall_score >= 0.7:
            return "medium"
        else:
            return "low"
    
    def _assess_risk_level(self, validation_result: ValidationResult) -> str:
        """Assess risk level for reimbursement optimization"""
        if validation_result.overall_score >= 0.9:
            return "low"
        elif validation_result.overall_score >= 0.8:
            return "low-medium"
        elif validation_result.overall_score >= 0.7:
            return "medium"
        elif validation_result.overall_score >= 0.6:
            return "medium-high"
        else:
            return "high"
    
    def get_integration_metrics(self) -> Dict[str, Any]:
        """Get integration performance metrics"""
        return {
            **self.integration_metrics,
            'validation_metrics': self.evidence_validator.get_validation_metrics(),
            'integration_timestamp': datetime.utcnow().isoformat()
        }
    
    def set_callbacks(self, 
                     on_validation_complete: Optional[Callable] = None,
                     on_auto_filing_ready: Optional[Callable] = None,
                     on_validation_failed: Optional[Callable] = None):
        """Set callback functions for real-time integration"""
        self.on_validation_complete = on_validation_complete
        self.on_auto_filing_ready = on_auto_filing_ready
        self.on_validation_failed = on_validation_failed
        
        logger.info("🔗 Integration callbacks configured")
