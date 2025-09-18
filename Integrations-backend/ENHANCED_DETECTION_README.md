# Enhanced Detection & Dispute System

## Overview

The Enhanced Detection & Dispute System is a comprehensive solution that automatically detects anomalies in synced data and creates dispute cases for reimbursement claims. The system integrates seamlessly with the existing sync pipeline and provides configurable automation rules for dispute management.

## 🏗️ Architecture

### Core Components

1. **Enhanced Detection Service** (`enhancedDetectionService.ts`)
   - Triggers detection pipeline after sync completion
   - Manages detection jobs with priority and backpressure controls
   - Integrates with thresholds and whitelist systems
   - Automatically creates dispute cases for high-severity anomalies

2. **Dispute Service** (`disputeService.ts`)
   - Manages dispute case lifecycle (creation, submission, resolution)
   - Implements automation rules for case processing
   - Integrates with external providers (Amazon, Stripe, Shopify)
   - Maintains audit trail for all case changes

3. **Enhanced Sync Controller** (`enhancedSyncController.ts`)
   - Integrates sync operations with detection pipeline
   - Provides enhanced sync status including detection pipeline information
   - Manages bulk sync operations with detection integration

4. **Database Schema**
   - New tables for dispute management and detection pipeline tracking
   - Configurable thresholds and whitelist systems
   - Audit logging for compliance and debugging

### Data Flow

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Sync System   │───▶│ Detection Trigger│───▶│ Detection Queue │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ Detection Worker │    │ Detection Rules │
                       │                  │    │ + Thresholds    │
                       └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ Detection Results│    │ Dispute Cases  │
                       │                  │    │ + Automation   │
                       └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   Dashboard      │    │ Provider APIs  │
                       │   + Analytics   │    │ (Amazon/Stripe) │
                       └──────────────────┘    └─────────────────┘
```

## 🚀 Features

### Detection Pipeline Integration
- **Automatic Triggering**: Detection pipeline automatically triggers after sync completion
- **Priority Management**: Jobs are processed based on priority (CRITICAL > HIGH > NORMAL > LOW)
- **Backpressure Controls**: System automatically throttles low-priority jobs during high load
- **Retry Logic**: Failed jobs are retried with exponential backoff

### Anomaly Detection
- **Configurable Thresholds**: Set minimum values for different anomaly types
- **Whitelist System**: Exclude specific SKUs, ASINs, vendors, or shipments from detection
- **Multiple Rule Types**: Support for missing units, overcharges, damaged stock, incorrect fees, and duplicate charges
- **Deterministic Results**: Same inputs always produce identical detection results

### Dispute Management
- **Automated Case Creation**: High-severity anomalies automatically create dispute cases
- **Provider Integration**: Submit cases to Amazon, Stripe, or Shopify APIs
- **Case Tracking**: Full lifecycle management from creation to resolution
- **Audit Trail**: Complete history of all case changes and actions

### Automation Rules
- **Configurable Conditions**: Set rules based on case type, amount, provider, etc.
- **Flexible Actions**: Automatically submit or approve cases based on rules
- **Priority System**: Rules are evaluated in priority order
- **Seller-Specific**: Each seller can have their own automation rules

## 📋 API Endpoints

### Enhanced Detection

#### Trigger Detection Pipeline
```http
POST /api/enhanced-detection/trigger
Content-Type: application/json

{
  "syncId": "sync-123",
  "triggerType": "inventory",
  "metadata": { "test": "data" }
}
```

#### Get Detection Results
```http
GET /api/enhanced-detection/results?limit=10&offset=0&status=pending
```

#### Get Detection Statistics
```http
GET /api/enhanced-detection/statistics
```

#### Get Queue Statistics
```http
GET /api/enhanced-detection/queue/stats
```

### Dispute Management

#### Create Dispute Case
```http
POST /api/enhanced-detection/disputes
Content-Type: application/json

{
  "detectionResultId": "result-123",
  "caseType": "amazon_fba",
  "claimAmount": 50.00,
  "currency": "USD",
  "evidence": { "test": "data" }
}
```

#### Get Dispute Cases
```http
GET /api/enhanced-detection/disputes?status=pending&limit=10&offset=0
```

#### Submit Dispute Case
```http
POST /api/enhanced-detection/disputes/:id/submit
Content-Type: application/json

