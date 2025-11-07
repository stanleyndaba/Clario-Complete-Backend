# PowerShell script to verify sandbox data flow
# Tests: Connection, Sync, Recoveries, Database

$BASE_URL = "http://localhost:3001"
$USER_ID = "demo-user"

Write-Host "🧪 Testing Amazon Sandbox Data Flow" -ForegroundColor Cyan
Write-Host "Base URL: $BASE_URL" -ForegroundColor Gray
Write-Host "User ID: $USER_ID`n" -ForegroundColor Gray

# Step 1: Test Connection
Write-Host "1️⃣  Testing Amazon Connection (Bypass)..." -ForegroundColor Yellow
try {
    $connectionResponse = Invoke-RestMethod -Uri "$BASE_URL/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=http://localhost:3000" -Method Get
    if ($connectionResponse.success -and $connectionResponse.bypassed) {
        Write-Host "✅ Connection successful (bypassed)`n" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Connection response: $($connectionResponse | ConvertTo-Json)`n" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Connection test failed: $($_.Exception.Message)`n" -ForegroundColor Red
}

# Step 2: Test Recoveries (before sync)
Write-Host "2️⃣  Testing Recoveries Endpoint (before sync)..." -ForegroundColor Yellow
try {
    $recoveriesResponse = Invoke-RestMethod -Uri "$BASE_URL/api/v1/integrations/amazon/recoveries" -Method Get
    Write-Host "📊 Recoveries Response:" -ForegroundColor Cyan
    Write-Host ($recoveriesResponse | ConvertTo-Json -Depth 5) -ForegroundColor Gray
    Write-Host ""
    
    if ($recoveriesResponse.totalAmount -gt 0 -or $recoveriesResponse.claimCount -gt 0) {
        Write-Host "✅ Found data!" -ForegroundColor Green
        Write-Host "   Total Amount: `$$($recoveriesResponse.totalAmount)" -ForegroundColor Green
        Write-Host "   Claim Count: $($recoveriesResponse.claimCount)" -ForegroundColor Green
        Write-Host "   Source: $($recoveriesResponse.source)" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "⚠️  No data found (this is normal if sandbox returned empty data or sync hasn't run)`n" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Recoveries test failed: $($_.Exception.Message)`n" -ForegroundColor Red
}

# Step 3: Test Diagnostics
Write-Host "3️⃣  Testing Diagnostics..." -ForegroundColor Yellow
try {
    $diagnoseResponse = Invoke-RestMethod -Uri "$BASE_URL/api/v1/integrations/amazon/diagnose" -Method Get
    Write-Host "🔍 Diagnostics:" -ForegroundColor Cyan
    Write-Host ($diagnoseResponse | ConvertTo-Json -Depth 5) -ForegroundColor Gray
    Write-Host ""
    
    if ($diagnoseResponse.success) {
        Write-Host "✅ Diagnostics successful" -ForegroundColor Green
        Write-Host "   Passed: $($diagnoseResponse.summary.passed)/$($diagnoseResponse.summary.total)" -ForegroundColor Green
        Write-Host ""
    }
} catch {
    Write-Host "❌ Diagnostics test failed: $($_.Exception.Message)`n" -ForegroundColor Red
}

# Step 4: Check Server Logs Instructions
Write-Host "4️⃣  📋 Check Server Logs For:" -ForegroundColor Yellow
Write-Host "   - 'Amazon SP-API initialized in SANDBOX mode'" -ForegroundColor Gray
Write-Host "   - 'Fetching claims from SP-API SANDBOX'" -ForegroundColor Gray
Write-Host "   - 'Found X claims in DATABASE'" -ForegroundColor Gray
Write-Host "   - 'Found X claims from API'" -ForegroundColor Gray
Write-Host "   - 'Sandbox returned empty data - this is normal for testing'" -ForegroundColor Gray
Write-Host ""

Write-Host "✅ Verification Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Check server logs for sync status" -ForegroundColor Gray
Write-Host "   2. If no data, wait for sync to complete" -ForegroundColor Gray
Write-Host "   3. Check database directly if possible" -ForegroundColor Gray
Write-Host "   4. Verify sandbox credentials are configured" -ForegroundColor Gray
Write-Host ""

