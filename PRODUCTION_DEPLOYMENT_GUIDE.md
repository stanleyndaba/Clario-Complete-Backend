# Production Deployment Guide - Phase 1 Security Hardening

## 🎯 Final Steps Before Phase 2

This guide walks you through the final 4 steps to complete Phase 1 security hardening in production.

---

## Step 1: Run Database Migration

### Purpose
Create the `audit_logs` table to store security events, authentication logs, and token operations.

### Migration File
`Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql`

### Option A: Supabase Dashboard (Recommended)

1. **Go to Supabase Dashboard**
   - Navigate to your project
   - Click on **SQL Editor** in the left sidebar

2. **Run Migration**
   - Click **New Query**
   - Copy the entire contents of `001_create_audit_logs_table.sql`
   - Paste into the SQL editor
   - Click **Run** (or press Ctrl+Enter)

3. **Verify Table Created**
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_name = 'audit_logs';
   ```
   Should return: `audit_logs`

4. **Verify Table Structure**
   ```sql
   \d audit_logs
   ```
   Or:
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'audit_logs';
   ```

### Option B: PostgreSQL CLI

```bash
# Set your DATABASE_URL
export DATABASE_URL="postgresql://user:password@host:port/database"

# Run migration
psql "$DATABASE_URL" -f Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql

# Verify
psql "$DATABASE_URL" -c "\d audit_logs"
```

### Option C: Using Script

```bash
# Make script executable
chmod +x scripts/run-migration.sh

# Run migration
bash scripts/run-migration.sh "$DATABASE_URL"
```

### ✅ Verification Checklist
- [ ] Migration executed successfully
- [ ] `audit_logs` table exists
- [ ] Table has correct columns (id, event_type, user_id, ip_address, user_agent, provider, metadata, severity, created_at)
- [ ] Indexes created (event_type, user_id, created_at, severity, provider, metadata)

---

## Step 2: Set Production Environment Variables

### Purpose
Enable token refresh, SP-API access, and secrets validation. The application will fail-fast at startup if required variables are missing.

### Required Variables

#### Node.js Backend (Integrations Backend)

```bash
# Amazon SP-API Configuration
AMAZON_CLIENT_ID=amzn1.application-oa2-client.YOUR_CLIENT_ID
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.YOUR_CLIENT_SECRET
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|YOUR_REFRESH_TOKEN
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com  # or production URL
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
AMAZON_REDIRECT_URI=https://your-api-domain.com/api/v1/integrations/amazon/auth/callback

# Security Configuration
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long
JWT_ALGORITHM=HS256
JWT_EXPIRES_IN_MINUTES=10080

# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Frontend & CORS
FRONTEND_URL=https://your-frontend-domain.com
CORS_ALLOW_ORIGINS=https://your-frontend-domain.com

# Application
NODE_ENV=production
ENV=production
PORT=3001

# Security Settings (Optional - defaults provided)
ALLOWED_REDIRECT_URIS=https://*.vercel.app/*,https://*.onrender.com/*
SECURITY_HSTS_ENABLED=true
SECURITY_HSTS_MAX_AGE=63072000
```

#### Python Backend

```bash
# Amazon SP-API Configuration
AMAZON_CLIENT_ID=amzn1.application-oa2-client.YOUR_CLIENT_ID
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.YOUR_CLIENT_SECRET
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|YOUR_REFRESH_TOKEN
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER

# Security Configuration
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long
JWT_ALGORITHM=HS256
JWT_EXPIRES_IN_MINUTES=10080

# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Frontend & CORS
FRONTEND_URL=https://your-frontend-domain.com
CORS_ALLOW_ORIGINS=https://your-frontend-domain.com

# Application
ENV=production
PORT=8000
```

### Where to Set Variables

#### Render.com
1. Go to your service dashboard
2. Click **Environment** tab
3. Click **Add Environment Variable**
4. Add each variable (name and value)
5. Click **Save Changes**
6. Service will automatically restart

#### Vercel
1. Go to your project settings
2. Click **Environment Variables**
3. Add each variable
4. Select environment (Production, Preview, Development)
5. Click **Save**
6. Redeploy if needed

