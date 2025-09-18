# FBA Refund Predictor - Detection System Implementation

## Overview

This document describes the complete implementation of the detection system for the FBA Refund Predictor repository. The system provides automated anomaly detection for Amazon FBA data with deterministic evidence generation and S3 artifact storage.

## Architecture

### High-Level Design

The detection system consists of two main components:

1. **TypeScript Service** (`cost-documentation-module/`): Main API and job management
2. **Python Service** (`mcde/`): Detection engine with rule processing

Both services work together to provide a robust, scalable anomaly detection system.

### Data Flow

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Sync System   │───▶│  Detection Queue │───▶│ Detection Rules │
│                 │    │  (TypeScript)    │    │  (TS + Python)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ Detection Worker │    │ Evidence Builder│
                       │  (TS + Python)  │    │  (TS + Python)  │
                       └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   Database      │    │      S3        │
                       │  (Results)      │    │   (Artifacts)   │
                       └──────────────────┘    └─────────────────┘
```

## Implementation Details

### 1. Database Schema

#### New Tables Added

- **`DetectionJob`**: Tracks detection job status and metadata
  - `id`, `sellerId`, `syncId`, `status`, `priority`, `attempts`, `lastError`
  - Indexes on `sellerId`, `syncId`, `status`, `priority`, `createdAt`

- **`DetectionResult`**: Stores anomaly detection results
  - `id`, `sellerId`, `syncId`, `ruleType`, `severity`, `score`, `summary`
  - `evidenceJson`, `evidenceS3Url`, `dedupeHash`
  - Unique index on `(sellerId, ruleType, dedupeHash)` for idempotency

- **`DetectionThreshold`**: Configurable thresholds for each rule type
  - `id`, `sellerId` (null for global), `ruleType`, `operator`, `value`, `active`
  - Supports seller-specific overrides

- **`DetectionWhitelist`**: Whitelist rules for specific items
  - `id`, `sellerId`, `scope` (SKU/ASIN/VENDOR/SHIPMENT), `value`, `reason`, `active`

#### Default Thresholds

- **LOST_UNITS**: Ignore < 1% of total units or < $5
- **OVERCHARGED_FEES**: Ignore deltas < $2
- **DAMAGED_STOCK**: Ignore < $5 or < 1 unit

### 2. Detection Rules

#### Rule Types

1. **LostUnitsRule** (Priority: HIGH)
   - Detects lost inventory units
   - Triggers on percentage or absolute value thresholds
   - Supports SKU, ASIN, and vendor whitelisting

2. **OverchargedFeesRule** (Priority: HIGH)
   - Identifies excessive fees
   - Compares actual vs expected fees
   - Supports comprehensive whitelisting

3. **DamagedStockRule** (Priority: MEDIUM)
   - Finds damaged inventory items
   - Triggers on units or value thresholds
   - Supports vendor and item whitelisting

#### Rule Implementation

Both TypeScript and Python implementations provide:
- Deterministic anomaly detection
- Threshold checking with operator support (GT, GTE, LT, LTE, EQ)
- Whitelist bypass functionality
- Consistent deduplication hashing

### 3. Evidence Generation

#### Deterministic Evidence JSON

```json
{
  "metadata": {
    "ruleType": "LOST_UNITS",
    "sellerId": "seller123",
    "syncId": "sync456",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "inputSnapshotHash": "a1b2c3d4e5f6g7h8",
    "thresholdApplied": {
      "thresholdId": "threshold1",
      "operator": "LT",
      "value": 0.01
    },
    "computations": {
      "severity": "HIGH",
      "score": 0.75,
      "rulePriority": "HIGH"
    }
  },
  "anomaly": {
    "ruleType": "LOST_UNITS",
    "severity": "HIGH",
    "score": 0.75,
    "summary": "Lost units detected: 10 units (SKU001) worth $50",
    "evidence": {...}
  },
  "inputData": {...}
}
```

#### S3 Artifact Storage

Evidence artifacts are stored with consistent pathing:
```
s3://bucket/evidence/{sellerId}/{syncId}/{ruleType}/{dedupeHash}.json
```

### 4. Queue Management

#### Priority System

- **CRITICAL**: Highest priority, processed first
- **HIGH**: High priority, processed after CRITICAL
- **NORMAL**: Standard priority, processed after HIGH
- **LOW**: Lowest priority, processed last

#### Backpressure Controls

- Configurable queue length threshold
- Automatic priority filtering during high load
- Only CRITICAL and HIGH jobs processed during backpressure

#### Concurrency Management

- Configurable worker concurrency
- Automatic job distribution
- Graceful shutdown handling

### 5. Idempotency & Determinism

#### Deduplication Hash

- Generated from normalized core fields
- Ensures same inputs produce same hash
- Prevents duplicate results across retries

#### Input Snapshot Hash

- Hash of normalized input data
- Enables reproducibility verification
- Stored in evidence metadata

## API Endpoints

### Detection Jobs

- `POST /api/detection/jobs` - Enqueue detection job
- `GET /api/detection/jobs/:id/status` - Get job status
- `POST /api/detection/jobs/:id/retry` - Retry failed job
- `DELETE /api/detection/jobs/:id` - Delete job

### Detection Results

- `GET /api/detection/results` - Get results with filters
- `GET /api/detection/results/:syncId` - Get results by sync ID
- `GET /api/detection/stats` - Get detection statistics
- `GET /api/detection/queue/stats` - Get queue statistics

## Usage Examples

### Enqueue Detection Job

```bash
curl -X POST http://localhost:3001/api/detection/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "sellerId": "seller123",
    "syncId": "sync456",
    "priority": "HIGH"
  }'
