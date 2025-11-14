# Evidence Ingestion Worker Stress Test - Implementation Summary

## ✅ Stress Test Script Created

**File**: `Integrations-backend/scripts/stress-test-evidence-ingestion-worker.ts`

### Test Coverage

The stress test suite includes **7 comprehensive tests**:

1. ✅ **Concurrent Tenant Processing** - Verifies multiple tenants can be processed simultaneously
2. ✅ **Rate Limiting** - Ensures API limits (10 req/sec per provider) are respected
3. ✅ **Retry Logic with Exponential Backoff** - Tests retry mechanism with 3 attempts (1s, 2s, 4s delays)
4. ✅ **Storage Operations** - Verifies files are uploaded to Supabase Storage bucket
5. ✅ **Error Logging** - Confirms failures are logged to `evidence_ingestion_errors` table
6. ✅ **Incremental Sync** - Verifies `last_synced_at` is updated after ingestion
7. ✅ **Load Test** - Processes all test users sequentially under load

### Key Features

- **Automated Setup**: Creates 10 test users with 2-4 evidence sources each
- **Comprehensive Cleanup**: Removes all test data after execution
- **Detailed Reporting**: Provides per-test results with duration, details, and errors
- **Production-Ready**: Tests real database operations and storage uploads
- **Error Handling**: Gracefully handles failures and provides detailed error messages

### Test Data

- **Test Users**: 10 users with UUID-based IDs (`stress-test-user-{uuid}`)
- **Evidence Sources**: 2-4 sources per user (Gmail, Outlook, Drive, Dropbox)
- **Test Isolation**: All test data prefixed with `stress-test-` for easy identification

### Execution

```bash
# Using npm script
npm run test:evidence-ingestion-stress

# Or directly
npx ts-node scripts/stress-test-evidence-ingestion-worker.ts
```

### Expected Duration

- **Setup**: ~2-5 seconds
- **Test Execution**: ~30-60 seconds
- **Cleanup**: ~2-5 seconds
- **Total**: ~35-70 seconds

### Success Criteria

- ✅ All 7 tests pass
- ✅ No database connection errors
- ✅ Storage bucket accessible
- ✅ Error logging functional
- ✅ Rate limiting enforced
- ✅ Retry logic working
- ✅ Incremental sync updating

## 📋 Prerequisites

1. ✅ Database migrations run (`011_evidence_ingestion_worker.sql`)
2. ✅ Supabase environment variables set
3. ✅ Storage bucket `evidence-documents` exists (or will be created)
4. ✅ All npm dependencies installed

## 🎯 Next Steps

After stress tests pass:

1. **Review Results**: Check detailed test output for any warnings
2. **Verify Metrics**: Ensure all success criteria are met
3. **Production Readiness**: Confirm worker is ready for production use
4. **Move to Agent 5**: Proceed to Document Parsing Agent implementation

## 📝 Notes

- Tests use real database operations (cleaned up after)
- Some tests may require external service availability
- Rate limiting test may vary based on system load
- Error logging test requires actual failures to verify

## 🔍 Troubleshooting

See `STRESS_TEST_README.md` for detailed troubleshooting guide.

---

**Status**: ✅ **Complete - Ready for Execution**



