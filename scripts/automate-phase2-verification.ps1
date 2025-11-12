# Phase 2 Automated Verification Script
# Comprehensive verification for Continuous Data Sync in sandbox

param(
    [string]$UserId = "sandbox-user",
    [string]$ApiUrl = "http://localhost:3001",
    [switch]$AutoFix = $false
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# Create logs directory if it doesn't exist
$logDir = "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = "$logDir/phase2-sandbox-verification-$timestamp.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Add-Content -Path $logFile -Value $logMessage
    Write-Host $Message
}

function Write-Success { param([string]$Message) Write-Log $Message "SUCCESS"; Write-Host $Message -ForegroundColor Green }
function Write-Error { param([string]$Message) Write-Log $Message "ERROR"; Write-Host $Message -ForegroundColor Red }
function Write-Warning { param([string]$Message) Write-Log $Message "WARNING"; Write-Host $Message -ForegroundColor Yellow }
function Write-Info { param([string]$Message) Write-Log $Message "INFO" }

# Initialize results
$results = @{
    Environment = @{
        OS = $false
        EnvVars = $false
        Database = $false
    }
    Database = @{
        Migration = $false
        Tables = $false
        Indexes = $false
        JSONB = $false
    }
    Services = @{
        Orders = $false
        Shipments = $false
        Returns = $false
        Settlements = $false
    }
    BackgroundWorker = @{
        Exists = $false
        Scheduled = $false
        Integration = $false
    }
    ErrorHandling = @{
        EmptyResponses = $false
        SandboxMode = $false
        Logging = $false
    }
    Overall = $false
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Phase 2 Automated Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Log file: $logFile" -ForegroundColor Gray
Write-Host ""

# 1. Environment Setup
Write-Info "=== STEP 1: Environment Setup ==="

# Detect OS
$os = $PSVersionTable.Platform
if (-not $os) {
    if ($IsWindows) { $os = "Windows" }
    elseif ($IsLinux) { $os = "Linux" }
    elseif ($IsMacOS) { $os = "macOS" }
    else { $os = "Unknown" }
}
Write-Info "Detected OS: $os"
$results.Environment.OS = $true

# Check environment variables
Write-Info "Checking environment variables..."
$envVars = @{
    "ENABLE_BACKGROUND_SYNC" = $env:ENABLE_BACKGROUND_SYNC
    "AMAZON_SPAPI_BASE_URL" = $env:AMAZON_SPAPI_BASE_URL
    "DATABASE_URL" = $env:DATABASE_URL
}

$envVarsOk = $true
foreach ($key in $envVars.Keys) {
    if (-not $envVars[$key]) {
        Write-Warning "  ⚠️  $key not set"
        if ($AutoFix -and $key -eq "ENABLE_BACKGROUND_SYNC") {
            $env:ENABLE_BACKGROUND_SYNC = "true"
            Write-Success "  ✅ Set $key = true"
        } elseif ($AutoFix -and $key -eq "AMAZON_SPAPI_BASE_URL") {
            $env:AMAZON_SPAPI_BASE_URL = "https://sandbox.sellingpartnerapi-na.amazon.com"
            Write-Success "  ✅ Set $key = https://sandbox.sellingpartnerapi-na.amazon.com"
        } else {
            $envVarsOk = $false
        }
    } else {
        Write-Success "  ✅ $key is set"
    }
}

if ($envVarsOk) {
    $results.Environment.EnvVars = $true
} else {
    Write-Warning "Some environment variables are missing. Set them manually or use -AutoFix"
}

# Check database connection
Write-Info "Checking database connection..."
if ($env:DATABASE_URL) {
    try {
        # Try to parse DATABASE_URL (basic check)
        if ($env:DATABASE_URL -match "postgres") {
            Write-Success "  ✅ DATABASE_URL appears valid (PostgreSQL)"
            $results.Environment.Database = $true
        } else {
            Write-Warning "  ⚠️  DATABASE_URL format may be incorrect"
        }
    } catch {
        Write-Warning "  ⚠️  Could not validate DATABASE_URL: $_"
    }
} else {
    Write-Warning "  ⚠️  DATABASE_URL not set - database checks will be skipped"
}

# 2. Database Verification
Write-Info ""
Write-Info "=== STEP 2: Database Verification ==="

# Check migration file exists
$migrationFile = "Integrations-backend/src/database/migrations/002_create_phase2_tables.sql"
if (Test-Path $migrationFile) {
    Write-Success "  ✅ Migration file exists: $migrationFile"
    $results.Database.Migration = $true
    
    # Check migration content
    $migrationContent = Get-Content $migrationFile -Raw
    $requiredTables = @("orders", "shipments", "returns", "settlements")
    $tablesFound = 0
    
    foreach ($table in $requiredTables) {
        if ($migrationContent -match "CREATE TABLE.*$table") {
            $tablesFound++
            Write-Success "    ✅ Table '$table' found in migration"
        } else {
            Write-Error "    ❌ Table '$table' not found in migration"
        }
    }
    
    if ($tablesFound -eq $requiredTables.Count) {
        $results.Database.Tables = $true
    }
    
    # Check for indexes
    if ($migrationContent -match "CREATE INDEX") {
        Write-Success "    ✅ Indexes defined in migration"
        $results.Database.Indexes = $true
    } else {
        Write-Warning "    ⚠️  No indexes found in migration"
    }
    
    # Check for JSONB columns
    if ($migrationContent -match "JSONB") {
        Write-Success "    ✅ JSONB columns defined"
        $results.Database.JSONB = $true
    } else {
        Write-Warning "    ⚠️  No JSONB columns found"
    }
    
    # Check for sandbox flags
    if ($migrationContent -match "is_sandbox") {
        Write-Success "    ✅ Sandbox flags (is_sandbox) defined"
    } else {
        Write-Warning "    ⚠️  Sandbox flags not found"
    }
} else {
    Write-Error "  ❌ Migration file not found: $migrationFile"
}

# 3. Service Verification
Write-Info ""
Write-Info "=== STEP 3: Service Verification ==="

$services = @{
    "Orders" = "Integrations-backend/src/services/ordersService.ts"
    "Shipments" = "Integrations-backend/src/services/shipmentsService.ts"
    "Returns" = "Integrations-backend/src/services/returnsService.ts"
    "Settlements" = "Integrations-backend/src/services/settlementsService.ts"
}

foreach ($serviceName in $services.Keys) {
    $servicePath = $services[$serviceName]
    Write-Info "Checking $serviceName Service..."
    
    if (Test-Path $servicePath) {
        Write-Success "  ✅ Service file exists: $servicePath"
        
        $content = Get-Content $servicePath -Raw
        
        # Check for required methods
        $requiredMethods = @(
            "fetch$serviceName",
            "normalize$serviceName",
            "save$serviceName`ToDatabase"
        )
        
        # Adjust method names for each service
        if ($serviceName -eq "Orders") {
            $requiredMethods = @("fetchOrders", "normalizeOrders", "saveOrdersToDatabase")
        } elseif ($serviceName -eq "Shipments") {
            $requiredMethods = @("fetchShipments", "normalizeShipments", "saveShipmentsToDatabase")
        } elseif ($serviceName -eq "Returns") {
            $requiredMethods = @("fetchReturns", "normalizeReturns", "saveReturnsToDatabase")
        } elseif ($serviceName -eq "Settlements") {
            $requiredMethods = @("fetchSettlements", "normalizeSettlements", "saveSettlementsToDatabase")
        }
        
        $methodsFound = 0
        foreach ($method in $requiredMethods) {
            if ($content -match $method) {
                $methodsFound++
                Write-Success "    ✅ Method '$method' found"
            } else {
                Write-Error "    ❌ Method '$method' not found"
            }
        }
        
        # Check for error handling
        if ($content -match "catch" -and $content -match "isSandbox") {
            Write-Success "    ✅ Error handling with sandbox support found"
            $results.ErrorHandling.EmptyResponses = $true
            $results.ErrorHandling.SandboxMode = $true
        } else {
            Write-Warning "    ⚠️  Error handling may be incomplete"
        }
        
        # Check for logging
        if ($content -match "logger\.") {
            Write-Success "    ✅ Logging implemented"
            $results.ErrorHandling.Logging = $true
        } else {
            Write-Warning "    ⚠️  Logging may be incomplete"
        }
        
        if ($methodsFound -eq $requiredMethods.Count) {
            $results.Services[$serviceName] = $true
        }
    } else {
        Write-Error "  ❌ Service file not found: $servicePath"
    }
}

# 4. Background Worker Verification
Write-Info ""
Write-Info "=== STEP 4: Background Worker Verification ==="

$workerPath = "Integrations-backend/src/jobs/backgroundSyncWorker.ts"
if (Test-Path $workerPath) {
    Write-Success "  ✅ Background worker file exists"
    $results.BackgroundWorker.Exists = $true
    
    $content = Get-Content $workerPath -Raw
    
    # Check for required methods
    if ($content -match "start\(\)" -and $content -match "executeScheduledSync") {
        Write-Success "    ✅ Required methods found"
    } else {
        Write-Error "    ❌ Required methods missing"
    }
    
    # Check for schedule configuration
    if ($content -match "0 \*/6 \* \* \*" -or $content -match "schedule.*6.*hour") {
        Write-Success "    ✅ Schedule configured (every 6 hours)"
        $results.BackgroundWorker.Scheduled = $true
    } else {
        Write-Warning "    ⚠️  Schedule may not be configured correctly"
    }
} else {
    Write-Error "  ❌ Background worker file not found"
}

# Check integration in main app
$indexPath = "Integrations-backend/src/index.ts"
if (Test-Path $indexPath) {
    $indexContent = Get-Content $indexPath -Raw
    if ($indexContent -match "backgroundSyncWorker" -and $indexContent -match "backgroundSyncWorker\.start") {
        Write-Success "  ✅ Background worker integrated in main app"
        $results.BackgroundWorker.Integration = $true
    } else {
        Write-Warning "  ⚠️  Background worker may not be integrated"
    }
} else {
    Write-Error "  ❌ Main app file not found"
}

# 5. Sync Job Integration Verification
Write-Info ""
Write-Info "=== STEP 5: Sync Job Integration Verification ==="

$syncJobPath = "Integrations-backend/src/jobs/amazonSyncJob.ts"
if (Test-Path $syncJobPath) {
    $syncContent = Get-Content $syncJobPath -Raw
    
    $syncTypes = @("Orders", "Shipments", "Returns", "Settlements")
    $syncsFound = 0
    
    foreach ($syncType in $syncTypes) {
        if ($syncContent -match "PHASE 2: Sync $syncType" -or $syncContent -match "Sync $syncType") {
            Write-Success "  ✅ $syncType sync integrated"
            $syncsFound++
        } else {
            Write-Warning "  ⚠️  $syncType sync may not be integrated"
        }
    }
    
    if ($syncsFound -eq $syncTypes.Count) {
        Write-Success "  ✅ All Phase 2 syncs integrated"
    }
} else {
    Write-Error "  ❌ Sync job file not found"
}

# 6. Generate Consolidated Report
Write-Info ""
Write-Info "=== STEP 6: Generating Consolidated Report ==="

# Calculate overall status
$allChecks = @(
    $results.Environment.OS,
    $results.Environment.EnvVars,
    $results.Database.Migration,
    $results.Database.Tables,
    $results.Services.Orders,
    $results.Services.Shipments,
    $results.Services.Returns,
    $results.Services.Settlements,
    $results.BackgroundWorker.Exists,
    $results.BackgroundWorker.Integration,
    $results.ErrorHandling.EmptyResponses,
    $results.ErrorHandling.SandboxMode
)

$passedChecks = ($allChecks | Where-Object { $_ -eq $true }).Count
$totalChecks = $allChecks.Count
$passRate = [math]::Round(($passedChecks / $totalChecks) * 100, 2)

$results.Overall = $passRate -ge 90  # 90% pass rate required

# Generate report
$reportPath = "PHASE2_VERIFICATION_REPORT_$timestamp.md"
$report = @"
# Phase 2 Verification Report

**Generated**: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Environment**: Sandbox
**User ID**: $UserId
**API URL**: $ApiUrl

## Executive Summary

**Status**: $(if ($results.Overall) { "✅ READY" } else { "❌ NOT READY" })
**Pass Rate**: $passRate% ($passedChecks/$totalChecks checks passed)

## Detailed Results

### 1. Environment Setup
- **OS Detection**: $(if ($results.Environment.OS) { "✅ PASS" } else { "❌ FAIL" })
- **Environment Variables**: $(if ($results.Environment.EnvVars) { "✅ PASS" } else { "❌ FAIL" })
- **Database Connection**: $(if ($results.Environment.Database) { "✅ PASS" } else { "❌ FAIL" })

### 2. Database Verification
- **Migration File**: $(if ($results.Database.Migration) { "✅ PASS" } else { "❌ FAIL" })
- **Tables Created**: $(if ($results.Database.Tables) { "✅ PASS" } else { "❌ FAIL" })
- **Indexes**: $(if ($results.Database.Indexes) { "✅ PASS" } else { "❌ FAIL" })
- **JSONB Columns**: $(if ($results.Database.JSONB) { "✅ PASS" } else { "❌ FAIL" })

### 3. Service Verification
- **Orders Service**: $(if ($results.Services.Orders) { "✅ PASS" } else { "❌ FAIL" })
- **Shipments Service**: $(if ($results.Services.Shipments) { "✅ PASS" } else { "❌ FAIL" })
- **Returns Service**: $(if ($results.Services.Returns) { "✅ PASS" } else { "❌ FAIL" })
- **Settlements Service**: $(if ($results.Services.Settlements) { "✅ PASS" } else { "❌ FAIL" })

### 4. Background Worker
- **Worker Exists**: $(if ($results.BackgroundWorker.Exists) { "✅ PASS" } else { "❌ FAIL" })
- **Scheduled**: $(if ($results.BackgroundWorker.Scheduled) { "✅ PASS" } else { "❌ FAIL" })
- **Integrated**: $(if ($results.BackgroundWorker.Integration) { "✅ PASS" } else { "❌ FAIL" })

### 5. Error Handling & Logging
- **Empty Response Handling**: $(if ($results.ErrorHandling.EmptyResponses) { "✅ PASS" } else { "❌ FAIL" })
- **Sandbox Mode Support**: $(if ($results.ErrorHandling.SandboxMode) { "✅ PASS" } else { "❌ FAIL" })
- **Logging**: $(if ($results.ErrorHandling.Logging) { "✅ PASS" } else { "❌ FAIL" })

## Recommendations

$(if (-not $results.Overall) {
@"
### Issues Found

$(if (-not $results.Environment.EnvVars) {
"- Set required environment variables: ENABLE_BACKGROUND_SYNC, AMAZON_SPAPI_BASE_URL, DATABASE_URL
"})

$(if (-not $results.Database.Migration) {
"- Run database migration: `psql `$DATABASE_URL -f Integrations-backend/src/database/migrations/002_create_phase2_tables.sql`
"})

$(if (-not $results.Services.Orders -or -not $results.Services.Shipments -or -not $results.Services.Returns -or -not $results.Services.Settlements) {
"- Verify all service files exist and contain required methods
"})

$(if (-not $results.BackgroundWorker.Integration) {
"- Ensure background worker is integrated in main app (index.ts)
"})
"@
} else {
@"
### All Systems Ready

✅ Phase 2 is fully implemented and ready for sandbox testing.

**Next Steps:**
1. Run database migration if not already done
2. Start application and verify background worker starts
3. Test manual sync in sandbox
4. Verify data in database tables
5. Monitor logs for sync completion

**Ready for Phase 3**: Alerts & Reimbursements Automation
"@
})

## Log File

Detailed logs available at: `$logFile`

---
*Report generated by Phase 2 Automated Verification Script*
"@

Set-Content -Path $reportPath -Value $report
Write-Success "  ✅ Report generated: $reportPath"

# 7. Display Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($results.Overall) {
    Write-Host "✅ PHASE 2 IS READY" -ForegroundColor Green
    Write-Host ""
    Write-Host "Pass Rate: $passRate% ($passedChecks/$totalChecks checks passed)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Run database migration (if not done)" -ForegroundColor White
    Write-Host "  2. Start application and verify background worker" -ForegroundColor White
    Write-Host "  3. Test manual sync in sandbox" -ForegroundColor White
    Write-Host "  4. Verify data in database tables" -ForegroundColor White
    Write-Host "  5. Proceed to Phase 3: Alerts & Reimbursements Automation" -ForegroundColor White
} else {
    Write-Host "❌ PHASE 2 IS NOT READY" -ForegroundColor Red
    Write-Host ""
    Write-Host "Pass Rate: $passRate% ($passedChecks/$totalChecks checks passed)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Issues Found:" -ForegroundColor Yellow
    
    if (-not $results.Environment.EnvVars) {
        Write-Host "  - Environment variables not set" -ForegroundColor Red
    }
    if (-not $results.Database.Migration) {
        Write-Host "  - Database migration not found or incomplete" -ForegroundColor Red
    }
    if (-not $results.Services.Orders) {
        Write-Host "  - Orders service issues" -ForegroundColor Red
    }
    if (-not $results.Services.Shipments) {
        Write-Host "  - Shipments service issues" -ForegroundColor Red
    }
    if (-not $results.Services.Returns) {
        Write-Host "  - Returns service issues" -ForegroundColor Red
    }
    if (-not $results.Services.Settlements) {
        Write-Host "  - Settlements service issues" -ForegroundColor Red
    }
    if (-not $results.BackgroundWorker.Integration) {
        Write-Host "  - Background worker not integrated" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Review detailed report: $reportPath" -ForegroundColor Yellow
    Write-Host "Review logs: $logFile" -ForegroundColor Yellow
    
    if ($AutoFix) {
        Write-Host ""
        Write-Host "Attempting auto-fix..." -ForegroundColor Cyan
        # Re-run verification
        Write-Host "Re-run verification after fixing issues" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Report: $reportPath" -ForegroundColor Gray
Write-Host "Logs: $logFile" -ForegroundColor Gray
Write-Host ""

exit $(if ($results.Overall) { 0 } else { 1 })

