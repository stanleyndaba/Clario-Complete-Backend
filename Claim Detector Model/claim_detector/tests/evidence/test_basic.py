"""
Basic tests for Evidence & Value Engine
"""
import pytest
from unittest.mock import Mock, patch
from datetime import datetime

from src.evidence.services import (
    StorageService, OCRService, InvoiceParserService, 
    SKUMappingService, LandedCostService, ValueComparisonService
)

class TestStorageService:
    """Test storage service functionality"""
    
    def test_storage_service_initialization(self):
        """Test storage service can be initialized"""
        with patch.dict('os.environ', {'STORAGE_BACKEND': 'supabase'}):
            with patch('src.evidence.storage.create_client'):
                service = StorageService()
                assert service.backend == 'supabase'
    
    def test_file_validation(self):
        """Test file validation"""
        service = StorageService()
        
        # Test valid file
        valid_file = b'%PDF-1.4\n%Test PDF content'
        result = service.validate_file(valid_file, 'application/pdf')
        assert result['is_valid'] is True
        
        # Test invalid file type
        result = service.validate_file(valid_file, 'text/plain')
        assert result['is_valid'] is False
        assert 'Unsupported file type' in result['errors'][0]

class TestOCRService:
    """Test OCR service functionality"""
    
    def test_ocr_service_initialization(self):
        """Test OCR service can be initialized"""
        with patch.dict('os.environ', {}, clear=True):
            service = OCRService()
            assert service.use_textract is False
    
    def test_text_extraction(self):
        """Test text extraction from image"""
        service = OCRService()
        
        # Mock image data
        image_data = b'fake image data'
        
        with patch('src.evidence.ocr.Image.open'):
            with patch('src.evidence.ocr.pytesseract.image_to_string') as mock_tesseract:
                mock_tesseract.return_value = "Sample text from image"
                
                result = service.extract_text(image_data, 'image/png')
                assert result['text'] == "Sample text from image"
                assert result['extraction_method'] == 'tesseract'

class TestInvoiceParserService:
    """Test invoice parser service functionality"""
    
    def test_parser_service_initialization(self):
        """Test parser service can be initialized"""
        service = InvoiceParserService()
        assert service.sku_patterns is not None
        assert service.price_patterns is not None
    
    def test_invoice_parsing(self):
        """Test invoice text parsing"""
        service = InvoiceParserService()
        
        # Sample invoice text
        invoice_text = """
        INVOICE
        
        SKU-001 Sample Product 10 $25.50 $255.00
        SKU-002 Another Product 5 $15.00 $75.00
        
        Subtotal: $330.00
        Tax: $26.40
        Total: $356.40
        """
        
        result = service.parse_invoice_text(invoice_text)
        assert result['currency'] == 'USD'
        assert len(result['line_items']) >= 1
        assert result['totals']['total'] == 356.40

class TestSKUMappingService:
    """Test SKU mapping service functionality"""
    
    def test_mapping_service_initialization(self):
        """Test mapping service can be initialized"""
        service = SKUMappingService()
        assert service.fuzzy_threshold == 0.8
    
    def test_sku_mapping(self):
        """Test SKU mapping functionality"""
        service = SKUMappingService()
        
        # Sample catalog data
        catalog_data = {
            'skus': {
                'SKU-001': {'asin': 'B07XYZ123'},
                'SKU-002': {'asin': 'B08ABC456'}
            }
        }
        
        # Test exact match
        result = service.map_invoice_skus([
            {'raw_sku': 'SKU-001', 'description': 'Test Product'}
        ], catalog_data)
        
        assert result[0]['mapped_sku'] == 'SKU-001'
        assert result[0]['asin'] == 'B07XYZ123'
        assert result[0]['mapping_status'] == 'exact_match'

class TestLandedCostService:
    """Test landed cost service functionality"""
    
    def test_landed_cost_service_initialization(self):
        """Test landed cost service can be initialized"""
        service = LandedCostService()
        assert service.default_allocation_policy['freight_pct'] == 5.00
    
    def test_landed_cost_calculation(self):
        """Test landed cost calculation"""
        service = LandedCostService()
        
        # Sample invoice data
        invoice_data = {
            'line_items': [
                {
                    'mapped_sku': 'SKU-001',
                    'unit_cost': 25.50,
                    'quantity': 10
                }
            ],
            'totals': {
                'total': 255.00
            }
        }
        
        result = service.calculate_landed_costs(invoice_data)
        assert len(result) == 1
        assert result[0]['sku'] == 'SKU-001'
        assert result[0]['landed_per_unit'] > 25.50  # Should include allocations

class TestValueComparisonService:
    """Test value comparison service functionality"""
    
    def test_value_comparison_service_initialization(self):
        """Test value comparison service can be initialized"""
        service = ValueComparisonService()
        assert service.cache_ttl_hours == 24
    
    def test_value_comparison(self):
        """Test value comparison functionality"""
        service = ValueComparisonService()
        
        # Mock landed cost data
        landed_cost_data = {
            'landed_per_unit': 28.75,
            'unit_cost': 25.50
        }
        
        # Mock Amazon default data
        amazon_default_data = {
            'default_value': 22.00
        }
        
        result = service._calculate_comparison(
            'SKU-001', landed_cost_data, amazon_default_data
        )
        
        assert result['sku'] == 'SKU-001'
        assert result['amazon_default'] == 22.00
        assert result['opside_true_value'] == 28.75
        assert result['net_gain'] == 6.75
        assert result['comparison_status'] == 'positive_gain'

class TestIntegration:
    """Integration tests for the complete pipeline"""
    
    def test_complete_invoice_processing_pipeline(self):
        """Test the complete invoice processing pipeline"""
        # This would test the full integration of all services
        # For now, just verify services can work together
        
        # Initialize all services
        storage = StorageService()
        ocr = OCRService()
        parser = InvoiceParserService()
        mapping = SKUMappingService()
        landed_cost = LandedCostService()
        value_compare = ValueComparisonService()
        
        # Verify all services are initialized
        assert storage is not None
        assert ocr is not None
        assert parser is not None
        assert mapping is not None
        assert landed_cost is not None
        assert value_compare is not None
    
    def test_api_endpoint_structure(self):
        """Test that API endpoints are properly structured"""
        from src.evidence.controllers import evidence_router
        
        # Verify router exists
        assert evidence_router is not None
        
        # Verify router has routes
        routes = evidence_router.routes
        assert len(routes) > 0
        
        # Check for key endpoints
        route_paths = [route.path for route in routes if hasattr(route, 'path')]
        assert '/evidence/invoices/upload' in route_paths
        assert '/evidence/value/compare' in route_paths
        assert '/evidence/landed-cost/calculate' in route_paths

if __name__ == "__main__":
    # Run basic tests
    pytest.main([__file__, "-v"])