{
  "submissionData": { "test": "data" },
  "evidenceIds": ["evidence-1", "evidence-2"]
}
```

#### Get Dispute Statistics
```http
GET /api/enhanced-detection/disputes/statistics
```

### Automation Rules

#### Create Automation Rule
```http
POST /api/enhanced-detection/automation-rules
Content-Type: application/json

{
  "ruleName": "Auto Submit High Value",
  "ruleType": "auto_submit",
  "conditions": {
    "min_amount": 100,
    "case_type": "amazon_fba"
  },
  "actions": {
    "auto_submit": true
  },
  "isActive": true,
  "priority": 1
}
```

#### Get Automation Rules
```http
GET /api/enhanced-detection/automation-rules
```

### Thresholds and Whitelist

#### Get Detection Thresholds
```http
GET /api/enhanced-detection/thresholds
```

#### Create/Update Threshold
```http
POST /api/enhanced-detection/thresholds
Content-Type: application/json

{
  "ruleType": "missing_unit",
  "thresholdValue": 10.00,
  "thresholdOperator": "gte",
  "currency": "USD"
}
```

#### Get Whitelist
```http
GET /api/enhanced-detection/whitelist
```

#### Create Whitelist Entry
```http
POST /api/enhanced-detection/whitelist
Content-Type: application/json

{
  "whitelistType": "sku",
  "whitelistValue": "SKU123",
  "reason": "Test reason"
}
```

### Enhanced Sync

#### Start Enhanced Sync
```http
POST /api/enhanced-sync/start
Content-Type: application/json

{
  "syncType": "inventory",
  "enableDetection": true
}
```

#### Get Enhanced Sync Status
```http
GET /api/enhanced-sync/status/:syncId
```

#### Get Enhanced Sync History
```http
GET /api/enhanced-sync/history?limit=10&offset=0
```

#### Get Enhanced Sync Statistics
```http
GET /api/enhanced-sync/statistics
```

#### Bulk Sync Operations
```http
POST /api/enhanced-sync/bulk
Content-Type: application/json

{
  "syncs": [
    { "syncType": "inventory", "enableDetection": true },
    { "syncType": "financial", "enableDetection": true }
  ]
}
```

#### System Health
```http
GET /api/enhanced-sync/health
```

#### Queue Status
```http
GET /api/enhanced-sync/queue
```

## ⚙️ Configuration

### Environment Variables

```bash
# Enhanced Detection System
DETECTION_WORKER_CONCURRENCY=5
DETECTION_WORKER_POLL_INTERVAL_MS=5000
DETECTION_WORKER_MAX_RETRIES=3
DETECTION_ENABLE_PY_WORKER=false
DETECTION_QUEUE_BACKPRESSURE_THRESHOLD=20
DETECTION_AUTO_CREATE_DISPUTES=true
DETECTION_MIN_SEVERITY_FOR_DISPUTE=high

# Dispute System
DISPUTE_AUTO_SUBMIT_ENABLED=false
DISPUTE_AUTO_APPROVE_ENABLED=false
DISPUTE_MAX_CLAIM_AMOUNT=10000
DISPUTE_MIN_CLAIM_AMOUNT=1

# AWS S3 (for evidence storage)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
S3_BUCKET_NAME=opside-evidence-bucket
S3_EVIDENCE_PATH=evidence
```

### Database Migration

Run the new migration to create the required tables:

```bash
# Apply the migration
psql -d your_database -f migrations/005_add_dispute_system.sql
```

## 🧪 Testing

### Run Tests

```bash
# Run all tests
npm test

# Run enhanced detection tests only
npm test -- enhancedDetection.test.ts

# Run with coverage
npm test -- --coverage
```

### Test Coverage

The test suite covers:
- ✅ Detection pipeline integration
- ✅ Job processing with priority and backpressure
- ✅ Dispute case creation and management
- ✅ Automation rule evaluation and execution
- ✅ API endpoint functionality
- ✅ Error handling and edge cases
- ✅ Performance and scalability features

## 📊 Monitoring and Observability

### Key Metrics

- **Detection Pipeline Health**: Success rate, processing time, queue length
- **Dispute Case Metrics**: Creation rate, submission success, resolution time
- **System Performance**: Job processing rate, backpressure events, error rates

### Health Checks

- **Sync System Health**: `/api/enhanced-sync/health`
- **Detection Queue Status**: `/api/enhanced-detection/queue/stats`
- **Overall System Status**: `/health`

### Logging

All operations are logged with structured metadata:
- Detection pipeline triggers and job processing
- Dispute case lifecycle events
- Automation rule execution
- Error conditions and retry attempts

## 🔧 Development

### Adding New Detection Rules

1. **Extend Base Rule Class**:
```typescript
export class NewAnomalyRule extends BaseRule {
  ruleType = 'new_anomaly';
  priority = 'medium';

