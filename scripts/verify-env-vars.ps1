# PowerShell script to verify environment variables are set
# Tests environment validation via healthz endpoint

param(
    [Parameter(Mandatory=$true)]
    [string]$ApiUrl,
    
    [switch]$Verbose = $false
)

Write-Host "🔍 Verifying Environment Variables" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "API URL: $ApiUrl" -ForegroundColor Gray
Write-Host ""

$errors = 0
$warnings = 0

# Test healthz endpoint
Write-Host "Testing /healthz endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$ApiUrl/healthz" -Method GET -UseBasicParsing -ErrorAction Stop
    $json = $response.Content | ConvertFrom-Json
    
    Write-Host "✅ Healthz endpoint accessible" -ForegroundColor Green
    Write-Host ""
    
    # Check environment validation
    if ($json.checks.environment) {
        Write-Host "Environment Check:" -ForegroundColor Yellow
        if ($json.checks.environment.status -eq "ok") {
            Write-Host "  ✅ Environment variables validated" -ForegroundColor Green
        } else {
            Write-Host "  ❌ Environment validation failed" -ForegroundColor Red
            Write-Host "     Error: $($json.checks.environment.error)" -ForegroundColor Red
            $errors++
        }
    }
    
    # Check database
    if ($json.checks.database) {
        Write-Host ""
        Write-Host "Database Check:" -ForegroundColor Yellow
        if ($json.checks.database.status -eq "ok") {
            Write-Host "  ✅ Database connection OK" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  Database connection issue: $($json.checks.database.error)" -ForegroundColor Yellow
            $warnings++
        }
    }
    
    # Check Amazon API
    if ($json.checks.amazonApi) {
        Write-Host ""
        Write-Host "Amazon API Check:" -ForegroundColor Yellow
        if ($json.checks.amazonApi.status -eq "ok") {
            Write-Host "  ✅ Amazon API credentials validated" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  Amazon API credentials issue: $($json.checks.amazonApi.error)" -ForegroundColor Yellow
            $warnings++
        }
    }
    
    # Overall status
    Write-Host ""
    Write-Host "Overall Status: $($json.status)" -ForegroundColor $(if ($json.status -eq "ok") { "Green" } else { "Yellow" })
    
    if ($Verbose) {
        Write-Host ""
        Write-Host "Full Response:" -ForegroundColor Gray
        $json | ConvertTo-Json -Depth 5 | Write-Host
    }
    
} catch {
    Write-Host "❌ Failed to verify environment: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "   Status Code: $statusCode" -ForegroundColor Red
        
        if ($statusCode -eq 503) {
            Write-Host ""
            Write-Host "⚠️  Service is degraded - check individual checks above" -ForegroundColor Yellow
        }
    }
    $errors++
}

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Errors: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "Warnings: $warnings" -ForegroundColor $(if ($warnings -gt 0) { "Yellow" } else { "Green" })

if ($errors -gt 0) {
    Write-Host ""
    Write-Host "❌ Environment verification failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Required environment variables:" -ForegroundColor Yellow
    Write-Host "  - AMAZON_CLIENT_ID" -ForegroundColor Gray
    Write-Host "  - AMAZON_CLIENT_SECRET" -ForegroundColor Gray
    Write-Host "  - AMAZON_SPAPI_REFRESH_TOKEN" -ForegroundColor Gray
    Write-Host "  - JWT_SECRET (minimum 32 characters)" -ForegroundColor Gray
    Write-Host "  - DATABASE_URL" -ForegroundColor Gray
    exit 1
} else {
    Write-Host ""
    Write-Host "✅ Environment verification passed" -ForegroundColor Green
    exit 0
}

