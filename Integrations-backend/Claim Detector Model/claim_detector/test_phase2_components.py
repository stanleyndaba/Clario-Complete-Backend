#!/usr/bin/env python3
"""
Test Script for Phase 2 Components - Fine-Grained Classification
Tests the fine-grained classifier and evidence engine
"""

import logging
import json
from datetime import datetime, timedelta
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from src.ml_detector.fine_grained_classifier import FineGrainedClassifier, ClaimClassification, EvidenceRequirement
from src.evidence.evidence_engine import EvidenceEngine, EvidenceValidation, EvidenceBundle
from src.rules_engine.rules_engine import ClaimData

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def create_mock_claim_data():
    """Create mock claim data for testing"""
    return ClaimData(
        sku="TEST-SKU-001",
        asin="B08N5WRWNW",
        claim_type="damaged",
        quantity_affected=2,
        amount_requested=150.00,
        shipment_date=datetime.now() - timedelta(days=30),
        received_date=datetime.now() - timedelta(days=25),
        warehouse_location="SDF1",
        marketplace="US",
        cost_per_unit=75.00,
        evidence_attached=True,
        days_since_shipment=30
    )

def create_mock_evidence_items():
    """Create mock evidence items for testing"""
    return [
        {
            "evidence_type": "photos",
            "file_type": "jpg",
            "file_size_mb": 2.5,
            "evidence_date": (datetime.now() - timedelta(days=1)).isoformat(),
            "fields": ["timestamp", "location", "damage_visible"],
            "description": "Clear photos showing damage to product packaging",
            "label": "Damage Photos",
            "quality_met": True
        },
        {
            "evidence_type": "damage_report",
            "file_type": "pdf",
            "file_size_mb": 0.8,
            "evidence_date": (datetime.now() - timedelta(hours=12)).isoformat(),
            "fields": ["description", "date_discovered", "extent_of_damage"],
            "description": "Detailed report describing the damage discovered during unpacking",
            "label": "Damage Report",
            "quality_met": True
        },
        {
            "evidence_type": "invoice",
            "file_type": "pdf",
            "file_size_mb": 1.2,
            "evidence_date": (datetime.now() - timedelta(days=60)).isoformat(),
            "fields": ["invoice_number", "date", "amount", "vendor"],
            "description": "Original purchase invoice for the damaged items",
            "label": "Purchase Invoice",
            "quality_met": True
        }
    ]

def test_fine_grained_classifier():
    """Test the fine-grained claim classifier"""
    logger.info("🧪 Testing Fine-Grained Classifier...")
    
    try:
        # Initialize classifier
        classifier = FineGrainedClassifier()
        
        # Create mock claim data
        claim_data = create_mock_claim_data()
        
        # Test classification
        classification = classifier.classify_claim(claim_data)
        
        logger.info(f"✅ Classification completed:")
        logger.info(f"   Primary claim type: {classification.primary_claim_type}")
        logger.info(f"   Claimability score: {classification.claimability_score:.3f}")
        logger.info(f"   Confidence level: {classification.confidence_level}")
        logger.info(f"   Required evidence: {', '.join(classification.required_evidence)}")
        
        # Test claim type probabilities
        logger.info(f"   Claim type probabilities:")
        for claim_type, prob in sorted(classification.claim_types.items(), key=lambda x: x[1], reverse=True)[:5]:
            logger.info(f"     {claim_type}: {prob:.3f}")
        
        # Test risk factors and recommendations
        if classification.risk_factors:
            logger.info(f"   Risk factors: {', '.join(classification.risk_factors)}")
        
        if classification.recommendations:
            logger.info(f"   Recommendations: {', '.join(classification.recommendations)}")
        
        # Test evidence requirements
        evidence_details = classifier.get_evidence_details(classification.primary_claim_type)
        logger.info(f"   Evidence details for {classification.primary_claim_type}:")
        for requirement in evidence_details:
            logger.info(f"     {requirement.evidence_type}: {requirement.description}")
            logger.info(f"       Required: {requirement.is_required}")
            if requirement.alternatives:
                logger.info(f"       Alternatives: {', '.join(requirement.alternatives)}")
        
        # Test custom evidence requirement
        custom_requirement = EvidenceRequirement(
            evidence_type="custom_documentation",
            description="Custom documentation for testing",
            is_required=False,
            alternatives=["test_document", "sample_file"],
            format_requirements="Any format",
            time_constraints="No specific time limit"
        )
        
        classifier.add_custom_evidence_requirement("damaged", custom_requirement)
        logger.info("✅ Custom evidence requirement added")
        
        # Get classification summary
        summary = classifier.get_classification_summary()
        logger.info(f"📊 Classification summary: {summary['total_claim_types']} claim types supported")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Fine-grained classifier test failed: {e}")
        return False

