# Phase 3 Production Completion Guide

## ✅ Checklist Status

### 1. Production Environment Setup

#### ✅ DATABASE_URL
- **Status**: Should already be set in production (Supabase)
- **Action**: Verify in Render/Vercel environment variables

#### ❌ PYTHON_API_URL
- **Current**: `https://python-api-3-vb5h.onrender.com`
- **Action Required**: 
  ```bash
  # In Render/Vercel production environment:
  PYTHON_API_URL=https://python-api-3-vb5h.onrender.com
  ```
- **Verification**: Check `Integrations-backend/src/services/detectionService.ts` line 50

#### ❌ ENABLE_BACKGROUND_SYNC
- **Action Required**:
  ```bash
  ENABLE_BACKGROUND_SYNC=true
  ```
- **Location**: Used in `Integrations-backend/src/jobs/backgroundSyncWorker.ts`

#### ❌ AMAZON_SPAPI_BASE_URL
- **Production URL**: `https://sellingpartnerapi-na.amazon.com` (or region-specific)
- **Sandbox URL**: `https://sandbox.sellingpartnerapi-na.amazon.com`
- **Action Required**:
  ```bash
  # For production:
  AMAZON_SPAPI_BASE_URL=https://sellingpartnerapi-na.amazon.com
  
  # For sandbox (testing):
  AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
  ```
- **Location**: Used in `Integrations-backend/src/services/amazonService.ts` line 49

### 2. Production Database Migration

#### Migration File
- **Location**: `Integrations-backend/migrations/004_add_financial_events_and_detection.sql`
- **Status**: ✅ File exists and is complete

#### ❌ Run Migration
```bash
# Using Supabase CLI or psql:
psql "$DATABASE_URL" -f Integrations-backend/migrations/004_add_financial_events_and_detection.sql

# Or via Supabase Dashboard:
# 1. Go to SQL Editor
# 2. Copy contents of 004_add_financial_events_and_detection.sql
# 3. Execute
```

**Tables Created**:
- `financial_events` - Amazon financial event archival
- `detection_results` - Anomaly detection results
- `detection_queue` - Detection job queue

**Verification Query**:
```sql
-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('financial_events', 'detection_results', 'detection_queue');
```

### 3. Python Claim Detector API Verification

#### ⚠️ Health Check Endpoint
**Action**: Verify health endpoint exists and is accessible

**Test Command**:
```bash
curl https://python-api-3-vb5h.onrender.com/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "service": "claim-detector-api",
  "version": "1.0.0"
}
```

#### ⚠️ Batch Prediction Endpoint
**Endpoint**: `POST /api/v1/claim-detector/predict/batch`

**Test Command**:
```bash
curl -X POST https://python-api-3-vb5h.onrender.com/api/v1/claim-detector/predict/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "seller_id": "test-seller",
    "financial_events": [
      {
        "event_type": "fee",
        "amount": 10.50,
        "currency": "USD"
      }
    ]
  }'
```

**Expected Response Format**:
```json
{
  "predictions": [
    {
      "anomaly_type": "overcharge",
      "confidence_score": 0.85,
      "severity": "high",
      "estimated_value": 10.50,
      "evidence": {...}
    }
  ]
}
```

### 4. Production End-to-End Testing

#### Test Script
See `test-phase3-production-e2e.ps1` for automated testing

#### Manual Testing Steps

1. **Start Sync**:
   ```bash
   POST /api/sync/start
   ```

2. **Monitor Sync Status**:
   ```bash
   GET /api/sync/status
   ```

3. **Check Detection Queue**:
   ```sql
   SELECT * FROM detection_queue 
   WHERE seller_id = 'YOUR_USER_ID' 
   ORDER BY created_at DESC LIMIT 1;
   ```

4. **Verify Detection Results**:
   ```sql
   SELECT * FROM detection_results 
   WHERE seller_id = 'YOUR_USER_ID' 
   ORDER BY created_at DESC;
   ```

