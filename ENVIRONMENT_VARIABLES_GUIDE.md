# Environment Variables Guide

This guide provides comprehensive documentation for all environment variables used in the Opside FBA Claims Pipeline.

## 🔧 Quick Setup

### 1. Generate Environment Files
```bash
# Run the setup script to generate secure environment files
python scripts/setup_environment.py

# This creates:
# - .env.development (for local development)
# - .env.production (for production deployment)
# - .env.docker (for Docker Compose)
# - scripts/validate_environment.py (validation script)
```

### 2. Copy and Configure
```bash
# For local development
cp .env.development .env

# Edit .env with your actual credentials
nano .env
```

### 3. Validate Configuration
```bash
# Validate environment variables
python scripts/validate_environment.py
```

## 📋 Environment Variables Reference

### 🔐 **Critical Security Variables**

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `JWT_SECRET` | JWT signing secret (64+ chars) | ✅ | `your-super-secret-jwt-key-here` |
| `CRYPTO_SECRET` | Encryption key for tokens | ✅ | `a_very_secret_key_for_encryption_32_bytes` |
| `DB_PASSWORD` | Database password | ✅ | `secure_database_password` |

### 🗄️ **Database Configuration**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `DB_TYPE` | Database type | ✅ | `postgresql` | `postgresql` or `sqlite` |
| `DB_URL` | Database connection URL | ✅ | - | `postgresql://user:pass@host:5432/db` |
| `DB_NAME` | Database name | ✅ | `opside_fba` | `opside_fba_prod` |
| `DB_USER` | Database username | ✅ | `postgres` | `opside_user` |
| `DB_PASSWORD` | Database password | ✅ | - | `secure_password` |

### 🌐 **Application Configuration**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `ENV` | Environment | ✅ | `dev` | `development`, `staging`, `production` |
| `FRONTEND_URL` | Frontend URL | ✅ | `http://localhost:3000` | `https://app.opside.com` |

### 🔑 **Amazon OAuth Configuration**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `AMAZON_CLIENT_ID` | Amazon OAuth client ID | ✅ | - | `amzn1.application-oa2-client.xxx` |
| `AMAZON_CLIENT_SECRET` | Amazon OAuth client secret | ✅ | - | `amzn1.oa2-cs-xxx` |
| `AMAZON_REDIRECT_URI` | OAuth redirect URI | ✅ | - | `https://api.opside.com/api/auth/amazon/callback` |

