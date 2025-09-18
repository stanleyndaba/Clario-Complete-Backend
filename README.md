# FBA Claims Pipeline

An integrated pipeline for **Claim Detection**, **Evidence Validation**, and **Auto-Claims Generation** that enables automated Amazon FBA reimbursement processing.

## 🏗️ Architecture

The pipeline consists of three main components:

1. **Claim Detector Delivery (CDD)** - Ingests claims from the ML-based Claim Detector
2. **Evidence Validator (EV)** - Validates claims using rules + ML (from MCDE)
3. **Auto-Claims Generator (ACG)** - Builds and submits claim packets to Amazon

```
Claim Detector → CDD → EV → ACG → Amazon SP-API
     ↓           ↓     ↓     ↓        ↓
  ML Model   Database  Rules  Packet  Filing
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the Application

```bash
uvicorn src.app:app --reload --host 0.0.0.0 --port 8000
```

### 3. Test the Pipeline

```bash
# Test health endpoint
curl http://localhost:8000/health

# Submit a claim detection
curl -X POST http://localhost:8000/claims/detect \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-123" \
  -d @sample_claim.json

# Check claim status
curl http://localhost:8000/claims/CLM-000123
```

## 📁 Project Structure

```
src/
├── common/           # Shared utilities
│   ├── schemas.py   # Pydantic models
│   ├── config.py    # Configuration
│   ├── db.py        # Database operations
│   └── logging.py   # Structured logging
├── cdd/             # Claim Detector Delivery
│   ├── router.py    # FastAPI endpoints
│   ├── service.py   # Business logic
│   └── worker.py    # Background processing
├── acg/             # Auto-Claims Generator
│   ├── router.py    # Filing endpoints
│   ├── builder.py   # Packet construction
│   ├── filer.py     # Filing logic
│   └── sp_api_adapter.py  # Amazon integration
├── migrations/      # Database schema
│   └── 001_init.sql
└── app.py          # Main FastAPI app
```

## 🔌 API Endpoints

### Claim Detection
- `POST /claims/detect` - Submit a new claim detection
- `GET /claims/{id}` - Get claim status and history
- `POST /claims/{id}/file` - Force file a claim
- `POST /claims/{id}/cancel` - Cancel a claim

### Health & Info
- `GET /health` - Service health check
- `GET /` - Service information and endpoints

## 📊 Data Flow

### 1. Claim Detection
```json
POST /claims/detect
{
  "claim_id": "CLM-000123",
  "claim_type": "lost_inventory",
  "confidence": 0.88,
  "amount_estimate": 142.50,
  "quantity_affected": 5,
  "metadata": {...}
}
```

### 2. Automatic Validation
- CDD receives claim → stores in database
- Worker processes validation → calls Evidence Validator
- EV applies rules + ML → determines if auto-file ready
- If ready → enqueues for filing

### 3. Auto-Filing
- ACG builds claim packet from validated data
- Submits via SP-API adapter (mock in dev)
- Updates claim status based on Amazon response
- Logs full audit trail

## 🗄️ Database Schema

- **claims** - Claim metadata and status
- **validations** - Evidence validation results
- **filings** - Amazon submission history
- **idempotency_keys** - Duplicate request prevention

## 🧪 Testing

Run the comprehensive test suite:

```bash
pytest tests/test_integration_acg.py -v
```

Tests cover:
- ✅ End-to-end claim flow
- ✅ Idempotency protection
- ✅ Error handling
- ✅ Database persistence
- ✅ API validation

## ⚙️ Configuration

Environment variables (`.env`):

```bash
DB_URL=sqlite:///./claims.db          # Database connection
AUTO_FILE_THRESHOLD=0.75             # Confidence threshold for auto-filing
ENV=dev                              # Environment (dev/prod)
```

## 🔒 Production Features

- **Idempotency** - Prevents duplicate processing
- **Structured Logging** - JSON logs with correlation IDs
- **Error Handling** - Graceful failure with status updates
- **Audit Trail** - Complete history of all operations
- **Background Processing** - Async validation and filing

## 🔄 Background Workers

Currently using pseudo-enqueueing for development. Production should use:

- **RQ + Redis** - Python job queue
- **Arq** - Async job queue
- **APScheduler** - Scheduled tasks

## 🚧 Development Notes

### Mock Components
- **SP-API Adapter** - Simulates 90% success, 10% failure
- **Evidence Validator** - Uses mock validation (integrate with MCDE EV)
- **Background Jobs** - Run synchronously (replace with proper queues)

### Integration Points
- **MCDE Evidence Validator** - Replace mock validation
- **Real SP-API** - Replace mock adapter with Amazon credentials
- **Background Queues** - Implement proper job processing

## 📈 Monitoring

- **Health Endpoints** - Service status
- **Structured Logs** - JSON format with correlation
- **Database Metrics** - Claim processing statistics
- **API Metrics** - Request/response monitoring

## 🔮 Next Steps

1. **Integrate MCDE EV** - Replace mock validation
2. **Real SP-API** - Amazon production credentials
3. **Background Queues** - RQ/Arq implementation
4. **Metrics Dashboard** - Processing statistics
5. **Retry Policies** - Exponential backoff for failures
6. **Rate Limiting** - Amazon API compliance

## 🤝 Contributing

1. Follow the existing code structure
2. Add tests for new functionality
3. Update documentation
4. Use structured logging
5. Maintain idempotency

## 📄 License

Internal use for OpSide FBA operations.








