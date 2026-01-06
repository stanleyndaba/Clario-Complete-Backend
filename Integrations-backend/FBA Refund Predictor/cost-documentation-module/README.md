# Opside Cost Documentation Module

A Node.js microservice for metadata storage, S3 file management, search, and versioning with integrated anomaly detection capabilities.

## Features

- **Document Management**: Upload, store, and version cost documents with metadata
- **S3 Integration**: Secure file storage and retrieval
- **Search & Indexing**: Fast document search and retrieval
- **Anomaly Detection**: Automated detection of FBA cost anomalies
- **Evidence Management**: Deterministic evidence generation and S3 artifact storage
- **Queue Management**: Priority-based job processing with backpressure controls

## Architecture

### Detection System

The detection system consists of several components working together:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Sync System   │───▶│  Detection Queue │───▶│ Detection Rules │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ Detection Worker │    │ Evidence Builder│
                       └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   Database      │    │      S3        │
                       │  (Results)      │    │   (Artifacts)   │
                       └──────────────────┘    └─────────────────┘
```

### Components

- **Detection Rules**: Business logic for identifying anomalies
  - `LostUnitsRule`: Detects lost inventory units
  - `OverchargedFeesRule`: Identifies excessive fees
  - `DamagedStockRule`: Finds damaged inventory items

- **Evidence Builder**: Creates deterministic evidence JSON and uploads to S3
- **Detection Queue**: Manages job prioritization and backpressure
- **Detection Worker**: Processes jobs and applies rules
- **Detection Service**: Public API for job management

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 12+
- AWS S3 bucket
- Redis (optional, for advanced queue features)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd cost-documentation-module
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env
# Edit .env with your configuration
```

4. Set up the database:
```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

5. Build the project:
```bash
npm run build
```

### Running the Service

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm run build
npm start
```

#### Detection Worker
```bash
npm run worker:detection
```

## Configuration

### Environment Variables

```bash
# Server Configuration
PORT=3001
NODE_ENV=development

# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/cost_documentation_db"

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=opside-cost-documents

# Detection System Configuration
DETECTION_WORKER_CONCURRENCY=5
DETECTION_WORKER_POLL_INTERVAL_MS=5000
DETECTION_WORKER_MAX_RETRIES=3
DETECTION_ENABLE_PY_WORKER=false
DETECTION_QUEUE_BACKPRESSURE_THRESHOLD=20
```

### Database Schema

The detection system adds several new tables:

- `DetectionJob`: Tracks detection job status and metadata
- `DetectionResult`: Stores anomaly detection results
- `DetectionThreshold`: Configurable thresholds for each rule type
- `DetectionWhitelist`: Whitelist rules for specific SKUs, ASINs, vendors, or shipments

## API Endpoints

### Detection Jobs

- `POST /api/detection/jobs` - Enqueue a detection job
- `GET /api/detection/jobs/:id/status` - Get job status
- `POST /api/detection/jobs/:id/retry` - Retry a failed job
- `DELETE /api/detection/jobs/:id` - Delete a job

### Detection Results

- `GET /api/detection/results` - Get results with filters
- `GET /api/detection/results/:syncId` - Get results by sync ID
- `GET /api/detection/stats` - Get detection statistics
- `GET /api/detection/queue/stats` - Get queue statistics

### Example Usage

#### Enqueue a Detection Job

```bash
curl -X POST http://localhost:3001/api/detection/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "sellerId": "seller123",
    "syncId": "sync456",
    "priority": "HIGH"
  }'
```

#### Get Detection Results

```bash
curl "http://localhost:3001/api/detection/results?sellerId=seller123&limit=10"
```

## Detection Rules

### Lost Units Rule

Detects when inventory units are lost or missing. Triggers when:
- Lost units exceed 1% of total inventory, OR
- Lost value exceeds $5

### Overcharged Fees Rule

Identifies when fees exceed expected amounts. Triggers when:
- Fee delta exceeds $2

### Damaged Stock Rule

Finds damaged inventory items. Triggers when:
- Damaged units exceed 1, OR
- Damaged value exceeds $5

### Thresholds and Whitelists

- **Global Thresholds**: Apply to all sellers
- **Seller-Specific Thresholds**: Override global thresholds
- **Whitelists**: Skip detection for specific SKUs, ASINs, vendors, or shipments

## Testing

### Run All Tests
```bash
npm test
```

### Run Detection Tests Only
```bash
npm run test:detection
```

### Run with Coverage
```bash
npm run test:coverage
```

## Development

### Project Structure

```
src/
├── detection/           # Detection system
│   ├── rules/          # Detection rule implementations
│   ├── evidence/       # Evidence building and S3 upload
│   ├── queue/          # Job queue management
│   ├── worker/         # Job processing worker
│   ├── services/       # Public API services
│   └── types.ts        # Type definitions
├── routes/              # API route handlers
├── controllers/         # Business logic controllers
├── services/            # Core business services
├── middleware/          # Express middleware
└── utils/               # Utility functions
```

### Adding New Detection Rules

1. Create a new rule class extending `BaseRule`:
```typescript
export class NewAnomalyRule extends BaseRule {
  readonly ruleType = RuleType.NEW_ANOMALY;
  readonly priority = 'MEDIUM';

  apply(input: RuleInput, context: RuleContext): Anomaly[] {
    // Implementation
  }
}
```

2. Add the rule to `src/detection/rules/index.ts`:
```typescript
export { NewAnomalyRule } from './newAnomalyRule';

export const ALL_RULES = [
  // ... existing rules
  new NewAnomalyRule()
];
```

3. Add tests in `tests/detection/`

### Database Migrations

To add new fields or tables:

1. Create a new migration:
```bash
npm run db:migrate
```

2. Update the Prisma schema in `prisma/schema.prisma`

3. Generate the client:
```bash
npm run db:generate
```

## Monitoring and Observability

### Queue Metrics

- Queue length and processing rate
- Priority breakdown
- Backpressure indicators

### Detection Metrics

- Anomalies detected by rule type
- Severity distribution
- Processing performance

### Health Checks

- Database connectivity
- S3 access
- Worker status

## Deployment

### Docker

```bash
docker build -t cost-documentation-module .
docker run -p 3001:3001 cost-documentation-module
```

### Environment Setup

1. Set production environment variables
2. Configure database connection pooling
3. Set up monitoring and alerting
4. Configure S3 bucket policies

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Check `DATABASE_URL` format
   - Verify database is running
   - Check network connectivity

2. **S3 Upload Failures**
   - Verify AWS credentials
   - Check S3 bucket permissions
   - Ensure bucket exists

3. **Worker Not Processing Jobs**
   - Check worker logs
   - Verify database connectivity
   - Check job status in database

### Logs

- Application logs: Check console output
- Database logs: Check PostgreSQL logs
- S3 logs: Check CloudWatch logs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 