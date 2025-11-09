# Phase 3: Gmail Integration Testing
# Tests Gmail OAuth flow, connection status, evidence ingestion, and parsing

param(
    [string]$NodeApiUrl = "https://opside-node-api-woco.onrender.com",
    [string]$PythonApiUrl = "https://python-api-2-jlx5.onrender.com",
    [string]$TestUserId = "test-user-phase3-$(Get-Date -Format 'yyyyMMddHHmmss')",
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
    Write-Host "PHASE 3: GMAIL INTEGRATION TESTING" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Node API URL: $NodeApiUrl" -ForegroundColor Gray
    Write-Host "Python API URL: $PythonApiUrl" -ForegroundColor Gray
    Write-Host "Test User ID: $TestUserId" -ForegroundColor Gray
    Write-Host "Auth Token: $(if ($AuthToken) { "Provided" } else { "Not provided (using X-User-Id header)" })" -ForegroundColor Gray
    
    $testResults = @{
        GmailOAuthUrl = $false
        GmailConnectionStatus = $false
        GmailDisconnect = $false
        EvidenceIngestion = $false
        EvidenceStatus = $false
        IntegrationStatus = $false
    }
    
    Write-Section "Test 1: Gmail OAuth URL Generation"
    
    Write-TestStep "Testing GET /api/v1/integrations/gmail/connect" "TEST"
    $headers = @{}
    if ($AuthToken) {
        $headers["Authorization"] = "Bearer $AuthToken"
    }
    $headers["X-User-Id"] = $TestUserId
    
    $oauthResponse = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/v1/integrations/gmail/connect" -Headers $headers -ExpectSuccess $false
    
    if ($oauthResponse.Success) {
        Write-TestStep "Gmail OAuth URL generated successfully" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    authUrl: $($oauthResponse.Data.authUrl)" -ForegroundColor Gray
        Write-Host "    sandbox: $($oauthResponse.Data.sandbox)" -ForegroundColor Gray
        Write-Host "    message: $($oauthResponse.Data.message)" -ForegroundColor Gray
        
        # Verify OAuth URL structure
        if ($oauthResponse.Data.authUrl -like "https://accounts.google.com/o/oauth2/v2/auth*") {
            Write-TestStep "OAuth URL structure is correct (Google OAuth)" "PASS"
            $testResults.GmailOAuthUrl = $true
            
            # Extract and display OAuth parameters
            $oauthUrl = $oauthResponse.Data.authUrl
            Write-Host "`n  OAuth URL Parameters:" -ForegroundColor Cyan
            if ($oauthUrl -match "client_id=([^&]+)") {
                Write-Host "    client_id: $($Matches[1])" -ForegroundColor Gray
            }
            if ($oauthUrl -match "redirect_uri=([^&]+)") {
                Write-Host "    redirect_uri: $([System.Web.HttpUtility]::UrlDecode($Matches[1]))" -ForegroundColor Gray
            }
            if ($oauthUrl -match "scope=([^&]+)") {
                Write-Host "    scope: $([System.Web.HttpUtility]::UrlDecode($Matches[1]))" -ForegroundColor Gray
            }
            
            Write-Host "`n  📋 To Test OAuth Flow:" -ForegroundColor Yellow
            Write-Host "    1. Open this URL in a browser: $oauthUrl" -ForegroundColor White
            Write-Host "    2. Log in with a Gmail account" -ForegroundColor White
            Write-Host "    3. Grant permission to the app" -ForegroundColor White
            Write-Host "    4. You'll be redirected back to the callback URL" -ForegroundColor White
            Write-Host "    5. Check integration status to verify connection" -ForegroundColor White
        } else {
            Write-TestStep "OAuth URL structure may be incorrect" "WARN"
            Write-Host "  Expected: https://accounts.google.com/o/oauth2/v2/auth..." -ForegroundColor Yellow
            Write-Host "  Got: $($oauthResponse.Data.authUrl)" -ForegroundColor Yellow
        }
    } else {
        Write-TestStep "Gmail OAuth URL generation failed" "FAIL"
        Write-Host "  Status Code: $($oauthResponse.StatusCode)" -ForegroundColor Red
        Write-Host "  Error: $($oauthResponse.Error)" -ForegroundColor Red
        Write-Host "  Note: This may indicate Gmail credentials are not configured" -ForegroundColor Yellow
    }
    
    Write-Section "Test 2: Gmail Connection Status"
    
    Write-TestStep "Testing GET /api/v1/integrations/gmail/status" "TEST"
    $statusResponse = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/v1/integrations/gmail/status" -Headers $headers -ExpectSuccess $false
    
    if ($statusResponse.Success) {
        Write-TestStep "Gmail status endpoint is reachable" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    connected: $($statusResponse.Data.connected)" -ForegroundColor $(if ($statusResponse.Data.connected) { "Green" } else { "Yellow" })
        Write-Host "    email: $($statusResponse.Data.email)" -ForegroundColor Gray
        Write-Host "    lastSync: $($statusResponse.Data.lastSync)" -ForegroundColor Gray
        Write-Host "    scopes: $($statusResponse.Data.scopes -join ', ')" -ForegroundColor Gray
        
        $testResults.GmailConnectionStatus = $true
        
        if ($statusResponse.Data.connected) {
            Write-TestStep "✅ Gmail is connected!" "PASS"
            Write-Host "  Email: $($statusResponse.Data.email)" -ForegroundColor Green
            Write-Host "  Last Sync: $($statusResponse.Data.lastSync)" -ForegroundColor Green
        } else {
            Write-TestStep "⚠️ Gmail is not connected (expected if OAuth not completed)" "WARN"
            Write-Host "  Note: Complete OAuth flow to connect Gmail" -ForegroundColor Yellow
            Write-Host "  OAuth URL: Use the URL from Test 1" -ForegroundColor Yellow
        }
    } else {
        Write-TestStep "Gmail status endpoint failed" "WARN"
        Write-Host "  Status Code: $($statusResponse.StatusCode)" -ForegroundColor Yellow
        Write-Host "  Error: $($statusResponse.Error)" -ForegroundColor Yellow
        Write-Host "  Note: This may be expected if Gmail is not connected" -ForegroundColor Gray
    }
    
    Write-Section "Test 3: Integration Status (Gmail Provider)"
    
    Write-TestStep "Testing GET /api/v1/integrations/status (checking Gmail)" "TEST"
    $integrationStatusResponse = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/v1/integrations/status" -Headers $headers -ExpectSuccess $false
    
    if ($integrationStatusResponse.Success) {
        Write-TestStep "Integration status endpoint is reachable" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    docs_connected: $($integrationStatusResponse.Data.docs_connected)" -ForegroundColor Gray
        Write-Host "    providerIngest.gmail.connected: $($integrationStatusResponse.Data.providerIngest.gmail.connected)" -ForegroundColor $(if ($integrationStatusResponse.Data.providerIngest.gmail.connected) { "Green" } else { "Yellow" })
        
        $testResults.IntegrationStatus = $true
        
        if ($integrationStatusResponse.Data.providerIngest.gmail.connected) {
            Write-TestStep "✅ Gmail provider is connected in integration status" "PASS"
        } else {
            Write-TestStep "⚠️ Gmail provider is not connected (expected if OAuth not completed)" "WARN"
        }
    } else {
        Write-TestStep "Integration status endpoint failed" "WARN"
        Write-Host "  Status Code: $($integrationStatusResponse.StatusCode)" -ForegroundColor Yellow
        Write-Host "  Error: $($integrationStatusResponse.Error)" -ForegroundColor Yellow
    }
    
    Write-Section "Test 4: Evidence Ingestion Endpoint"
    
    Write-TestStep "Testing POST /api/evidence/ingest/gmail" "TEST"
    $ingestBody = @{
        userId = $TestUserId
        limit = 10
    }
    
    $ingestResponse = Invoke-ApiRequest -Method "POST" -Url "$NodeApiUrl/api/evidence/ingest/gmail" -Headers $headers -Body $ingestBody -ExpectSuccess $false
    
    if ($ingestResponse.Success) {
        Write-TestStep "Evidence ingestion endpoint is reachable" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    success: $($ingestResponse.Data.success)" -ForegroundColor Gray
        Write-Host "    message: $($ingestResponse.Data.message)" -ForegroundColor Gray
        Write-Host "    jobId: $($ingestResponse.Data.jobId)" -ForegroundColor Gray
        
        $testResults.EvidenceIngestion = $true
        
        if ($ingestResponse.Data.success) {
            Write-TestStep "✅ Evidence ingestion started successfully" "PASS"
        } else {
            Write-TestStep "⚠️ Evidence ingestion may have failed (check message)" "WARN"
            Write-Host "  Message: $($ingestResponse.Data.message)" -ForegroundColor Yellow
        }
    } else {
        Write-TestStep "Evidence ingestion endpoint failed" "WARN"
        Write-Host "  Status Code: $($ingestResponse.StatusCode)" -ForegroundColor Yellow
        Write-Host "  Error: $($ingestResponse.Error)" -ForegroundColor Yellow
        Write-Host "  Note: This may be expected if Gmail is not connected" -ForegroundColor Gray
    }
    
    Write-Section "Test 5: Evidence Status Endpoint"
    
    Write-TestStep "Testing GET /api/evidence/status" "TEST"
    $evidenceStatusResponse = Invoke-ApiRequest -Method "GET" -Url "$NodeApiUrl/api/evidence/status" -Headers $headers -ExpectSuccess $false
    
    if ($evidenceStatusResponse.Success) {
        Write-TestStep "Evidence status endpoint is reachable" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    status: $($evidenceStatusResponse.Data.status)" -ForegroundColor Gray
        Write-Host "    documentsProcessed: $($evidenceStatusResponse.Data.documentsProcessed)" -ForegroundColor Gray
        Write-Host "    lastIngest: $($evidenceStatusResponse.Data.lastIngest)" -ForegroundColor Gray
        
        $testResults.EvidenceStatus = $true
    } else {
        Write-TestStep "Evidence status endpoint failed" "WARN"
        Write-Host "  Status Code: $($evidenceStatusResponse.StatusCode)" -ForegroundColor Yellow
        Write-Host "  Error: $($evidenceStatusResponse.Error)" -ForegroundColor Yellow
    }
    
    Write-Section "Test 6: Gmail Disconnect Endpoint"
    
    Write-TestStep "Testing POST /api/v1/integrations/gmail/disconnect" "TEST"
    $disconnectResponse = Invoke-ApiRequest -Method "POST" -Url "$NodeApiUrl/api/v1/integrations/gmail/disconnect" -Headers $headers -ExpectSuccess $false
    
    if ($disconnectResponse.Success) {
        Write-TestStep "Gmail disconnect endpoint is reachable" "PASS"
        Write-Host "`n  Response Data:" -ForegroundColor Gray
        Write-Host "    success: $($disconnectResponse.Data.success)" -ForegroundColor Gray
        Write-Host "    message: $($disconnectResponse.Data.message)" -ForegroundColor Gray
        
        $testResults.GmailDisconnect = $true
        
        Write-Host "  Note: Gmail disconnect tested (may not be connected)" -ForegroundColor Yellow
    } else {
        Write-TestStep "Gmail disconnect endpoint failed" "WARN"
        Write-Host "  Status Code: $($disconnectResponse.StatusCode)" -ForegroundColor Yellow
        Write-Host "  Error: $($disconnectResponse.Error)" -ForegroundColor Yellow
        Write-Host "  Note: This may be expected if Gmail is not connected" -ForegroundColor Gray
    }
    
    Write-Section "Summary"
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "PHASE 3 TEST RESULTS" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    $totalTests = $testResults.Count
    $passedTests = ($testResults.Values | Where-Object { $_ -eq $true }).Count
    
    Write-Host "`nTest Results:" -ForegroundColor White
    Write-Host "  Gmail OAuth URL: $(if ($testResults.GmailOAuthUrl) { '✅ PASS' } else { '❌ FAIL' })" -ForegroundColor $(if ($testResults.GmailOAuthUrl) { "Green" } else { "Red" })
    Write-Host "  Gmail Connection Status: $(if ($testResults.GmailConnectionStatus) { '✅ PASS' } else { '⚠️ WARN' })" -ForegroundColor $(if ($testResults.GmailConnectionStatus) { "Green" } else { "Yellow" })
    Write-Host "  Integration Status: $(if ($testResults.IntegrationStatus) { '✅ PASS' } else { '⚠️ WARN' })" -ForegroundColor $(if ($testResults.IntegrationStatus) { "Green" } else { "Yellow" })
    Write-Host "  Evidence Ingestion: $(if ($testResults.EvidenceIngestion) { '✅ PASS' } else { '⚠️ WARN' })" -ForegroundColor $(if ($testResults.EvidenceIngestion) { "Green" } else { "Yellow" })
    Write-Host "  Evidence Status: $(if ($testResults.EvidenceStatus) { '✅ PASS' } else { '⚠️ WARN' })" -ForegroundColor $(if ($testResults.EvidenceStatus) { "Green" } else { "Yellow" })
    Write-Host "  Gmail Disconnect: $(if ($testResults.GmailDisconnect) { '✅ PASS' } else { '⚠️ WARN' })" -ForegroundColor $(if ($testResults.GmailDisconnect) { "Green" } else { "Yellow" })
    
    Write-Host "`nOverall Status: $passedTests / $totalTests tests passed" -ForegroundColor $(if ($passedTests -eq $totalTests) { "Green" } else { "Yellow" })
    
    Write-Host "`n📋 Key Findings:" -ForegroundColor Cyan
    if ($testResults.GmailOAuthUrl) {
        Write-Host "  ✅ Gmail OAuth URL generation is working" -ForegroundColor Green
        Write-Host "  ✅ OAuth flow can be tested by opening the generated URL" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Gmail OAuth URL generation failed" -ForegroundColor Red
        Write-Host "  ⚠️  Check Gmail credentials configuration" -ForegroundColor Yellow
    }
    
    if ($testResults.GmailConnectionStatus) {
        Write-Host "  ✅ Gmail status endpoint is working" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Gmail status endpoint may not be accessible" -ForegroundColor Yellow
    }
    
    Write-Host "`n🚀 Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Test Gmail OAuth flow by opening the OAuth URL" -ForegroundColor White
    Write-Host "   2. Log in with a Gmail account and grant permission" -ForegroundColor White
    Write-Host "   3. Verify connection status after OAuth completion" -ForegroundColor White
    Write-Host "   4. Test evidence ingestion after Gmail is connected" -ForegroundColor White
    Write-Host "   5. Verify evidence parsing and status endpoints" -ForegroundColor White
    
    Write-Host "`n📝 Testing Gmail OAuth Without Full Login:" -ForegroundColor Yellow
    Write-Host "   - OAuth URL generation can be tested without login" -ForegroundColor White
    Write-Host "   - Connection status endpoint can be tested without login" -ForegroundColor White
    Write-Host "   - Evidence ingestion requires Gmail to be connected" -ForegroundColor White
    Write-Host "   - For full end-to-end testing, complete OAuth flow with a real Gmail account" -ForegroundColor White
    
    Write-Host "`nTest completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
}

# Run main function
Main

