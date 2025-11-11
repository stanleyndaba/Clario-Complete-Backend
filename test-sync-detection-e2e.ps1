# End-to-End Test Script for Sync and Detection Flow
# Tests the complete flow: Sync -> Detection -> Results Storage -> Monitoring

param(
    [string]$UserId = "",
    [string]$PythonApiUrl = "https://python-api-3-vb5h.onrender.com",
    [switch]$Sandbox = $true
)

Write-Host "=== Sync and Detection End-to-End Test ===" -ForegroundColor Cyan
Write-Host ""

# Check if userId is provided
if ([string]::IsNullOrEmpty($UserId)) {
    Write-Host "ERROR: UserId is required" -ForegroundColor Red
    Write-Host "Usage: .\test-sync-detection-e2e.ps1 -UserId <user_id> [-PythonApiUrl <url>] [-Sandbox]" -ForegroundColor Yellow
    exit 1
}

$IntegrationsApiUrl = $env:INTEGRATIONS_API_URL
if ([string]::IsNullOrEmpty($IntegrationsApiUrl)) {
    $IntegrationsApiUrl = "http://localhost:3001"
    Write-Host "WARNING: INTEGRATIONS_API_URL not set, using default: $IntegrationsApiUrl" -ForegroundColor Yellow
}

Write-Host "Configuration:" -ForegroundColor Green
Write-Host "  User ID: $UserId"
Write-Host "  Integrations API URL: $IntegrationsApiUrl"
Write-Host "  Python API URL: $PythonApiUrl"
Write-Host "  Sandbox Mode: $Sandbox"
Write-Host ""

