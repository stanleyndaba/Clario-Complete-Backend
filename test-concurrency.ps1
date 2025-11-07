# Test Concurrency and Idempotency
# Sends multiple Phase 1 requests simultaneously

$ErrorActionPreference = "Continue"
$baseUrl = "http://localhost:3001"
$body = @{
    user_id = "test-user-sandbox-001"
    seller_id = "test-seller-sandbox-001"
    sync_id = "sandbox-test-001"
} | ConvertTo-Json

Write-Host "🧪 Testing Concurrency and Idempotency" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Sending 5 simultaneous Phase 1 requests..." -ForegroundColor Yellow
Write-Host ""

$jobs = @()
for ($i = 1; $i -le 5; $i++) {
    $job = Start-Job -ScriptBlock {
        param($url, $body, $index)
        try {
            $response = Invoke-WebRequest -Uri "$url/api/v1/workflow/phase/1" `
                -Method POST `
                -Body $body `
                -ContentType "application/json" `
                -TimeoutSec 10 `
                -ErrorAction Stop
            return @{
                Index = $index
                Success = $true
                Response = $response.Content
                StatusCode = $response.StatusCode
            }
        } catch {
            return @{
                Index = $index
                Success = $false
                Error = $_.Exception.Message
                StatusCode = $_.Exception.Response.StatusCode.value__
            }
        }
    } -ArgumentList $baseUrl, $body, $i
    $jobs += $job
    Write-Host "  Request $i queued" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Waiting for all requests to complete..." -ForegroundColor Yellow
$results = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job

Write-Host ""
Write-Host "Results:" -ForegroundColor Cyan
Write-Host "========" -ForegroundColor Cyan
Write-Host ""

$successCount = 0
$failureCount = 0

foreach ($result in $results) {
    if ($result.Success) {
        $successCount++
        Write-Host "✅ Request $($result.Index): Success" -ForegroundColor Green
        Write-Host "   Response: $($result.Response)" -ForegroundColor Gray
    } else {
        $failureCount++
        Write-Host "❌ Request $($result.Index): Failed" -ForegroundColor Red
        Write-Host "   Error: $($result.Error)" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "  Successful: $successCount" -ForegroundColor Green
Write-Host "  Failed: $failureCount" -ForegroundColor $(if ($failureCount -gt 0) { "Red" } else { "Green" })
Write-Host ""

Write-Host "📋 Check server logs for:" -ForegroundColor Yellow
Write-Host "  - Only ONE 'Processing orchestration job' for Phase 1" -ForegroundColor Gray
Write-Host "  - Idempotency messages for duplicate triggers" -ForegroundColor Gray
Write-Host "  - No duplicate job errors" -ForegroundColor Gray
Write-Host ""

Write-Host "Check queue status:" -ForegroundColor Yellow
Write-Host "  node check-orchestration-status.js" -ForegroundColor Cyan

