# 🚀 Production Monitoring Setup - Complete Guide

**Status:** Ready to Deploy  
**Time Required:** 15-30 minutes  
**Last Updated:** 2025-01-27

---

## 📋 Overview

This guide will help you set up comprehensive production monitoring for Clario, including:
- ✅ Error tracking with Sentry
- ✅ Uptime monitoring with UptimeRobot
- ✅ Health check endpoints
- ✅ Metrics collection
- ✅ Alert notifications

---

## 🔴 Step 1: Install Dependencies

### Node.js Backend

```bash
cd Integrations-backend
npm install
```

The `@sentry/node` package is now included in `package.json`.

### Python Backend

```bash
pip install -r requirements.txt
```

The `sentry-sdk` package is now included in `requirements.txt`.

---

## 🔴 Step 2: Set Up Sentry Error Tracking

### 2.1 Create Sentry Account

1. Go to [sentry.io](https://sentry.io) and sign up (free tier available)
2. Create a new organization (or use existing)
3. Create **TWO projects**:
   - **Project 1:** "Clario Node API" (select "Node.js" as platform)
   - **Project 2:** "Clario Python API" (select "Python" as platform)

### 2.2 Get DSN Keys

For each project:
1. Go to **Settings → Projects → [Your Project] → Client Keys (DSN)**
2. Copy the DSN URL (looks like: `https://xxx@xxx.ingest.sentry.io/xxx`)

### 2.3 Set Environment Variables in Render

#### For Node.js Service (opside-node-api):

1. Go to Render Dashboard → Your Node Service → Environment
2. Add these variables:

```
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
APP_VERSION=1.0.0
NODE_ENV=production
```

#### For Python Service (opside-python-api):

1. Go to Render Dashboard → Your Python Service → Environment
2. Add this variable:

```
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

**Note:** Replace `xxx` with your actual DSN values from Sentry.

### 2.4 Verify Sentry Integration

After deploying, check your services are sending errors to Sentry:

1. **Test Node API:**
   ```bash
   curl -X POST https://your-node-api.onrender.com/api/test-error
   ```
   (This endpoint may not exist - errors will be captured automatically)

2. **Check Sentry Dashboard:**
   - Go to your Sentry project
   - You should see errors appear in real-time
   - If nothing appears, check Render logs for Sentry initialization messages

---

## 🟢 Step 3: Set Up Uptime Monitoring (UptimeRobot)

### 3.1 Create UptimeRobot Account

1. Go to [uptimerobot.com](https://uptimerobot.com) and sign up (free tier: 50 monitors)
2. Verify your email

### 3.2 Add Monitors

Create monitors for each service:

#### Monitor 1: Node API Health Check
- **Monitor Type:** HTTP(s)
- **Friendly Name:** Clario Node API
- **URL:** `https://your-node-api.onrender.com/health`
- **Monitoring Interval:** 5 minutes
- **Alert Contacts:** Add your email

#### Monitor 2: Node API Detailed Health
- **Monitor Type:** HTTP(s)
- **Friendly Name:** Clario Node API (Detailed)
- **URL:** `https://your-node-api.onrender.com/health/detailed`
- **Monitoring Interval:** 15 minutes
- **Alert Contacts:** Add your email

#### Monitor 3: Python API Health Check
- **Monitor Type:** HTTP(s)
- **Friendly Name:** Clario Python API
- **URL:** `https://your-python-api.onrender.com/health`
- **Monitoring Interval:** 5 minutes
- **Alert Contacts:** Add your email

#### Monitor 4: Python API Detailed Health
- **Monitor Type:** HTTP(s)
- **Friendly Name:** Clario Python API (Detailed)
- **URL:** `https://your-python-api.onrender.com/healthz`
- **Monitoring Interval:** 15 minutes
- **Alert Contacts:** Add your email

### 3.3 Configure Alert Settings

1. Go to **My Settings → Alert Contacts**
2. Add your email address
3. Set alert preferences:
   - **Alert When:** Down
   - **Alert Frequency:** Every time (or once per hour to reduce noise)

---

## 📊 Step 4: Available Health Check Endpoints

### Node.js API Endpoints

| Endpoint | Purpose | Response Time |
|----------|---------|---------------|
| `GET /health` | Basic liveness check | <50ms |
| `GET /healthz` | Comprehensive health (DB + API keys) | <500ms |
| `GET /health/detailed` | Full system check with dependencies | <1000ms |
| `GET /metrics` | Prometheus-style metrics | <200ms |
| `GET /ready` | Kubernetes readiness probe | <100ms |
| `GET /live` | Kubernetes liveness probe | <10ms |

### Python API Endpoints

| Endpoint | Purpose | Response Time |
|----------|---------|---------------|
| `GET /health` | Basic liveness check | <50ms |
| `GET /healthz` | Comprehensive health (DB + env vars) | <500ms |

### Test Health Endpoints

```bash
# Node API
curl https://your-node-api.onrender.com/health
curl https://your-node-api.onrender.com/health/detailed
curl https://your-node-api.onrender.com/metrics

# Python API
curl https://your-python-api.onrender.com/health
curl https://your-python-api.onrender.com/healthz
```

---

## 📈 Step 5: Access Metrics

### Render Built-in Metrics

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click on your service
3. Go to **Metrics** tab

**Available Metrics:**
- Request count
- Response times (p50, p95, p99)
- Error rates
- Memory usage
- CPU usage

### Custom Metrics Endpoint

Access custom application metrics:

```bash
curl https://your-node-api.onrender.com/metrics
```

**Response includes:**
- HTTP request metrics (counters, timings)
- System metrics (uptime, memory, CPU)
- Health check status
- Custom application metrics

---

## 🔔 Step 6: Optional - Slack Alerts

### 6.1 Create Slack Webhook

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create new app → "From scratch"
3. Name it "Clario Alerts"
4. Add "Incoming Webhooks" feature
5. Create webhook for your alerts channel (e.g., `#clario-alerts`)
6. Copy the webhook URL

### 6.2 Set Environment Variable

In Render (Node service), add:

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/xxx/xxx
```

**Note:** The code already supports Slack webhooks, but you'll need to add custom alerting logic if you want to use it.

---

## ✅ Step 7: Verification Checklist

After setup, verify everything works:

- [ ] **Sentry:**
  - [ ] Node API errors appear in Sentry dashboard
  - [ ] Python API errors appear in Sentry dashboard
  - [ ] Error context (user, request path) is captured

- [ ] **UptimeRobot:**
  - [ ] All monitors show "Up" status
  - [ ] Test alert by temporarily stopping a service
  - [ ] Receive email alert when service goes down
  - [ ] Receive recovery alert when service comes back

- [ ] **Health Endpoints:**
  - [ ] `/health` returns 200 OK
  - [ ] `/health/detailed` shows all checks passing
  - [ ] `/metrics` returns metrics data

- [ ] **Render Metrics:**
  - [ ] Can view metrics in Render dashboard
  - [ ] Response times are reasonable (<2s for most endpoints)
  - [ ] Error rates are low (<1%)

---

## 🧪 Step 8: Test Error Tracking

### Test Node API Error Tracking

1. Trigger a test error (if you have a test endpoint):
   ```bash
   curl -X POST https://your-node-api.onrender.com/api/test-error
   ```

2. Or check Render logs for real errors

3. Verify in Sentry:
   - Go to Sentry dashboard
   - Check "Issues" tab
   - You should see errors with stack traces

### Test Python API Error Tracking

1. Check Python API logs in Render
2. Any unhandled exceptions will automatically be sent to Sentry
3. Verify in Sentry dashboard

---

## 📝 Step 9: What Gets Tracked

### Sentry Tracks:
- ✅ Unhandled exceptions (500 errors)
- ✅ SP-API errors (rate limits, token expiry)
- ✅ Database connection failures
- ✅ Network timeouts
- ✅ Python API errors
- ✅ Node API errors

### Sentry Filters Out (to reduce noise):
- ❌ 4xx client errors (filtered out)
- ❌ Rate limit errors (filtered out)
- ❌ Validation errors (filtered out)

---

## 🚨 Step 10: Alert Configuration

### Critical Alerts (Set Up in UptimeRobot)

| Alert | Trigger | Action |
|-------|---------|--------|
| Service Down | Service unreachable for 1 minute | Email + Slack (if configured) |
| High Error Rate | >5% 5xx errors in 5 minutes | Email alert |
| High Latency | P95 > 5 seconds | Email alert |
| Database Down | 3 consecutive health check failures | Email alert |

### Sentry Alerts (Configure in Sentry Dashboard)

1. Go to **Alerts → Create Alert Rule**
2. Set up alerts for:
   - **New Issues:** Alert when new error type appears
   - **Error Rate Spike:** Alert when errors increase significantly
   - **Critical Errors:** Alert on specific error types

---

## 📊 Monitoring Best Practices

### Daily Checks:
- [ ] Review Sentry dashboard for new errors
- [ ] Check UptimeRobot for any downtime incidents
- [ ] Review Render metrics for performance issues

### Weekly Reviews:
- [ ] Analyze error trends in Sentry
- [ ] Review slow endpoints (from metrics)
- [ ] Check memory/CPU usage trends
- [ ] Review alert frequency (adjust if too noisy)

### Monthly Reviews:
- [ ] Review error resolution rate
- [ ] Analyze performance trends
- [ ] Optimize based on metrics
- [ ] Update alert thresholds if needed

---

## 🔧 Troubleshooting

### Sentry Not Working

**Problem:** Errors not appearing in Sentry

**Solutions:**
1. Check `SENTRY_DSN` is set correctly in Render
2. Check Render logs for Sentry initialization messages
3. Verify `@sentry/node` is installed (check `package.json`)
4. Verify `sentry-sdk` is installed (check `requirements.txt`)
5. Check Sentry project settings (make sure project is active)

### UptimeRobot Not Alerting

**Problem:** Not receiving alerts when service goes down

**Solutions:**
1. Check alert contacts are configured
2. Verify email address is correct
3. Check spam folder
4. Verify monitor is set to "Alert When: Down"
5. Check monitor status in UptimeRobot dashboard

### Health Checks Failing

**Problem:** Health endpoints return 503

**Solutions:**
1. Check `/health/detailed` for specific failing checks
2. Verify database connection (check `DATABASE_URL`)
3. Check environment variables are set
4. Review Render logs for errors
5. Check service dependencies (Redis, Python API, etc.)

---

## 📚 Additional Resources

- [Sentry Documentation](https://docs.sentry.io/)
- [UptimeRobot Documentation](https://uptimerobot.com/api/)
- [Render Metrics Documentation](https://render.com/docs/metrics)
- [Health Check Best Practices](https://microservices.io/patterns/observability/health-check-api.html)

---

## 🎯 Quick Setup Summary

1. ✅ Install dependencies (`npm install` and `pip install`)
2. ✅ Create Sentry account and projects
3. ✅ Add `SENTRY_DSN` to Render environment variables
4. ✅ Create UptimeRobot account
5. ✅ Add monitors for health endpoints
6. ✅ Test error tracking and alerts
7. ✅ Verify everything works

**Total Time:** 15-30 minutes

---

## ✅ Success Criteria

You'll know monitoring is set up correctly when:

1. ✅ Errors appear in Sentry within seconds
2. ✅ UptimeRobot shows all services as "Up"
3. ✅ Health endpoints return 200 OK
4. ✅ You receive alerts when services go down
5. ✅ Metrics are visible in Render dashboard

---

**Last Updated:** 2025-01-27  
**Maintained By:** Clario Development Team

