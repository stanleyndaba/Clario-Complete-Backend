# Quick script to run Phase 3 E2E test with service role key
# Usage: .\run-phase3-test.ps1

param(
    [string]$UserId = "5757d34a-5988-4f06-9922-af47a46ebcac",
    [string]$BaseUrl = "http://localhost:3001"
)

Write-Host "`n🚀 Phase 3 E2E Test - Quick Runner" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan

# Load service role key from .env
$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) {
    Write-Host "❌ .env file not found at: $envPath" -ForegroundColor Red
    exit 1
}

$envContent = Get-Content $envPath -Raw
if ($envContent -match "SUPABASE_SERVICE_ROLE_KEY=(.+)") {
    $serviceRoleKey = $matches[1].Trim()
    Write-Host "`n✅ Loaded service role key from .env" -ForegroundColor Green
    Write-Host "   User ID: $UserId" -ForegroundColor Gray
    Write-Host "`n🧪 Running E2E test..." -ForegroundColor Yellow
    Write-Host ""
    
    # Run the test
    & "$PSScriptRoot\test-phase3-production-e2e.ps1" -BaseUrl $BaseUrl -UserId $UserId -AuthToken $serviceRoleKey
} else {
    Write-Host "❌ SUPABASE_SERVICE_ROLE_KEY not found in .env" -ForegroundColor Red
    Write-Host "   Make sure Integrations-backend/.env has SUPABASE_SERVICE_ROLE_KEY set" -ForegroundColor Yellow
    exit 1
}

