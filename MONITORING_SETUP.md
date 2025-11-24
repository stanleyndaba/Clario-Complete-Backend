# 📊 Clario Monitoring & Error Tracking Setup Guide

## Overview

This guide explains how to set up comprehensive monitoring and error tracking for the Clario platform.

---

## 🔴 1. Sentry Error Tracking (Recommended)

### Setup Steps

1. **Create Sentry Account**
   - Go to [sentry.io](https://sentry.io) and create a free account
   - Create a new project for "Node.js" (for the Node API)
   - Create another project for "Python" (for the Python API)

2. **Get DSN Keys**
   - In Sentry dashboard, go to Settings → Projects → [Your Project] → Client Keys (DSN)
   - Copy the DSN URL

3. **Set Environment Variables in Render**
   
   For **opside-node-api**:
   ```
   SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   APP_VERSION=1.0.0
   ```
   
   For **opside-python-api**:
   ```
   SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   ```

4. **Install Dependencies (if not already installed)**
   
   Node.js (optional - will work without):
   ```bash
   cd Integrations-backend
   npm install @sentry/node
   ```
   
   Python (optional - will work without):
   ```bash
   pip install sentry-sdk
   ```

### What Gets Tracked
- ✅ Unhandled exceptions (500 errors)
- ✅ SP-API errors (rate limits, token expiry)
- ✅ Database connection failures
- ✅ Network timeouts
- ❌ 4xx client errors (filtered out to reduce noise)
- ❌ Rate limit errors (filtered out)

---

## 🟢 2. Uptime Monitoring (UptimeRobot)

### Setup Steps

1. **Create Free Account**
   - Go to [uptimerobot.com](https://uptimerobot.com) and sign up (free tier: 50 monitors)

2. **Add Monitors**
   
   | Monitor Name | URL | Check Interval |
   |--------------|-----|----------------|
   | Clario Node API | `https://opside-node-api-woco.onrender.com/health` | 5 min |
   | Clario Python API | `https://python-api-7.onrender.com/health` | 5 min |
   | Clario Node API Detailed | `https://opside-node-api-woco.onrender.com/health/detailed` | 15 min |

3. **Configure Alerts**
   - Add email notifications for downtime
   - Optionally add Slack webhook for instant alerts

---

## 📈 3. Render Built-in Monitoring

Render provides built-in monitoring. To access:

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click on your service (opside-node-api or opside-python-api)
3. Go to "Metrics" tab

### Available Metrics
- Request count
- Response times (p50, p95, p99)
- Error rates
- Memory usage
- CPU usage

---

## 🔔 4. Slack Alerts (Optional)

### Setup Steps

1. **Create Slack Webhook**
   - Go to [api.slack.com/apps](https://api.slack.com/apps)
   - Create new app → "From scratch"
   - Add "Incoming Webhooks" feature
   - Create webhook for your alerts channel

2. **Set Environment Variable**
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/xxx/xxx
   ```

3. **Alert Channel Setup**
   - Create `#clario-alerts` channel in Slack
   - Configure alerts.json to send to this channel

---

## 🏥 5. Health Check Endpoints

### Available Endpoints

| Endpoint | Purpose | Response Time |
|----------|---------|---------------|
| `GET /health` | Basic liveness | <50ms |
| `GET /healthz` | Detailed with dependencies | <500ms |
| `GET /health/detailed` | Full system check | <1000ms |
| `GET /metrics` | Prometheus-style metrics | <200ms |
| `GET /ready` | Kubernetes readiness | <100ms |
| `GET /live` | Kubernetes liveness | <10ms |

### Health Check Response Example

```json
{
  "status": "healthy",
  "timestamp": "2024-11-24T10:30:00.000Z",
  "version": "1.0.0",
  "uptime": 86400,
  "checks": {
    "database": { "status": "pass", "responseTime": 45 },
    "redis": { "status": "warn", "message": "Redis not configured" },
    "pythonApi": { "status": "pass" },
    "memory": { "status": "pass", "message": "512MB / 1024MB" }
  }
}
```

---

## 📊 6. Custom Metrics

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total HTTP requests |
| `http_requests_5xx` | Counter | Server error requests |
| `http_requests_4xx` | Counter | Client error requests |
| `http_request_duration_ms` | Timing | Request latency |
| `spapi_rate_limit_count` | Counter | SP-API rate limits hit |
| `oauth_token_refresh_failures` | Counter | Token refresh failures |

### Accessing Metrics

```bash
curl https://opside-node-api-woco.onrender.com/metrics
```

---

## 🚨 7. Alert Configuration

Alerts are configured in `monitoring/alerts.json`. Key alerts:

| Alert | Severity | Trigger |
|-------|----------|---------|
| High Error Rate | Critical | >5% 5xx errors in 5 min |
| High API Latency | Warning | P95 > 5 seconds |
| Database Down | Critical | 3 consecutive failures |
| SP-API Rate Limited | Warning | >10 rate limits in 5 min |
| Memory Usage High | Warning | >85% memory |

---

## 📝 8. Environment Variables Summary

### Required for Monitoring

| Variable | Service | Description |
|----------|---------|-------------|
| `SENTRY_DSN` | Both | Sentry error tracking DSN |
| `APP_VERSION` | Node | Application version for Sentry |
| `SLACK_WEBHOOK_URL` | Node | Slack alerts webhook |
| `ALERT_EMAIL` | Both | Email for critical alerts |

### Set in Render Dashboard

1. Go to your service in Render
2. Click "Environment"
3. Add the variables above
4. Click "Save Changes" (service will restart)

---

## ✅ Quick Setup Checklist

- [ ] Create Sentry account and get DSN
- [ ] Add `SENTRY_DSN` to Render env vars (both services)
- [ ] Create UptimeRobot account
- [ ] Add health check monitors in UptimeRobot
- [ ] (Optional) Create Slack webhook and add to env vars
- [ ] Verify health endpoints are responding
- [ ] Test error tracking by triggering a test error

---

## 🧪 Testing Your Setup

### Test Sentry Integration

```bash
# Trigger a test error (Node API)
curl -X POST https://opside-node-api-woco.onrender.com/api/test-error

# Check Sentry dashboard for the error
```

### Test Health Checks

```bash
# Basic health
curl https://opside-node-api-woco.onrender.com/health

# Detailed health
curl https://opside-node-api-woco.onrender.com/health/detailed

# Metrics
curl https://opside-node-api-woco.onrender.com/metrics
```

### Test Uptime Monitor

- Take service offline temporarily
- Verify you receive downtime alert
- Bring service back online
- Verify you receive recovery alert

---

## 📞 Support

If you encounter issues with monitoring setup:

1. Check Render logs for errors
2. Verify environment variables are set correctly
3. Test health endpoints manually
4. Check Sentry dashboard for configuration errors

---

**Last Updated:** November 2024
**Version:** 1.0.0

