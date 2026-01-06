# Detection Pipeline Implementation

## Overview

The Detection Pipeline is a comprehensive anomaly detection system that transforms synced raw data into actionable anomalies with deterministic evidence and S3 artifacts. It's designed to run at scale with low noise and strong backpressure controls.

## Architecture

### High-Level Flow

```
Sync Layer (Postgres/Supabase) → Detection Service → Evidence Builder → S3 Storage → Results DB
                    ↓
            Queue Management (Redis/Postgres)
                    ↓
            Threshold/Whitelist Engine
                    ↓
            Notification System
```

### Components

1. **Detection Service** - Core anomaly detection engine
2. **Queue Management** - Job queuing and worker management
3. **Rule Engine** - Configurable anomaly detection rules
4. **Evidence Builder** - Deterministic evidence generation
5. **Threshold/Whitelist System** - Noise reduction and filtering
6. **S3 Integration** - Artifact storage and retrieval

## Implementation Details

### 1. Core Anomaly Rules (Baseline)

#### Supported Anomaly Types

- **LOST_UNITS**: Detects when lost units exceed configurable threshold
- **OVERCHARGED_FEES**: Identifies fee discrepancies above threshold
- **DAMAGED_STOCK**: Flags damaged stock occurrences
- **DUPLICATE_CHARGES**: Detects duplicate billing entries
- **INVALID_SHIPPING**: Identifies shipping cost anomalies
- **PRICING_DISCREPANCY**: Flags pricing inconsistencies

#### Rule Configuration

Rules are configurable through the `DetectionThreshold` table:

```sql
CREATE TABLE detection_thresholds (
    id UUID PRIMARY KEY,
    anomaly_type anomaly_type NOT NULL,
    threshold DECIMAL(15,2) NOT NULL,
    operator threshold_operator NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);
```

#### Default Thresholds

- **Lost Units**: > 1 unit
- **Overcharged Fees**: > $0.50 discrepancy
- **Damaged Stock**: > 0 units

### 2. Sync → Detection Full Pipeline Hookup

#### Job Enqueueing

```typescript
// TypeScript (cost-documentation-module)
const job = await detectionService.enqueueDetectionJob(
    claimId, 
    userId, 
    'HIGH' // priority
);
```

```python
# Python (mcde)
anomalies = detection_engine.detect_anomalies(
    cost_documents, 
    claim_id, 
    user_id
)
```

#### Worker Process

The detection worker runs as an async service with configurable intervals:

```typescript
// Start worker with 5-second intervals
detectionService.startDetectionWorker(5000);

// Stop worker
detectionService.stopDetectionWorker();
```

#### Concurrency Control

- **Batch Processing**: Processes jobs in batches of 10
- **Concurrency Limit**: Maximum 3 concurrent jobs
- **Priority Ordering**: High priority jobs processed first

### 3. Evidence Builder

#### Evidence Schema

```json
{
  "sync_id": "job-uuid",
  "seller_id": "user-uuid",
  "detected_anomalies": [
    {
      "event_type": "lost_units",
      "item_id": "sku-123",
      "amount_discrepancy": 2,
      "evidence_refs": ["claim:claim-123", "doc:doc-456"]
    }
  ],
  "metadata": {
    "source_tables": ["claims", "cost_documents", "skus"],
    "detection_version": "v1.0",
    "thresholds_applied": {
      "lost_units": 1.0,
      "overcharged_fees": 0.50
    },
    "whitelist_checks": {
      "whitelist_count": 5
    }
  },
  "created_at": "2024-01-23T10:30:00Z"
}
```

#### S3 Storage

Evidence artifacts are stored with the following key structure:

```
s3://bucket/evidence/{userId}/{jobId}/detection.json
```

### 4. Queue & Backpressure Management

#### Job States

- **PENDING**: Job queued, waiting for processing
- **PROCESSING**: Currently being analyzed
- **COMPLETED**: Successfully processed
- **FAILED**: Processing failed after max retries
- **RETRYING**: Failed, attempting retry

#### Retry Logic

- **Max Attempts**: 3 retries per job
- **Exponential Backoff**: Increasing delays between retries
- **Failure Tracking**: Detailed failure reasons logged

#### Backpressure Controls

- **Queue Length Monitoring**: Alerts when queue exceeds safe limits
- **Priority Processing**: Critical anomalies processed first
- **Resource Limits**: Configurable concurrency limits

### 5. Thresholds / Whitelists (Noise Reduction)

#### Threshold Configuration

Thresholds can be configured globally or per anomaly type:

