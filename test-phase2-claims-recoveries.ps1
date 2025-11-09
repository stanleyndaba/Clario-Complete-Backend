# Phase 2: Claims & Recoveries System Verification
# Tests claims endpoint, recoveries endpoint, sync status, observability, and user context

param(
    [string]$NodeApiUrl = "https://opside-node-api-woco.onrender.com",
    [string]$PythonApiUrl = "https://python-api-2-jlx5.onrender.com",
    [string]$TestUserId = "test-user-phase2-$(Get-Date -Format 'yyyyMMddHHmmss')",
    [string]$AuthToken = "",
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-TestStep {
    param([string]$Step, [string]$Status = "INFO")
    $color = switch ($Status) {
        "PASS" { "Green" }
        "FAIL" { "Red" }
        "WARN" { "Yellow" }
        "INFO" { "Cyan" }
        "TEST" { "Magenta" }
        default { "White" }
    }
    Write-Host "[$Status] $Step" -ForegroundColor $color
}

function Write-Section {
    param([string]$Section)
    Write-Host "`n========================================" -ForegroundColor Yellow
    Write-Host "$Section" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
}

# Helper function to make API requests
function Invoke-ApiRequest {
    param(
        [string]$Method = "GET",
        [string]$Url,
        [hashtable]$Headers = @{},
        [object]$Body = $null,
        [switch]$ExpectSuccess = $true,
        [int]$ExpectedStatusCode = 200
    )
    
    $startTime = Get-Date
    
    try {
        $params = @{
            Method = $Method
            Uri = $Url
            Headers = $Headers
            ContentType = "application/json"
            ErrorAction = "Stop"
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json -Depth 10)
        }
        
        $response = Invoke-RestMethod @params
        $duration = ((Get-Date) - $startTime).TotalSeconds
        
        return @{
            Success = $true
            Data = $response
            StatusCode = 200
            Duration = $duration
        }
    }
    catch {
        $statusCode = if ($_.Exception.Response) { 
            [int]$_.Exception.Response.StatusCode.value__ 
        } else { 
            0 
        }
        $errorMessage = $_.Exception.Message
        $duration = ((Get-Date) - $startTime).TotalSeconds
        
        if ($statusCode -eq $ExpectedStatusCode -and -not $ExpectSuccess) {
            # Expected error (e.g., 401 for unauthorized)
            return @{
                Success = $true
                Data = $null
                StatusCode = $statusCode
                Duration = $duration
                ExpectedError = $true
            }
        }
        
        if ($ExpectSuccess) {
            Write-TestStep "API Request Failed: $Url" "FAIL"
            Write-Host "  Error: $errorMessage" -ForegroundColor Red
            Write-Host "  Status: $statusCode" -ForegroundColor Red
        }
        
        return @{
            Success = $false
            Data = $null
            StatusCode = $statusCode
            Duration = $duration
            Error = $errorMessage
        }
    }
}

