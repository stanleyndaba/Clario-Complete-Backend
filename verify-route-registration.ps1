# Comprehensive Route Registration Verification Script
# Verifies all aspects of workflow route registration

$ErrorActionPreference = "Continue"
$baseUrl = "http://localhost:3001"

Write-Host "🔍 COMPREHENSIVE ROUTE VERIFICATION" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify Route File Exists
Write-Host "1️⃣  Verifying Route File..." -ForegroundColor Yellow
$routeFile = "Integrations-backend/src/routes/workflowRoutes.ts"
if (Test-Path $routeFile) {
    Write-Host "   ✅ Route file exists: $routeFile" -ForegroundColor Green
    
    # Check for export
    $content = Get-Content $routeFile -Raw
    if ($content -match "export default router") {
        Write-Host "   ✅ Router is exported correctly" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Router export not found!" -ForegroundColor Red
    }
    
    # Check for Phase 1 handler
    if ($content -match "triggerPhase1_OAuthCompletion") {
        Write-Host "   ✅ Phase 1 handler calls triggerPhase1_OAuthCompletion" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Phase 1 handler not found!" -ForegroundColor Red
    }
} else {
    Write-Host "   ❌ Route file not found: $routeFile" -ForegroundColor Red
    exit 1
}

# Step 2: Verify Route Registration in index.ts
Write-Host ""
Write-Host "2️⃣  Verifying Route Registration..." -ForegroundColor Yellow
$indexFile = "Integrations-backend/src/index.ts"
if (Test-Path $indexFile) {
    $indexContent = Get-Content $indexFile -Raw
    
    # Check for import
    if ($indexContent -match "import workflowRoutes from") {
        Write-Host "   ✅ workflowRoutes imported" -ForegroundColor Green
    } else {
        Write-Host "   ❌ workflowRoutes import not found!" -ForegroundColor Red
    }
    
    # Check for registration
    if ($indexContent -match "app\.use\('/api/v1/workflow', workflowRoutes\)") {
        Write-Host "   ✅ Route registered at /api/v1/workflow" -ForegroundColor Green
        
        # Check registration order
        $lines = Get-Content $indexFile
        $workflowLine = -1
        $proxyLine = -1
        
        for ($i = 0; $i -lt $lines.Length; $i++) {
            if ($lines[$i] -match "app\.use\('/api/v1/workflow'") {
                $workflowLine = $i + 1
            }
            if ($lines[$i] -match "app\.use\('/', proxyRoutes\)") {
                $proxyLine = $i + 1
            }
        }
        
        if ($workflowLine -gt 0 -and $proxyLine -gt 0) {
            if ($workflowLine -lt $proxyLine) {
                Write-Host "   ✅ Route registered BEFORE proxyRoutes (correct order)" -ForegroundColor Green
                Write-Host "      Workflow: line $workflowLine, Proxy: line $proxyLine" -ForegroundColor Gray
            } else {
                Write-Host "   ❌ Route registered AFTER proxyRoutes (wrong order!)" -ForegroundColor Red
                Write-Host "      Workflow: line $workflowLine, Proxy: line $proxyLine" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "   ❌ Route not registered in index.ts!" -ForegroundColor Red
    }
} else {
    Write-Host "   ❌ index.ts not found!" -ForegroundColor Red
}

# Step 3: Check for Compilation Errors
Write-Host ""
Write-Host "3️⃣  Checking for Compilation Errors..." -ForegroundColor Yellow
Push-Location Integrations-backend
try {
    $buildOutput = npm run build 2>&1 | Out-String
    if ($buildOutput -match "error TS|Error:|error:") {
        Write-Host "   ❌ Compilation errors found!" -ForegroundColor Red
        Write-Host "   Errors:" -ForegroundColor Yellow
        $buildOutput -split "`n" | Where-Object { $_ -match "error" } | ForEach-Object {
            Write-Host "      $_" -ForegroundColor Gray
        }
    } else {
        Write-Host "   ✅ No compilation errors" -ForegroundColor Green
    }
} catch {
    Write-Host "   ⚠️  Could not check compilation (npm not available?)" -ForegroundColor Yellow
} finally {
    Pop-Location
}

# Step 4: Test Server Connection
Write-Host ""
Write-Host "4️⃣  Testing Server Connection..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-WebRequest -Uri "$baseUrl/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "   ✅ Server is running" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Server not accessible: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "   Please start the server:" -ForegroundColor Yellow
    Write-Host "   cd Integrations-backend" -ForegroundColor Gray
    Write-Host "   npm start" -ForegroundColor Gray
    exit 1
}

# Step 5: Test Workflow Health Endpoint
Write-Host ""
Write-Host "5️⃣  Testing Workflow Health Endpoint..." -ForegroundColor Yellow
try {
    $workflowHealth = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    $responseData = $workflowHealth.Content | ConvertFrom-Json
    Write-Host "   ✅ Workflow routes are accessible!" -ForegroundColor Green
    Write-Host "   Response: $($workflowHealth.Content)" -ForegroundColor Gray
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "   ❌ Workflow health endpoint failed (Status: $statusCode)" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   This indicates the route is not registered or server needs restart" -ForegroundColor Yellow
}

# Step 6: Test Phase 1 Endpoint
Write-Host ""
Write-Host "6️⃣  Testing Phase 1 Endpoint..." -ForegroundColor Yellow
$body = @{
    user_id = "test-user-sandbox-001"
    seller_id = "test-seller-sandbox-001"
    sync_id = "sandbox-test-001"
} | ConvertTo-Json

try {
    $phase1Response = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $responseData = $phase1Response.Content | ConvertFrom-Json
    Write-Host "   ✅ Phase 1 endpoint is working!" -ForegroundColor Green
    Write-Host "   Response: $($phase1Response.Content)" -ForegroundColor Gray
    
    if ($responseData.success) {
        Write-Host ""
        Write-Host "   🎉 SUCCESS! Phase 1 triggered successfully" -ForegroundColor Green
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errorContent = try {
        $_.Exception.Response | ConvertFrom-Json -ErrorAction SilentlyContinue
    } catch {
        $null
    }
    
    Write-Host "   ❌ Phase 1 endpoint failed" -ForegroundColor Red
    Write-Host "   Status Code: $statusCode" -ForegroundColor Gray
    if ($errorContent) {
        Write-Host "   Error: $($errorContent.message)" -ForegroundColor Gray
    }
    
    if ($statusCode -eq 404) {
        Write-Host ""
        Write-Host "   🔧 TROUBLESHOOTING STEPS:" -ForegroundColor Yellow
        Write-Host "   1. Restart the server (Ctrl+C, then npm start)" -ForegroundColor Gray
        Write-Host "   2. Check server logs for 'Workflow routes registered'" -ForegroundColor Gray
        Write-Host "   3. Verify no compilation errors" -ForegroundColor Gray
        Write-Host "   4. Check that route file is in correct location" -ForegroundColor Gray
    }
}

# Step 7: Test Idempotency
Write-Host ""
Write-Host "7️⃣  Testing Idempotency (Second Trigger)..." -ForegroundColor Yellow
try {
    Start-Sleep -Seconds 2
    $phase1Response2 = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $responseData2 = $phase1Response2.Content | ConvertFrom-Json
    Write-Host "   ✅ Second trigger completed" -ForegroundColor Green
    Write-Host "   Response: $($phase1Response2.Content)" -ForegroundColor Gray
    Write-Host "   Note: Check server logs to verify duplicate was skipped" -ForegroundColor Gray
} catch {
    Write-Host "   ⚠️  Second trigger failed (may be expected if idempotency check works)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Verification Complete" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. If route returns 404, restart the server" -ForegroundColor Gray
Write-Host "2. Check server logs for route registration messages" -ForegroundColor Gray
Write-Host "3. Verify WebSocket events are emitted" -ForegroundColor Gray
Write-Host "4. Check orchestrator logs for Phase 1 execution" -ForegroundColor Gray

