# Cost Documentation Module - Sack AI

A comprehensive Node.js microservice for generating deterministic PDF reports from anomaly evidence JSON, designed specifically for Sack AI's automated evidence engine.

## 🎯 Objective

Turn anomaly evidence JSON into deterministic PDF reports with cost breakdowns and embedded/linked artifacts that sellers can download or submit in disputes with Amazon/FBA or suppliers.

## 🚀 Features

- **Automatic PDF Generation**: Triggered whenever the Detection pipeline outputs an anomaly JSON that passes thresholds
- **Manual PDF Generation**: User-initiated generation from dashboard for specific anomalies
- **Deterministic Output**: Same input JSON → identical PDF every time
- **Template System**: Customizable PDF templates for different anomaly types
- **Job Queue Management**: Bull queue with priority-based processing and backpressure controls
- **S3 Integration**: Secure PDF storage with signed URLs
- **Evidence Linking**: Embed or link S3 artifacts into PDFs
- **Cost Breakdowns**: Detailed financial calculations with formulas

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Detection       │───▶│ Evidence JSON    │───▶│ Cost Doc Queue  │
│ Pipeline        │    │ (anomaly data)   │    │ (Bull + Redis)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ Manual Trigger   │    │ PDF Generator   │
                       │ (Dashboard)      │    │ (Puppeteer)     │
                       └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ Cost Doc Service │    │ S3 Storage      │
                       │ (Business Logic) │    │ (PDFs + URLs)   │
                       └──────────────────┘    └─────────────────┘
```

## 📋 API Endpoints

### Cost Documentation Generation

#### Automatic Trigger
```http
POST /api/v1/cost-documentation/generate/auto
Content-Type: application/json

{
  "anomaly_id": "abc123",
  "type": "lost_units",
  "sku": "SKU-45",
  "expected_units": 100,
  "received_units": 95,
  "loss": 5,
  "cost_per_unit": 12.50,
  "total_loss": 62.50,
  "detected_at": "2025-08-22T10:45:00Z",
  "evidence_links": ["s3://artifacts/sku45_receiving_scan.pdf"],
  "seller_info": {
    "seller_id": "seller123",
    "business_name": "Example Corp"
  }
}
```

#### Manual Trigger
```http
POST /api/v1/cost-documentation/generate/manual
Content-Type: application/json

{
  // Same payload as automatic trigger
}
```

### Retrieval

#### Get by Anomaly ID
```http
GET /api/v1/cost-documentation/anomaly/:anomalyId
```

#### Get by Seller ID
```http
GET /api/v1/cost-documentation/seller/:sellerId?page=1&limit=20
```

### Queue Management (Admin/Agent Only)

#### Queue Statistics
```http
GET /api/v1/cost-documentation/queue/stats
```

#### Job Status
```http
GET /api/v1/cost-documentation/queue/job/:jobId
```

#### Retry Failed Job
```http
POST /api/v1/cost-documentation/queue/job/:jobId/retry
```

#### Queue Control
```http
POST /api/v1/cost-documentation/queue/pause
POST /api/v1/cost-documentation/queue/resume
DELETE /api/v1/cost-documentation/queue/clear
```

## 🔧 Configuration

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
S3_BUCKET=your-bucket-name

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/cost_docs

# Server
PORT=3001
NODE_ENV=development
```

### Supported Anomaly Types

- `lost_units` - Missing inventory units
- `overcharges` - Excessive fees or charges
- `damaged_stock` - Damaged inventory items
- `incorrect_fee` - Wrong fee amounts
- `duplicate_charge` - Duplicate billing
- `pricing_discrepancy` - Price mismatches

## 📊 PDF Structure

### Header Section
- Seller information
- Anomaly type and date
- Report generation timestamp

### Anomaly Details
- Anomaly ID and SKU
- Expected vs. received quantities
- Detection timestamp
- Anomaly classification

### Cost Breakdown
- Itemized cost calculations
- Unit costs and quantities
- Total loss amount
- Currency information

### Evidence Section
- Links to S3 artifacts
- Supporting documentation
- Receipts and invoices
- Shipping manifests

### Footer
- "Generated by Sack AI – Automated Evidence Engine"
- Watermark and security features

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 12+
- Redis 6+
- AWS S3 bucket
- Docker (optional)

### Installation

1. **Clone and Install Dependencies**
```bash
cd cost-documentation-module
npm install
```

2. **Environment Setup**
```bash
cp env.example .env
# Edit .env with your configuration
```

3. **Database Setup**
```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

4. **Start Services**
```bash
# Start Redis (if not running)
redis-server

# Start the main service
npm run dev

# Start the cost documentation worker (in another terminal)
npm run worker:cost-docs
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up --build
```

## 🖥️ Local Development

### Running the PDF Renderer Locally

The PDF renderer service can be run independently for development and testing:

```bash
# Install dependencies
npm install

# Start the renderer service only
npm run dev:renderer

# Or run specific renderer functions
node -e "
const { renderPdfBuffer } = require('./dist/services/pdfRenderer');
const evidence = require('./examples/evidence.overcharges.json');

renderPdfBuffer(evidence, 'v1.0')
  .then(buffer => console.log('PDF generated:', buffer.length, 'bytes'))
  .catch(err => console.error('Error:', err));
"
```

### Environment Variables

Create a `.env` file based on `env.example`:

```bash
# Copy environment template
cp env.example .env

# Edit with your values
nano .env
```

**Required Environment Variables:**

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/cost_docs"
DATABASE_URL_TEST="postgresql://user:password@localhost:5432/cost_docs_test"

# Redis (for job queue)
REDIS_URL="redis://localhost:6379"
REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_PASSWORD=""
REDIS_DB="0"

# AWS S3
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_REGION="us-east-1"
S3_BUCKET="your-bucket-name"
S3_BUCKET_PREFIX="docs"

# JWT Authentication
JWT_SECRET="your-jwt-secret-key"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# PDF Generation
PDF_TEMPLATE_VERSION="v1.0"
PDF_GENERATION_TIMEOUT="30000"
PDF_MAX_CONCURRENCY="3"
PDF_MEMORY_LIMIT="512"

# Queue Configuration
QUEUE_MAX_CONCURRENCY="2"
QUEUE_MAX_RETRIES="3"
QUEUE_BACKOFF_DELAY="1000"
```

**Optional Environment Variables:**

```bash
# Security
RATE_LIMIT_WINDOW_MS="900000"
RATE_LIMIT_MAX_REQUESTS="100"
CORS_ORIGIN="http://localhost:3000"

# Monitoring
LOG_LEVEL="info"
METRICS_ENABLED="true"
HEALTH_CHECK_INTERVAL="30000"

# Performance
WORKER_POOL_SIZE="2"
JOB_TIMEOUT_MS="60000"
S3_SIGNED_URL_TTL="3600"
```

### Testing the API

#### 1. Manual PDF Generation

```bash
# Generate PDF for overcharges anomaly
curl -X POST http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d @examples/evidence.overcharges.json
```

#### 2. Automatic Job Enqueue

```bash
# Enqueue automatic PDF generation
curl -X POST http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d @examples/evidence.lost-units.json
```

#### 3. Check Job Status

```bash
# Get job status by ID
curl -X GET http://localhost:3001/api/v1/cost-documentation/job/JOB_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### 4. Retrieve Generated PDF

```bash
# Get PDF by anomaly ID
curl -X GET http://localhost:3001/api/v1/cost-documentation/anomaly/ANOMALY_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get PDFs by seller ID
curl -X GET "http://localhost:3001/api/v1/cost-documentation/seller/SELLER_ID?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### 5. Queue Management (Admin Only)

```bash
# Get queue statistics
curl -X GET http://localhost:3001/api/v1/cost-documentation/queue/stats \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Pause queue
curl -X POST http://localhost:3001/api/v1/cost-documentation/queue/pause \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Resume queue
curl -X POST http://localhost:3001/api/v1/cost-documentation/queue/resume \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Verification Scripts

#### Determinism Verification

```bash
# Run the determinism verification script
./scripts/verify-determinism.sh

# On Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts/verify-determinism.ps1

# Or manually verify
node scripts/verify-determinism.js
```

#### Test Coverage

```bash
# Run all tests with coverage
npm run test:coverage

