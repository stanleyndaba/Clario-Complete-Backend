# Claim Detector Model - Deployment Status

## 🔍 What Is It?

**Claim Detector Model** is a Python/Flask service that uses ML + Rules Engine to detect Amazon FBA claims.

**Location**: `Claim Detector Model/claim_detector/`

## ⚠️ Current Situation

### **Status: INTEGRATED, NOT DEPLOYED SEPARATELY**

The Claim Detector Model is **currently integrated INTO the Orchestrator**, not deployed as a separate service.

**Evidence:**
1. ✅ Code exists: `Claim Detector Model/claim_detector/`
2. ✅ Has Dockerfile (ready for deployment)
3. ✅ Has API endpoints (`/claims/detect`, `/health`)
4. ❌ **NOT in orchestrator's service_directory.py** (only has 5 services registered)
5. ✅ Orchestrator imports it directly: `src/ml_detector/advanced_detector_service.py`

## 🤔 Should You Deploy It Separately?

### **Option 1: Keep It Integrated (Current)**
**Pros:**
- ✅ One less service to deploy/maintain
- ✅ Faster (no network calls)
- ✅ Already working

**Cons:**
- ❌ Orchestrator becomes heavier
- ❌ Can't scale claim detection independently
- ❌ Coupled to orchestrator deployment

### **Option 2: Deploy As Separate Service (Recommended for Production)**
**Pros:**
- ✅ Can scale claim detection independently
- ✅ Better separation of concerns
- ✅ Can update ML models without redeploying orchestrator
- ✅ Matches microservices architecture

**Cons:**
- ❌ Another service to deploy
- ❌ More network calls (slight latency)
- ❌ Need to update orchestrator to call it

## 📊 Current Service Count

**Currently Deployed (5/7):**
1. ✅ Orchestrator (includes Claim Detector code)
2. ✅ Integrations Backend
3. ✅ Refund Engine
4. ✅ MCDE
5. ✅ Backend

**Missing (2/7):**
6. ❌ Stripe Payments Service
7. ❌ Cost Documentation Service

**Optional (Would be 3/7 if deployed separately):**
8. ⚠️ Claim Detector Service (currently integrated)

## 🚀 Recommendation

**For MVP:** Keep it integrated in the Orchestrator. Focus on deploying the 2 missing critical services:
1. Stripe Payments (to charge commissions)
2. Cost Documentation (to generate PDFs)

**For Production/Scale:** Consider deploying Claim Detector separately when you need to:
- Scale claim detection independently
- Update ML models frequently
- Handle high detection load

## 📝 Deployment Instructions (If You Want Separate Service)

### Step 1: Deploy Claim Detector Service
1. Go to Render → New Web Service
2. Connect repo: `stanleyndaba/Clario-Complete-Backend`
3. Configure:
   - **Name**: `opside-claim-detector`
   - **Root Directory**: `Claim Detector Model/claim_detector`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python src/api/claims_api.py` or `uvicorn src.api.claims_api:app --host 0.0.0.0 --port 8001`

### Step 2: Update Orchestrator
Add to orchestrator's `service_directory.py`:
```python
"claim-detector": ServiceInfo(
    name="claim-detector",
    base_url=settings.CLAIM_DETECTOR_URL,
    health_endpoint="/health"
)
```

Add to `src/common/config.py`:
```python
CLAIM_DETECTOR_URL: str = os.getenv("CLAIM_DETECTOR_URL", "http://localhost:8001")
```

### Step 3: Update Environment Variables
In Orchestrator Render service:
```env
CLAIM_DETECTOR_URL=https://opside-claim-detector.onrender.com
```

## ✅ Bottom Line

**You don't NEED to deploy it separately for MVP** - it's already working integrated into the orchestrator.

**But you SHOULD deploy these 2 services first:**
1. ✅ Stripe Payments Service (critical for revenue)
2. ✅ Cost Documentation Service (critical for claim submission)

After those, consider if you want Claim Detector as a separate service.

