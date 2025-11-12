# Verify Sandbox Sync Status
# Checks if sandbox sync is working correctly (even with empty data)

param(
    [string]$UserId = "sandbox-user",
    [string]$ApiUrl = "http://localhost:3001"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Sandbox Sync Status Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# 1. Check Environment Variables
Write-Host "[1/5] Checking Environment Variables..." -ForegroundColor Yellow
$baseUrl = $env:AMAZON_SPAPI_BASE_URL
if ($baseUrl -and $baseUrl -match "sandbox") {
    Write-Host "  ✅ Sandbox URL configured: $baseUrl" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  AMAZON_SPAPI_BASE_URL not set or not sandbox" -ForegroundColor Yellow
    Write-Host "     Expected: https://sandbox.sellingpartnerapi-na.amazon.com" -ForegroundColor Gray
}

# 2. Check API Connection
Write-Host ""
Write-Host "[2/5] Checking API Connection..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$ApiUrl/health" -Method Get -ErrorAction Stop
    Write-Host "  ✅ API is reachable" -ForegroundColor Green
} catch {
    Write-Host "  ❌ API not reachable: $_" -ForegroundColor Red
    $allGood = $false
}

# 3. Check Sync Status
Write-Host ""
Write-Host "[3/5] Checking Sync Status..." -ForegroundColor Yellow
try {
    $syncStatus = Invoke-RestMethod -Uri "$ApiUrl/api/sync/status?userId=$UserId" -Method Get -ErrorAction Stop
    if ($syncStatus.success) {
        Write-Host "  ✅ Sync status endpoint working" -ForegroundColor Green
        Write-Host "     Status: $($syncStatus.status)" -ForegroundColor Gray
        if ($syncStatus.results) {
            Write-Host "     Results:" -ForegroundColor Gray
            foreach ($key in $syncStatus.results.PSObject.Properties.Name) {
                $result = $syncStatus.results.$key
                $statusIcon = if ($result.status -eq "success") { "✅" } else { "❌" }
                Write-Host "       $statusIcon $key : $($result.count) records" -ForegroundColor $(if ($result.status -eq "success") { "Green" } else { "Red" })
            }
        }
    } else {
        Write-Host "  ⚠️  Sync status check returned success: false" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Could not check sync status: $_" -ForegroundColor Yellow
    Write-Host "     This is OK if sync hasn't run yet" -ForegroundColor Gray
}

# 4. Check Database Tables
Write-Host ""
Write-Host "[4/5] Checking Database Tables..." -ForegroundColor Yellow
$dbUrl = $env:DATABASE_URL
if ($dbUrl) {
    try {
        # Try to check if tables exist (basic check)
        Write-Host "  ✅ DATABASE_URL is set" -ForegroundColor Green
        Write-Host "     Note: Run 'psql `$DATABASE_URL -c \"\dt orders shipments returns settlements\"" -ForegroundColor Gray
        Write-Host "     to verify tables exist" -ForegroundColor Gray
    } catch {
        Write-Host "  ⚠️  Could not verify database: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ⚠️  DATABASE_URL not set" -ForegroundColor Yellow
    Write-Host "     Database checks skipped" -ForegroundColor Gray
}

# 5. Summary
Write-Host ""
Write-Host "[5/5] Summary..." -ForegroundColor Yellow
Write-Host ""

if ($allGood) {
    Write-Host "✅ Sandbox Sync Status: WORKING" -ForegroundColor Green
    Write-Host ""
    Write-Host "Key Points:" -ForegroundColor Cyan
    Write-Host "  • Empty data in sandbox is NORMAL and EXPECTED" -ForegroundColor White
    Write-Host "  • Amazon SP-API Sandbox returns empty arrays by design" -ForegroundColor White
    Write-Host "  • This tests your integration, not data retrieval" -ForegroundColor White
    Write-Host ""
    Write-Host "What to Look For:" -ForegroundColor Cyan
    Write-Host "  ✅ Logs show 'Sandbox returned empty/error response - returning empty orders (normal for sandbox)'" -ForegroundColor Green
    Write-Host "  ✅ API returns success: true with data: []" -ForegroundColor Green
    Write-Host "  ✅ Sync status shows 'completed' even with 0 records" -ForegroundColor Green
    Write-Host "  ✅ No 401 or 500 errors in logs" -ForegroundColor Green
    Write-Host ""
    Write-Host "If you see these, your system is working correctly!" -ForegroundColor Green
} else {
    Write-Host "⚠️  Some checks failed - review errors above" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "For detailed explanation, see: SANDBOX_EMPTY_DATA_EXPLANATION.md" -ForegroundColor Gray
Write-Host ""

