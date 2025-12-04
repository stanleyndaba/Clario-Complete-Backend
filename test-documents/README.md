# Test Documents for E2E Testing

This folder contains test documents for validating the Clario document parsing and evidence matching pipeline.

## Files Included

| File | Type | Key Data |
|------|------|----------|
| `invoice-001.html` | Invoice | SKU-0001, SKU-0042, SKU-0123 / Order 112-1234567-7654321 |
| `invoice-002.html` | Invoice | SKU-0256, SKU-0512 / Order 112-9876543-1234567 |
| `pod-001.html` | Proof of Delivery | Matches invoice-001 order and SKUs |

## How to Use

### Option 1: Automated Upload Script (Recommended)
1. Make sure the backend API is running (default: `http://localhost:3000`)
2. Run the upload script:
   ```bash
   cd test-documents
   npm run upload
   ```
3. Or with custom API URL:
   ```bash
   API_BASE_URL=http://your-api-url:3000 npm run upload
   ```
4. The script will upload all PDFs automatically and show upload status

### Option 2: Manual Upload via UI
1. Go to the Evidence Locker page (`/evidence-locker`)
2. Drag and drop or select the PDF files:
   - `invoice-001.pdf`
   - `invoice-002.pdf`
   - `pod-001.pdf`
3. Watch the Document Activity log for parsing events

### Option 3: Direct HTML Upload
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
