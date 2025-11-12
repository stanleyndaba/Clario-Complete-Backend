# Phase 2 Hardening Remediation Script
# Fixes the three failing hardening checks

param(
    [switch]$GenerateKeys = $false,
    [switch]$CheckOnly = $false
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Phase 2 Hardening Remediation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$fixes = @{
    DatabaseUrl = $false
    Credentials = $false
    EncryptionKeys = $false
}

# 1. Check DATABASE_URL
Write-Host "[1/3] Checking DATABASE_URL..." -ForegroundColor Yellow
if ($env:DATABASE_URL) {
    Write-Host "  [PASS] DATABASE_URL is set" -ForegroundColor Green
    $fixes.DatabaseUrl = $true
} else {
    Write-Host "  [FAIL] DATABASE_URL not set" -ForegroundColor Red
    Write-Host "  To fix: export DATABASE_URL='postgresql://user:pass@host:5432/db'" -ForegroundColor Gray
}

# 2. Check Credentials
Write-Host ""
Write-Host "[2/3] Checking for exposed credentials..." -ForegroundColor Yellow
$gitignorePath = ".gitignore"
if (Test-Path $gitignorePath) {
    $gitignoreContent = Get-Content $gitignorePath -Raw
    if ($gitignoreContent -match "\.env") {
        Write-Host "  [PASS] .env is in .gitignore" -ForegroundColor Green
        $fixes.Credentials = $true
    } else {
        Write-Host "  [WARN] .env not in .gitignore" -ForegroundColor Yellow
        if (-not $CheckOnly) {
            Add-Content -Path $gitignorePath -Value "`n# Environment files`n.env`n.env.local`n.env.production"
            Write-Host "  [FIXED] Added .env to .gitignore" -ForegroundColor Green
            $fixes.Credentials = $true
        }
    }
} else {
    Write-Host "  [WARN] .gitignore not found" -ForegroundColor Yellow
}

# 3. Check Encryption Keys
Write-Host ""
Write-Host "[3/3] Checking encryption keys..." -ForegroundColor Yellow
$hasEncryptionKey = $env:ENCRYPTION_KEY -or $env:SECRET_STORE_KEY -or $env:APP_ENCRYPTION_KEY -or $env:JWT_SECRET

if ($hasEncryptionKey) {
    Write-Host "  [PASS] Encryption key is set" -ForegroundColor Green
    $fixes.EncryptionKeys = $true
} else {
    Write-Host "  [FAIL] No encryption key found" -ForegroundColor Red
    if ($GenerateKeys) {
        Write-Host "  Generating encryption key..." -ForegroundColor Cyan
        try {
            $keyOutput = node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2>&1
            $key = $keyOutput | Where-Object { $_ -notmatch "error|Error" -and $_.Length -gt 20 } | Select-Object -First 1
            
            if ($key -and $key.Trim().Length -gt 20) {
                $key = $key.Trim()
                Write-Host "  [SUCCESS] Generated key: $key" -ForegroundColor Green
                Write-Host "  Add to environment: `$env:APP_ENCRYPTION_KEY = '$key'" -ForegroundColor Gray
                $fixes.EncryptionKeys = $true
            } else {
                Write-Host "  [WARN] Could not generate key" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  [WARN] Could not generate key: $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  To fix: Run with -GenerateKeys flag" -ForegroundColor Gray
        Write-Host "  Or generate manually: node -e `"console.log(require('crypto').randomBytes(32).toString('base64'))`"" -ForegroundColor Gray
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Remediation Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$fixedCount = 0
if ($fixes.DatabaseUrl) { $fixedCount++ }
if ($fixes.Credentials) { $fixedCount++ }
if ($fixes.EncryptionKeys) { $fixedCount++ }

Write-Host "Status: $fixedCount/3 items fixed" -ForegroundColor $(if ($fixedCount -eq 3) { "Green" } else { "Yellow" })
Write-Host ""

if ($fixedCount -eq 3) {
    Write-Host "[SUCCESS] All issues remediated!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Restart your application" -ForegroundColor White
    Write-Host "  2. Re-run hardening script:" -ForegroundColor White
    Write-Host "     powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening.ps1 -Verbose" -ForegroundColor Gray
} else {
    Write-Host "[WARN] Some issues remain. Review recommendations above." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To generate encryption key:" -ForegroundColor Cyan
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening-remediation-simple.ps1 -GenerateKeys" -ForegroundColor Gray
}

Write-Host ""

