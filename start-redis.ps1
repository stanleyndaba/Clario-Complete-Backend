# Start Redis Server Script
# Starts Redis server from the extracted folder

$redisPath = Join-Path $PSScriptRoot "redis\redis-server.exe"
$redisConfig = Join-Path $PSScriptRoot "redis\redis.windows.conf"

Write-Host "🚀 Starting Redis Server" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $redisPath)) {
    Write-Host "❌ Redis server not found at: $redisPath" -ForegroundColor Red
    Write-Host "   Please extract Redis-x64-3.0.504.zip first" -ForegroundColor Yellow
    exit 1
}

Write-Host "Redis Server Path: $redisPath" -ForegroundColor Gray
Write-Host "Redis Config: $redisConfig" -ForegroundColor Gray
Write-Host ""

# Check if Redis is already running
$redisProcess = Get-Process -Name "redis-server" -ErrorAction SilentlyContinue
if ($redisProcess) {
    Write-Host "⚠️  Redis server is already running (PID: $($redisProcess.Id))" -ForegroundColor Yellow
    Write-Host "   Skipping start..." -ForegroundColor Gray
} else {
    Write-Host "Starting Redis server..." -ForegroundColor Yellow
    
    # Start Redis server in background
    Start-Process -FilePath $redisPath -ArgumentList $redisConfig -WindowStyle Hidden
    
    # Wait a moment for server to start
    Start-Sleep -Seconds 2
    
    # Check if it started
    $redisProcess = Get-Process -Name "redis-server" -ErrorAction SilentlyContinue
    if ($redisProcess) {
        Write-Host "✅ Redis server started successfully (PID: $($redisProcess.Id))" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to start Redis server" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Testing Redis connection..." -ForegroundColor Yellow

# Test connection using redis-cli
$redisCli = Join-Path $PSScriptRoot "redis\redis-cli.exe"
if (Test-Path $redisCli) {
    $testResult = & $redisCli ping 2>&1
    if ($testResult -eq "PONG") {
        Write-Host "✅ Redis is responding (PONG)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Redis connection test: $testResult" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Redis is available at: redis://localhost:6379" -ForegroundColor Green
Write-Host ""
Write-Host "To use Redis, set environment variable:" -ForegroundColor Yellow
Write-Host '  $env:REDIS_URL="redis://localhost:6379"' -ForegroundColor Cyan
Write-Host ""
Write-Host "Or add to Integrations-backend/.env:" -ForegroundColor Yellow
Write-Host '  REDIS_URL=redis://localhost:6379' -ForegroundColor Cyan
Write-Host ""
Write-Host "Test connection:" -ForegroundColor Yellow
Write-Host "  node test-redis-connection.js" -ForegroundColor Cyan

