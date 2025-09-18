# Opside Backend Fly.io Deployment Script
# Run this script to deploy all services to Fly.io

param(
    [string]$Environment = "production",
    [switch]$SkipSecrets = $false,
    [switch]$SkipDatabase = $false
)

Write-Host "🚀 Starting Opside Backend Deployment to Fly.io" -ForegroundColor Green
Write-Host "Environment: $Environment" -ForegroundColor Yellow

# Check if Fly CLI is installed
if (!(Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Fly CLI not found. Installing..." -ForegroundColor Red
    iwr https://fly.io/install.ps1 -useb | iex
    Write-Host "✅ Fly CLI installed. Please restart your terminal and run this script again." -ForegroundColor Green
    exit 1
}

# Check if logged in to Fly.io
$flyAuth = fly auth whoami 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Not logged in to Fly.io. Please run: fly auth login" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Logged in as: $flyAuth" -ForegroundColor Green

# Create Fly.io apps
Write-Host "📱 Creating Fly.io apps..." -ForegroundColor Yellow

$apps = @(
    "opside-main-api",
    "opside-integrations-backend", 
    "opside-stripe-payments",
    "opside-cost-docs",
    "opside-refund-engine",
    "opside-mcde",
    "opside-claim-detector",
    "opside-evidence-engine",
    "opside-smart-inventory-sync",
    "opside-test-service"
)

foreach ($app in $apps) {
    Write-Host "Creating app: $app" -ForegroundColor Cyan
    fly apps create $app --no-deploy 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Created: $app" -ForegroundColor Green
    } else {
        Write-Host "ℹ️  App $app may already exist" -ForegroundColor Yellow
    }
}

# Deploy services
Write-Host "`n🚀 Deploying services..." -ForegroundColor Yellow

# Deploy main-api
Write-Host "Deploying main-api..." -ForegroundColor Cyan
fly deploy -a opside-main-api -c fly-main-api.toml
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ main-api deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ main-api deployment failed" -ForegroundColor Red
    exit 1
}

# Deploy integrations-backend
Write-Host "Deploying integrations-backend..." -ForegroundColor Cyan
Set-Location "Integrations-backend"
fly deploy -a opside-integrations-backend
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ integrations-backend deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ integrations-backend deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location ".."

# Deploy stripe-payments
Write-Host "Deploying stripe-payments..." -ForegroundColor Cyan
Set-Location "stripe-payments"
fly deploy -a opside-stripe-payments
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ stripe-payments deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ stripe-payments deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location ".."

# Deploy cost-documentation-module
Write-Host "Deploying cost-documentation-module..." -ForegroundColor Cyan
Set-Location "FBA Refund Predictor/cost-documentation-module"
fly deploy -a opside-cost-docs
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ cost-documentation-module deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ cost-documentation-module deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location "../.."

# Deploy refund-engine
Write-Host "Deploying refund-engine..." -ForegroundColor Cyan
Set-Location "FBA Refund Predictor/refund-engine"
fly deploy -a opside-refund-engine
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ refund-engine deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ refund-engine deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location "../.."

# Deploy mcde
Write-Host "Deploying mcde..." -ForegroundColor Cyan
Set-Location "FBA Refund Predictor/mcde"
fly deploy -a opside-mcde
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ mcde deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ mcde deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location "../.."

# Deploy claim-detector
Write-Host "Deploying claim-detector..." -ForegroundColor Cyan
Set-Location "Claim Detector Model/claim_detector"
fly deploy -a opside-claim-detector
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ claim-detector deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ claim-detector deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location "../.."

# Deploy evidence-engine
Write-Host "Deploying evidence-engine..." -ForegroundColor Cyan
Set-Location "evidence-engine"
fly deploy -a opside-evidence-engine
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ evidence-engine deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ evidence-engine deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location ".."

# Deploy smart-inventory-sync
Write-Host "Deploying smart-inventory-sync..." -ForegroundColor Cyan
Set-Location "Integrations-backend/opsided-backend/smart-inventory-sync"
fly deploy -a opside-smart-inventory-sync
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ smart-inventory-sync deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ smart-inventory-sync deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location "../../.."

# Deploy test-service
Write-Host "Deploying test-service..." -ForegroundColor Cyan
Set-Location "test-service"
fly deploy -a opside-test-service
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ test-service deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ test-service deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location ".."

Write-Host "`n🎉 All services deployed successfully!" -ForegroundColor Green
Write-Host "`n📋 Service URLs:" -ForegroundColor Yellow
Write-Host "Main API: https://opside-main-api.fly.dev" -ForegroundColor Cyan
Write-Host "Integrations: https://opside-integrations-backend.fly.dev" -ForegroundColor Cyan
Write-Host "Stripe Payments: https://opside-stripe-payments.fly.dev" -ForegroundColor Cyan
Write-Host "Cost Docs: https://opside-cost-docs.fly.dev" -ForegroundColor Cyan
Write-Host "Refund Engine: https://opside-refund-engine.fly.dev" -ForegroundColor Cyan
Write-Host "MCDE: https://opside-mcde.fly.dev" -ForegroundColor Cyan
Write-Host "Claim Detector: https://opside-claim-detector.fly.dev" -ForegroundColor Cyan
Write-Host "Evidence Engine: https://opside-evidence-engine.fly.dev" -ForegroundColor Cyan
Write-Host "Smart Inventory Sync: https://opside-smart-inventory-sync.fly.dev" -ForegroundColor Cyan
Write-Host "Test Service: https://opside-test-service.fly.dev" -ForegroundColor Cyan

Write-Host "`n⚠️  Next steps:" -ForegroundColor Yellow
Write-Host "1. Set up environment variables and secrets" -ForegroundColor White
Write-Host "2. Configure database connections" -ForegroundColor White
Write-Host "3. Set up private networking between services" -ForegroundColor White
Write-Host "4. Run database migrations" -ForegroundColor White
Write-Host "5. Test all service endpoints" -ForegroundColor White
