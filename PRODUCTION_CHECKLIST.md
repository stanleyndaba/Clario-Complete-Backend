# Production Deployment Checklist

## ✅ Quick Checklist

Use this checklist to track your progress through the 4 production deployment steps.

---

## Step 1: Database Migration

- [ ] **Migration File Located**
  - File: `Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql`
  - [ ] File exists and is readable

- [ ] **Migration Executed**
  - [ ] Supabase: Run in SQL Editor
  - [ ] PostgreSQL: Run via psql or script
  - [ ] Migration completed without errors

- [ ] **Table Verified**
  - [ ] `audit_logs` table exists
  - [ ] Table has correct columns
  - [ ] Indexes created successfully
  - [ ] Can insert test record

**SQL Verification:**
```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_logs';
SELECT COUNT(*) FROM audit_logs;
```

---

## Step 2: Environment Variables

- [ ] **Node.js Backend Variables Set**
  - [ ] `AMAZON_CLIENT_ID`
  - [ ] `AMAZON_CLIENT_SECRET`
  - [ ] `AMAZON_SPAPI_REFRESH_TOKEN`
  - [ ] `JWT_SECRET` (min 32 chars)
  - [ ] `DATABASE_URL`
  - [ ] `SUPABASE_URL` (if using Supabase)
  - [ ] `SUPABASE_ANON_KEY` (if using Supabase)
  - [ ] `FRONTEND_URL`
  - [ ] `NODE_ENV=production`
  - [ ] `ENV=production`

- [ ] **Python Backend Variables Set**
  - [ ] `AMAZON_CLIENT_ID`
  - [ ] `AMAZON_CLIENT_SECRET`
  - [ ] `AMAZON_SPAPI_REFRESH_TOKEN`
  - [ ] `JWT_SECRET` (min 32 chars)
  - [ ] `DATABASE_URL`
  - [ ] `FRONTEND_URL`
  - [ ] `ENV=production`

- [ ] **Validation Passed**
  - [ ] Application starts without errors
  - [ ] No "Environment validation failed" errors
  - [ ] Logs show "Environment validation passed"

**Test Command:**
```bash
curl https://your-api-url.com/healthz
# Check response: "environment": {"status": "ok"}
```

---

## Step 3: Production Endpoints

- [ ] **Health Endpoints**
  - [ ] `/health` returns 200
  - [ ] `/healthz` returns 200 (or 503 if degraded)
  - [ ] Response includes service info

- [ ] **Security Headers**
  - [ ] `Strict-Transport-Security` present
  - [ ] `X-Content-Type-Options: nosniff`
  - [ ] `X-Frame-Options: DENY`
  - [ ] `Content-Security-Policy` present
  - [ ] `Referrer-Policy` present
  - [ ] `X-XSS-Protection` present

- [ ] **Rate Limiting**
  - [ ] Rate limiting active on auth endpoints
  - [ ] Returns 429 after threshold
  - [ ] `Retry-After` header present

- [ ] **OAuth Bypass**
  - [ ] Bypass disabled in production
  - [ ] Full OAuth flow required
  - [ ] Logs show "Bypass disabled in production"

- [ ] **HTTPS Enforcement**
  - [ ] HTTP redirects to HTTPS
  - [ ] No HTTP access allowed

- [ ] **TLS Version**
  - [ ] TLS 1.2+ supported
  - [ ] No fallback to TLS < 1.2

**Test Commands:**
```bash
# Health
curl https://your-api-url.com/healthz

# Headers
curl -I https://your-api-url.com/health

# Rate limiting
for i in {1..10}; do curl https://your-api-url.com/api/v1/integrations/amazon/auth/start; done
```

---

## Step 4: Audit Logs

- [ ] **Table Accessible**
  - [ ] Can query `audit_logs` table
  - [ ] Table has data (or ready to receive data)

- [ ] **Token Events Logged**
  - [ ] Token refresh events logged
  - [ ] Token rotation events logged
  - [ ] Failed refresh attempts logged

- [ ] **Authentication Events Logged**
  - [ ] OAuth start events logged
  - [ ] OAuth callback events logged
  - [ ] Login/logout events logged

- [ ] **Security Events Logged**
  - [ ] Invalid redirect URI attempts logged
  - [ ] Invalid OAuth state attempts logged
  - [ ] Rate limit exceeded events logged
  - [ ] Security incidents logged

- [ ] **Data Quality**
  - [ ] IP addresses logged
  - [ ] User IDs logged (when available)
  - [ ] Severity levels set correctly
  - [ ] Timestamps accurate

**SQL Queries:**
```sql
-- Check recent events
SELECT event_type, COUNT(*) 
FROM audit_logs 
GROUP BY event_type 
ORDER BY COUNT(*) DESC;

-- Check token events
SELECT * FROM audit_logs 
WHERE event_type LIKE '%token%' 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 🎯 Final Verification

- [ ] **All 4 Steps Completed**
  - [ ] Step 1: Database migration ✅
  - [ ] Step 2: Environment variables ✅
  - [ ] Step 3: Production endpoints ✅
  - [ ] Step 4: Audit logs ✅

- [ ] **Documentation Reviewed**
  - [ ] `PRODUCTION_DEPLOYMENT_GUIDE.md` read
  - [ ] All verification steps understood

- [ ] **Ready for Phase 2**
  - [ ] Auth layer fully hardened
  - [ ] Security features tested
  - [ ] Production-ready confirmed

---

## 📝 Notes

- Use `scripts/test-production-deployment.ps1` for automated testing
- Review logs regularly for security events
- Monitor audit logs for suspicious activity
- Set up alerts for critical security events

---

**Status**: ⏳ In Progress  
**Completion Date**: _______________  
**Verified By**: _______________

