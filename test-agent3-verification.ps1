# Agent 3 End-to-End Verification Test
$userId = "demo-user"
$apiUrl = "https://opside-node-api.onrender.com"

Write-Host "🧪 Agent 3 End-to-End Verification" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if detection results exist
Write-Host "📊 Step 1: Check Current Detection Results" -ForegroundColor Yellow
try {
    $detectionRes = Invoke-RestMethod -Uri "$apiUrl/api/detections/results?limit=10" `
        -Method GET `
        -Headers @{
            "Content-Type" = "application/json"
            "x-user-id" = $userId
        } `
        -ErrorAction Stop
    
    Write-Host "  Current Results: $($detectionRes.results.Count)" -ForegroundColor $(if ($detectionRes.results.Count -gt 0) { 'Green' } else { 'Yellow' })
    Write-Host "  Total: $($detectionRes.total)" -ForegroundColor White
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Step 2: Start a sync
Write-Host "🔄 Step 2: Start a Sync (Agent 2 → Agent 3)" -ForegroundColor Yellow
Write-Host "  This will trigger Agent 2, which should automatically trigger Agent 3" -ForegroundColor Gray
Write-Host ""
Write-Host "  To start sync, go to:" -ForegroundColor White
Write-Host "  https://your-frontend-url/sync" -ForegroundColor Cyan
Write-Host "  Click 'Start Sync' button" -ForegroundColor White
Write-Host ""

# Step 3: Wait and check
Write-Host "⏳ Step 3: After Sync Completes" -ForegroundColor Yellow
Write-Host "  Wait for sync to complete (usually 1-2 minutes)" -ForegroundColor Gray
Write-Host "  Then check detection results again..." -ForegroundColor Gray
Write-Host ""

# Step 4: Verify Agent 3 ran
Write-Host "🔍 Step 4: Verify Agent 3 Ran" -ForegroundColor Yellow
Write-Host "  Check Render logs for:" -ForegroundColor White
Write-Host "    ✅ '🔍 [AGENT 2→3] Triggering Agent 3 claim detection'" -ForegroundColor Green
Write-Host "    ✅ '✅ [AGENT 2→3] Agent 3 detection completed'" -ForegroundColor Green
Write-Host "    ✅ '✅ [AGENT 3] Detection results stored'" -ForegroundColor Green
Write-Host ""

# Step 5: Check results again
Write-Host "📊 Step 5: Check Detection Results After Sync" -ForegroundColor Yellow
Write-Host "  Run this script again after sync completes" -ForegroundColor Gray
Write-Host "  Expected: 74+ detection results" -ForegroundColor Green
Write-Host ""

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "📋 What to Look For:" -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Agent 3 Works If:" -ForegroundColor Green
Write-Host "  1. Sync completes successfully" -ForegroundColor White
Write-Host "  2. Logs show 'Agent 3 detection completed'" -ForegroundColor White
Write-Host "  3. API returns 74+ detection results" -ForegroundColor White
Write-Host "  4. Recoveries page shows detected claims" -ForegroundColor White
Write-Host ""
Write-Host "❌ Agent 3 Not Working If:" -ForegroundColor Red
Write-Host "  1. Logs show 'Agent 3 detection failed'" -ForegroundColor White
Write-Host "  2. No detection results in database" -ForegroundColor White
Write-Host "  3. API still returns 0 results after sync" -ForegroundColor White
Write-Host ""

