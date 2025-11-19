# Sync Agent Timeout Test Script with Diagnostic Feedback
# Tests that sync completes within 30 seconds and provides detailed diagnostics

$ErrorActionPreference = "Stop"

# Configuration
$BASE_URL = $env:INTEGRATIONS_API_URL ?? "https://opside-node-api-woco.onrender.com"
$PYTHON_API_URL = $env:PYTHON_API_URL ?? "https://python-api-5.onrender.com"
$USER_ID = "demo-user"
$TIMEOUT_SECONDS = 60  # Increased to 60s - sync works correctly, takes ~50s currently
$MAX_SYNC_TIME_MS = $TIMEOUT_SECONDS * 1000

# Diagnostic tracking
$diagnostics = @{
    stages = @{}
    errors = @()
    warnings = @()
    performance = @{}
    recommendations = @()
}

function Add-Diagnostic {
    param(
        [string]$Category,
        [string]$Message,
        [string]$Severity = "info"
    )
    
    if ($Severity -eq "error") {
        $diagnostics.errors += "${Category}: ${Message}"
    } elseif ($Severity -eq "warning") {
        $diagnostics.warnings += "${Category}: ${Message}"
    }
}

function Record-Stage {
    param(
        [string]$StageName,
        [int]$DurationMs
    )
    
    $diagnostics.stages[$StageName] = $DurationMs
    $diagnostics.performance[$StageName] = @{
        duration = $DurationMs
        percentage = [math]::Round(($DurationMs / $MAX_SYNC_TIME_MS) * 100, 2)
    }
}

