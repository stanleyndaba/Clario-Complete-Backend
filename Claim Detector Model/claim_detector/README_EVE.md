# Evidence & Value Engine (EVE) - Complete Implementation Guide

## 🎯 Overview

The Evidence & Value Engine (EVE) is a comprehensive system for processing invoices, calculating landed costs, and comparing Amazon default reimbursement values with Opside True Values. This system provides the foundation for maximizing FBA reimbursement claims by providing evidence-based value calculations.

## 🏗️ Architecture

### Core Components

1. **Storage Service** - Handles file uploads to Supabase/S3
2. **OCR Service** - Extracts text from invoices using Tesseract/Textract
3. **Parser Service** - Converts OCR text to structured invoice data
4. **Mapping Service** - Maps invoice SKUs to catalog SKUs/ASINs
5. **Landed Cost Service** - Calculates per-SKU landed costs
6. **Value Comparison Service** - Compares Amazon default vs Opside True Value

### Data Flow

```
Invoice Upload → Storage → OCR → Parsing → SKU Mapping → Landed Cost → Value Comparison → Claims Integration
```

## 🚀 Quick Start

### 1. Environment Setup

```bash
# Install dependencies
pip install -r requirements_eve.txt

# Set environment variables
export STORAGE_BACKEND=supabase  # or 's3'
export SUPABASE_URL=your_supabase_url
export SUPABASE_SERVICE_KEY=your_service_key

# For AWS Textract (optional)
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

### 2. Database Setup

```bash
# Create database tables
python -c "
from src.evidence.database import Base
from sqlalchemy import create_engine
engine = create_engine('postgresql://user:pass@localhost/claim_detector')
Base.metadata.create_all(engine)
"
```

### 3. Start the API

```bash
# Start the FastAPI server
uvicorn src.evidence.controllers:evidence_router --reload --port 8000
```

## 📁 File Structure

```
claim_detector/
├── src/
│   └── evidence/
│       ├── __init__.py
│       ├── storage.py          # Storage abstraction (Supabase/S3)
│       ├── ocr.py             # OCR service (Tesseract/Textract)
│       ├── parser.py           # Invoice parsing service
│       ├── mapping.py          # SKU mapping service
│       ├── landed_cost.py      # Landed cost calculation
│       ├── value_compare.py    # Value comparison service
│       ├── database.py         # Database models
│       ├── controllers.py      # API endpoints
│       ├── validators.py       # Input validation
│       └── services.py         # Service imports
├── requirements_eve.txt        # EVE-specific dependencies
└── README_EVE.md              # This file
```

## 🔧 Configuration

### Storage Backend

The system supports both Supabase and S3 storage backends:

```python
# Supabase (default)
STORAGE_BACKEND=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key

# S3
STORAGE_BACKEND=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=your-bucket
```

### OCR Configuration

```python
# Tesseract (default, requires system installation)
# Install: sudo apt-get install tesseract-ocr

# AWS Textract (if credentials available)
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
```

### Cost Allocation Policy

Default allocation percentages can be customized per seller:

```python
default_policy = {
    'freight_pct': 5.00,      # 5% of invoice total
    'duties_pct': 2.00,       # 2% of invoice total
    'prep_pct': 1.00,         # 1% of invoice total
    'other_pct': 0.00,        # 0% of invoice total
    'minimum_freight': 25.00,  # Minimum freight cost
    'minimum_duties': 10.00    # Minimum duties cost
}
```

## 📡 API Endpoints

### Invoice Management

#### Upload Invoice
```bash
POST /evidence/invoices/upload
Content-Type: multipart/form-data

