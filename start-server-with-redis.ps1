# Start Server with Redis
# Sets REDIS_URL and starts the server

$env:REDIS_URL = "redis://localhost:6379"

Write-Host "🚀 Starting Server with Redis" -ForegroundColor Cyan
Write-Host "REDIS_URL: $env:REDIS_URL" -ForegroundColor Gray
Write-Host ""

cd Integrations-backend

Write-Host "Starting server..." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

npm start