**How to get Amazon OAuth credentials:**
1. Go to [Amazon Developer Console](https://developer.amazon.com/)
2. Create a new Login with Amazon application
3. Configure redirect URI: `https://your-domain.com/api/auth/amazon/callback`
4. Copy Client ID and Client Secret

### 💳 **Stripe Configuration**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `PAYMENTS_STRIPE_SECRET_KEY` | Stripe secret key | ✅ | - | `sk_live_xxx` or `sk_test_xxx` |
| `PAYMENTS_STRIPE_WEBHOOK_SECRET` | Webhook secret | ✅ | - | `whsec_xxx` |
| `PAYMENTS_STRIPE_CLIENT_ID` | Stripe client ID | ✅ | - | `ca_xxx` |
| `PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID` | Platform account ID | ✅ | - | `acct_xxx` |
| `PAYMENTS_STRIPE_PRICE_ID` | Price ID for subscriptions | ✅ | - | `price_xxx` |
| `PAYMENTS_STRIPE_LIVE_MODE` | Live mode flag | ✅ | `false` | `true` or `false` |

**How to get Stripe credentials:**
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Get API keys from Developers > API keys
3. Create webhook endpoint and get secret
4. Create Connect platform account
5. Create price for subscriptions

### 🔗 **Service URLs**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `INTEGRATIONS_URL` | Integrations service URL | ✅ | `http://localhost:3001` | `https://integrations.opside.com` |
| `INTEGRATIONS_API_KEY` | Internal API key | ✅ | - | `sk_integrations_xxx` |
| `STRIPE_SERVICE_URL` | Stripe service URL | ✅ | `http://localhost:4000` | `https://payments.opside.com` |
| `STRIPE_INTERNAL_API_KEY` | Internal API key | ✅ | - | `sk_stripe_xxx` |

### 🗃️ **Supabase Configuration**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `INTEGRATIONS_SUPABASE_URL` | Supabase project URL | ✅ | - | `https://xxx.supabase.co` |
| `INTEGRATIONS_SUPABASE_ANON_KEY` | Supabase anon key | ✅ | - | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `INTEGRATIONS_SUPABASE_SERVICE_ROLE_KEY` | Service role key | ✅ | - | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

**How to get Supabase credentials:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Create a new project
3. Go to Settings > API
4. Copy Project URL, anon key, and service_role key

### ⚙️ **Service Ports**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `INTEGRATIONS_PORT` | Integrations service port | ✅ | `3001` | `3001` |
| `PAYMENTS_PORT` | Payments service port | ✅ | `4000` | `4000` |
| `COST_DOC_PORT` | Cost docs service port | ✅ | `3003` | `3003` |
| `REFUND_ENGINE_PORT` | Refund engine port | ✅ | `3002` | `3002` |

### 🔄 **Redis Configuration**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `REDIS_URL` | Redis connection URL | ✅ | `redis://localhost:6379` | `redis://redis-host:6379` |

### 🚀 **Rate Limiting**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `INTEGRATIONS_RATE_LIMIT_WINDOW_MS` | Rate limit window | ✅ | `900000` | `900000` (15 minutes) |
| `INTEGRATIONS_RATE_LIMIT_MAX_REQUESTS` | Max requests per window | ✅ | `100` | `100` |
| `REFUND_ENGINE_RATE_LIMIT_WINDOW_MS` | Rate limit window | ✅ | `900000` | `900000` |
| `REFUND_ENGINE_RATE_LIMIT_MAX_REQUESTS` | Max requests per window | ✅ | `100` | `100` |

### 🤖 **ML Service Configuration**

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `MCDE_CORS_ORIGINS` | CORS origins for ML service | ✅ | - | `https://app.opside.com,https://api.opside.com` |
| `REFUND_ENGINE_ML_API_BASE_URL` | ML API base URL | ✅ | `http://mcde:8000` | `https://ml.opside.com` |

## 🔒 Security Best Practices

### 1. **Secret Generation**
```bash
# Generate secure JWT secret
python -c "import secrets; print(secrets.token_urlsafe(64))"

# Generate encryption key
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Generate API key
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 2. **Environment-Specific Configurations**

**Development:**
- Use test API keys
- Enable debug logging
- Use local database
- Allow HTTP (not HTTPS)

**Production:**
- Use live API keys
- Disable debug logging
- Use production database
- Enforce HTTPS only

### 3. **Secret Rotation**
- Rotate JWT secrets monthly
- Rotate API keys quarterly
- Update database passwords annually
- Monitor for compromised credentials

### 4. **Access Control**
- Use least privilege principle
- Separate read/write database users
- Use different API keys per service
- Implement IP whitelisting

## 🐳 Docker Configuration

### Docker Compose Environment
```yaml
# docker-compose.yml
services:
  main-api:
    env_file:
      - .env.docker
    environment:
      - DB_URL=postgresql://postgres:${DB_PASSWORD}@postgres:5432/${DB_NAME}
```

### Environment File Priority
1. `.env.docker` (Docker Compose)
2. `.env.local` (Local overrides)
3. `.env` (Default)

## 🧪 Testing Environment

### Test Configuration
```bash
# Create test environment
cp .env.development .env.test

# Update for testing
export ENV=test
export DB_NAME=opside_fba_test
export JWT_SECRET=test-jwt-secret
```

### Validation
```bash
# Validate environment
python scripts/validate_environment.py

# Test database connection
python -c "from src.common.db_postgresql import db; print('DB OK')"

# Test API endpoints
curl http://localhost:8000/health
```

## 🚨 Troubleshooting

### Common Issues

1. **Missing Variables**
   ```bash
   # Check missing variables
   python scripts/validate_environment.py
   ```

2. **Database Connection**
   ```bash
   # Test database connection
   python -c "from src.common.config import settings; print(settings.DB_URL)"
   ```

3. **Service Dependencies**
   ```bash
   # Check service URLs
   curl $INTEGRATIONS_URL/health
   curl $STRIPE_SERVICE_URL/health
   ```

4. **Authentication Issues**
   ```bash
   # Check JWT secret
   python -c "from src.common.config import settings; print(len(settings.JWT_SECRET))"
   ```

### Debug Mode
```bash
# Enable debug logging
export ENV=development
export DEBUG=true

# Run with verbose output
python -m uvicorn src.app:app --reload --log-level debug
```

## 📚 Additional Resources

- [Amazon OAuth Documentation](https://developer.amazon.com/docs/login-with-amazon/overview.html)
- [Stripe API Documentation](https://stripe.com/docs/api)
- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Docker Environment Variables](https://docs.docker.com/compose/environment-variables/)

---

**Environment Variables Status**: ✅ **Complete and Production-Ready**