file: <invoice_file>
seller_id: <seller_id>
invoice_date: 2024-01-15 (optional)
currency: USD (optional)
```

**Response:**
```json
{
  "invoice_id": "uuid",
  "status": "queued",
  "filename": "invoice.pdf",
  "storage_url": "https://storage.example.com/invoice.pdf",
  "bytes": 1024000,
  "uploaded_at": "2024-01-15T10:30:00Z"
}
```

#### Get Invoice
```bash
GET /evidence/invoices/{invoice_id}?seller_id={seller_id}
```

**Response:**
```json
{
  "id": "uuid",
  "seller_id": "seller_123",
  "filename": "invoice.pdf",
  "ocr_status": "done",
  "ocr_confidence": 0.85,
  "items": [...],
  "landed_costs": [...]
}
```

#### Get Preview URL
```bash
GET /evidence/invoices/{invoice_id}/preview-url?seller_id={seller_id}
```

**Response:**
```json
{
  "invoice_id": "uuid",
  "preview_url": "https://signed-url.example.com",
  "expires_in": 300,
  "expires_at": "2024-01-15T10:35:00Z"
}
```

### Value Comparison

#### Single SKU Comparison
```bash
GET /evidence/value/compare?sku=SKU-001&seller_id=seller_123
```

**Response:**
```json
{
  "sku": "SKU-001",
  "amazon_default": 22.00,
  "opside_true_value": 28.75,
  "net_gain": 6.75,
  "comparison_status": "positive_gain",
  "proof": {
    "has_landed_cost": true,
    "has_amazon_default": true,
    "invoice_id": "uuid",
    "calculation_details": {...}
  },
  "updated_at": "2024-01-15T10:30:00Z"
}
```

#### Batch Comparison
```bash
POST /evidence/value/compare/batch
Content-Type: application/json

{
  "seller_id": "seller_123",
  "skus": ["SKU-001", "SKU-002", "SKU-003"]
}
```

**Response:**
```json
{
  "seller_id": "seller_123",
  "total_skus": 3,
  "results": [...],
  "processed_at": "2024-01-15T10:30:00Z"
}
```

#### Get Statistics
```bash
GET /evidence/value/statistics?seller_id=seller_123&days=30
```

**Response:**
```json
{
  "total_comparisons": 150,
  "positive_gain_count": 120,
  "negative_gain_count": 20,
  "no_difference_count": 10,
  "average_net_gain": 15.75,
  "total_potential_gain": 1890.00
}
```

#### Get Top Opportunities
```bash
GET /evidence/value/opportunities?seller_id=seller_123&limit=10
```

**Response:**
```json
{
  "seller_id": "seller_123",
  "opportunities": [
    {
      "sku": "SKU-001",
      "amazon_default": 25.00,
      "opside_true_value": 45.50,
      "net_gain": 20.50,
      "potential_annual_gain": 2050.00
    }
  ],
  "total_count": 10
}
```

### Landed Cost Calculation

#### Calculate Landed Costs
```bash
POST /evidence/landed-cost/calculate
Content-Type: application/json

{
  "invoice_data": {
    "line_items": [
      {
        "sku": "SKU-001",
        "unit_cost": 25.50,
        "quantity": 10
      }
    ],
    "totals": {
      "total": 255.00
    }
  },
  "seller_policy": {
    "freight_pct": 5.00,
    "duties_pct": 2.00,
    "prep_pct": 1.00
  }
}
```

**Response:**
```json
{
  "landed_costs": [
    {
      "sku": "SKU-001",
      "landed_per_unit": 28.75,
      "unit_cost": 25.50,
      "freight_alloc": 2.50,
      "duties_alloc": 1.00,
      "prep_alloc": 1.00,
      "other_alloc": 0.00
    }
  ],
  "summary": {
    "total_items": 1,
    "total_value": 287.50,
    "average_landed_cost": 28.75
  }
}
```

#### Get Landed Cost
```bash
GET /evidence/landed-cost/{sku}?seller_id=seller_123
```

### SKU Mapping

#### Batch SKU Mapping
```bash
POST /evidence/mapping/batch
Content-Type: application/json

