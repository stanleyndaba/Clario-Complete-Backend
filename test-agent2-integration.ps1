# Agent 2 Integration Test Script
# Tests that syncJobManager correctly uses Agent2DataSyncService

param(
    [string]$IntegrationsApiUrl = "https://opside-node-api.onrender.com",
    [string]$TestUserId = "test-user-123",
    [string]$AuthToken = ""
)

$ErrorActionPreference = "Stop"

Write-Host "🧪 Agent 2 Integration Test" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Start Sync
Write-Host "1️⃣ Testing: POST /api/sync/start" -ForegroundColor Yellow
Write-Host "   URL: $IntegrationsApiUrl/api/sync/start" -ForegroundColor Gray

$headers = @{
    "Content-Type" = "application/json"
    "X-User-Id" = $TestUserId
}

if ($AuthToken) {
    $headers["Authorization"] = "Bearer $AuthToken"
    $headers["Cookie"] = "session_token=$AuthToken"
}

try {
    $startResponse = Invoke-RestMethod -Uri "$IntegrationsApiUrl/api/sync/start" `
        -Method POST `
        -Headers $headers `
        -ErrorAction Stop

    if ($startResponse.syncId) {
        $syncId = $startResponse.syncId
        Write-Host "   ✅ Sync started successfully" -ForegroundColor Green
        Write-Host "   Sync ID: $syncId" -ForegroundColor Gray
        Write-Host "   Status: $($startResponse.status)" -ForegroundColor Gray
    } else {
        Write-Host "   ❌ No syncId in response" -ForegroundColor Red
        Write-Host "   Response: $($startResponse | ConvertTo-Json)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "   ❌ Failed to start sync" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "   Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""

# Test 2: Poll Sync Status
Write-Host "2️⃣ Testing: Polling sync status" -ForegroundColor Yellow
Write-Host "   Polling every 3 seconds (max 20 attempts = 60 seconds)" -ForegroundColor Gray

$maxAttempts = 20
$attempt = 0
$completed = $false
$failed = $false

while ($attempt -lt $maxAttempts -and -not $completed -and -not $failed) {
    $attempt++
    Start-Sleep -Seconds 3

    try {
        $statusResponse = Invoke-RestMethod -Uri "$IntegrationsApiUrl/api/sync/status/$syncId" `
            -Method GET `
            -Headers $headers `
            -ErrorAction Stop

        $progress = $statusResponse.progress
        $status = $statusResponse.status
        $message = $statusResponse.message

        Write-Host "   Attempt $attempt : Progress $progress% | Status: $status" -ForegroundColor $(if ($status -eq "completed") { "Green" } elseif ($status -eq "failed") { "Red" } else { "Yellow" })
        Write-Host "      Message: $message" -ForegroundColor Gray

        if ($status -eq "completed") {
            $completed = $true
            Write-Host ""
            Write-Host "   ✅ Sync completed successfully!" -ForegroundColor Green
            
            # Show summary
            if ($statusResponse.ordersProcessed) {
                Write-Host "   Orders Processed: $($statusResponse.ordersProcessed)" -ForegroundColor Gray
            }
            if ($statusResponse.claimsDetected) {
                Write-Host "   Claims Detected: $($statusResponse.claimsDetected)" -ForegroundColor Gray
            }
            if ($statusResponse.completedAt) {
                Write-Host "   Completed At: $($statusResponse.completedAt)" -ForegroundColor Gray
            }
        } elseif ($status -eq "failed") {
            $failed = $true
            Write-Host ""
            Write-Host "   ❌ Sync failed!" -ForegroundColor Red
            if ($statusResponse.error) {
                Write-Host "   Error: $($statusResponse.error)" -ForegroundColor Red
            }
        }
    } catch {
        Write-Host "   ⚠️  Error polling status: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $completed -and -not $failed) {
    Write-Host ""
    Write-Host "   ⚠️  Sync still in progress after $maxAttempts attempts" -ForegroundColor Yellow
    Write-Host "   Check status manually: GET /api/sync/status/$syncId" -ForegroundColor Gray
}

Write-Host ""

# Test 3: Verify Agent 2 was used (check logs message)
Write-Host "3️⃣ Verification: Check backend logs for Agent 2" -ForegroundColor Yellow
Write-Host "   Look for these log messages:" -ForegroundColor Gray
Write-Host "   - '🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync'" -ForegroundColor Cyan
Write-Host "   - '🔄 [AGENT 2] Starting data sync'" -ForegroundColor Cyan
Write-Host "   - '✅ [AGENT 2] Data sync completed'" -ForegroundColor Cyan
Write-Host "   - '✅ [SYNC JOB MANAGER] Agent 2 sync completed'" -ForegroundColor Cyan
Write-Host ""
Write-Host "   If you see these messages, Agent 2 integration is working! ✅" -ForegroundColor Green
Write-Host ""

# Test 4: Check Active Sync Status
Write-Host "4️⃣ Testing: GET /api/sync/status (active sync)" -ForegroundColor Yellow

try {
    $activeStatusResponse = Invoke-RestMethod -Uri "$IntegrationsApiUrl/api/sync/status" `
        -Method GET `
        -Headers $headers `
        -ErrorAction Stop

    if ($activeStatusResponse.hasActiveSync) {
        Write-Host "   ✅ Active sync detected" -ForegroundColor Green
        Write-Host "   Sync ID: $($activeStatusResponse.lastSync.syncId)" -ForegroundColor Gray
    } else {
        Write-Host "   ℹ️  No active sync (sync may have completed)" -ForegroundColor Gray
        if ($activeStatusResponse.lastSync) {
            Write-Host "   Last Sync: $($activeStatusResponse.lastSync.syncId)" -ForegroundColor Gray
            Write-Host "   Status: $($activeStatusResponse.lastSync.status)" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "   ⚠️  Error getting active sync status: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""

# Summary
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Sync ID: $syncId" -ForegroundColor White
Write-Host "Status: $(if ($completed) { '✅ Completed' } elseif ($failed) { '❌ Failed' } else { '⏳ In Progress' })" -ForegroundColor $(if ($completed) { "Green" } elseif ($failed) { "Red" } else { "Yellow" })
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "1. Check backend logs to verify Agent 2 was used" -ForegroundColor White
Write-Host "2. Verify data was synced (check database)" -ForegroundColor White
Write-Host "3. Check that Agent 3 was auto-triggered" -ForegroundColor White
Write-Host ""






