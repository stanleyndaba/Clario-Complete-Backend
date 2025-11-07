# Test Amazon Connection Frontend Endpoints
# This script tests the backend endpoints that the frontend calls

$BackendUrl = "http://localhost:3001"
$FrontendUrl = "http://localhost:3000"

Write-Host "🧪 Testing Amazon Connection Endpoints" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Connect Amazon endpoint
Write-Host "1. Testing 'Connect Amazon' endpoint..." -ForegroundColor Yellow
$response1 = Invoke-RestMethod -Uri "$BackendUrl/api/v1/integrations/amazon/auth/start?frontend_url=$FrontendUrl" -Method Get
Write-Host "Response:" -ForegroundColor Green
$response1 | ConvertTo-Json -Depth 10
Write-Host ""

# Test 2: Use Existing Connection endpoint
Write-Host "2. Testing 'Use Existing Connection' endpoint..." -ForegroundColor Yellow
$response2 = Invoke-RestMethod -Uri "$BackendUrl/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=$FrontendUrl" -Method Get
Write-Host "Response:" -ForegroundColor Green
$response2 | ConvertTo-Json -Depth 10
Write-Host ""

# Test 3: Diagnostics endpoint
Write-Host "3. Testing diagnostics endpoint..." -ForegroundColor Yellow
try {
    $response3 = Invoke-RestMethod -Uri "$BackendUrl/api/v1/integrations/amazon/diagnose" -Method Get
    Write-Host "Response:" -ForegroundColor Green
    $response3 | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Diagnostics endpoint not available or error: $_" -ForegroundColor Red
}
Write-Host ""

# Summary
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "✅ Tests complete!" -ForegroundColor Green
Write-Host ""

# Check responses
if ($response1.success) {
    Write-Host "✅ 'Connect Amazon' endpoint working" -ForegroundColor Green
    if ($response1.authUrl -like "*mock*") {
        Write-Host "⚠️  WARNING: Backend returning mock OAuth URL - credentials may not be configured" -ForegroundColor Yellow
    } else {
        Write-Host "✅ Backend returning real OAuth URL" -ForegroundColor Green
    }
} else {
    Write-Host "❌ 'Connect Amazon' endpoint failed" -ForegroundColor Red
}

if ($response2.bypassed) {
    Write-Host "✅ 'Use Existing Connection' endpoint working - OAuth bypassed" -ForegroundColor Green
} elseif ($response2.success) {
    Write-Host "⚠️  'Use Existing Connection' endpoint working but falling back to OAuth" -ForegroundColor Yellow
    Write-Host "   (AMAZON_SPAPI_REFRESH_TOKEN may not be set in backend)" -ForegroundColor Yellow
} else {
    Write-Host "❌ 'Use Existing Connection' endpoint failed" -ForegroundColor Red
}

