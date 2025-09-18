"""
Parser service for converting OCR text to structured invoice items
"""
import logging
import re
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from decimal import Decimal
import json

logger = logging.getLogger(__name__)

class InvoiceParserService:
    """Service for parsing OCR text into structured invoice data"""
    
    def __init__(self):
        # Common patterns for invoice parsing
        self.sku_patterns = [
            r'\b([A-Z0-9]{3,20})\b',  # Alphanumeric SKU
            r'\b([A-Z]{2,4}-\d{3,6})\b',  # Format: XX-123
            r'\b([A-Z]{2,4}\d{3,6})\b',   # Format: XX123
        ]
        
        self.price_patterns = [
            r'\$?([\d,]+\.?\d*)',  # $123.45 or 123.45
            r'([\d,]+\.?\d*)\s*USD',  # 123.45 USD
        ]
        
        self.quantity_patterns = [
            r'\b(\d+)\s*(?:pcs?|pieces?|units?|qty|quantity)',  # 5 pcs, 10 pieces
            r'\b(\d+)\s*[xX]\s*',  # 5 x $10.00
            r'\b(\d+)\s*@\s*',      # 5 @ $10.00
        ]
        
        self.date_patterns = [
            r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})',  # MM/DD/YYYY
            r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})',    # YYYY/MM/DD
            r'(\w{3})\s+(\d{1,2}),?\s+(\d{4})',       # Jan 15, 2024
        ]
    
    def parse_invoice_text(self, ocr_text: str, confidence_threshold: float = 0.6) -> Dict[str, Any]:
        """
        Parse OCR text into structured invoice data
        
        Args:
            ocr_text: Raw OCR text
            confidence_threshold: Minimum confidence for extracted items
            
        Returns:
            Dict with parsed invoice data
        """
        try:
            # Clean and normalize text
            cleaned_text = self._clean_text(ocr_text)
            
            # Extract invoice metadata
            invoice_date = self._extract_invoice_date(cleaned_text)
            currency = self._extract_currency(cleaned_text)
            
            # Extract line items
            line_items = self._extract_line_items(cleaned_text, confidence_threshold)
            
            # Extract totals
            totals = self._extract_totals(cleaned_text)
            
            # Calculate summary statistics
            summary = self._calculate_summary(line_items, totals)
            
            return {
                'invoice_date': invoice_date,
                'currency': currency,
                'line_items': line_items,
                'totals': totals,
                'summary': summary,
                'parsed_at': datetime.now().isoformat(),
                'confidence_score': self._calculate_overall_confidence(line_items)
            }
            
        except Exception as e:
            logger.error(f"Invoice parsing failed: {e}")
            raise
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize OCR text"""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Remove common OCR artifacts
        text = re.sub(r'[|\\/]', 'I', text)  # Common OCR mistakes
        text = re.sub(r'[0O]', '0', text)    # Number vs letter confusion
        
        # Normalize line breaks
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        
        return text.strip()
    
    def _extract_invoice_date(self, text: str) -> Optional[str]:
        """Extract invoice date from text"""
        for pattern in self.date_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                match = matches[0]
                try:
                    if len(match[0]) == 4:  # YYYY-MM-DD format
                        year, month, day = match
                    else:  # MM-DD-YYYY format
                        month, day, year = match
                    
                    # Validate date components
                    if int(month) <= 12 and int(day) <= 31 and int(year) >= 1900:
                        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
                except (ValueError, IndexError):
                    continue
        
        return None
    
    def _extract_currency(self, text: str) -> str:
        """Extract currency from text"""
        currency_patterns = {
            'USD': [r'USD|US\$|\$', r'\$\s*\d'],
            'EUR': [r'EUR|€', r'€\s*\d'],
            'GBP': [r'GBP|£', r'£\s*\d'],
            'CAD': [r'CAD|C\$', r'C\$\s*\d'],
        }
        
        for currency, patterns in currency_patterns.items():
            for pattern in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    return currency
        
        return 'USD'  # Default currency
    
    def _extract_line_items(self, text: str, confidence_threshold: float) -> List[Dict[str, Any]]:
        """Extract line items from invoice text"""
        line_items = []
        
        # Split into lines and process each line
        lines = text.split('\n')
        
        for line_num, line in enumerate(lines):
            line = line.strip()
            if not line or len(line) < 10:  # Skip very short lines
                continue
            
            # Skip header/footer lines
            if self._is_header_or_footer(line):
                continue
            
            # Try to parse line as item
            item = self._parse_line_as_item(line, line_num + 1)
            if item and item.get('confidence', 0) >= confidence_threshold:
                line_items.append(item)
        
        return line_items
    
    def _is_header_or_footer(self, line: str) -> bool:
        """Check if line is a header or footer"""
        header_footer_keywords = [
            'invoice', 'bill', 'statement', 'total', 'subtotal', 'tax',
            'shipping', 'handling', 'amount', 'due', 'balance', 'page',
            'date', 'number', 'reference', 'po', 'purchase order'
        ]
        
        line_lower = line.lower()
        return any(keyword in line_lower for keyword in header_footer_keywords)
    
    def _parse_line_as_item(self, line: str, line_number: int) -> Optional[Dict[str, Any]]:
        """Parse a single line as an invoice item"""
        try:
            # Extract SKU
            sku = self._extract_sku(line)
            
            # Extract quantity
            quantity = self._extract_quantity(line)
            
            # Extract unit cost
            unit_cost = self._extract_unit_cost(line)
            
            # Extract total cost
            total_cost = self._extract_total_cost(line)
            
            # Extract description
            description = self._extract_description(line, sku, quantity, unit_cost, total_cost)
            
            # Calculate confidence based on extracted data
            confidence = self._calculate_item_confidence(line, sku, quantity, unit_cost, total_cost)
            
            # Only return item if we have at least some key data
            if quantity or unit_cost or total_cost:
                return {
                    'line_number': line_number,
                    'raw_sku': sku,
                    'description': description,
                    'quantity': quantity,
                    'unit_cost': unit_cost,
                    'total_cost': total_cost,
                    'confidence': confidence,
                    'raw_line': line
                }
            
            return None
            
        except Exception as e:
            logger.debug(f"Failed to parse line {line_number}: {line} - {e}")
            return None
    
    def _extract_sku(self, line: str) -> Optional[str]:
        """Extract SKU from line"""
        for pattern in self.sku_patterns:
            matches = re.findall(pattern, line)
            if matches:
                # Return the longest match (likely the actual SKU)
                return max(matches, key=len)
        return None
    
    def _extract_quantity(self, line: str) -> Optional[int]:
        """Extract quantity from line"""
        # Try specific quantity patterns first
        for pattern in self.quantity_patterns:
            matches = re.findall(pattern, line, re.IGNORECASE)
            if matches:
                try:
                    return int(matches[0])
                except (ValueError, IndexError):
                    continue
        
        # Fallback: look for numbers that might be quantities
        # (but not prices - avoid extracting prices as quantities)
        numbers = re.findall(r'\b(\d+)\b', line)
        if numbers:
            # Heuristic: if there are multiple numbers, the first might be quantity
            # and the last might be total price
            if len(numbers) >= 2:
                try:
                    return int(numbers[0])
                except ValueError:
                    pass
        
        return None
    
    def _extract_unit_cost(self, line: str) -> Optional[Decimal]:
        """Extract unit cost from line"""
        # Look for price patterns that might be unit costs
        prices = re.findall(r'\$?([\d,]+\.?\d*)', line)
        
        if len(prices) >= 2:
            # If multiple prices, the first might be unit cost
            try:
                return Decimal(prices[0].replace(',', ''))
            except (ValueError, IndexError):
                pass
        
        return None
    
    def _extract_total_cost(self, line: str) -> Optional[Decimal]:
        """Extract total cost from line"""
        # Look for price patterns
        prices = re.findall(r'\$?([\d,]+\.?\d*)', line)
        
        if prices:
            # If multiple prices, the last might be total cost
            try:
                return Decimal(prices[-1].replace(',', ''))
            except (ValueError, IndexError):
                pass
        
        return None
    
    def _extract_description(self, line: str, sku: Optional[str], 
                           quantity: Optional[int], unit_cost: Optional[Decimal], 
                           total_cost: Optional[Decimal]) -> str:
        """Extract item description from line"""
        # Remove extracted components to get description
        description = line
        
        # Remove SKU if found
        if sku:
            description = description.replace(sku, '').strip()
        
        # Remove quantity if found
        if quantity:
            quantity_str = str(quantity)
            description = description.replace(quantity_str, '').strip()
        
        # Remove unit cost if found
        if unit_cost:
            unit_cost_str = f"${unit_cost}"
            description = description.replace(unit_cost_str, '').strip()
        
        # Remove total cost if found
        if total_cost:
            total_cost_str = f"${total_cost}"
            description = description.replace(total_cost_str, '').strip()
        
        # Clean up extra whitespace and punctuation
        description = re.sub(r'\s+', ' ', description)
        description = re.sub(r'^[^\w]*|[^\w]*$', '', description)
        
        return description.strip() if description.strip() else "No description"
    
    def _calculate_item_confidence(self, line: str, sku: Optional[str], 
                                 quantity: Optional[int], unit_cost: Optional[Decimal], 
                                 total_cost: Optional[Decimal]) -> float:
        """Calculate confidence score for extracted item"""
        confidence = 0.0
        
        # Base confidence for having a line
        confidence += 0.1
        
        # Add confidence for each extracted field
        if sku:
            confidence += 0.2
        if quantity:
            confidence += 0.2
        if unit_cost:
            confidence += 0.2
        if total_cost:
            confidence += 0.2
        
        # Bonus for having description
        if line.strip() and len(line.strip()) > 10:
            confidence += 0.1
        
        # Penalty for very short lines
        if len(line.strip()) < 15:
            confidence -= 0.1
        
        return min(1.0, max(0.0, confidence))
    
    def _extract_totals(self, text: str) -> Dict[str, Any]:
        """Extract invoice totals from text"""
        totals = {}
        
        # Look for total patterns
        total_patterns = {
            'subtotal': [
                r'subtotal[:\s]*\$?([\d,]+\.?\d*)',
                r'sub\s*total[:\s]*\$?([\d,]+\.?\d*)'
            ],
            'tax': [
                r'tax[:\s]*\$?([\d,]+\.?\d*)',
                r'sales\s*tax[:\s]*\$?([\d,]+\.?\d*)'
            ],
            'shipping': [
                r'shipping[:\s]*\$?([\d,]+\.?\d*)',
                r'freight[:\s]*\$?([\d,]+\.?\d*)',
                r'delivery[:\s]*\$?([\d,]+\.?\d*)'
            ],
            'total': [
                r'total[:\s]*\$?([\d,]+\.?\d*)',
                r'amount\s*due[:\s]*\$?([\d,]+\.?\d*)',
                r'grand\s*total[:\s]*\$?([\d,]+\.?\d*)'
            ]
        }
        
        for key, patterns in total_patterns.items():
            for pattern in patterns:
                matches = re.findall(pattern, text, re.IGNORECASE)
                if matches:
                    try:
                        totals[key] = Decimal(matches[0].replace(',', ''))
                        break  # Use first match
                    except (ValueError, IndexError):
                        continue
        
        return totals
    
    def _calculate_summary(self, line_items: List[Dict[str, Any]], 
                          totals: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate summary statistics for invoice"""
        summary = {
            'item_count': len(line_items),
            'total_quantity': 0,
            'calculated_subtotal': Decimal('0.00'),
            'extracted_totals': totals
        }
        
        # Calculate totals from line items
        for item in line_items:
            if item.get('quantity'):
                summary['total_quantity'] += item['quantity']
            
            if item.get('total_cost'):
                summary['calculated_subtotal'] += item['total_cost']
        
        # Compare calculated vs extracted totals
        if 'subtotal' in totals:
            summary['subtotal_match'] = abs(summary['calculated_subtotal'] - totals['subtotal']) < Decimal('0.01')
        
        return summary
    
    def _calculate_overall_confidence(self, line_items: List[Dict[str, Any]]) -> float:
        """Calculate overall confidence for the entire invoice"""
        if not line_items:
            return 0.0
        
        total_confidence = sum(item.get('confidence', 0) for item in line_items)
        return total_confidence / len(line_items)