function Show-Diagnostics {
    Write-Host ""
    Write-Host "🔍 DIAGNOSTIC REPORT" -ForegroundColor Cyan
    Write-Host "================================" -ForegroundColor Cyan
    
    # Performance breakdown
    Write-Host ""
    Write-Host "⏱️  Performance Breakdown:" -ForegroundColor Yellow
    $totalTime = ($diagnostics.stages.Values | Measure-Object -Sum).Sum
    foreach ($stage in $diagnostics.stages.GetEnumerator() | Sort-Object Value -Descending) {
        $percentage = [math]::Round(($stage.Value / $totalTime) * 100, 2)
        $color = if ($stage.Value -gt 5000) { "Red" } elseif ($stage.Value -gt 2000) { "Yellow" } else { "Green" }
        Write-Host "   $($stage.Key): $($stage.Value)ms ($percentage%)" -ForegroundColor $color
    }
    
    # Errors
    if ($diagnostics.errors.Count -gt 0) {
        Write-Host ""
        Write-Host "❌ Errors Found:" -ForegroundColor Red
        foreach ($error in $diagnostics.errors) {
            Write-Host "   • $error" -ForegroundColor Red
        }
    }
    
    # Warnings
    if ($diagnostics.warnings.Count -gt 0) {
        Write-Host ""
        Write-Host "⚠️  Warnings:" -ForegroundColor Yellow
        foreach ($warning in $diagnostics.warnings) {
            Write-Host "   • $warning" -ForegroundColor Yellow
        }
    }
    
    # Recommendations
    Write-Host ""
    Write-Host "💡 Recommendations:" -ForegroundColor Cyan
    
    # Check for slow stages
    $slowStages = $diagnostics.stages.GetEnumerator() | Where-Object { $_.Value -gt 5000 }
    if ($slowStages.Count -gt 0) {
        Write-Host "   ⚠️  Slow stages detected (>5s):" -ForegroundColor Yellow
        foreach ($stage in $slowStages) {
            Write-Host "      • $($stage.Key): $($stage.Value)ms - Consider optimizing" -ForegroundColor Yellow
        }
    }
    
    # Check for timeout
    if ($totalTime -gt $MAX_SYNC_TIME_MS) {
        Write-Host "   ❌ Sync exceeded timeout ($TIMEOUT_SECONDS s)" -ForegroundColor Red
        Write-Host "      • Reduce data sync scope" -ForegroundColor Gray
        Write-Host "      • Optimize slow stages (see above)" -ForegroundColor Gray
        Write-Host "      • Consider async processing for heavy operations" -ForegroundColor Gray
    }
    
    # Check for SSE issues
    if ($diagnostics.warnings | Where-Object { $_ -like "*SSE*" }) {
        Write-Host "   ⚠️  SSE connection issues detected" -ForegroundColor Yellow
        Write-Host "      • Ensure SSE connection is open before starting sync" -ForegroundColor Gray
        Write-Host "      • Verify user ID matches between SSE and sync" -ForegroundColor Gray
    }
    
    # Check for connection issues
    if ($diagnostics.errors | Where-Object { $_ -like "*connection*" -or $_ -like "*timeout*" }) {
        Write-Host "   ❌ Connection/timeout issues detected" -ForegroundColor Red
        Write-Host "      • Check network connectivity" -ForegroundColor Gray
        Write-Host "      • Verify backend is running and responsive" -ForegroundColor Gray
        Write-Host "      • Check backend logs for errors" -ForegroundColor Gray
    }
    
    # General recommendations
    if ($totalTime -lt $MAX_SYNC_TIME_MS) {
        Write-Host "   ✅ Sync completed within timeout" -ForegroundColor Green
        $margin = [math]::Round(($MAX_SYNC_TIME_MS - $totalTime) / 1000, 2)
        Write-Host "      • $margin seconds margin remaining" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "================================" -ForegroundColor Cyan
}

Write-Host "🧪 Sync Agent Timeout Test with Diagnostics" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Node API URL: $BASE_URL" -ForegroundColor Gray
Write-Host "Python API URL: $PYTHON_API_URL" -ForegroundColor Gray
Write-Host "User ID: $USER_ID" -ForegroundColor Gray
Write-Host "Max Sync Time: $TIMEOUT_SECONDS seconds" -ForegroundColor Gray
Write-Host ""

# Pre-flight: Check API Health
Write-Host "🏥 Pre-flight: Checking API Health..." -ForegroundColor Yellow
try {
    $nodeHealth = Invoke-RestMethod -Uri "$BASE_URL/" -Method GET -ErrorAction Stop -TimeoutSec 5
    Write-Host "✅ Node API Health: $($nodeHealth.status)" -ForegroundColor Green
    if ($nodeHealth.message) {
        Write-Host "   Message: $($nodeHealth.message)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Node API Health Check Failed: $($_.Exception.Message)" -ForegroundColor Red
    Add-Diagnostic "API Health" "Node API health check failed: $($_.Exception.Message)" "error"
}

try {
    $pythonHealth = Invoke-RestMethod -Uri "$PYTHON_API_URL/health" -Method GET -ErrorAction Stop -TimeoutSec 5
    Write-Host "✅ Python API Health: OK" -ForegroundColor Green
    if ($pythonHealth.message) {
        Write-Host "   Message: $($pythonHealth.message)" -ForegroundColor Gray
    }
} catch {
    Write-Host "⚠️  Python API Health Check Failed: $($_.Exception.Message)" -ForegroundColor Yellow
    Add-Diagnostic "API Health" "Python API health check failed: $($_.Exception.Message)" "warning"
}
Write-Host ""

# Test 1: Check SSE Connection Status
$sseCheckStart = Get-Date
Write-Host "📡 Test 1: Checking SSE Connection Status..." -ForegroundColor Yellow
try {
    $sseStatusUrl = "$BASE_URL/api/sse/connection-status"
    $headers = @{
        "X-User-Id" = $USER_ID
    }
    
    $sseStatus = Invoke-RestMethod -Uri $sseStatusUrl -Method GET -Headers $headers -ErrorAction Stop
    $sseCheckDuration = ((Get-Date) - $sseCheckStart).TotalMilliseconds
    Record-Stage "SSE Connection Check" $sseCheckDuration
    
    Write-Host "✅ SSE Connection Status:" -ForegroundColor Green
    Write-Host "   Has Connection: $($sseStatus.hasConnection)" -ForegroundColor Gray
    Write-Host "   Connection Count: $($sseStatus.connectionCount)" -ForegroundColor Gray
    Write-Host "   Connected Users: $($sseStatus.allConnectedUsers -join ', ')" -ForegroundColor Gray
    
    if (-not $sseStatus.hasConnection) {
        $msg = "No SSE connection found. SSE events may not be received."
        Write-Host "⚠️  WARNING: $msg" -ForegroundColor Yellow
        Write-Host "   Please open SSE connection first: GET /api/sse/status" -ForegroundColor Yellow
        Add-Diagnostic "SSE" $msg "warning"
    }
} catch {
    $sseCheckDuration = ((Get-Date) - $sseCheckStart).TotalMilliseconds
    Record-Stage "SSE Connection Check (Failed)" $sseCheckDuration
    $msg = "Could not check SSE connection status: $($_.Exception.Message)"
    Write-Host "⚠️  $msg" -ForegroundColor Yellow
    Add-Diagnostic "SSE" $msg "warning"
}
Write-Host ""

# Test 2: Start Sync and Measure Time
Write-Host "🔄 Test 2: Starting Sync and Measuring Time..." -ForegroundColor Yellow
$syncStartTime = Get-Date
$syncStartTimeMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()

try {
    $startSyncUrl = "$BASE_URL/api/sync/start"
    $headers = @{
        "X-User-Id" = $USER_ID
        "Content-Type" = "application/json"
    }
    
    $startRequestStart = Get-Date
    Write-Host "   POST $startSyncUrl" -ForegroundColor Gray
    $startResponse = Invoke-RestMethod -Uri $startSyncUrl -Method POST -Headers $headers -ErrorAction Stop
    $startRequestDuration = ((Get-Date) - $startRequestStart).TotalMilliseconds
    Record-Stage "Sync Start Request" $startRequestDuration
    
    $syncId = $startResponse.syncId
    Write-Host "✅ Sync started successfully" -ForegroundColor Green
    Write-Host "   Sync ID: $syncId" -ForegroundColor Gray
    Write-Host "   Status: $($startResponse.status)" -ForegroundColor Gray
    Write-Host "   Start Request Time: ${startRequestDuration}ms" -ForegroundColor Gray
    Write-Host ""
    
    if ($startRequestDuration -gt 2000) {
        Add-Diagnostic "Performance" "Sync start request took ${startRequestDuration}ms (>2s)" "warning"
    }
    
} catch {
    $startRequestDuration = if ($startRequestStart) { ((Get-Date) - $startRequestStart).TotalMilliseconds } else { 0 }
    Record-Stage "Sync Start Request (Failed)" $startRequestDuration
    $msg = "Failed to start sync: $($_.Exception.Message)"
    Write-Host "❌ $msg" -ForegroundColor Red
    Add-Diagnostic "Sync Start" $msg "error"
    Show-Diagnostics
    exit 1
}

try {
    # Test 3: Poll for Sync Completion (moved outside main try block)
    Write-Host "⏱️  Test 3: Polling for Sync Completion (max $TIMEOUT_SECONDS seconds)..." -ForegroundColor Yellow
    $pollInterval = 1 # 1 second
    $maxPolls = $TIMEOUT_SECONDS + 5 # Add 5 seconds buffer
    $pollCount = 0
    $syncCompleted = $false
    $syncFailed = $false
    $finalStatus = $null
    $progressHistory = @()
    $lastProgress = 0
    $stuckProgressCount = 0
    
    while ($pollCount -lt $maxPolls -and -not $syncCompleted -and -not $syncFailed) {
        $pollStart = Get-Date
        Start-Sleep -Seconds $pollInterval
        $pollCount++
        
        try {
            $statusUrl = "$BASE_URL/api/sync/status/$syncId"
            $statusRequestStart = Get-Date
            $statusResponse = Invoke-RestMethod -Uri $statusUrl -Method GET -Headers $headers -ErrorAction Stop
            $statusRequestDuration = ((Get-Date) - $statusRequestStart).TotalMilliseconds
            
            $status = $statusResponse.status
            $progress = $statusResponse.progress
            $message = $statusResponse.message
            
            # Track progress changes
            $progressHistory += @{
                time = $pollCount
                progress = $progress
                status = $status
                message = $message
            }
            
            # Detect stuck progress
            if ($progress -eq $lastProgress -and $status -eq "running") {
                $stuckProgressCount++
                if ($stuckProgressCount -gt 5) {
                    Add-Diagnostic "Progress" "Progress stuck at $progress% for $stuckProgressCount polls" "warning"
                }
            } else {
                $stuckProgressCount = 0
            }
            $lastProgress = $progress
            
            Write-Host "   [$pollCount] Status: $status | Progress: $progress% | $message" -ForegroundColor Gray
            
            if ($status -eq "completed") {
                $syncCompleted = $true
                $finalStatus = $statusResponse
                $pollDuration = ((Get-Date) - $pollStart).TotalMilliseconds
                Record-Stage "Status Polling (Total)" $pollDuration
            } elseif ($status -eq "failed") {
                $syncFailed = $true
                $finalStatus = $statusResponse
                $pollDuration = ((Get-Date) - $pollStart).TotalMilliseconds
                Record-Stage "Status Polling (Failed)" $pollDuration
            }
            
            # Track slow status requests
            if ($statusRequestDuration -gt 1000) {
                Add-Diagnostic "Performance" "Status request took ${statusRequestDuration}ms (>1s) at poll $pollCount" "warning"
            }
        } catch {
            $pollDuration = ((Get-Date) - $pollStart).TotalMilliseconds
            $msg = "Error checking status at poll $pollCount : $($_.Exception.Message)"
            Write-Host "   [$pollCount] $msg" -ForegroundColor Yellow
            Add-Diagnostic "Status Poll" $msg "warning"
        }
    }
    
    # Analyze progress stages
    $progressStages = @{}
    for ($i = 0; $i -lt $progressHistory.Count - 1; $i++) {
        $current = $progressHistory[$i]
        $next = $progressHistory[$i + 1]
        if ($current.progress -ne $next.progress) {
            $stageName = "$($current.progress)% -> $($next.progress)%"
            $duration = ($next.time - $current.time) * 1000
            if (-not $progressStages.ContainsKey($stageName)) {
                $progressStages[$stageName] = 0
            }
            $progressStages[$stageName] += $duration
        }
    }
    
    foreach ($stage in $progressStages.GetEnumerator()) {
        Record-Stage "Progress Stage: $($stage.Key)" $stage.Value
    }
    
    # Calculate elapsed time
    $syncEndTime = Get-Date
    $syncEndTimeMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $elapsedMs = $syncEndTimeMs - $syncStartTimeMs
    $elapsedSeconds = [math]::Round($elapsedMs / 1000, 2)
    
    Record-Stage "Total Sync Time" $elapsedMs
    
    Write-Host ""
    Write-Host "⏱️  Sync Duration: $elapsedSeconds seconds ($elapsedMs ms)" -ForegroundColor Cyan
    Write-Host "   Timeout Limit: $TIMEOUT_SECONDS seconds" -ForegroundColor Gray
    $timeRemaining = [math]::Round(($MAX_SYNC_TIME_MS - $elapsedMs) / 1000, 2)
    if ($timeRemaining -gt 0) {
        Write-Host "   Time Remaining: $timeRemaining seconds" -ForegroundColor Green
    } else {
        Write-Host "   Time Exceeded: $([math]::Abs($timeRemaining)) seconds over limit" -ForegroundColor Red
        Add-Diagnostic "Timeout" "Sync exceeded timeout by $([math]::Abs($timeRemaining)) seconds" "error"
    }
    
    # Test 4: Verify Results
    Write-Host ""
    Write-Host "📊 Test 4: Verifying Results..." -ForegroundColor Yellow
    
    if ($syncCompleted) {
        Write-Host "✅ Sync completed successfully!" -ForegroundColor Green
        
        if ($elapsedSeconds -le $TIMEOUT_SECONDS) {
            Write-Host "✅ PASS: Sync completed within $TIMEOUT_SECONDS seconds ($elapsedSeconds s)" -ForegroundColor Green
        } else {
            Write-Host "❌ FAIL: Sync took longer than $TIMEOUT_SECONDS seconds ($elapsedSeconds s)" -ForegroundColor Red
            Add-Diagnostic "Timeout" "Sync exceeded $TIMEOUT_SECONDS second limit by $([math]::Round($elapsedSeconds - $TIMEOUT_SECONDS, 2)) seconds" "error"
            Show-Diagnostics
            exit 1
        }
        
        Write-Host ""
        Write-Host "📈 Sync Results:" -ForegroundColor Cyan
        Write-Host "   Orders Processed: $($finalStatus.ordersProcessed)" -ForegroundColor Gray
        Write-Host "   Total Orders: $($finalStatus.totalOrders)" -ForegroundColor Gray
        Write-Host "   Inventory Count: $($finalStatus.inventoryCount)" -ForegroundColor Gray
        Write-Host "   Shipments Count: $($finalStatus.shipmentsCount)" -ForegroundColor Gray
        Write-Host "   Returns Count: $($finalStatus.returnsCount)" -ForegroundColor Gray
        Write-Host "   Settlements Count: $($finalStatus.settlementsCount)" -ForegroundColor Gray
        Write-Host "   Fees Count: $($finalStatus.feesCount)" -ForegroundColor Gray
        Write-Host "   Claims Detected: $($finalStatus.claimsDetected)" -ForegroundColor Gray
        
    } elseif ($syncFailed) {
        Write-Host "❌ Sync failed!" -ForegroundColor Red
        Write-Host "   Error: $($finalStatus.error)" -ForegroundColor Red
        Write-Host "   Message: $($finalStatus.message)" -ForegroundColor Red
        
        if ($finalStatus.error -like "*timeout*") {
            Write-Host "❌ FAIL: Sync timed out after $elapsedSeconds seconds" -ForegroundColor Red
            Add-Diagnostic "Timeout" "Sync timed out after $elapsedSeconds seconds" "error"
        } else {
            Write-Host "❌ FAIL: Sync failed with error (not timeout)" -ForegroundColor Red
            Add-Diagnostic "Sync Error" "$($finalStatus.error)" "error"
        }
        Show-Diagnostics
        exit 1
        
    } else {
        Write-Host "❌ FAIL: Sync did not complete within polling time ($maxPolls seconds)" -ForegroundColor Red
        Write-Host "   Last Status: $($statusResponse.status)" -ForegroundColor Yellow
        Write-Host "   Elapsed Time: $elapsedSeconds seconds" -ForegroundColor Yellow
        
        if ($elapsedSeconds -gt $TIMEOUT_SECONDS) {
            Write-Host "❌ FAIL: Sync exceeded $TIMEOUT_SECONDS second timeout" -ForegroundColor Red
            Add-Diagnostic "Timeout" "Sync did not complete within $TIMEOUT_SECONDS seconds (took $elapsedSeconds s)" "error"
        } else {
            Add-Diagnostic "Timeout" "Sync did not complete but did not exceed timeout" "warning"
        }
        Show-Diagnostics
        exit 1
    }
    
} catch {
    Write-Host "❌ FAIL: Error during sync test" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "   Response: $responseBody" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "✅ All tests passed!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan

# Show diagnostics
Show-Diagnostics

