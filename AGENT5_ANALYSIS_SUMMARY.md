# 🎯 Agent 5: Document Parsing - Complete Analysis

**Generated:** 2025-01-27  
**Status:** ✅ **COMPLETE & PRODUCTION-READY**

---

## 📋 Executive Summary

**Agent 5 (Document Parsing)** is a fully implemented, production-ready background worker that automatically extracts structured data from evidence documents (PDFs, images, emails) ingested by Agent 4. It uses a combination of regex patterns, OCR, and ML to extract invoice data, purchase orders, line items, and other key information needed for claim filing.

---

## 🎯 What Agent 5 Does

### **Purpose:**
Automatically extracts structured, searchable data from unstructured documents to enable automated evidence matching and claim filing.

### **Extracted Data:**
- Supplier/merchant names
- Invoice numbers and dates
- Purchase order numbers
- Line items (SKU, quantity, unit price, total)
- Currency, tax amounts, shipping amounts
- Payment terms
- Raw text content (for search)

### **Document Types Supported:**
- PDFs (invoices, receipts, purchase orders)
- Images (scanned documents, photos) - via OCR
- Emails (with attachments)
- Various formats via Python parser library

---

## ⚙️ How Agent 5 Works

### **Architecture Overview:**

```
┌─────────────────────────────────────────┐
│  Agent 4 (Evidence Ingestion)          │
│  Stores documents in evidence_documents │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Agent 5 Worker (TypeScript)            │
│  - Polls every 2 minutes                │
│  - Finds documents needing parsing      │
│  - Calls Python API for parsing         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Python Parser API                      │
│  - PDF Parser (regex + ML)              │
│  - Image Parser (OCR)                   │
│  - Email Parser                         │
│  - Returns structured JSON              │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Stores Parsed Data                     │
│  - parsed_metadata (JSONB)              │
│  - parser_status, parser_confidence     │
│  - Individual columns                   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Triggers Agent 6 (Evidence Matching)   │
└─────────────────────────────────────────┘
```

### **Step-by-Step Process:**

1. **Polling Phase** (every 2 minutes)
   - Worker queries `evidence_documents` table
   - Finds documents where `parsed_metadata IS NULL`
   - Limits to 50 documents per run

2. **Processing Phase**
   - Updates document status to `processing`
   - Sets `parser_started_at` timestamp
   - Calls Python API: `POST /api/v1/evidence/parse/{documentId}`
   - Waits for parsing completion (polls every 5 seconds, max 5 minutes)

3. **Storage Phase**
   - Receives structured JSON from Python API
   - Stores in `parsed_metadata` (JSONB column)
   - Updates individual columns (supplier_name, invoice_number, etc.)
   - Sets `parser_status = 'completed'`
   - Stores confidence score

4. **Integration Phase**
   - Triggers Agent 6 (Evidence Matching) for the document
   - Logs event to Agent 11 (Learning Agent)
   - Sends notification via Agent 10 (Notifications)

### **Error Handling:**

- **Service Level:** 3 retries with exponential backoff (2s, 4s, 8s)
- **Worker Level:** 2 additional retries
- **Error Logging:** All errors stored in `document_parsing_errors` table
- **Status Tracking:** Documents marked as `failed` with error message

---

## 📁 Key Files

### **TypeScript/Node.js:**

1. **`Integrations-backend/src/workers/documentParsingWorker.ts`** (693 lines)
   - Main background worker
   - Cron scheduling (`*/2 * * * *` - every 2 minutes)
   - Document polling and processing logic
   - Error handling and retry logic
   - Integration with Agents 6, 10, 11

2. **`Integrations-backend/src/services/documentParsingService.ts`** (353 lines)
   - Wraps Python API calls
   - Handles multiple endpoint formats (backward compatibility)
   - Retry logic with exponential backoff
   - Job status polling
   - Parsed data retrieval

### **Python Backend:**

