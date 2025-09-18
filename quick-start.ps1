# Opside Backend Quick Start Script
# This script will deploy everything with minimal user input

Write-Host "🚀 Opside Backend Quick Start" -ForegroundColor Green
Write-Host "This script will deploy all services to Fly.io" -ForegroundColor Yellow

# Check prerequisites
Write-Host "`n🔍 Checking prerequisites..." -ForegroundColor Yellow

# Check Fly CLI
if (!(Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Fly CLI..." -ForegroundColor Cyan
    iwr https://fly.io/install.ps1 -useb | iex
    Write-Host "Please restart your terminal and run this script again." -ForegroundColor Red
    exit 1
}

# Check if logged in
$flyAuth = fly auth whoami 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Please log in to Fly.io first:" -ForegroundColor Red
    Write-Host "fly auth login" -ForegroundColor White
    exit 1
}

Write-Host "✅ Logged in as: $flyAuth" -ForegroundColor Green

# Get required information
Write-Host "`n📝 Please provide the following information:" -ForegroundColor Yellow

$supabaseUrl = Read-Host "Supabase URL (https://your-project.supabase.co)"
$supabaseAnonKey = Read-Host "Supabase Anon Key"
$supabaseServiceKey = Read-Host "Supabase Service Role Key"
$redisUrl = Read-Host "Upstash Redis URL (redis://default:password@host:port)"

# Generate secrets
$jwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$cryptoSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$integrationsJwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$paymentsJwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$costDocJwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$refundEngineJwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$encryptionKey = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$tokenEncryptionKey = [System.Web.Security.Membership]::GeneratePassword(32, 0)

$projectId = $supabaseUrl.Replace('https://', '').Replace('.supabase.co', '')
$databaseUrl = "postgresql://postgres:password@db.$projectId:5432/postgres"

Write-Host "`n🚀 Starting deployment..." -ForegroundColor Green

# Deploy all services
Write-Host "Deploying main-api..." -ForegroundColor Cyan
fly deploy -a opside-main-api -c fly-main-api.toml
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ main-api deployment failed" -ForegroundColor Red
    exit 1
}

Write-Host "Deploying integrations-backend..." -ForegroundColor Cyan
Set-Location "Integrations-backend"
fly deploy -a opside-integrations-backend
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ integrations-backend deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location ".."

Write-Host "Deploying stripe-payments..." -ForegroundColor Cyan
Set-Location "stripe-payments"
fly deploy -a opside-stripe-payments
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ stripe-payments deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location ".."

Write-Host "Deploying cost-documentation-module..." -ForegroundColor Cyan
Set-Location "FBA Refund Predictor/cost-documentation-module"
fly deploy -a opside-cost-docs
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ cost-documentation-module deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location "../.."

Write-Host "Deploying refund-engine..." -ForegroundColor Cyan
Set-Location "FBA Refund Predictor/refund-engine"
fly deploy -a opside-refund-engine
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ refund-engine deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location "../.."

Write-Host "Deploying mcde..." -ForegroundColor Cyan
Set-Location "FBA Refund Predictor/mcde"
fly deploy -a opside-mcde
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ mcde deployment failed" -ForegroundColor Red
    exit 1
}
Set-Location "../.."

Write-Host "`n🔐 Setting up secrets..." -ForegroundColor Yellow

# Set up secrets for all services
fly secrets set -a opside-main-api `
  SUPABASE_URL="$supabaseUrl" `
  SUPABASE_ANON_KEY="$supabaseAnonKey" `
  SUPABASE_SERVICE_ROLE_KEY="$supabaseServiceKey" `
  DB_URL="$databaseUrl" `
  REDIS_URL="$redisUrl" `
  JWT_SECRET="$jwtSecret" `
  CRYPTO_SECRET="$cryptoSecret" `
  INTEGRATIONS_URL="https://opside-integrations-backend.fly.dev" `
  STRIPE_SERVICE_URL="https://opside-stripe-payments.fly.dev" `
  COST_DOC_SERVICE_URL="https://opside-cost-docs.fly.dev" `
  REFUND_ENGINE_URL="https://opside-refund-engine.fly.dev" `
  MCDE_URL="https://opside-mcde.fly.dev"

