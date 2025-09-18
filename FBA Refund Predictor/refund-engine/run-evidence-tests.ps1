# Evidence & Value Engine Test Runner (PowerShell)
# This script runs the MVP tests for the Evidence Engine

Write-Host "🧪 Evidence & Value Engine MVP Test Runner" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Check if Jest is available
try {
    $null = Get-Command npx -ErrorAction Stop
} catch {
    Write-Host "❌ npx not found. Installing dependencies..." -ForegroundColor Red
    npm install
}

# Set test environment
$env:NODE_ENV = "test"

Write-Host "📋 Running Evidence Engine tests..." -ForegroundColor Yellow
Write-Host ""

# Run the evidence engine tests
try {
    npx jest tests/evidenceEngine.test.ts --verbose --detectOpenHandles
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ All Evidence Engine tests passed!" -ForegroundColor Green
        Write-Host ""
        Write-Host "🎯 Test Summary:" -ForegroundColor Cyan
        Write-Host "  - POST /api/v1/claims/flag: ✅ Working" -ForegroundColor Green
        Write-Host "  - GET /api/v1/proofs/:id: ✅ Working" -ForegroundColor Green
        Write-Host "  - Anomaly detection: ✅ Stubbed" -ForegroundColor Green
        Write-Host "  - Entity extraction: ✅ Stubbed" -ForegroundColor Green
        Write-Host "  - Proof bundles: ✅ Deterministic" -ForegroundColor Green
        Write-Host "  - Append-only: ✅ Enforced" -ForegroundColor Green
        Write-Host ""
        Write-Host "🚀 Evidence & Value Engine MVP is ready!" -ForegroundColor Green
    } else {
        throw "Tests failed with exit code $LASTEXITCODE"
    }
} catch {
    Write-Host ""
    Write-Host "❌ Some tests failed. Check the output above." -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Ensure all dependencies are installed: npm install" -ForegroundColor White
    Write-Host "  2. Check TypeScript compilation: npm run build" -ForegroundColor White
    Write-Host "  3. Verify Jest configuration: npx jest --showConfig" -ForegroundColor White
    Write-Host "  4. Run individual tests: npx jest tests/evidenceEngine.test.ts --verbose" -ForegroundColor White
    exit 1
}