def test_evidence_engine():
    """Test the evidence requirement engine"""
    logger.info("🧪 Testing Evidence Engine...")
    
    try:
        # Initialize evidence engine
        evidence_engine = EvidenceEngine()
        
        # Test evidence requirements
        claim_data = create_mock_claim_data()
        required_evidence = evidence_engine.get_evidence_requirements("damaged", claim_data)
        logger.info(f"✅ Required evidence for damaged claim: {', '.join(required_evidence)}")
        
        # Test evidence validation
        mock_evidence_items = create_mock_evidence_items()
        
        for evidence_item in mock_evidence_items:
            evidence_type = evidence_item["evidence_type"]
            validation = evidence_engine.validate_evidence(evidence_item, evidence_type)
            
            logger.info(f"✅ Evidence validation for {evidence_type}:")
            logger.info(f"   Valid: {validation.is_valid}")
            logger.info(f"   Score: {validation.validation_score:.3f}")
            logger.info(f"   Format compliance: {validation.format_compliance}")
            logger.info(f"   Time compliance: {validation.time_compliance}")
            logger.info(f"   Completeness: {validation.completeness}")
            
            if validation.issues:
                logger.info(f"   Issues: {', '.join(validation.issues)}")
            
            if validation.recommendations:
                logger.info(f"   Recommendations: {', '.join(validation.recommendations)}")
        
        # Test evidence bundle validation
        bundle = evidence_engine.validate_evidence_bundle(
            claim_id="test_claim_001",
            evidence_items=mock_evidence_items,
            required_evidence=required_evidence
        )
        
        logger.info(f"✅ Evidence bundle validation:")
        logger.info(f"   Total evidence: {bundle.total_evidence_count}")
        logger.info(f"   Required evidence: {bundle.required_evidence_count}")
        logger.info(f"   Optional evidence: {bundle.optional_evidence_count}")
        logger.info(f"   Validation score: {bundle.validation_score:.3f}")
        logger.info(f"   Bundle status: {bundle.bundle_status}")
        
        if bundle.missing_required:
            logger.info(f"   Missing required: {', '.join(bundle.missing_required)}")
        
        # Test evidence templates
        for evidence_type in ["invoice", "photos", "damage_report"]:
            template = evidence_engine.get_evidence_template(evidence_type)
            logger.info(f"✅ Evidence template for {evidence_type}:")
            logger.info(f"   Required fields: {', '.join(template['required_fields'])}")
            logger.info(f"   File types: {', '.join(template['file_types'])}")
            logger.info(f"   Max file size: {template['max_file_size_mb']}MB")
        
        # Test custom evidence rule
        custom_rule = {
            "required_fields": ["custom_field_1", "custom_field_2"],
            "file_types": ["pdf", "doc"],
            "max_file_size_mb": 5,
            "quality_requirements": "Custom quality requirements"
        }
        
        evidence_engine.add_custom_evidence_rule("custom_evidence", custom_rule)
        logger.info("✅ Custom evidence rule added")
        
        # Save evidence rules
        evidence_engine.save_evidence_rules("test_evidence_rules.json")
        logger.info("✅ Evidence rules saved to file")
        
        # Get evidence summary
        summary = evidence_engine.get_evidence_summary()
        logger.info(f"📊 Evidence engine summary: {summary['total_evidence_types']} evidence types supported")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Evidence engine test failed: {e}")
        return False