```sql
-- Example: Increase lost units threshold
INSERT INTO detection_thresholds (
    anomaly_type, threshold, operator, description
) VALUES (
    'lost_units', 5.0, 'greater_than', 'Custom threshold for large orders'
);
```

#### Whitelist System

Whitelists can exclude specific items from detection:

```sql
-- Example: Whitelist specific SKU
INSERT INTO detection_whitelists (
    sku_code, reason, created_by
) VALUES (
    'SKU-123', 'Known issue, under investigation', 'admin-user'
);
```

#### Whitelist Criteria

- **SKU Code**: Exclude specific products
- **Vendor Name**: Exclude specific suppliers
- **Account ID**: Exclude specific accounts

### 6. Integration with Notifications & Dashboard

#### Real-time Updates

Detection results are immediately available through:

- **REST API**: `/api/detection/results/{claimId}`
- **Statistics**: `/api/detection/statistics`
- **Job Status**: `/api/detection/jobs/{jobId}/status`

#### Dashboard Integration

```typescript
// Get detection statistics
const stats = await detectionService.getDetectionStatistics(userId);

// Get results for a claim
const results = await detectionService.getDetectionResults(claimId);
```

## Database Schema

### TypeScript (Prisma)

```prisma
model DetectionJob {
  id            String   @id @default(uuid())
  claimId       String
  userId        String
  status        DetectionJobStatus @default(PENDING)
  priority      DetectionPriority @default(MEDIUM)
  attemptCount  Int      @default(0)
  maxAttempts   Int      @default(3)
  failureReason String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  claim         Claim    @relation(fields: [claimId], references: [id])
  user          User     @relation(fields: [userId], references: [id])
  detectionResults DetectionResult[]
}

model DetectionResult {
  id              String   @id @default(uuid())
  detectionJobId  String
  costDocId       String
  skuId           String
  anomalyType     AnomalyType
  severity        AnomalySeverity
  confidence      Float
  evidenceUrl     String
  evidenceJson    Json
  thresholdValue  Decimal
  actualValue     Decimal
  isWhitelisted   Boolean  @default(false)
  createdAt       DateTime @default(now())
}
```

### Python (PostgreSQL)

```sql
CREATE TABLE detection_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL,
    user_id UUID NOT NULL,
    status detection_job_status NOT NULL DEFAULT 'pending',
    priority detection_priority NOT NULL DEFAULT 'medium',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    failure_reason TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE detection_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    detection_job_id UUID NOT NULL,
    cost_doc_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    anomaly_type anomaly_type NOT NULL,
    severity anomaly_severity NOT NULL,
    confidence DECIMAL(5,4) NOT NULL,
    evidence_url TEXT NOT NULL,
    evidence_json JSONB NOT NULL,
    threshold_value DECIMAL(15,2) NOT NULL,
    actual_value DECIMAL(15,2) NOT NULL,
    is_whitelisted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

## API Endpoints

### Detection Jobs

- `POST /api/detection/jobs` - Enqueue detection job
- `GET /api/detection/jobs/{jobId}/status` - Get job status

### Detection Results

- `GET /api/detection/results/{claimId}` - Get results for claim
- `GET /api/detection/statistics` - Get user statistics

### Worker Management

- `POST /api/detection/worker/start` - Start detection worker
- `POST /api/detection/worker/stop` - Stop detection worker

### Health Check

- `GET /api/detection/health` - Service health status

## Testing

### TypeScript Tests

Run the comprehensive Jest test suite:

```bash
cd "FBA Refund Predictor/cost-documentation-module"
npm test -- src/tests/detectionService.test.ts
```

### Python Tests

Run the pytest suite:

```bash
cd "FBA Refund Predictor/mcde"
python -m pytest tests/test_detection_engine.py -v
```

### Test Coverage

Tests cover:

- **Rule Engine**: Threshold checking, anomaly detection
- **Evidence Building**: S3 upload, JSON generation
- **Queue Management**: Job processing, retry logic
- **Threshold/Whitelist**: Filtering, noise reduction
- **Error Handling**: Database failures, S3 errors
- **Concurrency**: Batch processing, resource limits

## Deployment

### Prerequisites

1. **Database**: PostgreSQL with required extensions
2. **S3**: AWS S3 bucket for evidence storage
3. **Redis**: For queue management (optional)
4. **Environment Variables**: Configured for each service

### Environment Configuration

#### TypeScript Service

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"

# S3
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_REGION="us-east-1"
S3_BUCKET="your-bucket-name"

# Redis (optional)
REDIS_URL="redis://localhost:6379"
```

#### Python Service

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"

