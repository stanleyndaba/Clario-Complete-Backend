"""
Comprehensive tests for EV + ACG integration pipeline
"""
import pytest
import json
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime
from typing import Dict, List, Any

from src.ev.service import EvidenceValidatorService, ValidationResult
from src.acg.service import AutoClaimsGeneratorService, FilingResult
from src.acg.router import acg_router, get_acg_service

class TestEVACGIntegration:
    """Test the complete EV + ACG integration pipeline"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.sample_claim = {
            "claim_id": "CLM-000001",
            "metadata": {
                "claim_id": "CLM-000001",
                "seller_id": "SELLER-001",
                "shipment_id": "SHIP-000001",
                "sku": "SKU-000001",
                "asin": "B000000001",
                "claim_type": "lost_inventory",
                "amount": 25.50,
                "quantity": 2,
                "marketplace": "US",
                "claim_date": datetime.now().isoformat(),
                "description": "Test claim for integration testing"
            },
            "documents": [
                {
                    "metadata": {
                        "document_type": "invoice",
                        "document_date": datetime.now().isoformat(),
                        "file_path": "/tmp/invoice_001.pdf",
                        "file_size_mb": 2.5,
                        "file_quality": 0.9,
                        "hash": "hash_invoice_001",
                        "hash_verified": True,
                        "shipment_id": "SHIP-000001",
                        "quantity": 2,
                        "amount": 25.50
                    },
                    "extracted_text": """
                    INVOICE
                    Invoice #: INV-000001
                    Date: 12/01/2024
                    Shipment ID: SHIP-000001
                    SKU: SKU-000001
                    Quantity: 2
                    Unit Price: $12.75
                    Total Amount: $25.50
                    """
                },
                {
                    "metadata": {
                        "document_type": "shipping_label",
                        "document_date": datetime.now().isoformat(),
                        "file_path": "/tmp/shipping_001.pdf",
                        "file_size_mb": 1.8,
                        "file_quality": 0.85,
                        "hash": "hash_shipping_001",
                        "hash_verified": True,
                        "shipment_id": "SHIP-000001"
                    },
                    "extracted_text": """
                    SHIPPING LABEL
                    Tracking #: TRK-000001
                    Shipment ID: SHIP-000001
                    Destination: Test Address 1
                    Weight: 2 lbs
                    Service: Standard Shipping
                    """
                }
            ]
        }
    
    @patch('src.ev.service.DATABASE_AVAILABLE', False)
    @patch('src.acg.service.DATABASE_AVAILABLE', False)
    def test_ev_validation_flow(self):
        """Test EV validation flow"""
        ev_service = EvidenceValidatorService()
        
        # Test validation
        result = ev_service.validate_claim(self.sample_claim)
        
        assert isinstance(result, ValidationResult)
        assert result.claim_id == "CLM-000001"
        assert result.status in ["valid", "invalid", "review"]
        assert 0.0 <= result.final_confidence <= 1.0
        assert 0.0 <= result.ml_score <= 1.0
        assert isinstance(result.rules_passed, list)
        assert isinstance(result.rules_failed, list)
    
    @patch('src.ev.service.DATABASE_AVAILABLE', False)
    @patch('src.acg.service.DATABASE_AVAILABLE', False)
    def test_acg_processing_flow(self):
        """Test ACG processing flow"""
        acg_service = AutoClaimsGeneratorService(use_mock_sp_api=True)
        
        # Test processing
        result = acg_service.process_claim(self.sample_claim)
        
        assert isinstance(result, FilingResult)
        assert result.claim_id == "CLM-000001"
        assert result.status in ["submitted", "failed", "rejected", "review"]
        assert isinstance(result.success, bool)
        assert isinstance(result.timestamp, str)
    
    @patch('src.ev.service.DATABASE_AVAILABLE', False)
    @patch('src.acg.service.DATABASE_AVAILABLE', False)
    def test_complete_pipeline_integration(self):
        """Test complete pipeline integration"""
        acg_service = AutoClaimsGeneratorService(use_mock_sp_api=True)
        
        # Process claim through complete pipeline
        result = acg_service.process_claim(self.sample_claim)
        
        # Verify result structure
        assert isinstance(result, FilingResult)
        assert result.claim_id == "CLM-000001"
        
        # Check that EV was involved in decision
        assert result.status in ["submitted", "failed", "rejected", "review"]
    
    @patch('src.ev.service.DATABASE_AVAILABLE', False)
    @patch('src.acg.service.DATABASE_AVAILABLE', False)
    def test_invalid_claim_rejection(self):
        """Test that invalid claims are rejected by EV"""
        # Create invalid claim (missing required fields)
        invalid_claim = {
            "claim_id": "CLM-000002",
            "metadata": {
                "claim_id": "CLM-000002",
                # Missing required fields
            },
            "documents": []
        }
        
        acg_service = AutoClaimsGeneratorService(use_mock_sp_api=True)
        result = acg_service.process_claim(invalid_claim)
        
        # Should be rejected by EV
        assert result.status == "rejected"
        assert not result.success
        assert "EV validation" in result.error or "validation" in result.error.lower()
    
    @patch('src.ev.service.DATABASE_AVAILABLE', False)
    @patch('src.acg.service.DATABASE_AVAILABLE', False)
    def test_acg_service_availability(self):
        """Test ACG service availability checks"""
        acg_service = AutoClaimsGeneratorService(use_mock_sp_api=True)
        
        assert acg_service.is_ev_available() == True
        assert acg_service.is_sp_api_available() == True
    
    @patch('src.ev.service.DATABASE_AVAILABLE', False)
    @patch('src.acg.service.DATABASE_AVAILABLE', False)
    def test_acg_filing_stats(self):
        """Test ACG filing statistics"""
        acg_service = AutoClaimsGeneratorService(use_mock_sp_api=True)
        
        stats = acg_service.get_filing_stats()
        
        assert isinstance(stats, dict)
        assert "total_filings" in stats
        assert "successful_filings" in stats
        assert "failed_filings" in stats
        assert "success_rate" in stats

class TestACGRouter:
    """Test ACG router endpoints"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.sample_request = {
            "claim_id": "CLM-000001",
            "metadata": {
                "seller_id": "SELLER-001",
                "shipment_id": "SHIP-000001",
                "sku": "SKU-000001",
                "asin": "B000000001",
                "claim_type": "lost_inventory",
                "amount": 25.50,
                "quantity": 2,
                "marketplace": "US"
            },
            "documents": [
                {
                    "metadata": {
                        "document_type": "invoice",
                        "file_path": "/tmp/invoice_001.pdf"
                    },
                    "extracted_text": "Test invoice content"
                }
            ]
        }
    
    @patch('src.acg.router.get_acg_service')
    def test_submit_claim_endpoint(self, mock_get_service):
        """Test claim submission endpoint"""
        # Mock ACG service
        mock_service = Mock()
        mock_filing_result = FilingResult(
            claim_id="CLM-000001",
            success=True,
            amazon_case_id="AMZ-12345",
            status="submitted"
        )
        mock_service.process_claim.return_value = mock_filing_result
        mock_get_service.return_value = mock_service
        
        # Test endpoint
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        
        app = FastAPI()
        app.include_router(acg_router, prefix="/acg")
        client = TestClient(app)
        
        response = client.post("/acg/submit", json=self.sample_request)
        
        assert response.status_code == 200
        data = response.json()
        assert data["claim_id"] == "CLM-000001"
        assert data["success"] == True
        assert data["amazon_case_id"] == "AMZ-12345"
    
    @patch('src.acg.router.get_acg_service')
    def test_filing_status_endpoint(self, mock_get_service):
        """Test filing status endpoint"""
        # Mock ACG service
        mock_service = Mock()
        mock_filing_result = FilingResult(
            claim_id="CLM-000001",
            success=True,
            amazon_case_id="AMZ-12345",
            status="submitted"
        )
        mock_service.get_filing_status.return_value = mock_filing_result
        mock_get_service.return_value = mock_service
        
        # Test endpoint
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        
        app = FastAPI()
        app.include_router(acg_router, prefix="/acg")
        client = TestClient(app)
        
        response = client.get("/acg/status/CLM-000001")
        
        assert response.status_code == 200
        data = response.json()
        assert data["claim_id"] == "CLM-000001"
        assert data["success"] == True
    
    @patch('src.acg.router.get_acg_service')
    def test_acg_stats_endpoint(self, mock_get_service):
        """Test ACG stats endpoint"""
        # Mock ACG service
        mock_service = Mock()
        mock_stats = {
            "total_filings": 100,
            "successful_filings": 80,
            "failed_filings": 10,
            "pending_filings": 10,
            "success_rate": 80.0,
            "average_processing_time_hours": 2.5
        }
        mock_service.get_filing_stats.return_value = mock_stats
        mock_service.is_ev_available.return_value = True
        mock_service.is_sp_api_available.return_value = True
        mock_get_service.return_value = mock_service
        
        # Test endpoint
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        
        app = FastAPI()
        app.include_router(acg_router, prefix="/acg")
        client = TestClient(app)
        
        response = client.get("/acg/stats")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total_filings"] == 100
        assert data["success_rate"] == 80.0
        assert data["ev_available"] == True
        assert data["sp_api_available"] == True

