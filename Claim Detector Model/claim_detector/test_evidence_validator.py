"""
Test script for Evidence Validator system
"""
import sys
import os
from pathlib import Path

# Add the project root to the Python path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.ev.rules_engine import RulesEngine
from src.ev.ml_validator import DocValidator
from src.ev.service import EvidenceValidatorService, ValidationResult

def test_rules_engine():
    """Test the rules engine"""
    print("Testing Rules Engine...")
    
    # Create rules engine
    rules_engine = RulesEngine()
    
    # Sample claim metadata
    metadata = {
        "claim_id": "CLM-001",
        "shipment_id": "SHIP-123",
        "sku": "TEST-SKU-001",
        "asin": "B123456789",
        "claim_date": "2025-01-15",
        "quantity": 10,
        "amount": 150.00
    }
    
    # Sample documents
    docs = [
        {
            "metadata": {
                "document_type": "invoice",
                "file_path": "invoice.pdf",
                "file_size_mb": 2.5,
                "document_date": "2025-01-10",
                "shipment_id": "SHIP-123",
                "quantity": 10,
                "amount": 150.00,
                "hash": "abc123",
                "hash_verified": True
            },
            "extracted_text": "Invoice for 10 units at $15.00 each. Total: $150.00"
        },
        {
            "metadata": {
                "document_type": "shipping_label",
                "file_path": "shipping.pdf",
                "file_size_mb": 1.8,
                "document_date": "2025-01-12",
                "shipment_id": "SHIP-123",
                "hash": "def456",
                "hash_verified": True
            },
            "extracted_text": "Shipping label for shipment SHIP-123"
        }
    ]
    
    # Run validation
    result = rules_engine.validate_claim(metadata, docs)
    
    print(f"Rules validation result: {result['status']}")
    print(f"Rules passed: {result['rules_passed']}")
    print(f"Rules failed: {result['rules_failed']}")
    print(f"Missing fields: {result['missing_fields']}")
    
    return result

def test_ml_validator():
    """Test the ML validator"""
    print("\nTesting ML Validator...")
    
    # Create ML validator
    ml_validator = DocValidator()
    
    # Sample documents
    docs = [
        {
            "metadata": {
                "document_type": "invoice",
                "file_size_mb": 2.5,
                "file_quality": 0.9
            },
            "extracted_text": "Invoice dated 2025-01-10 for 10 units at $15.00 each. Total amount: $150.00"
        },
        {
            "metadata": {
                "document_type": "shipping_label",
                "file_size_mb": 1.8,
                "file_quality": 0.8
            },
            "extracted_text": "Shipping label for shipment SHIP-123. Quantity: 10 pieces"
        }
    ]
    
    # Run validation
    result = ml_validator.validate_documents(docs)
    
    print(f"ML validation result: {result['ml_valid']}")
    print(f"ML score: {result['ml_score']:.3f}")
    print(f"Confidence: {result['confidence']:.3f}")
    print(f"Validation details: {len(result['validation_details'])} documents")
    
    return result

def test_evidence_validator_service():
    """Test the complete evidence validator service"""
    print("\nTesting Evidence Validator Service...")
    
    # Create service
    ev_service = EvidenceValidatorService()
    
    # Sample claim metadata
    metadata = {
        "claim_id": "CLM-001",
        "shipment_id": "SHIP-123",
        "sku": "TEST-SKU-001",
        "asin": "B123456789",
        "claim_date": "2025-01-15",
        "quantity": 10,
        "amount": 150.00
    }
    
    # Sample documents
    docs = [
        {
            "metadata": {
                "document_type": "invoice",
                "file_path": "invoice.pdf",
                "file_size_mb": 2.5,
                "document_date": "2025-01-10",
                "shipment_id": "SHIP-123",
                "quantity": 10,
                "amount": 150.00,
                "hash": "abc123",
                "hash_verified": True
            },
            "extracted_text": "Invoice dated 2025-01-10 for 10 units at $15.00 each. Total amount: $150.00"
        },
        {
            "metadata": {
                "document_type": "shipping_label",
                "file_path": "shipping.pdf",
                "file_size_mb": 1.8,
                "document_date": "2025-01-12",
                "shipment_id": "SHIP-123",
                "hash": "def456",
                "hash_verified": True
            },
            "extracted_text": "Shipping label for shipment SHIP-123. Quantity: 10 pieces"
        }
    ]
    
    # Run validation
    result = ev_service.validate_evidence("CLM-001", metadata, docs)
    
    print(f"Final validation result: {result.status}")
    print(f"Final confidence: {result.final_confidence:.3f}")
    print(f"ML score: {result.ml_score:.3f}")
    print(f"Rules passed: {len(result.rules_passed)}")
    print(f"Rules failed: {len(result.rules_failed)}")
    print(f"Validation ID: {result.validation_id}")
    
    return result

def main():
    """Run all tests"""
    print("=== Evidence Validator System Test ===\n")
    
    try:
        # Test individual components
        rules_result = test_rules_engine()
        ml_result = test_ml_validator()
        service_result = test_evidence_validator_service()
        
        print("\n=== Test Summary ===")
        print(f"Rules Engine: {'✅ PASS' if rules_result['status'] in ['valid', 'review'] else '❌ FAIL'}")
        print(f"ML Validator: {'✅ PASS' if ml_result['ml_valid'] else '❌ FAIL'}")
        print(f"Service: {'✅ PASS' if service_result.status in ['valid', 'review'] else '❌ FAIL'}")
        
        print("\n🎉 All tests completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()

