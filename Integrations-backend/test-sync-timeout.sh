#!/bin/bash
# Sync Agent Timeout Test Script
# Tests that sync completes within 30 seconds

set -e

# Configuration
BASE_URL="${INTEGRATIONS_API_URL:-http://localhost:3000}"
USER_ID="demo-user"
TIMEOUT_SECONDS=30
MAX_SYNC_TIME_MS=$((TIMEOUT_SECONDS * 1000))

echo "🧪 Sync Agent Timeout Test"
echo "================================"
echo "Base URL: $BASE_URL"
echo "User ID: $USER_ID"
echo "Max Sync Time: $TIMEOUT_SECONDS seconds"
echo ""

# Test 1: Check SSE Connection Status
echo "📡 Test 1: Checking SSE Connection Status..."
if curl -s -f -H "X-User-Id: $USER_ID" "$BASE_URL/api/sse/connection-status" > /dev/null 2>&1; then
    SSE_STATUS=$(curl -s -H "X-User-Id: $USER_ID" "$BASE_URL/api/sse/connection-status")
    echo "✅ SSE Connection Status:"
    echo "$SSE_STATUS" | jq -r '. | "   Has Connection: \(.hasConnection)\n   Connection Count: \(.connectionCount)\n   Connected Users: \(.allConnectedUsers | join(", "))"'
    
    HAS_CONNECTION=$(echo "$SSE_STATUS" | jq -r '.hasConnection')
    if [ "$HAS_CONNECTION" != "true" ]; then
        echo "⚠️  WARNING: No SSE connection found. SSE events may not be received."
        echo "   Please open SSE connection first: GET /api/sse/status"
    fi
else
    echo "⚠️  Could not check SSE connection status (may not be connected)"
fi
echo ""

# Test 2: Start Sync and Measure Time
echo "🔄 Test 2: Starting Sync and Measuring Time..."
SYNC_START_TIME_MS=$(date +%s%3N)

START_RESPONSE=$(curl -s -X POST \
    -H "X-User-Id: $USER_ID" \
    -H "Content-Type: application/json" \
    "$BASE_URL/api/sync/start")

SYNC_ID=$(echo "$START_RESPONSE" | jq -r '.syncId')
STATUS=$(echo "$START_RESPONSE" | jq -r '.status')

if [ -z "$SYNC_ID" ] || [ "$SYNC_ID" == "null" ]; then
    echo "❌ FAIL: Could not start sync"
    echo "Response: $START_RESPONSE"
    exit 1
fi

echo "✅ Sync started successfully"
echo "   Sync ID: $SYNC_ID"
echo "   Status: $STATUS"
echo ""

# Test 3: Poll for Sync Completion
echo "⏱️  Test 3: Polling for Sync Completion (max $TIMEOUT_SECONDS seconds)..."
POLL_INTERVAL=1
MAX_POLLS=$((TIMEOUT_SECONDS + 5))
POLL_COUNT=0
SYNC_COMPLETED=false
SYNC_FAILED=false
FINAL_STATUS=""

while [ $POLL_COUNT -lt $MAX_POLLS ] && [ "$SYNC_COMPLETED" != "true" ] && [ "$SYNC_FAILED" != "true" ]; do
    sleep $POLL_INTERVAL
    POLL_COUNT=$((POLL_COUNT + 1))
    
    STATUS_RESPONSE=$(curl -s -H "X-User-Id: $USER_ID" "$BASE_URL/api/sync/status/$SYNC_ID")
    STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status')
    PROGRESS=$(echo "$STATUS_RESPONSE" | jq -r '.progress // 0')
    MESSAGE=$(echo "$STATUS_RESPONSE" | jq -r '.message // ""')
    
    echo "   [$POLL_COUNT] Status: $STATUS | Progress: $PROGRESS% | $MESSAGE"
    
    if [ "$STATUS" == "completed" ]; then
        SYNC_COMPLETED=true
        FINAL_STATUS="$STATUS_RESPONSE"
    elif [ "$STATUS" == "failed" ]; then
        SYNC_FAILED=true
        FINAL_STATUS="$STATUS_RESPONSE"
    fi
done

# Calculate elapsed time
SYNC_END_TIME_MS=$(date +%s%3N)
ELAPSED_MS=$((SYNC_END_TIME_MS - SYNC_START_TIME_MS))
ELAPSED_SECONDS=$(echo "scale=2; $ELAPSED_MS / 1000" | bc)

echo ""
echo "⏱️  Sync Duration: ${ELAPSED_SECONDS}s (${ELAPSED_MS}ms)"

# Test 4: Verify Results
echo ""
echo "📊 Test 4: Verifying Results..."

if [ "$SYNC_COMPLETED" == "true" ]; then
    echo "✅ Sync completed successfully!"
    
    # Check if within timeout (using bc for floating point comparison)
    if (( $(echo "$ELAPSED_SECONDS <= $TIMEOUT_SECONDS" | bc -l) )); then
        echo "✅ PASS: Sync completed within $TIMEOUT_SECONDS seconds (${ELAPSED_SECONDS}s)"
    else
        echo "❌ FAIL: Sync took longer than $TIMEOUT_SECONDS seconds (${ELAPSED_SECONDS}s)"
        exit 1
    fi
    
    echo ""
    echo "📈 Sync Results:"
    echo "$FINAL_STATUS" | jq -r '
        "   Orders Processed: \(.ordersProcessed // 0)",
        "   Total Orders: \(.totalOrders // 0)",
        "   Inventory Count: \(.inventoryCount // 0)",
        "   Shipments Count: \(.shipmentsCount // 0)",
        "   Returns Count: \(.returnsCount // 0)",
        "   Settlements Count: \(.settlementsCount // 0)",
        "   Fees Count: \(.feesCount // 0)",
        "   Claims Detected: \(.claimsDetected // 0)"'
    
elif [ "$SYNC_FAILED" == "true" ]; then
    echo "❌ Sync failed!"
    ERROR=$(echo "$FINAL_STATUS" | jq -r '.error // "Unknown error"')
    MESSAGE=$(echo "$FINAL_STATUS" | jq -r '.message // "Unknown"')
    echo "   Error: $ERROR"
    echo "   Message: $MESSAGE"
    
    if echo "$ERROR" | grep -q "timeout"; then
        echo "❌ FAIL: Sync timed out after ${ELAPSED_SECONDS}s"
    else
        echo "❌ FAIL: Sync failed with error (not timeout)"
    fi
    exit 1
    
else
    echo "❌ FAIL: Sync did not complete within polling time (${MAX_POLLS}s)"
    echo "   Last Status: $STATUS"
    echo "   Elapsed Time: ${ELAPSED_SECONDS}s"
    
    # Check if exceeded timeout
    if (( $(echo "$ELAPSED_SECONDS > $TIMEOUT_SECONDS" | bc -l) )); then
        echo "❌ FAIL: Sync exceeded $TIMEOUT_SECONDS second timeout"
    fi
    exit 1
fi

echo ""
echo "✅ All tests passed!"
echo "================================"




