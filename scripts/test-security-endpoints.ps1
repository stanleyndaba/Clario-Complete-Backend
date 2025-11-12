# PowerShell script to test security endpoints
# Tests health endpoints, security headers, and rate limiting

param(
    [string]$BaseUrl = "https://opside-node-api-woco.onrender.com",
    [switch]$Verbose = $false
)

Write-Host "🔒 Testing Security Endpoints" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host ""

$errors = 0
$warnings = 0

# 1. Test health endpoint
Write-Host "1. Testing /health endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "  ✅ Health endpoint returned 200" -ForegroundColor Green
        if ($Verbose) {
            Write-Host "     Response: $($response.Content)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ⚠️  Health endpoint returned $($response.StatusCode)" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "  ❌ Health endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
    $errors++
}

# 2. Test healthz endpoint
Write-Host ""
Write-Host "2. Testing /healthz endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/healthz" -Method GET -UseBasicParsing -ErrorAction Stop
    $json = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 503) {
        Write-Host "  ✅ Healthz endpoint returned $($response.StatusCode)" -ForegroundColor Green
        if ($json.checks) {
            Write-Host "     Database: $($json.checks.database.status)" -ForegroundColor Gray
            Write-Host "     Environment: $($json.checks.environment.status)" -ForegroundColor Gray
            if ($json.checks.amazonApi) {
                Write-Host "     Amazon API: $($json.checks.amazonApi.status)" -ForegroundColor Gray
            }
        }
        
        if ($json.status -eq "degraded") {
            Write-Host "  ⚠️  Service is degraded" -ForegroundColor Yellow
            $warnings++
        }
    } else {
        Write-Host "  ⚠️  Healthz endpoint returned $($response.StatusCode)" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "  ❌ Healthz endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
    $errors++
}

# 3. Test security headers
Write-Host ""
Write-Host "3. Testing security headers..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -UseBasicParsing -ErrorAction Stop
    $headers = $response.Headers
    
    $securityHeaders = @{
        "Strict-Transport-Security" = "HSTS"
        "X-Content-Type-Options" = "Content Type Options"
        "X-Frame-Options" = "Frame Options"
        "Content-Security-Policy" = "CSP"
        "Referrer-Policy" = "Referrer Policy"
    }
    
    $missingHeaders = @()
    foreach ($header in $securityHeaders.Keys) {
        if ($headers[$header]) {
            Write-Host "  ✅ $($securityHeaders[$header]) header present" -ForegroundColor Green
            if ($Verbose) {
                Write-Host "     Value: $($headers[$header])" -ForegroundColor Gray
            }
        } else {
            Write-Host "  ⚠️  $($securityHeaders[$header]) header missing" -ForegroundColor Yellow
            $missingHeaders += $header
            $warnings++
        }
    }
} catch {
    Write-Host "  ❌ Failed to check security headers: $($_.Exception.Message)" -ForegroundColor Red
    $errors++
}

# 4. Test rate limiting (make multiple rapid requests)
Write-Host ""
Write-Host "4. Testing rate limiting..." -ForegroundColor Yellow
Write-Host "  Making 10 rapid requests to /health endpoint..." -ForegroundColor Gray
$rateLimitTest = 0
$rateLimited = $false

for ($i = 1; $i -le 10; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -UseBasicParsing -ErrorAction Stop
        $rateLimitTest++
    } catch {
        if ($_.Exception.Response.StatusCode -eq 429) {
            Write-Host "  ✅ Rate limiting working (received 429 after $i requests)" -ForegroundColor Green
            $rateLimited = $true
            break
        }
    }
    Start-Sleep -Milliseconds 100
}

if (-not $rateLimited) {
    Write-Host "  ⚠️  Rate limiting not triggered (this may be expected for /health endpoint)" -ForegroundColor Yellow
    $warnings++
}

# 5. Test OAuth bypass (should be disabled in production)
Write-Host ""
Write-Host "5. Testing OAuth bypass protection..." -ForegroundColor Yellow
try {
    # Try to access a bypass endpoint (if it exists)
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/integrations/amazon/auth/start?bypass=true" -Method GET -UseBasicParsing -ErrorAction Stop
    Write-Host "  ⚠️  Bypass parameter accepted (check if this is expected in production)" -ForegroundColor Yellow
    $warnings++
} catch {
    if ($_.Exception.Response.StatusCode -eq 401 -or $_.Exception.Response.StatusCode -eq 403) {
        Write-Host "  ✅ OAuth bypass rejected (returned $($_.Exception.Response.StatusCode))" -ForegroundColor Green
    } elseif ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "  ✅ Bypass endpoint not found (404)" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Unexpected response: $($_.Exception.Response.StatusCode)" -ForegroundColor Yellow
        $warnings++
    }
}

# Summary
Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Security Endpoint Test Summary" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Errors: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "Warnings: $warnings" -ForegroundColor $(if ($warnings -gt 0) { "Yellow" } else { "Green" })

if ($errors -gt 0) {
    Write-Host ""
    Write-Host "❌ Security endpoint tests failed" -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "✅ Security endpoint tests passed" -ForegroundColor Green
    exit 0
}