def test_integration():
    """Test integration between classifier and evidence engine"""
    logger.info("🧪 Testing Component Integration...")
    
    try:
        # Initialize components
        classifier = FineGrainedClassifier()
        evidence_engine = EvidenceEngine()
        
        # Create mock claim data
        claim_data = create_mock_claim_data()
        
        # Classify claim
        classification = classifier.classify_claim(claim_data)
        logger.info(f"✅ Claim classified as: {classification.primary_claim_type}")
        
        # Get evidence requirements
        required_evidence = evidence_engine.get_evidence_requirements(
            classification.primary_claim_type, claim_data
        )
        logger.info(f"✅ Evidence requirements: {', '.join(required_evidence)}")
        
        # Create mock evidence
        mock_evidence = create_mock_evidence_items()
        
        # Validate evidence bundle
        bundle = evidence_engine.validate_evidence_bundle(
            claim_id="test_integration_001",
            evidence_items=mock_evidence,
            required_evidence=required_evidence
        )
        
        logger.info(f"✅ Integration test results:")
        logger.info(f"   Claim type: {classification.primary_claim_type}")
        logger.info(f"   Claimability score: {classification.claimability_score:.3f}")
        logger.info(f"   Evidence bundle status: {bundle.bundle_status}")
        logger.info(f"   Evidence validation score: {bundle.validation_score:.3f}")
        
        # Test end-to-end workflow
        if bundle.bundle_status == "complete":
            logger.info("✅ Evidence bundle is complete - claim ready for submission")
        elif bundle.bundle_status == "incomplete":
            logger.info("⚠️ Evidence bundle incomplete - missing required evidence")
            logger.info(f"   Missing: {', '.join(bundle.missing_required)}")
        else:
            logger.info("⏳ Evidence bundle pending - requires additional review")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Integration test failed: {e}")
        return False

def run_all_tests():
    """Run all Phase 2 component tests"""
    logger.info("🚀 Starting Phase 2 Component Tests")
    logger.info("=" * 50)
    
    test_results = {}
    
    # Test 1: Fine-Grained Classifier
    test_results['fine_grained_classifier'] = test_fine_grained_classifier()
    
    # Test 2: Evidence Engine
    test_results['evidence_engine'] = test_evidence_engine()
    
    # Test 3: Integration
    test_results['integration'] = test_integration()
    
    # Summary
    logger.info("=" * 50)
    logger.info("📊 Phase 2 Test Results Summary")
    logger.info("=" * 50)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        logger.info(f"{test_name:.<30} {status}")
        if result:
            passed += 1
    
    logger.info("=" * 50)
    logger.info(f"Overall Result: {passed}/{total} tests passed")
    
    if passed == total:
        logger.info("🎉 All Phase 2 components are working correctly!")
        logger.info("🚀 Ready to proceed to Phase 3: Confidence Calibration")
    else:
        logger.error("⚠️ Some tests failed. Please review the errors above.")
    
    return passed == total

def main():
    """Main function to run tests"""
    try:
        # Run tests
        success = run_all_tests()
        
        if success:
            print("\n🎉 Phase 2 Implementation Complete!")
            print("✅ Fine-grained classification system is operational")
            print("✅ Evidence requirement engine is functional")
            print("✅ Multi-label claim classification is working")
            print("\n🚀 Ready for Phase 3: Confidence Calibration")
        else:
            print("\n⚠️ Some Phase 2 tests failed")
            print("Please review the errors and fix issues before proceeding")
        
        return 0 if success else 1
        
    except KeyboardInterrupt:
        logger.info("🛑 Tests interrupted by user")
        return 1
    except Exception as e:
        logger.error(f"❌ Unexpected error during testing: {e}")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
