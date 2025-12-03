# 🧪 Error Handling Testing Guide

**Date:** 2025-01-27  
**Purpose:** Comprehensive testing guide for error handling implementation

---

## 📋 Testing Overview

This guide covers three types of testing:
1. **Unit Tests** - Test error handling utilities in isolation
2. **Integration Tests** - Test error handling in service context
3. **Manual Testing** - Test error scenarios manually

---

## 🚀 Quick Start

### **1. Run All Error Handling Tests**
```bash
cd Integrations-backend
npm run test:error-handling
```

### **2. Run Unit Tests Only**
```bash
npm run test:error-handling:unit
```

### **3. Run Integration Tests Only**
```bash
npm run test:error-handling:integration
```

### **4. Run Manual Test Script**
```bash
npm run test:error-handling:manual
# or
ts-node scripts/test-error-handling.ts
```

---

## 🧪 Unit Tests

### **Test Error Handling Utilities**

**File:** `Integrations-backend/tests/utils/errorHandlingUtils.test.ts`

**Test Cases:**
1. ✅ OAuth token expiration handling
2. ✅ SP-API rate limit handling
3. ✅ Network timeout handling
4. ✅ Database connection error handling
5. ✅ Claim validation
6. ✅ Duplicate detection
7. ✅ Empty evidence handling
8. ✅ Payment failure handling

**Run:**
```bash
npm run test:error-handling:unit
```

---

## 🔗 Integration Tests

### **Test Service Integration**

**File:** `Integrations-backend/tests/services/errorHandlingIntegration.test.ts`

**Test Cases:**
1. ✅ AmazonService with error handling
2. ✅ Agent2DataSyncService with validation
3. ✅ Duplicate claim prevention
4. ✅ Invalid claim rejection
5. ✅ Network error recovery
6. ✅ Token refresh on expiration

**Run:**
```bash
npm run test:error-handling:integration
```

---

## 🖐️ Manual Testing

### **Test Script: `scripts/test-error-handling.ts`**

This script tests error handling scenarios manually:

```bash
ts-node scripts/test-error-handling.ts
```

**What It Tests:**
1. OAuth token expiration simulation
2. SP-API rate limit simulation
3. Network timeout simulation
4. Database connection failure simulation
5. Duplicate claim detection
6. Invalid claim validation
7. Empty evidence handling

---

## 📝 Manual Testing Steps

### **1. Test OAuth Token Expiration**

**Steps:**
1. Set an expired token in database
2. Make an API call that requires authentication
3. Verify token is automatically refreshed
4. Verify request succeeds after refresh

**Test Command:**
```bash
ts-node scripts/test-oauth-token-expiration.ts
```

**Expected Result:**
- ✅ Token refresh is attempted
- ✅ Request retries after refresh
- ✅ Request succeeds

---

### **2. Test SP-API Rate Limiting**

**Steps:**
1. Make multiple rapid API calls to Amazon SP-API
2. Verify rate limiter queues requests
3. Verify requests are retried with backoff
4. Verify all requests eventually succeed

**Test Command:**
```bash
ts-node scripts/test-rate-limiting.ts
```

**Expected Result:**
- ✅ Rate limit detected
- ✅ Requests queued
- ✅ Automatic retry with backoff
- ✅ All requests complete

---

### **3. Test Network Timeout**

**Steps:**
1. Set a very short timeout (e.g., 1 second)
2. Make an API call to a slow endpoint
3. Verify timeout error is caught
4. Verify retry is attempted

**Test Command:**
```bash
ts-node scripts/test-network-timeout.ts
```

**Expected Result:**
- ✅ Timeout error caught
- ✅ Retry attempted
- ✅ Error logged properly

---

### **4. Test Duplicate Claim Detection**

**Steps:**
1. Create a claim with ID "test-claim-123"
2. Try to create another claim with same ID
3. Verify duplicate is detected
4. Verify second claim is rejected

**Test Command:**
```bash
ts-node scripts/test-duplicate-detection.ts
```

**Expected Result:**
- ✅ Duplicate detected
- ✅ Second claim rejected
- ✅ Error message indicates duplicate

---

### **5. Test Claim Validation**

**Steps:**
1. Try to create a claim with missing required fields
2. Try to create a claim with invalid amount (negative)
3. Try to create a claim with invalid date (future)
4. Verify all invalid claims are rejected

**Test Command:**
```bash
ts-node scripts/test-claim-validation.ts
```

