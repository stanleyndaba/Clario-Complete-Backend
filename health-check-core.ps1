# Health Check for Core 3 Services
# main-api, integrations-backend, stripe-payments

Write-Host "🏥 Health Check for Core Services" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green

# Core services configuration
$coreServices = @(
    @{
        Name = "main-api"
        AppName = "opside-main-api"
        URL = "https://opside-main-api.fly.dev"
        Description = "Main orchestrator API"
    },
    @{
        Name = "integrations-backend"
        AppName = "opside-integrations-backend"
        URL = "https://opside-integrations-backend.fly.dev"
        Description = "OAuth/SP-API & data sync"
    },
    @{
        Name = "stripe-payments"
        AppName = "opside-stripe-payments"
        URL = "https://opside-stripe-payments.fly.dev"
        Description = "Financial flows"
    }
)

Write-Host "`n🔍 Checking Core Services Health..." -ForegroundColor Yellow
Write-Host "====================================" -ForegroundColor Yellow

$allHealthy = $true

foreach ($service in $coreServices) {
    Write-Host "`n📦 Checking $($service.Name)..." -ForegroundColor Cyan
    Write-Host "   URL: $($service.URL)/health" -ForegroundColor Gray
    Write-Host "   Description: $($service.Description)" -ForegroundColor Gray
    
    try {
        $response = Invoke-RestMethod -Uri "$($service.URL)/health" -Method GET -TimeoutSec 30
        Write-Host "   ✅ Status: $($response.status)" -ForegroundColor Green
        
        # Additional service-specific checks
        if ($service.Name -eq "main-api") {
            Write-Host "   🔗 Service Directory: Checking microservices..." -ForegroundColor Yellow
            try {
                $servicesStatus = Invoke-RestMethod -Uri "$($service.URL)/api/services/status" -Method GET -TimeoutSec 10
                Write-Host "   📊 Connected Services: $($servicesStatus.Keys -join ', ')" -ForegroundColor Cyan
            } catch {
                Write-Host "   ⚠️  Service directory check failed: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        
        if ($service.Name -eq "stripe-payments") {
            Write-Host "   💳 Stripe Status: Checking payment service..." -ForegroundColor Yellow
            if ($response.stripeLiveMode -ne $null) {
                $mode = if ($response.stripeLiveMode) { "LIVE" } else { "TEST" }
                Write-Host "   🎯 Stripe Mode: $mode" -ForegroundColor Cyan
            }
        }
        
    } catch {
        Write-Host "   ❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
        $allHealthy = $false
    }
}

# Test inter-service communication
Write-Host "`n🔗 Testing Inter-Service Communication..." -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Yellow

# Test main-api -> integrations-backend
Write-Host "`n1. Testing main-api -> integrations-backend..." -ForegroundColor Cyan
try {
    $integrationsUrl = "https://opside-integrations-backend.fly.dev"
    $response = Invoke-RestMethod -Uri "$integrationsUrl/health" -Method GET -TimeoutSec 10
    Write-Host "   ✅ Integrations backend reachable" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Integrations backend unreachable: $($_.Exception.Message)" -ForegroundColor Red
    $allHealthy = $false
}

# Test main-api -> stripe-payments
Write-Host "`n2. Testing main-api -> stripe-payments..." -ForegroundColor Cyan
try {
    $stripeUrl = "https://opside-stripe-payments.fly.dev"
    $response = Invoke-RestMethod -Uri "$stripeUrl/health" -Method GET -TimeoutSec 10
    Write-Host "   ✅ Stripe payments reachable" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Stripe payments unreachable: $($_.Exception.Message)" -ForegroundColor Red
    $allHealthy = $false
}

# Test integrations-backend -> stripe-payments
Write-Host "`n3. Testing integrations-backend -> stripe-payments..." -ForegroundColor Cyan
try {
    $stripeUrl = "https://opside-stripe-payments.fly.dev"
    $response = Invoke-RestMethod -Uri "$stripeUrl/health" -Method GET -TimeoutSec 10
    Write-Host "   ✅ Cross-service communication working" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Cross-service communication failed: $($_.Exception.Message)" -ForegroundColor Red
    $allHealthy = $false
}

# Summary
Write-Host "`n📊 Health Check Summary:" -ForegroundColor Green
Write-Host "========================" -ForegroundColor Green

if ($allHealthy) {
    Write-Host "✅ All core services are healthy!" -ForegroundColor Green
    Write-Host "🎯 Ready to deploy additional microservices" -ForegroundColor Green
} else {
    Write-Host "❌ Some services are unhealthy" -ForegroundColor Red
    Write-Host "🔧 Please check logs and fix issues before proceeding" -ForegroundColor Red
}

Write-Host "`n🔍 Service URLs:" -ForegroundColor Yellow
foreach ($service in $coreServices) {
    Write-Host "• $($service.Name): $($service.URL)" -ForegroundColor Cyan
}

Write-Host "`n📋 Next Steps:" -ForegroundColor Yellow
if ($allHealthy) {
    Write-Host "1. ✅ Core services are working" -ForegroundColor Green
    Write-Host "2. 🚀 Deploy remaining microservices" -ForegroundColor White
    Write-Host "3. 🔄 Test end-to-end workflows" -ForegroundColor White
    Write-Host "4. 📊 Set up monitoring and alerts" -ForegroundColor White
} else {
    Write-Host "1. ❌ Fix unhealthy services first" -ForegroundColor Red
    Write-Host "2. 🔍 Check logs: fly logs -a [app-name] --follow" -ForegroundColor White
    Write-Host "3. 🔧 Verify environment variables and secrets" -ForegroundColor White
    Write-Host "4. 🔄 Re-run health check after fixes" -ForegroundColor White
}

Write-Host "`n✅ Core services health check complete!" -ForegroundColor Green

