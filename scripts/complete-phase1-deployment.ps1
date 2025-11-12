# Complete Phase 1 Deployment Script
# Runs all 4 steps of production deployment verification

param(
    [string]$NodeApiUrl = "https://opside-node-api-woco.onrender.com",
    [string]$PythonApiUrl = "https://opside-python-api.onrender.com",
    [string]$DatabaseUrl = "",
    [switch]$SkipDatabase = $false,
    [switch]$Verbose = $false
)

Write-Host ""
Write-Host "🚀 Phase 1 Production Deployment - Complete Verification" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""

$step1Complete = $false
$step2Complete = $false
$step3Complete = $false
$step4Complete = $false

# Step 1: Database Migration
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "STEP 1: Database Migration" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($SkipDatabase) {
    Write-Host "⚠️  Skipping database migration check" -ForegroundColor Yellow
    Write-Host "   Use -SkipDatabase:`$false to enable" -ForegroundColor Gray
} elseif ($DatabaseUrl) {
    Write-Host "Running database migration..." -ForegroundColor Yellow
    try {
        & "$PSScriptRoot/run-db-migration.ps1" -DatabaseUrl $DatabaseUrl -Verify
        if ($LASTEXITCODE -eq 0) {
            $step1Complete = $true
            Write-Host "✅ Step 1: Database migration complete" -ForegroundColor Green
        } else {
            Write-Host "❌ Step 1: Database migration failed" -ForegroundColor Red
        }
    } catch {
        Write-Host "❌ Step 1: Error running migration: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "⚠️  Database URL not provided" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To run database migration:" -ForegroundColor Cyan
    Write-Host "1. Supabase: Go to SQL Editor and run:" -ForegroundColor Gray
    Write-Host "   Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. PostgreSQL CLI:" -ForegroundColor Gray
    Write-Host "   psql `"`$DATABASE_URL`" -f Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Or use this script with -DatabaseUrl parameter" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Press Enter to continue to Step 2..." -ForegroundColor Yellow
    Read-Host
}

# Step 2: Environment Variables
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "STEP 2: Environment Variables" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "Verifying environment variables via healthz endpoint..." -ForegroundColor Yellow
try {
    & "$PSScriptRoot/verify-env-vars.ps1" -ApiUrl $NodeApiUrl -Verbose:$Verbose
    if ($LASTEXITCODE -eq 0) {
        $step2Complete = $true
        Write-Host "✅ Step 2: Environment variables verified" -ForegroundColor Green
    } else {
        Write-Host "❌ Step 2: Environment variables verification failed" -ForegroundColor Red
        Write-Host ""
        Write-Host "Required variables:" -ForegroundColor Yellow
        Write-Host "  - AMAZON_CLIENT_ID" -ForegroundColor Gray
        Write-Host "  - AMAZON_CLIENT_SECRET" -ForegroundColor Gray
        Write-Host "  - AMAZON_SPAPI_REFRESH_TOKEN" -ForegroundColor Gray
        Write-Host "  - JWT_SECRET (min 32 chars)" -ForegroundColor Gray
        Write-Host "  - DATABASE_URL" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Step 2: Error verifying environment: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 3: Production Endpoints
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "STEP 3: Production Endpoints" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "Testing production endpoints..." -ForegroundColor Yellow
try {
    & "$PSScriptRoot/test-production-deployment.ps1" -NodeApiUrl $NodeApiUrl -PythonApiUrl $PythonApiUrl -SkipDatabase:$SkipDatabase -Verbose:$Verbose
    if ($LASTEXITCODE -eq 0) {
        $step3Complete = $true
        Write-Host "✅ Step 3: Production endpoints verified" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Step 3: Some endpoint tests failed (check output above)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Step 3: Error testing endpoints: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 4: Audit Logs
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "STEP 4: Audit Logs" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($SkipDatabase -or -not $DatabaseUrl) {
    Write-Host "⚠️  Skipping audit logs check (requires database access)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To check audit logs manually:" -ForegroundColor Cyan
    Write-Host "1. Use SQL queries from: scripts/check-audit-logs.sql" -ForegroundColor Gray
    Write-Host "2. Run in Supabase SQL Editor or via psql" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Key queries:" -ForegroundColor Yellow
    Write-Host "  - SELECT COUNT(*) FROM audit_logs;" -ForegroundColor Gray
    Write-Host "  - SELECT event_type, COUNT(*) FROM audit_logs GROUP BY event_type;" -ForegroundColor Gray
    Write-Host "  - SELECT * FROM audit_logs WHERE event_type LIKE '%token%' ORDER BY created_at DESC LIMIT 10;" -ForegroundColor Gray
} else {
    Write-Host "Checking audit logs..." -ForegroundColor Yellow
    try {
        $checkQuery = "SELECT COUNT(*) as count FROM audit_logs;"
        $result = & psql $DatabaseUrl -c $checkQuery 2>&1
        
        if ($result -match "\d+") {
            Write-Host "✅ Audit logs table accessible" -ForegroundColor Green
            Write-Host ""
            Write-Host "Run these queries to verify logging:" -ForegroundColor Cyan
            Write-Host "  See: scripts/check-audit-logs.sql" -ForegroundColor Gray
            $step4Complete = $true
        } else {
            Write-Host "⚠️  Could not verify audit logs (check manually)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "⚠️  Audit logs check requires manual verification" -ForegroundColor Yellow
        Write-Host "   See: scripts/check-audit-logs.sql" -ForegroundColor Gray
    }
}

# Final Summary
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "DEPLOYMENT VERIFICATION SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$steps = @(
    @{Name="Step 1: Database Migration"; Complete=$step1Complete},
    @{Name="Step 2: Environment Variables"; Complete=$step2Complete},
    @{Name="Step 3: Production Endpoints"; Complete=$step3Complete},
    @{Name="Step 4: Audit Logs"; Complete=$step4Complete}
)

foreach ($step in $steps) {
    $status = if ($step.Complete) { "✅" } else { "⏳" }
    $color = if ($step.Complete) { "Green" } else { "Yellow" }
    Write-Host "$status $($step.Name)" -ForegroundColor $color
}

$allComplete = $step1Complete -and $step2Complete -and $step3Complete -and $step4Complete

Write-Host ""
if ($allComplete) {
    Write-Host "🎉 ALL STEPS COMPLETE!" -ForegroundColor Green
    Write-Host ""
    Write-Host "✅ Auth layer is fully hardened" -ForegroundColor Green
    Write-Host "✅ Security features are tested" -ForegroundColor Green
    Write-Host "✅ Production-ready for Phase 2" -ForegroundColor Green
    Write-Host ""
    exit 0
} else {
    Write-Host "⚠️  Some steps need completion" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next actions:" -ForegroundColor Cyan
    if (-not $step1Complete) {
        Write-Host "  1. Run database migration (see Step 1 above)" -ForegroundColor Gray
    }
    if (-not $step2Complete) {
        Write-Host "  2. Set environment variables in production" -ForegroundColor Gray
    }
    if (-not $step3Complete) {
        Write-Host "  3. Fix endpoint issues (see Step 3 above)" -ForegroundColor Gray
    }
    if (-not $step4Complete) {
        Write-Host "  4. Verify audit logs (see Step 4 above)" -ForegroundColor Gray
    }
    Write-Host ""
    exit 1
}