```

### Get Detection Results

```bash
curl "http://localhost:3001/api/detection/results?sellerId=seller123&limit=10"
```

### Run Python Worker

```bash
# From mcde/ directory
python -m src.detection_engine.worker

# With custom config
python -m src.detection_engine.worker --config config.yaml

# Validate config
python -m src.detection_engine.worker --dry-run
```

## Testing

### TypeScript Tests

```bash
# Run detection tests only
npm run test:detection

# Run with coverage
npm run test:coverage
```

### Python Tests

```bash
# Run detection tests only
make test-detection

# Run all tests
make test
```

## Configuration

### Environment Variables

#### TypeScript Service

```bash
# Detection System Configuration
DETECTION_WORKER_CONCURRENCY=5
DETECTION_WORKER_POLL_INTERVAL_MS=5000
DETECTION_WORKER_MAX_RETRIES=3
DETECTION_ENABLE_PY_WORKER=false
DETECTION_QUEUE_BACKPRESSURE_THRESHOLD=20
```

#### Python Service

```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cost_documentation_db
DB_USER=postgres
DB_PASSWORD=your_password

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
S3_BUCKET_NAME=opside-cost-documents

# Worker Configuration
DETECTION_WORKER_CONCURRENCY=5
DETECTION_WORKER_POLL_INTERVAL_MS=5000
DETECTION_WORKER_MAX_RETRIES=3
```

## Deployment

### Prerequisites

1. PostgreSQL database with detection tables
2. AWS S3 bucket for evidence artifacts
3. Proper AWS credentials and permissions
4. Node.js 18+ and Python 3.8+

### Setup Steps

1. **Database Setup**
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

2. **Environment Configuration**
   - Set all required environment variables
   - Configure AWS credentials
   - Set database connection details

3. **Service Startup**
   ```bash
   # Start TypeScript service
   npm start
   
   # Start Python worker
   python -m src.detection_engine.worker
   ```

### Docker Deployment

```bash
# TypeScript service
docker build -t cost-documentation-module .
docker run -p 3001:3001 cost-documentation-module

# Python service
docker build -t mcde .
docker run mcde
```

## Monitoring & Observability

### Key Metrics

- Queue length and processing rate
- Job success/failure rates
- Evidence generation rate
- S3 upload success rate
- Worker concurrency levels

### Health Checks

- Database connectivity
- S3 access verification
- Worker process status
- Queue health indicators

### Logging

- Structured logging for all operations
- Error tracking and reporting
- Performance monitoring
- Audit trail maintenance

## Performance Considerations

### Optimization Strategies

1. **Database**
   - Proper indexing on frequently queried fields
   - Connection pooling for high concurrency
   - Query optimization for large datasets

2. **S3 Operations**
   - Batch uploads where possible
   - Appropriate storage class selection
   - Retry logic for transient failures

3. **Worker Processes**
   - Configurable concurrency levels
   - Efficient job polling intervals
   - Graceful backpressure handling

### Scaling Considerations

- Horizontal scaling of worker processes
- Database read replicas for reporting
- S3 lifecycle policies for cost optimization
- Load balancing for API endpoints

## Security Features

### Data Protection

- Input validation and sanitization
- Sensitive data redaction in evidence
- Secure S3 bucket policies
- Database access controls

### Access Control

- JWT-based authentication
- Role-based permissions
- API rate limiting
- Audit logging for all operations

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify connection string format
   - Check network connectivity
   - Verify database server status

2. **S3 Upload Failures**
   - Check AWS credentials
   - Verify bucket permissions
   - Check network connectivity

3. **Worker Not Processing**
   - Check worker logs
   - Verify database connectivity
   - Check job status in database

### Debug Mode

```bash
# TypeScript
NODE_ENV=development npm run dev

# Python
python -m src.detection_engine.worker --log-level DEBUG
```

## Future Enhancements

### Planned Features

1. **Advanced Rules Engine**
   - Custom rule definition
   - Machine learning-based anomaly detection
   - Rule performance analytics

2. **Enhanced Monitoring**
   - Real-time dashboards
   - Alerting and notifications
   - Performance benchmarking

3. **Integration Improvements**
   - Webhook support for real-time processing
   - Advanced queue backends (Redis, SQS)
   - Multi-region deployment support

### Extension Points

- Custom rule implementations
- Additional evidence formats
- Alternative storage backends
- Enhanced reporting capabilities

## Conclusion

The detection system provides a robust, scalable solution for automated FBA anomaly detection. With both TypeScript and Python implementations, it offers flexibility in deployment and integration while maintaining consistency in business logic and evidence generation.

The system is designed for production use with proper error handling, monitoring, and scalability considerations. The deterministic nature of evidence generation ensures reproducible results, while the comprehensive testing suite provides confidence in the implementation.

For questions or support, refer to the individual service READMEs or create issues in the repository.

