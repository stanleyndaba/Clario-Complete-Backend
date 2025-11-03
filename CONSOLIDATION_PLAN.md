# Service Consolidation Plan for Render Deployment

## 🎯 Goal
Reduce from **10 services** to **2 services** to minimize hosting costs on Render.

## 📋 Current Services (10)

### Python Services (5)
1. **main-api** - Main orchestrator (src/app.py)
2. **mcde** - Manufacturing Cost Document Engine
3. **claim-detector** - ML claim detection
4. **evidence-engine** - Evidence processing
5. **test-service** - Test runner

### Node.js Services (5)
1. **integrations-backend** - Main integrations hub
2. **stripe-payments** - Payment processing
3. **cost-documentation-module** - Cost documentation
4. **refund-engine** - Refund processing
5. **smart-inventory-sync** - Amazon data sync

## ✅ Consolidated Services (2)

### 1. Python Monolith (main-api)
- **Location**: `src/app.py`
- **Includes**:
  - All existing main-api functionality
  - MCDE endpoints (cost estimation, document processing)
  - Claim Detector endpoints (ML predictions)
  - Evidence Engine endpoints (matching, validation)
  - Test Service endpoints (test runner)

### 2. Node.js Monolith (integrations-backend)
- **Location**: `Integrations-backend/src/index.ts`
- **Includes**:
  - All existing integrations-backend functionality
  - Stripe Payments routes
  - Cost Documentation routes
  - Refund Engine routes
  - Smart Inventory Sync routes

## 🔧 Implementation Steps

### Phase 1: Python Consolidation ✅
1. Create router modules for each service
2. Copy/adapt service code into main-api
3. Update service directory to mark as internal
4. Merge requirements.txt dependencies
5. Test locally

### Phase 2: Node.js Consolidation
1. Create route modules for each service
2. Copy/adapt service code into integrations-backend
3. Merge package.json dependencies
4. Update service clients in Python to call internal routes
5. Test locally

### Phase 3: Render Deployment
1. Create render.yaml for 2 services
2. Update environment variables
3. Update documentation
4. Deploy and verify

## 💰 Cost Savings
- **Before**: 10 services × Render free tier = Limited free tier resources
- **After**: 2 services × Render free tier = More resources per service, better performance

## 📝 Notes
- Service Directory will be updated to show internal modules instead of external HTTP calls
- All HTTP client calls between services will become internal function calls
- Environment variables will be simplified (no inter-service URLs needed)

