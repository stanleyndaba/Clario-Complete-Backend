# Deploy Core 3 Services - Opside Backend
# Focus on: main-api, integrations-backend, stripe-payments

Write-Host "🚀 Deploying Core 3 Services to Fly.io" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green

# Core services array
$coreServices = @(
    @{
        Name = "main-api"
        AppName = "opside-main-api"
        Directory = "."
        Port = 8000
        Description = "Main orchestrator API (Python/FastAPI)"
    },
    @{
        Name = "integrations-backend"
        AppName = "opside-integrations-backend"
        Directory = "Integrations-backend"
        Port = 3001
        Description = "OAuth/SP-API & data sync (Node.js/Express)"
    },
    @{
        Name = "stripe-payments"
        AppName = "opside-stripe-payments"
        Directory = "stripe-payments"
        Port = 4000
        Description = "Financial flows (Node.js/Express)"
    }
)

Write-Host "`n📋 Core Services to Deploy:" -ForegroundColor Yellow
foreach ($service in $coreServices) {
    Write-Host "  • $($service.Name) - $($service.Description)" -ForegroundColor Cyan
}

Write-Host "`n🔧 Pre-deployment Checks:" -ForegroundColor Yellow

# Check if fly CLI is installed
try {
    $flyVersion = fly version 2>$null
    Write-Host "  ✅ Fly CLI installed: $flyVersion" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Fly CLI not found. Please install: https://fly.io/docs/hands-on/install-flyctl/" -ForegroundColor Red
    exit 1
}

# Check if logged in to Fly.io
try {
    $flyAuth = fly auth whoami 2>$null
    Write-Host "  ✅ Fly CLI authenticated: $flyAuth" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Not logged in to Fly.io. Run: fly auth login" -ForegroundColor Red
    exit 1
}

Write-Host "`n🚀 Starting Core Services Deployment:" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green

foreach ($service in $coreServices) {
    Write-Host "`n📦 Deploying $($service.Name)..." -ForegroundColor Yellow
    Write-Host "   App: $($service.AppName)" -ForegroundColor Cyan
    Write-Host "   Directory: $($service.Directory)" -ForegroundColor Cyan
    Write-Host "   Port: $($service.Port)" -ForegroundColor Cyan
    
    # Check if app exists
    try {
        $appExists = fly apps list | Select-String $service.AppName
        if ($appExists) {
            Write-Host "   ✅ App $($service.AppName) exists" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️  App $($service.AppName) not found. Creating..." -ForegroundColor Yellow
            Set-Location $service.Directory
            fly apps create $service.AppName --org personal
            Set-Location ..
        }
    } catch {
        Write-Host "   ❌ Error checking app status" -ForegroundColor Red
        continue
    }
    
    # Deploy the service
    try {
        Set-Location $service.Directory
        Write-Host "   🚀 Deploying to Fly.io..." -ForegroundColor Yellow
        
        # Deploy with verbose output
        fly deploy -a $service.AppName --verbose
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   ✅ $($service.Name) deployed successfully!" -ForegroundColor Green
            Write-Host "   🌐 URL: https://$($service.AppName).fly.dev" -ForegroundColor Cyan
        } else {
            Write-Host "   ❌ Deployment failed for $($service.Name)" -ForegroundColor Red
        }
        
        Set-Location ..
    } catch {
        Write-Host "   ❌ Error deploying $($service.Name): $($_.Exception.Message)" -ForegroundColor Red
        Set-Location ..
    }
}

Write-Host "`n🔍 Post-deployment Verification:" -ForegroundColor Yellow
Write-Host "===============================" -ForegroundColor Yellow

# Test health endpoints
foreach ($service in $coreServices) {
    Write-Host "`n🏥 Testing $($service.Name) health endpoint..." -ForegroundColor Yellow
    $healthUrl = "https://$($service.AppName).fly.dev/health"
    Write-Host "   URL: $healthUrl" -ForegroundColor Cyan
    
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -Method GET -TimeoutSec 30
        Write-Host "   ✅ Health check passed" -ForegroundColor Green
        Write-Host "   📊 Status: $($response.status)" -ForegroundColor Cyan
    } catch {
        Write-Host "   ❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n📋 Core Services Deployment Summary:" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

foreach ($service in $coreServices) {
    Write-Host "• $($service.Name): https://$($service.AppName).fly.dev" -ForegroundColor Cyan
}

Write-Host "`n🎯 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Verify Stripe secrets are set correctly" -ForegroundColor White
Write-Host "2. Test Stripe webhooks locally with Stripe CLI" -ForegroundColor White
Write-Host "3. Check service communication between the 3 core services" -ForegroundColor White
Write-Host "4. Monitor logs for any errors" -ForegroundColor White
Write-Host "5. Once stable, deploy remaining microservices" -ForegroundColor White

Write-Host "`n✅ Core services deployment complete!" -ForegroundColor Green

