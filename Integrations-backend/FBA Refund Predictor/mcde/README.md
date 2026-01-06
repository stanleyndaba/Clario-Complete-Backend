# MCDE - Manufacturing Cost Document Engine

A Python-based detection engine that processes Amazon FBA data to identify anomalies and generate evidence artifacts. This module provides parity with the TypeScript detection system.

## Features

- **Anomaly Detection**: Automated detection of FBA cost anomalies
- **Deterministic Evidence**: Consistent evidence generation with reproducible results
- **S3 Artifact Storage**: Evidence artifacts stored with consistent pathing
- **Rule-Based System**: Configurable detection rules with thresholds and whitelists
- **Async Processing**: High-performance async job processing
- **Database Integration**: Direct database access for job management

## Architecture

### Detection Engine Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Database      │───▶│  Detection Rules │───▶│ Evidence Builder│
│  (DetectionJob) │    └──────────────────┘    └─────────────────┘
└─────────────────┘              │                        │
        ▲                        ▼                        ▼
        │              ┌──────────────────┐    ┌─────────────────┐
        │              │   Worker Process │    │      S3        │
        └──────────────│                 │    │   (Artifacts)   │
                       └──────────────────┘    └─────────────────┘
```

### Components

- **Detection Rules**: Business logic for identifying anomalies
  - `LostUnitsRule`: Detects lost inventory units
  - `OverchargedFeesRule`: Identifies excessive fees
  - `DamagedStockRule`: Finds damaged inventory items

- **Evidence Builder**: Creates deterministic evidence JSON and uploads to S3
- **Worker Process**: Main job processing loop with concurrency controls
- **Database Integration**: Direct PostgreSQL access for job management

## Quick Start

### Prerequisites

- Python 3.8+
- PostgreSQL 12+
- AWS S3 bucket
- AWS credentials configured

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd mcde
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set up environment variables:
```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=cost_documentation_db
export DB_USER=postgres
export DB_PASSWORD=your_password

export AWS_ACCESS_KEY_ID=your_aws_access_key
export AWS_SECRET_ACCESS_KEY=your_aws_secret_key
export AWS_REGION=us-east-1
export S3_BUCKET_NAME=opside-cost-documents

export DETECTION_WORKER_CONCURRENCY=5
export DETECTION_WORKER_POLL_INTERVAL_MS=5000
export DETECTION_WORKER_MAX_RETRIES=3
```

4. Install in development mode:
```bash
pip install -e .
```

### Running the Detection Engine

#### CLI Worker

```bash
# Run with default configuration
python -m src.detection_engine.worker

# Run with custom config file
python -m src.detection_engine.worker --config config.yaml

# Validate configuration without starting
python -m src.detection_engine.worker --dry-run

# Set log level
python -m src.detection_engine.worker --log-level DEBUG
```

#### Using Make Commands

```bash
# Run detection worker
make worker

# Validate configuration
make worker-config

# Run tests
make test-detection
```

## Configuration

### Environment Variables

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

### Configuration File (YAML)

```yaml
database:
  host: localhost
  port: 5432
  database: cost_documentation_db
  user: postgres
  password: your_password

s3:
  access_key_id: your_aws_access_key
  secret_access_key: your_aws_secret_key
  region: us-east-1
  bucket_name: opside-cost-documents

worker:
  max_concurrency: 5
  poll_interval_ms: 5000
  max_retries: 3
```

## Detection Rules

### Lost Units Rule

Detects when inventory units are lost or missing. Triggers when:
- Lost units exceed 1% of total inventory, OR
- Lost value exceeds $5

**Input Data Structure:**
```python
{
    "inventory": [
        {
            "sku": "SKU001",
            "asin": "B001234567",
            "units": 10,
            "value": 50.0,
            "vendor": "Vendor A"
        }
    ],
    "totalUnits": 100,
    "totalValue": 1000.0
}
```

### Overcharged Fees Rule

Identifies when fees exceed expected amounts. Triggers when:
- Fee delta exceeds $2

**Input Data Structure:**
```python
{
    "fees": [
        {
            "feeType": "FBA_FEE",
            "amount": 15.0,
            "sku": "SKU001",
            "asin": "B001234567",
            "vendor": "Vendor A",
            "shipmentId": "SHIP001"
        }
    ],
    "expectedFees": {
        "FBA_FEE": 12.0
    },
    "totalRevenue": 2000.0
}
```

### Damaged Stock Rule

Finds damaged inventory items. Triggers when:
- Damaged units exceed 1, OR
- Damaged value exceeds $5

**Input Data Structure:**
```python
{
    "damagedStock": [
        {
            "sku": "SKU002",
            "asin": "B001234568",
            "units": 2,
            "value": 10.0,
            "vendor": "Vendor B",
            "damageType": "DAMAGED",
            "damageReason": "Shipping damage"
        }
    ],
    "totalInventory": 100,
    "totalInventoryValue": 1000.0
}
```

## Evidence Generation

### Deterministic Evidence

The evidence builder creates consistent, reproducible evidence JSON:

```python
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

