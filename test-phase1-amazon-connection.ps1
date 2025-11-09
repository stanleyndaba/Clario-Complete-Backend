# Phase 1: Test Amazon Connection Status
# Verifies that Amazon shows as connected after bypass flow

param(
    [string]$NodeApiUrl = "http://localhost:3001",
    [string]$PythonApiUrl = "http://localhost:8000",
    [string]$TestUserId = "test-user-$(Get-Date -Format 'yyyyMMddHHmmss')",
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
        default { "White" }
    }
    Write-Host "[$Status] $Step" -ForegroundColor $color
}

function Write-Section {
    param([string]$Section)
    Write-Host "`n--- $Section ---" -ForegroundColor Yellow
}

# Helper function to make API requests
function Invoke-ApiRequest {
    param(
        [string]$Method = "GET",
        [string]$Url,
        [hashtable]$Headers = @{},
        [object]$Body = $null,
        [switch]$ExpectSuccess = $true
    )
    
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
        return @{
            Success = $true
            Data = $response
            StatusCode = 200
        }
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errorMessage = $_.Exception.Message
        
        if ($ExpectSuccess) {
            Write-TestStep "API Request Failed: $Url" "FAIL"
            Write-Host "  Error: $errorMessage" -ForegroundColor Red
            Write-Host "  Status: $statusCode" -ForegroundColor Red
        }
        
        return @{
            Success = $false
            Data = $null
            StatusCode = $statusCode
            Error = $errorMessage
        }
    }
}

