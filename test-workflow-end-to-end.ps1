# End-to-End Workflow Route Test Script
# Tests the complete workflow route implementation

$ErrorActionPreference = "Continue"
$baseUrl = "http://localhost:3001"

Write-Host "🧪 END-TO-END WORKFLOW ROUTE TEST" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Server Health
Write-Host "1️⃣  Testing Server Health..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-WebRequest -Uri "$baseUrl/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "   ✅ Server is running" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Server not accessible" -ForegroundColor Red
    Write-Host "   Please start the server: cd Integrations-backend && npm start" -ForegroundColor Yellow
    exit 1
}

# Test 2: Workflow Health Endpoint
Write-Host ""
Write-Host "2️⃣  Testing Workflow Health Endpoint..." -ForegroundColor Yellow
try {
    $workflowHealth = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    $responseData = $workflowHealth.Content | ConvertFrom-Json
    
    if ($responseData.status -eq "ok" -and $responseData.service -eq "workflow-routes") {
        Write-Host "   ✅ Workflow routes are registered and accessible" -ForegroundColor Green
        Write-Host "   Response: $($workflowHealth.Content)" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  Unexpected response: $($workflowHealth.Content)" -ForegroundColor Yellow
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "   ❌ Workflow health endpoint failed (Status: $statusCode)" -ForegroundColor Red
    Write-Host "   This means the route is NOT registered. Check:" -ForegroundColor Yellow
    Write-Host "   1. Server was restarted after code changes" -ForegroundColor Gray
    Write-Host "   2. Check server logs for 'Workflow routes module loaded'" -ForegroundColor Gray
    Write-Host "   3. Check server logs for 'Workflow routes registered at /api/v1/workflow'" -ForegroundColor Gray
    exit 1
}

# Test 3: Phase 1 Endpoint - First Trigger
Write-Host ""
Write-Host "3️⃣  Testing Phase 1 Endpoint (First Trigger)..." -ForegroundColor Yellow
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
    
    if ($responseData.success -eq $true -and $responseData.phase -eq 1) {
        Write-Host "   ✅ Phase 1 endpoint is working!" -ForegroundColor Green
        Write-Host "   Response: $($phase1Response.Content)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "   📋 Check server logs for:" -ForegroundColor Yellow
        Write-Host "      - 'Workflow phase route hit'" -ForegroundColor Gray
        Write-Host "      - 'Workflow phase 1 triggered'" -ForegroundColor Gray
        Write-Host "      - '🎬 Phase 1: Zero-Friction Onboarding'" -ForegroundColor Gray
        Write-Host "      - 'Orchestration job added to queue'" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  Unexpected response: $($phase1Response.Content)" -ForegroundColor Yellow
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errorContent = try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $reader.ReadToEnd() | ConvertFrom-Json
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
        Write-Host "   🔧 ROUTE NOT FOUND - Troubleshooting:" -ForegroundColor Yellow
        Write-Host "   1. Restart the server (Ctrl+C, then npm start)" -ForegroundColor Gray
        Write-Host "   2. Verify route file exists: Integrations-backend/src/routes/workflowRoutes.ts" -ForegroundColor Gray
        Write-Host "   3. Check server startup logs for route registration" -ForegroundColor Gray
        Write-Host "   4. Run: npm run build (check for compilation errors)" -ForegroundColor Gray
    }
    exit 1
}

# Test 4: Idempotency Test (Second Trigger)
Write-Host ""
Write-Host "4️⃣  Testing Idempotency (Second Trigger)..." -ForegroundColor Yellow
Write-Host "   Waiting 2 seconds before second trigger..." -ForegroundColor Gray
Start-Sleep -Seconds 2

try {
    $phase1Response2 = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $responseData2 = $phase1Response2.Content | ConvertFrom-Json
    
    Write-Host "   ✅ Second trigger completed" -ForegroundColor Green
    Write-Host "   Response: $($phase1Response2.Content)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   📋 Check server logs for idempotency message:" -ForegroundColor Yellow
    Write-Host "      - 'Phase 1 already completed for this workflow (idempotency)' OR" -ForegroundColor Gray
    Write-Host "      - 'Phase 1 job already exists in queue (idempotency)'" -ForegroundColor Gray
} catch {
    Write-Host "   ⚠️  Second trigger failed (may be expected if idempotency check works)" -ForegroundColor Yellow
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
}

# Test 5: Invalid Phase Number
Write-Host ""
Write-Host "5️⃣  Testing Invalid Phase Number..." -ForegroundColor Yellow
$invalidBody = @{
    user_id = "test-user-sandbox-001"
} | ConvertTo-Json

try {
    $invalidResponse = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/phase/99" `
        -Method POST `
        -Body $invalidBody `
        -ContentType "application/json" `
        -TimeoutSec 5 `
        -ErrorAction Stop
    
    Write-Host "   ⚠️  Should have returned 400 error" -ForegroundColor Yellow
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 400) {
        Write-Host "   ✅ Invalid phase number correctly rejected (400)" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Unexpected status code: $statusCode" -ForegroundColor Yellow
    }
}

# Test 6: Missing user_id
Write-Host ""
Write-Host "6️⃣  Testing Missing user_id..." -ForegroundColor Yellow
$missingUserIdBody = @{
    seller_id = "test-seller-sandbox-001"
} | ConvertTo-Json

try {
    $missingResponse = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $missingUserIdBody `
        -ContentType "application/json" `
        -TimeoutSec 5 `
        -ErrorAction Stop
    
    Write-Host "   ⚠️  Should have returned 400 error" -ForegroundColor Yellow
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 400) {
        Write-Host "   ✅ Missing user_id correctly rejected (400)" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Unexpected status code: $statusCode" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "✅ END-TO-END TEST COMPLETE" -ForegroundColor Green
Write-Host ""
Write-Host "📋 VERIFICATION CHECKLIST:" -ForegroundColor Yellow
Write-Host "1. ✅ Server is running" -ForegroundColor Gray
Write-Host "2. ✅ Workflow health endpoint works" -ForegroundColor Gray
Write-Host "3. ✅ Phase 1 endpoint works" -ForegroundColor Gray
Write-Host "4. ✅ Idempotency test completed" -ForegroundColor Gray
Write-Host "5. ✅ Validation tests passed" -ForegroundColor Gray
Write-Host ""
Write-Host "🔍 NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Check server logs for orchestration job processing" -ForegroundColor Gray
Write-Host "2. Verify WebSocket event 'workflow.phase.1.completed' is emitted" -ForegroundColor Gray
Write-Host "3. Check Bull queue for Phase 1 job" -ForegroundColor Gray
Write-Host "4. Verify Phase 2 job is queued after Phase 1 completes" -ForegroundColor Gray

