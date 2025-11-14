# 🔍 Python Backend Build Diagnostic Guide

## ✅ **Root Cause Confirmed**

**YES - If the Python backend build is blocked/failed on Render, this is the root cause of your 502 errors.**

### Why This Causes 502 Errors:
1. Node.js backend (`opside-node-api`) proxies these endpoints to Python:
   - `/api/recoveries` → Python backend
   - `/api/metrics/recoveries` → Python backend
2. If Python backend isn't running → Node.js gets connection refused → Returns 502 Bad Gateway

---

## 🔍 **How to Check Python Backend Status on Render**

### Step 1: Check Render Dashboard
1. Go to https://dashboard.render.com
2. Find service: **`opside-python-api`**
3. Check status:
   - ✅ **Live** = Running (should work)
   - ❌ **Build Failed** = Build blocked (this is your issue)
   - ⏸️ **Suspended** = Service stopped
   - 🔄 **Building** = Still deploying

### Step 2: Check Build Logs
1. Click on **`opside-python-api`** service
2. Go to **"Logs"** tab
3. Look for errors:
   - `ERROR: Could not find a version that satisfies the requirement`
   - `ERROR: Failed building wheel for`
   - `MemoryError` or `Killed` (out of memory)
   - `Timeout` errors
   - `ModuleNotFoundError` during startup

### Step 3: Check Recent Deploys
1. Go to **"Events"** tab
2. Look for failed deployments
3. Click on failed deploy to see error details

---

## 🚨 **Common Build Blockers**

### 1. **Heavy ML Dependencies (Most Likely)**
**Problem**: `torch`, `transformers`, `sentence-transformers` are HUGE (several GB)
- Can cause build timeouts on Render free tier
- Can cause memory errors during installation

**Solution**: Make these optional or use lighter alternatives
```python
# Option A: Make ML dependencies optional
# Only install if needed for specific features
try:
    import torch
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
```

### 2. **Missing System Dependencies**
**Problem**: Some packages require system libraries:
- `pytesseract` → needs `tesseract-ocr`
- `pdf2image` → needs `poppler`
- `opencv-python` → needs system libraries

**Solution**: Add to build command or use Docker
```yaml
# In render.yaml, update buildCommand:
buildCommand: |
  apt-get update && apt-get install -y tesseract-ocr poppler-utils || true
  pip install --upgrade pip
  pip install -r requirements-consolidated.txt
```

### 3. **Build Timeout**
**Problem**: Free tier has build time limits (~15-20 minutes)
- Installing torch + transformers can take 10-15 minutes

**Solution**: Optimize requirements or upgrade plan

### 4. **Memory Issues**
**Problem**: Installing large packages can exceed memory limits

**Solution**: Install in stages or use lighter versions

---

## 🛠️ **Quick Fixes**

### Fix 1: Optimize Requirements (Recommended)
Create a minimal requirements file for Phase 1:

```bash
# requirements-phase1.txt (minimal for Phase 1)
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
pydantic-settings>=2.0.0
pyjwt==2.8.0
httpx==0.25.2
python-multipart==0.0.6
cryptography==42.0.5
psycopg2-binary==2.9.9
sqlalchemy==2.0.23
alembic==1.13.1
python-dotenv==1.0.0
aiofiles==23.2.1
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
bcrypt==4.0.1
email-validator==2.0.0
aiohttp==3.9.1
redis==5.0.1
boto3==1.34.0
requests==2.31.0
pyyaml==6.0.1
loguru==0.7.2
pandas==2.1.4
numpy==1.25.2
```

**Note**: Removed heavy ML dependencies (torch, transformers, etc.) for Phase 1

### Fix 2: Update render.yaml Build Command
```yaml
buildCommand: |
  pip install --upgrade pip
  pip install --no-cache-dir -r requirements-consolidated.txt || pip install --no-cache-dir -r requirements-phase1.txt
```

### Fix 3: Make ML Dependencies Optional
Update `src/app.py` to handle missing ML dependencies gracefully:
```python
try:
    from .api.consolidated.claim_detector_router import claim_detector_router
    ML_AVAILABLE = True
except ImportError as e:
    logger.warning(f"ML dependencies not available: {e}")
    ML_AVAILABLE = False
    claim_detector_router = None
```

---

## 📋 **Action Plan**

### Immediate Steps:
1. ✅ **Check Render Dashboard** - Confirm Python backend status
2. ✅ **Check Build Logs** - Identify specific error
3. ✅ **Share Error Details** - So we can fix it

### If Build is Failing:
1. **Option A**: Use minimal requirements for Phase 1 (recommended)
2. **Option B**: Fix specific dependency issue
3. **Option C**: Upgrade Render plan (if timeout/memory issues)

### If Build Succeeds but Service Won't Start:
1. Check startup logs for import errors
2. Verify environment variables are set
3. Check `/health` endpoint

---

## 🔗 **Related Endpoints**

Once Python backend is running, test these:
- `https://python-api-3-vb5h.onrender.com/health` (or your Python backend URL)
- `https://opside-node-api-woco.onrender.com/api/health/python-backend` (Node.js health check)

---

## 📝 **Next Steps**

1. **Check Render Dashboard** and share:
   - Python backend service status
   - Build log errors (if any)
   - Recent deployment events

2. **If build is failing**, we'll:
   - Create optimized requirements file
   - Fix specific dependency issues
   - Update build configuration

3. **Once Python backend is running**, Phase 1 should work end-to-end!