class TestEVEnhancements:
    """Test EV enhancements with hybrid rules and ML"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.ev_service = EvidenceValidatorService()
    
    def test_validate_claim_interface(self):
        """Test the clean validate_claim interface"""
        claim = {
            "claim_id": "CLM-000001",
            "metadata": {
                "seller_id": "SELLER-001",
                "shipment_id": "SHIP-000001",
                "sku": "SKU-000001",
                "asin": "B000000001"
            },
            "documents": [
                {
                    "metadata": {
                        "document_type": "invoice",
                        "file_path": "/tmp/invoice.pdf",
                        "hash": "test_hash",
                        "hash_verified": True
                    },
                    "extracted_text": "Test invoice content"
                }
            ]
        }
        
        result = self.ev_service.validate_claim(claim)
        
        assert isinstance(result, ValidationResult)
        assert result.claim_id == "CLM-000001"
        assert result.status in ["valid", "invalid", "review"]
    
    @patch('src.ev.service.DATABASE_AVAILABLE', False)
    def test_validation_history(self):
        """Test validation history retrieval"""
        history = self.ev_service.get_validation_history("CLM-000001")
        
        # Should return empty list when database not available
        assert isinstance(history, list)
    
    @patch('src.ev.service.DATABASE_AVAILABLE', False)
    def test_validation_stats(self):
        """Test validation statistics"""
        stats = self.ev_service.get_validation_stats()
        
        assert isinstance(stats, dict)
        assert "total_validations" in stats
        assert "valid_count" in stats
        assert "invalid_count" in stats
        assert "review_count" in stats

class TestMLValidatorEnhancements:
    """Test ML validator enhancements"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.doc_validator = self.ev_service.doc_validator
    
    def test_sklearn_model_support(self):
        """Test scikit-learn model support"""
        # Test with sklearn model type
        validator = self.ev_service.doc_validator
        validator.model_type = "sklearn"
        
        docs = [
            {
                "metadata": {"document_type": "invoice"},
                "extracted_text": "Test invoice content"
            }
        ]
        
        result = validator.validate_documents(docs)
        
        assert "ml_score" in result
        assert "ml_valid" in result
        assert "confidence" in result
        assert "model_type" in result
    
    def test_huggingface_model_support(self):
        """Test Hugging Face model support"""
        # Test with huggingface model type
        validator = self.ev_service.doc_validator
        validator.model_type = "huggingface"
        
        docs = [
            {
                "metadata": {"document_type": "invoice"},
                "extracted_text": "Test invoice content"
            }
        ]
        
        result = validator.validate_documents(docs)
        
        assert "ml_score" in result
        assert "ml_valid" in result
        assert "confidence" in result
        assert "model_type" in result
    
    def test_feature_extraction(self):
        """Test feature extraction for ML models"""
        validator = self.ev_service.doc_validator
        
        doc = {
            "metadata": {
                "document_type": "invoice",
                "file_size_mb": 2.5,
                "file_quality": 0.9
            },
            "extracted_text": "Invoice #123 Date: 12/01/2024 Amount: $25.50 Qty: 2"
        }
        
        features = validator._extract_features(doc)
        
        assert isinstance(features, list)
        assert len(features) > 0
        assert all(isinstance(f, (int, float)) for f in features)

if __name__ == "__main__":
    pytest.main([__file__])