fly secrets set -a opside-integrations-backend `
  SUPABASE_URL="$supabaseUrl" `
  SUPABASE_ANON_KEY="$supabaseAnonKey" `
  SUPABASE_SERVICE_ROLE_KEY="$supabaseServiceKey" `
  REDIS_URL="$redisUrl" `
  JWT_SECRET="$integrationsJwtSecret" `
  ENCRYPTION_KEY="$encryptionKey" `
  TOKEN_ENCRYPTION_KEY="$tokenEncryptionKey" `
  RATE_LIMIT_WINDOW_MS="900000" `
  RATE_LIMIT_MAX_REQUESTS="100"

fly secrets set -a opside-stripe-payments `
  DATABASE_URL="$databaseUrl" `
  REDIS_URL="$redisUrl" `
  JWT_SECRET="$paymentsJwtSecret" `
  STRIPE_SECRET_KEY="sk_test_your_stripe_secret_key" `
  STRIPE_WEBHOOK_SECRET="whsec_your_webhook_secret" `
  STRIPE_CLIENT_ID="ca_your_stripe_client_id" `
  STRIPE_PLATFORM_ACCOUNT_ID="acct_your_platform_account_id" `
  STRIPE_API_VERSION="2023-10-16" `
  STRIPE_PRICE_ID="price_your_price_id" `
  STRIPE_LIVE_MODE="false"

fly secrets set -a opside-cost-docs `
  DATABASE_URL="$databaseUrl" `
  REDIS_URL="$redisUrl" `
  JWT_SECRET="$costDocJwtSecret" `
  MCDE_API_BASE_URL="https://opside-mcde.fly.dev"

fly secrets set -a opside-refund-engine `
  DATABASE_URL="$databaseUrl" `
  REDIS_URL="$redisUrl" `
  JWT_SECRET="$refundEngineJwtSecret" `
  ALLOWED_ORIGINS="https://your-frontend-domain.com,https://opside-main-api.fly.dev" `
  RATE_LIMIT_WINDOW_MS="900000" `
  RATE_LIMIT_MAX_REQUESTS="100" `
  ML_API_BASE_URL="https://opside-mcde.fly.dev"

fly secrets set -a opside-mcde `
  DATABASE_URL="$databaseUrl" `
  REDIS_URL="$redisUrl"

Write-Host "`n🎉 Deployment complete!" -ForegroundColor Green
Write-Host "`n📋 Service URLs:" -ForegroundColor Yellow
Write-Host "Main API: https://opside-main-api.fly.dev" -ForegroundColor Cyan
Write-Host "Integrations: https://opside-integrations-backend.fly.dev" -ForegroundColor Cyan
Write-Host "Stripe Payments: https://opside-stripe-payments.fly.dev" -ForegroundColor Cyan
Write-Host "Cost Docs: https://opside-cost-docs.fly.dev" -ForegroundColor Cyan
Write-Host "Refund Engine: https://opside-refund-engine.fly.dev" -ForegroundColor Cyan
Write-Host "MCDE: https://opside-mcde.fly.dev" -ForegroundColor Cyan

Write-Host "`n⚠️  Next steps:" -ForegroundColor Yellow
Write-Host "1. Update Stripe API keys with your actual values" -ForegroundColor White
Write-Host "2. Configure OAuth credentials for Amazon, Gmail, etc." -ForegroundColor White
Write-Host "3. Run database migrations" -ForegroundColor White
Write-Host "4. Test all endpoints" -ForegroundColor White
Write-Host "5. Set up monitoring and alerting" -ForegroundColor White

Write-Host "`n🔧 Useful commands:" -ForegroundColor Yellow
Write-Host "Health check: .\health-check.ps1" -ForegroundColor White
Write-Host "View logs: fly logs -a <app-name>" -ForegroundColor White
Write-Host "Check status: fly status -a <app-name>" -ForegroundColor White

