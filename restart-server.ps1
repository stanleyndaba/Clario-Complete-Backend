# Restart Node.js Server Script
# Stops the server if running and starts it fresh

$ErrorActionPreference = "Continue"

Write-Host "🔄 Restarting Node.js Server" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Find and kill existing server process
Write-Host "1️⃣  Stopping existing server..." -ForegroundColor Yellow
$process = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "" }
if ($process) {
    $pids = $process | ForEach-Object { $_.Id }
    Write-Host "   Found Node.js processes: $($pids -join ', ')" -ForegroundColor Gray
    foreach ($pid in $pids) {
        try {
            Stop-Process -Id $pid -Force -ErrorAction Stop
            Write-Host "   ✅ Stopped process $pid" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠️  Could not stop process $pid: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "   ℹ️  No running Node.js processes found" -ForegroundColor Gray
}

Write-Host ""
Write-Host "2️⃣  Waiting 2 seconds for cleanup..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "3️⃣  Starting server..." -ForegroundColor Yellow
Write-Host "   Navigate to Integrations-backend directory and run: npm start" -ForegroundColor Gray
Write-Host ""
Write-Host "   Or run this command:" -ForegroundColor Gray
Write-Host "   cd Integrations-backend && npm start" -ForegroundColor Cyan
Write-Host ""

# Optionally, check if we're in the right directory and auto-start
$currentDir = Get-Location
if ($currentDir.Path -like "*Integrations-backend*" -or (Test-Path "package.json")) {
    Write-Host "   💡 Auto-starting server in 3 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    npm start
} else {
    Write-Host "   📋 Manual start required:" -ForegroundColor Yellow
    Write-Host "      cd Integrations-backend" -ForegroundColor Cyan
    Write-Host "      npm start" -ForegroundColor Cyan
}


