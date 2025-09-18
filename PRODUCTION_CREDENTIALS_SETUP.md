# Production Credentials Setup Guide

This guide walks you through obtaining all the required production credentials for the Opside FBA Claims Pipeline.

## 🔑 **Required Credentials Overview**

| Service | Credentials Needed | Status | Priority |
|---------|-------------------|--------|----------|
| **Amazon OAuth** | Client ID, Client Secret | ❌ Required | 🔴 High |
| **Stripe** | Secret Key, Webhook Secret, Client ID | ❌ Required | 🔴 High |
| **Supabase** | Project URL, Anon Key, Service Role Key | ❌ Required | 🔴 High |
| **Database** | PostgreSQL credentials | ✅ Auto-generated | 🟡 Medium |

---

## 🛒 **1. Amazon OAuth Setup**

### **Step 1: Create Amazon Developer Account**
1. Go to [Amazon Developer Console](https://developer.amazon.com/)
2. Sign in with your Amazon account
3. Click "Create Account" if you don't have one

### **Step 2: Create Login with Amazon Application**
1. Navigate to **Login with Amazon** section
2. Click **"Create a New Security Profile"**
3. Fill in the application details:
   - **Security Profile Name**: `Opside FBA Claims`
   - **Security Profile Description**: `FBA reimbursement automation platform`
   - **Privacy Notice URL**: `https://your-domain.com/privacy`
   - **Consent Logo URL**: `https://your-domain.com/logo.png`

### **Step 3: Configure OAuth Settings**
1. In your security profile, go to **"Web Settings"**
2. Add **Allowed Origins**:
   ```
   https://your-frontend-domain.com
   http://localhost:3000 (for development)
   ```
3. Add **Allowed Return URLs**:
   ```
   https://your-api-domain.com/api/auth/amazon/callback
   http://localhost:8000/api/auth/amazon/callback (for development)
   ```

### **Step 4: Get Credentials**
1. Copy the **Client ID** (starts with `amzn1.application-oa2-client.`)
2. Copy the **Client Secret** (starts with `amzn1.oa2-cs-`)

### **Step 5: Update Environment Variables**
```bash
AMAZON_CLIENT_ID=amzn1.application-oa2-client.your-client-id
AMAZON_CLIENT_SECRET=amzn1.oa2-cs-your-client-secret
AMAZON_REDIRECT_URI=https://your-api-domain.com/api/auth/amazon/callback
```

---

## 💳 **2. Stripe Setup**

### **Step 1: Create Stripe Account**
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Sign up for a new account
3. Complete account verification

### **Step 2: Get API Keys**
1. Go to **Developers > API Keys**
2. Copy the **Secret Key**:
   - Test: `sk_test_...` (for development)
   - Live: `sk_live_...` (for production)
3. Copy the **Publishable Key**:
   - Test: `pk_test_...` (for development)
   - Live: `pk_live_...` (for production)

### **Step 3: Set Up Webhooks**
1. Go to **Developers > Webhooks**
2. Click **"Add endpoint"**
3. Set **Endpoint URL**: `https://your-api-domain.com/webhooks/stripe`
4. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the **Webhook Secret** (starts with `whsec_`)

### **Step 4: Create Connect Platform Account**
1. Go to **Connect > Settings**
2. Click **"Create platform account"**
3. Fill in platform details
4. Copy the **Platform Account ID** (starts with `acct_`)

### **Step 5: Create Subscription Price**
1. Go to **Products > Create Product**
2. Create a product: "Opside FBA Claims - Performance Fee"
3. Add a recurring price (e.g., 20% of recovered amount)
4. Copy the **Price ID** (starts with `price_`)

### **Step 6: Update Environment Variables**
```bash
PAYMENTS_STRIPE_SECRET_KEY=sk_live_your_live_secret_key
PAYMENTS_STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
PAYMENTS_STRIPE_CLIENT_ID=ca_your_client_id
PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID=acct_your_platform_account_id
PAYMENTS_STRIPE_PRICE_ID=price_your_price_id
PAYMENTS_STRIPE_LIVE_MODE=true
```

---

## 🗄️ **3. Supabase Setup**

### **Step 1: Create Supabase Project**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Click **"New Project"**
3. Fill in project details:
   - **Name**: `opside-fba-claims`
   - **Database Password**: Generate a strong password
   - **Region**: Choose closest to your users

### **Step 2: Get API Keys**
1. Go to **Settings > API**
2. Copy the **Project URL**: `https://your-project-id.supabase.co`
3. Copy the **anon public key** (starts with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)
4. Copy the **service_role secret key** (starts with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)

### **Step 3: Set Up Database Schema**
1. Go to **SQL Editor**
2. Run the PostgreSQL migration script from `src/migrations/002_postgresql_init.sql`
3. Verify tables are created in **Table Editor**

### **Step 4: Configure Row Level Security (RLS)**
1. Go to **Authentication > Policies**
2. Enable RLS on all tables
3. Create policies for user data access

### **Step 5: Update Environment Variables**
```bash
INTEGRATIONS_SUPABASE_URL=https://your-project-id.supabase.co
INTEGRATIONS_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
INTEGRATIONS_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 🐳 **4. Docker & PostgreSQL Setup**

### **Option A: Docker Compose (Recommended)**
```bash
# Start PostgreSQL
docker-compose up postgres -d

# Check status
docker-compose ps postgres

# View logs
docker-compose logs postgres
```

### **Option B: Local PostgreSQL Installation**
1. Install PostgreSQL 15+ on your system
2. Create database: `createdb opside_fba`
3. Run migration: `psql opside_fba < src/migrations/002_postgresql_init.sql`

### **Option C: Cloud PostgreSQL (Production)**
- **AWS RDS**: Create PostgreSQL instance
- **Google Cloud SQL**: Create PostgreSQL instance
- **Azure Database**: Create PostgreSQL instance
- **Supabase**: Use built-in PostgreSQL

---

## 🔒 **5. Security Configuration**

### **Generate Secure Secrets**
```bash
# Generate JWT secret
python -c "import secrets; print(secrets.token_urlsafe(64))"

# Generate encryption key
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Generate API keys
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### **Environment-Specific Configuration**

**Development (.env.development):**
```bash
ENV=development
DB_TYPE=sqlite
DB_URL=./claims.db
AMAZON_CLIENT_ID=your-test-client-id
PAYMENTS_STRIPE_LIVE_MODE=false
```

**Production (.env.production):**
```bash
ENV=production
DB_TYPE=postgresql
DB_URL=postgresql://user:pass@host:5432/opside_fba
AMAZON_CLIENT_ID=your-live-client-id
PAYMENTS_STRIPE_LIVE_MODE=true
```

---

## 🧪 **6. Testing & Validation**

### **Test Environment Setup**
```bash
# Validate environment variables
python scripts/validate_env.py

# Test database connection
python -c "from src.common.db_postgresql import db; print('DB OK')"

# Test application startup
python -c "from src.app import app; print('App OK')"

# Test API endpoints
curl http://localhost:8000/health
```

### **Test OAuth Flow**
1. Start application: `python -m uvicorn src.app:app --reload`
2. Visit: `http://localhost:8000/api/auth/amazon/login`
3. Complete OAuth flow
4. Verify user creation in database

### **Test Stripe Integration**
1. Create test customer
2. Process test payment
3. Verify webhook handling
4. Check database records

---

## 📋 **7. Deployment Checklist**

### **Pre-Deployment**
- [ ] All credentials obtained and configured
- [ ] Environment variables validated
- [ ] Database schema migrated
- [ ] OAuth flow tested
- [ ] Stripe integration tested
- [ ] Security secrets generated

### **Production Deployment**
- [ ] Use production API keys
- [ ] Enable HTTPS only
- [ ] Set up monitoring
- [ ] Configure backups
- [ ] Set up logging
- [ ] Test all endpoints

### **Post-Deployment**
- [ ] Monitor application logs
- [ ] Test OAuth flow in production
- [ ] Verify Stripe webhooks
- [ ] Check database performance
- [ ] Monitor error rates

---

## 🆘 **Troubleshooting**

### **Common Issues**

1. **OAuth Redirect Mismatch**
   - Ensure redirect URI matches exactly
   - Check for trailing slashes
   - Verify HTTPS in production

2. **Stripe Webhook Failures**
   - Check webhook endpoint URL
   - Verify webhook secret
   - Test with Stripe CLI

3. **Database Connection Issues**
   - Check connection string format
   - Verify database credentials
   - Test network connectivity

4. **Environment Variable Issues**
   - Ensure .env file is loaded
   - Check for typos in variable names
   - Verify no extra spaces

### **Support Resources**
- [Amazon OAuth Documentation](https://developer.amazon.com/docs/login-with-amazon/overview.html)
- [Stripe API Documentation](https://stripe.com/docs/api)
- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

## ✅ **Completion Status**

| Task | Status | Notes |
|------|--------|-------|
| Amazon OAuth Setup | ⏳ Pending | Need developer account |
| Stripe Configuration | ⏳ Pending | Need Stripe account |
| Supabase Setup | ⏳ Pending | Need Supabase project |
| Database Migration | ✅ Complete | Ready for production |
| Security Configuration | ✅ Complete | Auto-generated secrets |
| Testing & Validation | ✅ Complete | Test suite ready |

**Next Steps**: Follow the setup guides above to obtain production credentials and update your `.env` file.