# Run specific test suites
npm test -- tests/determinism.test.ts
npm test -- tests/idempotency.test.ts
npm test -- tests/auth.routes.test.ts
npm test -- tests/s3.mock.test.ts
npm test -- tests/metadata.test.ts
```

### Development Workflow

1. **Start Development Environment**
   ```bash
   # Terminal 1: Start Redis
   redis-server
   
   # Terminal 2: Start PostgreSQL
   # (or use Docker: docker run -d --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:15)
   
   # Terminal 3: Start main service
   npm run dev
   
   # Terminal 4: Start worker
   npm run worker:cost-docs
   ```

2. **Test PDF Generation**
   ```bash
   # Test with sample evidence
   curl -X POST http://localhost:3001/api/v1/cost-documentation/generate/manual \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer test-token" \
     -d @examples/evidence.overcharges.json
   ```

3. **Monitor Queue**
   ```bash
   # Check queue status
   curl http://localhost:3001/api/v1/cost-documentation/queue/stats
   
   # View logs
   tail -f logs/cost-documentation.log
   ```

4. **Verify Determinism**
   ```bash
   # Run determinism tests
   npm test -- tests/determinism.test.ts
   
   # Manual verification
   node -e "
   const { renderPdfBuffer } = require('./dist/services/pdfRenderer');
   const evidence = require('./examples/evidence.overcharges.json');
   
   Promise.all([
     renderPdfBuffer(evidence, 'v1.0'),
     renderPdfBuffer(evidence, 'v1.0')
   ]).then(([pdf1, pdf2]) => {
     const crypto = require('crypto');
     const hash1 = crypto.createHash('sha256').update(pdf1).digest('hex');
     const hash2 = crypto.createHash('sha256').update(pdf2).digest('hex');
     console.log('Deterministic:', hash1 === hash2);
     console.log('Hash 1:', hash1);
     console.log('Hash 2:', hash2);
   });
   "
   ```

## 🔄 Workflow

### Automatic Trigger Flow

1. **Detection Pipeline** detects anomaly and passes thresholds
2. **Evidence JSON** is generated with anomaly details
3. **Cost Documentation Job** is queued automatically
4. **Worker** processes the job in background
5. **PDF Generation** using appropriate template
6. **S3 Upload** and signed URL generation
7. **Database Update** with PDF metadata
8. **Dashboard Notification** of completed documentation

### Manual Trigger Flow

1. **User** selects anomaly in dashboard
2. **Manual Generation** request is sent
3. **Immediate Processing** (bypasses queue)
4. **PDF Generation** and S3 upload
5. **Real-time Response** with PDF URL

## 📈 Monitoring & Management

### Queue Health

- **Backpressure Monitoring**: Queue size and processing rates
- **Job Status Tracking**: Success/failure rates and retry counts
- **Performance Metrics**: Processing times and throughput

### Error Handling

- **Automatic Retries**: Exponential backoff for failed jobs
- **Error Logging**: Detailed error tracking and reporting
- **Fallback Mechanisms**: Graceful degradation on failures

### Scaling

- **Horizontal Scaling**: Multiple worker instances
- **Load Balancing**: Queue distribution across workers
- **Resource Management**: Memory and CPU optimization

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Test Coverage
```bash
npm run test:coverage
```

## 🔒 Security

- **Authentication**: JWT-based API security
- **Authorization**: Role-based access control
- **Data Validation**: Input sanitization and validation
- **S3 Security**: Signed URLs with expiration
- **Rate Limiting**: API request throttling

## 📚 Integration Examples

### Frontend Dashboard Integration

```typescript
// Generate cost documentation for an anomaly
const generateDoc = async (anomalyId: string) => {
  const response = await fetch('/api/v1/cost-documentation/generate/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(anomalyEvidence)
  });
  
  const result = await response.json();
  if (result.success) {
    // Redirect to PDF or show download link
    window.open(result.pdf.url, '_blank');
  }
};
```

### Detection Pipeline Integration

```typescript
// Automatically queue cost documentation when anomaly is detected
const queueCostDocumentation = async (evidence: AnomalyEvidence) => {
  await fetch('/api/v1/cost-documentation/generate/auto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(evidence)
  });
};
```

## 🚨 Troubleshooting

### Common Issues

1. **PDF Generation Fails**
   - Check Puppeteer installation
   - Verify template HTML syntax
   - Check memory usage

2. **Queue Processing Stops**
   - Verify Redis connection
   - Check worker logs
   - Restart worker process

3. **S3 Upload Errors**
   - Verify AWS credentials
   - Check S3 bucket permissions
   - Validate file size limits

### Debug Mode

```bash
# Enable debug logging
DEBUG=* npm run dev

# Check queue status
curl http://localhost:3001/api/v1/cost-documentation/queue/stats
```

## 📈 Performance Optimization

### PDF Generation
- **Template Caching**: Compiled Handlebars templates
- **Browser Reuse**: Single Puppeteer instance
- **Memory Management**: Proper cleanup and resource management

### Queue Processing
- **Concurrency Control**: Configurable worker limits
- **Priority Handling**: Critical jobs processed first
- **Batch Processing**: Efficient job batching

### S3 Operations
- **Async Uploads**: Non-blocking file operations
- **URL Caching**: Signed URL optimization
- **Compression**: PDF size optimization

## 🔮 Future Enhancements

- **Template Editor**: Web-based template customization
- **Multi-language Support**: Internationalization for PDFs
- **Advanced Analytics**: PDF generation metrics and insights
- **Webhook Integration**: Real-time notifications
- **Batch Processing**: Bulk PDF generation
- **Custom Branding**: Seller-specific PDF styling

## 📞 Support

For technical support or feature requests:

- **Documentation**: Check this README and API docs
- **Issues**: Report bugs via GitHub issues
- **Discussions**: Join community discussions
- **Email**: support@sackai.com

---

**Built with ❤️ by the Sack AI Team**

*Automating evidence generation for better dispute resolution*



