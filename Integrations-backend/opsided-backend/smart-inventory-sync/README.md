# Smart Inventory Sync Service v2.0

A comprehensive, production-ready inventory synchronization service that ensures your system is always the source of truth for inventory across multiple channels, with intelligent discrepancy detection and automated reconciliation.

## 🎯 Core Features

### 🔄 **Continuous Sync Loop**
- **Automated Scheduling**: Configurable cron-based sync jobs (every 6 hours by default)
- **Multi-Source Integration**: Amazon SP-API, Shopify (planned), eBay (planned)
- **Real-time Monitoring**: Live job status and progress tracking
- **Graceful Recovery**: Automatic retry with exponential backoff

### 🕵️ **Intelligent Discrepancy Detection**
- **Smart Thresholds**: Configurable discrepancy rules per user
- **Severity Classification**: Low, Medium, High, Critical based on business impact
- **Confidence Scoring**: AI-ready confidence metrics for each discrepancy
- **Auto-Resolution**: Automatic fixing of minor discrepancies (configurable)

### 🧠 **AI-Ready Data Structure**
- **Structured Logging**: Comprehensive sync logs for ML training
- **Historical Tracking**: Complete audit trail of all inventory changes
- **Impact Scoring**: Business impact metrics for each discrepancy
- **Predictive Hooks**: Data structure ready for future AI models

### 🔗 **Claim Detector Integration**
- **Automatic Triggering**: Claims calculated immediately after discrepancy detection
- **Evidence & Value Engine**: Integration with Claim Detector for accurate claim calculations
- **Real-time Processing**: Claims processed in real-time or batch mode
- **Full Audit Trail**: Complete transparency and auditability for every claim

### 🌐 **Upstream Connector Layer (Future-proof)**

Modular connector architecture under `src/connectors/`:

- `types.ts`: standardized discrepancy schema and mapping to Claim Detector payloads
- `amazonConnector.ts`: Amazon SP-API as the first connector
- `connectorManager.ts`: registers connectors, runs collection, triggers Claim Detector automatically

Standardized discrepancy schema:

```
{
  product_id: string,
  sku: string,
  quantity_synced: number,
  quantity_actual: number,
  discrepancy_amount: number,
  marketplace: string,
  timestamp: string,
  currency: string,
  confidence?: number,
  metadata?: {
    proof?: Array<{ type: string; timestamp: string; payload: Record<string, any> }>,
    valueComparison?: any,
    mcdeDocumentUrl?: string,
    [key: string]: any
  }
}
```

Endpoints:

- `POST /api/v1/connectors/run` { userId }: run all enabled connectors; auto-triggers Claim Detector
- `GET /api/v1/connectors/health`: health of all connectors

Configuration toggles (no code changes required):

```
ENABLE_AMAZON=true
ENABLE_SHOPIFY=false
ENABLE_WALMART=false
ENABLE_EBAY=false
ENABLE_MAGENTO=false
```

Amazon credentials:

```
AMAZON_CLIENT_ID=...
AMAZON_CLIENT_SECRET=...
AMAZON_REFRESH_TOKEN=...
AMAZON_MARKETPLACE_ID=...
AMAZON_SELLER_ID=...
AMAZON_REGION=us-east-1
```

Claim Detector and downstreams:

```
CLAIM_DETECTOR_URL=
CLAIM_DETECTOR_API_KEY=
CLAIM_DETECTOR_CONFIDENCE_THRESHOLD=0.7
CLAIM_DETECTOR_AUTO_SUBMISSION=true
REFUND_ENGINE_URL=
REFUND_ENGINE_API_KEY=
MCDE_BASE_URL=
MCDE_API_KEY=
```

Add a new connector:
1) Create `src/connectors/<source>Connector.ts` implementing `UpstreamConnector`
2) Map source records to `StandardizedDiscrepancy[]`
3) Register in `src/index.ts` behind `ENABLE_<SOURCE>` flag
4) `ConnectorManager` auto-triggers Claim Detector with normalized payloads

