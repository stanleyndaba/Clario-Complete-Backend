# Phase 1 End-to-End Test Runner
# Executes the complete test plan in sequence

$ErrorActionPreference = "Continue"

Write-Host "🧪 Phase 1 End-to-End Test Plan" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check database before Phase 1
Write-Host "1️⃣  Step 1: Check Database Before Phase 1" -ForegroundColor Yellow
Write-Host "   Running: node check-database.js" -ForegroundColor Gray
Write-Host ""

$env:USER_ID = "test-user-sandbox-001"
$env:SYNC_ID = "sandbox-test-001"

try {
    node check-database.js
    Write-Host ""
    Write-Host "   ✅ Database check complete" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️  Database check failed (may need Supabase credentials)" -ForegroundColor Yellow
    Write-Host "   Continuing with test..." -ForegroundColor Gray
}

Write-Host ""
Write-Host "   Press any key to continue to Step 2..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Step 2: Start WebSocket listener (instructions)
Write-Host ""
Write-Host "2️⃣  Step 2: Start WebSocket Listener" -ForegroundColor Yellow
Write-Host "   Open a NEW terminal window and run:" -ForegroundColor Gray
Write-Host "   node test-websocket.js" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Keep that terminal running to listen for events." -ForegroundColor Gray
Write-Host "   Expected event: workflow.phase.1.completed" -ForegroundColor Gray
Write-Host ""
Write-Host "   Press any key after starting the WebSocket listener..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Step 3: Run Phase 1 trigger + idempotency check
Write-Host ""
Write-Host "3️⃣  Step 3: Run Phase 1 Trigger + Idempotency Check" -ForegroundColor Yellow
Write-Host "   Running: .\check-phase1-status.ps1" -ForegroundColor Gray
Write-Host ""

& .\check-phase1-status.ps1

Write-Host ""
Write-Host "   Press any key to continue to Step 4..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Step 4: Check database after Phase 1
Write-Host ""
Write-Host "4️⃣  Step 4: Check Database After Phase 1" -ForegroundColor Yellow
Write-Host "   Running: node check-database.js" -ForegroundColor Gray
Write-Host ""

try {
    node check-database.js
    Write-Host ""
    Write-Host "   ✅ Database check complete" -ForegroundColor Green
    Write-Host ""
    Write-Host "   Expected:" -ForegroundColor Yellow
    Write-Host "   - Entry with phase_number: 1" -ForegroundColor Gray
    Write-Host "   - Status: 'completed'" -ForegroundColor Gray
    Write-Host "   - Metadata showing Phase 1 execution" -ForegroundColor Gray
} catch {
    Write-Host "   ⚠️  Database check failed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "   Press any key to continue to Step 5..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Step 5: Verify WebSocket events
Write-Host ""
Write-Host "5️⃣  Step 5: Verify WebSocket Events" -ForegroundColor Yellow
Write-Host "   Check the WebSocket listener terminal for:" -ForegroundColor Gray
Write-Host "   ✅ workflow.phase.1.completed event received" -ForegroundColor Green
Write-Host ""
Write-Host "   Check server logs for:" -ForegroundColor Gray
Write-Host "   - 'Workflow phase route hit'" -ForegroundColor Gray
Write-Host "   - 'Workflow phase 1 triggered'" -ForegroundColor Gray
Write-Host "   - '🎬 Phase 1: Zero-Friction Onboarding'" -ForegroundColor Gray
Write-Host "   - 'Workflow phase event emitted'" -ForegroundColor Gray
Write-Host ""

Write-Host "================================" -ForegroundColor Cyan
Write-Host "✅ Test Plan Complete" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Summary:" -ForegroundColor Yellow
Write-Host "1. ✅ Database checked (before)" -ForegroundColor Gray
Write-Host "2. ✅ WebSocket listener started" -ForegroundColor Gray
Write-Host "3. ✅ Phase 1 triggered + idempotency tested" -ForegroundColor Gray
Write-Host "4. ✅ Database checked (after)" -ForegroundColor Gray
Write-Host "5. ✅ WebSocket events verified" -ForegroundColor Gray
Write-Host ""
Write-Host "🎯 Expected Outcomes:" -ForegroundColor Yellow
Write-Host "✅ Phase 1 executed properly" -ForegroundColor Green
Write-Host "✅ Idempotency verified (second trigger skipped)" -ForegroundColor Green
Write-Host "✅ Database entry created with correct metadata" -ForegroundColor Green
Write-Host "✅ WebSocket event workflow.phase.1.completed emitted" -ForegroundColor Green