5. **Check All 5 Anomaly Types**:
   - `missing_unit`
   - `overcharge`
   - `damaged_stock`
   - `incorrect_fee`
   - `duplicate_charge`

#### Validation Checklist
- [ ] Anomaly detection runs after sync
- [ ] All 5 anomaly types are detected
- [ ] Confidence scores are between 0-1
- [ ] Database writes succeed
- [ ] Notifications are sent to users
- [ ] API response times < 5 seconds
- [ ] Error rates < 1%

### 5. Confidence Score Calibration & Monitoring

#### Monitoring Endpoint
**Location**: `Integrations-backend/src/routes/detectionRoutes.ts`

**Endpoint**: `GET /api/detections/statistics`

**Response**:
```json
{
  "total_detections": 150,
  "by_confidence": {
    "high": 45,
    "medium": 60,
    "low": 45
  },
  "by_anomaly_type": {
    "missing_unit": 30,
    "overcharge": 40,
    "damaged_stock": 25,
    "incorrect_fee": 35,
    "duplicate_charge": 20
  },
  "recovery_rates": {
    "high": 0.85,
    "medium": 0.60,
    "low": 0.30
  }
}
```

#### Confidence Thresholds
**Current** (in `detectionService.ts`):
- **High**: confidence_score >= 0.75
- **Medium**: 0.50 <= confidence_score < 0.75
- **Low**: confidence_score < 0.50

#### Calibration Process
1. Track actual recovery rates for each confidence level
2. Adjust thresholds based on data:
   - If High recovery rate < 80%, increase threshold
   - If Medium recovery rate < 50%, adjust threshold
3. Monitor trends over time

## 🚀 Quick Start Commands

### 1. Set Environment Variables (Render)
```bash
# In Render Dashboard → Environment Variables:
PYTHON_API_URL=https://python-api-3-vb5h.onrender.com
ENABLE_BACKGROUND_SYNC=true
AMAZON_SPAPI_BASE_URL=https://sellingpartnerapi-na.amazon.com
```

### 2. Run Migration
```bash
psql "$DATABASE_URL" -f Integrations-backend/migrations/004_add_financial_events_and_detection.sql
```

### 3. Verify API Health
```bash
curl https://python-api-3-vb5h.onrender.com/health
```

### 4. Test Detection
```bash
# Run automated test script
./test-phase3-production-e2e.ps1
```

## 📊 Monitoring Dashboard

### Key Metrics to Track
1. **Detection Rate**: Detections per sync
2. **Confidence Distribution**: High/Medium/Low percentages
3. **Recovery Rates**: Actual recovery by confidence level
4. **API Performance**: Response times, error rates
5. **Anomaly Type Distribution**: Which types are most common

### Dashboard Endpoints
- `GET /api/detections/statistics` - Overall statistics
- `GET /api/detections/history` - Detection history
- `GET /api/detections/confidence-distribution` - Confidence breakdown

## 🔍 Troubleshooting

### Migration Fails
- Check if tables already exist
- Verify DATABASE_URL is correct
- Check database permissions

### API Health Check Fails
- Verify PYTHON_API_URL is correct
- Check Python API is running
- Verify network connectivity

### Detection Not Running
- Check ENABLE_BACKGROUND_SYNC=true
- Verify detection_queue table exists
- Check background worker logs

### Low Confidence Scores
- Review financial event data quality
- Check Python API model performance
- Consider recalibrating thresholds

## ✅ Completion Checklist

- [ ] Environment variables set in production
- [ ] Database migration executed successfully
- [ ] Python API health check passes
- [ ] Batch prediction endpoint tested
- [ ] E2E test with real data passes
- [ ] All 5 anomaly types detected
- [ ] Confidence scores validated
- [ ] Database writes verified
- [ ] Notifications working
- [ ] Performance metrics acceptable
- [ ] Monitoring dashboard accessible
- [ ] Confidence calibration baseline established

