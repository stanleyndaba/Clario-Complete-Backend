# 🚀 Render Deployment - Step-by-Step Guide

## ⏱️ Time Estimate

**Total Time: 15-30 minutes** (depending on build times)

- **Setup & Configuration**: 5-10 minutes
- **Deployment**: 10-20 minutes (build time varies)
- **Verification**: 5 minutes

---

## 📋 Prerequisites

Before starting, make sure you have:
- ✅ GitHub repository with your code pushed
- ✅ Render account (free tier is fine)
- ✅ Environment variables ready (database URLs, API keys, etc.)

---

## 🎯 Step 1: Deploy Python Service (opside-python-api)

**Time: 5-10 minutes**

### Option A: Using render.yaml (Recommended - Fastest)

1. **Go to Render Dashboard**
   - Visit: https://dashboard.render.com
   - Click **"New"** → **"Blueprint"**

2. **Connect Repository**
   - Connect your GitHub repository
   - Render will detect `render.yaml`
   - Click **"Apply"** to deploy both services automatically

3. **Skip to Step 3** (both services deploy together)

### Option B: Manual Deployment (Step-by-Step)

1. **Create New Web Service**
   - Go to https://dashboard.render.com
   - Click **"New"** → **"Web Service"**
   - Connect your GitHub repository

2. **Configure Service**
   - **Name**: `opside-python-api`
   - **Region**: Choose closest to you (e.g., `Oregon (US West)`)
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: Leave empty (root of repo)
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements-consolidated.txt`
   - **Start Command**: `uvicorn src.app:app --host 0.0.0.0 --port $PORT`
   - **Plan**: `Free` (or upgrade if needed)

3. **Set Environment Variables**
   Click **"Advanced"** → **"Environment Variables"**, add:
   ```
   DATABASE_URL=<your-postgres-url>
   REDIS_URL=<your-redis-url>
   JWT_SECRET=<your-secret>
   FRONTEND_URL=<your-frontend-url>
   CORS_ALLOW_ORIGINS=<your-cors-origins>
   SUPABASE_URL=<your-supabase-url>
   SUPABASE_KEY=<your-supabase-key>
   STRIPE_SECRET_KEY=<your-stripe-key>
   AMAZON_CLIENT_ID=<your-amazon-client-id>
   AMAZON_CLIENT_SECRET=<your-amazon-client-secret>
   AMAZON_SPAPI_REFRESH_TOKEN=<your-refresh-token>
   AMAZON_MARKETPLACE_ID=<your-marketplace-id>
   AWS_ACCESS_KEY_ID=<your-aws-key>
   AWS_SECRET_ACCESS_KEY=<your-aws-secret>
   AWS_REGION=<your-aws-region>
   S3_BUCKET_NAME=<your-s3-bucket>
   ```

4. **Deploy**
   - Click **"Create Web Service"**
   - Wait for build to complete (~5-10 minutes)
   - Service will be available at: `https://opside-python-api.onrender.com`

---

## 🎯 Step 2: Deploy Node.js Service (opside-node-api)

**Time: 5-10 minutes** (if deploying manually)

1. **Create New Web Service**
   - Go to https://dashboard.render.com
   - Click **"New"** → **"Web Service"**
   - Connect your GitHub repository (same repo)

2. **Configure Service**
   - **Name**: `opside-node-api`
   - **Region**: Same as Python service
   - **Branch**: `main`
   - **Root Directory**: `Integrations-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

3. **Set Environment Variables**
   Same as Python service, plus:
   ```
   STRIPE_WEBHOOK_SECRET=<your-webhook-secret>
   AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
   ```

4. **Deploy**
   - Click **"Create Web Service"**
   - Wait for build to complete (~5-10 minutes)
   - Service will be available at: `https://opside-node-api.onrender.com`

---

## ✅ Step 3: Verify Deployment

**Time: 5 minutes**

### Test Python API

