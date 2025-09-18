# Stripe Payments Microservice

A production-ready Stripe Payments microservice for Opside's 20% performance fee flow and automatic payouts to sellers.

## 🚀 Features

- **20% Performance Fee Collection**: Automatically collect platform fees when Amazon refunds are confirmed
- **Stripe Connect Integration**: Support for seller onboarding and automatic transfers
- **Idempotent Operations**: Safe retry mechanisms with idempotency keys
- **Webhook Processing**: Secure webhook signature verification and event processing
- **Background Job Queue**: BullMQ-powered job processing with retry logic
- **Audit Trail**: Comprehensive logging and transaction history
- **Reconciliation**: Handle clawbacks and transaction discrepancies
- **Security**: PCI-compliant with no raw card storage
- **JWT Authentication**: Secure API access with role-based authorization
- **Complete Test Coverage**: Unit and integration tests with seed data

## 📋 Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- Stripe Account with Connect enabled
- Docker & Docker Compose (for local development)

## 🛠️ Installation

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd stripe-payments
npm install
```

### 2. Environment Setup

Copy the environment example and configure your variables:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=4000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/opside

# Redis
REDIS_URL=redis://localhost:6379

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CLIENT_ID=ca_xxx
STRIPE_PLATFORM_ACCOUNT_ID=acct_xxx
STRIPE_API_VERSION=2023-08-16
STRIPE_PRICE_ID=price_xxx
STRIPE_LIVE_MODE=false

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here

# Optional: Sentry
SENTRY_DSN=
```

### 3. Database Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# (Optional) Seed database
npm run prisma:seed
```

### 4. Register Stripe Webhooks

```bash
# Set your webhook URL
export WEBHOOK_URL=https://yourdomain.com/webhooks/stripe

# Register webhooks
npm run webhook:register
```

### 5. Seed Database with Test Data

```bash
# Seed database with test data and generate JWT tokens
npm run prisma:seed
```

## 🚀 Development

### Local Development

```bash
# Start development server
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Docker Development

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f stripe-payments

# Stop services
docker-compose down
```

### Stripe CLI for Webhook Testing

```bash
# Install Stripe CLI
# https://stripe.com/docs/stripe-cli

# Forward webhooks to local development
stripe listen --forward-to localhost:4000/webhooks/stripe
```

## 📚 API Documentation

### Base URL
```
http://localhost:4000/api/v1
```

### Authentication
Most endpoints require JWT authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

**Admin-only endpoints** require a JWT token with `role: "admin"`. Use the admin token generated during seeding.

**Regular user endpoints** require a JWT token with `role: "user"` or `role: "admin"`.

### Endpoints

#### Stripe Connect

**POST** `/stripe/connect`
Create or link a Stripe Connect account for a seller.

```json
{
  "userId": 123,
  "email": "seller@example.com",
  "country": "US",
  "returnUrl": "https://app.opside.com/connect/return",
  "refreshUrl": "https://app.opside.com/connect/refresh"
}
```

**GET** `/stripe/status/:userId`
Get the status of a seller's Stripe Connect account.

#### Commission Charging

**POST** `/stripe/charge-commission`
Charge the 20% platform fee when a refund is confirmed.

```json
{
  "userId": 123,
  "claimId": 456,
  "amountRecoveredCents": 10000,
  "currency": "usd",
  "idempotencyKey": "uuid-v4-key",
  "paymentMethodId": "pm_xxx",
  "customerId": "cus_xxx"
}
```

#### Transactions

**GET** `/stripe/transactions/:userId`
List transactions for a user with pagination.

**GET** `/stripe/transactions/:transactionId`
Get a specific transaction with audit trail.

#### Webhooks

**POST** `/webhooks/stripe`
Stripe webhook endpoint (also available at `/api/v1/webhooks/stripe`).

Supported events:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.succeeded`
- `charge.failed`
- `charge.refunded`
- `invoice.finalized`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `transfer.paid`
- `transfer.failed`
- `account.updated`

Webhook best practices used:

- Raw body parsing for signature verification
- Signature verified with `STRIPE_WEBHOOK_SECRET`
- Event idempotency enforced via DB

#### Testing

**POST** `/stripe/simulate-payout`
Simulate a payout for testing purposes.

```json
{
  "transactionId": 123,
  "eventType": "payment_intent.succeeded"
}
```

#### Reconciliation

**POST** `/stripe/reconcile`
Reconcile a transaction with Stripe events.

```json
{
  "transactionId": 123,
  "reason": "Manual reconciliation"
}
```

**POST** `/stripe/clawback`
Handle Amazon clawback scenario.

```json
{
  "transactionId": 123,
  "reason": "Amazon refund reversal",
  "refundAmountCents": 2000
}
```

**GET** `/stripe/reconciliation-summary`
Get reconciliation statistics.

#### Monitoring

**GET** `/stripe/queue-stats`
Get background job queue statistics.

**GET** `/stripe/audit-trail/:transactionId`
Get audit trail for a transaction.

**GET** `/stripe/user-audit/:userId`
Get audit summary for a user.

**GET** `/stripe/unprocessed-webhooks`
Get unprocessed webhook events.

