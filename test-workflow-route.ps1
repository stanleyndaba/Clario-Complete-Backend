# Test Workflow Route Script
# Tests if the workflow route is accessible

$baseUrl = "http://localhost:3001"

Write-Host "🧪 Testing Workflow Route" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Health Check
Write-Host "1. Testing health endpoint..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-WebRequest -Uri "$baseUrl/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "   ✅ Server is running" -ForegroundColor Green
    Write-Host "   Response: $($healthResponse.Content)" -ForegroundColor Gray
} catch {
    Write-Host "   ❌ Server not accessible: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "   Please start the server:" -ForegroundColor Yellow
    Write-Host "   cd Integrations-backend" -ForegroundColor Gray
    Write-Host "   npm start" -ForegroundColor Gray
    exit 1
}

# Test 2: Workflow Health Check
Write-Host ""
Write-Host "2. Testing workflow health endpoint..." -ForegroundColor Yellow
try {
    $workflowHealth = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "   ✅ Workflow routes are registered" -ForegroundColor Green
    Write-Host "   Response: $($workflowHealth.Content)" -ForegroundColor Gray
} catch {
    Write-Host "   ❌ Workflow routes not accessible: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   This means the route is not registered. Check:" -ForegroundColor Yellow
    Write-Host "   1. Server was restarted after code changes" -ForegroundColor Gray
    Write-Host "   2. No compilation errors (run: npm run build)" -ForegroundColor Gray
    Write-Host "   3. Check server logs for 'Workflow routes registered'" -ForegroundColor Gray
}

# Test 3: Phase 1 Endpoint
Write-Host ""
Write-Host "3. Testing Phase 1 endpoint..." -ForegroundColor Yellow
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
    $errorContent = $_.Exception.Response | ConvertFrom-Json -ErrorAction SilentlyContinue
    
    Write-Host "   ❌ Phase 1 endpoint failed" -ForegroundColor Red
    Write-Host "   Status Code: $statusCode" -ForegroundColor Gray
    Write-Host "   Error: $($errorContent.message)" -ForegroundColor Gray
    
    if ($statusCode -eq 404) {
        Write-Host ""
        Write-Host "   Route not found. Possible causes:" -ForegroundColor Yellow
        Write-Host "   1. Server not restarted after code changes" -ForegroundColor Gray
        Write-Host "   2. Route file not being imported correctly" -ForegroundColor Gray
        Write-Host "   3. Check server startup logs for errors" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=========================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan

