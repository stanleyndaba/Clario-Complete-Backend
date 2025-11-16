# Test Detection API Endpoint
$userId = "demo-user"
$apiUrl = "https://opside-node-api.onrender.com"

Write-Host "Testing /api/detections/results endpoint..." -ForegroundColor Cyan
Write-Host "API URL: $apiUrl" -ForegroundColor Gray
Write-Host "User ID: $userId" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "$apiUrl/api/detections/results?limit=10" `
        -Method GET `
        -Headers @{
            "Content-Type" = "application/json"
            "x-user-id" = $userId
        } `
        -ErrorAction Stop
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response | ConvertTo-Json -Depth 5
    Write-Host ""
    Write-Host "Results Count: $($response.results.Count)" -ForegroundColor White
    Write-Host "Total: $($response.total)" -ForegroundColor White
    
    if ($response.results.Count -gt 0) {
        Write-Host ""
        Write-Host "Sample Result:" -ForegroundColor Cyan
        $response.results[0] | ConvertTo-Json -Depth 3
    }
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody" -ForegroundColor Yellow
    }
}


