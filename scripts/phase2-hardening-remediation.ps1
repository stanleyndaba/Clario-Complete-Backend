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

# 1. Check/Fix DATABASE_URL
Write-Host "[1/3] Checking DATABASE_URL..." -ForegroundColor Yellow
if ($env:DATABASE_URL) {
    Write-Host "  ✅ DATABASE_URL is set" -ForegroundColor Green
    $fixes.DatabaseUrl = $true
} else {
    Write-Host "  ❌ DATABASE_URL not set" -ForegroundColor Red
    if (-not $CheckOnly) {
        Write-Host "  📝 To fix:" -ForegroundColor Cyan
        Write-Host "     export DATABASE_URL='postgresql://user:pass@host:5432/db'" -ForegroundColor Gray
        Write-Host "     Or set in your hosting provider (Render/Vercel/etc.)" -ForegroundColor Gray
    }
}

# 2. Check/Fix Credentials in .env
Write-Host ""
Write-Host "[2/3] Checking for exposed credentials..." -ForegroundColor Yellow
$envFiles = @(".env", ".env.local")
$hasExposedSecrets = $false

foreach ($envFile in $envFiles) {
    if (Test-Path $envFile) {
        $content = Get-Content $envFile -Raw -ErrorAction SilentlyContinue
        if ($content) {
            # Check for actual secrets (simplified pattern)
            # Look for lines with password/secret/token that have values
            $lines = $content -split "`n"
            foreach ($line in $lines) {
                if ($line -match "^\s*(password|secret|token)\s*=\s*.+$" -and $line -notmatch "^\s*(password|secret|token)\s*=\s*$") {
                    $value = $line -replace ".*=\s*", ""
                    if ($value.Length -gt 8) {
                        Write-Host "  ⚠️  Potential secret found in $envFile" -ForegroundColor Yellow
                        $hasExposedSecrets = $true
                        break
                    }
                }
            }
        }
    }
}

# Check if .env is in .gitignore
$gitignorePath = ".gitignore"
if (Test-Path $gitignorePath) {
    $gitignoreContent = Get-Content $gitignorePath -Raw
    if ($gitignoreContent -match "\.env") {
        Write-Host "  ✅ .env is in .gitignore" -ForegroundColor Green
        if (-not $hasExposedSecrets) {
            $fixes.Credentials = $true
        }
    } else {
        Write-Host "  ⚠️  .env not in .gitignore - add it!" -ForegroundColor Yellow
        if (-not $CheckOnly) {
            if ($gitignoreContent -notmatch "\.env") {
                Add-Content -Path $gitignorePath -Value "`n# Environment files`n.env`n.env.local`n.env.production"
                Write-Host "  ✅ Added .env to .gitignore" -ForegroundColor Green
            }
        }
    }
} else {
    Write-Host "  ⚠️  .gitignore not found" -ForegroundColor Yellow
}

if (-not $hasExposedSecrets -and $fixes.Credentials) {
    Write-Host "  ✅ Credentials check passed" -ForegroundColor Green
}

# 3. Check/Fix Encryption Keys
Write-Host ""
Write-Host "[3/3] Checking encryption keys..." -ForegroundColor Yellow
$hasEncryptionKey = $env:ENCRYPTION_KEY -or $env:SECRET_STORE_KEY -or $env:APP_ENCRYPTION_KEY -or $env:JWT_SECRET

if ($hasEncryptionKey) {
    Write-Host "  ✅ Encryption key is set" -ForegroundColor Green
    $fixes.EncryptionKeys = $true
} else {
    Write-Host "  ❌ No encryption key found" -ForegroundColor Red
    if ($GenerateKeys) {
        # Generate encryption key
        Write-Host "  🔑 Generating encryption key..." -ForegroundColor Cyan
        try {
            $nodeScript = "const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('base64'));"
            $keyOutput = node -e $nodeScript 2>&1
            $key = $keyOutput | Where-Object { $_ -notmatch "error|Error" -and $_.Length -gt 20 } | Select-Object -First 1
            
            if ($key -and $key.Trim().Length -gt 20) {
                $key = $key.Trim()
                Write-Host "  ✅ Generated key: $key" -ForegroundColor Green
                Write-Host "  📝 Add to your environment:" -ForegroundColor Cyan
                Write-Host "     `$env:APP_ENCRYPTION_KEY = '$key'" -ForegroundColor Gray
                Write-Host "     Or set in your hosting provider" -ForegroundColor Gray
                $fixes.EncryptionKeys = $true
            } else {
                Write-Host "  ⚠️  Could not generate key (Node.js may not be available)" -ForegroundColor Yellow
                Write-Host "  📝 Generate manually:" -ForegroundColor Cyan
                Write-Host "     node -e `"console.log(require('crypto').randomBytes(32).toString('base64'))`"" -ForegroundColor Gray
            }
        } catch {
            Write-Host "  ⚠️  Could not generate key: $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  📝 To fix:" -ForegroundColor Cyan
        Write-Host "     Run with -GenerateKeys flag to generate a key" -ForegroundColor Gray
        Write-Host "     Or generate manually:" -ForegroundColor Gray
        Write-Host "     node -e `"console.log(require('crypto').randomBytes(32).toString('base64'))`"" -ForegroundColor Gray
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Remediation Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allFixed = ($fixes.DatabaseUrl -and $fixes.Credentials -and $fixes.EncryptionKeys)
$fixedCount = 0
if ($fixes.DatabaseUrl) { $fixedCount++ }
if ($fixes.Credentials) { $fixedCount++ }
if ($fixes.EncryptionKeys) { $fixedCount++ }

Write-Host "Status: $fixedCount/3 items fixed" -ForegroundColor $(if ($allFixed) { "Green" } else { "Yellow" })
Write-Host ""

if ($allFixed) {
    Write-Host "✅ All issues remediated!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Restart your application" -ForegroundColor White
    Write-Host "  2. Re-run hardening script:" -ForegroundColor White
    Write-Host '     powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening.ps1 -Verbose' -ForegroundColor Gray
} else {
    Write-Host 'Some issues remain. Review the recommendations above.' -ForegroundColor Yellow
    Write-Host ""
    Write-Host 'To generate encryption key, run:' -ForegroundColor Cyan
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening-remediation.ps1 -GenerateKeys' -ForegroundColor Gray
}

Write-Host ""
