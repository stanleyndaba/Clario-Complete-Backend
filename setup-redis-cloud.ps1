# Quick Redis Cloud Setup
# This is the fastest way to get Redis running

Write-Host "☁️  Redis Cloud Setup (Free Tier)" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Steps:" -ForegroundColor Yellow
Write-Host "1. Go to: https://redis.com/try-free/" -ForegroundColor Gray
Write-Host "2. Click 'Get Started' and sign up (free)" -ForegroundColor Gray
Write-Host "3. Create a new database (free tier: 30MB)" -ForegroundColor Gray
Write-Host "4. Copy the connection URL (looks like: redis://default:password@host:port)" -ForegroundColor Gray
Write-Host ""
Write-Host "After you have the Redis URL, run:" -ForegroundColor Yellow
Write-Host '  $env:REDIS_URL="redis://your-url-here"' -ForegroundColor Cyan
Write-Host ""
Write-Host "Or add to Integrations-backend/.env file:" -ForegroundColor Yellow
Write-Host "  REDIS_URL=redis://your-url-here" -ForegroundColor Cyan
Write-Host ""
Write-Host "Then test the connection:" -ForegroundColor Yellow
Write-Host "  node test-redis-connection.js" -ForegroundColor Cyan
Write-Host ""
Write-Host "Opening Redis Cloud signup page..." -ForegroundColor Gray
Start-Process "https://redis.com/try-free/"

