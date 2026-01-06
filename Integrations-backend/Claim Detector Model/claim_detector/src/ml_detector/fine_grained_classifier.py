#!/usr/bin/env python3
"""
Fine-Grained Claim Classifier for Claim Detector v2.0
Classifies claims by type and identifies required evidence for each claim type
"""

import logging
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
import pickle
import json
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from src.rules_engine.rules_engine import ClaimData
from src.data_collection.rejection_normalizer import NormalizedRejection

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class ClaimClassification:
    """Fine-grained claim classification result"""
    claim_types: Dict[str, float]  # Claim type -> probability
    primary_claim_type: str  # Highest probability claim type
    required_evidence: List[str]  # List of required evidence
    claimability_score: float  # Overall claimability score (0-1)
    confidence_level: str  # 'high', 'medium', 'low'
    subcategory: Optional[str] = None
    risk_factors: List[str] = None
    recommendations: List[str] = None

@dataclass
class EvidenceRequirement:
    """Evidence requirement for a claim type"""
    evidence_type: str
    description: str
    is_required: bool
    alternatives: List[str] = None
    format_requirements: str = None
    time_constraints: str = None

class FineGrainedClassifier:
    """Multi-label classifier for fine-grained claim classification"""
    
    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path
        self.model = None
        self.feature_columns = []
        self.is_loaded = False
        
        # Standard claim types for Amazon FBA
        self.claim_types = [
            "lost", "damaged", "fee_error", "missing_reimbursement",
            "inventory_adjustment", "warehouse_damage", "shipping_error",
            "customer_return", "quality_issue", "packaging_damage",
            "expired_product", "recalled_product", "counterfeit_item"
        ]
        
        # Evidence requirements mapping
        self.evidence_requirements = self._load_evidence_mapping()
        
        # Load model if path provided
        if model_path:
            self.load_model(model_path)
    
    def _load_evidence_mapping(self) -> Dict[str, List[EvidenceRequirement]]:
        """Load evidence requirements for each claim type"""
        return {
            "lost": [
                EvidenceRequirement(
                    evidence_type="tracking_proof",
                    description="Proof of shipment and tracking information",
                    is_required=True,
                    alternatives=["carrier confirmation", "delivery confirmation"],
                    format_requirements="Digital or physical documentation",
                    time_constraints="Within 30 days of expected delivery"
                ),
                EvidenceRequirement(
                    evidence_type="invoice",
                    description="Original purchase invoice",
                    is_required=True,
                    alternatives=["purchase_order", "receipt"],
                    format_requirements="Clear, legible copy",
                    time_constraints="From original purchase"
                ),
                EvidenceRequirement(
                    evidence_type="packing_list",
                    description="Itemized packing list",
                    is_required=False,
                    alternatives=["shipping manifest", "inventory list"],
                    format_requirements="Detailed item list",
                    time_constraints="From shipment date"
                )
            ],
            
            "damaged": [
                EvidenceRequirement(
                    evidence_type="photos",
                    description="Clear photos of damage",
                    is_required=True,
                    alternatives=["video documentation", "damage report"],
                    format_requirements="High resolution, multiple angles",
                    time_constraints="Within 24 hours of discovery"
                ),
                EvidenceRequirement(
                    evidence_type="damage_report",
                    description="Detailed damage description",
                    is_required=True,
                    alternatives=["inspection report", "condition report"],
                    format_requirements="Written description with photos",
                    time_constraints="Within 48 hours of discovery"
                ),
                EvidenceRequirement(
                    evidence_type="inspection_certificate",
                    description="Professional inspection certificate",
                    is_required=False,
                    alternatives=["expert opinion", "assessment report"],
                    format_requirements="From qualified professional",
                    time_constraints="Within 7 days of discovery"
                )
            ],
            
            "fee_error": [
                EvidenceRequirement(
                    evidence_type="fee_statement",
                    description="Original fee statement or invoice",
                    is_required=True,
                    alternatives=["billing statement", "charge receipt"],
                    format_requirements="Clear fee breakdown",
                    time_constraints="From billing period"
                ),
                EvidenceRequirement(
                    evidence_type="calculation_proof",
                    description="Proof of incorrect calculation",
                    is_required=True,
                    alternatives=["comparison analysis", "error documentation"],
                    format_requirements="Detailed calculation breakdown",
                    time_constraints="From fee assessment date"
                ),
                EvidenceRequirement(
                    evidence_type="policy_reference",
                    description="Relevant policy documentation",
                    is_required=False,
                    alternatives=["terms_of_service", "fee_schedule"],
                    format_requirements="Official policy document",
                    time_constraints="Current version"
                )
            ],
            
            "missing_reimbursement": [
                EvidenceRequirement(
                    evidence_type="payment_history",
                    description="Complete payment history",
                    is_required=True,
                    alternatives=["transaction log", "account statement"],
                    format_requirements="Detailed payment records",
                    time_constraints="From claim period"
                ),
                EvidenceRequirement(
                    evidence_type="claim_history",
                    description="Previous claim submissions",
                    is_required=True,
                    alternatives=["claim_tracking", "submission_records"],
                    format_requirements="Claim reference numbers",
                    time_constraints="From original claim date"
                ),
                EvidenceRequirement(
                    evidence_type="account_statement",
                    description="Current account balance",
                    is_required=False,
                    alternatives=["balance_confirmation", "financial_summary"],
                    format_requirements="Official statement",
                    time_constraints="Current as of claim date"
                )
            ],
            
            "inventory_adjustment": [
                EvidenceRequirement(
                    evidence_type="inventory_report",
                    description="Current inventory levels",
                    is_required=True,
                    alternatives=["stock_count", "inventory_audit"],
                    format_requirements="Detailed item counts",
                    time_constraints="From adjustment date"
                ),
                EvidenceRequirement(
                    evidence_type="adjustment_reason",
                    description="Reason for inventory adjustment",
                    is_required=True,
                    alternatives=["justification_document", "explanation_letter"],
                    format_requirements="Clear explanation",
                    time_constraints="Within 7 days of adjustment"
                )
            ],
            
            "warehouse_damage": [
                EvidenceRequirement(
                    evidence_type="warehouse_report",
                    description="Warehouse incident report",
                    is_required=True,
                    alternatives=["incident_log", "damage_notification"],
                    format_requirements="Official warehouse documentation",
                    time_constraints="Within 24 hours of incident"
                ),
                EvidenceRequirement(
                    evidence_type="damage_assessment",
                    description="Professional damage assessment",
                    is_required=True,
                    alternatives=["inspection_report", "evaluation_document"],
                    format_requirements="From qualified inspector",
                    time_constraints="Within 48 hours of incident"
                )
            ],
            
            "shipping_error": [
                EvidenceRequirement(
                    evidence_type="shipping_documentation",
                    description="Complete shipping records",
                    is_required=True,
                    alternatives=["carrier_documentation", "tracking_records"],
                    format_requirements="All shipping paperwork",
                    time_constraints="From shipment date"
                ),
                EvidenceRequirement(
                    evidence_type="error_description",
                    description="Description of shipping error",
                    is_required=True,
                    alternatives=["incident_report", "error_documentation"],
                    format_requirements="Detailed error explanation",
                    time_constraints="Within 24 hours of discovery"
                )
            ],
            
            "customer_return": [
                EvidenceRequirement(
                    evidence_type="return_authorization",
                    description="Return authorization number",
                    is_required=True,
                    alternatives=["return_label", "return_approval"],
                    format_requirements="Official return documentation",
                    time_constraints="From return request date"
                ),
                EvidenceRequirement(
                    evidence_type="return_reason",
                    description="Customer return reason",
                    is_required=True,
                    alternatives=["return_form", "reason_documentation"],
                    format_requirements="Customer-provided reason",
                    time_constraints="From return submission"
                )
            ],
            
            "quality_issue": [
                EvidenceRequirement(
                    evidence_type="quality_report",
                    description="Quality inspection report",
                    is_required=True,
                    alternatives=["inspection_certificate", "quality_assessment"],
                    format_requirements="From qualified inspector",
                    time_constraints="Within 7 days of discovery"
                ),
                EvidenceRequirement(
                    evidence_type="sample_evidence",
                    description="Physical sample of issue",
                    is_required=False,
                    alternatives=["photo_documentation", "video_evidence"],
                    format_requirements="Clear visual evidence",
                    time_constraints="Within 24 hours of discovery"
                )
            ],
            
            "packaging_damage": [
                EvidenceRequirement(
                    evidence_type="packaging_photos",
                    description="Photos of damaged packaging",
                    is_required=True,
                    alternatives=["packaging_video", "damage_documentation"],
                    format_requirements="Multiple angle photos",
                    time_constraints="Within 24 hours of discovery"
                ),
                EvidenceRequirement(
                    evidence_type="packaging_specs",
                    description="Original packaging specifications",
                    is_required=False,
                    alternatives=["packaging_requirements", "specification_document"],
                    format_requirements="Official specifications",
                    time_constraints="From product documentation"
                )
            ],
            
            "expired_product": [
                EvidenceRequirement(
                    evidence_type="expiration_dates",
                    description="Product expiration dates",
                    is_required=True,
                    alternatives=["date_documentation", "expiry_proof"],
                    format_requirements="Clear date information",
                    time_constraints="From product receipt"
                ),
                EvidenceRequirement(
                    evidence_type="storage_conditions",
                    description="Storage condition documentation",
                    is_required=False,
                    alternatives=["temperature_logs", "environmental_records"],
                    format_requirements="Environmental monitoring data",
                    time_constraints="From storage period"
                )
            ],
            
            "recalled_product": [
                EvidenceRequirement(
                    evidence_type="recall_notice",
                    description="Official recall notice",
                    is_required=True,
                    alternatives=["recall_announcement", "safety_notice"],
                    format_requirements="From manufacturer or authority",
                    time_constraints="From recall date"
                ),
                EvidenceRequirement(
                    evidence_type="affected_lot",
                    description="Affected lot numbers",
                    is_required=True,
                    alternatives=["batch_numbers", "serial_numbers"],
                    format_requirements="Clear lot identification",
                    time_constraints="From recall notice"
                )
            ],
            
            "counterfeit_item": [
                EvidenceRequirement(
                    evidence_type="authenticity_proof",
                    description="Proof of authenticity",
                    is_required=True,
                    alternatives=["certificate_of_authenticity", "verification_document"],
                    format_requirements="Official authenticity document",
                    time_constraints="From purchase date"
                ),
                EvidenceRequirement(
                    evidence_type="counterfeit_evidence",
                    description="Evidence of counterfeit nature",
                    is_required=True,
                    alternatives=["comparison_analysis", "expert_opinion"],
                    format_requirements="Professional assessment",
                    time_constraints="Within 7 days of discovery"
                )
            ]
        }
    
    def load_model(self, model_path: str) -> bool:
        """Load a trained classification model"""
        try:
            if Path(model_path).exists():
                with open(model_path, 'rb') as f:
                    model_data = pickle.load(f)
                    
                self.model = model_data.get('model')
                self.feature_columns = model_data.get('feature_columns', [])
                self.is_loaded = True
                
                logger.info(f"✅ Model loaded from {model_path} with {len(self.feature_columns)} features")
                return True
            else:
                logger.warning(f"⚠️ Model file not found: {model_path}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error loading model: {e}")
            return False
    
    def classify_claim(self, claim_data: ClaimData, normalized_rejection: Optional[NormalizedRejection] = None) -> ClaimClassification:
        """Classify claim by type and identify required evidence"""
        try:
            # If model is loaded, use it for classification
            if self.model and self.is_loaded:
                claim_type_probs = self._predict_with_model(claim_data)
            else:
                # Use rule-based classification as fallback
                claim_type_probs = self._rule_based_classification(claim_data, normalized_rejection)
            
            # Get primary claim type
            primary_claim_type = max(claim_type_probs.items(), key=lambda x: x[1])[0]
            
            # Get required evidence
            required_evidence = self._get_required_evidence(primary_claim_type, claim_data)
            
            # Calculate claimability score
            claimability_score = self._calculate_claimability_score(claim_data, claim_type_probs)
            
            # Determine confidence level
            confidence_level = self._determine_confidence_level(claimability_score)
            
            # Get risk factors and recommendations
            risk_factors = self._identify_risk_factors(claim_data, primary_claim_type)
            recommendations = self._generate_recommendations(claim_data, primary_claim_type, claimability_score)
            
            return ClaimClassification(
                claim_types=claim_type_probs,
                primary_claim_type=primary_claim_type,
                required_evidence=required_evidence,
                claimability_score=claimability_score,
                confidence_level=confidence_level,
                risk_factors=risk_factors,
                recommendations=recommendations
            )
            
        except Exception as e:
            logger.error(f"❌ Error classifying claim: {e}")
            # Return default classification
            return self._get_default_classification(claim_data)
    
    def _predict_with_model(self, claim_data: ClaimData) -> Dict[str, float]:
        """Predict claim types using loaded ML model"""
        try:
            # Prepare features for model
            features = self._prepare_features(claim_data)
            
            # Make prediction
            if hasattr(self.model, 'predict_proba'):
                probabilities = self.model.predict_proba(features)
                # Assuming model returns probabilities for each claim type
                claim_type_probs = dict(zip(self.claim_types, probabilities[0]))
            else:
                # Fallback for models without predict_proba
                prediction = self.model.predict(features)
                claim_type_probs = {claim_type: 1.0 if claim_type == prediction[0] else 0.0 
                                  for claim_type in self.claim_types}
            
            return claim_type_probs
            
        except Exception as e:
            logger.error(f"❌ Error in model prediction: {e}")
            return self._rule_based_classification(claim_data, None)
    
    def _rule_based_classification(self, claim_data: ClaimData, normalized_rejection: Optional[NormalizedRejection]) -> Dict[str, float]:
        """Rule-based classification when ML model is not available"""
        claim_type_probs = {claim_type: 0.0 for claim_type in self.claim_types}
        
        # Basic rule-based classification
        if claim_data.claim_type:
            # If claim type is already provided, give it high probability
            claim_type_probs[claim_data.claim_type] = 0.8
            
            # Add some probability to related types
            if claim_data.claim_type == "lost":
                claim_type_probs["inventory_adjustment"] = 0.3
            elif claim_data.claim_type == "damaged":
                claim_type_probs["warehouse_damage"] = 0.4
                claim_type_probs["shipping_error"] = 0.3
            elif claim_data.claim_type == "fee_error":
                claim_type_probs["missing_reimbursement"] = 0.3
        
        # Use rejection normalization if available
        if normalized_rejection:
            if normalized_rejection.category == "missing_invoice":
                claim_type_probs["lost"] += 0.2
                claim_type_probs["damaged"] += 0.1
            elif normalized_rejection.category == "insufficient_evidence":
                claim_type_probs["damaged"] += 0.3
                claim_type_probs["quality_issue"] += 0.2
            elif normalized_rejection.category == "timeframe_expired":
                claim_type_probs["expired_product"] += 0.4
                claim_type_probs["inventory_adjustment"] += 0.2
        
        # Normalize probabilities
        total_prob = sum(claim_type_probs.values())
        if total_prob > 0:
            claim_type_probs = {k: v / total_prob for k, v in claim_type_probs.items()}
        
        return claim_type_probs
    
    def _prepare_features(self, claim_data: ClaimData) -> np.ndarray:
        """Prepare features for ML model prediction"""
        # This is a placeholder - in real implementation, this would:
        # 1. Extract features from claim_data
        # 2. Apply feature engineering
        # 3. Ensure feature order matches training data
        
        # For now, return dummy features
        dummy_features = np.zeros((1, len(self.feature_columns) if self.feature_columns else 10))
        return dummy_features
    
    def _get_required_evidence(self, claim_type: str, claim_data: ClaimData) -> List[str]:
        """Get required evidence for a specific claim type"""
        evidence_list = []
        
        if claim_type in self.evidence_requirements:
            for requirement in self.evidence_requirements[claim_type]:
                if requirement.is_required:
                    evidence_list.append(requirement.evidence_type)
        
        # Add context-specific evidence requirements
        if claim_data.amount_requested and claim_data.amount_requested > 1000:
            evidence_list.append("manager_approval")
        
        if claim_data.days_since_shipment and claim_data.days_since_shipment > 365:
            evidence_list.append("age_justification")
        
        # Remove duplicates while preserving order
        seen = set()
        unique_evidence = []
        for evidence in evidence_list:
            if evidence not in seen:
                seen.add(evidence)
                unique_evidence.append(evidence)
        
        return unique_evidence
    
    def _calculate_claimability_score(self, claim_data: ClaimData, claim_type_probs: Dict[str, float]) -> float:
        """Calculate overall claimability score"""
        base_score = 0.0
        
        # Score from claim type probabilities
        if claim_type_probs:
            max_prob = max(claim_type_probs.values())
            base_score += max_prob * 0.4  # 40% weight for type confidence
        
        # Score from amount (higher amounts may be more scrutinized)
        if claim_data.amount_requested:
            if claim_data.amount_requested < 100:
                base_score += 0.1  # Small claims often easier
            elif claim_data.amount_requested > 1000:
                base_score -= 0.1  # Large claims more scrutinized
        
        # Score from time sensitivity
        if claim_data.days_since_shipment:
            if claim_data.days_since_shipment < 30:
                base_score += 0.1  # Recent claims easier
            elif claim_data.days_since_shipment > 365:
                base_score -= 0.3  # Old claims harder
        
        # Score from evidence availability
        if claim_data.evidence_attached:
            base_score += 0.2
        
        # Normalize to 0-1 range
        return max(0.0, min(1.0, base_score))
    
    def _determine_confidence_level(self, claimability_score: float) -> str:
        """Determine confidence level based on claimability score"""
        if claimability_score >= 0.7:
            return "high"
        elif claimability_score >= 0.4:
            return "medium"
        else:
            return "low"
    
    def _identify_risk_factors(self, claim_data: ClaimData, primary_claim_type: str) -> List[str]:
        """Identify risk factors for the claim"""
        risk_factors = []
        
        # Time-based risks
        if claim_data.days_since_shipment and claim_data.days_since_shipment > 365:
            risk_factors.append("Claim submitted beyond 18-month timeframe")
        
        # Amount-based risks
        if claim_data.amount_requested and claim_data.amount_requested > 1000:
            risk_factors.append("High-value claim requiring additional review")
        
        # Evidence-based risks
        if not claim_data.evidence_attached:
            risk_factors.append("No evidence attached to claim")
        
        # Claim type specific risks
        if primary_claim_type == "expired_product":
            risk_factors.append("Product expiration may limit claim eligibility")
        elif primary_claim_type == "counterfeit_item":
            risk_factors.append("Counterfeit claims require extensive documentation")
        
        return risk_factors
    
    def _generate_recommendations(self, claim_data: ClaimData, primary_claim_type: str, claimability_score: float) -> List[str]:
        """Generate recommendations for improving claim success"""
        recommendations = []
        
        # Evidence recommendations
        required_evidence = self._get_required_evidence(primary_claim_type, claim_data)
        if required_evidence:
            recommendations.append(f"Ensure all required evidence is provided: {', '.join(required_evidence)}")
        
        # Time-based recommendations
        if claim_data.days_since_shipment and claim_data.days_since_shipment > 365:
            recommendations.append("Consider requesting policy exception for timeframe extension")
        
        # Amount-based recommendations
        if claim_data.amount_requested and claim_data.amount_requested > 1000:
            recommendations.append("Obtain manager approval for high-value claim")
        
        # General recommendations
        if claimability_score < 0.4:
            recommendations.append("Consider consulting with claims specialist before submission")
        elif claimability_score > 0.7:
            recommendations.append("Claim appears strong - proceed with submission")
        
        return recommendations
    
    def _get_default_classification(self, claim_data: ClaimData) -> ClaimClassification:
        """Get default classification when errors occur"""
        return ClaimClassification(
            claim_types={"unknown": 1.0},
            primary_claim_type="unknown",
            required_evidence=["general_documentation"],
            claimability_score=0.0,
            confidence_level="low",
            risk_factors=["Classification error occurred"],
            recommendations=["Contact support for assistance"]
        )
    
    def get_evidence_details(self, claim_type: str) -> List[EvidenceRequirement]:
        """Get detailed evidence requirements for a claim type"""
        return self.evidence_requirements.get(claim_type, [])
    
    def add_custom_evidence_requirement(self, claim_type: str, evidence_requirement: EvidenceRequirement):
        """Add custom evidence requirement for a claim type"""
        if claim_type not in self.evidence_requirements:
            self.evidence_requirements[claim_type] = []
        
        self.evidence_requirements[claim_type].append(evidence_requirement)
        logger.info(f"✅ Added custom evidence requirement for {claim_type}: {evidence_requirement.evidence_type}")
    
    def get_classification_summary(self) -> Dict[str, Any]:
        """Get summary of classification capabilities"""
        return {
            "total_claim_types": len(self.claim_types),
            "claim_types": self.claim_types,
            "model_loaded": self.is_loaded,
            "feature_count": len(self.feature_columns),
            "evidence_requirements": {
                claim_type: len(requirements) 
                for claim_type, requirements in self.evidence_requirements.items()
            }
        }


