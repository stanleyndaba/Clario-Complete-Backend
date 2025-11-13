# Fix Phase 2 Remaining Items
# Sets up DATABASE_URL and encryption keys

param(
    [string]$SupabaseUrl = $env:SUPABASE_URL,
    [string]$SupabaseServiceKey = $env:SUPABASE_SERVICE_ROLE_KEY,
    [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Fixing Phase 2 Remaining Items" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$fixed = @{
    EncryptionKey = $false
    DatabaseUrl = $false
    Credentials = $false
}

# 1. Generate and Set Encryption Key
Write-Host "[1/3] Setting up encryption key..." -ForegroundColor Yellow
if ($env:APP_ENCRYPTION_KEY -or $env:ENCRYPTION_KEY -or $env:JWT_SECRET) {
    Write-Host "  [PASS] Encryption key already set" -ForegroundColor Green
    $fixed.EncryptionKey = $true
} else {
    try {
        $keyOutput = node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2>&1
        $key = $keyOutput | Where-Object { $_ -notmatch "error|Error" -and $_.Length -gt 20 } | Select-Object -First 1
        
        if ($key -and $key.Trim().Length -gt 20) {
            $key = $key.Trim()
            $env:APP_ENCRYPTION_KEY = $key
            Write-Host "  [SUCCESS] Generated and set APP_ENCRYPTION_KEY" -ForegroundColor Green
            Write-Host "  Key: $key" -ForegroundColor Gray
            $fixed.EncryptionKey = $true
        } else {
            Write-Host "  [WARN] Could not generate key" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [WARN] Could not generate key: $_" -ForegroundColor Yellow
    }
}

# 2. Set DATABASE_URL
Write-Host ""
Write-Host "[2/3] Setting up DATABASE_URL..." -ForegroundColor Yellow

if ($DatabaseUrl) {
    $env:DATABASE_URL = $DatabaseUrl
    Write-Host "  [SUCCESS] DATABASE_URL set from parameter" -ForegroundColor Green
    $fixed.DatabaseUrl = $true
} elseif ($env:DATABASE_URL) {
    Write-Host "  [PASS] DATABASE_URL already set" -ForegroundColor Green
    $fixed.DatabaseUrl = $true
} elseif ($SupabaseUrl -and $SupabaseServiceKey) {
    # Try to construct from Supabase
    Write-Host "  [INFO] Found Supabase configuration" -ForegroundColor Cyan
    Write-Host "  [INFO] To get DATABASE_URL:" -ForegroundColor Cyan
    Write-Host "    1. Go to Supabase Dashboard" -ForegroundColor Gray
    Write-Host "    2. Project Settings > Database" -ForegroundColor Gray
    Write-Host "    3. Copy 'Connection string' (URI format)" -ForegroundColor Gray
    Write-Host "    4. It looks like: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres" -ForegroundColor Gray
} else {
    Write-Host "  [INFO] DATABASE_URL not set" -ForegroundColor Yellow
    Write-Host "  [INFO] Options:" -ForegroundColor Cyan
    Write-Host "    A. Set SUPABASE_URL and get DATABASE_URL from Supabase Dashboard" -ForegroundColor Gray
    Write-Host "    B. Set directly: `$env:DATABASE_URL = 'postgresql://...'" -ForegroundColor Gray
    Write-Host "    C. For development, you can skip this (optional)" -ForegroundColor Gray
}

# 3. Check Credentials
Write-Host ""
Write-Host "[3/3] Checking credentials security..." -ForegroundColor Yellow
$gitignorePath = ".gitignore"
if (Test-Path $gitignorePath) {
    $gitignoreContent = Get-Content $gitignorePath -Raw
    if ($gitignoreContent -match "\.env") {
        Write-Host "  [PASS] .env is in .gitignore" -ForegroundColor Green
        $fixed.Credentials = $true
    } else {
        Write-Host "  [WARN] .env not in .gitignore" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [WARN] .gitignore not found" -ForegroundColor Yellow
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Fix Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$fixedCount = 0
if ($fixed.EncryptionKey) { $fixedCount++ }
if ($fixed.DatabaseUrl) { $fixedCount++ }
if ($fixed.Credentials) { $fixedCount++ }

Write-Host "Status: $fixedCount/3 items fixed" -ForegroundColor $(if ($fixedCount -eq 3) { "Green" } else { "Yellow" })
Write-Host ""

if ($fixedCount -eq 3) {
    Write-Host "[SUCCESS] All items fixed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Environment variables set in this session:" -ForegroundColor Cyan
    if ($env:APP_ENCRYPTION_KEY) {
        Write-Host "  APP_ENCRYPTION_KEY = [SET]" -ForegroundColor Green
    }
    if ($env:DATABASE_URL) {
        Write-Host "  DATABASE_URL = [SET]" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "Note: These are set for this PowerShell session only." -ForegroundColor Yellow
    Write-Host "To make permanent:" -ForegroundColor Yellow
    Write-Host "  1. Add to .env file (if using)" -ForegroundColor Gray
    Write-Host "  2. Set in hosting provider (for production)" -ForegroundColor Gray
    Write-Host "  3. Add to system environment variables" -ForegroundColor Gray
} else {
    Write-Host "[INFO] Some items still need attention" -ForegroundColor Yellow
    Write-Host ""
    if (-not $fixed.DatabaseUrl) {
        Write-Host "DATABASE_URL:" -ForegroundColor Cyan
        Write-Host "  If using Supabase:" -ForegroundColor Gray
        Write-Host "    1. Go to https://supabase.com/dashboard" -ForegroundColor Gray
        Write-Host "    2. Select your project" -ForegroundColor Gray
        Write-Host "    3. Settings > Database" -ForegroundColor Gray
        Write-Host "    4. Copy 'Connection string' (URI)" -ForegroundColor Gray
        Write-Host "    5. Run: `$env:DATABASE_URL = 'postgresql://...'" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Re-run hardening to verify:" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening.ps1 -Verbose" -ForegroundColor Gray
Write-Host ""