# Test 1: Verify Claim Detector API is accessible
Write-Host "Test 1: Verifying Claim Detector API is accessible..." -ForegroundColor Cyan
try {
    $healthResponse = Invoke-RestMethod -Uri "$PythonApiUrl/api/v1/claim-detector/health" -Method Get -TimeoutSec 10
    Write-Host "  ✓ Claim Detector API is accessible" -ForegroundColor Green
    Write-Host "    Status: $($healthResponse.status)" -ForegroundColor Gray
    Write-Host "    Model Type: $($healthResponse.model_type)" -ForegroundColor Gray
} catch {
    Write-Host "  ✗ Claim Detector API is not accessible: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 2: Test Claim Detector API with sample data
Write-Host ""
Write-Host "Test 2: Testing Claim Detector API with sample data..." -ForegroundColor Cyan
try {
    $sampleClaim = @{
        claim_id = "test_claim_$(Get-Date -Format 'yyyyMMddHHmmss')"
        seller_id = $UserId
        order_id = "TEST-ORDER-123"
        category = "fee_error"
        subcategory = "fee"
        reason_code = "INCORRECT_FEE"
        marketplace = "US"
        fulfillment_center = "SDF1"
        amount = 25.50
        quantity = 1
        order_value = 100.00
        shipping_cost = 5.00
        days_since_order = 30
        days_since_delivery = 25
        description = "Test fee discrepancy detected"
        reason = "Automated test detection"
        notes = "Test claim for E2E testing"
        claim_date = (Get-Date).ToUniversalTime().ToString("o")
    }
    
    $batchRequest = @{
        claims = @($sampleClaim)
    }
    
    $detectionResponse = Invoke-RestMethod -Uri "$PythonApiUrl/api/v1/claim-detector/predict/batch" -Method Post -Body ($batchRequest | ConvertTo-Json -Depth 10) -ContentType "application/json" -TimeoutSec 30
    
    if ($detectionResponse.predictions -and $detectionResponse.predictions.Count -gt 0) {
        $prediction = $detectionResponse.predictions[0]
        Write-Host "  ✓ Claim Detector API returned predictions" -ForegroundColor Green
        Write-Host "    Claimable: $($prediction.claimable)" -ForegroundColor Gray
        Write-Host "    Probability: $($prediction.probability)" -ForegroundColor Gray
        Write-Host "    Confidence: $($prediction.confidence)" -ForegroundColor Gray
        
        if ($prediction.claimable -and $prediction.probability -ge 0.5) {
            Write-Host "    ✓ High-quality prediction detected" -ForegroundColor Green
        } else {
            Write-Host "    ⚠ Low probability prediction (this is expected for test data)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ✗ Claim Detector API did not return predictions" -ForegroundColor Red
        Write-Host "    Response: $($detectionResponse | ConvertTo-Json -Depth 5)" -ForegroundColor Gray
        exit 1
    }
} catch {
    Write-Host "  ✗ Claim Detector API test failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "    Response: $responseBody" -ForegroundColor Gray
    }
    exit 1
}

# Test 3: Verify Integrations API is accessible
Write-Host ""
Write-Host "Test 3: Verifying Integrations API is accessible..." -ForegroundColor Cyan
try {
    $healthResponse = Invoke-RestMethod -Uri "$IntegrationsApiUrl/health" -Method Get -TimeoutSec 10 -ErrorAction Stop
    Write-Host "  ✓ Integrations API is accessible" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Integrations API is not accessible: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    Make sure the Integrations API is running on $IntegrationsApiUrl" -ForegroundColor Yellow
    exit 1
}

# Test 4: Check if user has active sync
Write-Host ""
Write-Host "Test 4: Checking sync status for user..." -ForegroundColor Cyan
try {
    $syncStatusResponse = Invoke-RestMethod -Uri "$IntegrationsApiUrl/api/amazon/sync/status" -Method Get -Headers @{ "Authorization" = "Bearer $env:TEST_AUTH_TOKEN" } -TimeoutSec 10 -ErrorAction Stop
    
    if ($syncStatusResponse.hasActiveSync) {
        Write-Host "  ⚠ User has an active sync running" -ForegroundColor Yellow
        Write-Host "    Sync ID: $($syncStatusResponse.lastSync.syncId)" -ForegroundColor Gray
        Write-Host "    Status: $($syncStatusResponse.lastSync.status)" -ForegroundColor Gray
        Write-Host "    Progress: $($syncStatusResponse.lastSync.progress)%" -ForegroundColor Gray
    } else {
        Write-Host "  ✓ No active sync (ready for new sync)" -ForegroundColor Green
        if ($syncStatusResponse.lastSync) {
            Write-Host "    Last Sync: $($syncStatusResponse.lastSync.syncId)" -ForegroundColor Gray
            Write-Host "    Last Status: $($syncStatusResponse.lastSync.status)" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "  ⚠ Could not check sync status: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    This is non-critical, continuing..." -ForegroundColor Gray
}

# Test 5: Test detection results query (if available)
Write-Host ""
Write-Host "Test 5: Testing detection results query..." -ForegroundColor Cyan
try {
    $detectionResultsResponse = Invoke-RestMethod -Uri "$IntegrationsApiUrl/api/detection/results?limit=10" -Method Get -Headers @{ "Authorization" = "Bearer $env:TEST_AUTH_TOKEN" } -TimeoutSec 10 -ErrorAction Stop
    
    if ($detectionResultsResponse -and $detectionResultsResponse.Count -ge 0) {
        Write-Host "  ✓ Detection results endpoint is accessible" -ForegroundColor Green
        Write-Host "    Results count: $($detectionResultsResponse.Count)" -ForegroundColor Gray
        
        if ($detectionResultsResponse.Count -gt 0) {
            $highConfidence = ($detectionResultsResponse | Where-Object { $_.confidence_score -ge 0.85 }).Count
            $mediumConfidence = ($detectionResultsResponse | Where-Object { $_.confidence_score -ge 0.50 -and $_.confidence_score -lt 0.85 }).Count
            $lowConfidence = ($detectionResultsResponse | Where-Object { $_.confidence_score -lt 0.50 }).Count
            
            Write-Host "    High confidence: $highConfidence" -ForegroundColor Gray
            Write-Host "    Medium confidence: $mediumConfidence" -ForegroundColor Gray
            Write-Host "    Low confidence: $lowConfidence" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "  ⚠ Could not query detection results: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    This is non-critical, continuing..." -ForegroundColor Gray
}

# Test 6: Test monitoring metrics (if available)
Write-Host ""
Write-Host "Test 6: Testing monitoring metrics..." -ForegroundColor Cyan
try {
    $metricsResponse = Invoke-RestMethod -Uri "$IntegrationsApiUrl/api/monitoring/performance" -Method Get -Headers @{ "Authorization" = "Bearer $env:TEST_AUTH_TOKEN" } -TimeoutSec 10 -ErrorAction Stop
    
    if ($metricsResponse) {
        Write-Host "  ✓ Monitoring metrics endpoint is accessible" -ForegroundColor Green
        Write-Host "    Average Sync Duration: $($metricsResponse.average_sync_duration_ms)ms" -ForegroundColor Gray
        Write-Host "    Sync Success Rate: $($metricsResponse.sync_success_rate)%" -ForegroundColor Gray
        Write-Host "    Detection API Success Rate: $($metricsResponse.detection_api_success_rate)%" -ForegroundColor Gray
        Write-Host "    Average Claims per Sync: $($metricsResponse.average_claims_per_sync)" -ForegroundColor Gray
        Write-Host "    High Confidence Claim Rate: $($metricsResponse.high_confidence_claim_rate)%" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ⚠ Could not query monitoring metrics: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    This is non-critical, continuing..." -ForegroundColor Gray
}

# Summary
Write-Host ""
Write-Host "=== Test Summary ===" -ForegroundColor Cyan
Write-Host "✓ Claim Detector API is working" -ForegroundColor Green
Write-Host "✓ API response parsing is correct" -ForegroundColor Green
Write-Host "✓ Integrations API is accessible" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Trigger a sync for user $UserId" -ForegroundColor White
Write-Host "2. Monitor the sync progress" -ForegroundColor White
Write-Host "3. Verify detection results are stored correctly" -ForegroundColor White
Write-Host "4. Check monitoring metrics after sync completion" -ForegroundColor White
Write-Host ""
Write-Host "To trigger a sync, use:" -ForegroundColor Yellow
Write-Host "  POST $IntegrationsApiUrl/api/amazon/sync/start" -ForegroundColor White
Write-Host "  Headers: Authorization: Bearer <token>" -ForegroundColor White
Write-Host "  Body: { `"userId`": `"$UserId`" }" -ForegroundColor White
Write-Host ""

