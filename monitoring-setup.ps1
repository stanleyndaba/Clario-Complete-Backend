# Opside Backend Monitoring Setup Script
# Run this script to set up monitoring and logging

Write-Host "📊 Setting up Opside Backend Monitoring" -ForegroundColor Green

# Check if Fly CLI is installed
if (!(Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Fly CLI not found. Please install it first." -ForegroundColor Red
    exit 1
}

$services = @(
    "opside-main-api",
    "opside-integrations-backend", 
    "opside-stripe-payments",
    "opside-cost-docs",
    "opside-refund-engine",
    "opside-mcde"
)

Write-Host "`n🔧 Setting up monitoring for all services..." -ForegroundColor Yellow

foreach ($service in $services) {
    Write-Host "`nSetting up monitoring for $service..." -ForegroundColor Cyan
    
    # Enable metrics
    fly metrics enable -a $service
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Metrics enabled for $service" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Metrics may already be enabled for $service" -ForegroundColor Yellow
    }
    
    # Set up log streaming
    Write-Host "Setting up log streaming for $service..." -ForegroundColor Gray
    Write-Host "To view logs: fly logs -a $service --follow" -ForegroundColor Gray
    
    # Check service status
    Write-Host "Checking status for $service..." -ForegroundColor Gray
    fly status -a $service
}

Write-Host "`n📋 Monitoring Commands:" -ForegroundColor Yellow
Write-Host "View logs: fly logs -a <app-name> --follow" -ForegroundColor White
Write-Host "Check status: fly status -a <app-name>" -ForegroundColor White
Write-Host "View metrics: fly dashboard -a <app-name>" -ForegroundColor White
Write-Host "SSH into service: fly ssh console -a <app-name>" -ForegroundColor White

Write-Host "`n🔧 Setting up health monitoring..." -ForegroundColor Yellow

# Create health monitoring script
$healthScript = @"
# Health monitoring script for Opside Backend
# Run this script every 5 minutes via cron

services=(
    "opside-main-api"
    "opside-integrations-backend"
    "opside-stripe-payments"
    "opside-cost-docs"
    "opside-refund-engine"
    "opside-mcde"
)

for service in "${services[@]}"; do
    echo "Checking $service..."
    if curl -f -s "https://$service.fly.dev/health" > /dev/null; then
        echo "✅ $service is healthy"
    else
        echo "❌ $service is unhealthy"
        # Send alert here (email, Slack, etc.)
    fi
done
"@

$healthScript | Out-File -FilePath "health-monitor.sh" -Encoding UTF8
Write-Host "✅ Health monitoring script created: health-monitor.sh" -ForegroundColor Green

Write-Host "`n📊 Monitoring Dashboard URLs:" -ForegroundColor Yellow
foreach ($service in $services) {
    Write-Host "https://fly.io/apps/$service" -ForegroundColor Cyan
}

Write-Host "`n🎉 Monitoring setup complete!" -ForegroundColor Green
Write-Host "`n⚠️  Recommended next steps:" -ForegroundColor Yellow
Write-Host "1. Set up log aggregation (e.g., Logtail, Datadog)" -ForegroundColor White
Write-Host "2. Configure alerting for critical errors" -ForegroundColor White
Write-Host "3. Set up uptime monitoring (e.g., UptimeRobot)" -ForegroundColor White
Write-Host "4. Configure log retention policies" -ForegroundColor White

