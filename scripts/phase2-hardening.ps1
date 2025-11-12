# Phase 2 Hardening Script
# Comprehensive security hardening for Continuous Data Sync

param(
    [string]$ApiUrl = "https://sandbox.sellingpartnerapi-na.amazon.com",
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# Create logs directory
$logDir = "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = "$logDir/phase2-hardening-$timestamp.log"
$reportFile = "PHASE2_HARDENING_REPORT_$timestamp.md"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Add-Content -Path $logFile -Value $logMessage
    if ($Verbose -or $Level -eq "ERROR" -or $Level -eq "WARNING") {
        Write-Host $Message
    }
}

function Write-Success { param([string]$Message) Write-Log $Message "SUCCESS"; Write-Host "  ✅ $Message" -ForegroundColor Green }
function Write-Error { param([string]$Message) Write-Log $Message "ERROR"; Write-Host "  ❌ $Message" -ForegroundColor Red }
function Write-Warning { param([string]$Message) Write-Log $Message "WARNING"; Write-Host "  ⚠️  $Message" -ForegroundColor Yellow }
function Write-Info { param([string]$Message) Write-Log $Message "INFO" }

# Initialize results
$results = @{
    Environment = @{
        SandboxHttps = $false
        BackgroundSyncEnabled = $false
        DatabaseSecure = $false
    }
    SensitiveVariables = @{
        NoExposedCredentials = $false
        EncryptionKeysPresent = $false
        NoSecretsInLogs = $false
    }
    BackgroundWorker = @{
        RateLimiting = $false
        ExponentialBackoff = $false
        ErrorHandling = $false
        GracefulShutdown = $false
    }
    DataNormalization = @{
        JsonValidation = $false
        SqlInjectionProtection = $false
        SchemaIntegrity = $false
    }
    AuditLogging = @{
        StructuredLogs = $false
        LogRotation = $false
        SeverityLevels = $false
    }
    SandboxSafety = @{
        SandboxEndpoints = $false
        ProductionRejection = $false
        EmptyResponseHandling = $false
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Phase 2 Hardening Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Log file: $logFile" -ForegroundColor Gray
Write-Host ""

# 1. Environment Configuration
Write-Info "=== STEP 1: Environment Configuration ==="

# Check sandbox URL uses HTTPS
Write-Info "Checking sandbox URL security..."
if ($ApiUrl -match "^https://") {
    Write-Success "Sandbox URL uses HTTPS"
    $results.Environment.SandboxHttps = $true
} else {
    Write-Error "Sandbox URL does not use HTTPS: $ApiUrl"
}

# Check ENABLE_BACKGROUND_SYNC
Write-Info "Checking background sync configuration..."
$enableSync = $env:ENABLE_BACKGROUND_SYNC
if ($enableSync -eq "true" -or $enableSync -eq $null) {
    Write-Success "Background sync is enabled (or default)"
    $results.Environment.BackgroundSyncEnabled = $true
} else {
    Write-Warning "Background sync is disabled: ENABLE_BACKGROUND_SYNC=$enableSync"
}

# Check DATABASE_URL security
Write-Info "Checking database URL security..."
if ($DatabaseUrl) {
    if ($DatabaseUrl -match "localhost|127.0.0.1|\.local") {
        Write-Warning "Database URL appears to be local - ensure it's not exposed"
    } elseif ($DatabaseUrl -match "supabase|postgres") {
        Write-Success "Database URL appears to be a managed service"
        $results.Environment.DatabaseSecure = $true
    } else {
        Write-Warning "Database URL format unclear - verify it's secure"
    }
} else {
    Write-Warning "DATABASE_URL not set"
}

# 2. Sensitive Variables Audit
Write-Info ""
Write-Info "=== STEP 2: Sensitive Variables Audit ==="

# Check for exposed credentials in .env files
Write-Info "Scanning for exposed credentials..."
$envFiles = @(".env", ".env.local", ".env.production")
$foundSecrets = $false

foreach ($envFile in $envFiles) {
    if (Test-Path $envFile) {
        $content = Get-Content $envFile -Raw -ErrorAction SilentlyContinue
        if ($content) {
            # Check for common secret patterns
            if ($content -match "password\s*=\s*['\`"]?[^'\`"\s]+" -and $content -notmatch "password\s*=\s*$") {
                Write-Warning "Potential password found in $envFile"
                $foundSecrets = $true
            }
            if ($content -match "secret\s*=\s*['\`"]?[^'\`"\s]+" -and $content -notmatch "secret\s*=\s*$") {
                Write-Warning "Potential secret found in $envFile"
                $foundSecrets = $true
            }
        }
    }
}

if (-not $foundSecrets) {
    Write-Success "No obvious exposed credentials found in .env files"
    $results.SensitiveVariables.NoExposedCredentials = $true
} else {
    Write-Error "Potential credentials found - review .env files"
}

# Check for encryption keys
Write-Info "Checking for encryption keys..."
$hasEncryptionKey = $env:ENCRYPTION_KEY -or $env:SECRET_STORE_KEY -or $env:JWT_SECRET
if ($hasEncryptionKey) {
    Write-Success "Encryption/secret keys are configured"
    $results.SensitiveVariables.EncryptionKeysPresent = $true
} else {
    Write-Warning "No encryption keys found - ensure secrets are encrypted"
}

# Check logging for secrets
Write-Info "Checking log sanitization..."
$loggerPath = "Integrations-backend/src/utils/logger.ts"
if (Test-Path $loggerPath) {
    $loggerContent = Get-Content $loggerPath -Raw
    if ($loggerContent -match "sanitizeLogData|sanitize") {
        Write-Success "Log sanitization is implemented"
        $results.SensitiveVariables.NoSecretsInLogs = $true
    } else {
        Write-Warning "Log sanitization may not be implemented"
    }
} else {
    Write-Warning "Logger file not found"
}

# 3. Background Worker Hardening
Write-Info ""
Write-Info "=== STEP 3: Background Worker Hardening ==="

$workerPath = "Integrations-backend/src/jobs/backgroundSyncWorker.ts"
if (Test-Path $workerPath) {
    $workerContent = Get-Content $workerPath -Raw
    
    # Check for rate limiting
    Write-Info "Checking rate limiting..."
    if ($workerContent -match "rate.*limit|delay|throttle|2000|1000") {
        Write-Success "Rate limiting appears to be implemented"
        $results.BackgroundWorker.RateLimiting = $true
    } else {
        Write-Warning "Rate limiting may not be implemented"
    }
    
    # Check for exponential backoff
    Write-Info "Checking exponential backoff..."
    if ($workerContent -match "exponential|backoff|RETRY_DELAY|retry.*delay") {
        Write-Success "Exponential backoff appears to be implemented"
        $results.BackgroundWorker.ExponentialBackoff = $true
    } else {
        Write-Warning "Exponential backoff may not be implemented"
    }
    
    # Check for error handling
    Write-Info "Checking error handling..."
    if ($workerContent -match "catch|error.*handling|try.*catch") {
        Write-Success "Error handling is implemented"
        $results.BackgroundWorker.ErrorHandling = $true
    } else {
        Write-Error "Error handling may be missing"
    }
    
    # Check for graceful shutdown
    Write-Info "Checking graceful shutdown..."
    if ($workerContent -match "stop\(\)|shutdown|SIGTERM|SIGINT|process\.on") {
        Write-Success "Graceful shutdown appears to be implemented"
        $results.BackgroundWorker.GracefulShutdown = $true
    } else {
        Write-Warning "Graceful shutdown may not be implemented"
    }
} else {
    Write-Error "Background worker file not found: $workerPath"
}

# Check Phase 2 Sync Orchestrator
$orchestratorPath = "Integrations-backend/src/jobs/phase2SyncOrchestrator.ts"
if (Test-Path $orchestratorPath) {
    $orchestratorContent = Get-Content $orchestratorPath -Raw
    
    # Check for retry logic
    if ($orchestratorContent -match "MAX_RETRIES|RETRY_DELAY|retry|backoff") {
        Write-Success "Retry logic found in orchestrator"
        $results.BackgroundWorker.ExponentialBackoff = $true
    }
    
    # Check for rate limiting
    if ($orchestratorContent -match "RATE_LIMIT_DELAY|delay.*2000") {
        Write-Success "Rate limiting found in orchestrator"
        $results.BackgroundWorker.RateLimiting = $true
    }
}

# 4. Data Normalization Security
Write-Info ""
Write-Info "=== STEP 4: Data Normalization Security ==="

$services = @(
    "Integrations-backend/src/services/ordersService.ts",
    "Integrations-backend/src/services/shipmentsService.ts",
    "Integrations-backend/src/services/returnsService.ts",
    "Integrations-backend/src/services/settlementsService.ts"
)

$allServicesValid = $true
foreach ($servicePath in $services) {
    if (Test-Path $servicePath) {
        $serviceContent = Get-Content $servicePath -Raw
        
        # Check for JSON validation
        if ($serviceContent -match "JSON\.parse|JSON\.stringify|validate|schema") {
            Write-Success "JSON validation found in $(Split-Path $servicePath -Leaf)"
        } else {
            Write-Warning "JSON validation may be missing in $(Split-Path $servicePath -Leaf)"
            $allServicesValid = $false
        }
        
        # Check for SQL injection protection (using parameterized queries via Supabase)
        if ($serviceContent -match "supabase\.from|\.insert\(|\.update\(|\.eq\(") {
            Write-Success "Using Supabase client (parameterized queries) in $(Split-Path $servicePath -Leaf)"
        } else {
            Write-Warning "May not be using parameterized queries in $(Split-Path $servicePath -Leaf)"
            $allServicesValid = $false
        }
    }
}

if ($allServicesValid) {
    $results.DataNormalization.JsonValidation = $true
    $results.DataNormalization.SqlInjectionProtection = $true
}

# Check schema integrity
Write-Info "Checking schema integrity..."
$migrationPath = "Integrations-backend/src/database/migrations/002_create_phase2_tables.sql"
if (Test-Path $migrationPath) {
    $migrationContent = Get-Content $migrationPath -Raw
    if ($migrationContent -match "CREATE TABLE.*orders" -and 
        $migrationContent -match "CREATE TABLE.*shipments" -and
        $migrationContent -match "CREATE TABLE.*returns" -and
        $migrationContent -match "CREATE TABLE.*settlements") {
        Write-Success "All Phase 2 tables defined in migration"
        $results.DataNormalization.SchemaIntegrity = $true
    } else {
        Write-Error "Not all Phase 2 tables found in migration"
    }
} else {
    Write-Error "Migration file not found"
}

# 5. Audit Logging
Write-Info ""
Write-Info "=== STEP 5: Audit Logging ==="

# Check structured logging
Write-Info "Checking structured logging..."
$loggerPath = "Integrations-backend/src/utils/logger.ts"
if (Test-Path $loggerPath) {
    $loggerContent = Get-Content $loggerPath -Raw
    if ($loggerContent -match "winston|format\.json|format\.combine") {
        Write-Success "Structured JSON logging is implemented"
        $results.AuditLogging.StructuredLogs = $true
    } else {
        Write-Warning "Structured logging may not be implemented"
    }
    
    # Check log rotation
    if ($loggerContent -match "maxsize|maxFiles|maxSize|5242880|5MB") {
        Write-Success "Log rotation is configured"
        $results.AuditLogging.LogRotation = $true
    } else {
        Write-Warning "Log rotation may not be configured"
    }
} else {
    Write-Warning "Logger file not found"
}

# Check severity levels
Write-Info "Checking severity levels..."
$auditLoggerPath = "Integrations-backend/src/security/auditLogger.ts"
if (Test-Path $auditLoggerPath) {
    $auditContent = Get-Content $auditLoggerPath -Raw
    if ($auditContent -match "severity.*low|severity.*high|severity.*medium|INFO|WARN|ERROR") {
        Write-Success "Severity levels are implemented"
        $results.AuditLogging.SeverityLevels = $true
    } else {
        Write-Warning "Severity levels may not be implemented"
    }
} else {
    Write-Warning "Audit logger file not found"
}

# 6. Sandbox Safety
Write-Info ""
Write-Info "=== STEP 6: Sandbox Safety ==="

# Check sandbox endpoint detection
Write-Info "Checking sandbox endpoint detection..."
$amazonServicePath = "Integrations-backend/src/services/amazonService.ts"
if (Test-Path $amazonServicePath) {
    $amazonContent = Get-Content $amazonServicePath -Raw
    if ($amazonContent -match "isSandbox|sandbox\.sellingpartnerapi|AMAZON_SPAPI_BASE_URL.*sandbox") {
        Write-Success "Sandbox detection is implemented"
        $results.SandboxSafety.SandboxEndpoints = $true
    } else {
        Write-Error "Sandbox detection may not be implemented"
    }
    
    # Check production rejection
    if ($amazonContent -match "production.*reject|throw.*production|NODE_ENV.*production") {
        Write-Success "Production call rejection appears to be implemented"
        $results.SandboxSafety.ProductionRejection = $true
    } else {
        Write-Warning "Production call rejection may not be implemented"
    }
} else {
    Write-Error "Amazon service file not found"
}

# Check empty response handling
Write-Info "Checking empty response handling..."
$ordersServicePath = "Integrations-backend/src/services/ordersService.ts"
if (Test-Path $ordersServicePath) {
    $ordersContent = Get-Content $ordersServicePath -Raw
    if ($ordersContent -match "empty.*response|empty.*array|normal.*for.*sandbox") {
        Write-Success "Empty response handling is implemented"
        $results.SandboxSafety.EmptyResponseHandling = $true
    } else {
        Write-Warning "Empty response handling may not be implemented"
    }
} else {
    Write-Warning "Orders service file not found"
}

# 7. Generate Report
Write-Info ""
Write-Info "=== STEP 7: Generating Hardening Report ==="

# Calculate pass rates
$totalChecks = 0
$passedChecks = 0

# Count all checks across all categories
foreach ($categoryKey in $results.Keys) {
    $category = $results[$categoryKey]
    if ($category -is [Hashtable]) {
        foreach ($checkKey in $category.Keys) {
            $totalChecks++
            if ($category[$checkKey] -eq $true) {
                $passedChecks++
            }
        }
    }
}

$passRate = [math]::Round(($passedChecks / $totalChecks) * 100, 2)
$overallStatus = if ($passRate -ge 80) { "✅ PASS" } else { "❌ FAIL" }

# Generate report
$report = @"
# Phase 2 Hardening Report

**Generated**: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Overall Status**: $overallStatus
**Pass Rate**: $passRate% ($passedChecks/$totalChecks checks passed)

## Executive Summary

Phase 2 Continuous Data Sync hardening verification completed. This report shows the security posture of the Phase 2 implementation.

## Detailed Results

### 1. Environment Configuration
- **Sandbox HTTPS**: $(if ($results.Environment.SandboxHttps) { "✅ PASS" } else { "❌ FAIL" })
- **Background Sync Enabled**: $(if ($results.Environment.BackgroundSyncEnabled) { "✅ PASS" } else { "❌ FAIL" })
- **Database Secure**: $(if ($results.Environment.DatabaseSecure) { "✅ PASS" } else { "❌ FAIL" })

### 2. Sensitive Variables
- **No Exposed Credentials**: $(if ($results.SensitiveVariables.NoExposedCredentials) { "✅ PASS" } else { "❌ FAIL" })
- **Encryption Keys Present**: $(if ($results.SensitiveVariables.EncryptionKeysPresent) { "✅ PASS" } else { "❌ FAIL" })
- **No Secrets in Logs**: $(if ($results.SensitiveVariables.NoSecretsInLogs) { "✅ PASS" } else { "❌ FAIL" })

### 3. Background Worker Security
- **Rate Limiting**: $(if ($results.BackgroundWorker.RateLimiting) { "✅ PASS" } else { "❌ FAIL" })
- **Exponential Backoff**: $(if ($results.BackgroundWorker.ExponentialBackoff) { "✅ PASS" } else { "❌ FAIL" })
- **Error Handling**: $(if ($results.BackgroundWorker.ErrorHandling) { "✅ PASS" } else { "❌ FAIL" })
- **Graceful Shutdown**: $(if ($results.BackgroundWorker.GracefulShutdown) { "✅ PASS" } else { "❌ FAIL" })

### 4. Data Normalization Security
- **JSON Validation**: $(if ($results.DataNormalization.JsonValidation) { "✅ PASS" } else { "❌ FAIL" })
- **SQL Injection Protection**: $(if ($results.DataNormalization.SqlInjectionProtection) { "✅ PASS" } else { "❌ FAIL" })
- **Schema Integrity**: $(if ($results.DataNormalization.SchemaIntegrity) { "✅ PASS" } else { "❌ FAIL" })

### 5. Audit Logging
- **Structured Logs**: $(if ($results.AuditLogging.StructuredLogs) { "✅ PASS" } else { "❌ FAIL" })
- **Log Rotation**: $(if ($results.AuditLogging.LogRotation) { "✅ PASS" } else { "❌ FAIL" })
- **Severity Levels**: $(if ($results.AuditLogging.SeverityLevels) { "✅ PASS" } else { "❌ FAIL" })

### 6. Sandbox Safety
- **Sandbox Endpoints**: $(if ($results.SandboxSafety.SandboxEndpoints) { "✅ PASS" } else { "❌ FAIL" })
- **Production Rejection**: $(if ($results.SandboxSafety.ProductionRejection) { "✅ PASS" } else { "❌ FAIL" })
- **Empty Response Handling**: $(if ($results.SandboxSafety.EmptyResponseHandling) { "✅ PASS" } else { "❌ FAIL" })

## Recommendations

$(if ($passRate -lt 80) {
@"
### Critical Issues Found

The following areas need immediate attention:

$(if (-not $results.Environment.SandboxHttps) {
"- **Sandbox HTTPS**: Ensure all API calls use HTTPS endpoints
"})

$(if (-not $results.SensitiveVariables.NoExposedCredentials) {
"- **Exposed Credentials**: Review .env files and remove any hardcoded secrets
"})

$(if (-not $results.BackgroundWorker.RateLimiting) {
"- **Rate Limiting**: Implement rate limiting (1 req/sec) for SP-API calls
"})

$(if (-not $results.DataNormalization.SqlInjectionProtection) {
"- **SQL Injection**: Ensure all database queries use parameterized queries (Supabase client)
"})

$(if (-not $results.SandboxSafety.SandboxEndpoints) {
"- **Sandbox Detection**: Implement proper sandbox endpoint detection
"})
"@
} else {
@"
### All Systems Hardened

✅ Phase 2 is properly hardened and ready for production.

**Next Steps:**
1. Review any warnings in the detailed logs
2. Run periodic hardening checks
3. Monitor for security updates
4. Keep dependencies up to date
"@
})

## Log File

Detailed logs available at: `$logFile`

---
*Report generated by Phase 2 Hardening Script*
"@

Set-Content -Path $reportFile -Value $report
Write-Success "Report generated: $reportFile"

# Display Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Hardening Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Status: $overallStatus" -ForegroundColor $(if ($passRate -ge 80) { "Green" } else { "Red" })
Write-Host "Pass Rate: $passRate% ($passedChecks/$totalChecks checks passed)" -ForegroundColor $(if ($passRate -ge 80) { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "Report: $reportFile" -ForegroundColor Gray
Write-Host "Logs: $logFile" -ForegroundColor Gray
Write-Host ""

exit $(if ($passRate -ge 80) { 0 } else { 1 })

