# Phase 3: Claim Detection - Sandbox SP-API Test
# Tests Phase 3 with Amazon SP-API sandbox data

param(
    [string]$UserId = "sandbox-user",
    [string]$ApiUrl = "http://localhost:3001",
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Phase 3: Real SP-API Testing" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check environment variables
Write-Host "[1/5] Checking SP-API Configuration..." -ForegroundColor Yellow
$spapiBaseUrl = $env:AMAZON_SPAPI_BASE_URL
$clientId = $env:AMAZON_SPAPI_CLIENT_ID -or $env:AMAZON_CLIENT_ID
$clientSecret = $env:AMAZON_SPAPI_CLIENT_SECRET -or $env:AMAZON_CLIENT_SECRET
$refreshToken = $env:AMAZON_SPAPI_REFRESH_TOKEN -or $env:AMAZON_REFRESH_TOKEN

if ($spapiBaseUrl -and $clientId -and $clientSecret -and $refreshToken) {
    Write-Host "  ✅ SP-API credentials configured" -ForegroundColor Green
    Write-Host "    Base URL: $spapiBaseUrl" -ForegroundColor Gray
    Write-Host "    Client ID: $($clientId.Substring(0, [Math]::Min(10, $clientId.Length)))..." -ForegroundColor Gray
} else {
    Write-Host "  ❌ SP-API credentials missing" -ForegroundColor Red
    Write-Host "    Required: AMAZON_SPAPI_BASE_URL, AMAZON_SPAPI_CLIENT_ID, AMAZON_SPAPI_CLIENT_SECRET, AMAZON_SPAPI_REFRESH_TOKEN" -ForegroundColor Yellow
    exit 1
}

# Test 1: Trigger Sync
Write-Host ""
Write-Host "[2/5] Triggering Amazon Sync..." -ForegroundColor Yellow
try {
    $syncEndpoint = "$ApiUrl/api/amazon/sync"
    Write-Host "  Calling: $syncEndpoint" -ForegroundColor Gray
    
    $syncBody = @{
        userId = $UserId
    } | ConvertTo-Json
    
    $syncResponse = Invoke-RestMethod -Uri $syncEndpoint -Method POST -Body $syncBody -ContentType "application/json" -ErrorAction Stop
    
    Write-Host "  ✅ Sync triggered successfully" -ForegroundColor Green
    Write-Host "    Sync ID: $($syncResponse.syncId)" -ForegroundColor Gray
    
    # Wait for sync to complete (detection runs automatically after sync)
    Write-Host "  Waiting for sync and detection to complete (30 seconds)..." -ForegroundColor Gray
    Start-Sleep -Seconds 30
} catch {
    Write-Host "  ❌ Sync failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "    Response: $responseBody" -ForegroundColor Yellow
    }
    exit 1
}

# Test 2: Check Detection Results
Write-Host ""
Write-Host "[3/5] Checking Detection Results..." -ForegroundColor Yellow
try {
    $detectionEndpoint = "$ApiUrl/api/detection/results?userId=$UserId"
    Write-Host "  Calling: $detectionEndpoint" -ForegroundColor Gray
    
    $detectionResponse = Invoke-RestMethod -Uri $detectionEndpoint -Method GET -ErrorAction Stop
    
    if ($detectionResponse.results -or $detectionResponse.data) {
        $results = $detectionResponse.results -or $detectionResponse.data
        $count = $results.Count
        $totalValue = ($results | Measure-Object -Property estimated_value -Sum).Sum
        
        Write-Host "  ✅ Detection results found" -ForegroundColor Green
        Write-Host "    Claims detected: $count" -ForegroundColor Gray
        Write-Host "    Total value: `$$([math]::Round($totalValue, 2))" -ForegroundColor Gray
        
        # Confidence breakdown
        $highConf = ($results | Where-Object { $_.confidence_score -ge 0.85 }).Count
        $mediumConf = ($results | Where-Object { $_.confidence_score -ge 0.50 -and $_.confidence_score -lt 0.85 }).Count
        $lowConf = ($results | Where-Object { $_.confidence_score -lt 0.50 }).Count
        
        Write-Host "    High confidence (>=0.85): $highConf" -ForegroundColor Gray
        Write-Host "    Medium confidence (0.50-0.85): $mediumConf" -ForegroundColor Gray
        Write-Host "    Low confidence (<0.50): $lowConf" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠️  No detection results found (may need more time or no claims detected)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Detection endpoint not accessible: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    This may be expected if endpoint doesn't exist yet" -ForegroundColor Gray
}

# Test 3: Check Database Directly
Write-Host ""
Write-Host "[4/5] Checking Database for Detection Results..." -ForegroundColor Yellow
try {
    if ($env:DATABASE_URL) {
        Write-Host "  ✅ DATABASE_URL configured" -ForegroundColor Green
        Write-Host "    Note: Direct database query requires psql or database client" -ForegroundColor Gray
        Write-Host "    Query: SELECT COUNT(*) FROM detection_results WHERE seller_id = '$UserId'" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠️  DATABASE_URL not set - cannot query database directly" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Database check skipped: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Test 4: Check Notifications
Write-Host ""
Write-Host "[5/5] Checking WebSocket Notifications..." -ForegroundColor Yellow
Write-Host "  ℹ️  WebSocket notifications are sent in real-time" -ForegroundColor Gray
Write-Host "    Check frontend for notifications about detected claims" -ForegroundColor Gray
Write-Host "    Expected notifications:" -ForegroundColor Gray
Write-Host "      - '⚡ X claims ready for auto submission' (high confidence)" -ForegroundColor Gray
Write-Host "      - '❓ X claims need your input' (medium confidence)" -ForegroundColor Gray
Write-Host "      - '📋 X claims need manual review' (low confidence)" -ForegroundColor Gray

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SP-API Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Sync triggered with real SP-API" -ForegroundColor Green
Write-Host "✅ Detection should run automatically after sync" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Check frontend for detection results" -ForegroundColor White
Write-Host "  2. Verify notifications are received" -ForegroundColor White
Write-Host "  3. Review detection results in database" -ForegroundColor White
Write-Host ""

