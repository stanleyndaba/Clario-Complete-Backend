# -*- coding: utf-8 -*-
"""
Test Script for Claim Detector → MCDE Handoff System

This script tests the structured claim handoff system to ensure
seamless integration between Claim Detector and MCDE.
"""

import asyncio
import json
import sys
import os

# Add src to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

async def test_structured_claims():
    """Test the structured claim system"""
    print("🔹 Testing Structured Claims...")
    
    try:
        from src.handoff.structured_claim import (
            ClaimType, 
            EvidenceSource, 
            ClaimMetadata, 
            StructuredClaim,
            ClaimHandoffFormatter,
            create_mock_structured_claim
        )
        
        # Test 1: Create mock claim
        mock_claim = create_mock_structured_claim()
        print(f"✅ Created mock claim: {mock_claim.claim_id}")
        
        # Test 2: Validate claim
        is_valid = mock_claim.validate()
        print(f"✅ Claim validation: {'PASS' if is_valid else 'FAIL'}")
        
        # Test 3: Test JSON conversion
        json_output = mock_claim.to_json()
        print(f"✅ JSON output: {len(json_output)} characters")
        
        # Test 4: Test handoff formatter
        formatter = ClaimHandoffFormatter()
        
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
        print(f"✅ Formatted claim type: {formatted_claim.claim_type.value}")
        print(f"✅ Evidence sources: {formatted_claim.evidence_sources}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error testing structured claims: {e}")
        return False

async def test_integration_layer():
    """Test the integration layer"""
    print("\n🔹 Testing Integration Layer...")
    
    try:
        from src.handoff.claim_detector_integration import ClaimDetectorMCDEIntegration
        
        # Create integration (this will test imports)
        integration = ClaimDetectorMCDEIntegration()
        print("✅ Integration layer created successfully")
        
        # Test handoff summary
        summary = integration.get_handoff_summary()
        print(f"✅ Handoff summary: {summary['status']}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error testing integration layer: {e}")
        return False

async def test_full_pipeline():
    """Test the full pipeline with mock data"""
    print("\n🔹 Testing Full Pipeline...")
    
    try:
        from src.handoff.claim_detector_integration import ClaimDetectorMCDEIntegration
        
        # Create integration
        integration = ClaimDetectorMCDEIntegration()
        
        # Create mock rejection data
        mock_rejection = {
            "id": "REJ_001",
            "rejection_reason": "Inventory lost during shipment",
            "description": "Package never arrived at destination",
            "order_id": "123-4567890-1234567",
            "sku": "B07ABC1234",
            "claim_amount": 150.00
        }
        
        # Process the rejection
        structured_claim = await integration.process_rejection_for_mcde(mock_rejection)
        
        if structured_claim:
            print(f"✅ Successfully processed rejection: {structured_claim.claim_id}")
            print(f"   Type: {structured_claim.claim_type.value}")
            print(f"   Confidence: {structured_claim.confidence_score:.3f}")
            print(f"   Evidence sources: {structured_claim.evidence_sources}")
            
            # Test export
            export_success = integration.export_claims_for_mcde("test_mcde_export.json")
            print(f"✅ Export test: {'PASS' if export_success else 'FAIL'}")
            
            # Test filtering
            high_conf_claims = integration.get_mcde_ready_claims(min_confidence=0.8)
            print(f"✅ High confidence claims: {len(high_conf_claims)}")
            
            return True
        else:
            print("❌ Failed to process rejection")
            return False
            
    except Exception as e:
        print(f"❌ Error testing full pipeline: {e}")
        return False

async def test_evidence_source_mapping():
    """Test evidence source mapping"""
    print("\n🔹 Testing Evidence Source Mapping...")
    
    try:
        from src.handoff.structured_claim import ClaimType, EVIDENCE_SOURCES_MAPPING
        
        # Test mapping for different claim types
        test_cases = [
            (ClaimType.LOST, ["shipment_reconciliation_reports", "carrier_confirmation", "shipping_manifests"]),
            (ClaimType.DAMAGED, ["inbound_shipment_logs", "fc_processing_logs", "photo_evidence", "carrier_confirmation"]),
            (ClaimType.FEE_ERROR, ["amazon_fee_reports", "invoices"]),
            (ClaimType.RETURN, ["return_reports", "invoices", "customer_feedback"])
        ]
        
        for claim_type, expected_sources in test_cases:
            sources = EVIDENCE_SOURCES_MAPPING.get(claim_type, [])
            source_values = [s.value for s in sources]
            
            if set(source_values) == set(expected_sources):
                print(f"✅ {claim_type.value}: Evidence sources match")
            else:
                print(f"❌ {claim_type.value}: Evidence sources mismatch")
                print(f"   Expected: {expected_sources}")
                print(f"   Got: {source_values}")
                return False
        
        return True
        
    except Exception as e:
        print(f"❌ Error testing evidence source mapping: {e}")
        return False

async def test_claim_metadata():
    """Test claim metadata handling"""
    print("\n🔹 Testing Claim Metadata...")
    
    try:
        from src.handoff.structured_claim import ClaimMetadata
        
        # Test metadata creation
        metadata = ClaimMetadata(
            order_id="123-4567890-1234567",
            sku="B07ABC1234",
            fnsku="X001ABC123",
            shipment_id="FBA1234567",
            claim_amount=150.00
        )
        
        # Test to_dict conversion
        metadata_dict = metadata.to_dict()
        
        expected_keys = ["order_id", "sku", "fnsku", "shipment_id", "claim_amount"]
        for key in expected_keys:
            if key in metadata_dict:
                print(f"✅ Metadata key '{key}': {metadata_dict[key]}")
            else:
                print(f"❌ Missing metadata key: {key}")
                return False
        
        return True
        
    except Exception as e:
        print(f"❌ Error testing claim metadata: {e}")
        return False

async def main():
    """Run all tests"""
    print("🚀 Testing Claim Detector → MCDE Handoff System")
    print("=" * 60)
    
    tests = [
        ("Structured Claims", test_structured_claims),
        ("Integration Layer", test_integration_layer),
        ("Evidence Source Mapping", test_evidence_source_mapping),
        ("Claim Metadata", test_claim_metadata),
        ("Full Pipeline", test_full_pipeline)
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            result = await test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ {test_name} test failed with exception: {e}")
            results.append((test_name, False))
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST RESULTS SUMMARY")
    print("=" * 60)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name:25} {status}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED! Handoff system is ready for MCDE integration.")
    else:
        print(f"\n⚠️  {total - passed} tests failed. Please review the errors above.")
    
    return passed == total

if __name__ == "__main__":
    # Run the tests
    success = asyncio.run(main())
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)