# AWS
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_REGION="us-east-1"
S3_BUCKET="your-bucket-name"

# Redis
REDIS_URL="redis://localhost:6379"
```

### Database Migration

#### TypeScript (Prisma)

```bash
cd "FBA Refund Predictor/cost-documentation-module"
npx prisma migrate dev --name add_detection_pipeline
```

#### Python (Manual)

```bash
cd "FBA Refund Predictor/mcde"
psql -d your_database -f migrations/001_create_detection_tables.sql
```

### Service Startup

#### TypeScript Service

```bash
cd "FBA Refund Predictor/cost-documentation-module"
npm run build
npm start
```

#### Python Service

```bash
cd "FBA Refund Predictor/mcde"
python -m uvicorn src.api.main:app --host 0.0.0.0 --port 8000
```

## Monitoring & Observability

### Health Checks

- **Service Health**: `/api/detection/health`
- **Database Connectivity**: Connection pool status
- **S3 Connectivity**: Upload/download test
- **Queue Status**: Job counts, processing rates

### Metrics

- **Job Processing Rate**: Jobs per minute
- **Success Rate**: Percentage of successful jobs
- **Queue Length**: Number of pending jobs
- **Processing Time**: Average job duration
- **Error Rate**: Failed jobs percentage

### Logging

Structured logging with correlation IDs:

```typescript
logger.info('Detection job completed', {
    jobId: job.id,
    claimId: job.claimId,
    anomaliesFound: anomalies.length,
    processingTime: Date.now() - startTime
});
```

## Performance Considerations

### Optimization Strategies

1. **Batch Processing**: Process multiple jobs concurrently
2. **Database Indexing**: Optimized queries with proper indexes
3. **Connection Pooling**: Efficient database connection management
4. **Caching**: Redis caching for frequently accessed data
5. **Async Processing**: Non-blocking I/O operations

### Scalability

- **Horizontal Scaling**: Multiple worker instances
- **Load Balancing**: Distribute jobs across workers
- **Database Sharding**: Partition data by user/organization
- **CDN Integration**: Fast evidence artifact delivery

## Security

### Authentication & Authorization

- **JWT Tokens**: Secure API access
- **Role-based Access**: Admin vs. user permissions
- **API Rate Limiting**: Prevent abuse

### Data Protection

- **Encryption at Rest**: S3 server-side encryption
- **Encryption in Transit**: HTTPS/TLS for all communications
- **Audit Logging**: Track all detection activities
- **Data Retention**: Configurable retention policies

## Troubleshooting

### Common Issues

1. **Database Connection Failures**
   - Check connection string and credentials
   - Verify database is running and accessible

2. **S3 Upload Failures**
   - Verify AWS credentials and permissions
   - Check S3 bucket exists and is accessible

3. **Job Processing Stuck**
   - Check worker status and logs
   - Verify queue is not full
   - Check for database locks

4. **High False Positive Rate**
   - Adjust threshold values
   - Review and update whitelists
   - Analyze anomaly patterns

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
// TypeScript
process.env.LOG_LEVEL = 'debug';

# Python
import logging
logging.getLogger().setLevel(logging.DEBUG)
```

## Future Enhancements

### Planned Features

1. **Machine Learning Integration**: ML-based anomaly detection
2. **Real-time Streaming**: Kafka integration for live data
3. **Advanced Analytics**: Trend analysis and forecasting
4. **Custom Rule Engine**: User-defined detection rules
5. **Integration APIs**: Webhook support for external systems

### Performance Improvements

1. **GraphQL API**: Efficient data fetching
2. **WebSocket Support**: Real-time updates
3. **Edge Computing**: Lambda functions for processing
4. **Multi-region Support**: Global deployment

## Support & Maintenance

### Documentation

- **API Reference**: OpenAPI/Swagger documentation
- **User Guides**: Step-by-step implementation guides
- **Troubleshooting**: Common issues and solutions

### Maintenance

- **Regular Updates**: Security patches and bug fixes
- **Performance Monitoring**: Continuous performance tracking
- **Capacity Planning**: Resource usage analysis
- **Backup & Recovery**: Data protection strategies

---

## Quick Start Checklist

- [ ] Deploy database and run migrations
- [ ] Configure S3 bucket and permissions
- [ ] Set environment variables
- [ ] Start detection services
- [ ] Run test suites
- [ ] Configure thresholds and whitelists
- [ ] Monitor service health
- [ ] Test anomaly detection
- [ ] Verify evidence generation
- [ ] Check S3 artifact storage

For additional support or questions, refer to the project documentation or contact the development team.


