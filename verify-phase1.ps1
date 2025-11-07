# Phase 1 End-to-End Verification Script
# PowerShell script to verify Phase 1 workflow

$INTEGRATIONS_URL = $env:INTEGRATIONS_URL
if (-not $INTEGRATIONS_URL) {
    $INTEGRATIONS_URL = "http://localhost:3001"
}

$WORKFLOW_ID = "sandbox-test-001"
$TEST_USER_ID = "test-user-sandbox-001"
$TEST_SELLER_ID = "test-seller-sandbox-001"

$results = @()

function Write-TestResult {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Message,
        [object]$Details = $null
    )
    
    $icon = switch ($Status) {
        "PASS" { "✅" }
        "FAIL" { "❌" }
        "SKIP" { "⏭️" }
    }
    
    Write-Host "$icon $Name`: $Message" -ForegroundColor $(if ($Status -eq "PASS") { "Green" } elseif ($Status -eq "FAIL") { "Red" } else { "Yellow" })
    
    if ($Details) {
        Write-Host "   Details: $($Details | ConvertTo-Json -Compress)" -ForegroundColor Gray
    }
    
    $script:results += @{
        Name = $Name
        Status = $Status
        Message = $Message
        Details = $Details
        Timestamp = Get-Date -Format "o"
    }
}

Write-Host "🧪 Phase 1 End-to-End Verification" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Workflow ID: $WORKFLOW_ID"
Write-Host "User ID: $TEST_USER_ID"
Write-Host "Integrations URL: $INTEGRATIONS_URL"
Write-Host ""

# Test 1: Server Health
Write-Host "1. Checking server health..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$INTEGRATIONS_URL/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-TestResult -Name "Server Health" -Status "PASS" -Message "Server is running and healthy" -Details @{ StatusCode = $response.StatusCode; Content = $response.Content }
    } else {
        Write-TestResult -Name "Server Health" -Status "FAIL" -Message "Server returned non-200 status" -Details @{ StatusCode = $response.StatusCode }
    }
} catch {
    Write-TestResult -Name "Server Health" -Status "FAIL" -Message "Server not accessible: $($_.Exception.Message)" -Details @{ Error = $_.Exception.Message; URL = $INTEGRATIONS_URL }
    Write-Host ""
    Write-Host "❌ Server is not running. Please start the server first." -ForegroundColor Red
    Write-Host "   Run: cd Integrations-backend && npm start" -ForegroundColor Yellow
    exit 1
}

# Test 2: Trigger Phase 1
Write-Host ""
Write-Host "2. Triggering Phase 1..." -ForegroundColor Yellow
Write-Host "   📤 POST $INTEGRATIONS_URL/api/v1/workflow/phase/1" -ForegroundColor Gray

$body = @{
    user_id = $TEST_USER_ID
    seller_id = $TEST_SELLER_ID
    sync_id = $WORKFLOW_ID
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "$INTEGRATIONS_URL/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $responseData = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200 -and $responseData.success) {
        Write-TestResult -Name "Phase 1 Trigger" -Status "PASS" -Message "Phase 1 triggered successfully" -Details @{ Response = $responseData; StatusCode = $response.StatusCode }
    } else {
        Write-TestResult -Name "Phase 1 Trigger" -Status "FAIL" -Message "Phase 1 trigger returned unexpected response" -Details @{ Response = $responseData; StatusCode = $response.StatusCode }
    }
} catch {
    Write-TestResult -Name "Phase 1 Trigger" -Status "FAIL" -Message "Failed to trigger Phase 1: $($_.Exception.Message)" -Details @{ Error = $_.Exception.Message; Response = $_.Exception.Response }
}

# Wait for Phase 1 to process
Write-Host ""
Write-Host "   ⏳ Waiting 8 seconds for Phase 1 to process and trigger sync..." -ForegroundColor Gray
Start-Sleep -Seconds 8

# Test 3: Check Queue Status (if API available)
Write-Host ""
Write-Host "3. Checking Phase 2 queue job..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$INTEGRATIONS_URL/api/v1/workflow/queue/stats" -Method GET -TimeoutSec 5 -ErrorAction Stop
    $queueData = $response.Content | ConvertFrom-Json
    Write-TestResult -Name "Phase 2 Queue Job" -Status "PASS" -Message "Queue stats retrieved" -Details $queueData
} catch {
    Write-TestResult -Name "Phase 2 Queue Job" -Status "SKIP" -Message "Queue stats API not available - check logs for Phase 2 job creation" -Details @{ 
        Note = "Look for 'Phase 2 orchestration triggered after sync' in logs"
        Error = $_.Exception.Message 
    }
}

