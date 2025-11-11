# Sync Investigation Report

## Critical Issues Found and Fixed

### Issue 1: `getSyncResults()` Always Returned Zeros ✅ FIXED
**Problem:**
- The `getSyncResults()` method in `syncJobManager.ts` was returning hardcoded zeros instead of querying the database
- This caused `claimsDetected` to always show 0 in sync status, even when discrepancies were found

**Fix:**
- Updated `getSyncResults()` to query actual detection results from the `detection_results` table
- Queries financial events to count orders processed
- Falls back to synced claims count if detection results aren't available yet

**Location:** `Integrations-backend/src/services/syncJobManager.ts:546-628`

### Issue 2: Detection Never Completed Before Sync Finished ✅ FIXED
**Problem:**
- Sync completed immediately after triggering detection job
- Detection runs asynchronously via Redis queue, so it hadn't finished when sync status was calculated
- This caused sync to show 0 claims detected even if detection was still running

**Fix:**
- Added polling mechanism to wait for detection to complete (up to 60 seconds)
- Polls `detection_queue` table for job status
- Also checks `detection_results` table for results
- Updates sync status with actual detection results once detection completes

**Location:** `Integrations-backend/src/services/syncJobManager.ts:192-296`

### Issue 3: Detection Not Working Without Redis ✅ FIXED
**Problem:**
- Detection jobs were stored in database but only processed via Redis queue
- If Redis was not available, detection never ran
- `processDetectionJobs()` would silently skip processing if Redis wasn't available

**Fix:**
- Added fallback mechanism to process detection jobs directly from database when Redis is not available
- Created `processDetectionJobDirectly()` method that processes jobs without Redis
- Detection now works even if Redis is not configured

**Location:** `Integrations-backend/src/services/detectionService.ts:56-255`

## Remaining Issues

### Issue 4: Claim Detector API Returns Placeholder Data ⚠️ NEEDS ATTENTION
**Problem:**
- The Claim Detector API (`/api/v1/claim-detector/predict/batch`) always returns placeholder data
- Always returns `claimable: False` and `probability: 0.5`
- This means even if detection runs, it won't find any claimable claims

**Location:** `src/api/consolidated/claim_detector_router.py:112-139`

**Impact:**
- Detection will run and store results, but all claims will have low confidence (0.5)
- No high-confidence claims will be detected for auto-submission
- This prevents the core business value (finding discrepancies and creating claims)

**Recommendation:**
- Implement actual ML model prediction in the Claim Detector API
- Or use a fallback detection algorithm that analyzes financial events and inventory discrepancies directly
- The detection service already has fallback logic, but it also uses the same placeholder API

## How Sync Works Now

1. **Sync Starts** (`syncJobManager.startSync()`)
   - Creates sync status in database
   - Starts async sync job

2. **Data Sync** (`amazonSyncJob.syncUserData()`)
   - Fetches claims, inventory, and fees from Amazon SP-API
   - Saves to database (claims, inventory_items, financial_events tables)
   - Triggers detection job

3. **Detection Job** (`detectionService.enqueueDetectionJob()`)
   - Stores job in database (`detection_queue` table)
   - Tries to add to Redis queue (if available)
   - If Redis not available, processes directly from database

4. **Detection Processing** (`detectionService.processDetectionJobDirectly()` or `processDetectionJobs()`)
   - Gets financial events and inventory discrepancies from database
   - Calls Claim Detector API to analyze for discrepancies
   - Stores detection results in `detection_results` table with `sync_id`

5. **Sync Completion** (`syncJobManager.runSync()`)
   - Waits for detection to complete (polls up to 60 seconds)
   - Queries `detection_results` table for claims detected count
   - Updates sync status with actual results
   - Marks sync as complete

## Testing Recommendations

1. **Test Sync with Redis:**
   - Verify detection jobs are processed via Redis queue
   - Verify sync waits for detection to complete
   - Verify `claimsDetected` shows correct count

2. **Test Sync without Redis:**
   - Disable Redis or set `REDIS_URL` to invalid value
   - Verify detection jobs are processed directly from database
   - Verify sync still completes and shows detection results

3. **Test Claim Detector API:**
   - Verify API returns real predictions (not placeholders)
   - Test with actual financial events data
   - Verify high-confidence claims are detected

4. **Test End-to-End Flow:**
   - Trigger sync → Verify data is synced → Verify detection runs → Verify claims are detected → Verify sync status shows correct counts

## Database Schema

### `detection_results` table
- `sync_id` - Links detection results to sync job
- `seller_id` - User who owns the detection results
- `anomaly_type` - Type of discrepancy found
- `confidence_score` - ML confidence score (0-1)
- `estimated_value` - Estimated claim value
- `status` - Status of the detection result

### `detection_queue` table
- `sync_id` - Links detection job to sync
- `seller_id` - User who owns the job
- `status` - Job status (pending, processing, completed, failed)
- `payload` - Job data including sandbox flag

### `sync_progress` table
- `sync_id` - Unique sync identifier
- `user_id` - User who owns the sync
- `status` - Sync status (running, completed, failed)
- `progress` - Progress percentage (0-100)
- `metadata` - Includes `claimsDetected`, `ordersProcessed`, `totalOrders`

## Next Steps

1. ✅ **Fixed:** `getSyncResults()` now queries real data
2. ✅ **Fixed:** Sync waits for detection to complete
3. ✅ **Fixed:** Detection works without Redis
4. ⚠️ **TODO:** Fix Claim Detector API to return real predictions
5. ⚠️ **TODO:** Test end-to-end flow with real data
6. ⚠️ **TODO:** Monitor sync performance and detection accuracy

## Files Modified

1. `Integrations-backend/src/services/syncJobManager.ts`
   - Fixed `getSyncResults()` to query database
   - Added polling mechanism to wait for detection

2. `Integrations-backend/src/services/detectionService.ts`
   - Added fallback to process detection directly when Redis unavailable
   - Added `processDetectionJobDirectly()` method

## Conclusion

The sync system is now properly configured to:
- Wait for detection to complete before marking sync as done
- Query actual detection results from database
- Work even without Redis (fallback to direct processing)
- Show correct claims detected count in sync status

However, the Claim Detector API needs to be fixed to return real predictions instead of placeholders. Until that's fixed, detection will run but won't find high-confidence claims for auto-submission.

