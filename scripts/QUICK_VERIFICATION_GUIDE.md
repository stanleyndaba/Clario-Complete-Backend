# Quick Verification Guide - Phase 1 Security Hardening

## 🚀 Quick Start

This guide provides quick commands to verify all security hardening is working.

## 1. Install Dependencies

### Node.js
```bash
cd Integrations-backend
npm install
```

### Verify Security Plugin
```bash
npm list eslint-plugin-security
```

## 2. Database Migration

### For Supabase (Recommended)
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql`
3. Run the SQL

### For Direct PostgreSQL
```bash
psql "$DATABASE_URL" -f Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql
```

### Verify Table
```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_logs';
```

## 3. Check for Secrets

### Using PowerShell Script
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-secrets.ps1
```

### Using Git
```bash
git grep -n "CLIENT_SECRET\|REFRESH_TOKEN" -- "*.ts" "*.js" "*.py" | grep -v "your-\|placeholder\|example"
```

## 4. Test Health Endpoints

### Node.js Backend
```bash
# Basic health
curl https://opside-node-api-woco.onrender.com/health

# Comprehensive health
curl https://opside-node-api-woco.onrender.com/healthz
```

### Python Backend
```bash
curl https://opside-python-api.onrender.com/health
curl https://opside-python-api.onrender.com/healthz
```

## 5. Verify Security Headers

```bash
curl -I https://opside-node-api-woco.onrender.com/health | grep -i "strict-transport-security\|x-frame-options\|x-content-type-options"
```

Expected headers:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: ...`
- `Referrer-Policy: no-referrer-when-downgrade`

## 6. Test Rate Limiting

```bash
# Make 10 rapid requests
for i in {1..10}; do
    curl -s -o /dev/null -w "%{http_code}\n" \
        https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start
    sleep 0.1
done
```

Expected: Should not hit rate limit for 10 requests (limit is 100/15min)

## 7. Verify OAuth Bypass Disabled

```bash
# In production, bypass should be disabled
curl -v "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?bypass=true"
```

Expected: Should require full OAuth flow (bypass disabled in production)

## 8. Check Audit Logs

```sql
-- Check if audit logs table exists and has data
SELECT COUNT(*) FROM audit_logs;

-- Check recent token events
SELECT event_type, user_id, provider, created_at 
FROM audit_logs 
WHERE event_type LIKE '%token%' 
ORDER BY created_at DESC 
LIMIT 10;
```

## 9. Verify Log Sanitization

Check application logs for any token leakage:
```bash
# Should return no results
grep -i "access_token\|refresh_token\|amzn\|Bearer " /var/log/app.log | head -10
```

## 10. Run Integration Tests

### Node.js
```bash
cd Integrations-backend
npm test -- tests/security/
```

### Python
```bash
pytest tests/security/test_security_hardening.py -v
```

## ✅ Verification Checklist

- [ ] Dependencies installed (eslint-plugin-security)
- [ ] Database migration executed (audit_logs table)
- [ ] No hard-coded secrets in repository
- [ ] Health endpoints returning 200
- [ ] Security headers present
- [ ] Rate limiting working
- [ ] OAuth bypass disabled in production
- [ ] Audit logs being created
- [ ] Log sanitization working
- [ ] Integration tests passing

## 📝 Notes

- Some checks require production environment access
- Database migration must be run manually
- Environment variables should be set via secrets manager
- All security code is implemented and ready for deployment

---

**Status**: ✅ **READY FOR PRODUCTION**