1. **`src/api/parser.py`**
   - FastAPI endpoints for document parsing
   - `POST /api/v1/evidence/parse/{documentId}` - Trigger parsing
   - `GET /api/v1/evidence/parse/jobs/{jobId}` - Get job status
   - `GET /api/v1/evidence/documents/{documentId}` - Get parsed data

2. **`src/parsers/pdf_parser.py`**
   - PDF document parsing using regex and ML

3. **`src/parsers/image_parser.py`**
   - OCR-based image parsing

4. **`src/parsers/email_parser.py`**
   - Email and attachment parsing

5. **`src/parsers/parser_worker.py`**
   - Background parser worker

---

## 🗄️ Database Schema

### **Migration File:** `012_document_parsing_worker.sql`

### **Columns Added to `evidence_documents` Table:**

| Column | Type | Description |
|--------|------|-------------|
| `parsed_metadata` | JSONB | Structured parsed data (supplier, invoice, line items, etc.) |
| `parser_status` | TEXT | Status: `pending`, `processing`, `completed`, `failed`, `requires_manual_review` |
| `parser_confidence` | DECIMAL(5,4) | Confidence score (0.0-1.0) |
| `parser_error` | TEXT | Error message if parsing failed |
| `parser_started_at` | TIMESTAMPTZ | When parsing started |
| `parser_completed_at` | TIMESTAMPTZ | When parsing completed |

**Indexes:**
- GIN index on `parsed_metadata` for fast JSON queries
- Index on `parser_status` for filtering

### **New Table: `document_parsing_errors`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `document_id` | UUID | Foreign key to `evidence_documents` |
| `seller_id` | TEXT | User/seller ID |
| `error_type` | TEXT | Type of error |
| `error_message` | TEXT | Error message |
| `error_stack` | TEXT | Stack trace |
| `retry_count` | INTEGER | Number of retry attempts |
| `max_retries` | INTEGER | Maximum retries allowed |
| `metadata` | JSONB | Additional error metadata |
| `created_at` | TIMESTAMPTZ | When error occurred |
| `resolved_at` | TIMESTAMPTZ | When error resolved |
| `resolved` | BOOLEAN | Whether error is resolved |

**Indexes:**
- Index on `document_id`
- Index on `seller_id`
- Index on `created_at`
- Partial index on `resolved = FALSE`

**RLS Policies:**
- Users can only see their own parsing errors
- Service/admin clients can insert errors

---

## 🔗 Integration Points

### **Triggered By:**
- **Agent 4 (Evidence Ingestion)** - When documents are stored in `evidence_documents` table

### **Triggers:**
- **Agent 6 (Evidence Matching)** - Automatically triggered when parsing completes
- **Agent 10 (Notifications)** - Sends notification when evidence is parsed
- **Agent 11 (Learning)** - Logs parsing events for continuous learning

### **API Endpoints:**

**TypeScript Worker → Python API:**
- `POST /api/v1/evidence/parse/{documentId}` - Trigger parsing
- `GET /api/v1/evidence/parse/jobs/{jobId}` - Get job status
- `GET /api/v1/evidence/documents/{documentId}` - Get parsed data

---

## ✅ Completeness Status

### **Implementation:** ✅ **COMPLETE**

1. ✅ Background worker implemented and tested
2. ✅ Service layer wraps Python API
3. ✅ Database migration created
4. ✅ Error handling and retry logic
5. ✅ Integration with Agents 4, 6, 10, 11
6. ✅ Worker registered in main server (`src/index.ts`)
7. ✅ Configuration via environment variables
8. ✅ Documentation complete
9. ✅ Testing scripts available

### **Production Readiness:** ✅ **READY**

- Automated parsing every 2 minutes
- Robust error handling
- Retry logic prevents transient failures
- Error logging for debugging
- Status tracking for monitoring
- Structured JSON output
- Seamless pipeline integration

---

