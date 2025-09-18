"""
OCR extraction for MCDE.
Extracts text and data from documents using Tesseract and advanced image processing.
"""
import re
import pytesseract
import cv2
import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from src.logger import get_logger, log_document_processing
from src.config import settings

logger = get_logger(__name__)


@dataclass
class OCRResult:
    """OCR extraction result."""
    text: str
    confidence: float
    bounding_boxes: List[Tuple[int, int, int, int]]
    words: List[Dict[str, Any]]
    page_number: int


class OCRExtractionService:
    """Service for OCR text extraction from documents."""
    
    def __init__(self):
        self.confidence_threshold = settings.document.ocr_confidence_threshold
        self.tesseract_config = settings.document.get("ocr_config", "--oem 3 --psm 6")
        self.language = settings.document.get("ocr_language", "eng")
    
    async def extract_text_from_image(
        self,
        image: np.ndarray,
        page_number: int = 1,
        extraction_options: Optional[Dict[str, Any]] = None
    ) -> OCRResult:
        """
        Extract text from image using OCR.
        
        Args:
            image: Input image as numpy array
            page_number: Page number
            extraction_options: Additional extraction options
            
        Returns:
            OCRResult with extracted text and metadata
        """
        try:
            # Preprocess image
            processed_image = await self._preprocess_image(image)
            
            # Extract text with Tesseract
            text_data = pytesseract.image_to_data(
                processed_image,
                output_type=pytesseract.Output.DICT,
                config=self.tesseract_config,
                lang=self.language
            )
            
            # Process OCR results
            words = []
            bounding_boxes = []
            total_confidence = 0
            valid_words = 0
            
            for i in range(len(text_data['text'])):
                text = text_data['text'][i].strip()
                confidence = text_data['conf'][i]
                
                if text and confidence > 0:
                    word_data = {
                        'text': text,
                        'confidence': confidence,
                        'bbox': (
                            text_data['left'][i],
                            text_data['top'][i],
                            text_data['width'][i],
                            text_data['height'][i]
                        )
                    }
                    words.append(word_data)
                    bounding_boxes.append(word_data['bbox'])
                    total_confidence += confidence
                    valid_words += 1
            
            # Calculate average confidence
            avg_confidence = total_confidence / valid_words if valid_words > 0 else 0
            
            # Combine all text
            full_text = ' '.join([word['text'] for word in words])
            
            # Log processing
            log_document_processing(
                document_id=f"page_{page_number}",
                processing_type="ocr_extraction",
                duration=0.0,  # TODO: Add timing
                success=avg_confidence >= self.confidence_threshold,
                error_message=None if avg_confidence >= self.confidence_threshold else "Low confidence"
            )
            
            return OCRResult(
                text=full_text,
                confidence=avg_confidence,
                bounding_boxes=bounding_boxes,
                words=words,
                page_number=page_number
            )
            
        except Exception as e:
            logger.error(f"OCR extraction failed for page {page_number}: {str(e)}")
            return OCRResult(
                text="",
                confidence=0.0,
                bounding_boxes=[],
                words=[],
                page_number=page_number
            )
    
    async def _preprocess_image(self, image: np.ndarray) -> np.ndarray:
        """
        Preprocess image for better OCR results.
        
        Args:
            image: Input image
            
        Returns:
            Preprocessed image
        """
        # Convert to grayscale if needed
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        else:
            gray = image
        
        # Apply noise reduction
        denoised = cv2.fastNlMeansDenoising(gray)
        
        # Apply adaptive thresholding
        thresh = cv2.adaptiveThreshold(
            denoised,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            11,
            2
        )
        
        # Apply morphological operations to clean up
        kernel = np.ones((1, 1), np.uint8)
        cleaned = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        
        return cleaned
    
    async def extract_structured_data(
        self,
        ocr_result: OCRResult
    ) -> Dict[str, Any]:
        """
        Extract structured data from OCR results.
        
        Args:
            ocr_result: OCR extraction result
            
        Returns:
            Dictionary with structured data
        """
        structured_data = {
            "invoice_number": None,
            "date": None,
            "total_amount": None,
            "supplier_name": None,
            "line_items": [],
            "tax_amount": None,
            "currency": None
        }
        
        # Extract invoice number
        invoice_patterns = [
            r'invoice[:\s]*#?\s*([A-Z0-9\-]+)',
            r'inv[:\s]*#?\s*([A-Z0-9\-]+)',
            r'#\s*([A-Z0-9\-]+)'
        ]
        
        for pattern in invoice_patterns:
            match = re.search(pattern, ocr_result.text, re.IGNORECASE)
            if match:
                structured_data["invoice_number"] = match.group(1)
                break
        
        # Extract date
        date_patterns = [
            r'\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})\b',
            r'\b(\d{4}-\d{2}-\d{2})\b',
            r'\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4})\b'
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, ocr_result.text, re.IGNORECASE)
            if match:
                structured_data["date"] = match.group(1)
                break
        
        # Extract total amount
        amount_patterns = [
            r'total[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'amount[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'\$?\s*([\d,]+\.?\d*)\s*(?:total|amount)',
            r'\b\$?\s*([\d,]+\.?\d*)\b'
        ]
        
        for pattern in amount_patterns:
            match = re.search(pattern, ocr_result.text, re.IGNORECASE)
            if match:
                amount_str = match.group(1).replace(',', '')
                try:
                    structured_data["total_amount"] = float(amount_str)
                    break
                except ValueError:
                    continue
        
        # Extract supplier name
        supplier_patterns = [
            r'from[:\s]*(.+?)(?:\n|$)',
            r'supplier[:\s]*(.+?)(?:\n|$)',
            r'vendor[:\s]*(.+?)(?:\n|$)'
        ]
        
        for pattern in supplier_patterns:
            match = re.search(pattern, ocr_result.text, re.IGNORECASE)
            if match:
                structured_data["supplier_name"] = match.group(1).strip()
                break
        
        return structured_data
    
    async def extract_cost_components(
        self,
        ocr_result: OCRResult
    ) -> Dict[str, float]:
        """
        Extract manufacturing cost components from document.
        
        Args:
            ocr_result: OCR extraction result
            
        Returns:
            Dictionary with cost components
        """
        cost_components = {
            "material_cost": 0.0,
            "labor_cost": 0.0,
            "overhead_cost": 0.0,
            "shipping_cost": 0.0,
            "tax_cost": 0.0
        }
        
        text_lower = ocr_result.text.lower()
        
        # Extract material costs
        material_patterns = [
            r'material[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'parts[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'components[:\s]*\$?\s*([\d,]+\.?\d*)'
        ]
        
        for pattern in material_patterns:
            match = re.search(pattern, text_lower)
            if match:
                amount_str = match.group(1).replace(',', '')
                try:
                    cost_components["material_cost"] = float(amount_str)
                    break
                except ValueError:
                    continue
        
        # Extract labor costs
        labor_patterns = [
            r'labor[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'work[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'assembly[:\s]*\$?\s*([\d,]+\.?\d*)'
        ]
        
        for pattern in labor_patterns:
            match = re.search(pattern, text_lower)
            if match:
                amount_str = match.group(1).replace(',', '')
                try:
                    cost_components["labor_cost"] = float(amount_str)
                    break
                except ValueError:
                    continue
        
        # Extract overhead costs
        overhead_patterns = [
            r'overhead[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'admin[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'management[:\s]*\$?\s*([\d,]+\.?\d*)'
        ]
        
        for pattern in overhead_patterns:
            match = re.search(pattern, text_lower)
            if match:
                amount_str = match.group(1).replace(',', '')
                try:
                    cost_components["overhead_cost"] = float(amount_str)
                    break
                except ValueError:
                    continue
        
        # Extract shipping costs
        shipping_patterns = [
            r'shipping[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'freight[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'delivery[:\s]*\$?\s*([\d,]+\.?\d*)'
        ]
        
        for pattern in shipping_patterns:
            match = re.search(pattern, text_lower)
            if match:
                amount_str = match.group(1).replace(',', '')
                try:
                    cost_components["shipping_cost"] = float(amount_str)
                    break
                except ValueError:
                    continue
        
        # Extract tax costs
        tax_patterns = [
            r'tax[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'vat[:\s]*\$?\s*([\d,]+\.?\d*)',
            r'sales\s+tax[:\s]*\$?\s*([\d,]+\.?\d*)'
        ]
        
        for pattern in tax_patterns:
            match = re.search(pattern, text_lower)
            if match:
                amount_str = match.group(1).replace(',', '')
                try:
                    cost_components["tax_cost"] = float(amount_str)
                    break
                except ValueError:
                    continue
        
        return cost_components
    
    async def validate_ocr_quality(
        self,
        ocr_result: OCRResult
    ) -> Dict[str, Any]:
        """
        Validate OCR quality and confidence.
        
        Args:
            ocr_result: OCR extraction result
            
        Returns:
            Dictionary with quality metrics
        """
        quality_metrics = {
            "overall_confidence": ocr_result.confidence,
            "word_count": len(ocr_result.words),
            "avg_word_confidence": 0.0,
            "low_confidence_words": 0,
            "quality_score": 0.0,
            "is_acceptable": False
        }
        
        if ocr_result.words:
            confidences = [word['confidence'] for word in ocr_result.words]
            quality_metrics["avg_word_confidence"] = sum(confidences) / len(confidences)
            quality_metrics["low_confidence_words"] = sum(1 for c in confidences if c < 60)
            
            # Calculate quality score
            quality_score = (
                quality_metrics["overall_confidence"] * 0.4 +
                quality_metrics["avg_word_confidence"] * 0.4 +
                (1 - quality_metrics["low_confidence_words"] / len(ocr_result.words)) * 20
            )
            quality_metrics["quality_score"] = min(quality_score, 100.0)
        
        quality_metrics["is_acceptable"] = (
            quality_metrics["overall_confidence"] >= self.confidence_threshold and
            quality_metrics["quality_score"] >= 70.0
        )
        
        return quality_metrics


# Global service instance
ocr_service = OCRExtractionService() 