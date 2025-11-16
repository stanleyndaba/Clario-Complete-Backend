# Test Agent 3 Discovery Agent - Verify it's working and generating real results
# This test verifies:
# 1. Agent 3 receives data from Agent 2
# 2. Agent 3 generates detection results
# 3. Agent 3 stores results in database
# 4. Results are queryable via API

$userId = "demo-user"
$apiUrl = "https://opside-node-api.onrender.com"

Write-Host ""
Write-Host "Testing Agent 3 Discovery Agent" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Start a sync (Agent 1 → Agent 2 → Agent 3)
Write-Host "Step 1: Starting sync (Agent 1 → Agent 2 → Agent 3)..." -ForegroundColor Yellow
try {
    $syncResponse = Invoke-RestMethod -Uri "$apiUrl/api/sync/start" `
        -Method POST `
        -Headers @{ "x-user-id" = $userId } `
        -ErrorAction Stop
    
    $syncId = $syncResponse.syncId
    Write-Host "   Sync ID: $syncId" -ForegroundColor Gray
    Write-Host "   ✅ Sync started" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Failed to start sync: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Wait for sync to complete (with timeout)
Write-Host "Step 2: Waiting for sync to complete (Agent 3 should finish)..." -ForegroundColor Yellow
$maxWait = 120 # 2 minutes
$startTime = Get-Date
$syncComplete = $false
$agent3Completed = $false
$claimsDetected = 0

while (-not $syncComplete -and ((Get-Date) - $startTime).TotalSeconds -lt $maxWait) {
    Start-Sleep -Seconds 3
    
    try {
        $status = Invoke-RestMethod -Uri "$apiUrl/api/sync/status/$syncId" `
            -Method GET `
            -Headers @{ "x-user-id" = $userId } `
            -ErrorAction Stop
        
        $progress = $status.progress
        $statusMsg = $status.status
        $claimsDetected = if ($status.claimsDetected) { $status.claimsDetected } else { 0 }
        
        Write-Host "   Progress: $progress% | Status: $statusMsg | Claims Detected: $claimsDetected" -ForegroundColor Gray
        
        # Check if Agent 3 completed (claims detected > 0 means Agent 3 finished)
        if ($claimsDetected -gt 0) {
            $agent3Completed = $true
        }
        
        if ($status.status -eq "completed") {
            $syncComplete = $true
            Write-Host "   ✅ Sync completed!" -ForegroundColor Green
        } elseif ($status.status -eq "failed") {
            $syncComplete = $true
            Write-Host "   ❌ Sync failed: $($status.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "   ⚠️ Status check error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""

# Step 3: Check if Agent 3 generated detection results
Write-Host "Step 3: Checking if Agent 3 generated detection results..." -ForegroundColor Yellow
Start-Sleep -Seconds 5 # Give Agent 3 time to finish writing

try {
    $detections = Invoke-RestMethod -Uri "$apiUrl/api/detections/results?limit=20" `
        -Method GET `
        -Headers @{ "x-user-id" = $userId } `
        -ErrorAction Stop
    
    if ($detections.success -and $detections.results.Count -gt 0) {
        Write-Host "   ✅ Agent 3 generated $($detections.results.Count) detection results" -ForegroundColor Green
        Write-Host ""
        Write-Host "   Sample Detection Results:" -ForegroundColor Cyan
        Write-Host "   =========================" -ForegroundColor Cyan
        
        $sampleCount = [Math]::Min(5, $detections.results.Count)
        for ($i = 0; $i -lt $sampleCount; $i++) {
            $det = $detections.results[$i]
            Write-Host ""
            Write-Host "   Detection #$($i+1):" -ForegroundColor Yellow
            Write-Host "     - Type: $($det.anomaly_type)" -ForegroundColor White
            Write-Host "     - Severity: $($det.severity)" -ForegroundColor White
            Write-Host "     - Value: $($det.estimated_value) $($det.currency)" -ForegroundColor White
            Write-Host "     - Confidence: $([math]::Round($det.confidence_score * 100, 1))%" -ForegroundColor White
            Write-Host "     - Status: $($det.status)" -ForegroundColor White
        }
        
        Write-Host ""
        Write-Host "   ✅ Agent 3 Discovery Agent is WORKING!" -ForegroundColor Green
    } else {
        Write-Host "   ❌ No detection results found" -ForegroundColor Red
        Write-Host "   This means Agent 3 did not generate any detections" -ForegroundColor Red
    }
} catch {
    Write-Host "   ❌ Failed to fetch detection results: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Step 4: Summary
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "============" -ForegroundColor Cyan
Write-Host "Sync Status: $(if ($syncComplete) { 'Completed' } else { 'Timed Out' })" -ForegroundColor $(if ($syncComplete) { 'Green' } else { 'Yellow' })
Write-Host "Agent 3 Completed: $(if ($agent3Completed) { 'Yes' } else { 'No' })" -ForegroundColor $(if ($agent3Completed) { 'Green' } else { 'Red' })
Write-Host "Claims Detected: $claimsDetected" -ForegroundColor $(if ($claimsDetected -gt 0) { 'Green' } else { 'Red' })
Write-Host "Detection Results in DB: $(if ($detections.success -and $detections.results.Count -gt 0) { "$($detections.results.Count) results" } else { 'None' })" -ForegroundColor $(if ($detections.success -and $detections.results.Count -gt 0) { 'Green' } else { 'Red' })

Write-Host ""

if ($agent3Completed -and $detections.success -and $detections.results.Count -gt 0) {
    Write-Host "🎉 SUCCESS: Agent 3 Discovery Agent is working correctly!" -ForegroundColor Green
    Write-Host "   - Agent 3 received data from Agent 2" -ForegroundColor Green
    Write-Host "   - Agent 3 generated detection results" -ForegroundColor Green
    Write-Host "   - Agent 3 stored results in database" -ForegroundColor Green
    exit 0
} else {
    Write-Host "⚠️ ISSUE: Agent 3 Discovery Agent may not be working correctly" -ForegroundColor Yellow
    Write-Host "   Check the logs above for details" -ForegroundColor Yellow
    exit 1
}


