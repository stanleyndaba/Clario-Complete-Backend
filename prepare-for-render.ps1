# 🚀 Prepare for Render.com Deployment
# This script helps you prepare your project for Render deployment

Write-Host "🚀 Preparing Opside Backend for Render.com Deployment" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Yellow

# Check if we're in the right directory
if (-not (Test-Path "src/main.py")) {
    Write-Host "❌ Error: Please run this script from the root directory of your project" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Project structure verified" -ForegroundColor Green

# Create a simple deployment checklist
Write-Host "`n📋 Pre-Deployment Checklist:" -ForegroundColor Yellow
Write-Host "1. ✅ Project structure verified" -ForegroundColor Green
Write-Host "2. ⏳ Check if all required files exist..." -ForegroundColor Yellow

# Check for required files
$requiredFiles = @(
    "src/main.py",
    "requirements.txt",
    "Integrations-backend/package.json",
    "stripe-payments/package.json",
    "FBA Refund Predictor/cost-documentation-module/package.json",
    "FBA Refund Predictor/refund-engine/package.json",
    "FBA Refund Predictor/mcde/requirements.txt",
    "Claim Detector Model/claim_detector/requirements.txt",
    "evidence-engine/requirements.txt",
    "test-service/requirements.txt"
)

$missingFiles = @()
foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "   ✅ $file" -ForegroundColor Green
    } else {
        Write-Host "   ❌ $file" -ForegroundColor Red
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host "`n⚠️  Missing files detected. Please create them before deploying." -ForegroundColor Yellow
    Write-Host "Missing files:" -ForegroundColor Red
    foreach ($file in $missingFiles) {
        Write-Host "   - $file" -ForegroundColor Red
    }
} else {
    Write-Host "`n✅ All required files present!" -ForegroundColor Green
}

# Display deployment steps
Write-Host "`n🎯 Next Steps for Render Deployment:" -ForegroundColor Cyan
Write-Host "1. Go to https://render.com" -ForegroundColor White
Write-Host "2. Sign up with GitHub" -ForegroundColor White
Write-Host "3. Connect your repository" -ForegroundColor White
Write-Host "4. Deploy services in this order:" -ForegroundColor White
Write-Host "   a) Main API (Python)" -ForegroundColor Yellow
Write-Host "   b) Integrations Backend (Node.js)" -ForegroundColor Yellow
Write-Host "   c) Stripe Payments (Node.js)" -ForegroundColor Yellow
Write-Host "   d) Other services (optional)" -ForegroundColor Yellow

# Display environment variables needed
Write-Host "`n🔧 Environment Variables You'll Need:" -ForegroundColor Cyan
Write-Host "Required for all services:" -ForegroundColor Yellow
Write-Host "- DATABASE_URL (Supabase PostgreSQL)" -ForegroundColor White
Write-Host "- REDIS_URL (Upstash Redis)" -ForegroundColor White
Write-Host "- JWT_SECRET (generate a secure one)" -ForegroundColor White
Write-Host "- SUPABASE_URL: https://fmzfjhrwbkebqaxjlvzt.supabase.co" -ForegroundColor White
Write-Host "- SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..." -ForegroundColor White
Write-Host "- SUPABASE_SERVICE_ROLE_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..." -ForegroundColor White

Write-Host "`nFor Integrations Backend:" -ForegroundColor Yellow
Write-Host "- AMAZON_CLIENT_ID" -ForegroundColor White
Write-Host "- AMAZON_CLIENT_SECRET" -ForegroundColor White
Write-Host "- AMAZON_REDIRECT_URI: https://opside-integrations-backend.onrender.com/api/amazon/callback" -ForegroundColor White

Write-Host "`nFor Stripe Payments:" -ForegroundColor Yellow
Write-Host "- STRIPE_SECRET_KEY" -ForegroundColor White
Write-Host "- STRIPE_WEBHOOK_SECRET" -ForegroundColor White
Write-Host "- STRIPE_PUBLISHABLE_KEY" -ForegroundColor White

# Display service URLs
Write-Host "`n🔗 Your Services Will Be Available At:" -ForegroundColor Cyan
Write-Host "Main API: https://opside-main-api.onrender.com" -ForegroundColor White
Write-Host "Integrations: https://opside-integrations-backend.onrender.com" -ForegroundColor White
Write-Host "Stripe Payments: https://opside-stripe-payments.onrender.com" -ForegroundColor White
Write-Host "Cost Docs: https://opside-cost-docs.onrender.com" -ForegroundColor White
Write-Host "Refund Engine: https://opside-refund-engine.onrender.com" -ForegroundColor White
Write-Host "MCDE: https://opside-mcde.onrender.com" -ForegroundColor White
Write-Host "Claim Detector: https://opside-claim-detector.onrender.com" -ForegroundColor White
Write-Host "Evidence Engine: https://opside-evidence-engine.onrender.com" -ForegroundColor White
Write-Host "Smart Inventory: https://opside-smart-inventory-sync.onrender.com" -ForegroundColor White
Write-Host "Test Service: https://opside-test-service.onrender.com" -ForegroundColor White

# Health check commands
Write-Host "`n🏥 Health Check Commands:" -ForegroundColor Cyan
Write-Host "After deployment, test with:" -ForegroundColor Yellow
Write-Host "curl https://opside-main-api.onrender.com/health" -ForegroundColor White
Write-Host "curl https://opside-integrations-backend.onrender.com/health" -ForegroundColor White
Write-Host "curl https://opside-stripe-payments.onrender.com/health" -ForegroundColor White

Write-Host "`n🎉 Ready for Render deployment!" -ForegroundColor Green
Write-Host "Follow the RENDER_DEPLOYMENT_GUIDE.md for detailed steps." -ForegroundColor Yellow


