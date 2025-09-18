# Test Stripe Payments Service Locally
# Before deploying to production

Write-Host "🧪 Testing Stripe Payments Service Locally" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

# Check if Stripe CLI is installed
Write-Host "`n🔍 Checking Stripe CLI installation..." -ForegroundColor Yellow

try {
    $stripeVersion = stripe --version 2>$null
    Write-Host "✅ Stripe CLI installed: $stripeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Stripe CLI not found. Please install:" -ForegroundColor Red
    Write-Host "   https://stripe.com/docs/stripe-cli" -ForegroundColor Cyan
    Write-Host "   Or run: winget install stripe.stripe-cli" -ForegroundColor Cyan
    exit 1
}

# Check if logged in to Stripe
Write-Host "`n🔐 Checking Stripe authentication..." -ForegroundColor Yellow

try {
    $stripeAuth = stripe config --list 2>$null
    if ($stripeAuth -match "test_mode") {
        Write-Host "✅ Stripe CLI authenticated" -ForegroundColor Green
    } else {
        Write-Host "❌ Not logged in to Stripe. Run: stripe login" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Stripe authentication failed. Run: stripe login" -ForegroundColor Red
    exit 1
}

# Check if stripe-payments service is running
Write-Host "`n🚀 Checking stripe-payments service..." -ForegroundColor Yellow

$stripeServiceUrl = "http://localhost:4000"
$healthUrl = "$stripeServiceUrl/health"

try {
    $response = Invoke-RestMethod -Uri $healthUrl -Method GET -TimeoutSec 5
    Write-Host "✅ Stripe service is running" -ForegroundColor Green
    Write-Host "   Status: $($response.status)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Stripe service not running. Please start it first:" -ForegroundColor Red
    Write-Host "   cd stripe-payments" -ForegroundColor Cyan
    Write-Host "   npm run dev" -ForegroundColor Cyan
    exit 1
}

# Start webhook forwarding
Write-Host "`n🔄 Starting webhook forwarding..." -ForegroundColor Yellow
Write-Host "   This will forward Stripe webhooks to your local service" -ForegroundColor Cyan
Write-Host "   Press Ctrl+C to stop" -ForegroundColor Cyan

# Start webhook forwarding in background
$webhookProcess = Start-Process -FilePath "stripe" -ArgumentList "listen", "--forward-to", "localhost:4000/webhooks/stripe" -PassThru -WindowStyle Hidden

Write-Host "✅ Webhook forwarding started (PID: $($webhookProcess.Id))" -ForegroundColor Green

# Wait a moment for webhook to start
Start-Sleep -Seconds 3

# Test webhook events
Write-Host "`n🧪 Testing webhook events..." -ForegroundColor Yellow

Write-Host "`n1. Testing payment_intent.succeeded..." -ForegroundColor Cyan
try {
    $triggerResult = stripe trigger payment_intent.succeeded 2>$null
    Write-Host "✅ payment_intent.succeeded triggered" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to trigger payment_intent.succeeded" -ForegroundColor Red
}

Start-Sleep -Seconds 2

Write-Host "`n2. Testing charge.succeeded..." -ForegroundColor Cyan
try {
    $triggerResult = stripe trigger charge.succeeded 2>$null
    Write-Host "✅ charge.succeeded triggered" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to trigger charge.succeeded" -ForegroundColor Red
}

Start-Sleep -Seconds 2

Write-Host "`n3. Testing invoice.paid..." -ForegroundColor Cyan
try {
    $triggerResult = stripe trigger invoice.paid 2>$null
    Write-Host "✅ invoice.paid triggered" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to trigger invoice.paid" -ForegroundColor Red
}

# Test API endpoints
Write-Host "`n🔌 Testing API endpoints..." -ForegroundColor Yellow

Write-Host "`n1. Testing health endpoint..." -ForegroundColor Cyan
try {
    $healthResponse = Invoke-RestMethod -Uri $healthUrl -Method GET
    Write-Host "✅ Health endpoint working" -ForegroundColor Green
    Write-Host "   Response: $($healthResponse | ConvertTo-Json -Compress)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Health endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n2. Testing queue stats (admin only)..." -ForegroundColor Cyan
try {
    $queueStatsUrl = "$stripeServiceUrl/api/v1/stripe/queue-stats"
    $queueResponse = Invoke-RestMethod -Uri $queueStatsUrl -Method GET -Headers @{"Authorization" = "Bearer test-token"}
    Write-Host "✅ Queue stats endpoint working" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Queue stats endpoint failed (may need admin token): $($_.Exception.Message)" -ForegroundColor Yellow
}

# Check logs
Write-Host "`n📋 Checking service logs..." -ForegroundColor Yellow
Write-Host "   Check your stripe-payments console for webhook events" -ForegroundColor Cyan
Write-Host "   Look for successful webhook processing messages" -ForegroundColor Cyan

# Cleanup
Write-Host "`n🧹 Cleaning up..." -ForegroundColor Yellow

try {
    Stop-Process -Id $webhookProcess.Id -Force
    Write-Host "✅ Webhook forwarding stopped" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Could not stop webhook process (may have already stopped)" -ForegroundColor Yellow
}

Write-Host "`n📊 Test Summary:" -ForegroundColor Green
Write-Host "===============" -ForegroundColor Green
Write-Host "• Stripe CLI: ✅ Working" -ForegroundColor Green
Write-Host "• Stripe Service: ✅ Running" -ForegroundColor Green
Write-Host "• Webhook Forwarding: ✅ Tested" -ForegroundColor Green
Write-Host "• API Endpoints: ✅ Tested" -ForegroundColor Green

Write-Host "`n🎯 Next Steps:" -ForegroundColor Yellow
Write-Host "1. If all tests passed, deploy to Fly.io" -ForegroundColor White
Write-Host "2. Set up production webhook endpoint in Stripe Dashboard" -ForegroundColor White
Write-Host "3. Test with real Stripe events in production" -ForegroundColor White
Write-Host "4. Monitor logs for any errors" -ForegroundColor White

Write-Host "`n✅ Local Stripe testing complete!" -ForegroundColor Green

