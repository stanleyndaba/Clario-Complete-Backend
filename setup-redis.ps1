# Redis Setup Script for Windows
# Provides multiple options for setting up Redis

Write-Host "🔧 Redis Setup for Windows" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Choose an option:" -ForegroundColor Yellow
Write-Host "1. Use Redis Cloud (Free tier - Recommended)" -ForegroundColor Green
Write-Host "2. Install Redis via WSL (Ubuntu)" -ForegroundColor Green
Write-Host "3. Use Memurai (Redis for Windows)" -ForegroundColor Green
Write-Host "4. Use Docker (if available)" -ForegroundColor Green
Write-Host ""

$choice = Read-Host "Enter choice (1-4)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "📦 Option 1: Redis Cloud (Free)" -ForegroundColor Yellow
        Write-Host "1. Go to: https://redis.com/try-free/" -ForegroundColor Gray
        Write-Host "2. Sign up for free account" -ForegroundColor Gray
        Write-Host "3. Create a free database" -ForegroundColor Gray
        Write-Host "4. Copy the connection URL" -ForegroundColor Gray
        Write-Host "5. Set environment variable:" -ForegroundColor Gray
        Write-Host "   `$env:REDIS_URL='redis://your-redis-url'" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Or add to Integrations-backend/.env:" -ForegroundColor Gray
        Write-Host "REDIS_URL=redis://your-redis-url" -ForegroundColor Cyan
    }
    "2" {
        Write-Host ""
        Write-Host "📦 Option 2: Install Redis via WSL" -ForegroundColor Yellow
        Write-Host "Installing Ubuntu and Redis..." -ForegroundColor Gray
        
        # Install Ubuntu
        Write-Host "Installing Ubuntu distribution..." -ForegroundColor Gray
        wsl --install -d Ubuntu
        
        Write-Host ""
        Write-Host "After Ubuntu installs, run these commands in WSL:" -ForegroundColor Yellow
        Write-Host "  sudo apt-get update" -ForegroundColor Cyan
        Write-Host "  sudo apt-get install -y redis-server" -ForegroundColor Cyan
        Write-Host "  sudo service redis-server start" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Redis will be available at: redis://localhost:6379" -ForegroundColor Green
    }
    "3" {
        Write-Host ""
        Write-Host "📦 Option 3: Memurai (Redis for Windows)" -ForegroundColor Yellow
        Write-Host "1. Download from: https://www.memurai.com/get-memurai" -ForegroundColor Gray
        Write-Host "2. Install Memurai" -ForegroundColor Gray
        Write-Host "3. Start Memurai service" -ForegroundColor Gray
        Write-Host "4. Redis will be available at: redis://localhost:6379" -ForegroundColor Green
        Write-Host ""
        Write-Host "Opening download page..." -ForegroundColor Gray
        Start-Process "https://www.memurai.com/get-memurai"
    }
    "4" {
        Write-Host ""
        Write-Host "📦 Option 4: Docker" -ForegroundColor Yellow
        
        $dockerInstalled = Get-Command docker -ErrorAction SilentlyContinue
        if ($dockerInstalled) {
            Write-Host "Starting Redis container..." -ForegroundColor Gray
            docker run -d -p 6379:6379 --name redis redis:latest
            Write-Host "✅ Redis container started!" -ForegroundColor Green
            Write-Host "Redis available at: redis://localhost:6379" -ForegroundColor Green
        } else {
            Write-Host "❌ Docker not found. Install Docker Desktop first:" -ForegroundColor Red
            Write-Host "   https://www.docker.com/products/docker-desktop" -ForegroundColor Cyan
        }
    }
    default {
        Write-Host "Invalid choice" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=========================" -ForegroundColor Cyan
Write-Host "After setup, test Redis connection:" -ForegroundColor Yellow
Write-Host "  node test-redis-connection.js" -ForegroundColor Cyan

