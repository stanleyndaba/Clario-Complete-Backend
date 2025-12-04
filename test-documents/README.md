# Test Documents for E2E Testing

This folder contains test documents for validating the Clario document parsing and evidence matching pipeline.

## Files Included

| File | Type | Key Data |
|------|------|----------|
| `invoice-001.html` | Invoice | SKU-0001, SKU-0042, SKU-0123 / Order 112-1234567-7654321 |
| `invoice-002.html` | Invoice | SKU-0256, SKU-0512 / Order 112-9876543-1234567 |
| `pod-001.html` | Proof of Delivery | Matches invoice-001 order and SKUs |

## How to Use

### Option 1: Print to PDF (Recommended)
1. Open each `.html` file in Chrome
2. Press `Ctrl+P` (or `Cmd+P` on Mac)
3. Select "Save as PDF" as the destination
4. Save the PDF file
5. Upload PDFs to the Evidence Locker

### Option 2: Direct HTML Upload
Some parsers may accept HTML files directly. Try uploading the `.html` files to see if they're processed.

## SKU & Order ID Reference

These documents use SKUs and order IDs that match the mock data generator format:
- **Order ID Format**: `112-XXXXXXX-XXXXXX`
- **SKU Format**: `SKU-XXXX`
- **ASIN Format**: `B0XXXXXXXX`

## Testing Workflow

1. Upload these documents to Evidence Locker
2. Watch Document Activity log for parsing events
3. Wait for matching worker (runs every 3 min)
4. Check if documents get matched to claims
