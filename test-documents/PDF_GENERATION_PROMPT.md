# Prompt for LLM: Generate Test PDF Documents for Clario Platform

## Task
Generate PDF documents (invoices and proof of delivery) for testing the Clario FBA reimbursement platform's document parsing and evidence matching system.

## Requirements

### Number of PDFs to Generate
**Generate 20 PDF documents total:**
- **15 Invoices** (supplier invoices with product details)
- **5 Proof of Delivery (POD)** documents (shipping receipts/delivery confirmations)

### Document Types & Distribution

1. **Invoices (15 total)**
   - 10 standard invoices with multiple line items
   - 3 invoices with single high-value items
   - 2 invoices with damaged goods notation

2. **Proof of Delivery (5 total)**
   - Should match order IDs from some of the invoices
   - Include carrier information (UPS, FedEx, USPS)
   - Include tracking numbers

### Data Format Requirements

#### Order ID Format
- **Format**: `112-XXXXXXX-XXXXXX` (Amazon order ID)
- **Example**: `112-1234567-7654321`, `112-9876543-1234567`
- Must be unique for each invoice

#### SKU Format
- **Format**: `SKU-XXXX` (4 digits, zero-padded)
- **Examples**: `SKU-0001`, `SKU-0042`, `SKU-0123`, `SKU-0256`, `SKU-0512`
- Each invoice should have 2-5 different SKUs

#### ASIN Format (optional but recommended)
- **Format**: `B0XXXXXXXX` (10 characters, starts with B0)
- **Examples**: `B012345678`, `B098765432`

#### Invoice Number Format
- **Format**: `INV-YYYY-XXX` (Year + 3 digits)
- **Examples**: `INV-2024-001`, `INV-2024-002`, `INV-2024-015`

#### Supplier/Company Names
Use realistic supplier names:
- ACME FULFILLMENT SERVICES
- Global Logistics Partners
- Prime Shipping Solutions
- FastTrack Distribution
- Elite Warehouse Services

### Invoice Content Structure

Each invoice PDF should include:

1. **Header Section:**
   - Company name (supplier)
   - "INVOICE" title
   - Invoice number (INV-YYYY-XXX format)
   - Invoice date (recent dates, within last 6 months)
   - Due date (typically 15-30 days after invoice date)

2. **Bill To Section:**
   - "Clario FBA Seller" or similar
   - Address: 123 Commerce Street, New York, NY 10001

3. **Order Reference Section:**
   - Amazon Order Reference: `112-XXXXXXX-XXXXXX`
   - Carrier: UPS / FedEx / USPS
   - Tracking Number: Format like `1Z999AA10123456784` (UPS) or similar

4. **Line Items Table:**
   - Columns: SKU, Description, Quantity, Unit Price, Total
   - Each line item should have:
     - SKU in format `SKU-XXXX`
     - Product description (e.g., "Wireless Headphones", "USB-C Cable", "Phone Case")
     - Quantity (1-50 units)
     - Unit price ($5.00 - $500.00)
     - Line total (quantity × unit price)

5. **Totals Section:**
   - Subtotal
   - Shipping (if applicable)
   - Tax (if applicable)
   - **Total Amount** (should be clearly visible)

6. **Footer:**
   - Payment terms
   - Company contact information

### Proof of Delivery Content Structure

Each POD PDF should include:

1. **Header:**
   - Carrier name (UPS, FedEx, USPS)
   - "PROOF OF DELIVERY" or "DELIVERY RECEIPT" title
   - Delivery date

2. **Tracking Information:**
   - Tracking number (matches invoice)
   - Order ID: `112-XXXXXXX-XXXXXX` (should match an invoice)

3. **Delivery Details:**
   - Delivered to: Address matching invoice
   - Signed by: Name or "Signature on file"
   - Delivery time
   - Package count

4. **SKU/Item List:**
   - List of SKUs delivered (should match invoice SKUs)
   - Quantities delivered

### Data Relationships

**Important:** Create relationships between documents:
- POD documents should reference Order IDs from invoices
- POD tracking numbers should match invoice tracking numbers
- POD SKUs should match invoice SKUs (for the same order)
- Create 3-5 invoice/POD pairs that clearly match

### Amount Ranges

- **Small invoices**: $50 - $500
- **Medium invoices**: $500 - $2,000
- **Large invoices**: $2,000 - $10,000
- Mix of all ranges across the 15 invoices

### Date Ranges

- Invoice dates: Last 6 months (mix of recent and older)
- Delivery dates: Should be after invoice dates (for matching PODs)

### Visual Design Requirements

- Professional invoice layout
- Clear, readable fonts (Arial, Helvetica, or similar)
- Proper spacing and alignment
- Tables for line items
- Company logo area (can be placeholder)
- Clean, business-appropriate design
- Print-friendly (black text on white background)

### File Naming Convention

Save PDFs with descriptive names:
- `invoice-001.pdf`, `invoice-002.pdf`, ... `invoice-015.pdf`
- `pod-001.pdf`, `pod-002.pdf`, ... `pod-005.pdf`

### Special Considerations

1. **Damaged Goods Invoices (2 invoices):**
   - Include notes like "Damaged in transit" or "Returned items"
   - May have negative quantities or credit memos

2. **High-Value Invoices (3 invoices):**
   - Single line item with quantity 1
   - Higher unit prices ($200-$500)
   - Important for testing high-value claim detection

3. **Multi-SKU Invoices (10 invoices):**
   - Multiple line items (2-5 SKUs each)
   - Various quantities
   - Mix of product types

### Testing Scenarios Covered

These PDFs should enable testing:
- ✅ Document parsing (extract SKU, Order ID, amounts, dates)
- ✅ Evidence matching to claims (by Order ID, SKU, amount)
- ✅ Multi-document matching (invoice + POD for same order)
- ✅ High-value claim detection
- ✅ Damaged goods claim detection
- ✅ Various supplier formats

### Output Format

Generate PDFs that:
1. Are actual PDF files (not images)
2. Have selectable/searchable text (not scanned images)
3. Use consistent formatting across documents
4. Include all required data fields
5. Are named according to the convention above

### Example Invoice Structure (Visual Guide)

```
┌─────────────────────────────────────────┐
│  ACME FULFILLMENT SERVICES              │
│  INVOICE                                │
│                                         │
│  Invoice #: INV-2024-001               │
│  Date: December 1, 2024                 │
│  Due Date: December 15, 2024            │
│                                         │
│  Amazon Order: 112-1234567-7654321      │
│  Carrier: UPS | Tracking: 1Z999AA...   │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ SKU      │ Description │ Qty │ $  │ │
│  ├───────────────────────────────────┤ │
│  │ SKU-0001 │ Product A   │ 10  │ 50 │ │
│  │ SKU-0042 │ Product B   │ 5   │ 75 │ │
│  └───────────────────────────────────┘ │
│                                         │
│  Total: $875.00                         │
└─────────────────────────────────────────┘
```

---

## Final Instructions

Generate exactly **20 PDF files** following all the requirements above. Ensure:
- All data formats match exactly (SKU-XXXX, 112-XXXXXXX-XXXXXX, etc.)
- Documents are professional and realistic
- Text is selectable/searchable in PDFs
- Relationships between invoices and PODs are clear
- File names follow the convention

These PDFs will be used to test automated document parsing, evidence extraction, and claim matching in the Clario platform.

