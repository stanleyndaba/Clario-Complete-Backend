# Quick Start - Production Deployment

## 🚀 Complete Phase 1 in 4 Steps

### Step 1: Run Database Migration

**Option A: Supabase (Recommended)**
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of: `Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql`
3. Paste and click **Run**

**Option B: PowerShell Script**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-db-migration.ps1 -DatabaseUrl "your-database-url" -Verify
```

**Option C: PostgreSQL CLI**
```bash
psql "$DATABASE_URL" -f Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql
```

**Verify:**
```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_logs';
```

---

### Step 2: Set Environment Variables

**In Render/Vercel/Your Platform:**
- `AMAZON_CLIENT_ID`
- `AMAZON_CLIENT_SECRET`
- `AMAZON_SPAPI_REFRESH_TOKEN`
- `JWT_SECRET` (min 32 chars)
- `DATABASE_URL`
- `FRONTEND_URL`
- `NODE_ENV=production`

**Verify:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-env-vars.ps1 -ApiUrl "https://your-api-url.com"
```

---

### Step 3: Test Production Endpoints

**Automated Test:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-production-deployment.ps1 -NodeApiUrl "https://your-api-url.com"
```

**Manual Tests:**
```bash
# Health check
curl https://your-api-url.com/healthz

# Security headers
curl -I https://your-api-url.com/health

# Rate limiting (make 10 rapid requests)
for i in {1..10}; do curl https://your-api-url.com/api/v1/integrations/amazon/auth/start; done
```

---

### Step 4: Monitor Audit Logs

**Run SQL Queries:**
```sql
-- Check table exists
SELECT COUNT(*) FROM audit_logs;

-- Check recent events
SELECT event_type, COUNT(*) 
FROM audit_logs 
GROUP BY event_type;

-- Check token events
SELECT * FROM audit_logs 
WHERE event_type LIKE '%token%' 
ORDER BY created_at DESC 
LIMIT 10;
```

**Full queries:** See `scripts/check-audit-logs.sql`

---

## 🎯 Complete All Steps at Once

```powershell
powershell -ExecutionPolicy Bypass -File scripts/complete-phase1-deployment.ps1 `
    -NodeApiUrl "https://opside-node-api-woco.onrender.com" `
    -DatabaseUrl "your-database-url" `
    -Verbose
```

---

## ✅ Success Criteria

- [ ] Database migration executed
- [ ] Environment variables set and validated
- [ ] Health endpoints return 200
- [ ] Security headers present
- [ ] Rate limiting works
- [ ] OAuth bypass disabled
- [ ] Audit logs table has data
- [ ] Token events are logged

---

**Once complete:** ✅ Ready for Phase 2!