### Claim Accuracy & Proof Quality

- Amazon connector computes real delta = `quantity_synced - quantity_actual`
- Proof metadata includes:
  - inventory snapshot (amazon vs internal)
  - optional value comparison from Claim Detector EVE
  - optional MCDE cost document link
- Confidence scoring heuristic included; consider replacing with historical model

### MCDE Evidence Persistence

- Configure `MCDE_BASE_URL`, `MCDE_API_KEY`
- Upload invoices; OCR/parse; compute landed cost; store document links
- Outputs available to Claim Detector and Dashboard via URLs and metadata

### 🚀 **Production-Ready Infrastructure**
- **Fault Tolerance**: Graceful shutdown, job recovery, error handling
- **Rate Limiting**: Amazon SP-API rate limit compliance
- **Health Monitoring**: Comprehensive health checks and metrics
- **Container Ready**: Docker support with proper environment configuration

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Layer     │    │  Sync Orchestrator│    │  Amazon SP-API  │
│                 │◄──►│                  │◄──►│                 │
│ • REST Endpoints│    │ • Job Management │    │ • Inventory     │
│ • Health Checks │    │ • Retry Logic    │    │ • Reports       │
│ • Rate Limiting │    │ • Progress Track │    │ • Rate Limiting │
│ • Claim APIs    │    │ • Claim Trigger  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       ▼                       │
         │              ┌──────────────────┐             │
         │              │ Reconciliation   │             │
         │              │ Service          │             │
         │              │                  │             │
         │              │ • Discrepancy    │             │
         │              │   Detection      │             │
         │              │ • Auto-Resolution│             │
         │              │ • Rule Engine    │             │
         │              │ • Claim Trigger  │             │
         └──────────────►└──────────────────┘◄────────────┘
                                  │
                                  ▼
                        ┌──────────────────┐
                        │   Claim Detector │
                        │                  │
                        │ • Evidence Engine│
                        │ • Value Engine   │
                        │ • Claim Calc     │
                        │ • Risk Assessment│
                        └──────────────────┘
                                  │
                                  ▼
                        ┌──────────────────┐
                        │   Database       │
                        │                  │
                        │ • Inventory Items│
                        │ • Sync Logs      │
                        │ • Discrepancies  │
                        │ • Claim Calc     │
                        │ • Reconciliation │
                        │   Rules          │
                        └──────────────────┘
```

## 🚀 Quick Start

### 1. Environment Setup

```bash
# Copy environment template
cp env.example .env

# Configure your environment variables
# See env.example for detailed configuration options
```

### 2. Database Setup

```bash
# Ensure PostgreSQL is running
# Create database
createdb opsided_integrations

# Run migrations (from shared/db/migrations/)
psql -d opsided_integrations -f ../../shared/db/migrations/005_complete_integrations_schema.sql
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Service

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

## 📡 API Endpoints

### Health & Status

