# Production Monitoring Setup Script
# This script helps you set up monitoring for Clario

Write-Host "🚀 Clario Production Monitoring Setup" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "Integrations-backend/package.json")) {
    Write-Host "❌ Error: Please run this script from the project root directory" -ForegroundColor Red
    exit 1
}

Write-Host "📦 Step 1: Installing dependencies..." -ForegroundColor Yellow

# Install Node.js dependencies
Write-Host "  Installing Node.js packages..." -ForegroundColor Gray
Set-Location Integrations-backend
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to install Node.js dependencies" -ForegroundColor Red
    exit 1
}
Set-Location ..

# Install Python dependencies
Write-Host "  Installing Python packages..." -ForegroundColor Gray
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Warning: Failed to install Python dependencies (may need virtualenv)" -ForegroundColor Yellow
}

Write-Host "✅ Dependencies installed" -ForegroundColor Green
Write-Host ""

# Check for Sentry DSN
Write-Host "🔍 Step 2: Checking Sentry configuration..." -ForegroundColor Yellow
$nodeSentry = $env:SENTRY_DSN
if (-not $nodeSentry) {
    Write-Host "⚠️  Warning: SENTRY_DSN not set in environment" -ForegroundColor Yellow
    Write-Host "   You'll need to set this in Render dashboard:" -ForegroundColor Gray
    Write-Host "   1. Go to your Node service in Render" -ForegroundColor Gray
    Write-Host "   2. Go to Environment tab" -ForegroundColor Gray
    Write-Host "   3. Add SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx" -ForegroundColor Gray
    Write-Host "   4. Get DSN from sentry.io dashboard" -ForegroundColor Gray
} else {
    Write-Host "✅ SENTRY_DSN is set" -ForegroundColor Green
}

Write-Host ""

# Check for health endpoints
Write-Host "🏥 Step 3: Health check endpoints..." -ForegroundColor Yellow
Write-Host "  Available endpoints:" -ForegroundColor Gray
Write-Host "    - GET /health (basic liveness)" -ForegroundColor Gray
Write-Host "    - GET /healthz (comprehensive check)" -ForegroundColor Gray
Write-Host "    - GET /health/detailed (full system check)" -ForegroundColor Gray
Write-Host "    - GET /metrics (Prometheus-style metrics)" -ForegroundColor Gray
Write-Host ""

# Prompt for service URLs
Write-Host "📝 Step 4: Service URLs for UptimeRobot setup..." -ForegroundColor Yellow
$nodeApiUrl = Read-Host "Enter your Node API URL (e.g., https://opside-node-api.onrender.com)"
$pythonApiUrl = Read-Host "Enter your Python API URL (e.g., https://python-api.onrender.com)"

Write-Host ""
Write-Host "📋 UptimeRobot Monitor Configuration:" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Monitor 1: Node API Health" -ForegroundColor Yellow
Write-Host "  Type: HTTP(s)" -ForegroundColor Gray
Write-Host "  URL: $nodeApiUrl/health" -ForegroundColor Gray
Write-Host "  Interval: 5 minutes" -ForegroundColor Gray
Write-Host ""
Write-Host "Monitor 2: Node API Detailed" -ForegroundColor Yellow
Write-Host "  Type: HTTP(s)" -ForegroundColor Gray
Write-Host "  URL: $nodeApiUrl/health/detailed" -ForegroundColor Gray
Write-Host "  Interval: 15 minutes" -ForegroundColor Gray
Write-Host ""
Write-Host "Monitor 3: Python API Health" -ForegroundColor Yellow
Write-Host "  Type: HTTP(s)" -ForegroundColor Gray
Write-Host "  URL: $pythonApiUrl/health" -ForegroundColor Gray
Write-Host "  Interval: 5 minutes" -ForegroundColor Gray
Write-Host ""
Write-Host "Monitor 4: Python API Detailed" -ForegroundColor Yellow
Write-Host "  Type: HTTP(s)" -ForegroundColor Gray
Write-Host "  URL: $pythonApiUrl/healthz" -ForegroundColor Gray
Write-Host "  Interval: 15 minutes" -ForegroundColor Gray
Write-Host ""

# Test health endpoints
Write-Host "🧪 Step 5: Testing health endpoints..." -ForegroundColor Yellow
try {
    $nodeHealth = Invoke-RestMethod -Uri "$nodeApiUrl/health" -Method GET -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ Node API health check: OK" -ForegroundColor Green
    Write-Host "   Status: $($nodeHealth.status)" -ForegroundColor Gray
} catch {
    Write-Host "⚠️  Node API health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

try {
    $pythonHealth = Invoke-RestMethod -Uri "$pythonApiUrl/health" -Method GET -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ Python API health check: OK" -ForegroundColor Green
    Write-Host "   Status: $($pythonHealth.status)" -ForegroundColor Gray
} catch {
    Write-Host "⚠️  Python API health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📚 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Set up Sentry account at https://sentry.io" -ForegroundColor Gray
Write-Host "2. Add SENTRY_DSN to Render environment variables" -ForegroundColor Gray
Write-Host "3. Set up UptimeRobot monitors (see URLs above)" -ForegroundColor Gray
Write-Host "4. Review PRODUCTION_MONITORING_SETUP.md for detailed instructions" -ForegroundColor Gray
Write-Host ""
Write-Host "📖 Full documentation: PRODUCTION_MONITORING_SETUP.md" -ForegroundColor Cyan

