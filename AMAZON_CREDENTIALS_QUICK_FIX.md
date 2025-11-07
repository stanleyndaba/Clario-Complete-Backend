# 🚨 Amazon Credentials - Quick Fix

## ❌ Critical Issue Found

### Issue 1: `AMAZON_REDIRECT_URI` has `@` symbol

**Current (WRONG):**
```
AMAZON_REDIRECT_URI=@https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback
```

**Fixed (CORRECT):**
```
AMAZON_REDIRECT_URI=https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback
```

**Action Required:** Remove the `@` symbol in Render dashboard.

---

## ✅ Complete Corrected Credentials

### For Node.js API (opside-node-api) on Render

Copy these **exactly** (no `@` symbol):

```bash
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
AMAZON_REDIRECT_URI=https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback
```

**⚠️ Note:** `AMAZON_REDIRECT_URI` should NOT have `@` at the start!

---

## 🤔 Do You Need These for Python Backend?

### Answer: **Yes, if Python backend handles Amazon OAuth**

If your Python backend has Amazon OAuth routes, it needs:

```bash
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_REDIRECT_URI=https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback
```

**Note:** 
- Python backend accepts `AMAZON_SPAPI_CLIENT_ID` as fallback, but `AMAZON_CLIENT_ID` is preferred
- Python uses `AMAZON_REDIRECT_URI` (not `AMAZON_SPAPI_REDIRECT_URI`)

### If Python only calls Node.js API:

If Python backend just proxies requests to Node.js API for Amazon operations, you **don't strictly need** these in Python, but it's recommended for consistency.

---

## 🔧 How to Fix in Render

1. **Go to Render Dashboard**
   - https://dashboard.render.com
   - Select your `opside-node-api` service

2. **Go to Environment**
   - Click "Environment" tab
   - Find `AMAZON_REDIRECT_URI`

3. **Remove `@` Symbol**
   - Edit the value
   - Remove `@` from the beginning
   - Should be: `https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback`

4. **Add `AMAZON_CLIENT_ID` (Recommended)**
   - Add new variable: `AMAZON_CLIENT_ID`
   - Value: `amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432`

5. **Save and Restart**
   - Click "Save Changes"
   - Restart the service

---

## 🧪 Test After Fix

```bash
# Test OAuth endpoint
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?frontend_url=https://your-frontend-url.com"

# Should return real OAuth URL (not mock)
# Should NOT see: "Mock OAuth URL (credentials not configured)"
```

---

## ✅ Summary

| Variable | Status | Action |
|----------|--------|--------|
| `AMAZON_CLIENT_SECRET` | ✅ Correct | None |
| `AMAZON_SPAPI_CLIENT_ID` | ✅ Correct | None |
| `AMAZON_SPAPI_REFRESH_TOKEN` | ✅ Correct | None |
| `AMAZON_SPAPI_BASE_URL` | ✅ Correct | None |
| `AMAZON_MARKETPLACE_ID` | ✅ Correct | None |
| `AMAZON_REDIRECT_URI` | ❌ Has `@` | **Remove `@` symbol** |
| `AMAZON_CLIENT_ID` | ⚠️ Missing | **Add this (recommended)** |

---

## 📚 Full Details

See `AMAZON_CREDENTIALS_VERIFICATION.md` for complete verification guide.

