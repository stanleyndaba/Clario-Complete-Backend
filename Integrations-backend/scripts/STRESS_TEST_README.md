# Evidence Ingestion Worker Stress Test

Comprehensive stress testing suite for the Evidence Ingestion Worker (Agent 4).

## Overview

This stress test verifies all critical behaviors of the Evidence Ingestion Worker under load:

1. **Concurrent Tenant Processing** - Multiple tenants ingesting simultaneously
2. **Rate Limiting** - API limits not exceeded (10 req/sec per provider)
3. **Retry Logic** - Exponential backoff on failures
4. **Storage Operations** - Files correctly uploaded to Supabase Storage
5. **Error Logging** - Failures logged to `evidence_ingestion_errors` table
6. **Incremental Sync** - Only new/updated documents processed
7. **Load Test** - Process all test users sequentially

## Prerequisites

1. **Database Setup**
   - Run migration `011_evidence_ingestion_worker.sql`
   - Ensure `evidence_sources`, `evidence_documents`, and `evidence_ingestion_errors` tables exist
   - Supabase Storage bucket `evidence-documents` should exist (or will be created)

2. **Environment Variables**
   - `SUPABASE_URL` - Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` - Service role key for database operations
   - `ENABLE_EVIDENCE_INGESTION_WORKER` - Set to `'false'` to disable auto-start (optional)

3. **Dependencies**
   - All npm dependencies installed (`npm install`)
   - TypeScript and ts-node available

## Running the Stress Test

### Option 1: Using npm script (Recommended)

```bash
cd Integrations-backend
npm run test:evidence-ingestion-stress
```

### Option 2: Direct execution

```bash
cd Integrations-backend
npx ts-node scripts/stress-test-evidence-ingestion-worker.ts
```

## Test Execution Flow

1. **Setup Phase**
   - Creates 10 test users
   - Creates 2-4 evidence sources per user (Gmail, Outlook, Drive, Dropbox)
   - Sets up test data with various configurations

2. **Test Execution**
   - Runs 7 comprehensive tests sequentially
   - Each test verifies a specific behavior
   - Tests are independent and can be run separately

3. **Cleanup Phase**
   - Removes all test data (users, sources, documents, errors)
   - Ensures no test artifacts remain

## Test Details

### Test 1: Concurrent Tenant Processing
- **Purpose**: Verify multiple tenants can be processed simultaneously
- **Method**: Process 5 users concurrently using `Promise.allSettled`
- **Success Criteria**: At least 3/5 users process successfully

### Test 2: Rate Limiting
- **Purpose**: Verify rate limiter prevents exceeding 10 req/sec per provider
- **Method**: Create multiple sources of same provider, measure processing time
- **Success Criteria**: Processing time >= expected minimum (5 sources * 100ms = 500ms)

### Test 3: Retry Logic with Exponential Backoff
- **Purpose**: Verify retry logic works with exponential backoff
- **Method**: Create source with invalid token, trigger ingestion, check error logs
- **Success Criteria**: Error logs created AND processing time >= 7 seconds (3 retries: 1s + 2s + 4s)

### Test 4: Storage Operations
- **Purpose**: Verify files are uploaded to Supabase Storage
- **Method**: Check storage bucket exists and documents have `storage_path`
- **Success Criteria**: Bucket exists AND documents with valid storage paths found

### Test 5: Error Logging
- **Purpose**: Verify failures are logged to `evidence_ingestion_errors` table
- **Method**: Create invalid source, trigger ingestion, check error logs
- **Success Criteria**: Error logs created with valid structure

### Test 6: Incremental Sync
- **Purpose**: Verify `last_synced_at` is updated after ingestion
- **Method**: Create source with `last_synced_at`, run ingestion, verify update
- **Success Criteria**: `last_synced_at` updated after ingestion

### Test 7: Load Test - All Users
- **Purpose**: Process all test users under load
- **Method**: Process all 10 test users sequentially
- **Success Criteria**: At least 70% success rate

## Expected Output

```
🚀 [STRESS TEST] Starting Evidence Ingestion Worker Stress Tests
================================================================================
🔧 [STRESS TEST] Setting up test data...
✅ [STRESS TEST] Created 10 test users with 30 sources

🧪 [STRESS TEST] Running: Concurrent Tenant Processing
✅ User stress-test-user-xxx processed successfully
...

================================================================================
STRESS TEST SUMMARY
================================================================================
Total Tests: 7
Passed: 7 ✅
Failed: 0
Total Duration: 45230ms (45.23s)
================================================================================

📊 Detailed Results:
✅ PASS - Concurrent Tenant Processing
  Duration: 5234ms
  Details: {...}

...

================================================================================
🎉 ALL TESTS PASSED! Evidence Ingestion Worker is production-ready.
================================================================================
```

## Troubleshooting

### Test Failures

1. **Database Connection Issues**
   - Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
   - Check database is accessible
   - Ensure migrations are run

2. **Storage Bucket Issues**
   - Bucket may need to be created manually in Supabase dashboard
   - Verify service role key has storage permissions
   - Check RLS policies allow service role access

3. **Rate Limiting Test Fails**
   - May indicate rate limiter not working correctly
   - Check worker implementation for rate limiting logic
   - Verify `RateLimiter` class is functioning

4. **Retry Logic Test Fails**
   - May indicate retry logic not working
   - Check `retryWithBackoff` function implementation
   - Verify error logging is working

### Common Issues

- **"Cannot list buckets"**: Service role key may not have storage permissions
- **"Column user_id does not exist"**: Database schema may use `seller_id` instead
- **"No users with connected evidence sources"**: Test data setup may have failed

## Notes

- Tests create real database records (cleaned up after)
- Tests may take 30-60 seconds to complete
- Some tests may fail in development if external services are unavailable
- All test data is prefixed with `stress-test-` for easy identification

## Next Steps

After stress tests pass:
1. Review detailed test results
2. Check for any warnings or edge cases
3. Verify worker is production-ready
4. Proceed to Agent 5 (Document Parsing Agent)



