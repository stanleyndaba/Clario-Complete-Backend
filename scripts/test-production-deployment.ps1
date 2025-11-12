# PowerShell script to test production deployment
# Tests all 4 steps of production deployment

param(
    [string]$NodeApiUrl = "https://opside-node-api-woco.onrender.com",
    [string]$PythonApiUrl = "https://opside-python-api.onrender.com",
    [string]$DatabaseUrl = "",
    [switch]$SkipDatabase = $false,
    [switch]$Verbose = $false
)

Write-Host "🚀 Production Deployment Testing" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

$errors = 0
$warnings = 0
$passed = 0

# Step 1: Database Migration Check
Write-Host "Step 1: Database Migration Check" -ForegroundColor Yellow
Write-Host "---------------------------------" -ForegroundColor Yellow

if ($SkipDatabase) {
    Write-Host "  ⚠️  Skipping database check (use -SkipDatabase:$false to enable)" -ForegroundColor Yellow
    $warnings++
} elseif ($DatabaseUrl) {
    Write-Host "  Testing database connection..." -ForegroundColor Gray
    try {
        # This would require psql or a database client
        Write-Host "  ⚠️  Database check requires psql or database client" -ForegroundColor Yellow
        Write-Host "     Run manually: psql `"$DatabaseUrl`" -c `"\d audit_logs`"" -ForegroundColor Gray
        $warnings++
    } catch {
        Write-Host "  ❌ Database check failed: $($_.Exception.Message)" -ForegroundColor Red
        $errors++
    }
} else {
    Write-Host "  ⚠️  DATABASE_URL not provided (use -DatabaseUrl parameter)" -ForegroundColor Yellow
    Write-Host "     Skipping database check" -ForegroundColor Gray
    $warnings++
}

Write-Host ""

# Step 2: Environment Variables Check
Write-Host "Step 2: Environment Variables Check" -ForegroundColor Yellow
Write-Host "-------------------------------------" -ForegroundColor Yellow

Write-Host "  Testing environment validation via healthz endpoint..." -ForegroundColor Gray
try {
    $response = Invoke-WebRequest -Uri "$NodeApiUrl/healthz" -Method GET -UseBasicParsing -ErrorAction Stop
    $json = $response.Content | ConvertFrom-Json
    
    if ($json.checks.environment.status -eq "ok") {
        Write-Host "  ✅ Environment variables validated" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "  ⚠️  Environment validation issues: $($json.checks.environment.error)" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "  ❌ Failed to check environment: $($_.Exception.Message)" -ForegroundColor Red
    $errors++
}

Write-Host ""

# Step 3: Production Endpoints Test
Write-Host "Step 3: Production Endpoints Test" -ForegroundColor Yellow
Write-Host "---------------------------------" -ForegroundColor Yellow

# 3.1 Health Check
Write-Host "  3.1 Testing /health endpoint..." -ForegroundColor Gray
try {
    $response = Invoke-WebRequest -Uri "$NodeApiUrl/health" -Method GET -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "     ✅ /health returns 200" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "     ⚠️  /health returned $($response.StatusCode)" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "     ❌ /health failed: $($_.Exception.Message)" -ForegroundColor Red
    $errors++
}

# 3.2 Healthz Check
Write-Host "  3.2 Testing /healthz endpoint..." -ForegroundColor Gray
try {
    $response = Invoke-WebRequest -Uri "$NodeApiUrl/healthz" -Method GET -UseBasicParsing -ErrorAction Stop
    $json = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 503) {
        Write-Host "     ✅ /healthz returns $($response.StatusCode)" -ForegroundColor Green
        if ($json.checks) {
            Write-Host "        Database: $($json.checks.database.status)" -ForegroundColor Gray
            Write-Host "        Environment: $($json.checks.environment.status)" -ForegroundColor Gray
            if ($json.checks.amazonApi) {
                Write-Host "        Amazon API: $($json.checks.amazonApi.status)" -ForegroundColor Gray
            }
        }
        $passed++
    } else {
        Write-Host "     ⚠️  /healthz returned $($response.StatusCode)" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "     ❌ /healthz failed: $($_.Exception.Message)" -ForegroundColor Red
    $errors++
}

# 3.3 Security Headers
Write-Host "  3.3 Testing security headers..." -ForegroundColor Gray
try {
    $response = Invoke-WebRequest -Uri "$NodeApiUrl/health" -Method GET -UseBasicParsing -ErrorAction Stop
    $headers = $response.Headers
    
    $requiredHeaders = @(
        "X-Content-Type-Options",
        "X-Frame-Options",
        "X-XSS-Protection"
    )
    
    $missingHeaders = @()
    foreach ($header in $requiredHeaders) {
        if ($headers[$header]) {
            Write-Host "        ✅ $header present" -ForegroundColor Green
        } else {
            Write-Host "        ⚠️  $header missing" -ForegroundColor Yellow
            $missingHeaders += $header
        }
    }
    
    if ($missingHeaders.Count -eq 0) {
        $passed++
    } else {
        $warnings++
    }
} catch {
    Write-Host "     ❌ Security headers check failed: $($_.Exception.Message)" -ForegroundColor Red
    $errors++
}

# 3.4 Rate Limiting (quick test)
Write-Host "  3.4 Testing rate limiting..." -ForegroundColor Gray
Write-Host "        Making 5 rapid requests..." -ForegroundColor Gray
$rateLimitTest = 0
for ($i = 1; $i -le 5; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "$NodeApiUrl/health" -Method GET -UseBasicParsing -ErrorAction Stop
        $rateLimitTest++
        Start-Sleep -Milliseconds 100
    } catch {
        if ($_.Exception.Response.StatusCode -eq 429) {
            Write-Host "        ✅ Rate limiting working (429 received)" -ForegroundColor Green
            $passed++
            break
        }
    }
}
if ($rateLimitTest -eq 5) {
    Write-Host "        ⚠️  Rate limiting not triggered (may be expected for /health)" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# Step 4: Audit Logs Check
Write-Host "Step 4: Audit Logs Check" -ForegroundColor Yellow
Write-Host "------------------------" -ForegroundColor Yellow

if ($SkipDatabase -or -not $DatabaseUrl) {
    Write-Host "  ⚠️  Skipping audit logs check (requires database access)" -ForegroundColor Yellow
    Write-Host "     Run manually:" -ForegroundColor Gray
    Write-Host "     psql `"$DatabaseUrl`" -c `"SELECT COUNT(*) FROM audit_logs;`"" -ForegroundColor Gray
    $warnings++
} else {
    Write-Host "  ⚠️  Audit logs check requires database access" -ForegroundColor Yellow
    Write-Host "     Run manually with SQL queries from PRODUCTION_DEPLOYMENT_GUIDE.md" -ForegroundColor Gray
    $warnings++
}

Write-Host ""

# Summary
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Warnings: $warnings" -ForegroundColor $(if ($warnings -gt 0) { "Yellow" } else { "Green" })
Write-Host "Errors: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })

if ($errors -gt 0) {
    Write-Host ""
    Write-Host "❌ Production deployment test failed" -ForegroundColor Red
    exit 1
} elseif ($warnings -gt 0) {
    Write-Host ""
    Write-Host "⚠️  Production deployment test passed with warnings" -ForegroundColor Yellow
    Write-Host "   Review warnings and complete manual checks" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host ""
    Write-Host "✅ Production deployment test passed" -ForegroundColor Green
    exit 0
}

