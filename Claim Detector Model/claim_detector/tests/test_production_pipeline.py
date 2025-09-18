"""
Tests for the complete production pipeline
"""
import pytest
import sys
import os
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timedelta

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from scripts.stress_test_ev import StressTestEV
from src.acg.sp_api_adapter import SPAmazonAdapter
from src.monitoring.router import monitoring_router, ClaimSummary, ClaimDetail, PipelineStats

class TestStressTestEV:
    """Test the stress testing functionality"""
    
    def test_stress_test_initialization(self):
        """Test stress test initialization"""
        stress_test = StressTestEV(strict_mode=True, max_claims=100)
        
        assert stress_test.strict_mode == True
        assert stress_test.max_claims == 100
        assert stress_test.results['total_processed'] == 0
        assert stress_test.results['valid'] == 0
        assert stress_test.results['invalid'] == 0
        assert stress_test.results['review'] == 0
    
    def test_synthetic_data_generation(self):
        """Test synthetic data generation"""
        stress_test = StressTestEV(max_claims=5)
        claims = stress_test._generate_synthetic_data()
        
        assert len(claims) == 5
        assert all('claim_id' in claim for claim in claims)
        assert all('seller_id' in claim for claim in claims)
        assert all('documents' in claim for claim in claims)
    
    def test_synthetic_documents_generation(self):
        """Test synthetic document generation"""
        stress_test = StressTestEV()
        claim = {
            'claim_id': 'TEST-001',
            'claim_date': '2025-01-15',
            'quantity': 10,
            'amount': 150.00,
            'sku': 'TEST-SKU',
            'asin': 'B123456789'
        }
        
        docs = stress_test._generate_synthetic_documents(claim)
        
        assert len(docs) > 0
        assert all('metadata' in doc for doc in docs)
        assert all('extracted_text' in doc for doc in docs)
    
    def test_synthetic_text_generation(self):
        """Test synthetic text generation"""
        stress_test = StressTestEV()
        claim = {
            'claim_date': '2025-01-15',
            'quantity': 10,
            'amount': 150.00,
            'sku': 'TEST-SKU',
            'asin': 'B123456789'
        }
        
        invoice_text = stress_test._generate_synthetic_text(claim, 'invoice')
        assert 'Invoice dated 2025-01-15' in invoice_text
        assert '$150.00' in invoice_text
        
        shipping_text = stress_test._generate_synthetic_text(claim, 'shipping_label')
        assert 'Shipping label' in shipping_text
        assert 'TEST-SKU' in shipping_text
    
    @patch('src.ev.service.EvidenceValidatorService')
    def test_stress_test_execution(self, mock_ev_service):
        """Test stress test execution"""
        # Mock the EV service
        mock_service = Mock()
        mock_service.validate_evidence.return_value = Mock(
            status='valid',
            final_confidence=0.85,
            ml_score=0.87,
            rules_passed=['matching_case', 'documentation'],
            rules_failed=[],
            validation_id='test-validation-id',
            timestamp='2025-01-15T10:00:00'
        )
        mock_ev_service.return_value = mock_service
        
        stress_test = StressTestEV(max_claims=3)
        stress_test.ev_service = mock_service
        
        # Generate test data
        claims = stress_test._generate_synthetic_data()
        
        # Run stress test
        results = stress_test.run_stress_test()
        
        assert results['total_processed'] == 3
        assert results['valid'] == 3
        assert results['invalid'] == 0
        assert results['review'] == 0
        assert results['errors'] == 0
        assert results['processing_time'] > 0
        assert len(results['detailed_results']) == 3

