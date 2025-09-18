# Setup Stripe Secrets for Core Services
# Focus on stripe-payments service

Write-Host "🔐 Setting up Stripe Secrets for Core Services" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

# Check if fly CLI is available
try {
    $flyVersion = fly version 2>$null
    Write-Host "✅ Fly CLI available: $flyVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Fly CLI not found. Please install: https://fly.io/docs/hands-on/install-flyctl/" -ForegroundColor Red
    exit 1
}

Write-Host "`n📋 Required Stripe Secrets:" -ForegroundColor Yellow
Write-Host "=========================" -ForegroundColor Yellow
Write-Host "• STRIPE_SECRET_KEY (sk_live_... or sk_test_...)" -ForegroundColor Cyan
Write-Host "• STRIPE_WEBHOOK_SECRET (whsec_...)" -ForegroundColor Cyan
Write-Host "• DATABASE_URL (PostgreSQL connection string)" -ForegroundColor Cyan
Write-Host "• REDIS_URL (Redis connection string)" -ForegroundColor Cyan
Write-Host "• JWT_SECRET (32+ character random string)" -ForegroundColor Cyan

Write-Host "`n⚠️  IMPORTANT: Never hardcode keys in your code!" -ForegroundColor Red
Write-Host "   Use Fly.io secrets for production deployment" -ForegroundColor Red

# Get user input for secrets
Write-Host "`n🔑 Enter Stripe Configuration:" -ForegroundColor Yellow

$stripeSecretKey = Read-Host "Stripe Secret Key (sk_live_... or sk_test_...)"
$stripeWebhookSecret = Read-Host "Stripe Webhook Secret (whsec_...)"
$databaseUrl = Read-Host "Database URL (postgres://user:pass@host:port/db)"
$redisUrl = Read-Host "Redis URL (redis://host:port)"
$jwtSecret = Read-Host "JWT Secret (32+ characters)"

# Validate inputs
if (-not $stripeSecretKey -or -not $stripeSecretKey.StartsWith("sk_")) {
    Write-Host "❌ Invalid Stripe Secret Key. Must start with 'sk_'" -ForegroundColor Red
    exit 1
}

if (-not $stripeWebhookSecret -or -not $stripeWebhookSecret.StartsWith("whsec_")) {
    Write-Host "❌ Invalid Stripe Webhook Secret. Must start with 'whsec_'" -ForegroundColor Red
    exit 1
}

if (-not $databaseUrl -or -not $databaseUrl.StartsWith("postgres://")) {
    Write-Host "❌ Invalid Database URL. Must start with 'postgres://'" -ForegroundColor Red
    exit 1
}

if (-not $redisUrl -or -not $redisUrl.StartsWith("redis://")) {
    Write-Host "❌ Invalid Redis URL. Must start with 'redis://'" -ForegroundColor Red
    exit 1
}

if (-not $jwtSecret -or $jwtSecret.Length -lt 32) {
    Write-Host "❌ JWT Secret must be at least 32 characters" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Input validation passed!" -ForegroundColor Green

# Set secrets for stripe-payments service
Write-Host "`n🔐 Setting secrets for stripe-payments service..." -ForegroundColor Yellow

try {
    # Set Stripe secrets
    fly secrets set -a opside-stripe-payments STRIPE_SECRET_KEY="$stripeSecretKey"
    fly secrets set -a opside-stripe-payments STRIPE_WEBHOOK_SECRET="$stripeWebhookSecret"
    fly secrets set -a opside-stripe-payments DATABASE_URL="$databaseUrl"
    fly secrets set -a opside-stripe-payments REDIS_URL="$redisUrl"
    fly secrets set -a opside-stripe-payments JWT_SECRET="$jwtSecret"
    
    # Set additional required secrets
    fly secrets set -a opside-stripe-payments NODE_ENV="production"
    fly secrets set -a opside-stripe-payments PORT="4000"
    
    Write-Host "✅ Stripe secrets set successfully!" -ForegroundColor Green
} catch {
    Write-Host "❌ Error setting secrets: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Verify secrets are set
Write-Host "`n🔍 Verifying secrets..." -ForegroundColor Yellow

try {
    $secrets = fly secrets list -a opside-stripe-payments
    Write-Host "✅ Secrets verification:" -ForegroundColor Green
    Write-Host $secrets -ForegroundColor Cyan
} catch {
    Write-Host "❌ Error verifying secrets: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎯 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Test Stripe service locally with Stripe CLI" -ForegroundColor White
Write-Host "2. Deploy stripe-payments service" -ForegroundColor White
Write-Host "3. Verify webhook endpoint is accessible" -ForegroundColor White
Write-Host "4. Test payment flow end-to-end" -ForegroundColor White

Write-Host "`n📚 Stripe CLI Testing Commands:" -ForegroundColor Cyan
Write-Host "stripe listen --forward-to localhost:4000/webhooks/stripe" -ForegroundColor White
Write-Host "stripe trigger payment_intent.succeeded" -ForegroundColor White

Write-Host "`n✅ Stripe secrets setup complete!" -ForegroundColor Green

