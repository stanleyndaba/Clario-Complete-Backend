# ⚡ Quick Error Handling Test Guide

**Fast way to test error handling implementation**

---

## 🚀 Run Tests (3 Ways)

### **1. Manual Test Script (Recommended First)**
```bash
cd Integrations-backend
npm run test:error-handling
```

**What it tests:**
- ✅ OAuth token expiration
- ✅ Rate limiting
- ✅ Network timeouts
- ✅ Claim validation
- ✅ Duplicate detection
- ✅ Empty evidence
- ✅ Database errors
- ✅ Payment failures

**Expected output:**
```
🚀 Starting Error Handling Test Suite
============================================================

🧪 Testing: OAuth Token Expiration
✅ PASSED (45ms)

🧪 Testing: SP-API Rate Limiting
✅ PASSED (120ms)

...

📊 Test Results Summary
============================================================
✅ All tests passed!
```

---

### **2. Jest Unit Tests**
```bash
cd Integrations-backend
npm run test:error-handling:unit
```

**Tests error handling utilities in isolation**

---

### **3. Integration Tests**
```bash
cd Integrations-backend
npm run test:error-handling:integration
```

**Tests error handling in service context**

---

## 🧪 Manual Testing Scenarios

### **Scenario 1: Test Duplicate Detection**

**Quick Test:**
```bash
cd Integrations-backend
ts-node -e "
import { preventDuplicateClaim } from './src/utils/duplicateDetection';
preventDuplicateClaim({
  claimId: 'test-123',
  userId: 'user-123',
  amount: 100
}).then(() => console.log('✅ No duplicate')).catch(e => console.log('❌', e.message));
"
```

**Expected:** Should pass (no duplicate exists)

---

### **Scenario 2: Test Claim Validation**

**Quick Test:**
```bash
cd Integrations-backend
ts-node -e "
import { validateClaim } from './src/utils/claimValidation';
const result = validateClaim({
  claim_id: 'test-123',
  user_id: 'user-123',
  amount: 100
});
console.log('✅ Valid:', result.isValid);
"
```

**Expected:** `✅ Valid: true`

---

### **Scenario 3: Test Invalid Claim**

**Quick Test:**
```bash
cd Integrations-backend
ts-node -e "
import { validateClaim } from './src/utils/claimValidation';
try {
  validateClaim({ claim_id: 'test', user_id: 'user' }); // Missing amount
} catch(e) {
  console.log('✅ Caught error:', e.message);
}
"
```

**Expected:** `✅ Caught error: Amount is required`

---

## 📊 Verify Implementation

### **Check 1: Utilities Exist**
```bash
ls Integrations-backend/src/utils/errorHandlingUtils.ts
ls Integrations-backend/src/utils/claimValidation.ts
ls Integrations-backend/src/utils/duplicateDetection.ts
```

**Expected:** All 3 files exist ✅

---

### **Check 2: Services Updated**
```bash
# Check if imports are added
grep -n "errorHandlingUtils" Integrations-backend/src/services/agent2DataSyncService.ts
grep -n "claimValidation" Integrations-backend/src/services/agent2DataSyncService.ts
grep -n "duplicateDetection" Integrations-backend/src/services/agent2DataSyncService.ts
```

**Expected:** All imports found ✅

---

### **Check 3: Validation in Code**
```bash
# Check if validation is called
grep -n "validateClaim" Integrations-backend/src/services/agent2DataSyncService.ts
grep -n "preventDuplicateClaim" Integrations-backend/src/services/agent2DataSyncService.ts
```

**Expected:** Both functions called ✅

---

## 🎯 Success Criteria

### **All Tests Must:**
- ✅ Run without errors
- ✅ Complete in < 30 seconds
- ✅ Show clear pass/fail status
- ✅ Provide error messages if failed

### **Implementation Must:**
- ✅ Catch expected errors
- ✅ Retry retryable errors
- ✅ Validate claim data
- ✅ Prevent duplicates
- ✅ Log errors properly

---

## 🐛 Troubleshooting

### **Issue: "Cannot find module"**
```bash
# Make sure you're in the right directory
cd Integrations-backend

# Install dependencies
npm install
```

### **Issue: "TypeScript errors"**
```bash
# Build first
npm run build

# Or use ts-node directly
npx ts-node scripts/test-error-handling.ts
```

### **Issue: "Database connection errors"**
```bash
# Tests use mocks, but if you see DB errors:
# Set USE_MOCK_SPAPI=true in .env
export USE_MOCK_SPAPI=true
```

---

## ✅ Quick Verification Checklist

- [ ] Test script runs: `npm run test:error-handling`
- [ ] All tests pass (8/8)
- [ ] No TypeScript errors
- [ ] Utilities are imported in services
- [ ] Validation is called before storage
- [ ] Duplicate detection is called

---

**Ready to test!** Run `npm run test:error-handling` now! 🚀

