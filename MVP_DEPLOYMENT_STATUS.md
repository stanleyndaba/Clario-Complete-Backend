# 🚀 MVP Deployment Status & Missing Services Guide

## 📊 Current Deployment Status

### ✅ **Deployed Services (5/7)**

| Service | Render URL | Status | Purpose |
|---------|-----------|--------|---------|
| **MCDE** | https://clario-complete-backend-yjjr.onrender.com | ✅ Live | Evidence validation & cost modeling |
| **Backend** | https://clario-complete-backend.onrender.com | ✅ Live | Core backend API |
| **Orchestrator** | https://clario-complete-backend-y5cd.onrender.com | ✅ Live | Main FastAPI orchestrator |
| **Refund Engine** | https://clarios-refund-engine.onrender.com | ✅ Live | Claims management & ML detection |
| **Integrations Backend** | https://clario-complete-backend-mvak.onrender.com | ✅ Live | Amazon SP-API, Gmail, Stripe OAuth |

---

## ❌ **Missing Services (2/7) - CRITICAL FOR MVP**

### 1. **Stripe Payments Service** 🚨
- **Location**: `stripe-payments/` directory
- **Purpose**: Payment processing, 20% commission charging, payouts
- **Required for**: 
  - Charging users 20% commission on recovered funds
  - Processing seller payouts
  - Stripe webhook handling
  - Transaction logging
- **Impact**: **HIGH** - Users cannot be charged, no revenue generation

### 2. **Cost Documentation Service** 🚨
- **Location**: `FBA Refund Predictor/cost-documentation-module/` directory
- **Purpose**: PDF generation, document management, evidence packaging
- **Required for**:
  - Generating cost documentation PDFs from evidence
  - Document storage and retrieval
  - Evidence packaging for claims
  - S3 integration for file management
- **Impact**: **HIGH** - Cannot generate claim documents, evidence cannot be packaged

---

## 🔧 Deployment Instructions for Missing Services

### **Deploy Service #1: Stripe Payments Service**

#### Step 1: Prepare the Service
```bash
cd stripe-payments
npm install
npm run build
```

#### Step 2: Create Render Web Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository: `stanleyndaba/Clario-Complete-Backend`
4. Configure:
   - **Name**: `opside-stripe-payments`
   - **Root Directory**: `stripe-payments`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`

#### Step 3: Set Environment Variables
```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/stripe_db

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Redis (for BullMQ queues)
REDIS_URL=redis://host:6379

# Internal API Key (for service-to-service auth)
STRIPE_INTERNAL_API_KEY=your-secret-api-key

# JWT
JWT_SECRET=your-jwt-secret-key

# CORS
ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://clario-complete-backend-y5cd.onrender.com

# Port
PORT=4000
```

#### Step 4: Database Setup
- Create a PostgreSQL database on Render
- Run migrations: `npx prisma migrate deploy`
- Generate Prisma client: `npx prisma generate`

#### Step 5: Register Webhook Endpoint
After deployment, register Stripe webhooks:
```bash
# Update webhook URL in scripts/registerStripeWebhooks.ts
npm run webhook:register
```

---

### **Deploy Service #2: Cost Documentation Service**

#### Step 1: Prepare the Service
```bash
cd "FBA Refund Predictor/cost-documentation-module"
npm install
npm run build
```

#### Step 2: Create Render Web Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository: `stanleyndaba/Clario-Complete-Backend`
4. Configure:
   - **Name**: `opside-cost-documentation`
   - **Root Directory**: `FBA Refund Predictor/cost-documentation-module`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`

#### Step 3: Set Environment Variables
```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/cost_docs_db

# AWS S3 (for PDF storage)
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
AWS_REGION=us-east-1
S3_BUCKET_NAME=opside-cost-documents

# MCDE Integration
MCDE_API_BASE_URL=https://clario-complete-backend-yjjr.onrender.com
MCDE_API_KEY=your-mcde-api-key

# Redis (for Bull queues)
REDIS_URL=redis://host:6379

# JWT
JWT_SECRET=your-jwt-secret-key

# CORS
ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://clario-complete-backend-y5cd.onrender.com

# Port
PORT=3003
NODE_ENV=production
```

#### Step 4: Database Setup
- Create a PostgreSQL database on Render
- Run migrations: `npx prisma migrate deploy`
- Generate Prisma client: `npx prisma generate`

#### Step 5: Configure Redis (Optional but Recommended)
- Create a Redis instance on Render or use external Redis (Redis Cloud, Upstash)
- Set `REDIS_URL` environment variable

---

