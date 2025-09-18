"""
Email Document Parser
Extracts structured invoice data from email attachments (EML/MSG files)
"""

import re
import json
import uuid
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
import logging
import email
import email.mime.multipart
import email.mime.text
from email.header import decode_header

# Email processing imports
try:
    import msgpack
    MSGPACK_AVAILABLE = True
except ImportError:
    MSGPACK_AVAILABLE = False

from src.api.schemas import ParsedInvoiceData, LineItem

# Conditional imports to avoid circular dependencies
try:
    from src.parsers.pdf_parser import PDFParser, PDF_AVAILABLE
except ImportError:
    PDF_AVAILABLE = False
    PDFParser = None

try:
    from src.parsers.image_parser import ImageParser, OCR_AVAILABLE
except ImportError:
    OCR_AVAILABLE = False
    ImageParser = None

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

class EmailParser:
    """Email document parser for EML/MSG files"""
    
    def __init__(self):
        self.pdf_parser = PDFParser() if PDF_AVAILABLE else None
        self.image_parser = ImageParser() if OCR_AVAILABLE else None
        self.regex_patterns = self._compile_regex_patterns()
    
    def parse_document(self, file_path: str, file_content: bytes = None) -> ParsingResult:
        """Parse email document and extract structured invoice data"""
        start_time = datetime.now()
        
        try:
            # Parse email
            email_data = self._parse_email(file_path, file_content)
            if not email_data:
                return ParsingResult(
                    success=False,
                    error="Failed to parse email",
                    processing_time_ms=self._get_processing_time_ms(start_time)
                )
            
            # Extract invoice data from email body and attachments
            result = self._extract_invoice_data(email_data)
            result.processing_time_ms = self._get_processing_time_ms(start_time)
            return result
            
        except Exception as e:
            logger.error(f"Email parsing failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                processing_time_ms=self._get_processing_time_ms(start_time)
            )
    
    def _parse_email(self, file_path: str, file_content: bytes = None) -> Optional[Dict[str, Any]]:
        """Parse email file and extract metadata"""
        try:
            if file_content:
                msg = email.message_from_bytes(file_content)
            else:
                with open(file_path, 'rb') as f:
                    msg = email.message_from_bytes(f.read())
            
            # Extract email metadata
            email_data = {
                'subject': self._decode_header(msg.get('Subject', '')),
                'from': self._decode_header(msg.get('From', '')),
                'to': self._decode_header(msg.get('To', '')),
                'date': self._decode_header(msg.get('Date', '')),
                'body_text': '',
                'body_html': '',
                'attachments': []
            }
            
            # Extract body content
            if msg.is_multipart():
                for part in msg.walk():
                    content_type = part.get_content_type()
                    content_disposition = part.get('Content-Disposition', '')
                    
                    if content_type == 'text/plain' and 'attachment' not in content_disposition:
                        email_data['body_text'] += self._decode_content(part.get_payload())
                    elif content_type == 'text/html' and 'attachment' not in content_disposition:
                        email_data['body_html'] += self._decode_content(part.get_payload())
                    elif 'attachment' in content_disposition:
                        # Extract attachment
                        filename = part.get_filename()
                        if filename:
                            filename = self._decode_header(filename)
                            attachment_data = {
                                'filename': filename,
                                'content_type': content_type,
                                'content': part.get_payload(decode=True)
                            }
                            email_data['attachments'].append(attachment_data)
            else:
                # Single part message
                content_type = msg.get_content_type()
                if content_type == 'text/plain':
                    email_data['body_text'] = self._decode_content(msg.get_payload())
                elif content_type == 'text/html':
                    email_data['body_html'] = self._decode_content(msg.get_payload())
            
            return email_data
            
        except Exception as e:
            logger.error(f"Email parsing error: {e}")
            return None
    
    def _extract_invoice_data(self, email_data: Dict[str, Any]) -> ParsingResult:
        """Extract invoice data from email body and attachments"""
        try:
            # Combine all text sources
            all_text = ""
            if email_data['body_text']:
                all_text += email_data['body_text'] + "\n"
            if email_data['body_html']:
                # Strip HTML tags for text extraction
                html_text = re.sub(r'<[^>]+>', ' ', email_data['body_html'])
                all_text += html_text + "\n"
            
            # Try to extract from email body first
            body_result = self._extract_from_text(all_text, email_data)
            
            # Check attachments for invoice documents
            attachment_result = self._extract_from_attachments(email_data['attachments'])
            
            # Return the best result
            if attachment_result and attachment_result.confidence > body_result.confidence:
                return attachment_result
            else:
                return body_result
                
        except Exception as e:
            logger.error(f"Invoice data extraction failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                method="email"
            )
    
    def _extract_from_text(self, text: str, email_data: Dict[str, Any]) -> ParsingResult:
        """Extract invoice data from email text"""
        try:
            # Use regex patterns similar to PDF parser
            data = ParsedInvoiceData(
                supplier_name=self._extract_supplier_name(text, email_data),
                invoice_number=self._extract_invoice_number(text),
                invoice_date=self._extract_invoice_date(text, email_data),
                total_amount=self._extract_total_amount(text),
                currency=self._extract_currency(text),
                line_items=self._extract_line_items(text),
                tax_amount=self._extract_tax_amount(text),
                shipping_amount=self._extract_shipping_amount(text),
                payment_terms=self._extract_payment_terms(text),
                po_number=self._extract_po_number(text),
                raw_text=text,
                extraction_method="email_regex",
                confidence_score=self._calculate_email_confidence(text, email_data)
            )
            
            return ParsingResult(
                success=True,
                data=data,
                confidence=data.confidence_score,
                method="email_regex"
            )
            
        except Exception as e:
            logger.error(f"Email text extraction failed: {e}")
            return ParsingResult(
                success=False,
                error=str(e),
                method="email_regex"
            )
    
    def _extract_from_attachments(self, attachments: List[Dict[str, Any]]) -> Optional[ParsingResult]:
        """Extract invoice data from email attachments"""
        best_result = None
        
        for attachment in attachments:
            try:
                filename = attachment['filename'].lower()
                content_type = attachment['content_type']
                content = attachment['content']
                
                # Determine parser based on file type
                if filename.endswith('.pdf') and self.pdf_parser:
                    result = self.pdf_parser.parse_document(None, content)
                elif filename.endswith(('.jpg', '.jpeg', '.png', '.tiff')) and self.image_parser:
                    result = self.image_parser.parse_document(None, content)
                else:
                    continue
                
                if result.success and (not best_result or result.confidence > best_result.confidence):
                    best_result = result
                    
            except Exception as e:
                logger.warning(f"Failed to parse attachment {attachment.get('filename', 'unknown')}: {e}")
                continue
        
        return best_result
    
    def _compile_regex_patterns(self) -> Dict[str, re.Pattern]:
        """Compile regex patterns for email invoice data extraction"""
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
    
    def _extract_supplier_name(self, text: str, email_data: Dict[str, Any]) -> Optional[str]:
        """Extract supplier name from text or email metadata"""
        # Try regex first
        match = self.regex_patterns['supplier_name'].search(text)
        if match:
            return match.group(1).strip()
        
        # Fallback to email sender
        from_addr = email_data.get('from', '')
        if from_addr:
            # Extract name from email address
            name_match = re.search(r'([^<]+)<', from_addr)
            if name_match:
                return name_match.group(1).strip().strip('"')
            else:
                # Extract domain name
                email_match = re.search(r'@([^.]+)', from_addr)
                if email_match:
                    return email_match.group(1).title()
        
        return None
    
    def _extract_invoice_number(self, text: str) -> Optional[str]:
        """Extract invoice number from text"""
        match = self.regex_patterns['invoice_number'].search(text)
        return match.group(1).strip() if match else None
    
    def _extract_invoice_date(self, text: str, email_data: Dict[str, Any]) -> Optional[str]:
        """Extract invoice date from text or email metadata"""
        # Try regex first
        match = self.regex_patterns['invoice_date'].search(text)
        if match:
            date_str = match.group(1).strip()
            return self._normalize_date(date_str)
        
        # Fallback to email date
        email_date = email_data.get('date', '')
        if email_date:
            try:
                # Parse email date header
                from email.utils import parsedate_to_datetime
                parsed_date = parsedate_to_datetime(email_date)
                return parsed_date.strftime('%Y-%m-%d')
            except:
                pass
        
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
        
        # Look for table-like structures in email
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
    
    def _calculate_email_confidence(self, text: str, email_data: Dict[str, Any]) -> float:
        """Calculate confidence score for email extraction"""
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
        
        # Bonus for email-specific indicators
        if 'attachment' in text.lower():
            confidence += 0.1
        
        return min(confidence, 1.0)
    
    def _decode_header(self, header: str) -> str:
        """Decode email header"""
        try:
            decoded_parts = decode_header(header)
            decoded_string = ""
            for part, encoding in decoded_parts:
                if isinstance(part, bytes):
                    if encoding:
                        decoded_string += part.decode(encoding)
                    else:
                        decoded_string += part.decode('utf-8', errors='ignore')
                else:
                    decoded_string += part
            return decoded_string
        except:
            return header
    
    def _decode_content(self, content: str) -> str:
        """Decode email content"""
        try:
            return content.decode('utf-8', errors='ignore')
        except:
            return content
    
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
