# 🔍 Amazon SP-API Production Mode Analysis

## ❌ Root Cause: Why SP-API is NOT in Production

### **Issue #1: Environment Variable Mismatch**

**Location:** `src/api/auth.py:84`

```python
if not settings.AMAZON_CLIENT_ID or settings.AMAZON_CLIENT_ID == "your-amazon-client-id":
    # Use sandbox mode
```

**Problem:**
- The code checks `settings.AMAZON_CLIENT_ID` to determine production vs sandbox
- But there are **TWO separate environment variables**:
  - `AMAZON_CLIENT_ID` (used for OAuth flow check)
  - `AMAZON_SPAPI_CLIENT_ID` (used for SP-API service calls)
- If `AMAZON_CLIENT_ID` is empty/missing, it automatically falls back to sandbox mode

**Current State:**
- You have `AMAZON_SPAPI_CLIENT_ID` set (sandbox credentials)
- But `AMAZON_CLIENT_ID` is likely **empty** → triggers sandbox mode

---

### **Issue #2: Explicit Sandbox URL Configuration**

**Location:** `src/api/auth.py:102`

```python
if "sandbox" in settings.AMAZON_SPAPI_BASE_URL:
    # Sandbox mode detected
```

**Problem:**
- `AMAZON_SPAPI_BASE_URL` is explicitly set to: `https://sandbox.sellingpartnerapi-na.amazon.com`
- This explicitly puts the system in **sandbox mode**

**Current State:**
- Environment variable: `AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com`
- This is a **sandbox URL**, not production

---

### **Issue #3: Missing Production Credentials**

**Problem:**
- You have **sandbox credentials** from Amazon (for testing)
- But you need **production credentials** from Amazon to use production SP-API

**Sandbox Credentials (Current):**
```
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
```

**Production Requirements:**
- Production OAuth Client ID (different from sandbox)
- Production Client Secret (different from sandbox)
- Production Refresh Token (obtained after OAuth flow with production credentials)
- Production SP-API URL: `https://sellingpartnerapi-na.amazon.com` (no "sandbox" in URL)

---

### **Issue #4: Inconsistent Variable Naming**

**Location:** `src/common/config.py:26` vs `src/common/config.py:78`

```python
# Line 26: Used by OAuth flow
AMAZON_CLIENT_ID: str = os.getenv("AMAZON_CLIENT_ID", "")

# Line 78: Used by SP-API service
AMAZON_SPAPI_CLIENT_ID: str = os.getenv("AMAZON_SPAPI_CLIENT_ID", "")
```

**Problem:**
- Two separate variables that should have the same value
- Code checks `AMAZON_CLIENT_ID` but may only have `AMAZON_SPAPI_CLIENT_ID` set
- This causes production mode check to fail

---

## ✅ **What Needs to Happen for Production**

### **Step 1: Get Production Credentials from Amazon**

1. Go to Amazon Seller Central → Apps & Services → Develop Apps
2. Create/use a **Production** app (not sandbox)
3. Get production credentials:
   - Production Client ID
   - Production Client Secret
   - Production Refresh Token (obtained after OAuth authorization)

### **Step 2: Set Environment Variables in Render**

**For Python API (`opside-python-api`):**
```bash
# CRITICAL: Both must be set to the SAME production value
AMAZON_CLIENT_ID=<production-client-id>
AMAZON_SPAPI_CLIENT_ID=<production-client-id>
AMAZON_CLIENT_SECRET=<production-client-secret>
AMAZON_SPAPI_CLIENT_SECRET=<production-client-secret>

# Production SP-API URL (NO "sandbox" in URL)
AMAZON_SPAPI_BASE_URL=https://sellingpartnerapi-na.amazon.com

# Production refresh token (from OAuth flow)
AMAZON_SPAPI_REFRESH_TOKEN=<production-refresh-token>
```

**For Node.js API (`opside-node-api`):**
```bash
# Same production credentials
AMAZON_SPAPI_BASE_URL=https://sellingpartnerapi-na.amazon.com
AMAZON_CLIENT_ID=<production-client-id>
AMAZON_CLIENT_SECRET=<production-client-secret>
AMAZON_SPAPI_REFRESH_TOKEN=<production-refresh-token>
```

### **Step 3: Verify Production Mode Detection**

**Check in Python API:**
- `settings.AMAZON_CLIENT_ID` must be set and NOT empty
- `settings.AMAZON_CLIENT_ID` must NOT equal `"your-amazon-client-id"`
- `settings.AMAZON_SPAPI_BASE_URL` must NOT contain `"sandbox"`

**Check in Node.js API:**
- `process.env.AMAZON_SPAPI_BASE_URL` must NOT contain `"sandbox"`
- Or `process.env.NODE_ENV === 'production'` and no `AMAZON_SPAPI_BASE_URL` set (defaults to production)

---

## 🔧 **Code Locations That Check Sandbox vs Production**

| File | Line | Check | What It Does |
|------|------|-------|--------------|
| `src/api/auth.py` | 84 | `if not settings.AMAZON_CLIENT_ID` | Falls back to sandbox if missing |
| `src/api/auth.py` | 102 | `if "sandbox" in settings.AMAZON_SPAPI_BASE_URL` | Detects sandbox URL |
| `Integrations-backend/src/services/amazonService.ts` | 42-45 | Checks `AMAZON_SPAPI_BASE_URL` or `NODE_ENV` | Determines base URL |

---

## 🎯 **Summary**

**Why it's in Sandbox:**
1. ✅ `AMAZON_SPAPI_BASE_URL` contains `"sandbox"` → explicitly sandbox mode
2. ✅ `AMAZON_CLIENT_ID` likely empty → triggers sandbox fallback
3. ✅ Only sandbox credentials available → need production credentials

**To Fix:**
1. Get production credentials from Amazon Seller Central
2. Set `AMAZON_CLIENT_ID` = `AMAZON_SPAPI_CLIENT_ID` (same production value)
3. Change `AMAZON_SPAPI_BASE_URL` to production URL (remove "sandbox")
4. Use production refresh token from OAuth flow

**No fallbacks needed** - just proper production credentials and correct environment variable configuration.

