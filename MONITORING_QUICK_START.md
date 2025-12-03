# 🚀 Monitoring Quick Start

**5-Minute Setup Guide**

---

## ✅ What's Already Done

- ✅ Sentry packages installed (`@sentry/node` and `sentry-sdk`)
- ✅ Health check endpoints implemented
- ✅ Metrics endpoint available
- ✅ Error tracking code in place

---

## 🔴 What You Need to Do (15 minutes)

### 1. Set Up Sentry (5 min)

1. Go to [sentry.io](https://sentry.io) → Sign up (free)
2. Create 2 projects:
   - "Clario Node API" (Node.js)
   - "Clario Python API" (Python)
3. Copy DSN keys from each project
4. In Render → Add environment variables:
   ```
   SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   APP_VERSION=1.0.0
   ```

### 2. Set Up UptimeRobot (5 min)

1. Go to [uptimerobot.com](https://uptimerobot.com) → Sign up (free)
2. Add 4 monitors:
   - Node API: `https://your-node-api.onrender.com/health` (5 min)
   - Node API Detailed: `https://your-node-api.onrender.com/health/detailed` (15 min)
   - Python API: `https://your-python-api.onrender.com/health` (5 min)
   - Python API Detailed: `https://your-python-api.onrender.com/healthz` (15 min)
3. Add your email for alerts

### 3. Test It (5 min)

```bash
# Test health endpoints
curl https://your-node-api.onrender.com/health
curl https://your-python-api.onrender.com/health

# Check Sentry dashboard for errors
# Check UptimeRobot for uptime status
```

---

## 📊 Available Endpoints

### Node API
- `GET /health` - Basic health
- `GET /health/detailed` - Full system check
- `GET /metrics` - Application metrics

### Python API
- `GET /health` - Basic health
- `GET /healthz` - Comprehensive check

---

## ✅ Verification Checklist

- [ ] Sentry DSN added to Render
- [ ] UptimeRobot monitors created
- [ ] Health endpoints return 200 OK
- [ ] Errors appear in Sentry (test with a real error)
- [ ] Alerts work (test by stopping service)

---

## 📚 Full Documentation

See `PRODUCTION_MONITORING_SETUP.md` for complete guide.

---

**That's it! You're now monitoring production.** 🎉

