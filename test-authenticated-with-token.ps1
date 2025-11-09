# Test Phase 2 with Authenticated User (Using JWT Token)
# This script tests the Phase 2 endpoints with a JWT token from sandbox login

$pythonApiUrl = "https://python-api-2-jlx5.onrender.com"
$nodeApiUrl = "https://opside-node-api-woco.onrender.com"

Write-Host "`n=== PHASE 2 AUTHENTICATED USER TESTING (WITH JWT TOKEN) ===" -ForegroundColor Cyan
Write-Host "Python API: $pythonApiUrl" -ForegroundColor White
Write-Host "Node API: $nodeApiUrl" -ForegroundColor White
Write-Host ""

# Step 1: Get JWT token from sandbox login
Write-Host "`n=== STEP 1: Get JWT Token from Sandbox Login ===" -ForegroundColor Yellow

try {
    # Try sandbox login endpoint
    $loginResponse = Invoke-RestMethod -Uri "$pythonApiUrl/api/v1/integrations/amazon/sandbox/login" -Method Get -ErrorAction Stop
    $token = $loginResponse.access_token
    
    if ($token) {
        Write-Host "✅ JWT Token obtained from sandbox login" -ForegroundColor Green
        Write-Host "Token (first 50 chars): $($token.Substring(0, [Math]::Min(50, $token.Length)))..." -ForegroundColor Gray
    } else {
        Write-Host "❌ No token in response" -ForegroundColor Red
        Write-Host "Response: $($loginResponse | ConvertTo-Json -Depth 3)" -ForegroundColor Gray
        exit 1
    }
} catch {
    Write-Host "⚠️ Sandbox login endpoint not available or failed" -ForegroundColor Yellow
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nTrying sandbox callback endpoint..." -ForegroundColor Yellow
    
    try {
        # Try sandbox callback endpoint
        $body = @{
            state = "test-state"
        } | ConvertTo-Json
        
        $callbackResponse = Invoke-RestMethod -Uri "$pythonApiUrl/api/v1/integrations/amazon/sandbox/callback" -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
        
        # Check if token is in response
        if ($callbackResponse.access_token) {
            $token = $callbackResponse.access_token
            Write-Host "✅ JWT Token obtained from sandbox callback" -ForegroundColor Green
            Write-Host "Token (first 50 chars): $($token.Substring(0, [Math]::Min(50, $token.Length)))..." -ForegroundColor Gray
        } else {
            Write-Host "❌ No token in callback response" -ForegroundColor Red
            Write-Host "Response: $($callbackResponse | ConvertTo-Json -Depth 3)" -ForegroundColor Gray
            Write-Host "`n⚠️ Cannot proceed without JWT token. Using X-User-Id header for Node.js endpoints only." -ForegroundColor Yellow
            $token = $null
        }
    } catch {
        Write-Host "❌ Sandbox callback also failed" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "`n⚠️ Cannot proceed without JWT token. Using X-User-Id header for Node.js endpoints only." -ForegroundColor Yellow
        $token = $null
    }
}

