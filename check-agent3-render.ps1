# Quick check if Agent 3 is working on Render
$userId = "demo-user"
$apiUrl = "https://opside-node-api.onrender.com"

Write-Host "Checking Agent 3 on Render..." -ForegroundColor Cyan
Write-Host ""

try {
    $result = Invoke-RestMethod -Uri "$apiUrl/api/detections/results?limit=5" `
        -Method GET `
        -Headers @{ "x-user-id" = $userId; "Content-Type" = "application/json" }
    
    Write-Host "✅ API Response:" -ForegroundColor Green
    Write-Host "   Success: $($result.success)" -ForegroundColor White
    Write-Host "   Total: $($result.total)" -ForegroundColor White
    Write-Host "   Results Count: $($result.results.Count)" -ForegroundColor White
    
    if ($result.results -and $result.results.Count -gt 0) {
        Write-Host ""
        Write-Host "✅ Agent 3 IS WORKING! Found $($result.results.Count) detections" -ForegroundColor Green
        Write-Host ""
        Write-Host "Sample Detection:" -ForegroundColor Yellow
        $first = $result.results[0]
        Write-Host "   Type: $($first.anomaly_type)" -ForegroundColor White
        Write-Host "   Value: $($first.estimated_value) $($first.currency)" -ForegroundColor White
        Write-Host "   Confidence: $([math]::Round($first.confidence_score * 100, 1))%" -ForegroundColor White
    } else {
        Write-Host ""
        Write-Host "⚠️  No detections found - Agent 3 may not have run yet" -ForegroundColor Yellow
        Write-Host "   This could mean:" -ForegroundColor Gray
        Write-Host "   1. No sync has been run yet" -ForegroundColor Gray
        Write-Host "   2. Agent 3 hasn't processed any data" -ForegroundColor Gray
        Write-Host "   3. The latest fixes aren't deployed yet" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Error checking Agent 3: $($_.Exception.Message)" -ForegroundColor Red
}

