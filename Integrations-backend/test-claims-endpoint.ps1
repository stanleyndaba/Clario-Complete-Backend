# Test script to verify the Amazon claims endpoint fix
# 
# This script tests the /api/v1/integrations/amazon/claims endpoint
# to verify it returns the safe fallback response (success: true)
# instead of the old error response.
# 
# Usage:
#   .\test-claims-endpoint.ps1 [url]
# 
# Examples:
#   .\test-claims-endpoint.ps1                          # Test localhost
#   .\test-claims-endpoint.ps1 http://localhost:3001   # Test localhost with port
#   .\test-claims-endpoint.ps1 https://opside-node-api-new.onrender.com  # Test deployed service

param(
    [string]$BaseUrl = "http://localhost:3001"
)

$endpoint = "/api/v1/integrations/amazon/claims"
$fullUrl = "$BaseUrl$endpoint"

Write-Host "🧪 Testing Amazon Claims Endpoint Fix" -ForegroundColor Cyan
Write-Host ("═" * 60) -ForegroundColor Gray
Write-Host "📍 URL: $fullUrl" -ForegroundColor Yellow
Write-Host ""

try {
    Write-Host "📡 Sending request..." -ForegroundColor Cyan
    Write-Host ""
    
    $startTime = Get-Date
    
    $response = Invoke-RestMethod -Uri $fullUrl -Method Get -TimeoutSec 10 -ErrorAction Stop
    
    $elapsed = ((Get-Date) - $startTime).TotalMilliseconds
    
    Write-Host "📊 Response Status: 200 OK" -ForegroundColor Green
    Write-Host "⏱️  Response Time: $([math]::Round($elapsed, 2))ms" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "📦 Response Body:" -ForegroundColor Cyan
    Write-Host ("─" * 60) -ForegroundColor Gray
    Write-Host ($response | ConvertTo-Json -Depth 10)
    Write-Host ""
    Write-Host ("─" * 60) -ForegroundColor Gray
    Write-Host ""
    Write-Host "✅ Verification Results:" -ForegroundColor Cyan
    Write-Host ""
    
    $allPassed = $true
    
    # Check 1: Response should have success: true
    if ($response.success -eq $true) {
        Write-Host "✅ success: true (fix is working!)" -ForegroundColor Green
    } else {
        Write-Host "❌ success: $($response.success) (expected true)" -ForegroundColor Red
        Write-Host "   ⚠️  Old broken code is still running!" -ForegroundColor Yellow
        $allPassed = $false
    }
    
    # Check 2: Should not have "Failed to fetch claims" error
    if ($response.error -and $response.error -like "*Failed to fetch claims*") {
        Write-Host "❌ Error message: `"Failed to fetch claims`" (old broken code)" -ForegroundColor Red
        Write-Host "   ⚠️  The fix has NOT been deployed!" -ForegroundColor Yellow
        $allPassed = $false
    } elseif ($response.error) {
        Write-Host "⚠️  Error message: $($response.error)" -ForegroundColor Yellow
    } else {
        Write-Host "✅ No error message (good!)" -ForegroundColor Green
    }
    
    # Check 3: Should have claims array
    if ($response.claims -is [array]) {
        Write-Host "✅ claims: [] (array present, length: $($response.claims.Length))" -ForegroundColor Green
    } else {
        Write-Host "❌ claims: $($response.claims.GetType().Name) (expected array)" -ForegroundColor Red
        $allPassed = $false
    }
    
    # Check 4: Should have source field indicating isolated route
    if ($response.source -eq "isolated_route" -or $response.source -eq "safe_fallback") {
        Write-Host "✅ source: `"$($response.source)`" (fix is deployed!)" -ForegroundColor Green
    } elseif ($response.source) {
        Write-Host "⚠️  source: `"$($response.source)`" (different implementation)" -ForegroundColor Yellow
    } else {
        Write-Host "⚠️  source: not present (may be old code)" -ForegroundColor Yellow
    }
    
    # Check 5: Should have isSandbox field
    if ($response.isSandbox -eq $true) {
        Write-Host "✅ isSandbox: true" -ForegroundColor Green
    } else {
        Write-Host "⚠️  isSandbox: $($response.isSandbox)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host ("═" * 60) -ForegroundColor Gray
    
    # Final verdict
    if ($allPassed) {
        Write-Host "🎉 SUCCESS: The fix is working correctly!" -ForegroundColor Green
        Write-Host ""
        Write-Host "✅ The endpoint returns success: true" -ForegroundColor Green
        Write-Host "✅ No errors are thrown" -ForegroundColor Green
        Write-Host "✅ Safe fallback is working" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "❌ FAILURE: The fix may not be deployed or working correctly" -ForegroundColor Red
        Write-Host ""
        Write-Host "💡 Next steps:" -ForegroundColor Yellow
        Write-Host "   1. Verify the latest commit is deployed" -ForegroundColor Yellow
        Write-Host "   2. Check Render deployment logs" -ForegroundColor Yellow
        Write-Host "   3. Verify the route handler code matches the fix" -ForegroundColor Yellow
        exit 1
    }
    
} catch {
    Write-Host "❌ Request Error:" -ForegroundColor Red
    Write-Host ""
    
    if ($_.Exception.Response) {
        $statusCode = [int]$_.Exception.Response.StatusCode.value__
        Write-Host "   Status Code: $statusCode" -ForegroundColor Red
    }
    
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Is the server running?" -ForegroundColor Yellow
    Write-Host "   2. Is the URL correct?" -ForegroundColor Yellow
    Write-Host "   3. Is the server accessible?" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