## ⚙️ Configuration

### **Environment Variables:**

```bash
# Enable/disable worker (default: true)
ENABLE_DOCUMENT_PARSING_WORKER=true

# Python API URL
PYTHON_API_URL=https://python-api-10.onrender.com
API_URL=https://python-api-10.onrender.com  # Fallback

# Python API authentication
PYTHON_API_JWT_SECRET=your-jwt-secret
PYTHON_API_SERVICE_NAME=integrations-service-worker
PYTHON_API_SERVICE_EMAIL=integrations-worker@yourdomain.com
```

### **Worker Configuration:**

- **Schedule:** Every 2 minutes (`*/2 * * * *`)
- **Batch Size:** 50 documents per run
- **Max Wait Time:** 5 minutes per document
- **Poll Interval:** 5 seconds for job status
- **Retry Attempts:** 3 at service level, 2 at worker level
- **Rate Limiting:** 1 second stagger between documents

---

## 📊 Parsed Data Structure

### **Example `parsed_metadata` JSON:**

```json
{
  "supplier_name": "Amazon",
  "invoice_number": "INV-12345",
  "invoice_date": "2024-01-15",
  "purchase_order_number": "PO-67890",
  "document_date": "2024-01-15",
  "currency": "USD",
  "total_amount": 1234.56,
  "tax_amount": 98.76,
  "shipping_amount": 12.34,
  "payment_terms": "Net 30",
  "line_items": [
    {
      "sku": "ABC-123",
      "description": "Product Name",
      "quantity": 5,
      "unit_price": 10.00,
      "total": 50.00
    }
  ],
  "raw_text": "Full document text...",
  "extraction_method": "regex|ocr|ml",
  "confidence_score": 0.95,
  "parsed_at": "2024-01-15T10:30:00Z"
}
```

---

## 🔍 Monitoring & Debugging

### **Worker Logs:**

```
🚀 [DOCUMENT PARSING WORKER] Starting...
📊 [DOCUMENT PARSING WORKER] Processing X documents
✅ [DOCUMENT PARSING WORKER] Successfully parsed document
❌ [DOCUMENT PARSING WORKER] Failed to parse document
📝 [DOCUMENT PARSING WORKER] Logged parsing error
```

### **Query Parsing Status:**

```sql
-- Get documents pending parsing
SELECT id, filename, parser_status, created_at
FROM evidence_documents
WHERE parsed_metadata IS NULL
ORDER BY created_at ASC
LIMIT 50;

-- Get parsing errors
SELECT document_id, error_type, error_message, retry_count, created_at
FROM document_parsing_errors
WHERE resolved = FALSE
ORDER BY created_at DESC;

-- Get parsing statistics
SELECT 
  parser_status,
  COUNT(*) as count,
  AVG(parser_confidence) as avg_confidence
FROM evidence_documents
GROUP BY parser_status;
```

---

## 🚀 Testing

### **Verification Scripts:**

1. **`scripts/test-agent5-document-parsing.ts`** - Test document parsing
2. **`scripts/verify-agent5-integration.ts`** - Verify integration
3. **`scripts/verify-agents-5-11.ts`** - Comprehensive verification

### **Run Tests:**

```bash
npm run test:agent5
npm run verify:agents-5-11
```

---

## 📝 Summary

**Agent 5 (Document Parsing)** is a **complete, production-ready** background worker that:

1. ✅ Automatically parses documents every 2 minutes
2. ✅ Extracts structured data using regex, OCR, and ML
3. ✅ Stores parsed data in JSONB format for flexible queries
4. ✅ Handles errors with robust retry logic
5. ✅ Integrates seamlessly with the agent pipeline
6. ✅ Logs events for monitoring and learning

**Status:** ✅ **COMPLETE & READY FOR PRODUCTION**

---

**Next Agent:** Agent 6 (Evidence Matching) - Matches parsed evidence documents to claims