{
  "skus": ["SKU-001", "SKU-002"],
  "catalog_data": {
    "skus": {
      "SKU-001": {"asin": "B07XYZ123"},
      "SKU-002": {"asin": "B08ABC456"}
    }
  }
}
```

**Response:**
```json
{
  "mapping_results": {
    "SKU-001": {
      "mapped_sku": "SKU-001",
      "asin": "B07XYZ123",
      "mapping_confidence": 1.0,
      "mapping_status": "exact_match"
    }
  },
  "statistics": {
    "total_items": 2,
    "mapped_items": 2,
    "success_rate": 1.0
  }
}
```

### Cache Management

#### Clear Cache
```bash
DELETE /evidence/cache/clear?seller_id=seller_123
```

**Response:**
```json
{
  "message": "Cache cleared successfully",
  "seller_id": "seller_123",
  "cleared_at": "2024-01-15T10:30:00Z"
}
```

## 🗄️ Database Schema

### Core Tables

#### invoices
- `id` - Primary key (UUID)
- `seller_id` - Seller identifier
- `filename` - Original filename
- `storage_url` - Storage location
- `mime_type` - File type
- `bytes` - File size
- `ocr_status` - OCR processing status
- `ocr_confidence` - OCR confidence score

#### invoice_items
- `id` - Primary key (UUID)
- `invoice_id` - Foreign key to invoices
- `raw_sku` - Original SKU from invoice
- `mapped_sku` - Normalized SKU
- `asin` - Amazon ASIN
- `unit_cost` - Unit cost
- `quantity` - Quantity
- `confidence` - Extraction confidence

#### landed_costs
- `id` - Primary key (UUID)
- `seller_id` - Seller identifier
- `sku` - SKU
- `asin` - Amazon ASIN
- `invoice_id` - Source invoice
- `landed_per_unit` - Calculated landed cost
- `calc_meta` - Calculation metadata (JSON)

#### value_comparisons
- `id` - Primary key (UUID)
- `seller_id` - Seller identifier
- `sku` - SKU
- `amazon_default` - Amazon default value
- `opside_true_value` - Opside calculated value
- `net_gain` - Difference (opside - amazon)
- `comparison_status` - Status of comparison

#### seller_cost_policies
- `id` - Primary key (UUID)
- `seller_id` - Seller identifier (unique)
- `freight_pct` - Freight allocation percentage
- `duties_pct` - Duties allocation percentage
- `prep_pct` - Prep allocation percentage
- `other_pct` - Other allocation percentage

## 🔄 Processing Pipeline

### 1. Invoice Upload
1. File validation (type, size, corruption check)
2. Upload to storage (Supabase/S3)
3. Create database record
4. Enqueue OCR job

### 2. OCR Processing
1. Extract text from PDF/image
2. Parse invoice structure
3. Extract line items, totals, dates
4. Update database with extracted data

### 3. SKU Mapping
1. Clean and normalize SKUs
2. Exact match lookup
3. Normalized match lookup
4. Fuzzy match with confidence scoring
5. Update database with mappings

### 4. Landed Cost Calculation
1. Apply seller cost allocation policy
2. Calculate freight, duties, prep allocations
3. Distribute costs across line items
4. Store calculation metadata
5. Update database with landed costs

### 5. Value Comparison
1. Fetch latest landed cost for SKU
2. Fetch Amazon default value
3. Calculate net gain
4. Cache comparison result
5. Store in database

## 🧪 Testing

### Unit Tests

```bash
# Run unit tests
pytest tests/evidence/ -v

# Run with coverage
pytest tests/evidence/ --cov=src.evidence --cov-report=html
```

### Integration Tests

```bash
# Run integration tests
pytest tests/evidence/test_integration.py -v

# Run specific test file
pytest tests/evidence/test_value_compare.py -v
```

### Test Data

Sample test data is provided in the test fixtures:

```python
# Sample invoice data
sample_invoice = {
    "line_items": [
        {
            "raw_sku": "SKU-001",
            "description": "Sample Product",
            "unit_cost": 25.50,
            "quantity": 10,
            "total_cost": 255.00
        }
    ],
    "totals": {
        "subtotal": 255.00,
        "total": 255.00
    }
}

# Sample catalog data
sample_catalog = {
    "skus": {
        "SKU-001": {
            "asin": "B07XYZ123",
            "title": "Sample Product"
        }
    }
}
```

## 📊 Monitoring & Observability

### Logging

Structured logging with correlation IDs:

```python
import logging

logger = logging.getLogger(__name__)