```bash
# Health check
curl https://opside-python-api.onrender.com/health

# MCDE service
curl https://opside-python-api.onrender.com/api/v1/mcde/health

# Claim Detector
curl https://opside-python-api.onrender.com/api/v1/claim-detector/health

# Evidence Engine
curl https://opside-python-api.onrender.com/api/v1/evidence-engine/health

# Test Service
curl https://opside-python-api.onrender.com/api/v1/tests/health
```

### Test Node.js API

```bash
# Health check
curl https://opside-node-api.onrender.com/health

# Service status
curl https://opside-node-api.onrender.com/api/status
```

---

## 🔍 What to Expect During Deployment

### Build Process (5-10 minutes each service)

1. **Cloning** (30 seconds)
   - Render clones your repository

2. **Installing Dependencies** (3-5 minutes)
   - Python: Installing packages from `requirements-consolidated.txt`
   - Node.js: Running `npm install`

3. **Building** (1-2 minutes)
   - TypeScript compilation (Node.js)
   - Code preparation

4. **Starting** (30 seconds)
   - Service starts and health check runs

### Common Issues & Solutions

**Issue: Build fails with "Module not found"**
- **Solution**: Check that all dependencies are in `requirements-consolidated.txt` or `package.json`

**Issue: Service starts then crashes**
- **Solution**: Check logs in Render dashboard → "Logs" tab
- Common causes: Missing environment variables, database connection issues

**Issue: Health check fails**
- **Solution**: Verify `/health` endpoint exists and returns proper response

---

## 📊 Deployment Timeline

```
┌─────────────────────────────────────────────────┐
│ Setup & Configuration         5-10 minutes      │
├─────────────────────────────────────────────────┤
│ Python Service Build         5-10 minutes      │
├─────────────────────────────────────────────────┤
│ Node.js Service Build         5-10 minutes      │
├─────────────────────────────────────────────────┤
│ Verification                  5 minutes         │
└─────────────────────────────────────────────────┘
Total: 20-35 minutes (first time)
      15-25 minutes (with render.yaml)
```

---

## 🚀 Quick Start (Fastest Method)

**If you want the fastest deployment:**

1. **Push your code to GitHub** (if not already)
   ```bash
   git add .
   git commit -m "Consolidated services for Render deployment"
   git push origin main
   ```

2. **Deploy via Blueprint**
   - Go to Render → New → Blueprint
   - Connect repository
   - Click "Apply"
   - **Both services deploy automatically** ✅

3. **Set Environment Variables**
   - Go to each service's "Environment" tab
   - Add all required variables
   - Services will restart automatically

4. **Verify**
   - Test health endpoints
   - Check logs for errors

---

## 📝 After Deployment Checklist

- [ ] Both services show "Live" status
- [ ] Health checks return 200 OK
- [ ] No errors in logs
- [ ] Environment variables set correctly
- [ ] Frontend can connect to APIs
- [ ] CORS configured properly

---

## 🔄 Updating Services

When you make changes:

1. **Push to GitHub**
   ```bash
   git push origin main
   ```

2. **Render Auto-Deploys**
   - Render detects the push
   - Automatically starts a new build
   - Takes 5-10 minutes

3. **Manual Deploy** (if auto-deploy disabled)
   - Go to service dashboard
   - Click "Manual Deploy" → "Deploy latest commit"

---

## 💡 Pro Tips

1. **Use Blueprint** - Deploys both services at once
2. **Monitor Logs** - Check Render logs tab for real-time status
3. **Start with Free Tier** - Upgrade later if needed
4. **Test Locally First** - Run `uvicorn src.app:app` and `npm start` locally before deploying
5. **Keep Environment Variables in Sync** - Both services need same database/Redis URLs

---

## 🆘 Need Help?

If deployment fails:
1. Check Render logs (most helpful)
2. Verify environment variables are set
3. Test locally first
4. Check `render.yaml` syntax if using Blueprint

---

## ⏱️ Summary

- **Fastest**: Blueprint deployment (15-20 minutes total)
- **Manual**: Step-by-step (20-35 minutes total)
- **First Build**: Slower (10-15 min per service)
- **Subsequent Builds**: Faster (5-8 min per service)

**You're ready to deploy!** 🚀

