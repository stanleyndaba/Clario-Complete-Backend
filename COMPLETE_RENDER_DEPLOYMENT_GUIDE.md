# Complete Render Deployment Guide - All Services

## 🎯 Currently Deployed on Render

You have correctly deployed these 5 services:
1. ✅ **The Orchestrator (final boss)** - Main FastAPI backend
2. ✅ **The backend (boss)** - Main backend service  
3. ✅ **Integrations-backend** - OAuth integrations hub
4. ✅ **refund-engine** - Refund processing engine
5. ✅ **MCDE** - ML Cost Detection Engine

## 🚀 Complete Service List (What Should Be Deployed)

### Currently on Render (5/10 services)
1. ✅ Main API Orchestrator (Python/FastAPI) - Port 8000
2. ✅ Backend (Python/FastAPI) - Port 8000
3. ✅ Integrations-backend (Node.js) - Port 3001
4. ✅ refund-engine (Node.js) - Port 3002
5. ✅ MCDE (Python/FastAPI) - Port 8000

### Missing Services (5 services)
6. ❌ **stripe-payments** (Node.js) - Port 4000
7. ❌ **cost-docs** (Node.js) - Port 3003
8. ❌ **claim-detector** (Python/FastAPI) - Port 8001
9. ❌ **evidence-engine** (Python/FastAPI) - Port 8002
10. ❌ **smart-inventory-sync** (Node.js) - Port 3004

---

## 📋 Environment Variables for Each Service

### 1. Main API Orchestrator (The Orchestrator)
**Purpose**: Routes requests to all microservices

```bash
# Database
DATABASE_URL=your_database_url
REDIS_URL=your_redis_url

# Services URLs
INTEGRATIONS_URL=https://your-integrations-backend.onrender.com
STRIPE_SERVICE_URL=https://your-stripe-payments.onrender.com
REFUND_ENGINE_URL=https://your-refund-engine.onrender.com
COST_DOC_SERVICE_URL=https://your-cost-docs.onrender.com
MCDE_URL=https://your-mcde.onrender.com
EVIDENCE_ENGINE_URL=https://your-evidence-engine.onrender.com
CLAIM_DETECTOR_URL=https://your-claim-detector.onrender.com

# CORS
FRONTEND_URL=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app

# Security
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=your_encryption_key

# Amazon OAuth
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_REDIRECT_URI=https://your-main-api.onrender.com/api/auth/amazon/callback
```

### 2. Integrations-Backend
**Purpose**: OAuth integrations (Amazon, Gmail, Stripe)

```bash
# Amazon SP-API Sandbox
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER

# Database & Redis
DATABASE_URL=your_database_url
REDIS_URL=your_redis_url
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# JWT
JWT_SECRET=your_jwt_secret

# Gmail OAuth
GMAIL_CLIENT_ID=your_gmail_client_id
GMAIL_CLIENT_SECRET=your_gmail_client_secret
GMAIL_REDIRECT_URI=https://your-integrations.onrender.com/api/gmail/callback

# Stripe OAuth
STRIPE_CLIENT_ID=your_stripe_client_id
STRIPE_CLIENT_SECRET=your_stripe_client_secret
STRIPE_REDIRECT_URI=https://your-integrations.onrender.com/api/stripe/callback

# CORS
FRONTEND_URL=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
```

### 3. Refund Engine
**Purpose**: Claims processing and refund management

```bash
# Database
DATABASE_URL=your_database_url
REDIS_URL=your_redis_url

# JWT
JWT_SECRET=your_jwt_secret

# Services
INTEGRATIONS_URL=https://your-integrations-backend.onrender.com
MCDE_URL=https://your-mcde.onrender.com
CLAIM_DETECTOR_URL=https://your-claim-detector.onrender.com

# CORS
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
```

### 4. MCDE (ML Cost Detection Engine)
**Purpose**: Cost modeling and ML predictions