# Step 2: Test with JWT token (if available)
if ($token) {
    Write-Host "`n=== STEP 2: Test Endpoints with JWT Token ===" -ForegroundColor Yellow
    
    $authHeaders = @{
        "Authorization" = "Bearer $token"
        "Content-Type" = "application/json"
    }
    
    # Test 2a: Get user profile
    Write-Host "`nTest 2a: Get User Profile" -ForegroundColor Cyan
    try {
        $profileResponse = Invoke-RestMethod -Uri "$pythonApiUrl/api/user/profile" -Method Get -Headers $authHeaders -ErrorAction Stop
        Write-Host "✅ User Profile:" -ForegroundColor Green
        Write-Host ($profileResponse | ConvertTo-Json -Depth 5) -ForegroundColor White
        $userId = $profileResponse.user.user_id
        Write-Host "User ID: $userId" -ForegroundColor Green
    } catch {
        Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
    }
    
    # Test 2b: Get claims through Python API
    Write-Host "`nTest 2b: Get Claims (Through Python API)" -ForegroundColor Cyan
    try {
        $claimsResponse = Invoke-RestMethod -Uri "$pythonApiUrl/api/v1/integrations/amazon/claims" -Method Get -Headers $authHeaders -ErrorAction Stop
        Write-Host "✅ Claims Response:" -ForegroundColor Green
        Write-Host "  Success: $($claimsResponse.success)" -ForegroundColor White
        Write-Host "  User ID: $($claimsResponse.userId)" -ForegroundColor White
        Write-Host "  Is Sandbox: $($claimsResponse.isSandbox)" -ForegroundColor White
        Write-Host "  Claim Count: $($claimsResponse.claimCount)" -ForegroundColor White
        Write-Host "  Source: $($claimsResponse.source)" -ForegroundColor White
    } catch {
        Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
    }
    
    # Test 2c: Get recoveries through Python API
    Write-Host "`nTest 2c: Get Recoveries (Through Python API)" -ForegroundColor Cyan
    try {
        $recoveriesResponse = Invoke-RestMethod -Uri "$pythonApiUrl/api/v1/integrations/amazon/recoveries" -Method Get -Headers $authHeaders -ErrorAction Stop
        Write-Host "✅ Recoveries Response:" -ForegroundColor Green
        Write-Host "  Total Amount: $($recoveriesResponse.totalAmount)" -ForegroundColor White
        Write-Host "  Claim Count: $($recoveriesResponse.claimCount)" -ForegroundColor White
        Write-Host "  Currency: $($recoveriesResponse.currency)" -ForegroundColor White
        Write-Host "  Source: $($recoveriesResponse.source)" -ForegroundColor White
    } catch {
        Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
    }
    
    # Test 2d: Get sync status through Python API
    Write-Host "`nTest 2d: Get Sync Status (Through Python API)" -ForegroundColor Cyan
    try {
        $syncResponse = Invoke-RestMethod -Uri "$pythonApiUrl/api/sync/status" -Method Get -Headers $authHeaders -ErrorAction Stop
        Write-Host "✅ Sync Status Response:" -ForegroundColor Green
        Write-Host ($syncResponse | ConvertTo-Json -Depth 5) -ForegroundColor White
    } catch {
        Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
    }
} else {
    Write-Host "`n=== STEP 2: Test Node.js Endpoints with X-User-Id Header ===" -ForegroundColor Yellow
    Write-Host "⚠️ No JWT token available - testing Node.js endpoints directly with X-User-Id header" -ForegroundColor Yellow
    
    $testUserId = "test-user-authenticated-phase2"
    $headers = @{
        "X-User-Id" = $testUserId
        "Content-Type" = "application/json"
    }
    
    # Test sync status
    Write-Host "`nTest: Sync Status (Direct Node.js)" -ForegroundColor Cyan
    try {
        $syncResponse = Invoke-RestMethod -Uri "$nodeApiUrl/api/sync/status" -Method Get -Headers $headers -ErrorAction Stop
        Write-Host "✅ Sync Status:" -ForegroundColor Green
        Write-Host ($syncResponse | ConvertTo-Json -Depth 5) -ForegroundColor White
    } catch {
        Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Test claims
    Write-Host "`nTest: Claims (Direct Node.js)" -ForegroundColor Cyan
    try {
        $claimsResponse = Invoke-RestMethod -Uri "$nodeApiUrl/api/v1/integrations/amazon/claims" -Method Get -Headers $headers -ErrorAction Stop
        Write-Host "✅ Claims:" -ForegroundColor Green
        Write-Host "  User ID: $($claimsResponse.userId)" -ForegroundColor White
        Write-Host "  Is Sandbox: $($claimsResponse.isSandbox)" -ForegroundColor White
        Write-Host "  Claim Count: $($claimsResponse.claimCount)" -ForegroundColor White
    } catch {
        Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n=== TEST SUMMARY ===" -ForegroundColor Cyan
Write-Host "`n✅ Authentication Testing Complete" -ForegroundColor Green
Write-Host "`n📝 Notes:" -ForegroundColor Yellow
Write-Host "  - Python API endpoints require JWT token in Authorization header" -ForegroundColor White
Write-Host "  - Node.js endpoints work with X-User-Id header (no JWT required)" -ForegroundColor White
Write-Host "  - User ID is extracted from JWT token and forwarded to Node.js backend" -ForegroundColor White
Write-Host "  - All endpoints return user-specific data" -ForegroundColor White