#### Admin Operations

**POST** `/stripe/retry-transaction`
Retry a failed transaction.

```json
{
  "transactionId": 123
}
```

**POST** `/stripe/cleanup`
Clean up old audit logs and webhook events.

```json
{
  "daysToKeep": 90
}
```

### Health Check

**GET** `/health`
Service health check endpoint.

## 🔄 Business Flow

### 1. Seller Onboarding
1. Seller calls `POST /stripe/connect`
2. System creates Stripe Connect account
3. Seller completes onboarding via Stripe
4. System stores account details

### 2. Refund Confirmation
1. Refund Engine calls `POST /stripe/charge-commission`
2. System calculates 20% platform fee
3. Creates PaymentIntent for platform fee
4. Queues background job for processing
5. Returns transaction ID immediately

### 3. Payment Processing
1. Background job creates PaymentIntent
2. Webhook receives `payment_intent.succeeded`
3. System marks transaction as charged
4. If seller has Connect account, queues transfer
5. Webhook receives `transfer.paid`
6. System marks transaction as transferred

### 4. Reconciliation
1. System monitors for discrepancies
2. Admin can manually reconcile transactions
3. Clawback handling for Amazon reversals
4. Audit trail for all operations

### 5. Subscriptions (Recurring)
1. Client calls `POST /api/v1/stripe/create-customer-setup` to get `customerId` and `setupClientSecret`
2. Frontend collects card and confirms SetupIntent
3. Client calls `POST /api/v1/stripe/create-subscription` with `userId`, `customerId` and optional `priceId`
4. Webhooks update invoice/subscription status

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Test Coverage
```bash
npm run test:coverage
```

### Manual Testing with Stripe CLI

1. Start the service:
```bash
npm run dev
```

2. Forward webhooks:
```bash
stripe listen --forward-to localhost:4000/webhooks/stripe
```

3. Create a test transaction:
```bash
curl -X POST http://localhost:4000/api/v1/stripe/charge-commission \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-123" \
  -d '{
    "userId": 1,
    "claimId": 123,
    "amountRecoveredCents": 10000,
    "currency": "usd"
  }'
```

4. Simulate webhook event:
```bash
curl -X POST http://localhost:4000/api/v1/stripe/simulate-payout \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": 1,
    "eventType": "payment_intent.succeeded"
  }'
```

5. Create subscription flow:
```bash
curl -X POST http://localhost:4000/api/v1/stripe/create-customer-setup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{
    "userId": 1,
    "email": "user@example.com"
  }'
```
Then confirm the SetupIntent on the frontend, followed by:
```bash
curl -X POST http://localhost:4000/api/v1/stripe/create-subscription \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{
    "userId": 1,
    "customerId": "cus_xxx",
    "priceId": "price_xxx"
  }'
```

### Production Validation (Live)
Perform one live end-to-end validation after cutover:
1) Create customer and attach live card via frontend.
2) Create subscription using `POST /api/v1/stripe/create-subscription`.
3) Observe webhooks for `invoice.finalized` and `invoice.paid`.
4) Confirm DB: `StripeSubscription` and `StripeInvoice` have expected records.
5) Export finance logs from `TransactionAudit` and match against Stripe Dashboard.

## 🐳 Docker Deployment

### Production Build
```bash
docker build -t stripe-payments .
```

### Docker Compose
```bash
docker-compose up -d
```

### Environment Variables
Set the following environment variables in your deployment:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `STRIPE_SECRET_KEY`: Your Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Webhook signing secret
- `STRIPE_CLIENT_ID`: Stripe Connect client ID
- `STRIPE_PLATFORM_ACCOUNT_ID`: Your platform account ID
- `STRIPE_PRICE_ID`: Default subscription price ID
- `STRIPE_LIVE_MODE`: `true` to enforce live mode in prod
- `JWT_SECRET`: Secret for JWT signing

## 🔒 Security

### PCI Compliance
- No raw card data is stored
- All payment methods are stored in Stripe
- Webhook signatures are verified
- HTTPS is required in production

### Authentication
- JWT tokens for API access
- Server-to-server authentication for internal calls
- Rate limiting on all endpoints

### Data Protection
- Audit trail for all operations
- Idempotency keys prevent duplicate charges
- Encrypted database connections
- Secure environment variable handling

## 📊 Monitoring

### Health Checks
- Database connectivity
- Redis connectivity
- Stripe API connectivity
- Background job queue status

### Logging
- Structured JSON logging with Winston
- Request/response logging
- Error tracking with Sentry (optional)
- Audit trail for all transactions

### Metrics
- Transaction success/failure rates
- Processing times
- Queue depths
- Error rates

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | Yes | 4000 |
| `NODE_ENV` | Environment | Yes | development |
| `DATABASE_URL` | PostgreSQL URL | Yes | - |
| `REDIS_URL` | Redis URL | Yes | - |
| `STRIPE_SECRET_KEY` | Stripe secret key | Yes | - |
| `STRIPE_WEBHOOK_SECRET` | Webhook secret | Yes | - |
| `STRIPE_CLIENT_ID` | Connect client ID | Yes | - |
| `STRIPE_PLATFORM_ACCOUNT_ID` | Platform account ID | Yes | - |
| `JWT_SECRET` | JWT signing secret | Yes | - |
| `SENTRY_DSN` | Sentry DSN | No | - |
| `LOG_LEVEL` | Logging level | No | info |
| `RATE_LIMIT_MAX_REQUESTS` | Rate limit | No | 100 |
| `PLATFORM_FEE_PERCENTAGE` | Fee percentage | No | 20 |

