# 🔧 Claim Submit 403 Forbidden Fix

## 🐛 **The Problem**

When clicking "Submit Claim", getting **403 Forbidden** errors because:

1. **Recoveries Router was Commented Out**: `recoveries_router` was disabled in `src/app.py`
2. **Redirect Breaking Authentication**: Redirect from `/api/recoveries/{id}/submit` to `/api/claims/{id}/submit` was dropping Authorization header
3. **Missing Endpoint**: Frontend calls `/api/recoveries/{id}/submit` but only `/api/claims/{id}/submit` existed

---

## ✅ **The Fix**

### **1. Enabled Recoveries Router**
```python
# Before (commented out):
# from .api.recoveries import router as recoveries_router
# app.include_router(recoveries_router, tags=["recoveries"])

# After (enabled):
from .api.recoveries import router as recoveries_router
app.include_router(recoveries_router, tags=["recoveries"])
```

### **2. Removed Redirect (It Breaks Auth)**
```python
# Before (BROKEN - drops auth header):
@app.post("/api/recoveries/{id}/submit")
async def submit_recovery(id: str):
    return RedirectResponse(f"/api/claims/{id}/submit")  # ❌ Loses auth!

# After (REMOVED - using router directly):
# Endpoint now handled by recoveries_router
```

### **3. Added Both Endpoints to Handler**
```python
# Now handles both paths with same function:
@router.post("/api/claims/{id}/submit", response_model=ClaimSubmissionResponse)
@router.post("/api/recoveries/{id}/submit", response_model=ClaimSubmissionResponse)
async def submit_claim(id: str, user: dict = Depends(get_current_user)):
    # Properly authenticated, no redirect needed
    ...
```

---

## 🎯 **Why 403 Happened**

### **HTTP Redirects Don't Preserve Auth Headers**

When you use `RedirectResponse`:
1. Server returns `302/307` redirect
2. Browser makes **NEW request** to redirect URL
3. **Authorization header is NOT forwarded** in redirected request
4. Endpoint receives request with no auth → **403 Forbidden**

**This is standard HTTP behavior** - redirects are meant for public URLs, not authenticated API calls.

---

## ✅ **Solution**

**Direct endpoint handling** - No redirect:
- Frontend calls: `/api/recoveries/{id}/submit`
- Endpoint exists directly in router
- Auth middleware validates token
- Request succeeds ✅

---

## 🔍 **Additional Issue: EventSource Errors**

You also see:
```
EventSource's response has a MIME type ("text/html") that is not "text/event-stream"
```

This suggests:
- SSE endpoint might be returning HTML (error page) instead of event stream
- Or SSE endpoint doesn't exist
- This is separate from the 403 issue but should be fixed too

---

## 📝 **Files Changed**

1. ✅ `src/app.py`:
   - Enabled recoveries router import
   - Enabled router inclusion
   - Removed broken redirect endpoints

2. ✅ `src/api/recoveries.py`:
   - Added `/api/recoveries/{id}/submit` endpoint decorator
   - Same handler for both paths

---

## 🧪 **Testing**

After deploying:

```bash
# Should work (with auth token):
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  https://opside-node-api-woco.onrender.com/api/recoveries/CLM-002/submit

# Should return:
{
  "id": "CLM-002",
  "status": "submitted",
  "submitted_at": "2025-01-...",
  "amazon_case_id": "...",
  "message": "Claim submitted successfully to Amazon SP-API",
  "estimated_resolution": "..."
}
```

---

## 🚀 **Next Steps**

1. ✅ Code fix applied
2. ⏳ Commit and push
3. ⏳ Deploy to Render
4. ⏳ Test claim submission
5. ⏳ Fix SSE endpoint if needed (separate issue)

---

**The 403 error should be completely resolved after deployment!** ✅

