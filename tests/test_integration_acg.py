"""
Comprehensive tests for the integrated FBA Claims Pipeline
"""
import pytest
import json
from datetime import datetime
from fastapi.testclient import TestClient
from src.app import app
from src.common.schemas import ClaimDetection, ClaimMetadata

client = TestClient(app)

@pytest.fixture
def sample_claim():
    """Sample claim detection payload"""
    return {
        "claim_id": "CLM-000123",
        "claim_type": "lost_inventory",
        "confidence": 0.88,
        "amount_estimate": 142.50,
        "quantity_affected": 5,
        "features": {"age_days": 47, "units": 5, "warehouse_shortage_score": 0.83},
        "text_excerpt": "Transfer to FC JFK8 shows -5 adjustment without reimbursement",
        "metadata": {
            "marketplace_id": "ATVPDKIKX0DER",
            "seller_id": "A1ABCDEF12345",
            "order_id": None,
            "sku": "WTR-BTL-32OZ",
            "fnsku": "X001ABCDEF",
            "asin": "B08XYZ1234",
            "shipment_id": "FBA15ABCD",
            "fulfillment_center": "JFK8",
            "detected_at": "2025-01-03T10:00:00Z"
        }
    }

class TestEndToEndFlow:
    """Test the complete claim detection -> validation -> filing flow"""
    
    def test_detect_validate_auto_file(self, sample_claim):
        """Test complete happy path flow"""
        # 1) POST /claims/detect with idempotency
        idempotency_key = "test-key-123"
        response = client.post(
            "/claims/detect",
            json=sample_claim,
            headers={"Idempotency-Key": idempotency_key}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["claim_id"] == "CLM-000123"
        assert data["status"] == "queued_validation"
        
        # 2) Get claim status to verify validation completed
        response = client.get(f"/claims/{sample_claim['claim_id']}")
        assert response.status_code == 200
        
        data = response.json()
        claim = data["claim"]
        validations = data["validations"]
        filings = data["filings"]
        
        # Should have validation results
        assert len(validations) > 0
        latest_validation = validations[0]
        assert latest_validation["compliant"] == True
        assert latest_validation["auto_file_ready"] == True
        
        # Should have filing results if auto-filing threshold met
        if latest_validation["confidence_calibrated"] >= 0.75:
            assert len(filings) > 0
            latest_filing = filings[0]
            assert latest_filing["status"] in ["submitted", "failed"]
    
    def test_idempotency_protection(self, sample_claim):
        """Test that duplicate idempotency keys are rejected"""
        idempotency_key = "duplicate-key-456"
        
        # First request should succeed
        response = client.post(
            "/claims/detect",
            json=sample_claim,
            headers={"Idempotency-Key": idempotency_key}
        )
        assert response.status_code == 200
        
        # Second request with same key should fail
        response = client.post(
            "/claims/detect",
            json=sample_claim,
            headers={"Idempotency-Key": idempotency_key}
        )
        assert response.status_code == 409
        assert "Idempotent duplicate" in response.json()["detail"]
    
    def test_force_file_endpoint(self, sample_claim):
        """Test manual claim filing"""
        # First detect the claim
        response = client.post("/claims/detect", json=sample_claim)
        assert response.status_code == 200
        
        # Force file the claim
        response = client.post(f"/claims/{sample_claim['claim_id']}/file")
        assert response.status_code == 200
        assert response.json()["status"] == "file_attempted"
        
        # Verify filing was attempted
        response = client.get(f"/claims/{sample_claim['claim_id']}")
        assert response.status_code == 200
        
        data = response.json()
        filings = data["filings"]
        assert len(filings) > 0
        
        # Check that latest filing has expected status
        latest_filing = filings[0]
        assert latest_filing["status"] in ["submitted", "failed"]
    
    def test_cancel_claim(self, sample_claim):
        """Test claim cancellation"""
        # First detect the claim
        response = client.post("/claims/detect", json=sample_claim)
        assert response.status_code == 200
        
        # Cancel the claim
        response = client.post(f"/claims/{sample_claim['claim_id']}/cancel")
        assert response.status_code == 200
        assert response.json()["status"] == "cancelled"
        
        # Verify status was updated
        response = client.get(f"/claims/{sample_claim['claim_id']}")
        assert response.status_code == 200
        
        data = response.json()
        assert data["claim"]["status"] == "cancelled"

class TestErrorHandling:
    """Test error scenarios and edge cases"""
    
    def test_claim_not_found(self):
        """Test handling of non-existent claims"""
        response = client.get("/claims/non-existent-id")
        assert response.status_code == 404
        
        response = client.post("/claims/non-existent-id/file")
        assert response.status_code == 404
        
        response = client.post("/claims/non-existent-id/cancel")
        assert response.status_code == 404
    
    def test_invalid_claim_data(self):
        """Test validation of claim data"""
        invalid_claim = {
            "claim_id": "INVALID",
            "claim_type": "invalid_type",  # Invalid claim type
            "confidence": 1.5,  # Invalid confidence > 1
            "amount_estimate": -50,  # Negative amount
            "quantity_affected": 0,  # Zero quantity
            "metadata": {
                "marketplace_id": "",  # Empty required field
                "seller_id": "A1ABCDEF12345",
                "detected_at": "2025-01-03T10:00:00Z"
            }
        }
        
        response = client.post("/claims/detect", json=invalid_claim)
        assert response.status_code == 422  # Validation error
    
    def test_missing_required_fields(self):
        """Test handling of missing required fields"""
        incomplete_claim = {
            "claim_id": "INCOMPLETE",
            "claim_type": "lost_inventory",
            "confidence": 0.8,
            "amount_estimate": 100.0,
            "quantity_affected": 1
            # Missing metadata
        }
        
        response = client.post("/claims/detect", json=incomplete_claim)
        assert response.status_code == 422  # Validation error

class TestServiceHealth:
    """Test service health and basic functionality"""
    
    def test_health_endpoint(self):
        """Test health check endpoint"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "FBA Claims Pipeline"
    
    def test_root_endpoint(self):
        """Test root endpoint with service information"""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "FBA Claims Pipeline"
        assert "endpoints" in data
        assert "detect" in data["endpoints"]
        assert "file_claim" in data["endpoints"]

class TestDatabaseOperations:
    """Test database operations and persistence"""
    
    def test_claim_persistence(self, sample_claim):
        """Test that claims are properly persisted"""
        # Create claim
        response = client.post("/claims/detect", json=sample_claim)
        assert response.status_code == 200
        
        # Retrieve and verify persistence
        response = client.get(f"/claims/{sample_claim['claim_id']}")
        assert response.status_code == 200
        
        data = response.json()
        claim = data["claim"]
        
        # Verify all fields were persisted correctly
        assert claim["claim_id"] == sample_claim["claim_id"]
        assert claim["claim_type"] == sample_claim["claim_type"]
        assert claim["confidence"] == sample_claim["confidence"]
        assert claim["amount_estimate"] == sample_claim["amount_estimate"]
        assert claim["quantity_affected"] == sample_claim["quantity_affected"]
        assert claim["status"] == "detected"  # Initial status
    
    def test_validation_persistence(self, sample_claim):
        """Test that validation results are properly persisted"""
        # Create and validate claim
        response = client.post("/claims/detect", json=sample_claim)
        assert response.status_code == 200
        
        # Get claim status to trigger validation
        response = client.get(f"/claims/{sample_claim['claim_id']}")
        assert response.status_code == 200
        
        data = response.json()
        validations = data["validations"]
        
        # Should have validation results
        assert len(validations) > 0
        
        latest_validation = validations[0]
        assert "compliant" in latest_validation
        assert "ml_validity_score" in latest_validation
        assert "auto_file_ready" in latest_validation
        assert "confidence_calibrated" in latest_validation








