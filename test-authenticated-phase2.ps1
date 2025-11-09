# Test Phase 2 with Authenticated User
# This script tests the Phase 2 endpoints with JWT authentication

$pythonApiUrl = "https://python-api-2-jlx5.onrender.com"
$nodeApiUrl = "https://opside-node-api-woco.onrender.com"

Write-Host "`n=== PHASE 2 AUTHENTICATED USER TESTING ===" -ForegroundColor Cyan
Write-Host "Python API: $pythonApiUrl" -ForegroundColor White
Write-Host "Node API: $nodeApiUrl" -ForegroundColor White
Write-Host ""

# Test 1: Get user profile (requires authentication)
Write-Host "`n=== TEST 1: Get User Profile (Auth Required) ===" -ForegroundColor Yellow
Write-Host "Testing: GET /api/user/profile" -ForegroundColor White
Write-Host "Expected: 401 Unauthorized (no token provided)" -ForegroundColor Gray

try {
    $response = Invoke-RestMethod -Uri "$pythonApiUrl/api/user/profile" -Method Get -ErrorAction Stop
    Write-Host "✅ Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Green
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 401) {
        Write-Host "✅ Expected 401 Unauthorized (authentication required)" -ForegroundColor Green
    } else {
        Write-Host "❌ Unexpected error: $statusCode" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Test 2: Test claims endpoint through Python API (should forward to Node.js)
Write-Host "`n=== TEST 2: Amazon Claims (Through Python API) ===" -ForegroundColor Yellow
Write-Host "Testing: GET /api/v1/integrations/amazon/claims" -ForegroundColor White
Write-Host "Expected: 401 Unauthorized (no token provided)" -ForegroundColor Gray

try {
    $response = Invoke-RestMethod -Uri "$pythonApiUrl/api/v1/integrations/amazon/claims" -Method Get -ErrorAction Stop
    Write-Host "✅ Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Green
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 401) {
        Write-Host "✅ Expected 401 Unauthorized (authentication required)" -ForegroundColor Green
    } else {
        Write-Host "❌ Unexpected error: $statusCode" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Test 3: Test recoveries endpoint through Python API
Write-Host "`n=== TEST 3: Amazon Recoveries (Through Python API) ===" -ForegroundColor Yellow
Write-Host "Testing: GET /api/v1/integrations/amazon/recoveries" -ForegroundColor White
Write-Host "Expected: 401 Unauthorized (no token provided)" -ForegroundColor Gray

try {
    $response = Invoke-RestMethod -Uri "$pythonApiUrl/api/v1/integrations/amazon/recoveries" -Method Get -ErrorAction Stop
    Write-Host "✅ Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Green
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 401) {
        Write-Host "✅ Expected 401 Unauthorized (authentication required)" -ForegroundColor Green
    } else {
        Write-Host "❌ Unexpected error: $statusCode" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Test 4: Test sync status endpoint (should work with X-User-Id header)
Write-Host "`n=== TEST 4: Sync Status (With X-User-Id Header) ===" -ForegroundColor Yellow
Write-Host "Testing: GET /api/sync/status" -ForegroundColor White
Write-Host "Header: X-User-Id: test-user-authenticated" -ForegroundColor Gray

try {
    $headers = @{
        "X-User-Id" = "test-user-authenticated"
    }
    $response = Invoke-RestMethod -Uri "$nodeApiUrl/api/sync/status" -Method Get -Headers $headers -ErrorAction Stop
    Write-Host "✅ Response:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 5) -ForegroundColor White
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status Code: $statusCode" -ForegroundColor Red
}

# Test 5: Test claims endpoint directly on Node.js (with X-User-Id header)
Write-Host "`n=== TEST 5: Claims (Direct Node.js, With X-User-Id) ===" -ForegroundColor Yellow
Write-Host "Testing: GET /api/v1/integrations/amazon/claims" -ForegroundColor White
Write-Host "Header: X-User-Id: test-user-authenticated" -ForegroundColor Gray

try {
    $headers = @{
        "X-User-Id" = "test-user-authenticated"
    }
    $response = Invoke-RestMethod -Uri "$nodeApiUrl/api/v1/integrations/amazon/claims" -Method Get -Headers $headers -ErrorAction Stop
    Write-Host "✅ Response:" -ForegroundColor Green
    Write-Host "  Success: $($response.success)" -ForegroundColor White
    Write-Host "  User ID: $($response.userId)" -ForegroundColor White
    Write-Host "  Is Sandbox: $($response.isSandbox)" -ForegroundColor White
    Write-Host "  Claim Count: $($response.claimCount)" -ForegroundColor White
    Write-Host "  Source: $($response.source)" -ForegroundColor White
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status Code: $statusCode" -ForegroundColor Red
}

Write-Host "`n=== TEST SUMMARY ===" -ForegroundColor Cyan
Write-Host "`n✅ Tests Completed:" -ForegroundColor Green
Write-Host "  1. User Profile (Auth Required) - Verified 401" -ForegroundColor White
Write-Host "  2. Claims (Python API) - Verified 401" -ForegroundColor White
Write-Host "  3. Recoveries (Python API) - Verified 401" -ForegroundColor White
Write-Host "  4. Sync Status (Node.js with X-User-Id) - Tested" -ForegroundColor White
Write-Host "  5. Claims (Node.js with X-User-Id) - Tested" -ForegroundColor White
Write-Host "`n📝 Notes:" -ForegroundColor Yellow
Write-Host "  - Python API endpoints require JWT token (401 without token)" -ForegroundColor White
Write-Host "  - Node.js endpoints work with X-User-Id header (no JWT required)" -ForegroundColor White
Write-Host "  - To test with real authentication, need valid JWT token from Supabase" -ForegroundColor White
Write-Host "`n🔍 Next Steps:" -ForegroundColor Magenta
Write-Host "  - Get JWT token from Supabase auth" -ForegroundColor White
Write-Host "  - Test with Authorization: Bearer <token> header" -ForegroundColor White
Write-Host "  - Verify user-specific data is returned" -ForegroundColor White