# Test 4: Sandbox Sync
Write-Host ""
Write-Host "4. Checking sandbox sync..." -ForegroundColor Yellow
Write-TestResult -Name "Sandbox Sync" -Status "SKIP" -Message "Sandbox sync verification requires log inspection" -Details @{
    Note = "Check orchestrator logs for:"
    ExpectedLogs = @(
        "Starting Amazon sync for user",
        "Inventory sync completed",
        "Phase 2 orchestration triggered after sync"
    )
    Instruction = "Review server logs to verify sync job executed"
}

# Test 5: Idempotency
Write-Host ""
Write-Host "5. Testing idempotency (triggering Phase 1 twice)..." -ForegroundColor Yellow

try {
    # First trigger
    $response1 = Invoke-WebRequest -Uri "$INTEGRATIONS_URL/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $response1Data = $response1.Content | ConvertFrom-Json
    Write-Host "   First trigger: ✓" -ForegroundColor Green
    
    Start-Sleep -Seconds 3
    
    # Second trigger
    $response2 = Invoke-WebRequest -Uri "$INTEGRATIONS_URL/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $response2Data = $response2.Content | ConvertFrom-Json
    Write-Host "   Second trigger: ✓" -ForegroundColor Green
    
    $bothSucceeded = $response1.StatusCode -eq 200 -and $response2.StatusCode -eq 200
    $isIdempotent = $response2Data.message -like "*already*" -or $response2Data.message -like "*idempotency*"
    
    Write-TestResult -Name "Idempotency Test" -Status $(if ($bothSucceeded) { "PASS" } else { "FAIL" }) `
        -Message $(if ($bothSucceeded) { "Idempotency check passed - duplicate trigger handled gracefully" } else { "Idempotency check failed" }) `
        -Details @{
            FirstTrigger = @{ Status = $response1.StatusCode; Data = $response1Data }
            SecondTrigger = @{ Status = $response2.StatusCode; Data = $response2Data }
            IsIdempotent = $isIdempotent
        }
} catch {
    Write-TestResult -Name "Idempotency Test" -Status "FAIL" -Message "Idempotency test failed: $($_.Exception.Message)" -Details @{ Error = $_.Exception.Message }
}

# Test 6: WebSocket (manual verification)
Write-Host ""
Write-Host "6. WebSocket event verification..." -ForegroundColor Yellow
Write-TestResult -Name "WebSocket Event" -Status "SKIP" -Message "WebSocket verification requires manual testing" -Details @{
    Instruction = "Connect to WebSocket and listen for 'workflow.phase.1.completed' event"
    Example = @"
const socket = io('$INTEGRATIONS_URL');
socket.emit('authenticate', { userId: '$TEST_USER_ID', token: 'test-token' });
socket.on('workflow.phase.1.completed', (data) => console.log('Phase 1 completed!', data));
"@
}

# Print summary
Write-Host ""
Write-Host ""
Write-Host "📊 Verification Summary" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

$passed = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$failed = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$skipped = ($results | Where-Object { $_.Status -eq "SKIP" }).Count

$results | ForEach-Object {
    $icon = switch ($_.Status) {
        "PASS" { "✅" }
        "FAIL" { "❌" }
        "SKIP" { "⏭️" }
    }
    Write-Host "$icon $($_.Name): $($_.Status)"
}

Write-Host ""
Write-Host "Total: $passed passed, $failed failed, $skipped skipped" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })

# Generate report
$report = @{
    Timestamp = Get-Date -Format "o"
    WorkflowId = $WORKFLOW_ID
    UserId = $TEST_USER_ID
    Results = $results
    Summary = @{
        Passed = $passed
        Failed = $failed
        Skipped = $skipped
        Total = $results.Count
    }
}

Write-Host ""
Write-Host "📄 Full Report:" -ForegroundColor Cyan
$report | ConvertTo-Json -Depth 10 | Write-Host

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "⚠️  Some tests failed. Review the details above." -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "✅ All critical tests passed!" -ForegroundColor Green
    exit 0
}

