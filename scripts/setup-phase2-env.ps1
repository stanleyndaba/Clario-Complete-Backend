# Phase 2 Environment Setup Script
# Sets up DATABASE_URL and encryption keys for Phase 2

param(
    [string]$DatabaseUrl = "",
    [switch]$GenerateEncryptionKey = $true,
    [switch]$CreateEnvFile = $false
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Phase 2 Environment Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Generate Encryption Key
if ($GenerateEncryptionKey) {
    Write-Host "[1/2] Generating encryption key..." -ForegroundColor Yellow
    try {
        $keyOutput = node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2>&1
        $encryptionKey = $keyOutput | Where-Object { $_ -notmatch "error|Error" -and $_.Length -gt 20 } | Select-Object -First 1
        
        if ($encryptionKey -and $encryptionKey.Trim().Length -gt 20) {
            $encryptionKey = $encryptionKey.Trim()
            $env:APP_ENCRYPTION_KEY = $encryptionKey
            Write-Host "  [SUCCESS] Generated and set APP_ENCRYPTION_KEY" -ForegroundColor Green
            Write-Host "  Key: $encryptionKey" -ForegroundColor Gray
        } else {
            Write-Host "  [WARN] Could not generate key" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [WARN] Could not generate key: $_" -ForegroundColor Yellow
    }
}

# 2. Set DATABASE_URL
Write-Host ""
Write-Host "[2/2] Setting DATABASE_URL..." -ForegroundColor Yellow

if ($DatabaseUrl) {
    $env:DATABASE_URL = $DatabaseUrl
    Write-Host "  [SUCCESS] DATABASE_URL set from parameter" -ForegroundColor Green
} elseif ($env:DATABASE_URL) {
    Write-Host "  [SUCCESS] DATABASE_URL already set in environment" -ForegroundColor Green
    Write-Host "  Value: $($env:DATABASE_URL.Substring(0, [Math]::Min(50, $env:DATABASE_URL.Length)))..." -ForegroundColor Gray
} else {
    # Try to get from Supabase config
    $supabaseUrl = $env:SUPABASE_URL
    $supabaseKey = $env:SUPABASE_ANON_KEY
    $supabaseServiceKey = $env:SUPABASE_SERVICE_ROLE_KEY
    
    if ($supabaseUrl -and $supabaseServiceKey) {
        # Extract database connection from Supabase
        # Supabase connection string format: postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
        Write-Host "  [INFO] Found Supabase configuration" -ForegroundColor Cyan
        Write-Host "  [INFO] To get DATABASE_URL from Supabase:" -ForegroundColor Cyan
        Write-Host "    1. Go to Supabase Dashboard" -ForegroundColor Gray
        Write-Host "    2. Project Settings > Database" -ForegroundColor Gray
        Write-Host "    3. Copy 'Connection string' (URI format)" -ForegroundColor Gray
        Write-Host "    4. Run: `$env:DATABASE_URL = 'postgresql://...'" -ForegroundColor Gray
    } else {
        Write-Host "  [INFO] DATABASE_URL not set" -ForegroundColor Yellow
        Write-Host "  [INFO] To set DATABASE_URL:" -ForegroundColor Cyan
        Write-Host "    `$env:DATABASE_URL = 'postgresql://user:password@host:5432/database'" -ForegroundColor Gray
        Write-Host "    Or set in your hosting provider" -ForegroundColor Gray
    }
}

# 3. Create .env file if requested
if ($CreateEnvFile -and -not (Test-Path ".env")) {
    Write-Host ""
    Write-Host "[3/3] Creating .env file..." -ForegroundColor Yellow
    
    $envContent = @"
# Phase 2 Environment Variables
# DO NOT COMMIT THIS FILE - It's in .gitignore

# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Encryption
APP_ENCRYPTION_KEY=$encryptionKey

# Amazon SP-API (Sandbox)
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_SPAPI_CLIENT_ID=your_client_id_here
AMAZON_SPAPI_CLIENT_SECRET=your_client_secret_here
AMAZON_SPAPI_REFRESH_TOKEN=your_refresh_token_here

# Background Sync
ENABLE_BACKGROUND_SYNC=true
"@
    
    Set-Content -Path ".env" -Value $envContent
    Write-Host "  [SUCCESS] Created .env file with template" -ForegroundColor Green
    Write-Host "  [WARN] Update DATABASE_URL and Amazon credentials!" -ForegroundColor Yellow
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$status = @{
    EncryptionKey = [bool]$env:APP_ENCRYPTION_KEY
    DatabaseUrl = [bool]$env:DATABASE_URL
}

Write-Host "Encryption Key: $(if ($status.EncryptionKey) { '[SET]' } else { '[NOT SET]' })" -ForegroundColor $(if ($status.EncryptionKey) { "Green" } else { "Yellow" })
Write-Host "DATABASE_URL: $(if ($status.DatabaseUrl) { '[SET]' } else { '[NOT SET]' })" -ForegroundColor $(if ($status.DatabaseUrl) { "Green" } else { "Yellow" })
Write-Host ""

if ($status.EncryptionKey -and $status.DatabaseUrl) {
    Write-Host "[SUCCESS] All environment variables set!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Restart your application" -ForegroundColor White
    Write-Host "  2. Re-run hardening script:" -ForegroundColor White
    Write-Host "     powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening.ps1 -Verbose" -ForegroundColor Gray
} else {
    Write-Host "[INFO] Some variables still need to be set" -ForegroundColor Yellow
    Write-Host ""
    if (-not $status.DatabaseUrl) {
        Write-Host "To set DATABASE_URL:" -ForegroundColor Cyan
        Write-Host "  Get from Supabase Dashboard > Project Settings > Database" -ForegroundColor Gray
        Write-Host "  Or use: `$env:DATABASE_URL = 'postgresql://...'" -ForegroundColor Gray
    }
}

Write-Host ""

















