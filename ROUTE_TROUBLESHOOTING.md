# Route Troubleshooting Guide
## `/api/v1/workflow/phase/1` Returns "Not Found"

---

## ✅ Verification Checklist

### 1. Route File Exists
- ✅ **File**: `Integrations-backend/src/routes/workflowRoutes.ts`
- ✅ **Status**: EXISTS and properly exported

### 2. Route is Registered
- ✅ **Import**: `import workflowRoutes from './routes/workflowRoutes';`
- ✅ **Registration**: `app.use('/api/v1/workflow', workflowRoutes);`
- ✅ **Order**: Registered BEFORE proxyRoutes (correct)

### 3. Route Implementation
- ✅ **Route**: `router.post('/phase/:phaseNumber', ...)`
- ✅ **Full Path**: `/api/v1/workflow/phase/1`
- ✅ **Handler**: Calls `OrchestrationJobManager.triggerPhase1_OAuthCompletion()`

---

## 🔧 Fix Steps

### Step 1: Restart the Server
**CRITICAL**: The server MUST be restarted after code changes.

```powershell
# Stop the current server (Ctrl+C)
# Then restart:
cd Integrations-backend
npm start
```

**Check logs for**:
```
Workflow routes module loaded
Workflow routes registered at /api/v1/workflow
```

### Step 2: Test Health Endpoint First
```powershell
curl http://localhost:3001/api/v1/workflow/health
```

**Expected**: `{ "status": "ok", "service": "workflow-routes", "message": "Workflow routes are active" }`

**If this fails**: Routes are not registered - check server startup logs

### Step 3: Check for Compilation Errors
```powershell
cd Integrations-backend
npm run build
```

**Fix any TypeScript errors** before restarting server.

### Step 4: Test Phase 1 Endpoint
```powershell
curl -X POST http://localhost:3001/api/v1/workflow/phase/1 `
  -H "Content-Type: application/json" `
  -d '{
    "user_id": "test-user-sandbox-001",
    "seller_id": "test-seller-sandbox-001",
    "sync_id": "sandbox-test-001"
  }'
```

---

## 🐛 Common Issues

### Issue 1: Server Not Restarted
**Symptom**: Route returns "Not found" even though code is correct

**Fix**: 
1. Stop server (Ctrl+C)
2. Restart: `npm start`
3. Check logs for "Workflow routes registered"

### Issue 2: Compilation Error
**Symptom**: Server starts but route doesn't work

**Fix**:
1. Run: `npm run build`
2. Fix any TypeScript errors
3. Restart server

### Issue 3: Route Not Imported
**Symptom**: No "Workflow routes module loaded" in logs

**Fix**:
1. Check `index.ts` has: `import workflowRoutes from './routes/workflowRoutes';`
2. Check file exists: `Integrations-backend/src/routes/workflowRoutes.ts`
3. Restart server

### Issue 4: Route Registered After Proxy
**Symptom**: Route might be intercepted by proxy

**Fix**: 
- Route is already registered BEFORE proxyRoutes (line 158 vs 177)
- This is correct - no fix needed

---

## 📋 Debugging Commands

### Check if Route File Exists:
```powershell
Test-Path Integrations-backend/src/routes/workflowRoutes.ts
```

### Check Route Registration:
```powershell
Get-Content Integrations-backend/src/index.ts | Select-String -Pattern "workflow" -Context 2,2
```

### Check for Compilation Errors:
```powershell
cd Integrations-backend
npm run build
```

### Test with PowerShell Script:
```powershell
.\test-workflow-route.ps1
```

---

## ✅ Expected Server Logs

When server starts, you should see:
```
Workflow routes module loaded
Workflow routes registered at /api/v1/workflow
Orchestration job manager initialized
```

When route is hit, you should see:
```
Workflow phase route hit { path: '/phase/1', method: 'POST', ... }
Workflow phase 1 triggered { user_id: '...', sync_id: '...' }
🎬 Phase 1: Zero-Friction Onboarding
```

---

## 🎯 Quick Fix

**Most likely issue**: Server not restarted

1. **Stop server**: Press Ctrl+C in the terminal running the server
2. **Restart server**:
   ```powershell
   cd Integrations-backend
   npm start
   ```
3. **Check logs** for "Workflow routes registered"
4. **Test again**:
   ```powershell
   curl http://localhost:3001/api/v1/workflow/health
   ```

---

**Status**: All code is correct. **Server restart required** to load changes.