```bash
# Database
DATABASE_URL=your_database_url

# ML Configuration
ML_MODEL_PATH=/app/models
EVIDENCE_CONFIDENCE_AUTO=0.85
EVIDENCE_CONFIDENCE_PROMPT=0.5

# CORS
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
```

### 5. Stripe Payments (NOT YET DEPLOYED)
**Purpose**: Payment processing

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_CLIENT_ID=ca_your_stripe_client_id
STRIPE_PLATFORM_ACCOUNT_ID=acct_your_platform_account_id
STRIPE_API_VERSION=2023-10-16
STRIPE_PRICE_ID=price_your_price_id
STRIPE_LIVE_MODE=false

# Database
DATABASE_URL=your_database_url

# JWT
JWT_SECRET=your_jwt_secret

# Services
INTEGRATIONS_URL=https://your-integrations-backend.onrender.com

# CORS
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
```

### 6. Cost Documentation Engine (NOT YET DEPLOYED)
**Purpose**: Cost document processing

```bash
# Database
DATABASE_URL=your_database_url
REDIS_URL=your_redis_url

# JWT
JWT_SECRET=your_jwt_secret

# Services
INTEGRATIONS_URL=https://your-integrations-backend.onrender.com

# CORS
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
```

### 7. Claim Detector (NOT YET DEPLOYED)
**Purpose**: ML claim detection

```bash
# Database
DATABASE_URL=your_database_url

# ML Configuration
ML_MODEL_PATH=/app/models

# Services
MCDE_URL=https://your-mcde.onrender.com
EVIDENCE_ENGINE_URL=https://your-evidence-engine.onrender.com

# CORS
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
```

### 8. Evidence Engine (NOT YET DEPLOYED)
**Purpose**: Evidence processing

```bash
# Database
DATABASE_URL=your_database_url

# ML Configuration
EVIDENCE_CONFIDENCE_AUTO=0.85
EVIDENCE_CONFIDENCE_PROMPT=0.5

# CORS
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
```

### 9. Smart Inventory Sync (NOT YET DEPLOYED)
**Purpose**: Amazon data synchronization

```bash
# Amazon SP-API
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER

# Database
DATABASE_URL=your_database_url

# Services
INTEGRATIONS_URL=https://your-integrations-backend.onrender.com
REFUND_ENGINE_URL=https://your-refund-engine.onrender.com

# CORS
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
```

---

## 🎨 Frontend (Vercel) Environment Variables

```bash
# Backend API URLs
NEXT_PUBLIC_API_URL=https://clario-complete-backend-y5cd.onrender.com
NEXT_PUBLIC_INTEGRATIONS_URL=https://your-integrations-backend.onrender.com
NEXT_PUBLIC_REFUND_ENGINE_URL=https://your-refund-engine.onrender.com

# Optional: Debug mode
NEXT_PUBLIC_DEBUG_MODE=true
```

---

## 🚨 Priority Actions

### Must Do NOW:

1. **Update Integrations-Backend Environment Variables** (Most Important!)
   - Add all Amazon SP-API credentials
   - This is what makes the data sync work

2. **Update Main API Orchestrator**
   - Add all service URLs
   - Enable service routing

3. **Frontend Environment Variables**
   - Point to correct backend URLs

### Can Deploy Later:

4. Stripe Payments Service (for payment processing)
5. Cost Documentation Engine (for document processing)
6. Claim Detector (for ML claim detection)
7. Evidence Engine (for evidence processing)
8. Smart Inventory Sync (already integrated in Integrations-backend)

---

## 📝 How to Set Environment Variables in Render

For each service:
1. Go to Render Dashboard
2. Click on the service
3. Go to "Environment" tab
4. Click "Add Environment Variable"
5. Add each variable one by one
6. Click "Save Changes"
7. Service will auto-redeploy

---

## ✅ Quick Start Checklist

- [ ] Update Integrations-Backend with Amazon credentials
- [ ] Update Main API with service URLs
- [ ] Update Frontend with backend URLs
- [ ] Test authentication flow
- [ ] Verify data sync works
- [ ] Deploy missing services (optional)
