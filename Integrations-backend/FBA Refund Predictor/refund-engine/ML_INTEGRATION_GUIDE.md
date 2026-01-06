# ML Integration Guide: FBA Refund Predictor + Refund Engine

## 🎯 Overview

The **Refund Engine API** is **fully integrated** with the **FBA Refund Predictor ML service**. This guide explains how the integration works and how to get both systems running together.

## 🔗 Integration Architecture

```
┌─────────────────┐    HTTP/REST    ┌──────────────────┐
│  Refund Engine  │ ──────────────► │ FBA Refund       │
│  API (Node.js)  │                 │ Predictor        │
│  Port: 3000     │                 │ (FastAPI)        │
│                 │                 │ Port: 8000       │
└─────────────────┘                 └──────────────────┘
         │                                   │
         │                                   │
         ▼                                   ▼
┌─────────────────┐                 ┌──────────────────┐
│ PostgreSQL DB   │                 │ ML Model         │
│ (RLS Enabled)   │                 │ (Trained Model)  │
└─────────────────┘                 └──────────────────┘
```

## 🚀 Quick Start Integration

### 1. Start the ML Service (FBA Refund Predictor)

```bash
# Navigate to FBA Refund Predictor directory
cd "FBA Refund Predictor"

# Install dependencies (if not already done)
pip install -r requirements.txt

# Start the ML API service
uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
```

**Verify ML Service:**
```bash
curl http://localhost:8000/health
# Expected: {"status": "healthy", "model_loaded": true, "version": "1.0.0"}
```

### 2. Start the Refund Engine API

```bash
# Navigate to refund-engine directory
cd refund-engine

# Install dependencies
npm install

# Copy environment variables
cp env.example .env

# Start the API service
npm run dev
```

**Verify Refund Engine:**
```bash
curl http://localhost:3000/health
# Expected: {"status": "healthy", "database": "connected", "ml_service": "connected"}
```

## 🤖 ML Integration Details

### Automatic ML Prediction Flow

1. **When a claim is created** in the Refund Engine:
   - System automatically calls ML API for prediction
   - Stores prediction results in database
   - Updates claim with `ml_prediction` and `ml_confidence`

2. **When checking discrepancies**:
   - System fetches claims with missing/outdated predictions
   - Calls ML API for fresh predictions
   - Returns claims where `success_probability > 0.7` (configurable)

### ML API Endpoints Used

| Endpoint | Method | Purpose | Request Format |
|----------|--------|---------|----------------|
| `/predict-success` | POST | Single claim prediction | `ClaimFeatures` |
| `/health` | GET | Service health check | - |

### Request/Response Format

**Request to ML API:**
```json
{
  "claim_amount": 150.0,
  "customer_history_score": 0.85,
  "product_category": "electronics",
  "days_since_purchase": 30,
  "claim_description": "Product arrived damaged"
}
```

**Response from ML API:**
```json
{
  "success_probability": 0.75,
  "confidence": 0.85,
  "prediction_class": "likely_success",
  "uncertainty_score": 0.15
}
```

## 📊 Discrepancy Detection

### How It Works

1. **Threshold-based filtering**:
   - Default threshold: `0.7` (70% success probability)
   - Default confidence: `0.6` (60% confidence)
   - Configurable via query parameters

2. **Automatic prediction updates**:
   - Claims without ML predictions get predictions automatically
   - Outdated predictions (>24 hours) get refreshed
   - Batch prediction support for multiple cases

### Example Usage

```bash
# Get discrepancies (claims with high success probability)
curl -H "Authorization: Bearer <jwt-token>" \
  "http://localhost:3000/api/v1/discrepancies?threshold=0.7&min_confidence=0.6"

# Get discrepancy statistics
curl -H "Authorization: Bearer <jwt-token>" \
  "http://localhost:3000/api/v1/discrepancies/stats"

# Batch predict multiple cases
curl -X POST -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"case_ids": ["case1", "case2", "case3"]}' \
  "http://localhost:3000/api/v1/discrepancies/batch-predict"
```

## 🔧 Configuration

### Environment Variables

**Refund Engine** (`.env`):
```bash
# ML API Configuration
ML_API_BASE_URL=http://localhost:8000

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=refund_engine
DB_USER=postgres
DB_PASSWORD=your_password

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here
```

### ML Service Configuration

**FBA Refund Predictor** (`src/api/main.py`):
- Port: `8000` (default)
- Host: `0.0.0.0` (accessible from external services)
- Model loading: Automatic on startup

## 🧪 Testing the Integration

### 1. Test ML Connection

```bash
# Test if ML service is reachable
curl http://localhost:3000/api/v1/discrepancies/test-ml-connection
```

### 2. Test End-to-End Flow

```bash
# 1. Create a test claim
curl -X POST -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "case_number": "TEST-001",
    "claim_amount": 150.0,
    "customer_history_score": 0.85,
    "product_category": "electronics",
    "days_since_purchase": 30,
    "claim_description": "Test claim for ML integration"
  }' \
  "http://localhost:3000/api/v1/claims"

# 2. Check if ML prediction was added
curl -H "Authorization: Bearer <jwt-token>" \
  "http://localhost:3000/api/v1/claims/TEST-001"

# 3. Check discrepancies
curl -H "Authorization: Bearer <jwt-token>" \
  "http://localhost:3000/api/v1/discrepancies"
```

## 🚨 Troubleshooting

### Common Issues

1. **ML Service Not Reachable**:
   ```bash
   # Check if ML service is running
   curl http://localhost:8000/health
   
   # Check network connectivity
   telnet localhost 8000
   ```

2. **Database Connection Issues**:
   ```bash
   # Check database connection
   curl http://localhost:3000/health
   
   # Verify database is running
   psql -h localhost -U postgres -d refund_engine
   ```

3. **JWT Token Issues**:
   ```bash
   # Generate test token
   curl -X POST -H "Content-Type: application/json" \
     -d '{"email": "test@example.com", "password": "password"}' \
     "http://localhost:3000/api/v1/auth/login"
   ```

### Logs and Debugging

**Refund Engine Logs:**
```bash
# Check application logs
npm run dev  # Shows detailed logs

# Check for ML API errors in logs
grep "ML API" logs/app.log
```

**ML Service Logs:**
```bash
# Check FastAPI logs
uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload --log-level debug
```

## 🎯 Next Steps

1. **Deploy ML Service**: Deploy the FBA Refund Predictor to production
2. **Update ML_API_BASE_URL**: Point to production ML service URL
3. **Monitor Integration**: Set up monitoring for ML API calls and response times
4. **Performance Tuning**: Optimize batch prediction for large datasets
5. **Model Updates**: Implement model versioning and A/B testing

## 📞 Support

For issues with:
- **Refund Engine API**: Check logs and configuration
- **ML Service**: Check FBA Refund Predictor documentation
- **Integration**: Verify network connectivity and API formats 