  async apply(input: RuleInput, context: RuleContext): Promise<Anomaly[]> {
    // Implement detection logic
    // Apply thresholds and whitelist
    // Return detected anomalies
  }
}
```

2. **Add to Rules Index**:
```typescript
// In rules/index.ts
export const ALL_RULES = [
  // ... existing rules
  new NewAnomalyRule()
];
```

3. **Update Database Schema**:
```sql
-- Add new anomaly type to enum
ALTER TYPE rule_type ADD VALUE 'new_anomaly';

-- Add default threshold
INSERT INTO detection_thresholds (rule_type, threshold_value, threshold_operator, currency)
VALUES ('new_anomaly', 5.00, 'gte', 'USD');
```

### Adding New Provider Integration

1. **Extend Provider Methods**:
```typescript
// In disputeService.ts
private async submitToNewProvider(disputeCase: DisputeCase, submissionData: any) {
  // Implement provider-specific submission logic
  return {
    provider_case_id: `NEW-${Date.now()}`,
    provider_response: { submitted: true }
  };
}
```

2. **Update Provider Mapping**:
```typescript
private determineProvider(caseType: string): 'amazon' | 'stripe' | 'shopify' | 'new_provider' {
  switch (caseType) {
    // ... existing cases
    case 'new_case_type':
      return 'new_provider';
    default:
      return 'amazon';
  }
}
```

## 🚀 Deployment

### Prerequisites

1. **Database**: PostgreSQL with the new schema tables
2. **Redis**: For job queue management
3. **AWS S3**: For evidence artifact storage
4. **Environment Variables**: All required configuration set

### Deployment Steps

1. **Apply Database Migration**:
```bash
psql -d your_database -f migrations/005_add_dispute_system.sql
```

2. **Update Environment Configuration**:
```bash
# Copy and configure new environment variables
cp env.example .env
# Edit .env with your values
```

3. **Restart Services**:
```bash
# Restart the backend service
npm run restart

# Or if using PM2
pm2 restart integrations-backend
```

4. **Verify Deployment**:
```bash
# Check health endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/enhanced-sync/health
```

### Production Considerations

- **Monitoring**: Set up alerts for high error rates and queue backpressure
- **Scaling**: Adjust worker concurrency based on system load
- **Backup**: Ensure database backups include new dispute tables
- **Security**: Review RLS policies and access controls

## 🔍 Troubleshooting

### Common Issues

1. **Detection Pipeline Not Triggering**:
   - Check sync completion events
   - Verify detection is enabled in sync configuration
   - Check database for sync_detection_triggers records

2. **Jobs Not Processing**:
   - Check Redis connection and queue status
   - Verify worker processes are running
   - Check for database connection issues

3. **Dispute Cases Not Creating**:
   - Verify detection results are being generated
   - Check severity thresholds configuration
   - Review automation rules

4. **Provider Integration Failures**:
   - Check API credentials and permissions
   - Verify network connectivity
   - Review provider response logs

### Debug Mode

Enable debug logging for troubleshooting:

```bash
LOG_LEVEL=debug npm start
```

### Performance Tuning

- **Worker Concurrency**: Adjust based on CPU and memory resources
- **Queue Backpressure**: Set threshold based on system capacity
- **Database Connections**: Optimize connection pooling for high load
- **Redis Configuration**: Tune memory and persistence settings

## 📚 Additional Resources

- **API Documentation**: See individual route files for detailed endpoint documentation
- **Database Schema**: Review migration files for table structures
- **Configuration**: Check environment variable documentation
- **Testing**: Run test suite for implementation examples

## 🤝 Contributing

When contributing to the enhanced detection system:

1. **Follow Existing Patterns**: Maintain consistency with current architecture
2. **Add Tests**: Ensure new features have comprehensive test coverage
3. **Update Documentation**: Keep README and API docs current
4. **Database Changes**: Include migrations and schema updates
5. **Environment Variables**: Document new configuration options

## 📄 License

This system is part of the Opside Integrations Hub Backend and follows the same licensing terms.

