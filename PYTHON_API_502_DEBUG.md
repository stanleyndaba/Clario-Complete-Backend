# 🔍 Python API 502 Error Debugging

## Issue
Python API returns **502 Bad Gateway** when calling `/api/v1/claim-detector/predict/batch`

## Symptoms
- Node.js backend sends request with claims
- Python API returns 502 (no request logged in Python API)
- Detection fails with `status: "failed"`

## Possible Causes

### 1. Request Too Large
- **134 claims** (52 shipments + 37 returns + 45 settlements)
- Python API might be running out of memory or timing out
- **Solution**: Test with smaller batch (10-20 claims)

### 2. Request Validation Failing
- Missing required fields in claim objects
- Pydantic validation crashing silently
- **Solution**: Check if all required fields are present

### 3. Python API Crashing on Startup
- Import errors
- Initialization failures
- **Solution**: Check Python API startup logs

## Debugging Steps

### Step 1: Check Python API Logs
Look for:
- Any errors during startup
- Any POST requests to `/api/v1/claim-detector/predict/batch`
- Memory errors
- Timeout errors

### Step 2: Test with Smaller Batch
Modify `agent2DataSyncService.ts` to limit claims to 10-20 for testing:
```typescript
const claimsToDetect = this.prepareClaimsFromNormalizedData(validatedData, userId).slice(0, 20);
```

### Step 3: Check Request Format
Verify the request matches `BatchClaimRequest` schema:
```python
class BatchClaimRequest(BaseModel):
    claims: List[ClaimRequest]
```

Required fields in `ClaimRequest`:
- claim_id
- reason_code
- category
- subcategory
- marketplace
- fulfillment_center
- amount
- quantity
- order_value
- shipping_cost
- days_since_order
- days_since_delivery
- description
- reason
- notes (optional)
- order_id (optional)

### Step 4: Add Error Logging
Add try-catch in Python API to log the actual error:
```python
@claim_detector_router.post("/predict/batch", response_model=BatchClaimResponse)
async def predict_claims_batch(batch_request: BatchClaimRequest):
    try:
        # ... existing code ...
    except ValidationError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Batch prediction error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch prediction error: {str(e)}")
```

## Quick Fix to Test
Limit the number of claims sent to Python API to see if it's a size issue:
```typescript
// In agent2DataSyncService.ts, line ~778
const claimsToDetect = this.prepareClaimsFromNormalizedData(validatedData, userId).slice(0, 20);
```

