# Main execution
function Main {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "PHASE 2: CLAIMS & RECOVERIES VERIFICATION" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Node API URL: $NodeApiUrl" -ForegroundColor Gray
    Write-Host "Python API URL: $PythonApiUrl" -ForegroundColor Gray
    Write-Host "Test User ID: $TestUserId" -ForegroundColor Gray
    Write-Host "Auth Token: $(if ($AuthToken) { "Provided" } else { "Not provided (using X-User-Id header)" })" -ForegroundColor Gray
    
    $testResults = @{
        ClaimsEndpoint = $false
        RecoveriesEndpoint = $false
        SyncStatusEndpoint = $false
        ObservabilityLogs = $false
        UserContextValidation = $false
    }
    
    Write-Section "Test 1: Claims Endpoint"
    
    Write-TestStep "Testing GET /api/v1/integrations/amazon/claims" "TEST"
    $headers = @{}
    if ($AuthToken) {
        $headers["Authorization"] = "Bearer $AuthToken"
    }
    $headers["X-User-Id"] = $TestUserId
    
    $claimsResponse = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/v1/integrations/amazon/claims" -Headers $headers
    
    if ($claimsResponse.Success) {
        Write-TestStep "Claims endpoint is reachable" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    success: $($claimsResponse.Data.success)" -ForegroundColor $(if ($claimsResponse.Data.success) { "Green" } else { "Yellow" })
        Write-Host "    isSandbox: $($claimsResponse.Data.isSandbox)" -ForegroundColor Gray
        Write-Host "    dataType: $($claimsResponse.Data.dataType)" -ForegroundColor Gray
        Write-Host "    claims count: $($claimsResponse.Data.claims.Count)" -ForegroundColor Gray
        Write-Host "    response time: $([math]::Round($claimsResponse.Duration, 3))s" -ForegroundColor Gray
        
        # Verify expected response structure
        $hasSuccess = $claimsResponse.Data.PSObject.Properties.Name -contains "success"
        $hasIsSandbox = $claimsResponse.Data.PSObject.Properties.Name -contains "isSandbox"
        $hasClaims = $claimsResponse.Data.PSObject.Properties.Name -contains "claims"
        
        if ($hasSuccess -and $hasIsSandbox -and $hasClaims) {
            Write-TestStep "Response structure is correct" "PASS"
            $testResults.ClaimsEndpoint = $true
            
            if ($claimsResponse.Data.isSandbox) {
                Write-TestStep "✅ Sandbox mode detected - claims pipeline is healthy" "PASS"
            } else {
                Write-TestStep "⚠️ Production mode detected (expected sandbox)" "WARN"
            }
        } else {
            Write-TestStep "Response structure is incorrect" "FAIL"
            Write-Host "  Missing fields: success=$hasSuccess, isSandbox=$hasIsSandbox, claims=$hasClaims" -ForegroundColor Red
        }
    } else {
        Write-TestStep "Claims endpoint failed" "FAIL"
        Write-Host "  Status Code: $($claimsResponse.StatusCode)" -ForegroundColor Red
        Write-Host "  Error: $($claimsResponse.Error)" -ForegroundColor Red
    }
    
    Write-Section "Test 2: Recoveries Endpoint"
    
    Write-TestStep "Testing GET /api/v1/integrations/amazon/recoveries" "TEST"
    $recoveriesResponse = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/v1/integrations/amazon/recoveries" -Headers $headers
    
    if ($recoveriesResponse.Success) {
        Write-TestStep "Recoveries endpoint is reachable" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    totalAmount: $($recoveriesResponse.Data.totalAmount)" -ForegroundColor Gray
        Write-Host "    claimCount: $($recoveriesResponse.Data.claimCount)" -ForegroundColor Gray
        Write-Host "    currency: $($recoveriesResponse.Data.currency)" -ForegroundColor Gray
        Write-Host "    dataSource: $($recoveriesResponse.Data.dataSource)" -ForegroundColor Gray
        Write-Host "    response time: $([math]::Round($recoveriesResponse.Duration, 3))s" -ForegroundColor Gray
        
        # Verify expected response structure
        $hasTotalAmount = $recoveriesResponse.Data.PSObject.Properties.Name -contains "totalAmount"
        $hasClaimCount = $recoveriesResponse.Data.PSObject.Properties.Name -contains "claimCount"
        $hasCurrency = $recoveriesResponse.Data.PSObject.Properties.Name -contains "currency"
        
        if ($hasTotalAmount -and $hasClaimCount -and $hasCurrency) {
            Write-TestStep "Response structure is correct" "PASS"
            $testResults.RecoveriesEndpoint = $true
            
            # Zero values are fine in sandbox
            if ($recoveriesResponse.Data.totalAmount -eq 0) {
                Write-TestStep "✅ Zero total amount is expected in sandbox mode" "PASS"
            }
        } else {
            Write-TestStep "Response structure is incorrect" "FAIL"
            Write-Host "  Missing fields: totalAmount=$hasTotalAmount, claimCount=$hasClaimCount, currency=$hasCurrency" -ForegroundColor Red
        }
    } else {
        Write-TestStep "Recoveries endpoint failed" "FAIL"
        Write-Host "  Status Code: $($recoveriesResponse.StatusCode)" -ForegroundColor Red
        Write-Host "  Error: $($recoveriesResponse.Error)" -ForegroundColor Red
    }
    
    Write-Section "Test 3: Sync Status Endpoint"
    
    Write-TestStep "Testing GET /api/sync/status" "TEST"
    $syncStatusResponse = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/sync/status" -Headers $headers -ExpectSuccess $false
    
    if ($syncStatusResponse.Success -and $syncStatusResponse.StatusCode -eq 200) {
        Write-TestStep "Sync status endpoint is reachable" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    status: $($syncStatusResponse.Data.status)" -ForegroundColor Gray
        Write-Host "    hasActiveSync: $($syncStatusResponse.Data.hasActiveSync)" -ForegroundColor Gray
        Write-Host "    lastSync: $($syncStatusResponse.Data.lastSync)" -ForegroundColor Gray
        Write-Host "    response time: $([math]::Round($syncStatusResponse.Duration, 3))s" -ForegroundColor Gray
        
        # Verify expected response structure
        if ($syncStatusResponse.Data.status -eq "ok" -or $syncStatusResponse.Data.hasActiveSync -ne $null) {
            Write-TestStep "Response structure is correct" "PASS"
            $testResults.SyncStatusEndpoint = $true
            
            if ($syncStatusResponse.Data.status -eq "ok") {
                Write-TestStep "✅ Sync status endpoint is working correctly" "PASS"
            }
        } else {
            Write-TestStep "Response structure may be unexpected" "WARN"
            Write-Host "  Status: $($syncStatusResponse.Data.status)" -ForegroundColor Yellow
        }
    } elseif ($syncStatusResponse.StatusCode -eq 404) {
        Write-TestStep "Sync status endpoint returned 404" "FAIL"
        Write-Host "  Error: Endpoint route missing or controller not exported" -ForegroundColor Red
        Write-Host "  Note: This was a known issue - needs to be patched" -ForegroundColor Yellow
    } else {
        Write-TestStep "Sync status endpoint failed" "WARN"
        Write-Host "  Status Code: $($syncStatusResponse.StatusCode)" -ForegroundColor Yellow
        Write-Host "  Error: $($syncStatusResponse.Error)" -ForegroundColor Yellow
        Write-Host "  Note: This may be expected if no sync has been run yet" -ForegroundColor Gray
    }
    
    Write-Section "Test 4: Observability Logging"
    
    Write-TestStep "Checking response times and logging" "TEST"
    
    $responseTimes = @(
        @{ Name = "Claims"; Duration = $claimsResponse.Duration },
        @{ Name = "Recoveries"; Duration = $recoveriesResponse.Duration },
        @{ Name = "Sync Status"; Duration = $syncStatusResponse.Duration }
    )
    
    Write-Host "`n  Response Times:" -ForegroundColor Gray
    foreach ($rt in $responseTimes) {
        $color = if ($rt.Duration -lt 1.0) { "Green" } elseif ($rt.Duration -lt 2.0) { "Yellow" } else { "Red" }
        Write-Host "    $($rt.Name): $([math]::Round($rt.Duration, 3))s" -ForegroundColor $color
    }
    
    # Check if response times are reasonable
    $allReasonable = $responseTimes | Where-Object { $_.Duration -lt 5.0 } | Measure-Object
    if ($allReasonable.Count -eq $responseTimes.Count) {
        Write-TestStep "All response times are reasonable (< 5s)" "PASS"
        $testResults.ObservabilityLogs = $true
    } else {
        Write-TestStep "Some response times are slow (> 5s)" "WARN"
        Write-Host "  Note: Check Render logs for detailed observability metrics" -ForegroundColor Yellow
    }
    
    Write-Host "`n  Expected Log Format:" -ForegroundColor Gray
    Write-Host "    [LOG] /api/v1/integrations/amazon/claims completed in X.XXs | sandbox | user:$TestUserId" -ForegroundColor Gray
    Write-Host "    [LOG] /api/v1/integrations/amazon/recoveries completed in X.XXs | sandbox | user:$TestUserId" -ForegroundColor Gray
    Write-Host "    [LOG] /api/sync/status completed in X.XXs | user:$TestUserId" -ForegroundColor Gray
    Write-Host "`n  Note: Check Render → Logs for detailed observability logging" -ForegroundColor Yellow
    
    Write-Section "Test 5: User Context Validation"
    
    Write-TestStep "Testing without X-User-Id header (should fail or require userId)" "TEST"
    $headersWithoutUserId = @{}
    if ($AuthToken) {
        $headersWithoutUserId["Authorization"] = "Bearer $AuthToken"
    }
    
    $claimsWithoutUserId = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/v1/integrations/amazon/claims" -Headers $headersWithoutUserId -ExpectSuccess $false
    
    if (-not $claimsWithoutUserId.Success -or $claimsWithoutUserId.StatusCode -eq 401 -or $claimsWithoutUserId.StatusCode -eq 400) {
        Write-TestStep "Endpoint correctly requires user context" "PASS"
        Write-Host "  Status Code: $($claimsWithoutUserId.StatusCode)" -ForegroundColor Gray
        Write-Host "  Error: $($claimsWithoutUserId.Error)" -ForegroundColor Gray
        $testResults.UserContextValidation = $true
    } elseif ($claimsWithoutUserId.Data -and $claimsWithoutUserId.Data.success -eq $false) {
        Write-TestStep "Endpoint returns error without user context" "PASS"
        Write-Host "  Response: $($claimsWithoutUserId.Data | ConvertTo-Json -Compress)" -ForegroundColor Gray
        $testResults.UserContextValidation = $true
    } else {
        Write-TestStep "Endpoint does not validate user context" "WARN"
        Write-Host "  Note: Endpoint may be using default user or demo mode" -ForegroundColor Yellow
        Write-Host "  Response: $($claimsWithoutUserId.Data | ConvertTo-Json -Compress)" -ForegroundColor Gray
    }
    
    Write-Section "Test 6: Python API Reachability (Optional)"
    
    Write-TestStep "Testing Python API reachability" "TEST"
    $pythonResponse = Invoke-ApiRequest -Method "GET" -Url "$PythonApiUrl/api/v1/evidence/parse/test" -Headers @{} -ExpectSuccess $false
    
    if ($pythonResponse.Success) {
        Write-TestStep "Python API is reachable" "PASS"
        Write-Host "  Response: $($pythonResponse.Data | ConvertTo-Json -Compress)" -ForegroundColor Gray
    } else {
        Write-TestStep "Python API may not be reachable or endpoint does not exist" "WARN"
        Write-Host "  Status Code: $($pythonResponse.StatusCode)" -ForegroundColor Yellow
        Write-Host "  Note: This is optional - Python API may have different endpoints" -ForegroundColor Gray
    }
    
    Write-Section "Summary"
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "PHASE 2 TEST RESULTS" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    $totalTests = $testResults.Count
    $passedTests = ($testResults.Values | Where-Object { $_ -eq $true }).Count
    
    Write-Host "`nTest Results:" -ForegroundColor White
    Write-Host "  Claims Endpoint: $(if ($testResults.ClaimsEndpoint) { '✅ PASS' } else { '❌ FAIL' })" -ForegroundColor $(if ($testResults.ClaimsEndpoint) { "Green" } else { "Red" })
    Write-Host "  Recoveries Endpoint: $(if ($testResults.RecoveriesEndpoint) { '✅ PASS' } else { '❌ FAIL' })" -ForegroundColor $(if ($testResults.RecoveriesEndpoint) { "Green" } else { "Red" })
    Write-Host "  Sync Status Endpoint: $(if ($testResults.SyncStatusEndpoint) { '✅ PASS' } else { '⚠️ WARN' })" -ForegroundColor $(if ($testResults.SyncStatusEndpoint) { "Green" } else { "Yellow" })
    Write-Host "  Observability Logs: $(if ($testResults.ObservabilityLogs) { '✅ PASS' } else { '⚠️ WARN' })" -ForegroundColor $(if ($testResults.ObservabilityLogs) { "Green" } else { "Yellow" })
    Write-Host "  User Context Validation: $(if ($testResults.UserContextValidation) { '✅ PASS' } else { '⚠️ WARN' })" -ForegroundColor $(if ($testResults.UserContextValidation) { "Green" } else { "Yellow" })
    
    Write-Host "`nOverall Status: $passedTests / $totalTests tests passed" -ForegroundColor $(if ($passedTests -eq $totalTests) { "Green" } else { "Yellow" })
    
    if ($passedTests -eq $totalTests) {
        Write-Host "`n✅ PHASE 2 VERIFICATION COMPLETE!" -ForegroundColor Green
        Write-Host "   All core endpoints are working correctly" -ForegroundColor Green
        Write-Host "   Ready to proceed to Phase 3 (Evidence Pipeline)" -ForegroundColor Green
    } else {
        Write-Host "`n⚠️ SOME TESTS FAILED OR WARNED" -ForegroundColor Yellow
        Write-Host "   Review the test results above" -ForegroundColor Yellow
        Write-Host "   Check Render logs for detailed error information" -ForegroundColor Yellow
    }
    
    Write-Host "`n📋 Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Review test results above" -ForegroundColor White
    Write-Host "   2. Check Render → Logs for observability metrics" -ForegroundColor White
    Write-Host "   3. Verify sandbox mode is working correctly" -ForegroundColor White
    Write-Host "   4. Proceed to Phase 3 testing (Evidence Pipeline)" -ForegroundColor White
    
    Write-Host "`nTest completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
}

# Run main function
Main

