# 🚂 Railway Deployment Guide - Stripe Payments & Cost Documentation

## 🎯 Deployment Strategy

- **Frontend**: Vercel ✅ (already deployed)
- **5 Services**: Render ✅ (already deployed)
- **2 Missing Services**: Railway 🚂 (NEW - Stripe Payments + Cost Documentation)

---

## 📋 Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **GitHub Account**: Your repo is already connected
3. **Service Locations**:
   - Stripe Payments: `stripe-payments/` directory
   - Cost Documentation: `FBA Refund Predictor/cost-documentation-module/` directory

---

## 🚂 Part 1: Deploy Stripe Payments Service on Railway

### Step 1: Create New Project on Railway

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose repository: `stanleyndaba/Clario-Complete-Backend`

### Step 2: Create Service for Stripe Payments

1. In your Railway project, click **"New Service"**
2. Select **"GitHub Repo"** → Choose your repo
3. Configure Service:
   - **Name**: `opside-stripe-payments`
   - **Root Directory**: `stripe-payments`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Port**: Railway auto-detects (default 4000)

### Step 3: Add PostgreSQL Database

1. In Railway project, click **"New"** → **"Database"** → **"PostgreSQL"**
2. Railway creates database automatically
3. Copy the **Connection URL** (you'll need it)

### Step 4: Add Redis (for BullMQ)

**Option A: Railway Redis (Recommended)**
1. In Railway project, click **"New"** → **"Database"** → **"Redis"**
2. Railway creates Redis automatically
3. Copy the **Connection URL**

**Option B: External Redis (Upstash/Redis Cloud)**
- Sign up at [Upstash](https://upstash.com) (free tier available)
- Create Redis database
- Copy connection URL

### Step 5: Set Environment Variables

Click on `opside-stripe-payments` service → **"Variables"** tab → Add:

```env
# Database (from Railway PostgreSQL)
DATABASE_URL=${{Postgres.DATABASE_URL}}
# Or use the connection URL from Railway PostgreSQL service

# Redis (from Railway Redis or Upstash)
REDIS_URL=${{Redis.REDIS_URL}}
# Or use external Redis: redis://default:password@redis-host:6379

# Stripe Keys (from Stripe Dashboard)
STRIPE_SECRET_KEY=sk_live_...  # or sk_test_... for testing
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Internal API Key (for service-to-service auth)
STRIPE_INTERNAL_API_KEY=your-secret-api-key-here

# JWT Secret
JWT_SECRET=your-jwt-secret-key-here

# CORS - Add your frontend and orchestrator URLs
ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://clario-complete-backend-y5cd.onrender.com

# Port (Railway sets this automatically)
PORT=${{PORT}}
# Railway provides PORT env var automatically

# Node Environment
NODE_ENV=production
```

### Step 6: Deploy & Get URL

1. Railway automatically deploys on push to main branch
2. Or click **"Deploy"** button
3. Once deployed, Railway gives you a public URL like:
   - `https://opside-stripe-payments-production.up.railway.app`
4. **Copy this URL** - you'll need it for the orchestrator

### Step 7: Run Database Migrations

1. In Railway service, go to **"Deployments"** tab
2. Click on latest deployment
3. Go to **"Logs"** tab
4. Run migrations via Railway CLI or add to build:

**Option A: Add to package.json scripts**
```json
"deploy": "npx prisma migrate deploy && npm start"
```

**Option B: Railway CLI** (after installing Railway CLI)
```bash
railway run npx prisma migrate deploy
```

### Step 8: Register Stripe Webhooks

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Click **"Add endpoint"**
3. Endpoint URL: `https://your-stripe-service-url.railway.app/api/stripe/webhook`
4. Select events to listen to
5. Copy webhook signing secret → add to `STRIPE_WEBHOOK_SECRET` env var

---

## 🚂 Part 2: Deploy Cost Documentation Service on Railway

### Step 1: Create Second Service

1. In same Railway project, click **"New Service"**
2. Select **"GitHub Repo"** → Choose your repo
3. Configure:
   - **Name**: `opside-cost-documentation`
   - **Root Directory**: `FBA Refund Predictor/cost-documentation-module`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Port**: Railway auto-detects (default 3003)

### Step 2: Add PostgreSQL Database (or reuse existing)

**Option A: Separate Database (Recommended)**
- Create new PostgreSQL in Railway project
- Copy connection URL

**Option B: Shared Database**
- Use same PostgreSQL as Stripe service
- Use different schema or table prefix

### Step 3: Add Redis (or reuse existing)

- Use same Redis as Stripe service (if using Railway Redis)
- Or create separate Redis instance

### Step 4: Set Environment Variables

Click on `opside-cost-documentation` service → **"Variables"** tab:

```env
# Database
DATABASE_URL=${{Postgres.DATABASE_URL}}
# Or separate database URL if using separate DB

# AWS S3 (for PDF storage)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=opside-cost-documents

# MCDE Integration
MCDE_API_BASE_URL=https://clario-complete-backend-yjjr.onrender.com
MCDE_API_KEY=your-mcde-api-key

# Redis
REDIS_URL=${{Redis.REDIS_URL}}
# Or external Redis URL

# JWT
JWT_SECRET=your-jwt-secret-key-here

# CORS
ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://clario-complete-backend-y5cd.onrender.com

# Port
PORT=${{PORT}}

# Environment
NODE_ENV=production
```

### Step 5: Deploy & Get URL

1. Railway auto-deploys
2. Get public URL: `https://opside-cost-documentation-production.up.railway.app`
3. **Copy this URL** for orchestrator

### Step 6: Run Database Migrations

Same as Stripe service:
```bash
railway run npx prisma migrate deploy
```

---

## 🔗 Part 3: Update Orchestrator (on Render)

Now update your **Orchestrator** on Render to point to Railway services:

### Step 1: Go to Render Dashboard

1. Open your Orchestrator service: `clario-complete-backend-y5cd`
2. Go to **"Environment"** tab

### Step 2: Update Environment Variables

Add/Update these variables:

```env
# Update these to Railway URLs
STRIPE_SERVICE_URL=https://opside-stripe-payments-production.up.railway.app
COST_DOC_SERVICE_URL=https://opside-cost-documentation-production.up.railway.app

# Keep existing Render URLs
INTEGRATIONS_URL=https://clario-complete-backend-mvak.onrender.com
REFUND_ENGINE_URL=https://clarios-refund-engine.onrender.com
MCDE_URL=https://clario-complete-backend-yjjr.onrender.com
```

### Step 3: Save & Redeploy

1. Click **"Save Changes"**
2. Render automatically redeploys
3. Wait for deployment to complete

---

## ✅ Part 4: Verify Everything Works

### Test Railway Services

```bash
# Test Stripe Payments Service
curl https://opside-stripe-payments-production.up.railway.app/health

# Test Cost Documentation Service
curl https://opside-cost-documentation-production.up.railway.app/health
```

### Test Orchestrator Service Discovery

```bash
# Check orchestrator service status
curl https://clario-complete-backend-y5cd.onrender.com/api/services/status
```

Expected response should show all 7 services as healthy:
```json
{
  "status": "healthy",
  "services": {
    "healthy": 7,
    "total": 7,
    "status": {
      "integrations": { "is_healthy": true },
      "stripe": { "is_healthy": true },
      "cost-docs": { "is_healthy": true },
      "refund-engine": { "is_healthy": true },
      "mcde": { "is_healthy": true }
    }
  }
}
```

---

## 🎯 Final Architecture

```
Frontend (Vercel)
    ↓
Orchestrator (Render)
    ↓
├── Integrations Backend (Render)
├── Refund Engine (Render)
├── MCDE (Render)
├── Backend (Render)
├── Stripe Payments (Railway) ✅ NEW
└── Cost Documentation (Railway) ✅ NEW
```

---

## 💰 Railway Pricing

**Free Tier (Hobby Plan):**
- $5/month credit (covers light usage)
- 512MB RAM per service
- 1GB storage
- Perfect for MVP

**Pro Plan ($20/month):**
- More resources
- Better performance
- If you outgrow free tier

**Note**: PostgreSQL and Redis on Railway count toward usage, but free tier should handle MVP.

---

## 🚨 Important Notes

### 1. Railway Auto-Deploys
- Railway deploys on every push to main branch
- Or manually trigger from dashboard

### 2. Environment Variables
- Use Railway's `${{Service.ENV_VAR}}` syntax to reference other services
- Or use direct connection strings

### 3. Database Migrations
- Run migrations on first deploy
- Railway CLI: `railway run <command>`
- Or add to build/start scripts

### 4. CORS Configuration
- Make sure to add Railway URLs to CORS allowed origins
- Add frontend Vercel URL too

### 5. Service URLs
- Railway URLs format: `https://service-name-production.up.railway.app`
- URLs update on each deployment (use Railway's custom domains if needed)

### 6. Custom Domains (Optional)
- Railway allows custom domains
- Set up `stripe.opside.com` and `cost-docs.opside.com` if needed

---

## 🔧 Troubleshooting

### Service Won't Start
1. Check **Logs** tab in Railway dashboard
2. Verify environment variables are set
3. Check build command completed successfully

### Database Connection Issues
1. Verify `DATABASE_URL` is correct
2. Check PostgreSQL service is running
3. Verify migrations ran successfully

### Service Unreachable
1. Check service is deployed (green status)
2. Verify port is set correctly
3. Check health endpoint responds

### CORS Errors
1. Add Railway URL to `ALLOWED_ORIGINS`
2. Add frontend Vercel URL
3. Restart service after env var changes

---

## 📝 Checklist

### Stripe Payments Service
- [ ] Created Railway project
- [ ] Created Stripe service
- [ ] Added PostgreSQL database
- [ ] Added Redis
- [ ] Set all environment variables
- [ ] Deployed service
- [ ] Ran database migrations
- [ ] Tested health endpoint
- [ ] Registered Stripe webhooks
- [ ] Updated orchestrator URL

### Cost Documentation Service
- [ ] Created Cost Docs service
- [ ] Added PostgreSQL database (or reused)
- [ ] Added Redis (or reused)
- [ ] Set all environment variables
- [ ] Deployed service
- [ ] Ran database migrations
- [ ] Tested health endpoint
- [ ] Updated orchestrator URL

### Orchestrator
- [ ] Updated `STRIPE_SERVICE_URL`
- [ ] Updated `COST_DOC_SERVICE_URL`
- [ ] Redeployed orchestrator
- [ ] Verified service discovery works
- [ ] Tested end-to-end flow

---

## 🎉 You're Done!

Once both Railway services are deployed and orchestrator is updated, your MVP will be fully functional with:
- ✅ 5 services on Render
- ✅ 2 services on Railway
- ✅ Frontend on Vercel
- ✅ All 7 services communicating

**Total deployment time: ~1-2 hours**

