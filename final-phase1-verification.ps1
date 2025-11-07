# Final Phase 1 Verification Script
# Runs all verification steps in sequence

$ErrorActionPreference = "Continue"

Write-Host "🎯 Final Phase 1 Verification" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Clean old jobs
Write-Host "1️⃣  Cleaning Old Jobs..." -ForegroundColor Yellow
$env:REDIS_URL = "redis://localhost:6379"
node clean-queue.js
Write-Host ""

# Step 2: Check initial queue status
Write-Host "2️⃣  Initial Queue Status..." -ForegroundColor Yellow
node check-orchestration-status.js
Write-Host ""

# Step 3: Trigger Phase 1
Write-Host "3️⃣  Triggering Phase 1..." -ForegroundColor Yellow
$body = @{
    user_id = "test-user-sandbox-001"
    seller_id = "test-seller-sandbox-001"
    sync_id = "sandbox-test-001"
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $responseData = $response.Content | ConvertFrom-Json
    Write-Host "   ✅ Phase 1 triggered: $($responseData.message)" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "   ⏳ Waiting 5 seconds for processing..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# Step 4: Check queue status after trigger
Write-Host ""
Write-Host "4️⃣  Queue Status After Trigger..." -ForegroundColor Yellow
node check-orchestration-status.js
Write-Host ""

# Step 5: Test idempotency (second trigger)
Write-Host "5️⃣  Testing Idempotency (Second Trigger)..." -ForegroundColor Yellow
try {
    $response2 = Invoke-WebRequest -Uri "http://localhost:3001/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $responseData2 = $response2.Content | ConvertFrom-Json
    Write-Host "   Response: $($response2.Content)" -ForegroundColor Gray
    Write-Host "   📋 Check server logs for idempotency message" -ForegroundColor Yellow
} catch {
    Write-Host "   ⚠️  Second trigger: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Start-Sleep -Seconds 2

# Step 6: Get queue stats via API
Write-Host "6️⃣  Queue Statistics (via API)..." -ForegroundColor Yellow
try {
    $statsResponse = Invoke-WebRequest -Uri "http://localhost:3001/api/v1/workflow/queue/stats" `
        -Method GET `
        -TimeoutSec 5 `
        -ErrorAction Stop
    
    $stats = $statsResponse.Content | ConvertFrom-Json
    Write-Host "   Queue Stats:" -ForegroundColor Gray
    Write-Host "   $($statsResponse.Content)" -ForegroundColor Gray
} catch {
    Write-Host "   ⚠️  Stats endpoint failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=============================" -ForegroundColor Cyan
Write-Host "✅ Verification Complete" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Check Server Logs For:" -ForegroundColor Yellow
Write-Host "   - 'Processing orchestration job'" -ForegroundColor Gray
Write-Host "   - '🎬 Phase 1: Zero-Friction Onboarding'" -ForegroundColor Gray
Write-Host "   - 'Orchestration job completed'" -ForegroundColor Gray
Write-Host "   - Idempotency messages (if second trigger skipped)" -ForegroundColor Gray
Write-Host ""
Write-Host "📊 Next Steps:" -ForegroundColor Yellow
Write-Host "   1. Connect to real Supabase to see database updates" -ForegroundColor Gray
Write-Host "   2. Check WebSocket events (run test-websocket.js)" -ForegroundColor Gray
Write-Host "   3. Test concurrency: .\test-concurrency.ps1" -ForegroundColor Gray
Write-Host "   4. Clean queue: node clean-queue.js" -ForegroundColor Gray

