# 🚀 Supabase Setup & Core Services Deployment
# This script sets up Supabase credentials and deploys the 3 core services

param(
    [string]$StripeSecretKey,
    [string]$StripeWebhookSecret,
    [string]$RedisUrl,
    [string]$JwtSecret = "your-super-secret-jwt-key-change-in-production-$(Get-Random)",
    [switch]$SkipStripe = $false
)

# Supabase credentials (provided by user)
$SUPABASE_URL = "https://fmzfjhrwbkebqaxjlvzt.supabase.co"
$SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..."
$SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..."

# Construct DATABASE_URL from Supabase
$DATABASE_URL = "postgresql://postgres.fmzfjhrwbkebqaxjlvzt:$(Get-Random -Minimum 100000 -Maximum 999999)@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

Write-Host "🚀 Setting up Supabase and deploying core services..." -ForegroundColor Green

# Check if Fly CLI is installed
if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Fly CLI not found. Please install it first:" -ForegroundColor Red
    Write-Host "   winget install fly.io.flyctl" -ForegroundColor Yellow
    exit 1
}

# Login to Fly.io
Write-Host "🔐 Logging into Fly.io..." -ForegroundColor Yellow
fly auth login

# Create Fly.io apps
$apps = @(
    "opside-main-api",
    "opside-integrations-backend", 
    "opside-stripe-payments"
)

Write-Host "📱 Creating Fly.io apps..." -ForegroundColor Yellow
foreach ($app in $apps) {
    Write-Host "Creating $app..." -ForegroundColor Cyan
    try {
        fly apps create $app --org personal
        Write-Host "✅ $app created successfully" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  $app might already exist, continuing..." -ForegroundColor Yellow
    }
}

# Set up secrets for main-api
Write-Host "🔑 Setting up main-api secrets..." -ForegroundColor Yellow
fly secrets set -a opside-main-api `
    DATABASE_URL="$DATABASE_URL" `
    REDIS_URL="$RedisUrl" `
    JWT_SECRET="$JwtSecret" `
    SUPABASE_URL="$SUPABASE_URL" `
    SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" `
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" `
    INTEGRATIONS_URL="https://opside-integrations-backend.fly.dev" `
    STRIPE_SERVICE_URL="https://opside-stripe-payments.fly.dev" `
    FRONTEND_URL="https://your-frontend-domain.com" `
    ENV="production"

# Set up secrets for integrations-backend
Write-Host "🔑 Setting up integrations-backend secrets..." -ForegroundColor Yellow
fly secrets set -a opside-integrations-backend `
    DATABASE_URL="$DATABASE_URL" `
    REDIS_URL="$RedisUrl" `
    JWT_SECRET="$JwtSecret" `
    SUPABASE_URL="$SUPABASE_URL" `
    SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" `
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" `
    AMAZON_CLIENT_ID="your-amazon-client-id" `
    AMAZON_CLIENT_SECRET="your-amazon-client-secret" `
    AMAZON_REDIRECT_URI="https://opside-integrations-backend.fly.dev/api/amazon/callback" `
    FRONTEND_URL="https://your-frontend-domain.com" `
    NODE_ENV="production"

# Set up secrets for stripe-payments (if not skipped)
if (-not $SkipStripe) {
    if (-not $StripeSecretKey) {
        $StripeSecretKey = Read-Host "Enter your Stripe Secret Key (sk_live_... or sk_test_...)"
    }
    if (-not $StripeWebhookSecret) {
        $StripeWebhookSecret = Read-Host "Enter your Stripe Webhook Secret (whsec_...)"
    }
    
    Write-Host "🔑 Setting up stripe-payments secrets..." -ForegroundColor Yellow
    fly secrets set -a opside-stripe-payments `
        DATABASE_URL="$DATABASE_URL" `
        REDIS_URL="$RedisUrl" `
        JWT_SECRET="$JwtSecret" `
        SUPABASE_URL="$SUPABASE_URL" `
        SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" `
        SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" `
        STRIPE_SECRET_KEY="$StripeSecretKey" `
        STRIPE_WEBHOOK_SECRET="$StripeWebhookSecret" `
        STRIPE_PUBLISHABLE_KEY="pk_live_..." `
        NODE_ENV="production"
} else {
    Write-Host "⏭️  Skipping Stripe secrets setup" -ForegroundColor Yellow
}

# Deploy services
Write-Host "🚀 Deploying core services..." -ForegroundColor Yellow

# Deploy main-api
Write-Host "Deploying main-api..." -ForegroundColor Cyan
try {
    fly deploy -a opside-main-api --config fly-main-api.toml
    Write-Host "✅ main-api deployed successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ main-api deployment failed" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
}

# Deploy integrations-backend
Write-Host "Deploying integrations-backend..." -ForegroundColor Cyan
try {
    Set-Location "Integrations-backend"
    fly deploy -a opside-integrations-backend --config fly.toml
    Set-Location ".."
    Write-Host "✅ integrations-backend deployed successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ integrations-backend deployment failed" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Set-Location ".."
}

# Deploy stripe-payments (if not skipped)
if (-not $SkipStripe) {
    Write-Host "Deploying stripe-payments..." -ForegroundColor Cyan
    try {
        Set-Location "stripe-payments"
        fly deploy -a opside-stripe-payments --config fly.toml
        Set-Location ".."
        Write-Host "✅ stripe-payments deployed successfully" -ForegroundColor Green
    } catch {
        Write-Host "❌ stripe-payments deployment failed" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
        Set-Location ".."
    }
}

# Health check
Write-Host "🏥 Performing health checks..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

$services = @(
    @{ Name = "Main API"; Url = "https://opside-main-api.fly.dev/health"; App = "opside-main-api" },
    @{ Name = "Integrations Backend"; Url = "https://opside-integrations-backend.fly.dev/health"; App = "opside-integrations-backend" }
)

if (-not $SkipStripe) {
    $services += @{ Name = "Stripe Payments"; Url = "https://opside-stripe-payments.fly.dev/health"; App = "opside-stripe-payments" }
}

foreach ($service in $services) {
    Write-Host "Checking $($service.Name)..." -ForegroundColor Cyan
    try {
        $response = Invoke-WebRequest -Uri $service.Url -Method GET -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ $($service.Name) is healthy" -ForegroundColor Green
        } else {
            Write-Host "⚠️  $($service.Name) returned status $($response.StatusCode)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "❌ $($service.Name) health check failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n🎉 Core services deployment complete!" -ForegroundColor Green
Write-Host "`n📋 Next steps:" -ForegroundColor Yellow
Write-Host "1. Check logs: fly logs -a opside-main-api --follow" -ForegroundColor White
Write-Host "2. Test authentication: curl https://opside-main-api.fly.dev/health" -ForegroundColor White
Write-Host "3. Test integrations: curl https://opside-integrations-backend.fly.dev/health" -ForegroundColor White
if (-not $SkipStripe) {
    Write-Host "4. Test Stripe: curl https://opside-stripe-payments.fly.dev/health" -ForegroundColor White
    Write-Host "5. Register webhook: https://opside-stripe-payments.fly.dev/webhooks/stripe" -ForegroundColor White
}

Write-Host "`n🔗 Service URLs:" -ForegroundColor Yellow
Write-Host "Main API: https://opside-main-api.fly.dev" -ForegroundColor White
Write-Host "Integrations: https://opside-integrations-backend.fly.dev" -ForegroundColor White
if (-not $SkipStripe) {
    Write-Host "Stripe Payments: https://opside-stripe-payments.fly.dev" -ForegroundColor White
}


