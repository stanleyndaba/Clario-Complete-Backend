# Check Phase 1 Status Script
# Checks database, WebSocket events, and tests idempotency

$ErrorActionPreference = "Continue"
$baseUrl = "http://localhost:3001"
$wsUrl = "ws://localhost:3001"

Write-Host "🔍 Phase 1 Status Check" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check Database (via API if available, or direct query)
Write-Host "1️⃣  Checking Database..." -ForegroundColor Yellow
Write-Host "   Looking for sync_progress entry:" -ForegroundColor Gray
Write-Host "   - sync_id: 'sandbox-test-001'" -ForegroundColor Gray
Write-Host "   - user_id: 'test-user-sandbox-001'" -ForegroundColor Gray
Write-Host ""
Write-Host "   Note: If you have direct database access, run:" -ForegroundColor Yellow
Write-Host "   SELECT * FROM sync_progress WHERE sync_id = 'sandbox-test-001' AND user_id = 'test-user-sandbox-001';" -ForegroundColor Gray
Write-Host ""

# Step 2: Trigger Phase 1 (First Time)
Write-Host "2️⃣  Triggering Phase 1 (First Time)..." -ForegroundColor Yellow
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
    
    if ($responseData.success) {
        Write-Host "   ✅ Phase 1 triggered successfully" -ForegroundColor Green
        Write-Host "   Response: $($phase1Response.Content)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "   📋 Check server logs for:" -ForegroundColor Yellow
        Write-Host "      - '🎬 Phase 1: Zero-Friction Onboarding'" -ForegroundColor Gray
        Write-Host "      - 'Orchestration job added to queue'" -ForegroundColor Gray
        Write-Host "      - 'Workflow phase event emitted'" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  Phase 1 triggered but response indicates failure" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Phase 1 trigger failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "   ⏳ Waiting 5 seconds for Phase 1 to process..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# Step 3: Check WebSocket Events (Instructions)
Write-Host ""
Write-Host "3️⃣  WebSocket Event Check..." -ForegroundColor Yellow
Write-Host "   To listen for WebSocket events, use one of these methods:" -ForegroundColor Gray
Write-Host ""
Write-Host "   Option 1: Use a WebSocket client tool (like Postman or websocat)" -ForegroundColor Gray
Write-Host "   Connect to: ws://localhost:3001" -ForegroundColor Cyan
Write-Host "   Listen for event: 'workflow.phase.1.completed'" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Option 2: Use Node.js script (see test-websocket.js)" -ForegroundColor Gray
Write-Host "   Run: node test-websocket.js" -ForegroundColor Cyan
Write-Host ""

# Step 4: Trigger Phase 1 Again (Idempotency Test)
Write-Host "4️⃣  Testing Idempotency (Second Trigger)..." -ForegroundColor Yellow
Write-Host "   Triggering Phase 1 again with same parameters..." -ForegroundColor Gray
Write-Host ""

try {
    $phase1Response2 = Invoke-WebRequest -Uri "$baseUrl/api/v1/workflow/phase/1" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    $responseData2 = $phase1Response2.Content | ConvertFrom-Json
    
    Write-Host "   Response: $($phase1Response2.Content)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   📋 Check server logs for idempotency message:" -ForegroundColor Yellow
    Write-Host "      Expected: 'Phase 1 already completed for this workflow (idempotency)'" -ForegroundColor Green
    Write-Host "      OR: 'Phase 1 job already exists in queue (idempotency)'" -ForegroundColor Green
    Write-Host ""
    Write-Host "   If you see the idempotency message, ✅ idempotency is working!" -ForegroundColor Green
    Write-Host "   If you see '🎬 Phase 1' again, ❌ idempotency check may have failed" -ForegroundColor Red
    
} catch {
    Write-Host "   ⚠️  Second trigger failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=====================" -ForegroundColor Cyan
Write-Host "Status Check Complete" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Summary:" -ForegroundColor Yellow
Write-Host "1. Check database for sync_progress entry" -ForegroundColor Gray
Write-Host "2. Check server logs for Phase 1 execution" -ForegroundColor Gray
Write-Host "3. Verify WebSocket event 'workflow.phase.1.completed' was emitted" -ForegroundColor Gray
Write-Host "4. Verify idempotency prevented duplicate Phase 1 execution" -ForegroundColor Gray

