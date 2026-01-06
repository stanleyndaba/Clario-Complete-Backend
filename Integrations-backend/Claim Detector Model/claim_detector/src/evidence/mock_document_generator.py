"""
Mock Document Generator for Evidence Agent
Generates deterministic, realistic mock documents (invoices, receipts, shipping logs)
based on claim data. Uses seed-based generation for reproducibility.
"""

import json
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import logging
import random
import math

logger = logging.getLogger(__name__)


class MockDocumentGenerator:
    """Generates mock documents for evidence matching"""
    
    def __init__(self, seed: Optional[int] = None):
        """Initialize with optional seed for reproducibility"""
        self.seed = seed or 42
        random.seed(self.seed)
        
        # Mock supplier names
        self.suppliers = [
            "Global Supplies Inc",
            "Wholesale Distributors LLC",
            "Premium Products Co",
            "International Trading Group",
            "Direct Source Manufacturing",
            "Bulk Import Export Ltd",
            "Quality Goods Supply",
            "Merchant Solutions Inc"
        ]
        
        # Mock carrier names
        self.carriers = ["UPS", "FedEx", "USPS", "DHL", "Amazon Logistics"]
    
    def _get_claim_seed(self, claim_id: str) -> int:
        """Generate deterministic seed from claim_id"""
        hash_obj = hashlib.md5(claim_id.encode())
        return int(hash_obj.hexdigest()[:8], 16)
    
    def _safe_get_order_id(self, claim_data: Dict[str, Any]) -> str:
        """Safely extract order_id, handling empty/NaN values"""
        order_id_raw = claim_data.get('order_id', '')
        if not order_id_raw or (isinstance(order_id_raw, float) and math.isnan(order_id_raw)):
            return f"ORDER-{claim_data.get('claim_id', 'UNKNOWN')[:8]}"
        return str(order_id_raw)
    
    def generate_invoice(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate mock invoice document based on claim data
        
        Args:
            claim_data: Claim data from Discovery Agent
            
        Returns:
            Invoice document with metadata and extracted text
        """
        # Use claim_id for deterministic generation
        claim_seed = self._get_claim_seed(claim_data.get('claim_id', 'default'))
        random.seed(claim_seed)
        
        # Extract claim info
        sku = claim_data.get('sku', 'UNKNOWN-SKU')
        asin = claim_data.get('asin', 'B000000000')
        amount = float(claim_data.get('amount', 0))
        quantity = int(claim_data.get('quantity', 1))
        order_id = self._safe_get_order_id(claim_data)
        order_date_str = claim_data.get('order_date', datetime.now().isoformat())
        
        # Parse order date
        try:
            if 'T' in order_date_str:
                order_date = datetime.fromisoformat(order_date_str.replace('Z', '+00:00'))
            else:
                order_date = datetime.strptime(order_date_str, '%Y-%m-%d')
        except:
            order_date = datetime.now() - timedelta(days=30)
        
        # Generate invoice date (typically 1-7 days before order)
        invoice_date = order_date - timedelta(days=random.randint(1, 7))
        
        # Select supplier deterministically
        supplier_idx = claim_seed % len(self.suppliers)
        supplier_name = self.suppliers[supplier_idx]
        
        # Generate invoice number
        invoice_number = f"INV-{order_id[-8:]}-{invoice_date.strftime('%Y%m%d')}"
        
        # Calculate unit price
        unit_price = amount / quantity if quantity > 0 else amount
        
        # Generate invoice text
        invoice_text = f"""
INVOICE

From: {supplier_name}
Invoice Number: {invoice_number}
Invoice Date: {invoice_date.strftime('%m/%d/%Y')}
Purchase Order: PO-{order_id[-6:]}

Bill To:
Amazon FBA Seller
Order ID: {order_id}

Line Items:
Quantity: {quantity}
SKU: {sku}
ASIN: {asin}
Description: Product for order {order_id}
Unit Price: ${unit_price:.2f}
Total: ${amount:.2f}

Subtotal: ${amount:.2f}
Tax: ${(amount * 0.08):.2f}
Shipping: ${claim_data.get('shipping_cost', 0):.2f}
Grand Total: ${(amount * 1.08 + claim_data.get('shipping_cost', 0)):.2f}

Payment Terms: Net 30
Currency: USD

Thank you for your business!
"""
        
        # Create invoice document
        invoice_doc = {
            "document_type": "invoice",
            "document_id": f"INV-{claim_data.get('claim_id', 'UNKNOWN')}",
            "metadata": {
                "supplier_name": supplier_name,
                "invoice_number": invoice_number,
                "invoice_date": invoice_date.strftime('%Y-%m-%d'),
                "order_id": order_id,
                "order_date": order_date.strftime('%Y-%m-%d'),
                "sku": sku,
                "asin": asin,
                "quantity": quantity,
                "unit_price": round(unit_price, 2),
                "total_amount": round(amount, 2),
                "currency": "USD",
                "po_number": f"PO-{order_id[-6:]}",
                "file_type": "pdf",
                "file_size_mb": round(random.uniform(0.5, 2.5), 2),
                "created_at": invoice_date.isoformat()
            },
            "extracted_text": invoice_text.strip(),
            "parsed_metadata": {
                "supplier_name": supplier_name,
                "invoice_number": invoice_number,
                "invoice_date": invoice_date.strftime('%Y-%m-%d'),
                "total_amount": round(amount, 2),
                "currency": "USD",
                "line_items": [
                    {
                        "sku": sku,
                        "asin": asin,
                        "description": f"Product for order {order_id}",
                        "quantity": quantity,
                        "unit_price": round(unit_price, 2),
                        "total": round(amount, 2)
                    }
                ],
                "po_number": f"PO-{order_id[-6:]}",
                "payment_terms": "Net 30"
            },
            "confidence": 0.95,
            "extraction_method": "regex"
        }
        
        return invoice_doc
    
    def generate_receipt(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate mock receipt document"""
        claim_seed = self._get_claim_seed(claim_data.get('claim_id', 'default'))
        random.seed(claim_seed)
        
        sku = claim_data.get('sku', 'UNKNOWN-SKU')
        amount = float(claim_data.get('amount', 0))
        order_id = self._safe_get_order_id(claim_data)
        order_date_str = claim_data.get('order_date', datetime.now().isoformat())
        
        try:
            if 'T' in order_date_str:
                order_date = datetime.fromisoformat(order_date_str.replace('Z', '+00:00'))
            else:
                order_date = datetime.strptime(order_date_str, '%Y-%m-%d')
        except:
            order_date = datetime.now() - timedelta(days=30)
        
        receipt_date = order_date - timedelta(days=random.randint(1, 3))
        receipt_number = f"RCP-{order_id[-8:]}-{receipt_date.strftime('%Y%m%d')}"
        
        supplier_idx = claim_seed % len(self.suppliers)
        supplier_name = self.suppliers[supplier_idx]
        
        receipt_text = f"""
RECEIPT

Receipt Number: {receipt_number}
Date: {receipt_date.strftime('%m/%d/%Y')}
Order ID: {order_id}

Vendor: {supplier_name}
SKU: {sku}

Amount Paid: ${amount:.2f}
Payment Method: Wire Transfer
Transaction ID: TXN-{order_id[-10:]}

Thank you!
"""
        
        receipt_doc = {
            "document_type": "receipt",
            "document_id": f"RCP-{claim_data.get('claim_id', 'UNKNOWN')}",
            "metadata": {
                "supplier_name": supplier_name,
                "receipt_number": receipt_number,
                "receipt_date": receipt_date.strftime('%Y-%m-%d'),
                "order_id": order_id,
                "amount": round(amount, 2),
                "currency": "USD",
                "file_type": "pdf",
                "file_size_mb": round(random.uniform(0.3, 1.5), 2)
            },
            "extracted_text": receipt_text.strip(),
            "parsed_metadata": {
                "supplier_name": supplier_name,
                "receipt_number": receipt_number,
                "receipt_date": receipt_date.strftime('%Y-%m-%d'),
                "amount": round(amount, 2),
                "order_id": order_id
            },
            "confidence": 0.92,
            "extraction_method": "regex"
        }
        
        return receipt_doc
    
    def generate_shipping_log(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate mock shipping log/document"""
        claim_seed = self._get_claim_seed(claim_data.get('claim_id', 'default'))
        random.seed(claim_seed)
        
        sku = claim_data.get('sku', 'UNKNOWN-SKU')
        quantity = int(claim_data.get('quantity', 1))
        order_id = self._safe_get_order_id(claim_data)
        order_date_str = claim_data.get('order_date', datetime.now().isoformat())
        fulfillment_center = claim_data.get('fulfillment_center', 'FBA1')
        
        try:
            if 'T' in order_date_str:
                order_date = datetime.fromisoformat(order_date_str.replace('Z', '+00:00'))
            else:
                order_date = datetime.strptime(order_date_str, '%Y-%m-%d')
        except:
            order_date = datetime.now() - timedelta(days=30)
        
        # Shipping dates
        ship_date = order_date - timedelta(days=random.randint(5, 10))
        delivery_date = order_date - timedelta(days=random.randint(1, 3))
        
        # Generate tracking number (use last 16 chars or pad if shorter)
        order_id_suffix = order_id[-16:] if len(order_id) >= 16 else order_id.upper().ljust(16, '0')
        tracking_number = f"1Z-{order_id_suffix}"
        
        # Select carrier
        carrier_idx = claim_seed % len(self.carriers)
        carrier = self.carriers[carrier_idx]
        
        shipping_text = f"""
SHIPPING MANIFEST

Carrier: {carrier}
Tracking Number: {tracking_number}
Ship Date: {ship_date.strftime('%m/%d/%Y')}
Expected Delivery: {delivery_date.strftime('%m/%d/%Y')}

Ship To:
Amazon FBA
Fulfillment Center: {fulfillment_center}
Order ID: {order_id}

Items Shipped:
SKU: {sku}
Quantity: {quantity}
Weight: {quantity * 2.5:.1f} lbs
Dimensions: 12x8x6 in

Status: Delivered
Delivery Confirmation: {delivery_date.strftime('%m/%d/%Y %H:%M')}
"""
        
        shipping_doc = {
            "document_type": "shipping_log",
            "document_id": f"SHIP-{claim_data.get('claim_id', 'UNKNOWN')}",
            "metadata": {
                "carrier": carrier,
                "tracking_number": tracking_number,
                "ship_date": ship_date.strftime('%Y-%m-%d'),
                "delivery_date": delivery_date.strftime('%Y-%m-%d'),
                "order_id": order_id,
                "sku": sku,
                "quantity": quantity,
                "fulfillment_center": fulfillment_center,
                "file_type": "pdf",
                "file_size_mb": round(random.uniform(0.4, 1.8), 2)
            },
            "extracted_text": shipping_text.strip(),
            "parsed_metadata": {
                "carrier": carrier,
                "tracking_number": tracking_number,
                "ship_date": ship_date.strftime('%Y-%m-%d'),
                "delivery_date": delivery_date.strftime('%Y-%m-%d'),
                "order_id": order_id,
                "sku": sku,
                "quantity": quantity
            },
            "confidence": 0.90,
            "extraction_method": "regex"
        }
        
        return shipping_doc
    
    def generate_evidence_documents(self, claim_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Generate all relevant evidence documents for a claim
        
        Args:
            claim_data: Claim data from Discovery Agent
            
        Returns:
            List of evidence documents (invoice, receipt, shipping log)
        """
        documents = []
        
        # Always generate invoice (primary evidence)
        invoice = self.generate_invoice(claim_data)
        documents.append(invoice)
        
        # Generate receipt (if amount > 50)
        if float(claim_data.get('amount', 0)) > 50:
            receipt = self.generate_receipt(claim_data)
            documents.append(receipt)
        
        # Generate shipping log (if claim type involves shipping)
        claim_type = claim_data.get('claim_type', '').lower()
        if 'lost' in claim_type or 'damaged' in claim_type or 'shipping' in claim_type:
            shipping = self.generate_shipping_log(claim_data)
            documents.append(shipping)
        
        return documents

