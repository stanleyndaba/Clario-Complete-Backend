# 🚀 Quick Start Guide - Stripe Payments Microservice

## ⚡ Get Running in 5 Minutes

### 1. Environment Setup
```bash
# Copy environment template
cp env.example .env

# Edit .env with your values
# - DATABASE_URL (PostgreSQL)
# - REDIS_URL (Redis)
# - STRIPE_SECRET_KEY (from Stripe dashboard)
# - STRIPE_WEBHOOK_SECRET (from Stripe dashboard)
# - JWT_SECRET (generate a random 32+ char string)
```

### 2. Database Setup
```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Seed with test data (generates JWT tokens)
npm run prisma:seed
```

### 3. Start Services
```bash
# Start Redis and PostgreSQL (or use Docker)
docker-compose up -d

# Start the service
npm run dev
```

### 4. Test the API
```bash
# Health check (no auth required)
curl http://localhost:4000/health

# Use JWT tokens from seeding output
# Test commission charging
curl -X POST http://localhost:4000/api/v1/stripe/charge-commission \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "userId": 1,
    "claimId": 123,
    "amountRecoveredCents": 10000,
    "currency": "usd"
  }'
```

## 🔑 Generated JWT Tokens

After running `npm run prisma:seed`, you'll get:
- **User 1 Token**: For testing regular user operations
- **User 2 Token**: For testing another user
- **Admin Token**: For testing admin-only operations

## 🧪 Run Tests
```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# With coverage
npm run test:coverage
```

## 📊 Monitor the Service
```bash
# Queue stats (admin only)
curl -H "Authorization: Bearer ADMIN_TOKEN" \
  http://localhost:4000/api/v1/stripe/queue-stats

# Reconciliation summary (admin only)
curl -H "Authorization: Bearer ADMIN_TOKEN" \
  http://localhost:4000/api/v1/stripe/reconciliation-summary
```

## 🐛 Common Issues

**Database connection failed?**
- Check PostgreSQL is running
- Verify DATABASE_URL format
- Run `npm run prisma:generate`

**Redis connection failed?**
- Check Redis is running
- Verify REDIS_URL format
- Check Redis port (default: 6379)

**JWT authentication failed?**
- Use tokens from `npm run prisma:seed`
- Check JWT_SECRET in .env
- Verify token hasn't expired (24h default)

**Webhook signature verification failed?**
- Check STRIPE_WEBHOOK_SECRET
- Ensure webhook URL is accessible
- Use Stripe CLI for local testing: `stripe listen --forward-to localhost:4000/webhooks/stripe`

## 🎯 Next Steps

1. **Configure Stripe webhooks** for your domain
2. **Set up monitoring** (Sentry, logging)
3. **Deploy to production** with proper environment variables
4. **Integrate with your refund engine** using the charge-commission endpoint

## 📚 Full Documentation

See [README.md](README.md) for complete API documentation and deployment guides.