#### `GET /health`
Comprehensive health check including database, sync service, and Amazon API status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "services": {
    "database": true,
    "sync_service": true,
    "amazon_api": "healthy"
  },
  "metrics": {
    "activeJobs": 2,
    "totalJobs": 150,
    "lastSync": "2024-01-15T10:00:00.000Z",
    "discrepanciesFound": 5
  },
  "version": "2.0.0"
}
```

### Job Management

#### `POST /api/v1/jobs/sync`
Start a new inventory sync job.

**Request:**
```json
{
  "userId": "user-123",
  "syncType": "full",
  "sourceSystems": ["amazon"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Sync job triggered successfully",
  "data": {
    "success": true,
    "syncedItems": 0,
    "errors": [],
    "message": "Sync job started successfully with ID: sync-1705312200000-abc123",
    "jobId": "sync-1705312200000-abc123"
  }
}
```

#### `GET /api/v1/jobs/status`
Get status of all jobs (optionally filtered by userId).

**Query Parameters:**
- `userId` (optional): Filter jobs by specific user

**Response:**
```json
{
  "success": true,
  "data": {
    "activeJobs": [
      {
        "jobId": "sync-1705312200000-abc123",
        "userId": "user-123",
        "status": "running",
        "progress": 45,
        "startedAt": "2024-01-15T10:30:00.000Z",
        "estimatedCompletion": "2024-01-15T10:35:00.000Z"
      }
    ],
    "completedJobs": [...],
    "failedJobs": [...],
    "totalJobs": 150
  }
}
```

#### `GET /api/v1/jobs/:jobId/status`
Get detailed status of a specific job.

#### `POST /api/v1/jobs/:jobId/cancel`
Cancel a running job.

### Metrics & Monitoring

#### `GET /api/v1/metrics`
Get comprehensive sync metrics and system health.

**Query Parameters:**
- `userId` (optional): Filter metrics by specific user

**Response:**
```json
{
  "success": true,
  "data": {
    "totalJobs": 150,
    "successfulJobs": 145,
    "failedJobs": 5,
    "averageDuration": 120000,
    "lastSyncTimestamp": "2024-01-15T10:00:00.000Z",
    "discrepanciesFound": 25,
    "discrepanciesResolved": 20,
    "itemsSynced": 1500,
    "sourceSystemHealth": {
      "amazon": {
        "status": "healthy",
        "lastSync": "2024-01-15T10:00:00.000Z",
        "errorCount": 0
      }
    }
  }
}
```

### Discrepancy Management

#### `GET /api/v1/discrepancies/summary`
Get summary of all discrepancies for a user.

**Query Parameters:**
- `userId` (required): User ID to get discrepancies for

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 25,
    "bySeverity": {
      "low": 15,
      "medium": 8,
      "high": 2,
      "critical": 0
    },
    "byStatus": {
      "open": 20,
      "investigating": 3,
      "resolved": 2
    },
    "recentDiscrepancies": [...]
  }
}
```

#### `POST /api/v1/jobs/discrepancies`
Trigger discrepancy detection without full sync.

### Reconciliation Rules

#### `GET /api/v1/reconciliation/rules`
Get all reconciliation rules for a user.

#### `POST /api/v1/reconciliation/rules`
Add a new reconciliation rule.

**Request:**
```json
{
  "userId": "user-123",
  "rule": {
    "ruleType": "quantity_threshold",
    "threshold": 5,
    "severity": "medium",
    "autoResolve": false,
    "enabled": true,
    "conditions": [
      {
        "sourceSystem": "amazon",
        "targetSystem": "internal",
        "field": "quantity_available",
        "operator": "greater_than",
        "value": 0
      }
    ]
  }
}
```

### Claim Detection Integration

#### `POST /api/v1/claims/detect`
Manually trigger claim detection for a user.

**Request:**
```json
{
  "userId": "user-123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Claim detection triggered successfully",
  "data": {
    "success": true,
    "triggeredClaims": 5,
    "claimResults": [...],
    "errors": []
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### `GET /api/v1/claims/summary/:userId`
Get claim summary for a specific user.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalClaims": 25,
    "totalPotentialRecovery": 1250.50,
    "claimsByStatus": {
      "pending": 15,
      "approved": 8,
      "rejected": 2
    },
    "claimsByType": {
      "missing_units": 18,
      "overcharge": 5,
      "damage": 2
    },
    "averageConfidence": 0.85,
    "estimatedTotalPayout": 800.25
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### `GET /api/v1/claims/health`
Get claim detection service health status.

**Response:**
```json
{
  "success": true,
  "data": {
    "available": true,
    "status": "healthy",
    "lastProcessed": "2024-01-15T10:00:00.000Z",
    "queueSize": 0,
    "cacheSize": 150
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Service port | 3002 | No |
| `NODE_ENV` | Environment | development | No |
| `DB_HOST` | Database host | localhost | No |
| `DB_PASSWORD` | Database password | - | **Yes** |
| `AMAZON_CLIENT_ID` | Amazon SP-API client ID | - | **Yes** |
| `AMAZON_CLIENT_SECRET` | Amazon SP-API client secret | - | **Yes** |
| `AMAZON_MARKETPLACE_ID` | Amazon marketplace ID | - | **Yes** |
| `CLAIM_DETECTOR_URL` | Claim Detector service URL | http://localhost:8000 | No |
| `CLAIM_DETECTOR_API_KEY` | Claim Detector API key | - | No |
| `CLAIM_DETECTOR_CONFIDENCE_THRESHOLD` | Minimum confidence for claim detection | 0.7 | No |

### Sync Schedules

- **Default Sync**: Every 6 hours (`0 */6 * * *`)
- **Discrepancy Detection**: Every 2 hours (`0 */2 * * *`)
- **Configurable**: All schedules can be customized via environment variables

### Rate Limiting

- **Amazon SP-API**: 1 request per second (configurable)
- **HTTP API**: 100 requests per 15 minutes (configurable)
- **Automatic Retry**: Exponential backoff with configurable attempts

## 🔗 Integration Workflow

### Smart Inventory Sync → Claim Detector Integration

The system automatically creates a seamless workflow from inventory discrepancy detection to claim calculation:

1. **Inventory Reconciliation**: Smart Inventory Sync detects discrepancies during Amazon SP-API sync
2. **Automatic Triggering**: Every validated discrepancy automatically triggers the Claim Detector
3. **Claim Calculation**: Claim Detector processes discrepancies using Evidence & Value Engine
4. **Real-time Results**: Claims are calculated with confidence scores and risk assessments
5. **Downstream Integration**: Results are ready for Proof Generator, Refund Engine, and Billing systems

#### Key Benefits:
- **Zero Manual Intervention**: Fully automated from discrepancy to claim
- **Guaranteed Accuracy**: Every claim amount is exact and auditable
- **Predictable Timing**: Claims calculated within predictable windows
- **Full Transparency**: Complete audit trail for every processed claim
- **AI-Ready Data**: Structured data for future ML model training

#### Integration Points:
- **Proof Generator**: Uses claim evidence and proof data
- **Refund Engine**: Receives validated claims for automated submission
- **Billing Systems**: Gets claim amounts for financial reconciliation
- **Notifications**: Alerts users of potential recoveries
- **Analytics**: Provides data for business intelligence and reporting

## 🔧 Development

### Project Structure

```
src/
├── config/           # Configuration management
├── controllers/      # API controllers
├── jobs/            # Background job management
├── models/          # Data models and database operations
├── routes/          # API route definitions
├── services/        # Business logic services
│   ├── amazonSPAPIService.ts      # Amazon SP-API integration
│   ├── inventoryReconciliationService.ts  # Discrepancy detection
│   ├── syncOrchestratorService.ts # Sync job orchestration
│   └── syncService.ts             # Main sync service
└── index.ts         # Application entry point
```

### Key Services

#### AmazonSPAPIService
- Handles all Amazon SP-API communication
- Automatic token refresh and rate limiting
- Comprehensive error handling and retry logic

#### InventoryReconciliationService
- Detects and classifies inventory discrepancies
- Applies reconciliation rules
- Auto-resolves minor discrepancies
- Generates AI-ready structured data

#### SyncOrchestratorService
- Manages sync job lifecycle
- Handles job queuing and execution
- Provides real-time progress tracking
- Implements retry and recovery logic

### Adding New Integrations

To add a new inventory source (e.g., Shopify):

1. Create a new service class (e.g., `ShopifyService`)
2. Implement the required interface methods
3. Add the service to `SyncOrchestratorService`
4. Update configuration and environment variables
5. Add new reconciliation rules if needed

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- --testPathPattern=amazonSPAPIService
```

### Test Structure

- **Unit Tests**: Individual service and model tests
- **Integration Tests**: API endpoint and database integration tests
- **Mock Data**: Comprehensive test fixtures for Amazon SP-API responses

## 📊 Monitoring & Observability

### Health Checks

- **Database Connectivity**: Connection pool status
- **Amazon API Health**: SP-API endpoint availability
- **Service Status**: Internal service health
- **Job Queue Status**: Active and queued jobs

### Metrics

- **Job Performance**: Success/failure rates, duration
- **Discrepancy Trends**: Counts by severity and status
- **API Performance**: Response times, error rates
- **System Resources**: Memory, CPU, database connections

### Logging

- **Structured Logs**: JSON format for easy parsing
- **Log Levels**: Debug, Info, Warn, Error
- **Context Tracking**: User ID, job ID, correlation IDs
- **Performance Logging**: Sync duration, item counts

## 🚀 Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3002
CMD ["node", "dist/index.js"]
```

### Environment-Specific Configs

- **Development**: Debug logging, relaxed security
- **Staging**: Info logging, production-like security
- **Production**: Warn logging, strict security, metrics enabled

### Health Check Endpoint

```bash
# Kubernetes health check
curl http://localhost:3002/health

# Load balancer health check
curl http://localhost:3002/health
```

## 🔒 Security

### Authentication & Authorization

- JWT-based authentication (configurable)
- Role-based access control
- API key management for external integrations

### Rate Limiting

- Per-IP rate limiting
- Per-user rate limiting
- Configurable windows and limits

### Data Protection

- Input validation and sanitization
- SQL injection prevention
- XSS protection via Helmet
- CORS configuration

## 📈 Performance

### Optimization Features

- **Connection Pooling**: Database connection reuse
- **Batch Processing**: Efficient bulk inventory updates
- **Caching**: Redis integration for frequently accessed data
- **Async Processing**: Non-blocking job execution

### Scalability

- **Horizontal Scaling**: Stateless service design
- **Job Queuing**: BullMQ integration for distributed processing
- **Database Sharding**: User-based data partitioning
- **Load Balancing**: Multiple service instances

## 🚨 Troubleshooting

### Common Issues

#### Amazon SP-API Authentication
```bash
# Check token validity
curl -H "Authorization: Bearer $TOKEN" \
  "https://sellingpartnerapi-na.amazon.com/fba/inventory/v1/summaries"
```

#### Database Connection
```bash
# Test database connectivity
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1"
```

#### Job Failures
```bash
# Check job logs
curl "http://localhost:3002/api/v1/jobs/$JOB_ID/status"

# Check system metrics
curl "http://localhost:3002/api/v1/metrics"
```

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev

# Check detailed health status
curl "http://localhost:3002/health"
```

## 🔮 Future Enhancements

### Planned Features

- **Shopify Integration**: Multi-channel inventory sync
- **eBay Integration**: Additional marketplace support
- **AI-Powered Reconciliation**: Machine learning discrepancy prediction
- **Real-time Notifications**: WebSocket-based status updates
- **Advanced Analytics**: Inventory trend analysis and forecasting

### AI Integration Points

- **Discrepancy Prediction**: ML models to predict inventory drift
- **Auto-Resolution**: Intelligent decision making for discrepancy resolution
- **Demand Forecasting**: Inventory optimization recommendations
- **Anomaly Detection**: Unusual inventory pattern identification

## 📚 Additional Resources

- [Amazon SP-API Documentation](https://developer-docs.amazon.com/sp-api/)
- [Database Schema Documentation](../../shared/db/migrations/)
- [API Testing Guide](./docs/api-testing.md)
- [Performance Tuning Guide](./docs/performance.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Smart Inventory Sync Service v2.0** - Ensuring your inventory is always accurate, reconciled, and ready for AI-powered insights.
