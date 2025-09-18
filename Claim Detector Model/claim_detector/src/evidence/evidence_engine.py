#!/usr/bin/env python3
"""
Evidence Requirement Engine for Claim Detector v2.0
Manages and validates evidence requirements for different claim types
"""

import logging
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from src.rules_engine.rules_engine import ClaimData
from src.ml_detector.fine_grained_classifier import EvidenceRequirement

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class EvidenceValidation:
    """Result of evidence validation"""
    evidence_type: str
    is_valid: bool
    validation_score: float  # 0-1 score
    issues: List[str]
    recommendations: List[str]
    format_compliance: bool
    time_compliance: bool
    completeness: bool

@dataclass
class EvidenceBundle:
    """Collection of evidence for a claim"""
    claim_id: str
    evidence_items: List[Dict[str, Any]]
    total_evidence_count: int
    required_evidence_count: int
    optional_evidence_count: int
    validation_score: float
    missing_required: List[str]
    missing_optional: List[str]
    bundle_status: str  # 'complete', 'incomplete', 'pending'

class EvidenceEngine:
    """Engine for managing and validating evidence requirements"""
    
    def __init__(self, evidence_rules_file: Optional[str] = None):
        self.evidence_rules_file = evidence_rules_file or "evidence_rules.json"
        self.evidence_rules = self._load_evidence_rules()
        self.validation_thresholds = {
            "format_compliance": 0.8,
            "time_compliance": 0.9,
            "completeness": 0.7,
            "overall": 0.75
        }
        
        # Evidence format validators
        self.format_validators = {
            "invoice": self._validate_invoice_format,
            "photos": self._validate_photo_format,
            "tracking_proof": self._validate_tracking_format,
            "damage_report": self._validate_damage_report_format,
            "packing_list": self._validate_packing_list_format
        }
    
    def _load_evidence_rules(self) -> Dict[str, Any]:
        """Load evidence validation rules from file"""
        try:
            if Path(self.evidence_rules_file).exists():
                with open(self.evidence_rules_file, 'r') as f:
                    rules = json.load(f)
                    logger.info(f"✅ Evidence rules loaded from {self.evidence_rules_file}")
                    return rules
            else:
                logger.info(f"⚠️ Evidence rules file not found: {self.evidence_rules_file}, using defaults")
                return self._get_default_evidence_rules()
        except Exception as e:
            logger.error(f"❌ Error loading evidence rules: {e}, using defaults")
            return self._get_default_evidence_rules()
    
    def _get_default_evidence_rules(self) -> Dict[str, Any]:
        """Get default evidence validation rules"""
        return {
            "format_requirements": {
                "invoice": {
                    "required_fields": ["invoice_number", "date", "amount", "vendor"],
                    "file_types": ["pdf", "jpg", "png"],
                    "max_file_size_mb": 10,
                    "quality_requirements": "Clear, legible copy"
                },
                "photos": {
                    "required_fields": ["timestamp", "location", "damage_visible"],
                    "file_types": ["jpg", "png", "heic"],
                    "max_file_size_mb": 25,
                    "quality_requirements": "High resolution, multiple angles",
                    "min_resolution": "1920x1080"
                },
                "tracking_proof": {
                    "required_fields": ["tracking_number", "carrier", "status", "dates"],
                    "file_types": ["pdf", "jpg", "png", "txt"],
                    "max_file_size_mb": 5,
                    "quality_requirements": "Clear tracking information"
                },
                "damage_report": {
                    "required_fields": ["description", "date_discovered", "extent_of_damage"],
                    "file_types": ["pdf", "doc", "docx", "txt"],
                    "max_file_size_mb": 15,
                    "quality_requirements": "Detailed damage description"
                },
                "packing_list": {
                    "required_fields": ["item_list", "quantities", "packing_date"],
                    "file_types": ["pdf", "xlsx", "csv", "txt"],
                    "max_file_size_mb": 10,
                    "quality_requirements": "Clear item breakdown"
                }
            },
            "time_constraints": {
                "invoice": 365,  # days from purchase
                "photos": 7,     # days from discovery
                "tracking_proof": 30,  # days from expected delivery
                "damage_report": 48,   # hours from discovery
                "packing_list": 90     # days from shipment
            },
            "quality_thresholds": {
                "min_file_size_kb": 10,
                "max_file_size_mb": 25,
                "required_format_compliance": 0.8,
                "required_time_compliance": 0.9
            }
        }
    
    def get_evidence_requirements(self, claim_type: str, claim_data: ClaimData) -> List[str]:
        """Get required evidence based on claim type and context"""
        # Import here to avoid circular imports
        from src.ml_detector.fine_grained_classifier import FineGrainedClassifier
        
        classifier = FineGrainedClassifier()
        base_evidence = classifier._get_required_evidence(claim_type, claim_data)
        
        # Add context-specific requirements
        if claim_data.amount_requested and claim_data.amount_requested > 1000:
            base_evidence.append("manager_approval")
        
        if claim_data.days_since_shipment and claim_data.days_since_shipment > 365:
            base_evidence.append("age_justification")
        
        # Add marketplace-specific requirements
        if claim_data.marketplace and claim_data.marketplace != "US":
            base_evidence.append("local_compliance_documentation")
        
        return list(set(base_evidence))  # Remove duplicates
    
    def validate_evidence(self, evidence_data: Dict[str, Any], evidence_type: str) -> EvidenceValidation:
        """Validate individual evidence item"""
        try:
            validation = EvidenceValidation(
                evidence_type=evidence_type,
                is_valid=True,
                validation_score=0.0,
                issues=[],
                recommendations=[],
                format_compliance=False,
                time_compliance=False,
                completeness=False
            )
            
            # Check if evidence type has specific validation rules
            if evidence_type in self.evidence_rules["format_requirements"]:
                format_rules = self.evidence_rules["format_requirements"][evidence_type]
                
                # Validate format compliance
                format_score, format_issues = self._validate_format_compliance(evidence_data, format_rules)
                validation.format_compliance = format_score >= self.validation_thresholds["format_compliance"]
                
                if format_issues:
                    validation.issues.extend(format_issues)
                
                # Validate time compliance
                time_score, time_issues = self._validate_time_compliance(evidence_data, evidence_type)
                validation.time_compliance = time_score >= self.validation_thresholds["time_compliance"]
                
                if time_issues:
                    validation.issues.extend(time_issues)
                
                # Validate completeness
                completeness_score, completeness_issues = self._validate_completeness(evidence_data, format_rules)
                validation.completeness = completeness_score >= self.validation_thresholds["completeness"]
                
                if completeness_issues:
                    validation.issues.extend(completeness_issues)
                
                # Calculate overall validation score
                validation.validation_score = (format_score + time_score + completeness_score) / 3
                validation.is_valid = validation.validation_score >= self.validation_thresholds["overall"]
                
                # Generate recommendations
                validation.recommendations = self._generate_validation_recommendations(
                    evidence_data, evidence_type, validation
                )
            
            return validation
            
        except Exception as e:
            logger.error(f"❌ Error validating evidence: {e}")
            return EvidenceValidation(
                evidence_type=evidence_type,
                is_valid=False,
                validation_score=0.0,
                issues=[f"Validation error: {e}"],
                recommendations=["Contact support for assistance"],
                format_compliance=False,
                time_compliance=False,
                completeness=False
            )
    
    def _validate_format_compliance(self, evidence_data: Dict[str, Any], format_rules: Dict[str, Any]) -> Tuple[float, List[str]]:
        """Validate format compliance of evidence"""
        score = 0.0
        issues = []
        
        try:
            # Check file type
            if "file_type" in evidence_data:
                file_type = evidence_data["file_type"].lower()
                if file_type not in format_rules["file_types"]:
                    issues.append(f"Invalid file type: {file_type}. Allowed: {', '.join(format_rules['file_types'])}")
                    score -= 0.3
                else:
                    score += 0.3
            
            # Check file size
            if "file_size_mb" in evidence_data:
                file_size = evidence_data["file_size_mb"]
                max_size = format_rules["max_file_size_mb"]
                if file_size > max_size:
                    issues.append(f"File size {file_size}MB exceeds maximum {max_size}MB")
                    score -= 0.2
                else:
                    score += 0.2
            
            # Check required fields
            if "required_fields" in format_rules:
                required_fields = format_rules["required_fields"]
                present_fields = evidence_data.get("fields", [])
                missing_fields = [field for field in required_fields if field not in present_fields]
                
                if missing_fields:
                    issues.append(f"Missing required fields: {', '.join(missing_fields)}")
                    score -= 0.3
                else:
                    score += 0.3
            
            # Check quality requirements
            if "quality_requirements" in format_rules:
                quality_met = evidence_data.get("quality_met", False)
                if not quality_met:
                    issues.append(f"Quality requirements not met: {format_rules['quality_requirements']}")
                    score -= 0.2
                else:
                    score += 0.2
            
            # Normalize score to 0-1 range
            score = max(0.0, min(1.0, score))
            
        except Exception as e:
            issues.append(f"Format validation error: {e}")
            score = 0.0
        
        return score, issues
    
    def _validate_time_compliance(self, evidence_data: Dict[str, Any], evidence_type: str) -> Tuple[float, List[str]]:
        """Validate time compliance of evidence"""
        score = 0.0
        issues = []
        
        try:
            if evidence_type in self.evidence_rules["time_constraints"]:
                max_days = self.evidence_rules["time_constraints"][evidence_type]
                
                # Check evidence date
                if "evidence_date" in evidence_data:
                    evidence_date = datetime.fromisoformat(evidence_data["evidence_date"])
                    current_date = datetime.now()
                    days_old = (current_date - evidence_date).days
                    
                    if days_old > max_days:
                        issues.append(f"Evidence is {days_old} days old, exceeds {max_days} day limit")
                        score -= 0.5
                    else:
                        # Score based on how recent the evidence is
                        recency_score = max(0.0, 1.0 - (days_old / max_days))
                        score += recency_score
                else:
                    issues.append("Evidence date not provided")
                    score -= 0.3
            else:
                # No specific time constraints
                score = 1.0
            
            # Normalize score to 0-1 range
            score = max(0.0, min(1.0, score))
            
        except Exception as e:
            issues.append(f"Time validation error: {e}")
            score = 0.0
        
        return score, issues
    
    def _validate_completeness(self, evidence_data: Dict[str, Any], format_rules: Dict[str, Any]) -> Tuple[float, List[str]]:
        """Validate completeness of evidence"""
        score = 0.0
        issues = []
        
        try:
            # Check if all required fields are present
            if "required_fields" in format_rules:
                required_fields = format_rules["required_fields"]
                present_fields = evidence_data.get("fields", [])
                
                completeness_ratio = len([f for f in required_fields if f in present_fields]) / len(required_fields)
                score += completeness_ratio * 0.6
                
                if completeness_ratio < 1.0:
                    missing = [f for f in required_fields if f not in present_fields]
                    issues.append(f"Incomplete evidence: missing {', '.join(missing)}")
            
            # Check if evidence has sufficient detail
            if "description" in evidence_data:
                description = evidence_data["description"]
                if len(description) < 10:
                    issues.append("Evidence description too brief")
                    score -= 0.2
                else:
                    score += 0.2
            
            # Check if evidence is properly labeled
            if "label" in evidence_data and evidence_data["label"]:
                score += 0.2
            else:
                issues.append("Evidence not properly labeled")
                score -= 0.2
            
            # Normalize score to 0-1 range
            score = max(0.0, min(1.0, score))
            
        except Exception as e:
            issues.append(f"Completeness validation error: {e}")
            score = 0.0
        
        return score, issues
    
    def _generate_validation_recommendations(self, evidence_data: Dict[str, Any], evidence_type: str, validation: EvidenceValidation) -> List[str]:
        """Generate recommendations for improving evidence validation"""
        recommendations = []
        
        # Format recommendations
        if not validation.format_compliance:
            if evidence_type in self.evidence_rules["format_requirements"]:
                format_rules = self.evidence_rules["format_requirements"][evidence_type]
                recommendations.append(f"Ensure file type is one of: {', '.join(format_rules['file_types'])}")
                recommendations.append(f"Keep file size under {format_rules['max_file_size_mb']}MB")
        
        # Time recommendations
        if not validation.time_compliance:
            if evidence_type in self.evidence_rules["time_constraints"]:
                max_days = self.evidence_rules["time_constraints"][evidence_type]
                recommendations.append(f"Submit evidence within {max_days} days of event")
        
        # Completeness recommendations
        if not validation.completeness:
            if evidence_type in self.evidence_rules["format_requirements"]:
                required_fields = self.evidence_rules["format_requirements"][evidence_type].get("required_fields", [])
                recommendations.append(f"Ensure all required fields are provided: {', '.join(required_fields)}")
        
        # General recommendations
        if validation.validation_score < 0.5:
            recommendations.append("Consider resubmitting evidence with improvements")
        elif validation.validation_score < 0.8:
            recommendations.append("Evidence is acceptable but could be improved")
        
        return recommendations
    
    def validate_evidence_bundle(self, claim_id: str, evidence_items: List[Dict[str, Any]], required_evidence: List[str]) -> EvidenceBundle:
        """Validate a complete evidence bundle for a claim"""
        try:
            bundle = EvidenceBundle(
                claim_id=claim_id,
                evidence_items=evidence_items,
                total_evidence_count=len(evidence_items),
                required_evidence_count=0,
                optional_evidence_count=0,
                validation_score=0.0,
                missing_required=[],
                missing_optional=[],
                bundle_status="pending"
            )
            
            # Validate each evidence item
            validated_items = []
            total_score = 0.0
            
            for evidence_item in evidence_items:
                evidence_type = evidence_item.get("evidence_type", "unknown")
                validation = self.validate_evidence(evidence_item, evidence_type)
                validated_items.append({
                    "evidence": evidence_item,
                    "validation": validation
                })
                total_score += validation.validation_score
            
            # Calculate bundle statistics
            if validated_items:
                bundle.validation_score = total_score / len(validated_items)
            
            # Check required evidence coverage
            provided_evidence_types = [item["evidence"]["evidence_type"] for item in validated_items]
            bundle.missing_required = [evidence for evidence in required_evidence if evidence not in provided_evidence_types]
            bundle.required_evidence_count = len(required_evidence) - len(bundle.missing_required)
            
            # Count optional evidence
            bundle.optional_evidence_count = len([item for item in validated_items 
                                               if item["evidence"]["evidence_type"] not in required_evidence])
            
            # Determine bundle status
            if not bundle.missing_required and bundle.validation_score >= self.validation_thresholds["overall"]:
                bundle.bundle_status = "complete"
            elif bundle.missing_required:
                bundle.bundle_status = "incomplete"
            else:
                bundle.bundle_status = "pending"
            
            return bundle
            
        except Exception as e:
            logger.error(f"❌ Error validating evidence bundle: {e}")
            return EvidenceBundle(
                claim_id=claim_id,
                evidence_items=evidence_items,
                total_evidence_count=len(evidence_items),
                required_evidence_count=0,
                optional_evidence_count=0,
                validation_score=0.0,
                missing_required=required_evidence,
                missing_optional=[],
                bundle_status="error"
            )
    
    def get_evidence_template(self, evidence_type: str) -> Dict[str, Any]:
        """Get template for required evidence fields"""
        if evidence_type in self.evidence_rules["format_requirements"]:
            format_rules = self.evidence_rules["format_requirements"][evidence_type]
            return {
                "evidence_type": evidence_type,
                "required_fields": format_rules.get("required_fields", []),
                "file_types": format_rules.get("file_types", []),
                "max_file_size_mb": format_rules.get("max_file_size_mb", 10),
                "quality_requirements": format_rules.get("quality_requirements", ""),
                "time_constraints": self.evidence_rules["time_constraints"].get(evidence_type, "No specific time limit")
            }
        else:
            return {
                "evidence_type": evidence_type,
                "required_fields": ["description", "date", "source"],
                "file_types": ["pdf", "jpg", "png", "doc", "txt"],
                "max_file_size_mb": 10,
                "quality_requirements": "Clear, legible documentation",
                "time_constraints": "Submit as soon as possible"
            }
    
    def add_custom_evidence_rule(self, evidence_type: str, rule_data: Dict[str, Any]):
        """Add custom evidence validation rule"""
        if "format_requirements" not in self.evidence_rules:
            self.evidence_rules["format_requirements"] = {}
        
        self.evidence_rules["format_requirements"][evidence_type] = rule_data
        logger.info(f"✅ Added custom evidence rule for {evidence_type}")
    
    def save_evidence_rules(self, filepath: Optional[str] = None):
        """Save evidence rules to file"""
        filepath = filepath or self.evidence_rules_file
        
        try:
            with open(filepath, 'w') as f:
                json.dump(self.evidence_rules, f, indent=2)
            
            logger.info(f"✅ Evidence rules saved to {filepath}")
            
        except Exception as e:
            logger.error(f"❌ Error saving evidence rules: {e}")
    
    def get_evidence_summary(self) -> Dict[str, Any]:
        """Get summary of evidence validation capabilities"""
        return {
            "total_evidence_types": len(self.evidence_rules["format_requirements"]),
            "evidence_types": list(self.evidence_rules["format_requirements"].keys()),
            "validation_thresholds": self.validation_thresholds,
            "time_constraints": self.evidence_rules["time_constraints"],
            "quality_thresholds": self.evidence_rules["quality_thresholds"]
        }
    
    # Specific format validators
    def _validate_invoice_format(self, evidence_data: Dict[str, Any]) -> Tuple[float, List[str]]:
        """Validate invoice format specifically"""
        return self._validate_format_compliance(evidence_data, self.evidence_rules["format_requirements"]["invoice"])
    
    def _validate_photo_format(self, evidence_data: Dict[str, Any]) -> Tuple[float, List[str]]:
        """Validate photo format specifically"""
        return self._validate_format_compliance(evidence_data, self.evidence_rules["format_requirements"]["photos"])
    
    def _validate_tracking_format(self, evidence_data: Dict[str, Any]) -> Tuple[float, List[str]]:
        """Validate tracking proof format specifically"""
        return self._validate_format_compliance(evidence_data, self.evidence_rules["format_requirements"]["tracking_proof"])
    
    def _validate_damage_report_format(self, evidence_data: Dict[str, Any]) -> Tuple[float, List[str]]:
        """Validate damage report format specifically"""
        return self._validate_format_compliance(evidence_data, self.evidence_rules["format_requirements"]["damage_report"])
    
    def _validate_packing_list_format(self, evidence_data: Dict[str, Any]) -> Tuple[float, List[str]]:
        """Validate packing list format specifically"""
        return self._validate_format_compliance(evidence_data, self.evidence_rules["format_requirements"]["packing_list"])


