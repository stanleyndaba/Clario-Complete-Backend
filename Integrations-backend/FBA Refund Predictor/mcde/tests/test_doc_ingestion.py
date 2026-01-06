"""
Unit tests for document ingestion module.
"""
import pytest
import pandas as pd
from unittest.mock import Mock, AsyncMock
from src.data.document_ingestion import DocumentIngestionService


class TestDocumentIngestionService:
    """Test cases for DocumentIngestionService."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.service = DocumentIngestionService()
    
    def test_validate_file_valid(self):
        """Test file validation with valid file."""
        mock_file = Mock()
        mock_file.size = 1024 * 1024  # 1MB
        mock_file.filename = "test.pdf"
        
        # Should not raise exception
        self.service._validate_file(mock_file)
    
    def test_validate_file_too_large(self):
        """Test file validation with oversized file."""
        mock_file = Mock()
        mock_file.size = 100 * 1024 * 1024  # 100MB
        mock_file.filename = "test.pdf"
        
        with pytest.raises(Exception):
            self.service._validate_file(mock_file)
    
    def test_validate_file_unsupported_format(self):
        """Test file validation with unsupported format."""
        mock_file = Mock()
        mock_file.size = 1024 * 1024  # 1MB
        mock_file.filename = "test.txt"
        
        with pytest.raises(Exception):
            self.service._validate_file(mock_file)
    
    def test_validate_file_empty(self):
        """Test file validation with empty file."""
        mock_file = Mock()
        mock_file.size = 0
        mock_file.filename = "test.pdf"
        
        with pytest.raises(Exception):
            self.service._validate_file(mock_file)
    
    @pytest.mark.asyncio
    async def test_extract_metadata_pdf(self):
        """Test PDF metadata extraction."""
        # Mock file path
        file_path = Mock()
        file_path.suffix.lower.return_value = '.pdf'
        file_path.stat.return_value = Mock(
            st_size=1024,
            st_ctime=1234567890,
            st_mtime=1234567890
        )
        
        metadata = await self.service._extract_metadata(file_path, "invoice")
        
        assert "file_size" in metadata
        assert "file_extension" in metadata
        assert "document_type" in metadata
    
    @pytest.mark.asyncio
    async def test_extract_metadata_image(self):
        """Test image metadata extraction."""
        # Mock file path
        file_path = Mock()
        file_path.suffix.lower.return_value = '.jpg'
        file_path.stat.return_value = Mock(
            st_size=1024,
            st_ctime=1234567890,
            st_mtime=1234567890
        )
        
        metadata = await self.service._extract_metadata(file_path, "invoice")
        
        assert "file_size" in metadata
        assert "file_extension" in metadata
        assert "document_type" in metadata 