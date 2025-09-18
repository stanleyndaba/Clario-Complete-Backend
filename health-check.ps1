# Opside Backend Health Check Script
# Run this script to test all deployed services

param(
    [switch]$Detailed = $false,
    [switch]$Continuous = $false
)

Write-Host "🏥 Opside Backend Health Check" -ForegroundColor Green

$services = @(
    @{ Name = "Main API"; Url = "https://opside-main-api.fly.dev/health"; App = "opside-main-api" },
    @{ Name = "Integrations Backend"; Url = "https://opside-integrations-backend.fly.dev/health"; App = "opside-integrations-backend" },
    @{ Name = "Stripe Payments"; Url = "https://opside-stripe-payments.fly.dev/health"; App = "opside-stripe-payments" },
    @{ Name = "Cost Documentation"; Url = "https://opside-cost-docs.fly.dev/health"; App = "opside-cost-docs" },
    @{ Name = "Refund Engine"; Url = "https://opside-refund-engine.fly.dev/health"; App = "opside-refund-engine" },
    @{ Name = "MCDE"; Url = "https://opside-mcde.fly.dev/health"; App = "opside-mcde" },
    @{ Name = "Claim Detector"; Url = "https://opside-claim-detector.fly.dev/health"; App = "opside-claim-detector" },
    @{ Name = "Evidence Engine"; Url = "https://opside-evidence-engine.fly.dev/health"; App = "opside-evidence-engine" },
    @{ Name = "Smart Inventory Sync"; Url = "https://opside-smart-inventory-sync.fly.dev/health"; App = "opside-smart-inventory-sync" },
    @{ Name = "Test Service"; Url = "https://opside-test-service.fly.dev/health"; App = "opside-test-service" }
)

function Test-ServiceHealth {
    param(
        [string]$ServiceName,
        [string]$Url,
        [string]$App
    )
    
    try {
        $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 10
        $status = "✅ Healthy"
        $color = "Green"
        
        if ($Detailed) {
            Write-Host "`n$ServiceName ($App)" -ForegroundColor Cyan
            Write-Host "URL: $Url" -ForegroundColor Gray
            Write-Host "Status: $status" -ForegroundColor $color
            Write-Host "Response: $($response | ConvertTo-Json -Depth 2)" -ForegroundColor Gray
        } else {
            Write-Host "$ServiceName: $status" -ForegroundColor $color
        }
        
        return $true
    }
    catch {
        $status = "❌ Unhealthy"
        $color = "Red"
        
        if ($Detailed) {
            Write-Host "`n$ServiceName ($App)" -ForegroundColor Cyan
            Write-Host "URL: $Url" -ForegroundColor Gray
            Write-Host "Status: $status" -ForegroundColor $color
            Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        } else {
            Write-Host "$ServiceName: $status" -ForegroundColor $color
        }
        
        return $false
    }
}

function Get-ServiceLogs {
    param([string]$App)
    
    Write-Host "`n📋 Recent logs for $App:" -ForegroundColor Yellow
    fly logs -a $App --limit 10
}

do {
    Write-Host "`n🔍 Checking service health..." -ForegroundColor Yellow
    if ($Detailed) {
        Write-Host "Detailed mode enabled" -ForegroundColor Gray
    }
    
    $healthyCount = 0
    $totalCount = $services.Count
    
    foreach ($service in $services) {
        $isHealthy = Test-ServiceHealth -ServiceName $service.Name -Url $service.Url -App $service.App
        if ($isHealthy) {
            $healthyCount++
        }
    }
    
    Write-Host "`n📊 Health Summary:" -ForegroundColor Yellow
    Write-Host "Healthy: $healthyCount/$totalCount services" -ForegroundColor $(if ($healthyCount -eq $totalCount) { "Green" } else { "Yellow" })
    
    if ($healthyCount -lt $totalCount) {
        Write-Host "`n🔧 Troubleshooting:" -ForegroundColor Yellow
        Write-Host "1. Check service logs: fly logs -a <app-name>" -ForegroundColor White
        Write-Host "2. Check service status: fly status -a <app-name>" -ForegroundColor White
        Write-Host "3. Restart service: fly machine restart -a <app-name>" -ForegroundColor White
        Write-Host "4. Check secrets: fly secrets list -a <app-name>" -ForegroundColor White
    }
    
    if ($Continuous) {
        Write-Host "`n⏳ Waiting 30 seconds before next check..." -ForegroundColor Gray
        Start-Sleep -Seconds 30
    }
    
} while ($Continuous)

Write-Host "`n🏁 Health check complete!" -ForegroundColor Green
