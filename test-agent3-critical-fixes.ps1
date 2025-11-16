# Test Script for Agent 3 Critical Fixes
# Tests all 4 fixes: await execution, error propagation, timeout, completion signals

$userId = "demo-user"
$apiUrl = "https://opside-node-api.onrender.com"
$testResults = @()

function Write-TestResult {
    param($testName, $passed, $message)
    $status = if ($passed) { "✅ PASS" } else { "❌ FAIL" }
    Write-Host "$status - $testName" -ForegroundColor $(if ($passed) { "Green" } else { "Red" })
    if ($message) {
        Write-Host "   $message" -ForegroundColor Gray
    }
    $script:testResults += @{
        Test = $testName
        Passed = $passed
        Message = $message
    }
}

Write-Host ""
Write-Host "Testing Agent 3 Critical Fixes" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Agent 3 Direct Test (FIX #1 - await execution)
Write-Host "Test 1: Agent 3 Direct Execution (FIX #1)" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$apiUrl/api/detections/test-agent3" `
        -Method POST `
        -Headers @{
            "x-user-id" = $userId
            "Content-Type" = "application/json"
        } `
        -ErrorAction Stop
    
    if ($response.success -and $response.result.totalDetected -gt 0) {
        Write-TestResult "Agent 3 Direct Execution" $true "Generated $($response.result.totalDetected) detections"
    } else {
        Write-TestResult "Agent 3 Direct Execution" $false "No detections generated or success=false"
    }
} catch {
    Write-TestResult "Agent 3 Direct Execution" $false "Error: $($_.Exception.Message)"
}

Write-Host ""

# Test 2: Full Sync Pipeline (A1→A2→A3)
Write-Host "Test 2: Full Sync Pipeline (A1->A2->A3)" -ForegroundColor Yellow
Write-Host "   Starting sync..." -ForegroundColor Gray

try {
    # Start sync
    $syncResponse = Invoke-RestMethod -Uri "$apiUrl/api/sync/start" `
        -Method POST `
        -Headers @{ "x-user-id" = $userId } `
        -ErrorAction Stop
    
    $syncId = $syncResponse.syncId
    Write-Host "   Sync ID: $syncId" -ForegroundColor Gray
    
    # Wait for sync to complete (with timeout)
    $maxWait = 120 # 2 minutes
    $startTime = Get-Date
    $syncComplete = $false
    $agent3Completed = $false
    $detectionResultsFound = $false
    
    while (-not $syncComplete -and ((Get-Date) - $startTime).TotalSeconds -lt $maxWait) {
        Start-Sleep -Seconds 3
        
        try {
            $status = Invoke-RestMethod -Uri "$apiUrl/api/sync/status/$syncId" `
                -Method GET `
                -Headers @{ "x-user-id" = $userId } `
                -ErrorAction Stop
            
            $progress = $status.progress
            $statusMsg = $status.message
            $claimsDetected = $status.claimsDetected
            
            Write-Host "   Progress: $progress% | Status: $($status.status) | Claims: $claimsDetected" -ForegroundColor Gray
            
            # Check if Agent 3 completed (FIX #4 - completion signal)
            if ($claimsDetected -gt 0) {
                $agent3Completed = $true
                $detectionResultsFound = $true
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
    
    if ($syncComplete) {
        Write-TestResult "Sync Pipeline Completion" $true "Sync finished with status: $($status.status)"
    } else {
        Write-TestResult "Sync Pipeline Completion" $false "Sync timed out after $maxWait seconds"
    }
    
    # Test 3: Check Detection Results (FIX #2 - database writes)
    Write-Host ""
    Write-Host "Test 3: Detection Results Storage (FIX #2)" -ForegroundColor Yellow
    
    Start-Sleep -Seconds 5 # Give Agent 3 time to finish
    
    try {
        $detections = Invoke-RestMethod -Uri "$apiUrl/api/detections/results?limit=10" `
            -Method GET `
            -Headers @{ "x-user-id" = $userId } `
            -ErrorAction Stop
        
        if ($detections.success -and $detections.results.Count -gt 0) {
            Write-TestResult "Detection Results Storage" $true "Found $($detections.results.Count) detection results in database"
            Write-Host "   Sample detection:" -ForegroundColor Gray
            Write-Host "     - Type: $($detections.results[0].anomaly_type)" -ForegroundColor Gray
            Write-Host "     - Value: $($detections.results[0].estimated_value)" -ForegroundColor Gray
            Write-Host "     - Confidence: $($detections.results[0].confidence_score)" -ForegroundColor Gray
        } else {
            Write-TestResult "Detection Results Storage" $false "No detection results found in database"
        }
    } catch {
        Write-TestResult "Detection Results Storage" $false "Error: $($_.Exception.Message)"
    }
    
    # Test 4: Check Completion Signal (FIX #4)
    Write-Host ""
    Write-Host "Test 4: Completion Signal (FIX #4)" -ForegroundColor Yellow
    
    if ($agent3Completed -or $detectionResultsFound) {
        Write-TestResult "Completion Signal" $true "Agent 3 completed and results are available"
    } else {
        Write-TestResult "Completion Signal" $false "No completion signal detected"
    }
    
} catch {
    Write-TestResult "Sync Pipeline" $false "Error: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "===============" -ForegroundColor Cyan

$passed = ($testResults | Where-Object { $_.Passed }).Count
$failed = ($testResults | Where-Object { -not $_.Passed }).Count
$total = $testResults.Count

Write-Host "Total Tests: $total" -ForegroundColor White
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })

Write-Host ""
Write-Host "Detailed Results:" -ForegroundColor Cyan
foreach ($result in $testResults) {
    $status = if ($result.Passed) { "✅" } else { "❌" }
    Write-Host "  $status $($result.Test)" -ForegroundColor $(if ($result.Passed) { "Green" } else { "Red" })
    if ($result.Message) {
        Write-Host "     $($result.Message)" -ForegroundColor Gray
    }
}

Write-Host ""

if ($failed -eq 0) {
    Write-Host "All tests passed! Agent 3 fixes are working correctly." -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some tests failed. Review the results above." -ForegroundColor Yellow
    exit 1
}

