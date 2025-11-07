# ✅ Amazon Credentials Verification & Fix Guide

## 🐛 Issues Found

### ❌ Critical Issue: AMAZON_REDIRECT_URI has `@` symbol

**Your current value:**
```
AMAZON_REDIRECT_URI=@https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback
```

**Should be (remove the `@`):**
```
AMAZON_REDIRECT_URI=https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback
```

⚠️ **The `@` symbol will cause OAuth to fail!** Remove it immediately.

---

### ⚠️ Missing AMAZON_CLIENT_ID

You have `AMAZON_SPAPI_CLIENT_ID` but not `AMAZON_CLIENT_ID`. While the backend accepts both, it's better to set both for consistency.

---

## ✅ Corrected Environment Variables

### For Node.js API (opside-node-api)

```bash
# Amazon OAuth Credentials (REQUIRED)
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7

# Amazon SP-API Configuration (REQUIRED)
AMAZON_SPAPI_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER

# OAuth Redirect URI (FIXED - removed @ symbol)
AMAZON_REDIRECT_URI=https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback
```

### For Python API (if it handles Amazon OAuth)

**Yes, Python backend also needs these credentials** if it's handling Amazon OAuth flows.

```bash
# Amazon OAuth Credentials (REQUIRED for Python)
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_REDIRECT_URI=https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback
```

**Note:** Python backend uses `AMAZON_REDIRECT_URI` (not `AMAZON_SPAPI_REDIRECT_URI`), but it accepts `AMAZON_SPAPI_CLIENT_ID` as fallback.

---

## 🔍 How Backend Uses These Variables

### Node.js Backend (`Integrations-backend`)

The Node.js backend accepts **both naming conventions**:

```typescript
// From amazonService.ts
const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
const redirectUri = process.env.AMAZON_REDIRECT_URI || process.env.AMAZON_SPAPI_REDIRECT_URI;
```

**Priority:**
1. `AMAZON_CLIENT_ID` (preferred)
2. Falls back to `AMAZON_SPAPI_CLIENT_ID` if not set

**Recommendation:** Set both for consistency and clarity.

---

### Python Backend

The Python backend also accepts both naming conventions:

```python
# From src/common/config.py
_amazon_client_id = os.getenv("AMAZON_CLIENT_ID") or os.getenv("AMAZON_SPAPI_CLIENT_ID", "")
AMAZON_CLIENT_ID: str = _amazon_client_id

_amazon_client_secret = os.getenv("AMAZON_CLIENT_SECRET") or os.getenv("AMAZON_SPAPI_CLIENT_SECRET", "")
AMAZON_CLIENT_SECRET: str = _amazon_client_secret

AMAZON_REDIRECT_URI: str = os.getenv("AMAZON_REDIRECT_URI", "http://localhost:8000/api/auth/amazon/callback")
```

**Note:** Python uses `AMAZON_REDIRECT_URI` (no SPAPI variant), but accepts `AMAZON_SPAPI_CLIENT_ID` as fallback.

---

## ✅ Verification Checklist

### Step 1: Fix AMAZON_REDIRECT_URI

**In Render Dashboard (opside-node-api):**
1. Go to: Environment → Environment Variables
2. Find: `AMAZON_REDIRECT_URI`
3. **Remove the `@` symbol** from the beginning
4. Value should be: `https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback`
5. Save

### Step 2: Add AMAZON_CLIENT_ID (Recommended)

**In Render Dashboard (opside-node-api):**
1. Add: `AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432`
2. (Same value as `AMAZON_SPAPI_CLIENT_ID`)
3. Save

### Step 3: Verify All Variables Are Set

**For Node.js API:**
- [x] `AMAZON_CLIENT_ID` (add this)
- [x] `AMAZON_CLIENT_SECRET`
- [x] `AMAZON_SPAPI_CLIENT_ID`
- [x] `AMAZON_SPAPI_REFRESH_TOKEN`
- [x] `AMAZON_SPAPI_BASE_URL`
- [x] `AMAZON_MARKETPLACE_ID`
- [x] `AMAZON_REDIRECT_URI` (fix: remove `@`)

**For Python API (if handling Amazon OAuth):**
- [ ] `AMAZON_CLIENT_ID`
- [ ] `AMAZON_CLIENT_SECRET`
- [ ] `AMAZON_REDIRECT_URI`

### Step 4: Restart Backend Services

After updating environment variables:
1. **Restart Node.js API** on Render
2. **Restart Python API** on Render (if you updated it)

---

## 🧪 Test After Fixing

### Test 1: OAuth Start Endpoint

```bash
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?frontend_url=https://your-frontend-url.com"
```

**Expected Response (after fix):**
```json
{
  "success": true,
  "ok": true,
  "authUrl": "https://www.amazon.com/ap/oa?client_id=...&response_type=code&redirect_uri=https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback&state=...",
  "message": "OAuth flow initiated"
}
```

**Should NOT see:**
- ❌ "Mock OAuth URL (credentials not configured)"
- ❌ Mock URL like `http://localhost:3000/auth/callback?code=mock_auth_code`

### Test 2: Diagnostics Endpoint

```bash
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/diagnose"
```

**Expected Response (after fix):**
```json
{
  "success": true,
  "summary": {
    "total": 4,
    "passed": 4,
    "failed": 0
  },
  "results": [
    {
      "step": "Environment Variables",
      "success": true,
      "details": {
        "clientId": "✓ Present",
        "clientSecret": "✓ Present",
        "redirectUri": "✓ Present",
        "isSandbox": "✓ Sandbox mode"
      }
    }
  ]
}
```

---

## 📋 Summary

### ✅ What's Correct:
1. ✅ `AMAZON_CLIENT_SECRET` - Correct format
2. ✅ `AMAZON_SPAPI_CLIENT_ID` - Correct format
3. ✅ `AMAZON_SPAPI_REFRESH_TOKEN` - Correct format
4. ✅ `AMAZON_SPAPI_BASE_URL` - Correct sandbox URL
5. ✅ `AMAZON_MARKETPLACE_ID` - Correct US marketplace ID

### ❌ What Needs Fixing:
1. ❌ **AMAZON_REDIRECT_URI** - Remove `@` symbol at the start
2. ⚠️ **AMAZON_CLIENT_ID** - Add this (recommended for consistency)

### ✅ Do You Need These for Python?
**Yes, if Python backend handles Amazon OAuth:**
- Set `AMAZON_CLIENT_ID`
- Set `AMAZON_CLIENT_SECRET`
- Set `AMAZON_REDIRECT_URI` (no `@` symbol)

**If Python backend only calls Node.js API for Amazon operations:**
- Not strictly necessary, but recommended for consistency

---

## 🚀 Next Steps

1. **Fix `AMAZON_REDIRECT_URI`** - Remove `@` symbol in Render
2. **Add `AMAZON_CLIENT_ID`** - For consistency (same value as `AMAZON_SPAPI_CLIENT_ID`)
3. **Restart Node.js API** on Render
4. **Test OAuth endpoint** - Verify real OAuth URL is returned
5. **Test diagnostics endpoint** - Verify all checks pass
6. **Test frontend** - Click "Connect Amazon" and verify OAuth flow works

---

## 📚 References

- **Node.js Backend Service:** `Integrations-backend/src/services/amazonService.ts`
- **Python Backend Config:** `src/common/config.py`
- **Amazon Developer Console:** https://developer.amazon.com/
- **Sandbox Documentation:** https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints

