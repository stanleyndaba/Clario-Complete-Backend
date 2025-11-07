# Verify Phase 1 Execution
# Checks orchestration logs, queue status, and database

$ErrorActionPreference = "Continue"

Write-Host "🔍 Phase 1 Execution Verification" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if Supabase is connected
Write-Host "1️⃣  Checking Supabase Connection..." -ForegroundColor Yellow
Write-Host "   Look for in server logs:" -ForegroundColor Gray
Write-Host "   - 'Supabase connected successfully' (real connection)" -ForegroundColor Green
Write-Host "   - 'Using demo Supabase client' (mock client - no DB updates)" -ForegroundColor Yellow
Write-Host ""

# Step 2: Trigger Phase 1
Write-Host "2️⃣  Triggering Phase 1..." -ForegroundColor Yellow
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
    Write-Host "   ❌ Phase 1 trigger failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "   ⏳ Waiting 5 seconds for job to process..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# Step 3: Check queue status
Write-Host ""
Write-Host "3️⃣  Checking Queue Status..." -ForegroundColor Yellow
Write-Host "   Running: node check-orchestration-status.js" -ForegroundColor Gray
Write-Host ""

$env:REDIS_URL = "redis://localhost:6379"
node check-orchestration-status.js

Write-Host ""
Write-Host "4️⃣  Check Server Logs For:" -ForegroundColor Yellow
Write-Host "   ✅ 'Processing orchestration job'" -ForegroundColor Green
Write-Host "   ✅ '🎬 Phase 1: Zero-Friction Onboarding'" -ForegroundColor Green
Write-Host "   ✅ 'Orchestration job completed'" -ForegroundColor Green
Write-Host "   ✅ 'Workflow phase event emitted'" -ForegroundColor Green
Write-Host ""

Write-Host "5️⃣  Database Verification:" -ForegroundColor Yellow
Write-Host "   If using real Supabase, check sync_progress table:" -ForegroundColor Gray
Write-Host "   SELECT * FROM sync_progress WHERE sync_id = 'sandbox-test-001';" -ForegroundColor Cyan
Write-Host "   Expected: phase_number = 1, status = 'completed'" -ForegroundColor Gray
Write-Host ""

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Verification Complete" -ForegroundColor Green

