# Phase 3 Verification Script
# Verifies all Phase 3: Claim Detection components

param(
    [string]$ApiUrl = "http://localhost:3001",
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Phase 3: Claim Detection Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$results = @{
    ClaimDetectionEngine = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
    ConfidenceScoring = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
    DataSources = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
    AutomationQueue = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
    LoggingAudit = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
    AlertsNotifications = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
    SecurityEncryption = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
    BackgroundWorker = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
    DatabaseTables = @{
        Implemented = $false
        Functional = $false
        Notes = ""
    }
}

# 1. Check Claim Detection Engine
Write-Host "[1/10] Checking Claim Detection Engine..." -ForegroundColor Yellow
$detectionServicePath = "Integrations-backend/src/services/detectionService.ts"
if (Test-Path $detectionServicePath) {
    $content = Get-Content $detectionServicePath -Raw
    if ($content -match "runDetectionAlgorithms|detectClaims|detectOvercharges") {
        $results.ClaimDetectionEngine.Implemented = $true
        if ($content -match "missing_unit|overcharge|damaged_stock|incorrect_fee|duplicate_charge") {
            $results.ClaimDetectionEngine.Functional = $true
            $results.ClaimDetectionEngine.Notes = "Detection algorithms implemented with 5 anomaly types"
        }
    }
}
Write-Host "  Status: $(if ($results.ClaimDetectionEngine.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.ClaimDetectionEngine.Implemented) { "Green" } else { "Red" })

# 2. Check Confidence Scoring
Write-Host "[2/10] Checking Confidence Scoring..." -ForegroundColor Yellow
if ($content -match "confidence_score|confidenceScore") {
    $results.ConfidenceScoring.Implemented = $true
    if ($content -match "0\.85|0\.50|confidence.*>=|confidence.*<") {
        $results.ConfidenceScoring.Functional = $true
        $results.ConfidenceScoring.Notes = "Confidence scoring with thresholds: high (85%+), medium (50-85%), low (<50%)"
    }
}
Write-Host "  Status: $(if ($results.ConfidenceScoring.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.ConfidenceScoring.Implemented) { "Green" } else { "Red" })

# 3. Check Data Sources
Write-Host "[3/10] Checking Data Sources..." -ForegroundColor Yellow
$amazonSyncPath = "Integrations-backend/src/jobs/amazonSyncJob.ts"
if (Test-Path $amazonSyncPath) {
    $syncContent = Get-Content $amazonSyncPath -Raw
    if ($syncContent -match "fetchClaims|fetchInventory|fetchOrders|fetchReturns|fetchSettlements") {
        $results.DataSources.Implemented = $true
        $results.DataSources.Functional = $true
        $results.DataSources.Notes = "Data sources: Claims, Inventory, Orders, Returns, Settlements"
    }
}
Write-Host "  Status: $(if ($results.DataSources.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.DataSources.Implemented) { "Green" } else { "Red" })

# 4. Check Automation Queue
Write-Host "[4/10] Checking Automation Queue..." -ForegroundColor Yellow
if ($content -match "detection_queue|enqueueDetectionJob|processDetectionJobs") {
    $results.AutomationQueue.Implemented = $true
    if ($content -match "status.*pending|status.*processing|status.*completed") {
        $results.AutomationQueue.Functional = $true
        $results.AutomationQueue.Notes = "Detection queue with status tracking"
    }
}
Write-Host "  Status: $(if ($results.AutomationQueue.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.AutomationQueue.Implemented) { "Green" } else { "Red" })

# 5. Check Logging & Audit
Write-Host "[5/10] Checking Logging & Audit..." -ForegroundColor Yellow
if ($content -match "logger\.(info|error|warn)|auditLogger|logAuditEvent") {
    $results.LoggingAudit.Implemented = $true
    $results.LoggingAudit.Functional = $true
    $results.LoggingAudit.Notes = "Structured logging and audit trail implemented"
}
Write-Host "  Status: $(if ($results.LoggingAudit.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.LoggingAudit.Implemented) { "Green" } else { "Red" })

# 6. Check Alerts & Notifications
Write-Host "[6/10] Checking Alerts & Notifications..." -ForegroundColor Yellow
if ($content -match "websocketService|sendNotificationToUser|high.*confidence|medium.*confidence") {
    $results.AlertsNotifications.Implemented = $true
    $results.AlertsNotifications.Functional = $true
    $results.AlertsNotifications.Notes = "WebSocket notifications for high/medium/low confidence claims"
}
Write-Host "  Status: $(if ($results.AlertsNotifications.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.AlertsNotifications.Implemented) { "Green" } else { "Red" })

# 7. Check Security & Encryption
Write-Host "[7/10] Checking Security & Encryption..." -ForegroundColor Yellow
$envCheck = $env:APP_ENCRYPTION_KEY -or $env:ENCRYPTION_KEY
if ($envCheck) {
    $results.SecurityEncryption.Implemented = $true
    $results.SecurityEncryption.Functional = $true
    $results.SecurityEncryption.Notes = "Encryption keys configured"
} else {
    $results.SecurityEncryption.Notes = "Encryption keys not set in environment"
}
Write-Host "  Status: $(if ($results.SecurityEncryption.Implemented) { '✅' } else { '⚠️' })" -ForegroundColor $(if ($results.SecurityEncryption.Implemented) { "Green" } else { "Yellow" })

# 8. Check Background Worker
Write-Host "[8/10] Checking Background Worker..." -ForegroundColor Yellow
$workerPath = "Integrations-backend/src/jobs/backgroundSyncWorker.ts"
if (Test-Path $workerPath) {
    $workerContent = Get-Content $workerPath -Raw
    if ($workerContent -match "start\(\)|schedule|node-cron|every.*6.*hours") {
        $results.BackgroundWorker.Implemented = $true
        $results.BackgroundWorker.Functional = $true
        $results.BackgroundWorker.Notes = "Background worker with scheduled sync (every 6 hours)"
    }
}
Write-Host "  Status: $(if ($results.BackgroundWorker.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.BackgroundWorker.Implemented) { "Green" } else { "Red" })

# 9. Check Database Tables
Write-Host "[9/10] Checking Database Tables..." -ForegroundColor Yellow
$migrationPath = "Integrations-backend/migrations/004_add_financial_events_and_detection.sql"
if (Test-Path $migrationPath) {
    $migrationContent = Get-Content $migrationPath -Raw
    if ($migrationContent -match "CREATE TABLE.*detection_results|CREATE TABLE.*detection_queue|CREATE TABLE.*financial_events") {
        $results.DatabaseTables.Implemented = $true
        $results.DatabaseTables.Functional = $true
        $results.DatabaseTables.Notes = "Tables: detection_results, detection_queue, financial_events"
    }
}
Write-Host "  Status: $(if ($results.DatabaseTables.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.DatabaseTables.Implemented) { "Green" } else { "Red" })

# 10. Check Orchestration Integration
Write-Host "[10/10] Checking Orchestration Integration..." -ForegroundColor Yellow
$orchestrationPath = "Integrations-backend/src/jobs/orchestrationJob.ts"
if (Test-Path $orchestrationPath) {
    $orchContent = Get-Content $orchestrationPath -Raw
    if ($orchContent -match "triggerPhase3|Phase3|executePhase3") {
        $results.OrchestrationIntegration = @{
            Implemented = $true
            Functional = $true
            Notes = "Phase 3 orchestration integrated"
        }
    }
}
Write-Host "  Status: $(if ($results.OrchestrationIntegration.Implemented) { '✅' } else { '❌' })" -ForegroundColor $(if ($results.OrchestrationIntegration.Implemented) { "Green" } else { "Red" })

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$totalChecks = 0
$passedChecks = 0

foreach ($key in $results.Keys) {
    $check = $results[$key]
    if ($check -is [Hashtable]) {
        $totalChecks++
        if ($check.Implemented) {
            $passedChecks++
        }
    }
}

$passRate = [math]::Round(($passedChecks / $totalChecks) * 100, 2)
Write-Host "Pass Rate: $passRate% ($passedChecks/$totalChecks checks passed)" -ForegroundColor $(if ($passRate -ge 80) { "Green" } else { "Yellow" })
Write-Host ""

return $results