### S3 Artifact Storage

Evidence artifacts are stored with consistent pathing:
```
s3://bucket/evidence/{sellerId}/{syncId}/{ruleType}/{dedupeHash}.json
```

## Database Schema

The detection engine works with these database tables:

- `DetectionJob`: Tracks detection job status and metadata
- `DetectionResult`: Stores anomaly detection results
- `DetectionThreshold`: Configurable thresholds for each rule type
- `DetectionWhitelist`: Whitelist rules for specific SKUs, ASINs, vendors, or shipments

## Development

### Project Structure

```
src/
├── detection_engine/     # Detection engine module
│   ├── __init__.py      # Package initialization
│   ├── types.py         # Data types and interfaces
│   ├── rules.py         # Detection rule implementations
│   ├── evidence.py      # Evidence building and S3 upload
│   ├── worker.py        # Main worker process
│   └── __main__.py      # CLI entrypoint
├── models/               # ML models
├── data/                 # Data processing
├── api/                  # FastAPI endpoints
└── utils/                # Utility functions
```

### Adding New Detection Rules

1. Create a new rule class extending `BaseRule`:
```python
class NewAnomalyRule(BaseRule):
    @property
    def rule_type(self) -> RuleType:
        return RuleType.NEW_ANOMALY

    @property
    def priority(self) -> str:
        return "MEDIUM"

    def apply(self, input_data: RuleInput, context: RuleContext) -> List[Anomaly]:
        # Implementation
        pass
```

2. Add the rule to `src/detection_engine/rules.py`:
```python
ALL_RULES = [
    LostUnitsRule(),
    OverchargedFeesRule(),
    DamagedStockRule(),
    NewAnomalyRule()  # Add new rule
]
```

3. Add tests in `tests/test_rules.py`

### Testing

#### Run All Tests
```bash
make test
```

#### Run Detection Tests Only
```bash
make test-detection
```

#### Run with Coverage
```bash
pytest tests/ -v --cov=src --cov-report=html --cov-report=term-missing
```

## Monitoring and Observability

### Worker Metrics

- Active worker count
- Job processing rate
- Error rates and retry counts

### Evidence Metrics

- Evidence generation rate
- S3 upload success rate
- Artifact storage usage

### Health Checks

- Database connectivity
- S3 access
- Worker process status

## Deployment

### Docker

```bash
# Build image
make docker-build

# Run container
make docker-run

# Run tests in Docker
make docker-test
```

### Production Setup

1. Set production environment variables
2. Configure database connection pooling
3. Set up monitoring and alerting
4. Configure S3 bucket policies
5. Set up log aggregation

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Check database credentials
   - Verify network connectivity
   - Check database server status

2. **S3 Upload Failures**
   - Verify AWS credentials
   - Check S3 bucket permissions
   - Ensure bucket exists

3. **Worker Not Processing Jobs**
   - Check worker logs
   - Verify database connectivity
   - Check job status in database

### Logs

- Worker logs: Check console output and log files
- Database logs: Check PostgreSQL logs
- S3 logs: Check CloudWatch logs

### Debug Mode

Run with debug logging for detailed information:
```bash
python -m src.detection_engine.worker --log-level DEBUG
```

## Performance Tuning

### Concurrency Settings

- `DETECTION_WORKER_CONCURRENCY`: Number of concurrent job processors
- `DETECTION_WORKER_POLL_INTERVAL_MS`: Polling interval for new jobs

### Database Optimization

- Use connection pooling
- Optimize database indexes
- Monitor query performance

### S3 Optimization

- Use appropriate S3 storage class
- Implement retry logic
- Monitor upload performance

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 