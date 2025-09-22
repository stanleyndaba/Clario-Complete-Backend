"""
PDF Document Parser
Extracts structured invoice data from PDF documents using layered strategy:
1. First pass: regex + heuristics (fast, cheap)
2. Fallback: ML/OCR (Tesseract, AWS Textract, Google Vision)
"""

import re
import json
import uuid
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
import logging
from dataclasses import dataclass

# PDF processing imports
try:
    import PyPDF2
    import pdfplumber
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

# OCR imports
try:
    import pytesseract
    from PIL import Image
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

logger = logging.getLogger(__name__)

@dataclass
class ParsingResult:
    """Result of document parsing"""
    success: bool
    data: Optional[ParsedInvoiceData] = None
    confidence: float = 0.0
    method: str = "regex"
    error: Optional[str] = None
    processing_time_ms: int = 0

class PDFParser:
    """PDF document parser with layered extraction strategy"""
    
    def __init__(self):
        self.regex_patterns = self._compile_regex_patterns()
    
    def parse_document(self, file_path: str, file_content: bytes = None) -> ParsingResult:
        """Parse PDF document and extract structured invoice data"""
        start_time = datetime.now()
        
        try:
            # Extract text from PDF
            text = self._extract_text_from_pdf(file_path, file_content)
            if not text:
                return ParsingResult(
                    success=False,
                    error="No text extracted from PDF",
                    processing_time_ms=self._get_processing_time_ms(start_time)
                )
            
            # Try regex extraction first
            result = self._extract_with_regex(text)
            if result.success and result.confidence > 0.7:
                result.processing_time_ms = self._get_processing_time_ms(start_time)
                return result
            
            # Fallback to OCR if available
            if OCR_AVAILABLE:
                ocr_result = self._extract_with_ocr(file_path, file_content)
                if ocr_result.success and ocr_result.confidence > result.confidence:
                    ocr_result.processing_time_ms = self._get_processing_time_ms(start_time)
                    return ocr_result
            
            # Fallback to ML if available
            if ML_AVAILABLE:
                ml_result = self._extract_with_ml(file_path, file_content)
                if ml_result.success and ml_result.confidence > result.confidence:
                    ml_result.processing_time_ms = self._get_processing_time_ms(start_time)
                    return ml_result
            
            # Return best result
            result.processing_time_ms = self._get_processing_time_ms(start_time)
            return result
            
        except Exception as e:
            logger.error(f"PDF parsing failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                processing_time_ms=self._get_processing_time_ms(start_time)
            )
    
    def _extract_text_from_pdf(self, file_path: str, file_content: bytes = None) -> str:
        """Extract text from PDF using multiple methods"""
        if not PDF_AVAILABLE:
            raise ImportError("PDF processing libraries not available")
        
        text = ""
        
        try:
            # Try pdfplumber first (better for tables)
            if file_content:
                import io
                with pdfplumber.open(io.BytesIO(file_content)) as pdf:
                    for page in pdf.pages:
                        page_text = page.extract_text()
                        if page_text:
                            text += page_text + "\n"
            else:
                with pdfplumber.open(file_path) as pdf:
                    for page in pdf.pages:
                        page_text = page.extract_text()
                        if page_text:
                            text += page_text + "\n"
        except Exception as e:
            logger.warning(f"pdfplumber failed, trying PyPDF2: {e}")
            
            # Fallback to PyPDF2
            try:
                if file_content:
                    import io
                    pdf_reader = PyPDF2.PdfReader(io.BytesIO(file_content))
                else:
                    pdf_reader = PyPDF2.PdfReader(file_path)
                
                for page in pdf_reader.pages:
                    text += page.extract_text() + "\n"
            except Exception as e2:
                logger.error(f"PyPDF2 also failed: {e2}")
                raise
        
        return text.strip()
    
    def _extract_with_regex(self, text: str) -> ParsingResult:
        """Extract invoice data using regex patterns and heuristics"""
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
                extraction_method="regex",
                confidence_score=self._calculate_regex_confidence(text)
            )
            
            return ParsingResult(
                success=True,
                data=data,
                confidence=data.confidence_score,
                method="regex"
            )
            
        except Exception as e:
            logger.error(f"Regex extraction failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                method="regex"
            )
    
    def _extract_with_ocr(self, file_path: str, file_content: bytes = None) -> ParsingResult:
        """Extract invoice data using OCR"""
        try:
            # Convert PDF to images and run OCR
            images = self._pdf_to_images(file_path, file_content)
            ocr_text = ""
            
            for image in images:
                text = pytesseract.image_to_string(image)
                ocr_text += text + "\n"
            
            # Use regex extraction on OCR text
            result = self._extract_with_regex(ocr_text)
            if result.success:
                result.data.extraction_method = "ocr"
                result.data.raw_text = ocr_text
                result.method = "ocr"
                # OCR typically has lower confidence
                result.confidence = result.confidence * 0.8
            
            return result
            
        except Exception as e:
            logger.error(f"OCR extraction failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                method="ocr"
            )
    
    def _extract_with_ml(self, file_path: str, file_content: bytes = None) -> ParsingResult:
        """Extract invoice data using ML services (AWS Textract, Google Vision)"""
        try:
            # This is a placeholder for ML integration
            # In production, you would integrate with AWS Textract, Google Vision, etc.
            
            # For now, return a basic result
            return ParsingResult(
                success=False,
                error="ML extraction not implemented",
                method="ml"
            )
            
        except Exception as e:
            logger.error(f"ML extraction failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                method="ml"
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
            # Try to normalize date format
            try:
                # Handle various date formats
                for fmt in ['%m/%d/%Y', '%d/%m/%Y', '%Y-%m-%d', '%m-%d-%Y']:
                    try:
                        parsed_date = datetime.strptime(date_str, fmt)
                        return parsed_date.strftime('%Y-%m-%d')
                    except ValueError:
                        continue
                return date_str
            except:
                return date_str
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
        return match.group(1).upper() if match else 'USD'  # Default to USD
    
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
            # This is a simplified implementation
            if re.search(r'\d+\s+[A-Za-z]', line) and '$' in line:
                parts = line.split()
                if len(parts) >= 3:
                    try:
                        qty = int(parts[0])
                        # Find price (last number with $ or decimal)
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
    
    def _calculate_regex_confidence(self, text: str) -> float:
        """Calculate confidence score for regex extraction"""
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
        
        return min(confidence, 1.0)
    
    def _pdf_to_images(self, file_path: str, file_content: bytes = None) -> List[Any]:
        """Convert PDF pages to images for OCR"""
        # This is a placeholder - in production you would use pdf2image or similar
        # For now, return empty list
        return []
    
    def _get_processing_time_ms(self, start_time: datetime) -> int:
        """Calculate processing time in milliseconds"""
        return int((datetime.now() - start_time).total_seconds() * 1000)
