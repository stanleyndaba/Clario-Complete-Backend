# Test script to trigger sync and check response
# This simulates clicking the "Start Sync" button

$userId = "demo-user"
$apiUrl = $env:API_URL
if (-not $apiUrl) {
    # Use the correct Node.js API URL (same as frontend)
    $apiUrl = "https://opside-node-api.onrender.com"
}

Write-Host "🧪 Testing Sync Start..." -ForegroundColor Cyan
Write-Host "API URL: $apiUrl" -ForegroundColor Gray
Write-Host "User ID: $userId" -ForegroundColor Gray
Write-Host ""

# Start sync
Write-Host "📤 POST /api/sync/start" -ForegroundColor Yellow
try {
    # Try with x-user-id header first
    try {
        $response = Invoke-RestMethod -Uri "$apiUrl/api/sync/start" `
            -Method POST `
            -Headers @{
                "Content-Type" = "application/json"
                "x-user-id" = $userId
            } `
            -ErrorAction Stop
    } catch {
        # If that fails, try with Authorization header (Bearer token)
        Write-Host "⚠️ First attempt failed, trying with Authorization header..." -ForegroundColor Yellow
        $response = Invoke-RestMethod -Uri "$apiUrl/api/sync/start" `
            -Method POST `
            -Headers @{
                "Content-Type" = "application/json"
                "Authorization" = "Bearer demo-token"
                "x-user-id" = $userId
            } `
            -ErrorAction Stop
    }
    
    Write-Host "✅ Sync started successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response | ConvertTo-Json -Depth 10 | Write-Host
    
    $syncId = $response.syncId
    Write-Host ""
    Write-Host "Sync ID: $syncId" -ForegroundColor Yellow
    Write-Host ""
    
    # Wait a bit for sync to start
    Write-Host "⏳ Waiting 3 seconds for sync to initialize..." -ForegroundColor Gray
    Start-Sleep -Seconds 3
    
    # Check sync status (wait a bit longer for sync to progress)
    Write-Host ""
    Write-Host "⏳ Waiting 5 seconds for sync to progress..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
    
    # Check sync status
    Write-Host ""
    Write-Host "📊 GET /api/sync/status/$syncId" -ForegroundColor Yellow
    try {
        $statusResponse = Invoke-RestMethod -Uri "$apiUrl/api/sync/status/$syncId" `
            -Method GET `
            -Headers @{
                "x-user-id" = $userId
            } `
            -ErrorAction Stop
        
        Write-Host "✅ Sync status retrieved!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Status Response:" -ForegroundColor Cyan
        $statusResponse | ConvertTo-Json -Depth 10 | Write-Host
        
        Write-Host ""
        Write-Host "📈 Summary:" -ForegroundColor Cyan
        Write-Host "  Status: $($statusResponse.status)" -ForegroundColor White
        Write-Host "  Progress: $($statusResponse.progress)%" -ForegroundColor White
        Write-Host "  Message: $($statusResponse.message)" -ForegroundColor White
        
        if ($statusResponse.ordersProcessed) {
            Write-Host "  Orders Processed: $($statusResponse.ordersProcessed)" -ForegroundColor White
        }
        if ($statusResponse.totalOrders) {
            Write-Host "  Total Orders: $($statusResponse.totalOrders)" -ForegroundColor White
        }
        if ($statusResponse.inventoryCount) {
            Write-Host "  Inventory Count: $($statusResponse.inventoryCount)" -ForegroundColor White
        }
        if ($statusResponse.shipmentsCount) {
            Write-Host "  Shipments Count: $($statusResponse.shipmentsCount)" -ForegroundColor White
        }
        if ($statusResponse.returnsCount) {
            Write-Host "  Returns Count: $($statusResponse.returnsCount)" -ForegroundColor White
        }
        if ($statusResponse.settlementsCount) {
            Write-Host "  Settlements Count: $($statusResponse.settlementsCount)" -ForegroundColor White
        }
        if ($statusResponse.feesCount) {
            Write-Host "  Fees Count: $($statusResponse.feesCount)" -ForegroundColor White
        }
        if ($statusResponse.claimsDetected) {
            Write-Host "  Claims Detected: $($statusResponse.claimsDetected)" -ForegroundColor White
        }
        
    } catch {
        Write-Host "❌ Failed to get sync status: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails.Message) {
            Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
        }
    }
    
} catch {
    Write-Host "❌ Failed to start sync: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Response Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
}

