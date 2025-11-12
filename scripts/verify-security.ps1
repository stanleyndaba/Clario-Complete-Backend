# PowerShell script to verify security hardening
# Run this after deploying security changes

Write-Host "Security Hardening Verification Checklist" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

$errors = 0
$warnings = 0

# 1. Check for hard-coded secrets
Write-Host "1. Checking for hard-coded secrets..." -ForegroundColor Yellow
$secretPatterns = @(
    "amzn1\.application-oa2-client\.[a-zA-Z0-9]{20,}",
    "Atzr\|[a-zA-Z0-9\-_]{50,}",
    "amzn1\.oa2-cs\.v1\.[a-zA-Z0-9]{20,}",
    "sk_live_[a-zA-Z0-9]{20,}",
    "SG\.[a-zA-Z0-9\-_]{50,}"
)

$foundSecrets = 0
foreach ($pattern in $secretPatterns) {
    $matches = Get-ChildItem -Recurse -Include *.ts,*.js,*.py,*.md |
        Select-String -Pattern $pattern |
        Where-Object { $_.Line -notmatch "your-|placeholder|example" }
    
    if ($matches) {
        Write-Host "  ERROR: Found potential secrets matching: $pattern" -ForegroundColor Red
        $foundSecrets += $matches.Count
    }
}

if ($foundSecrets -gt 0) {
    Write-Host "  Warning: Found $foundSecrets potential hard-coded secrets" -ForegroundColor Yellow
    Write-Host "     (These may be in documentation files - review manually)" -ForegroundColor Gray
    if ($secretFiles.Count -le 10) {
        foreach ($file in $secretFiles) {
            Write-Host "     - $file" -ForegroundColor Gray
        }
    }
    $warnings++
} else {
    Write-Host "  OK: No hard-coded secrets found" -ForegroundColor Green
}

# 2. Check environment variables
Write-Host ""
Write-Host "2. Checking environment variables..." -ForegroundColor Yellow
$requiredVars = @(
    "AMAZON_CLIENT_ID",
    "AMAZON_CLIENT_SECRET",
    "AMAZON_SPAPI_REFRESH_TOKEN",
    "JWT_SECRET",
    "DATABASE_URL"
)

$missingVars = @()
foreach ($var in $requiredVars) {
    $value = [Environment]::GetEnvironmentVariable($var)
    if (-not $value -or $value -eq "") {
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    $missingList = $missingVars -join ', '
    Write-Host "  Warning: Missing environment variables: $missingList" -ForegroundColor Yellow
    Write-Host "     (This is OK if running locally without production env)" -ForegroundColor Gray
    $warnings++
} else {
    Write-Host "  OK: All required environment variables set" -ForegroundColor Green
}

# 3. Check security files exist
Write-Host ""
Write-Host "3. Checking security files..." -ForegroundColor Yellow
$securityFiles = @(
    "Integrations-backend/src/security/validateRedirect.ts",
    "Integrations-backend/src/security/logSanitizer.ts",
    "Integrations-backend/src/security/securityHeaders.ts",
    "Integrations-backend/src/security/tokenRotation.ts",
    "Integrations-backend/src/security/auditLogger.ts",
    "Integrations-backend/src/security/envValidation.ts",
    "Integrations-backend/src/security/rateLimiter.ts",
    "src/security/security_middleware.py",
    "Integrations-backend/src/routes/healthRoutes.ts"
)

$missingFiles = @()
foreach ($file in $securityFiles) {
    if (-not (Test-Path $file)) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host "  ERROR: Missing security files:" -ForegroundColor Red
    foreach ($file in $missingFiles) {
        Write-Host "     - $file" -ForegroundColor Red
    }
    $errors++
} else {
    Write-Host "  OK: All security files present" -ForegroundColor Green
}

# 4. Check package.json for security dependencies
Write-Host ""
Write-Host "4. Checking security dependencies..." -ForegroundColor Yellow
$packageJsonPath = "Integrations-backend/package.json"
if (Test-Path $packageJsonPath) {
    $packageJson = Get-Content $packageJsonPath | ConvertFrom-Json
    $hasSecurityPlugin = $packageJson.devDependencies.PSObject.Properties.Name -contains "eslint-plugin-security"
    if ($hasSecurityPlugin) {
        Write-Host "  OK: eslint-plugin-security found in package.json" -ForegroundColor Green
    } else {
        Write-Host "  Warning: eslint-plugin-security not found in package.json" -ForegroundColor Yellow
        $warnings++
    }
} else {
    Write-Host "  Warning: package.json not found" -ForegroundColor Yellow
    $warnings++
}

# 5. Check for .env files in git
Write-Host ""
Write-Host "5. Checking for .env files in git..." -ForegroundColor Yellow
$envFiles = git ls-files | Select-String "\.env$"
if ($envFiles) {
    Write-Host "  ERROR: Found .env files in git:" -ForegroundColor Red
    foreach ($file in $envFiles) {
        Write-Host "     - $file" -ForegroundColor Red
    }
    $errors++
} else {
    Write-Host "  OK: No .env files in git" -ForegroundColor Green
}

# Summary
Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Errors: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "Warnings: $warnings" -ForegroundColor $(if ($warnings -gt 0) { "Yellow" } else { "Green" })

if ($errors -gt 0) {
    Write-Host ""
    Write-Host "ERROR: Security verification failed" -ForegroundColor Red
    exit 1
} elseif ($warnings -gt 0) {
    Write-Host ""
    Write-Host "WARNING: Security verification passed with warnings" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host ""
    Write-Host "OK: Security verification passed" -ForegroundColor Green
    exit 0
}

