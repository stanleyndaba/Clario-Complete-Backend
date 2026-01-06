# Refund Engine API

Production-ready REST API for refund claims management with ML-powered discrepancy detection.

## 🚀 Quick Start
### Amazon SP-API / Headless Submission Worker

Environment variables:

```
ENABLE_AMAZON_SUBMISSION=true
AMAZON_HEADLESS_BASE_URL=https://your-headless-bridge
AMAZON_HEADLESS_API_KEY=...

# Optional metrics visibility
ENABLE_AMAZON_METRICS=true
```

When enabled, the worker:
- inserts a submission record for each new claim
- submits to Amazon via headless client and stores `submission_id`
- polls status → maps to internal statuses: pending, acknowledged, paid, failed
- marks case `paid` when Amazon pays out (triggers billing and notification)

Metrics/Health endpoints (with `ENABLE_AMAZON_METRICS=true`):

- `GET /api/v1/amazon-submissions/metrics` → { total, byStatus, failedAttempts, totalAttempts }
- `GET /api/v1/amazon-submissions/health` → { workerEnabled, pending, inProgress, lastUpdate }
- `GET /api/v1/amazon-submissions/in-progress` → list of active submissions

Paid-only billing & notifications:
- Commission charged (idempotent) only when claim is `paid`
- Notification `payment_processed` emitted on paid

Verification flow:
1) Create a claim → submission record created
2) Worker submits → `submission_id` stored, status moves to `pending`
3) Polling updates status to `acknowledged` → then `paid`
4) Case becomes `paid` → Stripe commission charged once, notification sent, billing audit logged
5) Check metrics/health endpoints for visibility


```bash
npm install
cp env.example .env
npm run dev
```

## 📚 API Endpoints

### Claims Management
- `POST /api/v1/claims` - Create claim
- `GET /api/v1/claims` - List claims (with pagination/filtering)
- `GET /api/v1/claims/:id` - Get specific claim
- `PUT /api/v1/claims/:id` - Update claim
- `DELETE /api/v1/claims/:id` - Delete claim
- `GET /api/v1/claims/stats` - Get statistics

### Ledger Queries
- `GET /api/v1/ledger` - Query ledger entries
- `GET /api/v1/ledger/stats` - Ledger statistics
- `POST /api/v1/ledger` - Create ledger entry

### Discrepancy Detection
- `GET /api/v1/discrepancies` - Get ML-predicted discrepancies
- `GET /api/v1/discrepancies/stats` - Discrepancy statistics
- `POST /api/v1/discrepancies/batch-predict` - Batch ML predictions

## 🔐 Authentication

All endpoints require JWT token:
```
Authorization: Bearer <jwt-token>
```

## 🗄️ Database Schema

### refund_engine_cases
- `id` (UUID, Primary Key)
- `user_id` (UUID, RLS enforced)
- `case_number` (VARCHAR, Unique)
- `claim_amount` (DECIMAL)
- `customer_history_score` (DECIMAL)
- `product_category` (VARCHAR)
- `days_since_purchase` (INTEGER)
- `status` (ENUM: pending, approved, rejected, processing)
- `ml_prediction` (DECIMAL)
- `ml_confidence` (DECIMAL)

### refund_engine_ledger
- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key)
- `user_id` (UUID, RLS enforced)
- `entry_type` (ENUM: claim, refund, fee, adjustment)
- `amount` (DECIMAL)
- `description` (TEXT)
- `status` (ENUM: pending, completed, failed)

## 🤖 ML Integration

Calls external ML API (`http://localhost:8000/predict-success`) for:
- Success probability prediction
- Confidence scoring
- Discrepancy detection (threshold: 0.7 probability, 0.6 confidence)

## 🧪 Testing

```bash
npm test
npm run test:watch
```

## 🏗️ Architecture

- **Express.js** with TypeScript
- **PostgreSQL** with Row Level Security (RLS)
- **JWT** authentication
- **Rate limiting** and security headers
- **Multi-tenant** data isolation

## 📊 Health Check

```http
GET /health
```

Returns database connection status and API health.

## 🔧 Configuration

Key environment variables:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `JWT_SECRET`
- `ML_API_BASE_URL`
- `PORT` (default: 3000)

## 🚀 Production

```bash
npm run build
npm start
```

Includes graceful shutdown and connection pooling. 