#### Other Platforms
- **Heroku**: `heroku config:set KEY=value`
- **AWS**: Use AWS Systems Manager Parameter Store or Secrets Manager
- **Docker**: Use `.env` file or docker-compose environment section

### ✅ Verification Checklist
- [ ] All required variables set in production
- [ ] No placeholder values (e.g., "your-", "placeholder")
- [ ] JWT_SECRET is at least 32 characters
- [ ] DATABASE_URL is valid PostgreSQL connection string
- [ ] AMAZON credentials are valid (test with `/diagnose` endpoint)
- [ ] Application starts without errors (check logs)
- [ ] Environment validation passes (no fail-fast errors)

### Test Environment Validation

The application will automatically validate environment variables at startup. Check logs for:

```
✅ Environment validation passed
```

If validation fails, you'll see:
```
❌ Environment validation failed:
Missing required environment variables: AMAZON_CLIENT_ID, JWT_SECRET
```

---

## Step 3: Test Production Endpoints

### Purpose
Verify that all security features are working correctly in production.

### 3.1 Health Check Endpoints

#### Basic Health Check
```bash
curl https://opside-node-api-woco.onrender.com/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-12T00:00:00.000Z",
  "service": "integrations-backend",
  "version": "1.0.0"
}
```

#### Comprehensive Health Check
```bash
curl https://opside-node-api-woco.onrender.com/healthz
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-12T00:00:00.000Z",
  "service": "integrations-backend",
  "version": "1.0.0",
  "checks": {
    "database": { "status": "ok", "error": null },
    "amazonApi": { "status": "ok", "error": null },
    "environment": { "status": "ok", "error": null }
  }
}
```

**Status Codes:**
- `200`: All checks passed
- `503`: Service degraded (some checks failed)

### 3.2 Security Headers Verification

```bash
curl -I https://opside-node-api-woco.onrender.com/health
```

**Expected Headers:**
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self' https:; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests
Referrer-Policy: no-referrer-when-downgrade
X-XSS-Protection: 1; mode=block
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
```

### 3.3 Rate Limiting Test

```bash
# Make 10 rapid requests to auth endpoint
for i in {1..10}; do
    echo "Request $i:"
    curl -s -o /dev/null -w "HTTP %{http_code}\n" \
        https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start
    sleep 0.1
done
```

**Expected:**
- First requests: `200 OK`
- After 100 requests in 15 minutes: `429 Too Many Requests`
- Response includes: `Retry-After` header

### 3.4 OAuth Bypass Disabled Test

```bash
# Try to access bypass endpoint
curl -v "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?bypass=true"
```

**Expected:**
- In production: Bypass should be disabled
- Response: Full OAuth flow initiated (not bypassed)
- Check logs: Should show "Bypass disabled in production"

### 3.5 HTTPS Enforcement Test

```bash
# Try HTTP (should redirect to HTTPS)
curl -I http://opside-node-api-woco.onrender.com/health
```

**Expected:**
- `301 Moved Permanently` or `308 Permanent Redirect`
- `Location: https://...` header

### 3.6 TLS Version Test

```bash
openssl s_client -connect opside-node-api-woco.onrender.com:443 -tls1_2
```

**Expected:**
- Successful handshake
- TLS version: 1.2 or higher
- No fallback to TLS < 1.2

### ✅ Verification Checklist
- [ ] `/health` endpoint returns 200
- [ ] `/healthz` endpoint returns 200 (or 503 if degraded)
- [ ] All security headers present
- [ ] Rate limiting works (429 after threshold)
- [ ] OAuth bypass disabled in production
- [ ] HTTPS enforcement working (HTTP redirects to HTTPS)
- [ ] TLS 1.2+ supported

---

## Step 4: Monitor Audit Logs

### Purpose
Ensure token rotation, refresh, and authentication events are being logged correctly.

### 4.1 Verify Audit Logs Table

```sql
-- Check if audit_logs table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'audit_logs';

-- Check table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;
```

### 4.2 Check Recent Audit Events

