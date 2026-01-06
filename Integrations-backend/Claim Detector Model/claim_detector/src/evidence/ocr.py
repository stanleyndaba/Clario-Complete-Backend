"""
OCR service for invoice text extraction
Supports both Tesseract (default) and AWS Textract
"""
import os
import logging
import tempfile
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path
import pytesseract
from PIL import Image
import fitz  # PyMuPDF for PDF processing
import io
import boto3
from botocore.exceptions import ClientError
import json
import re
from datetime import datetime

logger = logging.getLogger(__name__)

class OCRService:
    """OCR service for extracting text from invoices"""
    
    def __init__(self):
        self.use_textract = self._check_textract_available()
        self.textract_client = None
        
        if self.use_textract:
            self._init_textract()
            logger.info("AWS Textract OCR initialized")
        else:
            logger.info("Tesseract OCR initialized (fallback)")
    
    def _check_textract_available(self) -> bool:
        """Check if AWS Textract credentials are available"""
        return all([
            os.getenv('AWS_ACCESS_KEY_ID'),
            os.getenv('AWS_SECRET_ACCESS_KEY'),
            os.getenv('AWS_REGION')
        ])
    
    def _init_textract(self):
        """Initialize AWS Textract client"""
        aws_region = os.getenv('AWS_REGION', 'us-east-1')
        self.textract_client = boto3.client(
            'textract',
            region_name=aws_region
        )
    
    def extract_text(self, file_data: bytes, mime_type: str) -> Dict[str, Any]:
        """
        Extract text from invoice file
        
        Args:
            file_data: File content as bytes
            mime_type: File MIME type
            
        Returns:
            Dict with extracted text and metadata
        """
        try:
            if mime_type == 'application/pdf':
                return self._extract_from_pdf(file_data)
            elif mime_type.startswith('image/'):
                return self._extract_from_image(file_data)
            else:
                raise ValueError(f"Unsupported MIME type: {mime_type}")
        except Exception as e:
            logger.error(f"Text extraction failed: {e}")
            raise
    
    def _extract_from_pdf(self, pdf_data: bytes) -> Dict[str, Any]:
        """Extract text from PDF using PyMuPDF"""
        try:
            # Open PDF document
            doc = fitz.open(stream=pdf_data, filetype="pdf")
            
            extracted_text = []
            page_count = len(doc)
            
            for page_num in range(page_count):
                page = doc.load_page(page_num)
                
                # Extract text from page
                text = page.get_text()
                extracted_text.append({
                    'page': page_num + 1,
                    'text': text,
                    'bbox': page.rect
                })
                
                # If using Textract, also extract images for better OCR
                if self.use_textract:
                    image_list = page.get_images()
                    for img_index, img in enumerate(image_list):
                        xref = img[0]
                        pix = fitz.Pixmap(doc, xref)
                        
                        if pix.n - pix.alpha < 4:  # GRAY or RGB
                            img_data = pix.tobytes("png")
                            # Process image with Textract
                            img_text = self._extract_from_image_with_textract(img_data)
                            if img_text:
                                extracted_text.append({
                                    'page': page_num + 1,
                                    'text': img_text,
                                    'source': 'image',
                                    'image_index': img_index
                                })
                        
                        pix = None
            
            doc.close()
            
            # Combine all text
            full_text = '\n'.join([page['text'] for page in extracted_text if 'source' not in page])
            
            return {
                'text': full_text,
                'pages': extracted_text,
                'page_count': page_count,
                'extraction_method': 'textract' if self.use_textract else 'pymupdf',
                'extracted_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"PDF text extraction failed: {e}")
            raise
    
    def _extract_from_image(self, image_data: bytes) -> Dict[str, Any]:
        """Extract text from image"""
        try:
            if self.use_textract:
                return self._extract_from_image_with_textract(image_data)
            else:
                return self._extract_from_image_with_tesseract(image_data)
        except Exception as e:
            logger.error(f"Image text extraction failed: {e}")
            raise
    
    def _extract_from_image_with_textract(self, image_data: bytes) -> Dict[str, Any]:
        """Extract text from image using AWS Textract"""
        try:
            # Call Textract
            response = self.textract_client.detect_document_text(
                Document={'Bytes': image_data}
            )
            
            # Extract text blocks
            text_blocks = []
            for block in response['Blocks']:
                if block['BlockType'] == 'LINE':
                    text_blocks.append({
                        'text': block['Text'],
                        'confidence': block.get('Confidence', 0),
                        'bbox': block.get('Geometry', {}).get('BoundingBox', {})
                    })
            
            # Combine text
            full_text = '\n'.join([block['text'] for block in text_blocks])
            
            return {
                'text': full_text,
                'blocks': text_blocks,
                'extraction_method': 'textract',
                'confidence': sum([block['confidence'] for block in text_blocks]) / len(text_blocks) if text_blocks else 0,
                'extracted_at': datetime.now().isoformat()
            }
            
        except ClientError as e:
            logger.error(f"Textract API error: {e}")
            # Fallback to Tesseract
            logger.info("Falling back to Tesseract OCR")
            return self._extract_from_image_with_tesseract(image_data)
    
    def _extract_from_image_with_tesseract(self, image_data: bytes) -> Dict[str, Any]:
        """Extract text from image using Tesseract"""
        try:
            # Open image
            image = Image.open(io.BytesIO(image_data))
            
            # Configure Tesseract
            custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,$%()/\- '
            
            # Extract text
            text = pytesseract.image_to_string(image, config=custom_config)
            
            # Get confidence scores (if available)
            data = pytesseract.image_to_data(image, config=custom_config, output_type=pytesseract.Output.DICT)
            confidences = [int(conf) for conf in data['conf'] if int(conf) > 0]
            avg_confidence = sum(confidences) / len(confidences) if confidences else 0
            
            return {
                'text': text,
                'extraction_method': 'tesseract',
                'confidence': avg_confidence,
                'extracted_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Tesseract OCR failed: {e}")
            raise
    
    def extract_invoice_data(self, extracted_text: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract structured invoice data from OCR text
        
        Args:
            extracted_text: Output from extract_text method
            
        Returns:
            Dict with structured invoice data
        """
        try:
            text = extracted_text['text']
            
            # Extract invoice date
            invoice_date = self._extract_invoice_date(text)
            
            # Extract currency
            currency = self._extract_currency(text)
            
            # Extract invoice items
            items = self._extract_invoice_items(text)
            
            # Extract totals
            totals = self._extract_totals(text)
            
            return {
                'invoice_date': invoice_date,
                'currency': currency,
                'items': items,
                'totals': totals,
                'extraction_confidence': extracted_text.get('confidence', 0),
                'extracted_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Invoice data extraction failed: {e}")
            raise
    
    def _extract_invoice_date(self, text: str) -> Optional[str]:
        """Extract invoice date from text"""
        # Common date patterns
        date_patterns = [
            r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})',  # MM/DD/YYYY or DD/MM/YYYY
            r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})',  # YYYY/MM/DD
            r'(\w{3})\s+(\d{1,2}),?\s+(\d{4})',     # Jan 15, 2024
        ]
        
        for pattern in date_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                # Return first match
                return matches[0]
        
        return None
    
    def _extract_currency(self, text: str) -> str:
        """Extract currency from text"""
        currency_patterns = [
            r'USD|US\$|\$',
            r'EUR|€',
            r'GBP|£',
            r'CAD|C\$',
        ]
        
        for pattern in currency_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                if pattern in ['USD', 'US\$', '\$']:
                    return 'USD'
                elif pattern in ['EUR', '€']:
                    return 'EUR'
                elif pattern in ['GBP', '£']:
                    return 'GBP'
                elif pattern in ['CAD', 'C\$']:
                    return 'CAD'
        
        return 'USD'  # Default
    
    def _extract_invoice_items(self, text: str) -> List[Dict[str, Any]]:
        """Extract invoice line items from text"""
        items = []
        
        # Split text into lines
        lines = text.split('\n')
        
        # Look for lines that might contain item information
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Skip header lines and totals
            if any(keyword in line.lower() for keyword in ['invoice', 'total', 'subtotal', 'tax', 'amount']):
                continue
            
            # Try to extract item data
            item = self._parse_line_item(line)
            if item:
                items.append(item)
        
        return items
    
    def _parse_line_item(self, line: str) -> Optional[Dict[str, Any]]:
        """Parse a single line for item information"""
        try:
            # Common patterns for invoice line items
            # Format: SKU/Description Quantity Unit_Cost Total_Cost
            
            # Look for quantity and price patterns
            quantity_price_pattern = r'(\d+)\s+([\d,]+\.?\d*)'
            matches = re.findall(quantity_price_pattern, line)
            
            if len(matches) >= 2:
                quantity = int(matches[0][0])
                unit_cost = float(matches[0][1].replace(',', ''))
                total_cost = float(matches[1][1].replace(',', ''))
                
                # Extract description (everything before quantity)
                description = line[:line.find(matches[0][0])].strip()
                
                # Try to extract SKU (look for alphanumeric patterns)
                sku_pattern = r'([A-Z0-9]{3,20})'
                sku_match = re.search(sku_pattern, description)
                sku = sku_match.group(1) if sku_match else None
                
                return {
                    'raw_sku': sku,
                    'description': description,
                    'quantity': quantity,
                    'unit_cost': unit_cost,
                    'total_cost': total_cost,
                    'confidence': 0.8  # Medium confidence for parsed items
                }
            
            return None
            
        except Exception as e:
            logger.debug(f"Failed to parse line item: {line} - {e}")
            return None
    
    def _extract_totals(self, text: str) -> Dict[str, Any]:
        """Extract invoice totals from text"""
        totals = {}
        
        # Look for total patterns
        total_patterns = {
            'subtotal': r'subtotal[:\s]*([\d,]+\.?\d*)',
            'tax': r'tax[:\s]*([\d,]+\.?\d*)',
            'shipping': r'shipping[:\s]*([\d,]+\.?\d*)',
            'total': r'total[:\s]*([\d,]+\.?\d*)',
        }
        
        for key, pattern in total_patterns.items():
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    totals[key] = float(match.group(1).replace(',', ''))
                except ValueError:
                    continue
        
        return totals