**Expected Result:**
- ✅ Missing fields rejected
- ✅ Invalid amounts rejected
- ✅ Invalid dates rejected
- ✅ Clear error messages

---

### **6. Test Database Connection Failure**

**Steps:**
1. Temporarily break database connection
2. Try to store detection results
3. Verify error is caught
4. Verify retry is attempted
5. Restore connection and verify success

**Test Command:**
```bash
ts-node scripts/test-database-errors.ts
```

**Expected Result:**
- ✅ Connection error caught
- ✅ Retry attempted
- ✅ Success after connection restored

---

## 🎯 Test Scenarios Checklist

### **OAuth Token Errors**
- [ ] Token expired (401 error)
- [ ] Token invalid (403 error)
- [ ] Token refresh succeeds
- [ ] Token refresh fails (requires reconnection)
- [ ] Multiple services with same token

### **SP-API Rate Limits**
- [ ] Rate limit detected (429 error)
- [ ] Requests queued properly
- [ ] Retry with exponential backoff
- [ ] Rate limit reset detection
- [ ] Multiple concurrent requests

### **Network Errors**
- [ ] Connection timeout
- [ ] Connection refused
- [ ] DNS failure
- [ ] Network unreachable
- [ ] Retry logic works

### **Database Errors**
- [ ] Connection failure
- [ ] Query timeout
- [ ] Transaction rollback
- [ ] Connection retry
- [ ] Graceful degradation

### **Validation Errors**
- [ ] Missing required fields
- [ ] Invalid data types
- [ ] Invalid ranges (amount, date)
- [ ] Invalid formats
- [ ] Multiple validation errors

### **Duplicate Detection**
- [ ] Duplicate claim ID
- [ ] Duplicate order + amount
- [ ] Existing dispute case
- [ ] Multiple duplicate strategies
- [ ] Graceful skip (no failure)

### **Empty Evidence**
- [ ] No evidence found
- [ ] Empty evidence array
- [ ] Graceful handling
- [ ] User notification
- [ ] Process continues

---

## 📊 Test Results Format

### **Expected Output:**
```
🧪 Error Handling Test Suite
============================

✅ OAuth Token Expiration: PASSED
✅ SP-API Rate Limiting: PASSED
✅ Network Timeout: PASSED
✅ Database Errors: PASSED
✅ Claim Validation: PASSED
✅ Duplicate Detection: PASSED
✅ Empty Evidence: PASSED

Total: 7/7 tests passed
Duration: 12.5s
```

---

## 🔧 Test Configuration

### **Environment Variables for Testing**

Create `.env.test`:
```env
# Test Database
DATABASE_URL=postgresql://test:test@localhost:5432/test_db
SUPABASE_URL=https://test.supabase.co
SUPABASE_SERVICE_ROLE_KEY=test_key

# Test API URLs
PYTHON_API_URL=http://localhost:8000
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com

# Test Mode
NODE_ENV=test
USE_MOCK_SPAPI=true
```

---

## 🐛 Debugging Failed Tests

### **1. Check Logs**
```bash
# View test logs
tail -f logs/test.log

# View error logs
tail -f logs/error.log
```

### **2. Run Single Test**
```bash
# Run specific test
npm test -- -t "OAuth token expiration"

# Run with verbose output
npm test -- --verbose
```

### **3. Check Test Coverage**
```bash
npm run test:coverage
```

---

## 📈 Success Criteria

### **All Tests Must Pass:**
- ✅ Unit tests: 100% pass rate
- ✅ Integration tests: 100% pass rate
- ✅ Manual tests: All scenarios verified

### **Error Handling Must:**
- ✅ Catch all expected errors
- ✅ Retry retryable errors
- ✅ Log errors properly
- ✅ Provide user-friendly messages
- ✅ Not crash the application

---

## 🚨 Common Issues

### **Issue 1: Tests Timeout**
**Solution:** Increase timeout in test configuration
```typescript
jest.setTimeout(30000); // 30 seconds
```

### **Issue 2: Mock Not Working**
**Solution:** Ensure mocks are properly set up
```typescript
jest.mock('../utils/errorHandlingUtils');
```

### **Issue 3: Database Connection**
**Solution:** Use test database or mocks
```typescript
process.env.DATABASE_URL = 'test_database_url';
```

---

## 📚 Next Steps

1. **Run Tests:** Execute all test suites
2. **Review Results:** Check for any failures
3. **Fix Issues:** Address any failing tests
4. **Re-run:** Verify fixes work
5. **Document:** Update test results

---

**Ready to test!** 🚀

