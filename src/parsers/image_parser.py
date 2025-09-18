"""
Image Document Parser
Extracts structured invoice data from image files (JPG, PNG, TIFF) using OCR
"""

import re
import json
import uuid
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
import logging
from io import BytesIO

# OCR imports
try:
    import pytesseract
    from PIL import Image, ImageEnhance, ImageFilter
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

# ML imports
try:
    import requests
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False

from src.api.schemas import ParsedInvoiceData, LineItem

# Import ParsingResult from pdf_parser
try:
    from src.parsers.pdf_parser import ParsingResult
except ImportError:
    from dataclasses import dataclass
    from typing import Optional
    
    @dataclass
    class ParsingResult:
        """Result of document parsing"""
        success: bool
        data: Optional[ParsedInvoiceData] = None
        confidence: float = 0.0
        method: str = "regex"
        error: Optional[str] = None
        processing_time_ms: int = 0

logger = logging.getLogger(__name__)

class ImageParser:
    """Image document parser with OCR support"""
    
    def __init__(self):
        self.regex_patterns = self._compile_regex_patterns()
    
    def parse_document(self, file_path: str, file_content: bytes = None) -> ParsingResult:
        """Parse image document and extract structured invoice data"""
        start_time = datetime.now()
        
        try:
            if not OCR_AVAILABLE:
                return ParsingResult(
                    success=False,
                    error="OCR libraries not available",
                    processing_time_ms=self._get_processing_time_ms(start_time)
                )
            
            # Load and preprocess image
            image = self._load_image(file_path, file_content)
            if not image:
                return ParsingResult(
                    success=False,
                    error="Failed to load image",
                    processing_time_ms=self._get_processing_time_ms(start_time)
                )
            
            # Preprocess image for better OCR
            processed_image = self._preprocess_image(image)
            
            # Extract text using OCR
            text = self._extract_text_with_ocr(processed_image)
            if not text:
                return ParsingResult(
                    success=False,
                    error="No text extracted from image",
                    processing_time_ms=self._get_processing_time_ms(start_time)
                )
            
            # Extract invoice data from OCR text
            result = self._extract_invoice_data(text)
            result.processing_time_ms = self._get_processing_time_ms(start_time)
            return result
            
        except Exception as e:
            logger.error(f"Image parsing failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                processing_time_ms=self._get_processing_time_ms(start_time)
            )
    
    def _load_image(self, file_path: str, file_content: bytes = None) -> Optional[Image.Image]:
        """Load image from file or bytes"""
        try:
            if file_content:
                return Image.open(BytesIO(file_content))
            else:
                return Image.open(file_path)
        except Exception as e:
            logger.error(f"Failed to load image: {e}")
            return None
    
    def _preprocess_image(self, image: Image.Image) -> Image.Image:
        """Preprocess image for better OCR results"""
        try:
            # Convert to grayscale
            if image.mode != 'L':
                image = image.convert('L')
            
            # Enhance contrast
            enhancer = ImageEnhance.Contrast(image)
            image = enhancer.enhance(2.0)
            
            # Enhance sharpness
            enhancer = ImageEnhance.Sharpness(image)
            image = enhancer.enhance(2.0)
            
            # Apply slight blur to reduce noise
            image = image.filter(ImageFilter.MedianFilter(size=3))
            
            # Resize if too small (OCR works better on larger images)
            width, height = image.size
            if width < 800 or height < 600:
                scale_factor = max(800 / width, 600 / height)
                new_width = int(width * scale_factor)
                new_height = int(height * scale_factor)
                image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            return image
            
        except Exception as e:
            logger.warning(f"Image preprocessing failed: {e}")
            return image
    
    def _extract_text_with_ocr(self, image: Image.Image) -> str:
        """Extract text from image using OCR"""
        try:
            # Configure Tesseract for better results
            custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,-$/() '
            
            # Extract text
            text = pytesseract.image_to_string(image, config=custom_config)
            
            # Clean up text
            text = self._clean_ocr_text(text)
            
            return text
            
        except Exception as e:
            logger.error(f"OCR extraction failed: {e}")
            return ""
    
    def _clean_ocr_text(self, text: str) -> str:
        """Clean up OCR text"""
        # Remove excessive whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Fix common OCR errors
        text = text.replace('|', 'I')
        text = text.replace('0', 'O')  # Be careful with this one
        text = text.replace('5', 'S')
        
        # Remove lines that are too short (likely noise)
        lines = text.split('\n')
        cleaned_lines = []
        for line in lines:
            line = line.strip()
            if len(line) > 2:  # Keep lines longer than 2 characters
                cleaned_lines.append(line)
        
        return '\n'.join(cleaned_lines)
    
    def _extract_invoice_data(self, text: str) -> ParsingResult:
        """Extract invoice data from OCR text"""
        try:
            data = ParsedInvoiceData(
                supplier_name=self._extract_supplier_name(text),
                invoice_number=self._extract_invoice_number(text),
                invoice_date=self._extract_invoice_date(text),
                total_amount=self._extract_total_amount(text),
                currency=self._extract_currency(text),
                line_items=self._extract_line_items(text),
                tax_amount=self._extract_tax_amount(text),
                shipping_amount=self._extract_shipping_amount(text),
                payment_terms=self._extract_payment_terms(text),
                po_number=self._extract_po_number(text),
                raw_text=text,
                extraction_method="ocr",
                confidence_score=self._calculate_ocr_confidence(text)
            )
            
            return ParsingResult(
                success=True,
                data=data,
                confidence=data.confidence_score,
                method="ocr"
            )
            
        except Exception as e:
            logger.error(f"Invoice data extraction failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                method="ocr"
            )
    
    def _compile_regex_patterns(self) -> Dict[str, re.Pattern]:
        """Compile regex patterns for invoice data extraction"""
        return {
            'supplier_name': re.compile(r'(?:from|vendor|supplier|bill\s+to)[\s:]*([^\n\r]+)', re.IGNORECASE),
            'invoice_number': re.compile(r'(?:invoice|bill|receipt)[\s#:]*([A-Z0-9\-]+)', re.IGNORECASE),
            'invoice_date': re.compile(r'(?:date|invoice\s+date)[\s:]*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})', re.IGNORECASE),
            'total_amount': re.compile(r'(?:total|amount\s+due|grand\s+total)[\s:]*\$?([\d,]+\.?\d*)', re.IGNORECASE),
            'currency': re.compile(r'([A-Z]{3})', re.IGNORECASE),
            'tax_amount': re.compile(r'(?:tax|vat)[\s:]*\$?([\d,]+\.?\d*)', re.IGNORECASE),
            'shipping_amount': re.compile(r'(?:shipping|delivery|freight)[\s:]*\$?([\d,]+\.?\d*)', re.IGNORECASE),
            'payment_terms': re.compile(r'(?:payment\s+terms|terms)[\s:]*([^\n\r]+)', re.IGNORECASE),
            'po_number': re.compile(r'(?:po|purchase\s+order)[\s#:]*([A-Z0-9\-]+)', re.IGNORECASE),
        }
    
    def _extract_supplier_name(self, text: str) -> Optional[str]:
        """Extract supplier name from text"""
        match = self.regex_patterns['supplier_name'].search(text)
        return match.group(1).strip() if match else None
    
    def _extract_invoice_number(self, text: str) -> Optional[str]:
        """Extract invoice number from text"""
        match = self.regex_patterns['invoice_number'].search(text)
        return match.group(1).strip() if match else None
    
    def _extract_invoice_date(self, text: str) -> Optional[str]:
        """Extract invoice date from text"""
        match = self.regex_patterns['invoice_date'].search(text)
        if match:
            date_str = match.group(1).strip()
            return self._normalize_date(date_str)
        return None
    
    def _extract_total_amount(self, text: str) -> Optional[float]:
        """Extract total amount from text"""
        match = self.regex_patterns['total_amount'].search(text)
        if match:
            try:
                amount_str = match.group(1).replace(',', '')
                return float(amount_str)
            except ValueError:
                pass
        return None
    
    def _extract_currency(self, text: str) -> Optional[str]:
        """Extract currency from text"""
        match = self.regex_patterns['currency'].search(text)
        return match.group(1).upper() if match else 'USD'
    
    def _extract_line_items(self, text: str) -> List[LineItem]:
        """Extract line items from text (basic implementation)"""
        line_items = []
        
        # Look for table-like structures
        lines = text.split('\n')
        in_table = False
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Look for quantity, description, price patterns
            if re.search(r'\d+\s+[A-Za-z]', line) and '$' in line:
                parts = line.split()
                if len(parts) >= 3:
                    try:
                        qty = int(parts[0])
                        price_match = re.search(r'\$?([\d,]+\.?\d*)', line)
                        if price_match:
                            unit_price = float(price_match.group(1).replace(',', ''))
                            description = ' '.join(parts[1:-1]) if len(parts) > 3 else 'Item'
                            
                            line_items.append(LineItem(
                                sku=None,
                                description=description,
                                quantity=qty,
                                unit_price=unit_price,
                                total=qty * unit_price
                            ))
                    except (ValueError, IndexError):
                        continue
        
        return line_items
    
    def _extract_tax_amount(self, text: str) -> Optional[float]:
        """Extract tax amount from text"""
        match = self.regex_patterns['tax_amount'].search(text)
        if match:
            try:
                amount_str = match.group(1).replace(',', '')
                return float(amount_str)
            except ValueError:
                pass
        return None
    
    def _extract_shipping_amount(self, text: str) -> Optional[float]:
        """Extract shipping amount from text"""
        match = self.regex_patterns['shipping_amount'].search(text)
        if match:
            try:
                amount_str = match.group(1).replace(',', '')
                return float(amount_str)
            except ValueError:
                pass
        return None
    
    def _extract_payment_terms(self, text: str) -> Optional[str]:
        """Extract payment terms from text"""
        match = self.regex_patterns['payment_terms'].search(text)
        return match.group(1).strip() if match else None
    
    def _extract_po_number(self, text: str) -> Optional[str]:
        """Extract PO number from text"""
        match = self.regex_patterns['po_number'].search(text)
        return match.group(1).strip() if match else None
    
    def _calculate_ocr_confidence(self, text: str) -> float:
        """Calculate confidence score for OCR extraction"""
        confidence = 0.0
        
        # Check for key invoice indicators
        if 'invoice' in text.lower():
            confidence += 0.2
        if 'total' in text.lower():
            confidence += 0.2
        if '$' in text or 'usd' in text.lower():
            confidence += 0.2
        if re.search(r'\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}', text):
            confidence += 0.2
        if re.search(r'\d+\.\d{2}', text):
            confidence += 0.2
        
        # OCR typically has lower confidence than regex
        confidence *= 0.8
        
        return min(confidence, 1.0)
    
    def _normalize_date(self, date_str: str) -> str:
        """Normalize date string to YYYY-MM-DD format"""
        try:
            for fmt in ['%m/%d/%Y', '%d/%m/%Y', '%Y-%m-%d', '%m-%d-%Y']:
                try:
                    parsed_date = datetime.strptime(date_str, fmt)
                    return parsed_date.strftime('%Y-%m-%d')
                except ValueError:
                    continue
            return date_str
        except:
            return date_str
    
    def _get_processing_time_ms(self, start_time: datetime) -> int:
        """Calculate processing time in milliseconds"""
        return int((datetime.now() - start_time).total_seconds() * 1000)