class TestSPAmazonAdapter:
    """Test the Amazon SP-API adapter"""
    
    def test_adapter_initialization_mock(self):
        """Test adapter initialization in mock mode"""
        adapter = SPAmazonAdapter(use_mock=True)
        
        assert adapter.use_mock == True
        assert adapter.credentials is None
        assert adapter.access_token is None
    
    @patch.dict(os.environ, {
        'AMAZON_REFRESH_TOKEN': 'test_token',
        'AMAZON_CLIENT_ID': 'test_client',
        'AMAZON_CLIENT_SECRET': 'test_secret',
        'AWS_ACCESS_KEY_ID': 'test_key',
        'AWS_SECRET_ACCESS_KEY': 'test_secret_key',
        'AWS_REGION': 'us-east-1'
    })
    def test_adapter_initialization_real(self):
        """Test adapter initialization with real credentials"""
        with patch('src.acg.sp_api_adapter.SP_API_AVAILABLE', True):
            adapter = SPAmazonAdapter(use_mock=False)
            
            # Should fall back to mock if SP-API SDK not available
            assert adapter.use_mock == True
    
    def test_claim_payload_preparation(self):
        """Test claim payload preparation"""
        adapter = SPAmazonAdapter(use_mock=True)
        
        claim_data = {
            'claim_id': 'CLM-001',
            'seller_id': 'SELLER-123',
            'marketplace': 'US',
            'claim_type': 'lost_inventory',
            'amount': 150.00,
            'quantity': 10,
            'sku': 'TEST-SKU',
            'asin': 'B123456789',
            'description': 'Lost inventory claim',
            'documents': []
        }
        
        payload = adapter._prepare_claim_payload(claim_data)
        
        assert payload['caseType'] == 'FBA_LOST_INVENTORY'
        assert payload['issueType'] == 'LOST_INVENTORY'
        assert payload['marketplaceId'] == 'ATVPDKIKX0DER'
        assert 'FBA Reimbursement Claim' in payload['subject']
        assert 'CLM-001' in payload['content']
    
    def test_claim_type_mapping(self):
        """Test claim type mapping"""
        adapter = SPAmazonAdapter(use_mock=True)
        
        assert adapter._map_claim_type('lost_inventory') == 'FBA_LOST_INVENTORY'
        assert adapter._map_claim_type('damaged_goods') == 'FBA_DAMAGED_GOODS'
        assert adapter._map_claim_type('fee_error') == 'FBA_FEE_ERROR'
        assert adapter._map_claim_type('unknown') == 'FBA_GENERAL'
    
    def test_marketplace_id_mapping(self):
        """Test marketplace ID mapping"""
        adapter = SPAmazonAdapter(use_mock=True)
        
        assert adapter._get_marketplace_id('US') == 'ATVPDKIKX0DER'
        assert adapter._get_marketplace_id('CA') == 'A2EUQ1WTGCTBG2'
        assert adapter._get_marketplace_id('UK') == 'A1F83G8C2ARO7P'
        assert adapter._get_marketplace_id('unknown') == 'ATVPDKIKX0DER'
    
    def test_claim_content_generation(self):
        """Test claim content generation"""
        adapter = SPAmazonAdapter(use_mock=True)
        
        claim_data = {
            'claim_id': 'CLM-001',
            'claim_type': 'lost_inventory',
            'amount': 150.00,
            'quantity': 10,
            'sku': 'TEST-SKU',
            'asin': 'B123456789',
            'description': 'Lost inventory claim'
        }
        
        content = adapter._generate_claim_content(claim_data)
        
        assert 'CLM-001' in content
        assert 'Lost Inventory' in content
        assert '$150.00' in content
        assert 'TEST-SKU' in content
        assert 'B123456789' in content
        assert 'Lost inventory claim' in content
    
    def test_mock_claim_filing(self):
        """Test mock claim filing"""
        adapter = SPAmazonAdapter(use_mock=True)
        
        claim_data = {
            'claim_id': 'CLM-001',
            'seller_id': 'SELLER-123',
            'amount': 150.00
        }
        
        result = adapter._mock_file_claim(claim_data)
        
        assert 'success' in result
        assert 'claim_id' in result
        assert 'timestamp' in result
        assert result['claim_id'] == 'CLM-001'
    
    def test_mock_status_check(self):
        """Test mock status check"""
        adapter = SPAmazonAdapter(use_mock=True)
        
        result = adapter._mock_get_status('CASE-123')
        
        assert result['success'] == True
        assert result['case_id'] == 'CASE-123'
        assert 'status' in result
        assert 'last_updated' in result
        assert 'estimated_completion' in result
    
    def test_availability_check(self):
        """Test availability check"""
        adapter = SPAmazonAdapter(use_mock=True)
        assert adapter.is_available() == True
        
        adapter = SPAmazonAdapter(use_mock=False)
        # Should be False when SP-API not available
        assert adapter.is_available() == False