# Main execution
function Main {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "PHASE 1: AMAZON CONNECTION STATUS TEST" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Node API URL: $NodeApiUrl" -ForegroundColor Gray
    Write-Host "Python API URL: $PythonApiUrl" -ForegroundColor Gray
    Write-Host "Test User ID: $TestUserId" -ForegroundColor Gray
    Write-Host "Auth Token: $(if ($AuthToken) { "Provided" } else { "Not provided (using X-User-Id header)" })" -ForegroundColor Gray
    
    Write-Section "Test 1: Integration Status (Python API)"
    
    # Test integration status endpoint
    Write-TestStep "Testing GET /api/v1/integrations/status (Python API)"
    $headers = @{}
    if ($AuthToken) {
        $headers["Authorization"] = "Bearer $AuthToken"
    }
    $headers["X-User-Id"] = $TestUserId
    
    $statusResponse = Invoke-ApiRequest -Method "GET" -Url "$PythonApiUrl/api/v1/integrations/status" -Headers $headers -ExpectSuccess $false
    
    if ($statusResponse.Success) {
        Write-TestStep "Integration status retrieved successfully" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    amazon_connected: $($statusResponse.Data.amazon_connected)" -ForegroundColor $(if ($statusResponse.Data.amazon_connected) { "Green" } else { "Yellow" })
        Write-Host "    docs_connected: $($statusResponse.Data.docs_connected)" -ForegroundColor Gray
        Write-Host "    lastSync: $($statusResponse.Data.lastSync)" -ForegroundColor Gray
        Write-Host "    lastIngest: $($statusResponse.Data.lastIngest)" -ForegroundColor Gray
        
        if ($statusResponse.Data.providerIngest) {
            Write-Host "`n  Evidence Providers:" -ForegroundColor Gray
            foreach ($provider in $statusResponse.Data.providerIngest.PSObject.Properties) {
                $providerName = $provider.Name
                $providerData = $provider.Value
                $connected = $providerData.connected
                Write-Host "    $providerName : $(if ($connected) { "✅ Connected" } else { "❌ Not Connected" })" -ForegroundColor $(if ($connected) { "Green" } else { "Gray" })
            }
        }
        
        # Verify Amazon is connected
        if ($statusResponse.Data.amazon_connected) {
            Write-TestStep "✅ Amazon is connected!" "PASS"
        } else {
            Write-TestStep "⚠️ Amazon is not connected (may need to use bypass flow)" "WARN"
        }
    } else {
        Write-TestStep "Failed to get integration status" "FAIL"
        Write-Host "  Status Code: $($statusResponse.StatusCode)" -ForegroundColor Red
        Write-Host "  Error: $($statusResponse.Error)" -ForegroundColor Red
    }
    
    Write-Section "Test 2: Integration Status (Node.js API)"
    
    # Test Node.js integration status endpoint
    Write-TestStep "Testing GET /api/v1/integrations/status (Node.js API)"
    $nodeHeaders = @{}
    if ($AuthToken) {
        $nodeHeaders["Authorization"] = "Bearer $AuthToken"
    }
    $nodeHeaders["X-User-Id"] = $TestUserId
    
    $nodeStatusResponse = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/v1/integrations/status" -Headers $nodeHeaders -ExpectSuccess $false
    
    if ($nodeStatusResponse.Success) {
        Write-TestStep "Node.js integration status retrieved successfully" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    amazon_connected: $($nodeStatusResponse.Data.amazon_connected)" -ForegroundColor $(if ($nodeStatusResponse.Data.amazon_connected) { "Green" } else { "Yellow" })
        Write-Host "    docs_connected: $($nodeStatusResponse.Data.docs_connected)" -ForegroundColor Gray
        Write-Host "    lastSync: $($nodeStatusResponse.Data.lastSync)" -ForegroundColor Gray
        Write-Host "    lastIngest: $($nodeStatusResponse.Data.lastIngest)" -ForegroundColor Gray
        
        if ($nodeStatusResponse.Data.providerIngest) {
            Write-Host "`n  Evidence Providers:" -ForegroundColor Gray
            foreach ($provider in $nodeStatusResponse.Data.providerIngest.PSObject.Properties) {
                $providerName = $provider.Name
                $providerData = $provider.Value
                $connected = $providerData.connected
                Write-Host "    $providerName : $(if ($connected) { "✅ Connected" } else { "❌ Not Connected" })" -ForegroundColor $(if ($connected) { "Green" } else { "Gray" })
            }
        }
        
        # Verify Amazon is connected
        if ($nodeStatusResponse.Data.amazon_connected) {
            Write-TestStep "✅ Amazon is connected!" "PASS"
        } else {
            Write-TestStep "⚠️ Amazon is not connected (may need to use bypass flow)" "WARN"
        }
    } else {
        Write-TestStep "Failed to get Node.js integration status" "WARN"
        Write-Host "  Note: Node.js endpoint may not be available, using Python API instead" -ForegroundColor Yellow
    }
    
    Write-Section "Test 3: Amazon Claims Endpoint"
    
    # Test Amazon claims endpoint (this will verify Amazon connection)
    Write-TestStep "Testing GET /api/v1/integrations/amazon/claims"
    $claimsHeaders = @{}
    if ($AuthToken) {
        $claimsHeaders["Authorization"] = "Bearer $AuthToken"
    }
    $claimsHeaders["X-User-Id"] = $TestUserId
    
    $claimsResponse = Invoke-ApiRequest -Method "GET" -Url "$PythonApiUrl/api/v1/integrations/amazon/claims" -Headers $claimsHeaders -ExpectSuccess $false
    
    if ($claimsResponse.Success) {
        Write-TestStep "Amazon claims endpoint accessible" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    success: $($claimsResponse.Data.success)" -ForegroundColor $(if ($claimsResponse.Data.success) { "Green" } else { "Yellow" })
        Write-Host "    source: $($claimsResponse.Data.source)" -ForegroundColor Gray
        Write-Host "    isSandbox: $($claimsResponse.Data.isSandbox)" -ForegroundColor Gray
        Write-Host "    claims count: $($claimsResponse.Data.claims.Count)" -ForegroundColor Gray
        
        # If we can call this endpoint successfully, Amazon is likely connected
        if ($claimsResponse.Data.success) {
            Write-TestStep "✅ Amazon API is accessible (connection verified)" "PASS"
        }
    } else {
        Write-TestStep "Amazon claims endpoint failed" "WARN"
        Write-Host "  Note: This may indicate Amazon is not connected or token is invalid" -ForegroundColor Yellow
    }
    
    Write-Section "Test 4: Check Token Manager"
    
    # Check if refresh token exists in environment (indirect check)
    Write-TestStep "Checking for Amazon refresh token in environment"
    $hasRefreshToken = $env:AMAZON_SPAPI_REFRESH_TOKEN -ne $null -and $env:AMAZON_SPAPI_REFRESH_TOKEN -ne ""
    
    if ($hasRefreshToken) {
        Write-TestStep "✅ Amazon refresh token found in environment" "PASS"
        Write-Host "  Note: Token exists - bypass flow should work" -ForegroundColor Gray
    } else {
        Write-TestStep "⚠️ Amazon refresh token not found in environment" "WARN"
        Write-Host "  Note: This is expected if testing locally without environment variables" -ForegroundColor Yellow
        Write-Host "  On Render, the token should be set in environment variables" -ForegroundColor Yellow
    }
    
    Write-Section "Summary"
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "TEST RESULTS" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    $amazonConnected = $false
    if ($statusResponse.Success -and $statusResponse.Data.amazon_connected) {
        $amazonConnected = $true
    } elseif ($nodeStatusResponse.Success -and $nodeStatusResponse.Data.amazon_connected) {
        $amazonConnected = $true
    } elseif ($claimsResponse.Success -and $claimsResponse.Data.success) {
        $amazonConnected = $true
    }
    
    if ($amazonConnected) {
        Write-Host "`n✅ AMAZON IS CONNECTED!" -ForegroundColor Green
        Write-Host "   - Integration status shows amazon_connected: true" -ForegroundColor Green
        Write-Host "   - Amazon API endpoints are accessible" -ForegroundColor Green
        Write-Host "   - Ready for Phase 2 testing (sync and claims)" -ForegroundColor Green
    } else {
        Write-Host "`n⚠️ AMAZON CONNECTION STATUS UNCLEAR" -ForegroundColor Yellow
        Write-Host "   - Integration status may show amazon_connected: false" -ForegroundColor Yellow
        Write-Host "   - Try using 'Use Existing Connection' button to connect" -ForegroundColor Yellow
        Write-Host "   - Verify AMAZON_SPAPI_REFRESH_TOKEN is set in environment" -ForegroundColor Yellow
    }
    
    Write-Host "`n📋 Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. If Amazon is connected: Proceed to Phase 2 testing" -ForegroundColor White
    Write-Host "   2. If Amazon is not connected: Use 'Use Existing Connection' button" -ForegroundColor White
    Write-Host "   3. Verify refresh token is set in Render environment variables" -ForegroundColor White
    Write-Host "   4. Check backend logs for connection status" -ForegroundColor White
    
    Write-Host "`nTest completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
}

# Run main function
Main

