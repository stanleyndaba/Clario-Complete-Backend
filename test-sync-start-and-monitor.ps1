# Start Sync and Monitor Progress
$userId = "demo-user"
$apiUrl = "https://opside-node-api.onrender.com"

Write-Host "🔄 Starting Sync (Agent 2 → Agent 3)" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Start Sync
Write-Host "📤 Step 1: Starting sync..." -ForegroundColor Yellow
try {
    $startResponse = Invoke-RestMethod -Uri "$apiUrl/api/sync/start" `
        -Method POST `
        -Headers @{
            "Content-Type" = "application/json"
            "x-user-id" = $userId
        } `
        -ErrorAction Stop
    
    if ($startResponse.syncId) {
        $syncId = $startResponse.syncId
        Write-Host "  ✅ Sync started!" -ForegroundColor Green
        Write-Host "  Sync ID: $syncId" -ForegroundColor White
        Write-Host ""
    } else {
        Write-Host "  ❌ No syncId in response" -ForegroundColor Red
        Write-Host "  Response: $($startResponse | ConvertTo-Json)" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ❌ Error starting sync: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Yellow
    }
    exit 1
}

# Step 2: Monitor Progress
Write-Host "⏳ Step 2: Monitoring sync progress..." -ForegroundColor Yellow
Write-Host "  (This may take 1-2 minutes)" -ForegroundColor Gray
Write-Host ""

$maxAttempts = 60  # 2 minutes (2 second intervals)
$attempt = 0
$completed = $false

while (-not $completed -and $attempt -lt $maxAttempts) {
    Start-Sleep -Seconds 2
    $attempt++
    
    try {
        $statusResponse = Invoke-RestMethod -Uri "$apiUrl/api/sync/status/$syncId" `
            -Method GET `
            -Headers @{
                "Content-Type" = "application/json"
                "x-user-id" = $userId
            } `
            -ErrorAction Stop
        
        $status = $statusResponse.status
        $progress = $statusResponse.progress
        $message = $statusResponse.message
        
        Write-Host "  [$attempt] Status: $status | Progress: $progress% | $message" -ForegroundColor White
        
        if ($status -eq "completed") {
            $completed = $true
            Write-Host ""
            Write-Host "  ✅ Sync completed!" -ForegroundColor Green
            Write-Host ""
            
            # Show summary
            Write-Host "  📊 Sync Summary:" -ForegroundColor Cyan
            Write-Host "    Orders: $($statusResponse.ordersProcessed) / $($statusResponse.totalOrders)" -ForegroundColor White
            Write-Host "    Inventory: $($statusResponse.inventoryCount)" -ForegroundColor White
            Write-Host "    Shipments: $($statusResponse.shipmentsCount)" -ForegroundColor White
            Write-Host "    Returns: $($statusResponse.returnsCount)" -ForegroundColor White
            Write-Host "    Settlements: $($statusResponse.settlementsCount)" -ForegroundColor White
            Write-Host "    Fees: $($statusResponse.feesCount)" -ForegroundColor White
            Write-Host "    Claims Detected: $($statusResponse.claimsDetected)" -ForegroundColor $(if ($statusResponse.claimsDetected -gt 0) { 'Green' } else { 'Yellow' })
            Write-Host ""
            break
        } elseif ($status -eq "failed") {
            Write-Host ""
            Write-Host "  ❌ Sync failed!" -ForegroundColor Red
            Write-Host "  Error: $($statusResponse.error)" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "  ⚠️ Error checking status: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $completed) {
    Write-Host ""
    Write-Host "  ⚠️ Sync did not complete within timeout" -ForegroundColor Yellow
    Write-Host "  Check status manually or check Render logs" -ForegroundColor Gray
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

# Step 3: Check Detection Results
Write-Host "🔍 Step 3: Checking Agent 3 Detection Results..." -ForegroundColor Yellow
Write-Host ""

Start-Sleep -Seconds 5  # Give Agent 3 a moment to finish

try {
    $detectionRes = Invoke-RestMethod -Uri "$apiUrl/api/detections/results?limit=10" `
        -Method GET `
        -Headers @{
            "Content-Type" = "application/json"
            "x-user-id" = $userId
        } `
        -ErrorAction Stop
    
    Write-Host "  Detection Results: $($detectionRes.results.Count)" -ForegroundColor $(if ($detectionRes.results.Count -gt 0) { 'Green' } else { 'Yellow' })
    Write-Host "  Total: $($detectionRes.total)" -ForegroundColor White
    
    if ($detectionRes.results.Count -gt 0) {
        Write-Host ""
        Write-Host "  ✅ Agent 3 is working! Detection results found." -ForegroundColor Green
        Write-Host ""
        Write-Host "  Sample Result:" -ForegroundColor Cyan
        $detectionRes.results[0] | ConvertTo-Json -Depth 2
    } else {
        Write-Host ""
        Write-Host "  ⚠️ No detection results yet. This could mean:" -ForegroundColor Yellow
        Write-Host "    1. Agent 3 is still processing (wait a bit longer)" -ForegroundColor Gray
        Write-Host "    2. Agent 3 failed (check Render logs)" -ForegroundColor Gray
        Write-Host "    3. No claims were detected from the data" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ❌ Error checking detection results: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Check Render logs for Agent 3 messages" -ForegroundColor White
Write-Host "  2. Refresh Recoveries page to see detected claims" -ForegroundColor White
Write-Host "  3. If no results, check logs for errors" -ForegroundColor White
Write-Host ""