class TestMonitoringRouter:
    """Test the monitoring router endpoints"""
    
    def test_claim_summary_model(self):
        """Test ClaimSummary model"""
        summary = ClaimSummary(
            total_claims=100,
            detected=20,
            validated=30,
            filed=40,
            rejected=5,
            pending=5,
            success_rate=40.0,
            avg_processing_time_hours=2.5
        )
        
        assert summary.total_claims == 100
        assert summary.success_rate == 40.0
        assert summary.avg_processing_time_hours == 2.5
    
    def test_claim_detail_model(self):
        """Test ClaimDetail model"""
        detail = ClaimDetail(
            claim_id='CLM-001',
            seller_id='SELLER-123',
            status='validated',
            claim_type='lost_inventory',
            amount=150.00,
            created_at='2025-01-15T10:00:00',
            updated_at='2025-01-15T10:30:00',
            pipeline_stage='validated',
            validation_status='valid',
            filing_status=None,
            amazon_case_id=None
        )
        
        assert detail.claim_id == 'CLM-001'
        assert detail.pipeline_stage == 'validated'
        assert detail.validation_status == 'valid'
    
    def test_pipeline_stats_model(self):
        """Test PipelineStats model"""
        stats = PipelineStats(
            total_claims=100,
            success_rate=85.0,
            avg_payout_timeline_days=7.5,
            rejection_rate=10.0,
            avg_claim_amount=125.50,
            top_claim_types=[{'type': 'lost_inventory', 'count': 50}],
            marketplace_distribution=[{'marketplace': 'US', 'count': 80}]
        )
        
        assert stats.total_claims == 100
        assert stats.success_rate == 85.0
        assert stats.avg_payout_timeline_days == 7.5
    
    @patch('src.monitoring.router.get_db')
    def test_claims_summary_endpoint(self, mock_get_db):
        """Test claims summary endpoint"""
        # Mock database response
        mock_db = Mock()
        mock_get_db.return_value = iter([mock_db])
        
        # Mock ClaimCRUD methods
        with patch('src.monitoring.router.ClaimCRUD') as mock_claim_crud:
            mock_claim_crud.get_claims_by_status.return_value = {
                'detected': 20,
                'validated': 30,
                'filed': 40,
                'rejected': 5,
                'pending': 5
            }
            mock_claim_crud.get_avg_processing_time.return_value = 2.5
            
            # Test the endpoint
            from fastapi.testclient import TestClient
            from fastapi import FastAPI
            
            app = FastAPI()
            app.include_router(monitoring_router)
            client = TestClient(app)
            
            response = client.get("/claims/summary")
            
            assert response.status_code == 200
            data = response.json()
            assert data['total_claims'] == 100
            assert data['success_rate'] == 40.0
    
    @patch('src.monitoring.router.get_db')
    def test_claim_detail_endpoint(self, mock_get_db):
        """Test claim detail endpoint"""
        # Mock database response
        mock_db = Mock()
        mock_get_db.return_value = iter([mock_db])
        
        # Mock database methods
        with patch('src.monitoring.router.ClaimCRUD') as mock_claim_crud, \
             patch('src.monitoring.router.ValidationCRUD') as mock_validation_crud, \
             patch('src.monitoring.router.FilingCRUD') as mock_filing_crud:
            
            mock_claim_crud.get_claim_by_id.return_value = {
                'claim_id': 'CLM-001',
                'seller_id': 'SELLER-123',
                'status': 'validated',
                'claim_type': 'lost_inventory',
                'amount': 150.00,
                'created_at': '2025-01-15T10:00:00',
                'updated_at': '2025-01-15T10:30:00'
            }
            mock_validation_crud.get_latest_validation_by_claim_id.return_value = {
                'status': 'valid'
            }
            mock_filing_crud.get_filing_by_claim_id.return_value = None
            
            # Test the endpoint
            from fastapi.testclient import TestClient
            from fastapi import FastAPI
            
            app = FastAPI()
            app.include_router(monitoring_router)
            client = TestClient(app)
            
            response = client.get("/claims/CLM-001")
            
            assert response.status_code == 200
            data = response.json()
            assert data['claim_id'] == 'CLM-001'
            assert data['pipeline_stage'] == 'validated'
    
    def test_pipeline_stage_determination(self):
        """Test pipeline stage determination logic"""
        # Test filed stage
        claim = {'status': 'filed'}
        validation = {'status': 'valid'}
        filing = {'status': 'submitted'}
        
        stage = monitoring_router._determine_pipeline_stage(claim, validation, filing)
        assert stage == 'filed'
        
        # Test validated stage
        filing = None
        stage = monitoring_router._determine_pipeline_stage(claim, validation, filing)
        assert stage == 'validated'
        
        # Test rejected stage
        validation = {'status': 'invalid'}
        stage = monitoring_router._determine_pipeline_stage(claim, validation, filing)
        assert stage == 'rejected'
        
        # Test detected stage
        validation = None
        stage = monitoring_router._determine_pipeline_stage(claim, validation, filing)
        assert stage == 'detected'

if __name__ == "__main__":
    pytest.main([__file__, "-v"])

