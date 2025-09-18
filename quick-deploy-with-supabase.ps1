# 🚀 Quick Deploy with Supabase
# One-click deployment using your Supabase credentials

param(
    [string]$RedisUrl = "redis://default:your-redis-password@your-redis-host:6379"
)

Write-Host "🚀 Quick Deploy with Supabase" -ForegroundColor Green
Write-Host "Using your Supabase credentials..." -ForegroundColor Yellow

# Your Supabase credentials
$SUPABASE_URL = "https://fmzfjhrwbkebqaxjlvzt.supabase.co"
$SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..."
$SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..."

# Construct DATABASE_URL from Supabase
$DATABASE_URL = "postgresql://postgres.fmzfjhrwbkebqaxjlvzt:$(Get-Random -Minimum 100000 -Maximum 999999)@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

# Generate JWT secret
$JWT_SECRET = "opside-jwt-secret-$(Get-Random -Minimum 100000 -Maximum 999999)"

Write-Host "🔐 Logging into Fly.io..." -ForegroundColor Yellow
fly auth login

Write-Host "📱 Creating Fly.io apps..." -ForegroundColor Yellow
$apps = @("opside-main-api", "opside-integrations-backend", "opside-stripe-payments")
foreach ($app in $apps) {
    try {
        fly apps create $app --org personal
        Write-Host "✅ $app created" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  $app exists, continuing..." -ForegroundColor Yellow
    }
}

Write-Host "🔑 Setting up secrets..." -ForegroundColor Yellow

# Main API secrets
fly secrets set -a opside-main-api `
    DATABASE_URL="$DATABASE_URL" `
    REDIS_URL="$RedisUrl" `
    JWT_SECRET="$JWT_SECRET" `
    SUPABASE_URL="$SUPABASE_URL" `
    SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" `
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" `
    INTEGRATIONS_URL="https://opside-integrations-backend.fly.dev" `
    STRIPE_SERVICE_URL="https://opside-stripe-payments.fly.dev" `
    FRONTEND_URL="https://your-frontend-domain.com" `
    ENV="production"

# Integrations Backend secrets
fly secrets set -a opside-integrations-backend `
    DATABASE_URL="$DATABASE_URL" `
    REDIS_URL="$RedisUrl" `
    JWT_SECRET="$JWT_SECRET" `
    SUPABASE_URL="$SUPABASE_URL" `
    SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" `
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" `
    AMAZON_CLIENT_ID="your-amazon-client-id" `
    AMAZON_CLIENT_SECRET="your-amazon-client-secret" `
    AMAZON_REDIRECT_URI="https://opside-integrations-backend.fly.dev/api/amazon/callback" `
    FRONTEND_URL="https://your-frontend-domain.com" `
    NODE_ENV="production"

# Stripe Payments secrets (will prompt for Stripe keys)
$StripeSecretKey = Read-Host "Enter your Stripe Secret Key (sk_live_... or sk_test_...)"
$StripeWebhookSecret = Read-Host "Enter your Stripe Webhook Secret (whsec_...)"

fly secrets set -a opside-stripe-payments `
    DATABASE_URL="$DATABASE_URL" `
    REDIS_URL="$RedisUrl" `
    JWT_SECRET="$JWT_SECRET" `
    SUPABASE_URL="$SUPABASE_URL" `
    SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" `
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" `
    STRIPE_SECRET_KEY="$StripeSecretKey" `
    STRIPE_WEBHOOK_SECRET="$StripeWebhookSecret" `
    STRIPE_PUBLISHABLE_KEY="pk_live_..." `
    NODE_ENV="production"

Write-Host "🚀 Deploying services..." -ForegroundColor Yellow

# Deploy main-api
Write-Host "Deploying main-api..." -ForegroundColor Cyan
fly deploy -a opside-main-api --config fly-main-api.toml

# Deploy integrations-backend
Write-Host "Deploying integrations-backend..." -ForegroundColor Cyan
Set-Location "Integrations-backend"
fly deploy -a opside-integrations-backend --config fly.toml
Set-Location ".."

# Deploy stripe-payments
Write-Host "Deploying stripe-payments..." -ForegroundColor Cyan
Set-Location "stripe-payments"
fly deploy -a opside-stripe-payments --config fly.toml
Set-Location ".."

Write-Host "🏥 Health checking..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# Health checks
$services = @(
    "https://opside-main-api.fly.dev/health",
    "https://opside-integrations-backend.fly.dev/health",
    "https://opside-stripe-payments.fly.dev/health"
)

foreach ($url in $services) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ $url - Healthy" -ForegroundColor Green
        } else {
            Write-Host "⚠️  $url - Status: $($response.StatusCode)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "❌ $url - Failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n🎉 Deployment complete!" -ForegroundColor Green
Write-Host "`n🔗 Your services:" -ForegroundColor Yellow
Write-Host "Main API: https://opside-main-api.fly.dev" -ForegroundColor White
Write-Host "Integrations: https://opside-integrations-backend.fly.dev" -ForegroundColor White
Write-Host "Stripe Payments: https://opside-stripe-payments.fly.dev" -ForegroundColor White

Write-Host "`n📋 Next steps:" -ForegroundColor Yellow
Write-Host "1. Test: curl https://opside-main-api.fly.dev/health" -ForegroundColor White
Write-Host "2. Check logs: fly logs -a opside-main-api --follow" -ForegroundColor White
Write-Host "3. Register Stripe webhook: https://opside-stripe-payments.fly.dev/webhooks/stripe" -ForegroundColor White


