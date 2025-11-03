# 🚀 Render Deployment Guide - Consolidated Services

## ✅ What Changed

We've consolidated **10 services** into **2 services** to reduce hosting costs:

### Before (10 Services)
- main-api (Python)
- mcde (Python)
- claim-detector (Python)
- evidence-engine (Python)
- test-service (Python)
- integrations-backend (Node.js)
- stripe-payments (Node.js)
- cost-documentation-module (Node.js)
- refund-engine (Node.js)
- smart-inventory-sync (Node.js)

### After (2 Services)
1. **opside-python-api** - All Python services consolidated
2. **opside-node-api** - All Node.js services consolidated

## 📋 Deployment Steps

### 1. Deploy to Render

#### Option A: Using render.yaml (Recommended)
1. Push your code to GitHub
2. Go to Render Dashboard → New → Blueprint
3. Connect your repository
4. Render will automatically detect `render.yaml` and deploy both services

#### Option B: Manual Deployment
1. Go to Render Dashboard → New → Web Service
2. Connect your GitHub repository
3. Configure each service:

**Python Service:**
- **Name**: `opside-python-api`
- **Environment**: Python
- **Build Command**: `pip install -r requirements-consolidated.txt`
- **Start Command**: `uvicorn src.app:app --host 0.0.0.0 --port $PORT`
- **Health Check Path**: `/health`

**Node.js Service:**
- **Name**: `opside-node-api`
- **Root Directory**: `Integrations-backend`
- **Environment**: Node
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`

### 2. Set Environment Variables

For **opside-python-api**:
```bash
DATABASE_URL=<your-postgres-url>
REDIS_URL=<your-redis-url>
JWT_SECRET=<your-jwt-secret>
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

For **opside-node-api** (same variables, plus):
```bash
STRIPE_WEBHOOK_SECRET=<your-webhook-secret>
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
```

### 3. Verify Deployment

**Python API:**
```bash
curl https://opside-python-api.onrender.com/health
curl https://opside-python-api.onrender.com/api/v1/mcde/health
curl https://opside-python-api.onrender.com/api/v1/claim-detector/health
curl https://opside-python-api.onrender.com/api/v1/evidence-engine/health
curl https://opside-python-api.onrender.com/api/v1/tests/health
```

**Node.js API:**
```bash
curl https://opside-node-api.onrender.com/health
```

## 🔧 Service URLs

After deployment, update your frontend configuration:

```env
NEXT_PUBLIC_API_URL=https://opside-python-api.onrender.com
NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
```

## 📊 API Endpoints

### Python API (opside-python-api)
- Main API: `/api/*`
- MCDE: `/api/v1/mcde/*`
- Claim Detector: `/api/v1/claim-detector/*`
- Evidence Engine: `/api/v1/evidence-engine/*`
- Test Service: `/api/v1/tests/*`

### Node.js API (opside-node-api)
- Integrations: `/api/integrations/*`
- Stripe: `/api/stripe/*`
- Cost Docs: `/api/cost-docs/*`
- Refund Engine: `/api/refund-engine/*`
- Inventory Sync: `/api/inventory-sync/*`

## 💰 Cost Savings

- **Before**: 10 services (potentially exceeding free tier limits)
- **After**: 2 services (better resource allocation, stay within free tier)

## 🐛 Troubleshooting

### Python API won't start
- Check `requirements-consolidated.txt` is present
- Verify all dependencies install correctly
- Check logs for import errors

### Node.js API won't start
- Ensure `Integrations-backend/package.json` exists
- Check that all Node.js services are merged into `Integrations-backend`
- Verify build completes successfully

### Services can't communicate
- Update service URLs in environment variables
- Check CORS configuration
- Verify both services are running

## 📝 Next Steps

1. Monitor both services for 24 hours
2. Test all endpoints
3. Update frontend to use new service URLs
4. Scale up if needed (upgrade from free tier)

## 🔄 Migration Notes

- Service Directory will show internal modules instead of external HTTP calls
- All inter-service communication is now internal function calls
- No need for service-to-service URLs in environment variables

