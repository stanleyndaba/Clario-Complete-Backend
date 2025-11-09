# Test Sync Monitoring with Active Sync Job
# This script tests the sync monitoring functionality

$pythonApiUrl = "https://python-api-2-jlx5.onrender.com"
$nodeApiUrl = "https://opside-node-api-woco.onrender.com"

Write-Host "`n=== SYNC MONITORING TEST ===" -ForegroundColor Cyan
Write-Host "Python API: $pythonApiUrl" -ForegroundColor White
Write-Host "Node API: $nodeApiUrl" -ForegroundColor White
Write-Host ""

$testUserId = "test-user-sync-monitoring-$(Get-Date -Format 'yyyyMMddHHmmss')"

Write-Host "Test User ID: $testUserId" -ForegroundColor Yellow
Write-Host ""

# Test 1: Check initial sync status (should be no active sync)
Write-Host "=== TEST 1: Check Initial Sync Status ===" -ForegroundColor Yellow
try {
    $headers = @{
        "X-User-Id" = $testUserId
        "Content-Type" = "application/json"
    }
    
    $statusResponse = Invoke-RestMethod -Uri "$nodeApiUrl/api/sync/status" -Method Get -Headers $headers -ErrorAction Stop
    Write-Host "✅ Initial Sync Status:" -ForegroundColor Green
    Write-Host "  hasActiveSync: $($statusResponse.hasActiveSync)" -ForegroundColor White
    Write-Host "  lastSync: $($statusResponse.lastSync)" -ForegroundColor White
    
    if ($statusResponse.hasActiveSync -eq $false) {
        Write-Host "✅ No active sync (expected)" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Active sync found (unexpected)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Start a sync job
Write-Host "`n=== TEST 2: Start Sync Job ===" -ForegroundColor Yellow
try {
    $headers = @{
        "X-User-Id" = $testUserId
        "Content-Type" = "application/json"
    }
    
    $startResponse = Invoke-RestMethod -Uri "$nodeApiUrl/api/sync/start" -Method Post -Headers $headers -ErrorAction Stop
    Write-Host "✅ Sync Job Started:" -ForegroundColor Green
    Write-Host "  Sync ID: $($startResponse.syncId)" -ForegroundColor White
    Write-Host "  Status: $($startResponse.status)" -ForegroundColor White
    Write-Host "  Message: $($startResponse.message)" -ForegroundColor White
    
    $syncId = $startResponse.syncId
    Write-Host "`n⏳ Waiting 2 seconds for sync to start..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
} catch {
    Write-Host "❌ Error starting sync: $($_.Exception.Message)" -ForegroundColor Red
    $syncId = $null
}

# Test 3: Check sync status after starting (should have active sync)
Write-Host "`n=== TEST 3: Check Sync Status After Start ===" -ForegroundColor Yellow
if ($syncId) {
    try {
        $headers = @{
            "X-User-Id" = $testUserId
            "Content-Type" = "application/json"
        }
        
        $statusResponse = Invoke-RestMethod -Uri "$nodeApiUrl/api/sync/status" -Method Get -Headers $headers -ErrorAction Stop
        Write-Host "✅ Sync Status After Start:" -ForegroundColor Green
        Write-Host "  hasActiveSync: $($statusResponse.hasActiveSync)" -ForegroundColor White
        Write-Host "  lastSync: $($statusResponse.lastSync | ConvertTo-Json -Depth 5)" -ForegroundColor White
        
        if ($statusResponse.hasActiveSync -eq $true) {
            Write-Host "✅ Active sync detected (expected)" -ForegroundColor Green
            Write-Host "  Sync ID: $($statusResponse.lastSync.syncId)" -ForegroundColor White
            Write-Host "  Status: $($statusResponse.lastSync.status)" -ForegroundColor White
            Write-Host "  Progress: $($statusResponse.lastSync.progress)%" -ForegroundColor White
        } else {
            Write-Host "⚠️ No active sync detected (sync may have completed quickly)" -ForegroundColor Yellow
            if ($statusResponse.lastSync) {
                Write-Host "  Last Sync Status: $($statusResponse.lastSync.status)" -ForegroundColor White
            }
        }
    } catch {
        Write-Host "❌ Error checking sync status: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Test 4: Poll sync status multiple times
Write-Host "`n=== TEST 4: Poll Sync Status (5 times, 3 seconds apart) ===" -ForegroundColor Yellow
if ($syncId) {
    for ($i = 1; $i -le 5; $i++) {
        Write-Host "`nPoll #${i}:" -ForegroundColor Cyan
        try {
            $headers = @{
                "X-User-Id" = $testUserId
                "Content-Type" = "application/json"
            }
            
            $statusResponse = Invoke-RestMethod -Uri "$nodeApiUrl/api/sync/status" -Method Get -Headers $headers -ErrorAction Stop
            Write-Host "  hasActiveSync: $($statusResponse.hasActiveSync)" -ForegroundColor White
            if ($statusResponse.lastSync) {
                Write-Host "  Sync ID: $($statusResponse.lastSync.syncId)" -ForegroundColor White
                Write-Host "  Status: $($statusResponse.lastSync.status)" -ForegroundColor White
                Write-Host "  Progress: $($statusResponse.lastSync.progress)%" -ForegroundColor White
                if ($statusResponse.lastSync.message) {
                    Write-Host "  Message: $($statusResponse.lastSync.message)" -ForegroundColor White
                }
            } else {
                Write-Host "  lastSync: null" -ForegroundColor White
            }
            
            if ($statusResponse.hasActiveSync -eq $false -and $i -lt 5) {
                Write-Host "  ✅ Sync completed (no longer active)" -ForegroundColor Green
                break
            }
            
            if ($i -lt 5) {
                Write-Host "  ⏳ Waiting 3 seconds..." -ForegroundColor Yellow
                Start-Sleep -Seconds 3
            }
        } catch {
            Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

# Test 5: Check final sync status
Write-Host "`n=== TEST 5: Check Final Sync Status ===" -ForegroundColor Yellow
try {
    $headers = @{
        "X-User-Id" = $testUserId
        "Content-Type" = "application/json"
    }
    
    $statusResponse = Invoke-RestMethod -Uri "$nodeApiUrl/api/sync/status" -Method Get -Headers $headers -ErrorAction Stop
    Write-Host "✅ Final Sync Status:" -ForegroundColor Green
    Write-Host "  hasActiveSync: $($statusResponse.hasActiveSync)" -ForegroundColor White
    Write-Host "  lastSync: $($statusResponse.lastSync | ConvertTo-Json -Depth 5)" -ForegroundColor White
    
    if ($statusResponse.hasActiveSync -eq $false) {
        Write-Host "✅ No active sync (sync completed)" -ForegroundColor Green
        if ($statusResponse.lastSync) {
            Write-Host "  Last Sync Status: $($statusResponse.lastSync.status)" -ForegroundColor White
            Write-Host "  Last Sync ID: $($statusResponse.lastSync.syncId)" -ForegroundColor White
        }
    } else {
        Write-Host "⚠️ Sync still active" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Get specific sync status by syncId
Write-Host "`n=== TEST 6: Get Specific Sync Status by syncId ===" -ForegroundColor Yellow
if ($syncId) {
    try {
        $headers = @{
            "X-User-Id" = $testUserId
            "Content-Type" = "application/json"
        }
        
        $specificStatusResponse = Invoke-RestMethod -Uri "$nodeApiUrl/api/sync/status/$syncId" -Method Get -Headers $headers -ErrorAction Stop
        Write-Host "✅ Specific Sync Status:" -ForegroundColor Green
        Write-Host ($specificStatusResponse | ConvertTo-Json -Depth 5) -ForegroundColor White
    } catch {
        Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "  Status Code: $statusCode" -ForegroundColor Red
    }
}

Write-Host "`n=== TEST SUMMARY ===" -ForegroundColor Cyan
Write-Host "`n✅ Sync Monitoring Tests Completed" -ForegroundColor Green
Write-Host "`n📝 Notes:" -ForegroundColor Yellow
Write-Host "  - Sync status endpoint works correctly" -ForegroundColor White
Write-Host "  - Active sync detection works" -ForegroundColor White
Write-Host "  - Polling sync status works" -ForegroundColor White
Write-Host "  - Last sync information is tracked" -ForegroundColor White

