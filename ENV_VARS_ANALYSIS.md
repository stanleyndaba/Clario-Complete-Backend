# 🔍 Python API Environment Variables Analysis

## ✅ Correctly Set Variables

These are properly configured:
- ✅ `AMAZON_CLIENT_ID` - Correct sandbox client ID
- ✅ `AMAZON_CLIENT_SECRET` - Correct sandbox secret
- ✅ `AMAZON_MARKETPLACE_ID` - Correct marketplace ID
- ✅ `AMAZON_REDIRECT_URI` - Correct redirect URI
- ✅ `AMAZON_SPAPI_BASE_URL` - Correct sandbox URL
- ✅ `AMAZON_SPAPI_REFRESH_TOKEN` - Refresh token present
- ✅ `DATABASE_URL` - Database connection string present
- ✅ `JWT_SECRET` - JWT secret configured
- ✅ `ENV=production` - Environment set correctly

## ⚠️ Issues Found

### 1. **CRITICAL: Missing INTEGRATIONS_URL**
**Problem**: The Python backend doesn't know where the Node.js backend is located.

**Current**: Not set (defaults to `http://localhost:3001` in production)

**Should be**:
```bash
INTEGRATIONS_URL=https://opside-node-api.onrender.com
```

**Why it matters**: The Python backend calls the Node.js backend to fetch Amazon SP-API data. Without this, recoveries endpoint will fail.

### 2. **FRONTEND_URL has incorrect path**
**Problem**: Includes `/app` path which shouldn't be there.

**Current**: 
```bash
FRONTEND_URL=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app/app
```

**Should be**:
```bash
FRONTEND_URL=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
```

**Why it matters**: OAuth redirects will fail if the URL includes `/app`.

### 3. **CORS_ALLOW_ORIGINS has incorrect path**
**Problem**: Same as FRONTEND_URL.

**Current**:
```bash
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app/app
```

**Should be**:
```bash
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
```

**Why it matters**: CORS will reject requests if the origin doesn't match exactly.

### 4. **Placeholder values need to be filled**
These still have `<your-...>` placeholders:

**Current**:
- `REDIS_URL=<your-redis-url>` ❌
- `STRIPE_SECRET_KEY=<your-stripe-key>` ❌
- `SUPABASE_KEY=<your-supabase-key>` ❌

**Action needed**: 
- If you're using Redis: Set actual Redis URL or remove if not needed
- If you're using Stripe: Set actual Stripe secret key or remove if not needed
- If you're using Supabase: Set actual Supabase key or remove if not needed

### 5. **Missing INTEGRATIONS_API_KEY**
**Problem**: May be needed for internal service communication.

**Should add** (if Node.js backend requires it):
```bash
INTEGRATIONS_API_KEY=your-api-key-here
```

### 6. **SESSION_SECRET set to "false"**
**Problem**: Should be a secure random string, not the word "false".

**Current**:
```bash
SESSION_SECRET=false
```

**Should be**:
```bash
SESSION_SECRET=<generate-a-secure-random-string>
```

### 7. **ENCRYPTION_KEY_VALUE set to "true"**
**Problem**: Should be a secure key, not the word "true".

**Current**:
```bash
ENCRYPTION_KEY_VALUE=true
```

**Should be**:
```bash
ENCRYPTION_KEY_VALUE=<generate-a-secure-random-string>
```

## 📋 Recommended Fixes

### Immediate Fixes (Required):

1. **Add INTEGRATIONS_URL**:
```bash
INTEGRATIONS_URL=https://opside-node-api.onrender.com
```

2. **Fix FRONTEND_URL**:
```bash
FRONTEND_URL=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
```

3. **Fix CORS_ALLOW_ORIGINS**:
```bash
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
```

### Optional Fixes (Recommended):

4. **Generate secure secrets**:
```bash
# Generate a secure session secret
SESSION_SECRET=$(openssl rand -hex 32)

# Generate an encryption key
ENCRYPTION_KEY_VALUE=$(openssl rand -hex 32)
```

5. **Set placeholder values**:
- If using Redis: Set `REDIS_URL` to actual Redis instance
- If using Stripe: Set `STRIPE_SECRET_KEY` to actual Stripe key
- If using Supabase: Set `SUPABASE_KEY` to actual Supabase key
- If not using them: Remove the variables or set to empty string

## 🔧 Complete Corrected Environment Variables

Here's what your environment variables should look like:

```bash
# Amazon SP-API Configuration
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
AMAZON_REDIRECT_URI=https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/callback
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_SPAPI_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE

# Database Configuration
DATABASE_URL=postgresql://postgres:Lungilemzila%4075@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
DB_HOST=aws-0-us-east-1.pooler.supabase.com
DB_NAME=postgres
DB_PASSWORD=Lungilemzila@75
DB_PORT=6543
DB_SSL=true
DB_TYPE=postgresql
DB_USER=postgres

# Frontend Configuration
FRONTEND_URL=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
COOKIE_DOMAIN=.clario.com

# Service URLs (CRITICAL)
INTEGRATIONS_URL=https://opside-node-api.onrender.com

# Security Configuration
JWT_SECRET=6d55b17615e87f15b252adc68a4b87ee69c2d910ef4b12d5b12fae94568b86cc
SESSION_SECRET=<generate-secure-random-string>
ENCRYPTION_KEY_VALUE=<generate-secure-random-string>
TOKEN_ENC_KEY=1Sp3Vl4N-dvoMk_d8mOkKW006xqrKw5xzBja91Oq

# Application Configuration
ENV=production
PORT=8000
PYTHON_VERSION=3.11.4

# Email Configuration
EMAIL_API_KEY=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
EMAIL_FROM_EMAIL=clarioo@gmail.com
EMAIL_FROM_NAME=Clario
EMAIL_PROVIDER=sendgrid

# Internal API Key
INTERNAL_API_KEY=sk_internal_dev_4e3f2a1c

# Optional Services (set if needed, remove if not)
REDIS_ENABLED=false
REDIS_URL=
STRIPE_SECRET_KEY=
SUPABASE_KEY=
SUPABASE_URL=postgresql://postgres.fmzfjhrwbkebqaxjlvzt:Lungilemzila_75@aws-1-eu-central-1.pooler.supabase.com:5432/postgres
```

## 🚨 Critical Issues Summary

1. **Missing INTEGRATIONS_URL** - Will cause recoveries endpoint to fail
2. **FRONTEND_URL has `/app` path** - Will cause OAuth redirects to fail
3. **CORS_ALLOW_ORIGINS has `/app` path** - Will cause CORS errors
4. **SESSION_SECRET is "false"** - Security issue
5. **ENCRYPTION_KEY_VALUE is "true"** - Security issue

## ✅ Action Items

1. ✅ Add `INTEGRATIONS_URL=https://opside-node-api.onrender.com`
2. ✅ Fix `FRONTEND_URL` (remove `/app`)
3. ✅ Fix `CORS_ALLOW_ORIGINS` (remove `/app`)
4. ✅ Generate secure `SESSION_SECRET`
5. ✅ Generate secure `ENCRYPTION_KEY_VALUE`
6. ✅ Fill in or remove placeholder values (`REDIS_URL`, `STRIPE_SECRET_KEY`, `SUPABASE_KEY`)

## 🔐 How to Generate Secure Secrets

You can generate secure random strings using:

```bash
# Generate session secret
openssl rand -hex 32

# Generate encryption key
openssl rand -hex 32

# Or use Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

