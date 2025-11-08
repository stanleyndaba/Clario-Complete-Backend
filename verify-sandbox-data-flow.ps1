# Phase 2 Sandbox Data Flow Verification
# Tests: Connect → Sync → Database → Phase 2 → Dashboard

$NODE_API = "https://opside-node-api-woco.onrender.com"
$NODE_API_LOCAL = "http://localhost:3001"

Write-Host "🧪 Phase 2 Sandbox Data Flow Verification`n" -ForegroundColor Cyan

# Test 1: Check Node.js Backend Health
Write-Host "1️⃣  Testing Node.js Backend Health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$NODE_API/health" -Method Get -TimeoutSec 10
    Write-Host "✅ Node.js backend is running`n" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js backend not accessible: $($_.Exception.Message)`n" -ForegroundColor Red
    Write-Host "   Trying local backend..." -ForegroundColor Yellow
    try {
        $health = Invoke-RestMethod -Uri "$NODE_API_LOCAL/health" -Method Get -TimeoutSec 5
        Write-Host "✅ Local backend is running`n" -ForegroundColor Green
        $NODE_API = $NODE_API_LOCAL
    } catch {
        Write-Host "❌ Local backend also not accessible`n" -ForegroundColor Red
        exit 1
    }
}

# Test 2: Check Amazon Diagnostics
Write-Host "2️⃣  Checking Amazon Diagnostics (Sandbox Mode)..." -ForegroundColor Yellow
try {
    $diagnose = Invoke-RestMethod -Uri "$NODE_API/api/v1/integrations/amazon/diagnose" -Method Get -TimeoutSec 10
    Write-Host "   Status: $($diagnose.success)" -ForegroundColor $(if ($diagnose.success) { 'Green' } else { 'Yellow' })
    Write-Host "   Passed: $($diagnose.summary.passed)/$($diagnose.summary.total)" -ForegroundColor Gray
    
    # Check if sandbox mode is detected
    $isSandbox = $diagnose.results | Where-Object { $_.details.isSandbox -eq $true -or $_.details.baseUrl -like '*sandbox*' }
    if ($isSandbox) {
        Write-Host "   ✅ SANDBOX MODE detected`n" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Sandbox mode not explicitly detected (check baseUrl)`n" -ForegroundColor Yellow
    }
    
    if (-not $diagnose.success) {
        Write-Host "   ⚠️  Some diagnostics failed (may still work):" -ForegroundColor Yellow
        $diagnose.results | Where-Object { -not $_.success } | ForEach-Object {
            Write-Host "      - $($_.step): $($_.error)" -ForegroundColor Yellow
        }
        Write-Host ""
    }
} catch {
    Write-Host "   ⚠️  Diagnostics failed: $($_.Exception.Message)`n" -ForegroundColor Yellow
}

# Test 3: Trigger Amazon Connection (Bypass)
Write-Host "3️⃣  Triggering Amazon Connection (Bypass)..." -ForegroundColor Yellow
try {
    $bypass = Invoke-RestMethod -Uri "$NODE_API/api/v1/integrations/amazon/auth/start?bypass=true" -Method Get -TimeoutSec 15
    if ($bypass.bypassed) {
        Write-Host "   ✅ Connection successful (bypassed)`n" -ForegroundColor Green
        Write-Host "   💡 Sync should trigger automatically`n" -ForegroundColor Cyan
    } else {
        Write-Host "   ⚠️  Connection returned but bypass not confirmed`n" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ⚠️  Connection failed: $($_.Exception.Message)`n" -ForegroundColor Yellow
}

# Test 4: Wait for sync to complete
Write-Host "4️⃣  Waiting for sync to complete (15 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 15
Write-Host "   ✅ Wait complete`n" -ForegroundColor Green

# Test 5: Check Recoveries Endpoint
Write-Host "5️⃣  Checking Recoveries Endpoint..." -ForegroundColor Yellow
$recoveriesChecked = $false
for ($i = 1; $i -le 3; $i++) {
    try {
        $recoveries = Invoke-RestMethod -Uri "$NODE_API/api/v1/integrations/amazon/recoveries" -Method Get -TimeoutSec 15
        Write-Host "   Attempt ${i}:" -ForegroundColor Gray
        Write-Host "   - Source: $($recoveries.source)" -ForegroundColor Gray
        Write-Host "   - Claims: $($recoveries.claimCount)" -ForegroundColor Gray
        Write-Host "   - Amount: `$$($recoveries.totalAmount)" -ForegroundColor Gray
        Write-Host "   - Message: $($recoveries.message)" -ForegroundColor Gray
        Write-Host "   - Data Source: $($recoveries.dataSource)" -ForegroundColor Gray
        
        if ($recoveries.source -eq "database") {
            Write-Host "   ✅ DATA FOUND IN DATABASE!`n" -ForegroundColor Green
            Write-Host "   ✅ Total: `$$($recoveries.totalAmount), Claims: $($recoveries.claimCount)" -ForegroundColor Green
            Write-Host "   ✅ Data Source: $($recoveries.dataSource)`n" -ForegroundColor Green
            $recoveriesChecked = $true
            break
        } elseif ($recoveries.source -eq "api") {
            Write-Host "   ⚠️  Data from API (not database) - sync may still be processing`n" -ForegroundColor Yellow
        } else {
            Write-Host "   ⚠️  No data found yet`n" -ForegroundColor Yellow
        }
        
        if ($i -lt 3 -and -not $recoveriesChecked) {
            Write-Host "   Waiting 10 seconds before retry...`n" -ForegroundColor Gray
            Start-Sleep -Seconds 10
        }
    } catch {
        Write-Host "   ❌ Error: $($_.Exception.Message)`n" -ForegroundColor Red
    }
}

# Test 6: Check Claims Endpoint
Write-Host "6️⃣  Checking Claims Endpoint..." -ForegroundColor Yellow
try {
    $claims = Invoke-RestMethod -Uri "$NODE_API/api/v1/integrations/amazon/claims" -Method Get -TimeoutSec 15
    if ($claims.success) {
        Write-Host "   ✅ Claims endpoint working" -ForegroundColor Green
        Write-Host "   - Source: $($claims.source)" -ForegroundColor Gray
        Write-Host "   - Count: $($claims.claims.Count)" -ForegroundColor Gray
        Write-Host "   - Message: $($claims.message)" -ForegroundColor Gray
        Write-Host "   - Is Sandbox: $($claims.isSandbox)" -ForegroundColor Gray
        Write-Host "   - Data Type: $($claims.dataType)`n" -ForegroundColor Gray
        
        if ($claims.claims.Count -gt 0) {
            Write-Host "   ✅ Found $($claims.claims.Count) claims!`n" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️  No claims found`n" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   ⚠️  Claims endpoint returned error: $($claims.error)`n" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ⚠️  Claims endpoint failed: $($_.Exception.Message)`n" -ForegroundColor Yellow
}

# Test 7: Check Detection Statistics (Phase 2 Results)
Write-Host "7️⃣  Checking Detection Statistics (Phase 2 Results)..." -ForegroundColor Yellow
try {
    $detectionStats = Invoke-RestMethod -Uri "$NODE_API/api/detections/statistics" -Method Get -TimeoutSec 15 -ErrorAction SilentlyContinue
    if ($detectionStats.success) {
        Write-Host "   ✅ Detection statistics available" -ForegroundColor Green
        Write-Host "   - Total Anomalies: $($detectionStats.statistics.total_anomalies)" -ForegroundColor Gray
        Write-Host "   - Total Value: `$$($detectionStats.statistics.total_value)" -ForegroundColor Gray
        Write-Host "   - Expiring Soon: $($detectionStats.statistics.expiring_soon)" -ForegroundColor Gray
        Write-Host "   - Expired: $($detectionStats.statistics.expired_count)`n" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  Detection statistics not available (may need auth)`n" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ⚠️  Detection statistics endpoint not accessible (may need auth)`n" -ForegroundColor Yellow
}

# Summary
Write-Host "📋 Verification Summary:" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

if ($recoveriesChecked) {
    Write-Host "✅ Data Flow: SYNC → DATABASE → RECOVERIES" -ForegroundColor Green
} else {
    Write-Host "⚠️  Data Flow: May still be processing or no data in sandbox" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "💡 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Check Render logs for:" -ForegroundColor Gray
Write-Host "      - 'SANDBOX MODE: fetched X claims'" -ForegroundColor Gray
Write-Host "      - 'Amazon claims saved to database successfully'" -ForegroundColor Gray
Write-Host "      - 'Detection job triggered after sync (SANDBOX MODE)'" -ForegroundColor Gray
Write-Host "      - 'Detection algorithms completed (SANDBOX MODE)'" -ForegroundColor Gray
Write-Host ""
Write-Host "   2. Verify no errors:" -ForegroundColor Gray
Write-Host "      - No 500/401/404 errors in logs" -ForegroundColor Gray
Write-Host "      - All SANDBOX MODE indicators present" -ForegroundColor Gray
Write-Host ""
Write-Host "   3. Check dashboard:" -ForegroundColor Gray
Write-Host "      - Should show sandbox claim totals" -ForegroundColor Gray
Write-Host "      - Or fallback mock totals if sandbox returns empty" -ForegroundColor Gray
Write-Host "      - Real-time toasts should appear" -ForegroundColor Gray
Write-Host ""
Write-Host "   4. If no data:" -ForegroundColor Gray
Write-Host "      - Sandbox may return empty (this is normal)" -ForegroundColor Gray
Write-Host "      - System will use mock data for testing" -ForegroundColor Gray
Write-Host "      - Check logs for 'Sandbox returned empty data - this is normal'" -ForegroundColor Gray
Write-Host ""

