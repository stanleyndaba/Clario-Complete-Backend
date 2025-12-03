# ✅ Python API Sentry Setup Complete!

## What Was Done

1. ✅ Created `src/instrument.py` file (Sentry's recommended approach for Python)
2. ✅ Updated `src/app.py` to import instrument.py FIRST (before all other imports)
3. ✅ Added FastAPI integration for automatic error tracking
4. ✅ Added Logging integration for structured logs
5. ✅ Added SQLAlchemy integration for database query tracking
6. ✅ Added test endpoint `/health/test-sentry` to verify integration
7. ✅ Enhanced error filtering to reduce noise

## Your Sentry DSN

You'll need to create a **separate Sentry project** for Python API:

1. Go to [sentry.io](https://sentry.io) → Your organization
2. Click **Create Project**
3. Select **Python** as the platform
4. Name it "Clario Python API"
5. Copy the DSN (it will be different from the Node.js one)

## Next Steps

### 1. Create Python Project in Sentry

1. Go to [sentry.io](https://sentry.io)
2. Create a new project:
   - **Platform:** Python
   - **Name:** Clario Python API
3. Copy the DSN (will be different from Node.js DSN)

### 2. Add DSN to Render Environment Variables

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Select your **Python service** (opside-python-api or similar)
3. Go to **Environment** tab
4. Add these variables:

```
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
APP_VERSION=1.0.0
ENV=production
```

**Note:** Use the Python project DSN (not the Node.js one)

5. Click **Save Changes** (service will restart)

### 3. Deploy the Changes

The code is ready! Just commit and push:

```bash
git add .
git commit -m "Add Sentry error tracking for Python API"
git push
```

Render will automatically deploy the changes.

### 4. Test Sentry Integration

After deployment, test the integration:

```bash
# Test endpoint (only works in non-production)
curl https://your-python-api.onrender.com/health/test-sentry
```

**Note:** The test endpoint only works in development/staging. In production, errors will be automatically captured.

### 5. Verify in Sentry Dashboard

1. Go to [sentry.io](https://sentry.io) → Your Python project
2. Go to **Issues** tab
3. You should see the test error appear within seconds

## What Gets Tracked

✅ **Automatically Tracked:**
- Unhandled exceptions (500 errors)
- FastAPI request errors
- Database query errors (SQLAlchemy)
- Logged errors (ERROR level and above)
- Performance traces (10% sample rate in production)

❌ **Filtered Out (to reduce noise):**
- 4xx client errors (HTTPException with 400-499 status)
- Validation errors
- Rate limit errors

## Integrations Enabled

- ✅ **FastAPI Integration:** Automatic error tracking for FastAPI routes
- ✅ **Logging Integration:** Captures logs as breadcrumbs and errors as events
- ✅ **SQLAlchemy Integration:** Tracks database queries and errors

## Features

- ✅ **Error Tracking:** All unhandled exceptions
- ✅ **Logs:** Structured logs sent to Sentry (INFO+ as breadcrumbs, ERROR+ as events)
- ✅ **Tracing:** Performance monitoring (10% sample rate in production)
- ✅ **Request Context:** Automatic request/response context
- ✅ **Database Tracking:** SQLAlchemy query tracking

## Files Changed

- ✅ `src/instrument.py` - NEW: Sentry initialization with FastAPI integration
- ✅ `src/app.py` - Updated: Import instrument.py first, removed old initialize_sentry call
- ✅ `requirements.txt` - Already has sentry-sdk (added earlier)

## Troubleshooting

### Errors Not Appearing in Sentry

1. **Check DSN is set:**
   ```bash
   # In Render, verify SENTRY_DSN environment variable is set
   ```

2. **Check logs:**
   ```bash
   # In Render logs, look for:
   # [Sentry] Initialized successfully for Python API
   ```

3. **Verify package is installed:**
   ```bash
   pip list | grep sentry-sdk
   ```

4. **Check Python project in Sentry:**
   - Make sure you created a separate Python project (not using Node.js project)
   - Verify the DSN matches the Python project

### Test Endpoint Returns 403

The test endpoint is disabled in production for security. To test in production:
- Trigger a real error (e.g., invalid API call)
- Check Sentry dashboard for the error

### FastAPI Integration Not Working

If FastAPI integration isn't working:
1. Verify `sentry-sdk` version is recent (2.19.0+)
2. Check that `FastApiIntegration` is imported correctly
3. Verify Sentry is initialized before FastAPI app creation

## Comparison: Node.js vs Python Setup

| Feature | Node.js | Python |
|---------|---------|--------|
| Instrument File | `instrument.ts` | `instrument.py` |
| Integration | Manual setup | FastAPI integration |
| Logging | Manual | LoggingIntegration |
| Database | N/A | SQLAlchemyIntegration |
| Test Endpoint | `/health/test-sentry` | `/health/test-sentry` |

## Next: Complete Monitoring Setup

Now that both APIs have Sentry:
1. ✅ Node.js API - Sentry configured
2. ✅ Python API - Sentry configured
3. ⏭️ Set up UptimeRobot for uptime monitoring
4. ⏭️ Configure alerts

See `PRODUCTION_MONITORING_SETUP.md` for complete instructions.

---

**Status:** ✅ Python API Sentry integration complete and ready to deploy!