## 🔗 **Update Orchestrator Configuration**

After deploying the 2 missing services, update the **Orchestrator** environment variables:

### On Render Dashboard → Orchestrator Service → Environment:
```env
# Update these URLs
STRIPE_SERVICE_URL=https://opside-stripe-payments.onrender.com
COST_DOC_SERVICE_URL=https://opside-cost-documentation.onrender.com

# Keep existing URLs
INTEGRATIONS_URL=https://clario-complete-backend-mvak.onrender.com
REFUND_ENGINE_URL=https://clarios-refund-engine.onrender.com
MCDE_URL=https://clario-complete-backend-yjjr.onrender.com
```

---

## ✅ **Post-Deployment Verification**

### 1. Test Service Health Checks
```bash
# Stripe Payments
curl https://opside-stripe-payments.onrender.com/health

# Cost Documentation
curl https://opside-cost-documentation.onrender.com/health

# Orchestrator Service Status
curl https://clario-complete-backend-y5cd.onrender.com/api/services/status
```

### 2. Verify Service Discovery
The orchestrator should show all 7 services as healthy:
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

### 3. Test End-to-End Flow
1. **Connect Amazon**: `/api/integrations/connect` → Should call Integrations Backend ✅
2. **Start Sync**: `/api/sync/start` → Should sync inventory ✅
3. **Run Detection**: `/api/detections/run` → Should detect claims ✅
4. **Generate Document**: `/api/documents/upload` → Should call Cost Docs ✅
5. **Charge Commission**: Internal → Should call Stripe Service ✅

---

## 📋 **MVP Completion Checklist**

### Core Services
- [x] MCDE Service
- [x] Backend API
- [x] Orchestrator
- [x] Refund Engine
- [x] Integrations Backend
- [ ] **Stripe Payments Service** ⚠️
- [ ] **Cost Documentation Service** ⚠️

### Configuration
- [ ] Orchestrator has correct service URLs
- [ ] All services have database connections
- [ ] All services have Redis (if needed)
- [ ] Environment variables configured
- [ ] CORS configured for frontend

### Integration
- [ ] Frontend can authenticate users
- [ ] Frontend can connect Amazon account
- [ ] Frontend can sync inventory
- [ ] Frontend can view claims/recoveries
- [ ] Frontend can view documents
- [ ] System can charge commissions
- [ ] System can generate PDFs

### Testing
- [ ] All services health checks pass
- [ ] Service discovery works in orchestrator
- [ ] End-to-end claim flow works
- [ ] Payment processing works
- [ ] Document generation works

---

## 🎯 **What You'll Have After Deploying These 2 Services**

### Complete MVP Architecture
```
Frontend (Vercel)
    ↓
Orchestrator (Render) ← Routes to all services
    ↓
├── Integrations Backend (Amazon OAuth, Sync)
├── Refund Engine (Claims, ML Detection)
├── MCDE (Evidence Validation)
├── Stripe Payments (Commission Charging) ✅ NEW
└── Cost Documentation (PDF Generation) ✅ NEW
```

### Full Feature Set
- ✅ Amazon account connection & OAuth
- ✅ Inventory synchronization
- ✅ Automated claim detection
- ✅ Evidence collection & validation
- ✅ **PDF document generation** (NEW)
- ✅ **Commission charging** (NEW)
- ✅ Claim submission tracking
- ✅ Recovery metrics & dashboard

---

## 🚨 **Critical Notes**

1. **Database Migration**: Both services need PostgreSQL databases. Create them on Render first.

2. **Redis Requirement**: 
   - Stripe service uses BullMQ (needs Redis)
   - Cost Docs uses Bull queues (needs Redis)
   - Consider using Render Redis or external service (Upstash, Redis Cloud)

3. **Stripe Webhooks**: After deploying Stripe service, register webhook endpoints in Stripe Dashboard pointing to your Render URL.

4. **S3 Storage**: Cost Documentation service needs AWS S3 (or compatible) for PDF storage. Configure credentials before deployment.

5. **Service URLs**: After deploying, immediately update orchestrator environment variables so it can discover the new services.

---

## 📞 **Next Steps**

1. **Deploy Stripe Payments Service** (30-45 min)
2. **Deploy Cost Documentation Service** (30-45 min)
3. **Update Orchestrator URLs** (5 min)
4. **Test Service Discovery** (5 min)
5. **Run End-to-End Tests** (15 min)
6. **Deploy to Production** ✅

**Total Time: ~2 hours to complete MVP deployment**

---

**Once these 2 services are deployed, your MVP will be fully functional!** 🎉

