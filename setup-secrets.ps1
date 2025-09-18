# Opside Backend Secrets Setup Script
# Run this script to configure all environment variables and secrets

param(
    [string]$SupabaseUrl = "",
    [string]$SupabaseAnonKey = "",
    [string]$SupabaseServiceKey = "",
    [string]$RedisUrl = "",
    [string]$JwtSecret = "",
    [string]$CryptoSecret = ""
)

Write-Host "🔐 Setting up Opside Backend Secrets on Fly.io" -ForegroundColor Green

# Check if Fly CLI is installed
if (!(Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Fly CLI not found. Please install it first." -ForegroundColor Red
    exit 1
}

# Check if logged in to Fly.io
$flyAuth = fly auth whoami 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Not logged in to Fly.io. Please run: fly auth login" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Logged in as: $flyAuth" -ForegroundColor Green

# Prompt for missing values
if ([string]::IsNullOrEmpty($SupabaseUrl)) {
    $SupabaseUrl = Read-Host "Enter your Supabase URL (https://your-project.supabase.co)"
}

if ([string]::IsNullOrEmpty($SupabaseAnonKey)) {
    $SupabaseAnonKey = Read-Host "Enter your Supabase Anon Key"
}

if ([string]::IsNullOrEmpty($SupabaseServiceKey)) {
    $SupabaseServiceKey = Read-Host "Enter your Supabase Service Role Key"
}

if ([string]::IsNullOrEmpty($RedisUrl)) {
    $RedisUrl = Read-Host "Enter your Upstash Redis URL (redis://default:password@host:port)"
}

if ([string]::IsNullOrEmpty($JwtSecret)) {
    $JwtSecret = Read-Host "Enter your JWT Secret (32+ characters)"
}

if ([string]::IsNullOrEmpty($CryptoSecret)) {
    $CryptoSecret = Read-Host "Enter your Crypto Secret (32 characters)"
}

# Generate additional secrets if not provided
$IntegrationsJwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$PaymentsJwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$CostDocJwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$RefundEngineJwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$EncryptionKey = [System.Web.Security.Membership]::GeneratePassword(32, 0)
$TokenEncryptionKey = [System.Web.Security.Membership]::GeneratePassword(32, 0)

Write-Host "`n🔧 Setting up secrets for main-api..." -ForegroundColor Yellow

# Main API secrets
fly secrets set -a opside-main-api `
  SUPABASE_URL="$SupabaseUrl" `
  SUPABASE_ANON_KEY="$SupabaseAnonKey" `
  SUPABASE_SERVICE_ROLE_KEY="$SupabaseServiceKey" `
  DB_URL="postgresql://postgres:password@db.$($SupabaseUrl.Replace('https://', '').Replace('.supabase.co', '')):5432/postgres" `
  REDIS_URL="$RedisUrl" `
  JWT_SECRET="$JwtSecret" `
  CRYPTO_SECRET="$CryptoSecret" `
  INTEGRATIONS_URL="https://opside-integrations-backend.fly.dev" `
  STRIPE_SERVICE_URL="https://opside-stripe-payments.fly.dev" `
  COST_DOC_SERVICE_URL="https://opside-cost-docs.fly.dev" `
  REFUND_ENGINE_URL="https://opside-refund-engine.fly.dev" `
  MCDE_URL="https://opside-mcde.fly.dev"

Write-Host "✅ main-api secrets configured" -ForegroundColor Green

Write-Host "`n🔧 Setting up secrets for integrations-backend..." -ForegroundColor Yellow

# Integrations Backend secrets
fly secrets set -a opside-integrations-backend `
  SUPABASE_URL="$SupabaseUrl" `
  SUPABASE_ANON_KEY="$SupabaseAnonKey" `
  SUPABASE_SERVICE_ROLE_KEY="$SupabaseServiceKey" `
  REDIS_URL="$RedisUrl" `
  JWT_SECRET="$IntegrationsJwtSecret" `
  ENCRYPTION_KEY="$EncryptionKey" `
  TOKEN_ENCRYPTION_KEY="$TokenEncryptionKey" `
  RATE_LIMIT_WINDOW_MS="900000" `
  RATE_LIMIT_MAX_REQUESTS="100"

Write-Host "✅ integrations-backend secrets configured" -ForegroundColor Green

Write-Host "`n🔧 Setting up secrets for stripe-payments..." -ForegroundColor Yellow

# Stripe Payments secrets
fly secrets set -a opside-stripe-payments `
  DATABASE_URL="postgresql://postgres:password@db.$($SupabaseUrl.Replace('https://', '').Replace('.supabase.co', '')):5432/postgres" `
  REDIS_URL="$RedisUrl" `
  JWT_SECRET="$PaymentsJwtSecret" `
  STRIPE_SECRET_KEY="sk_test_your_stripe_secret_key" `
  STRIPE_WEBHOOK_SECRET="whsec_your_webhook_secret" `
  STRIPE_CLIENT_ID="ca_your_stripe_client_id" `
  STRIPE_PLATFORM_ACCOUNT_ID="acct_your_platform_account_id" `
  STRIPE_API_VERSION="2023-10-16" `
  STRIPE_PRICE_ID="price_your_price_id" `
  STRIPE_LIVE_MODE="false"

Write-Host "✅ stripe-payments secrets configured" -ForegroundColor Green

Write-Host "`n🔧 Setting up secrets for cost-docs..." -ForegroundColor Yellow

# Cost Documentation secrets
fly secrets set -a opside-cost-docs `
  DATABASE_URL="postgresql://postgres:password@db.$($SupabaseUrl.Replace('https://', '').Replace('.supabase.co', '')):5432/postgres" `
  REDIS_URL="$RedisUrl" `
  JWT_SECRET="$CostDocJwtSecret" `
  MCDE_API_BASE_URL="https://opside-mcde.fly.dev"

Write-Host "✅ cost-docs secrets configured" -ForegroundColor Green

Write-Host "`n🔧 Setting up secrets for refund-engine..." -ForegroundColor Yellow

# Refund Engine secrets
fly secrets set -a opside-refund-engine `
  DATABASE_URL="postgresql://postgres:password@db.$($SupabaseUrl.Replace('https://', '').Replace('.supabase.co', '')):5432/postgres" `
  REDIS_URL="$RedisUrl" `
  JWT_SECRET="$RefundEngineJwtSecret" `
  ALLOWED_ORIGINS="https://your-frontend-domain.com,https://opside-main-api.fly.dev" `
  RATE_LIMIT_WINDOW_MS="900000" `
  RATE_LIMIT_MAX_REQUESTS="100" `
  ML_API_BASE_URL="https://opside-mcde.fly.dev"

Write-Host "✅ refund-engine secrets configured" -ForegroundColor Green

Write-Host "`n🔧 Setting up secrets for mcde..." -ForegroundColor Yellow

# MCDE secrets
fly secrets set -a opside-mcde `
  DATABASE_URL="postgresql://postgres:password@db.$($SupabaseUrl.Replace('https://', '').Replace('.supabase.co', '')):5432/postgres" `
  REDIS_URL="$RedisUrl"

Write-Host "✅ mcde secrets configured" -ForegroundColor Green

Write-Host "`n🎉 All secrets configured successfully!" -ForegroundColor Green
Write-Host "`n⚠️  Important: Update the following with your actual values:" -ForegroundColor Yellow
Write-Host "- Stripe API keys (in stripe-payments service)" -ForegroundColor White
Write-Host "- Amazon OAuth credentials (in main-api service)" -ForegroundColor White
Write-Host "- Gmail/Outlook OAuth credentials (in main-api service)" -ForegroundColor White
Write-Host "- AWS S3 credentials (in main-api service)" -ForegroundColor White

Write-Host "`n📋 To update additional secrets, use:" -ForegroundColor Cyan
Write-Host "fly secrets set -a <app-name> KEY=value" -ForegroundColor White

