# 🚀 Render.com Deployment Guide

## **Why Render?**
- ✅ **No credit card required** for free tier
- ✅ **Perfect for microservices** architecture
- ✅ **Built-in PostgreSQL** and Redis
- ✅ **Automatic HTTPS** and custom domains
- ✅ **Easy environment variable** management
- ✅ **Git-based deployments**

---

## **🎯 Quick Start (5 Minutes)**

### **Step 1: Connect GitHub Repository**
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Connect your repository: `D:\COMP 313\Opside Entire Backend`

### **Step 2: Deploy Core Services First**
Deploy these 3 services in order:

#### **1. Main API (Python/FastAPI)**
- **Type**: Web Service
- **Environment**: Python 3
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `python -m uvicorn src.main:app --host 0.0.0.0 --port $PORT`
- **Health Check Path**: `/health`

#### **2. Integrations Backend (Node.js)**
- **Type**: Web Service  
- **Environment**: Node
- **Root Directory**: `Integrations-backend`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`

#### **3. Stripe Payments (Node.js)**
- **Type**: Web Service
- **Environment**: Node
- **Root Directory**: `stripe-payments`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`

---

## **🔧 Environment Variables Setup**

### **For Main API:**
```
ENV=production
DATABASE_URL=postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
REDIS_URL=redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379
JWT_SECRET=your-super-secret-jwt-key
SUPABASE_URL=https://fmzfjhrwbkebqaxjlvzt.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...
INTEGRATIONS_URL=https://opside-integrations-backend.onrender.com
STRIPE_SERVICE_URL=https://opside-stripe-payments.onrender.com
FRONTEND_URL=https://your-frontend-domain.com
```

### **For Integrations Backend:**
```
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
REDIS_URL=redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379
JWT_SECRET=your-super-secret-jwt-key
SUPABASE_URL=https://fmzfjhrwbkebqaxjlvzt.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...
AMAZON_CLIENT_ID=your-amazon-client-id
AMAZON_CLIENT_SECRET=your-amazon-client-secret
AMAZON_REDIRECT_URI=https://opside-integrations-backend.onrender.com/api/amazon/callback
FRONTEND_URL=https://your-frontend-domain.com
```

### **For Stripe Payments:**
```
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
REDIS_URL=redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379
JWT_SECRET=your-super-secret-jwt-key
SUPABASE_URL=https://fmzfjhrwbkebqaxjlvzt.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

---

## **📋 Step-by-Step Deployment**

### **Phase 1: Core Services (Start Here)**

1. **Deploy Main API**
   - Create new Web Service
   - Connect GitHub repo
   - Set environment variables above
   - Deploy and wait for success

2. **Deploy Integrations Backend**
   - Create new Web Service
   - Set root directory to `Integrations-backend`
   - Set environment variables above
   - Deploy and wait for success

3. **Deploy Stripe Payments**
   - Create new Web Service
   - Set root directory to `stripe-payments`
   - Set environment variables above
   - Deploy and wait for success

### **Phase 2: Additional Services (After Core Works)**

4. **Deploy Cost Documentation**
   - Root directory: `FBA Refund Predictor/cost-documentation-module`

5. **Deploy Refund Engine**
   - Root directory: `FBA Refund Predictor/refund-engine`

6. **Deploy MCDE**
   - Root directory: `FBA Refund Predictor/mcde`
   - Environment: Python

7. **Deploy Claim Detector**
   - Root directory: `Claim Detector Model/claim_detector`
   - Environment: Python

8. **Deploy Evidence Engine**
   - Root directory: `evidence-engine`
   - Environment: Python

9. **Deploy Smart Inventory Sync**
   - Root directory: `Integrations-backend/opsided-backend/smart-inventory-sync`

10. **Deploy Test Service**
    - Root directory: `test-service`
    - Environment: Python

---

## **🔗 Service URLs After Deployment**

Your services will be available at:
- **Main API**: `https://opside-main-api.onrender.com`
- **Integrations**: `https://opside-integrations-backend.onrender.com`
- **Stripe Payments**: `https://opside-stripe-payments.onrender.com`
- **Cost Docs**: `https://opside-cost-docs.onrender.com`
- **Refund Engine**: `https://opside-refund-engine.onrender.com`
- **MCDE**: `https://opside-mcde.onrender.com`
- **Claim Detector**: `https://opside-claim-detector.onrender.com`
- **Evidence Engine**: `https://opside-evidence-engine.onrender.com`
- **Smart Inventory**: `https://opside-smart-inventory-sync.onrender.com`
- **Test Service**: `https://opside-test-service.onrender.com`

---

## **✅ Health Check Commands**

After deployment, test your services:

```bash
# Core services
curl https://opside-main-api.onrender.com/health
curl https://opside-integrations-backend.onrender.com/health
curl https://opside-stripe-payments.onrender.com/health

# Additional services
curl https://opside-cost-docs.onrender.com/health
curl https://opside-refund-engine.onrender.com/health
curl https://opside-mcde.onrender.com/health
curl https://opside-claim-detector.onrender.com/health
curl https://opside-evidence-engine.onrender.com/health
curl https://opside-smart-inventory-sync.onrender.com/health
curl https://opside-test-service.onrender.com/health
```

---

## **🎯 What You Need to Provide**

Before deploying, gather these credentials:

1. **Supabase Database Password** (from your Supabase dashboard)
2. **Upstash Redis URL** (from Upstash dashboard)
3. **Amazon SP-API Credentials** (Client ID and Secret)
4. **Stripe Credentials** (Secret Key, Webhook Secret, Publishable Key)

---

## **🚀 Benefits of Render vs Fly.io**

| Feature | Render | Fly.io |
|---------|--------|--------|
| Credit Card Required | ❌ No | ✅ Yes |
| Free Tier | ✅ Generous | ✅ Limited |
| PostgreSQL | ✅ Built-in | ❌ External needed |
| Redis | ✅ Built-in | ❌ External needed |
| Setup Complexity | ✅ Simple | ⚠️ Complex |
| Microservices | ✅ Perfect | ✅ Good |
| Environment Variables | ✅ Easy | ⚠️ CLI required |

---

## **🎉 Ready to Deploy?**

1. **Go to [render.com](https://render.com)**
2. **Sign up with GitHub**
3. **Connect your repository**
4. **Start with Main API deployment**
5. **Follow the environment variable setup**
6. **Deploy core services first**
7. **Test health endpoints**
8. **Deploy remaining services**

**Your complete Opside backend will be live in minutes!** 🚀✨