# Log with context
logger.info("Processing invoice", extra={
    "invoice_id": invoice_id,
    "seller_id": seller_id,
    "action": "ocr_processing"
})
```

### Metrics

Key metrics to monitor:

- `invoices_uploaded_total` - Total invoices uploaded
- `ocr_jobs_duration_seconds` - OCR processing time
- `landed_cost_computations_total` - Landed cost calculations
- `value_comparisons_total` - Value comparisons performed
- `mapping_success_rate` - SKU mapping success rate

### Health Checks

```bash
# Check system health
GET /health

# Check storage backend
GET /health/storage

# Check OCR service
GET /health/ocr
```

## 🔒 Security

### Authentication & Authorization

- JWT-based authentication
- Seller-scoped access control
- Rate limiting per seller
- Input validation and sanitization

### Data Protection

- PII redaction in logs
- Signed URLs for file access
- Encrypted storage at rest
- Audit logging for all operations

### Rate Limiting

```python
# Rate limits per seller
RATE_LIMITS = {
    "upload": "10/minute",      # 10 uploads per minute
    "compare": "60/minute",     # 60 comparisons per minute
    "batch": "5/minute"         # 5 batch operations per minute
}
```

## 🚀 Deployment

### Docker

```dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements_eve.txt .
RUN pip install -r requirements_eve.txt

# Copy application code
COPY src/ /app/src/

# Run application
CMD ["uvicorn", "src.evidence.controllers:evidence_router", "--host", "0.0.0.0", "--port", "8000"]
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: evidence-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: evidence-engine
  template:
    metadata:
      labels:
        app: evidence-engine
    spec:
      containers:
      - name: evidence-engine
        image: evidence-engine:latest
        ports:
        - containerPort: 8000
        env:
        - name: STORAGE_BACKEND
          value: "supabase"
        - name: SUPABASE_URL
          valueFrom:
            secretKeyRef:
              name: supabase-secret
              key: url
```

## 🔧 Troubleshooting

### Common Issues

#### OCR Failures
```bash
# Check Tesseract installation
tesseract --version

# Check system dependencies
ldd $(which tesseract)

# Verify image format support
file sample_image.png
```

#### Storage Issues
```bash
# Check Supabase credentials
curl -H "apikey: $SUPABASE_SERVICE_KEY" \
     "$SUPABASE_URL/rest/v1/"

# Check S3 permissions
aws s3 ls s3://your-bucket/
```

#### Database Connection
```bash
# Test database connection
python -c "
from sqlalchemy import create_engine
engine = create_engine('postgresql://user:pass@localhost/db')
engine.connect()
"
```

### Debug Mode

Enable debug logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Or set environment variable
export LOG_LEVEL=DEBUG
```

## 📈 Performance Optimization

### Caching Strategy

- Value comparison results cached for 24 hours
- SKU mapping results cached in memory
- Invoice metadata cached with TTL

### Batch Processing

- Batch SKU mapping (up to 200 SKUs)
- Batch value comparison
- Parallel processing where possible

### Database Optimization

- Indexed queries on seller_id, sku, asin
- Partitioned tables for large datasets
- Connection pooling for high concurrency

## 🔮 Future Enhancements

### Planned Features

1. **Multi-currency Support** - FX rate integration
2. **Advanced OCR** - Table structure recognition
3. **Machine Learning** - SKU mapping improvements
4. **Real-time Updates** - WebSocket notifications
5. **Bulk Operations** - Mass invoice processing

### Integration Points

1. **Amazon SP-API** - Direct data sync
2. **Accounting Systems** - QuickBooks, Xero
3. **ERP Systems** - NetSuite, SAP
4. **Shipping Providers** - FedEx, UPS

## 📚 Additional Resources

### Documentation

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [Supabase Documentation](https://supabase.com/docs)
- [AWS Textract Documentation](https://docs.aws.amazon.com/textract/)

### Community

- [GitHub Issues](https://github.com/your-repo/issues)
- [Discord Community](https://discord.gg/your-community)
- [Documentation Wiki](https://wiki.your-project.com)

### Support

For technical support or feature requests:

- Email: support@your-project.com
- GitHub: Create an issue
- Discord: Join our community

---

**Note**: This implementation provides a production-ready foundation for the Evidence & Value Engine. All core functionality is implemented with proper error handling, validation, and security measures. The system is designed to be scalable and can be extended with additional features as needed.