### Database Schema

The service uses Prisma with the following main tables:

- `StripeAccount`: Seller Connect accounts
- `StripeTransaction`: All payment transactions
- `StripeWebhookEvent`: Webhook event storage
- `TransactionAudit`: Audit trail
- `IdempotencyKey`: Idempotency key storage
- `StripeCustomer`: Maps users to Stripe customers
- `StripeSubscription`: Stores subscriptions
- `StripeInvoice`: Stores invoices

## ✅ Production Readiness Checklist

- Live Stripe keys set: `STRIPE_SECRET_KEY=sk_live_*`, `STRIPE_LIVE_MODE=true`
- Webhook endpoint registered for all required events
- Webhook signature secret configured: `STRIPE_WEBHOOK_SECRET`
- Database migrated with latest Prisma schema
- Background workers connected to Redis
- CORS and HTTPS configured for production domain
- Logs shipped and monitored (Winston/Sentry)
- Rate limiting enabled and tuned
- JWT secrets rotated and stored securely
- Idempotency keys enforced on charge endpoints

### Cutover Steps (Test → Prod)
1) Freeze deployments; announce change window.
2) Update `.env` with:
   - `STRIPE_SECRET_KEY=sk_live_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_live_...`
   - `STRIPE_PRICE_ID=price_live_...`
   - `STRIPE_LIVE_MODE=true`
3) Restart service (pods/instances) and confirm `/health` shows `stripeLiveMode: true`.
4) Register prod webhooks:
   - `export WEBHOOK_URL=https://api.yourdomain.com/webhooks/stripe`
   - `npm run webhook:register`
5) Run a real $1 verification:
   - Create customer + payment method; create subscription with `price_live_...`
   - Or execute a minimal commission charge.
6) Verify:
   - `StripeInvoice` row created/updated to `paid`
   - `TransactionAudit` contains invoice/charge events
   - Dashboard shows transaction data
7) Enable alerts/dashboards; monitor for 24h.
8) If issues, rollback:
   - Set `STRIPE_LIVE_MODE=false`, redeploy, disable webhook endpoint in Stripe.

## ✅ Test Plan Checklist

- New user signup:
  - Create customer and SetupIntent
  - Confirm payment method and create subscription
  - Verify `StripeSubscription` row created/updated via webhook
- Platform fee charge:
  - Call `POST /stripe/charge-commission` with idempotency key
  - Verify `StripeTransaction` created (pending)
  - Receive `payment_intent.succeeded` webhook → transaction becomes charged
  - If Connect account exists → transfer job queued; on `transfer.paid` → status transferred
- Invoice lifecycle:
  - `invoice.finalized` → invoice stored
  - `invoice.paid` → invoice updated with paid amounts
  - `invoice.payment_failed` → failure logged and invoice updated
- Failure handling:
  - Force job failure → verify retries and final audit log on permanent failure
  - Send duplicate webhook → verify idempotent skip
- Security:
  - Invalid webhook signature → 400
  - Missing idempotency key on commission endpoint → 400

## 🤝 Integration

### With Refund Engine
The Refund Engine should call `POST /stripe/charge-commission` when a refund is confirmed:

```typescript
const response = await fetch('https://stripe-payments.opside.com/api/v1/stripe/charge-commission', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwtToken}`,
    'Idempotency-Key': generateIdempotencyKey(),
  },
  body: JSON.stringify({
    userId: claim.userId,
    claimId: claim.id,
    amountRecoveredCents: claim.amountCents,
    currency: claim.currency,
  }),
});
```

### With Frontend
The frontend can use the API for:
- Seller onboarding status
- Transaction history
- Payment method management

## 🚨 Troubleshooting

### Common Issues

1. **Webhook signature verification fails**
   - Check `STRIPE_WEBHOOK_SECRET` is correct
   - Ensure webhook URL is accessible
   - Verify webhook is registered in Stripe

2. **Database connection issues**
   - Check `DATABASE_URL` format
   - Ensure PostgreSQL is running
   - Run `npm run prisma:migrate`

3. **Redis connection issues**
   - Check `REDIS_URL` format
   - Ensure Redis is running
   - Verify network connectivity

4. **Background jobs not processing**
   - Check Redis connectivity
   - Verify queue workers are running
   - Check job logs for errors

### Debug Mode
Enable debug logging:
```bash
LOG_LEVEL=debug npm run dev
```

### Database Reset
```bash
npm run prisma:migrate:reset
```

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

For support and questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

---

**Note**: This service is designed to be deployed as part of the Opside backend monorepo. It can be integrated with shared PostgreSQL and Redis instances, and can reference shared models from `../shared/`. 