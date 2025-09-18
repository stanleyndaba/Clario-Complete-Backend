"""
Document ingestion for MCDE.
Handles file uploads, validation, and initial processing.
"""
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import aiofiles
from fastapi import UploadFile, HTTPException
import cv2
import numpy as np
from PIL import Image
import PyPDF2
from pdf2image import convert_from_path
from src.logger import get_logger, log_audit_event
from src.config import settings

logger = get_logger(__name__)


class DocumentIngestionService:
    """Service for handling document ingestion and processing."""
    
    def __init__(self):
        self.supported_formats = settings.document.supported_formats
        self.max_file_size = settings.document.max_file_size
        self.upload_dir = Path("data/raw")
        self.upload_dir.mkdir(parents=True, exist_ok=True)
    
    async def upload_document(
        self,
        file: UploadFile,
        user_id: str,
        document_type: str = "invoice"
    ) -> Dict[str, Any]:
        """
        Upload and validate a document.
        
        Args:
            file: Uploaded file
            user_id: User uploading the document
            document_type: Type of document (invoice, receipt, etc.)
            
        Returns:
            Dictionary with document metadata and processing status
        """
        try:
            # Validate file
            self._validate_file(file)
            
            # Generate unique document ID
            document_id = str(uuid.uuid4())
            
            # Save file
            file_path = await self._save_file(file, document_id)
            
            # Extract metadata
            metadata = await self._extract_metadata(file_path, document_type)
            
            # Log audit event
            log_audit_event(
                user_id=user_id,
                action="document_upload",
                details={
                    "document_id": document_id,
                    "filename": file.filename,
                    "file_size": file.size,
                    "document_type": document_type
                }
            )
            
            logger.info(f"Document uploaded successfully: {document_id}")
            
            return {
                "document_id": document_id,
                "filename": file.filename,
                "file_path": str(file_path),
                "document_type": document_type,
                "metadata": metadata,
                "status": "uploaded",
                "uploaded_at": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Document upload failed: {str(e)}")
            raise HTTPException(status_code=400, detail=str(e))
    
    def _validate_file(self, file: UploadFile) -> None:
        """
        Validate uploaded file.
        
        Args:
            file: Uploaded file to validate
            
        Raises:
            HTTPException: If file is invalid
        """
        # Check file size
        if file.size > self.max_file_size:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size: {self.max_file_size} bytes"
            )
        
        # Check file format
        file_extension = Path(file.filename).suffix.lower().lstrip('.')
        if file_extension not in self.supported_formats:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format. Supported: {self.supported_formats}"
            )
        
        # Check if file is empty
        if file.size == 0:
            raise HTTPException(status_code=400, detail="File is empty")
    
    async def _save_file(self, file: UploadFile, document_id: str) -> Path:
        """
        Save uploaded file to disk.
        
        Args:
            file: Uploaded file
            document_id: Unique document identifier
            
        Returns:
            Path to saved file
        """
        file_extension = Path(file.filename).suffix.lower()
        file_path = self.upload_dir / f"{document_id}{file_extension}"
        
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        logger.info(f"File saved: {file_path}")
        return file_path
    
    async def _extract_metadata(self, file_path: Path, document_type: str) -> Dict[str, Any]:
        """
        Extract metadata from uploaded file.
        
        Args:
            file_path: Path to the file
            document_type: Type of document
            
        Returns:
            Dictionary with extracted metadata
        """
        metadata = {
            "file_size": file_path.stat().st_size,
            "file_extension": file_path.suffix.lower(),
            "document_type": document_type,
            "created_at": datetime.fromtimestamp(file_path.stat().st_ctime).isoformat(),
            "modified_at": datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()
        }
        
        # Extract additional metadata based on file type
        if file_path.suffix.lower() == '.pdf':
            metadata.update(await self._extract_pdf_metadata(file_path))
        elif file_path.suffix.lower() in ['.jpg', '.jpeg', '.png', '.tiff']:
            metadata.update(await self._extract_image_metadata(file_path))
        
        return metadata
    
    async def _extract_pdf_metadata(self, file_path: Path) -> Dict[str, Any]:
        """
        Extract metadata from PDF file.
        
        Args:
            file_path: Path to PDF file
            
        Returns:
            Dictionary with PDF metadata
        """
        try:
            with open(file_path, 'rb') as f:
                pdf_reader = PyPDF2.PdfReader(f)
                
                metadata = {
                    "page_count": len(pdf_reader.pages),
                    "pdf_version": pdf_reader.pdf_header,
                    "is_encrypted": pdf_reader.is_encrypted
                }
                
                # Extract text from first page for basic info
                if len(pdf_reader.pages) > 0:
                    first_page = pdf_reader.pages[0]
                    text = first_page.extract_text()
                    metadata["first_page_text_length"] = len(text)
                
                return metadata
                
        except Exception as e:
            logger.warning(f"Failed to extract PDF metadata: {str(e)}")
            return {"error": str(e)}
    
    async def _extract_image_metadata(self, file_path: Path) -> Dict[str, Any]:
        """
        Extract metadata from image file.
        
        Args:
            file_path: Path to image file
            
        Returns:
            Dictionary with image metadata
        """
        try:
            with Image.open(file_path) as img:
                metadata = {
                    "image_width": img.width,
                    "image_height": img.height,
                    "image_mode": img.mode,
                    "image_format": img.format
                }
                
                # Convert to RGB if needed for processing
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # Basic image analysis
                img_array = np.array(img)
                metadata["image_channels"] = img_array.shape[2] if len(img_array.shape) > 2 else 1
                
                return metadata
                
        except Exception as e:
            logger.warning(f"Failed to extract image metadata: {str(e)}")
            return {"error": str(e)}
    
    async def process_document(
        self,
        document_id: str,
        file_path: Path,
        processing_options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Process uploaded document for OCR and feature extraction.
        
        Args:
            document_id: Unique document identifier
            file_path: Path to the document
            processing_options: Additional processing options
            
        Returns:
            Dictionary with processing results
        """
        try:
            logger.info(f"Starting document processing: {document_id}")
            
            # Convert document to images for OCR
            images = await self._convert_to_images(file_path)
            
            # Process each page
            results = []
            for i, image in enumerate(images):
                page_result = await self._process_page(image, i + 1)
                results.append(page_result)
            
            # Combine results
            combined_result = {
                "document_id": document_id,
                "total_pages": len(images),
                "pages": results,
                "processing_status": "completed",
                "processed_at": datetime.utcnow().isoformat()
            }
            
            logger.info(f"Document processing completed: {document_id}")
            return combined_result
            
        except Exception as e:
            logger.error(f"Document processing failed: {document_id} - {str(e)}")
            return {
                "document_id": document_id,
                "processing_status": "failed",
                "error": str(e),
                "processed_at": datetime.utcnow().isoformat()
            }
    
    async def _convert_to_images(self, file_path: Path) -> List[np.ndarray]:
        """
        Convert document to list of images for processing.
        
        Args:
            file_path: Path to the document
            
        Returns:
            List of images as numpy arrays
        """
        images = []
        
        if file_path.suffix.lower() == '.pdf':
            # Convert PDF to images
            pdf_images = convert_from_path(
                str(file_path),
                dpi=settings.document.dpi,
                fmt='JPEG'
            )
            
            for img in pdf_images:
                # Convert PIL image to numpy array
                img_array = np.array(img)
                images.append(img_array)
                
        else:
            # Load single image
            img = cv2.imread(str(file_path))
            if img is not None:
                # Convert BGR to RGB
                img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                images.append(img_rgb)
        
        return images
    
    async def _process_page(
        self,
        image: np.ndarray,
        page_number: int
    ) -> Dict[str, Any]:
        """
        Process a single page image.
        
        Args:
            image: Page image as numpy array
            page_number: Page number
            
        Returns:
            Dictionary with page processing results
        """
        # Resize image if needed
        height, width = image.shape[:2]
        if width > settings.document.resize_width or height > settings.document.resize_height:
            scale = min(
                settings.document.resize_width / width,
                settings.document.resize_height / height
            )
            new_width = int(width * scale)
            new_height = int(height * scale)
            image = cv2.resize(image, (new_width, new_height))
        
        return {
            "page_number": page_number,
            "image_width": image.shape[1],
            "image_height": image.shape[0],
            "image_channels": image.shape[2] if len(image.shape) > 2 else 1,
            "processing_status": "ready_for_ocr"
        }


# Global service instance
document_service = DocumentIngestionService() 