```sql
-- Get recent audit events
SELECT 
    id,
    event_type,
    user_id,
    provider,
    ip_address,
    severity,
    created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 20;
```

### 4.3 Monitor Token Events

```sql
-- Check token rotation events
SELECT 
    id,
    event_type,
    user_id,
    provider,
    metadata->>'tokenId' AS token_id,
    metadata->>'reason' AS reason,
    severity,
    created_at
FROM audit_logs
WHERE event_type LIKE '%token%'
   OR event_type LIKE '%refresh%'
ORDER BY created_at DESC
LIMIT 50;
```

### 4.4 Monitor Authentication Events

```sql
-- Check authentication events
SELECT 
    id,
    event_type,
    user_id,
    ip_address,
    provider,
    severity,
    created_at
FROM audit_logs
WHERE event_type LIKE '%auth%'
ORDER BY created_at DESC
LIMIT 50;
```

### 4.5 Monitor Security Events

```sql
-- Check security incidents
SELECT 
    id,
    event_type,
    user_id,
    ip_address,
    metadata,
    severity,
    created_at
FROM audit_logs
WHERE event_type LIKE '%security%'
   OR severity IN ('high', 'critical')
ORDER BY created_at DESC
LIMIT 50;
```

### 4.6 Check for Failed Refresh Attempts

```sql
-- Check for multiple failed refresh attempts (alert condition)
SELECT 
    ip_address,
    COUNT(*) as failed_attempts,
    MAX(created_at) as last_attempt
FROM audit_logs
WHERE event_type = 'token_token_refresh_failed'
  AND created_at > NOW() - INTERVAL '15 minutes'
GROUP BY ip_address
HAVING COUNT(*) >= 5
ORDER BY failed_attempts DESC;
```

### 4.7 Verify Token Rotation

```sql
-- Check token rotation events
SELECT 
    event_type,
    user_id,
    provider,
    metadata->>'tokenId' AS token_id,
    created_at
FROM audit_logs
WHERE event_type = 'token_token_rotated'
ORDER BY created_at DESC
LIMIT 20;
```

### ✅ Verification Checklist
- [ ] `audit_logs` table exists and has data
- [ ] Token refresh events are logged
- [ ] Token rotation events are logged
- [ ] Authentication events are logged
- [ ] Security events are logged
- [ ] Failed refresh attempts trigger alerts (if threshold exceeded)
- [ ] IP addresses are logged
- [ ] User IDs are logged (when available)
- [ ] Severity levels are set correctly

---

## 🚀 Automated Testing Script

Use the provided script to test all production endpoints:

```powershell
# Test production endpoints
powershell -ExecutionPolicy Bypass -File scripts/test-security-endpoints.ps1 -BaseUrl "https://opside-node-api-woco.onrender.com" -Verbose
```

---

## 📊 Final Verification Checklist

### Step 1: Database Migration
- [ ] Migration executed successfully
- [ ] `audit_logs` table exists
- [ ] Table structure is correct
- [ ] Indexes created

### Step 2: Environment Variables
- [ ] All required variables set
- [ ] No placeholder values
- [ ] Application starts without errors
- [ ] Environment validation passes

### Step 3: Production Endpoints
- [ ] Health endpoints working
- [ ] Security headers present
- [ ] Rate limiting working
- [ ] OAuth bypass disabled
- [ ] HTTPS enforcement working
- [ ] TLS 1.2+ supported

### Step 4: Audit Logs
- [ ] Audit logs table has data
- [ ] Token events logged
- [ ] Authentication events logged
- [ ] Security events logged
- [ ] Alert triggers working

---

## 🎉 Completion

Once all 4 steps are completed:

✅ **Auth layer is fully hardened**  
✅ **Security features are tested**  
✅ **Production-ready for Phase 2**

---

## 📝 Notes

- All security code is already deployed (committed and pushed)
- Database migration must be run manually
- Environment variables must be set in your hosting platform
- Some tests require production environment access
- Monitor audit logs regularly for security events

---

**Status**: Ready for Production Deployment  
**Next Phase**: Phase 2 Implementation

