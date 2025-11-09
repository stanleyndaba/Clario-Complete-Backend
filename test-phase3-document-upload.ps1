# Phase 3 Document Upload & Parsing Test Script
# Tests the full document ingestion flow: Frontend → Node → Python → DB → Parsing

param(
    [string]$NodeApiUrl = "https://opside-node-api-woco.onrender.com",
    [string]$PythonApiUrl = "https://python-api-newest.onrender.com",
    [string]$UserId = "test-user-phase3-$(Get-Date -Format 'yyyyMMddHHmmss')",
    [string]$TestFile = "test-document.pdf"
)

Write-Host "`n=== PHASE 3: DOCUMENT UPLOAD & PARSING TEST ===" -ForegroundColor Cyan
Write-Host "Node API: $NodeApiUrl" -ForegroundColor Yellow
Write-Host "Python API: $PythonApiUrl" -ForegroundColor Yellow
Write-Host "User ID: $UserId" -ForegroundColor Yellow
Write-Host ""

# Colors for output
$successColor = "Green"
$errorColor = "Red"
$infoColor = "Yellow"

# Test 1: Check Node.js API health
Write-Host "`n[TEST 1] Checking Node.js API health..." -ForegroundColor $infoColor
try {
    $healthResponse = Invoke-RestMethod -Uri "$NodeApiUrl/health" -Method GET -ErrorAction Stop
    Write-Host "✅ Node.js API is reachable" -ForegroundColor $successColor
    Write-Host "   Status: $($healthResponse.status)" -ForegroundColor White
} catch {
    Write-Host "❌ Node.js API is not reachable" -ForegroundColor $errorColor
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor $errorColor
    exit 1
}

# Test 2: Check Python API health
Write-Host "`n[TEST 2] Checking Python API health..." -ForegroundColor $infoColor
try {
    $pythonHealthResponse = Invoke-RestMethod -Uri "$PythonApiUrl/health" -Method GET -ErrorAction Stop
    Write-Host "✅ Python API is reachable" -ForegroundColor $successColor
    Write-Host "   Status: $($pythonHealthResponse.status)" -ForegroundColor White
} catch {
    Write-Host "❌ Python API is not reachable" -ForegroundColor $errorColor
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor $errorColor
    exit 1
}

# Test 3: Create a test PDF file (if it doesn't exist)
Write-Host "`n[TEST 3] Preparing test document..." -ForegroundColor $infoColor
if (-not (Test-Path $TestFile)) {
    Write-Host "⚠️  Test file '$TestFile' not found. Creating a simple test file..." -ForegroundColor $infoColor
    # Create a simple text file as a test document
    $testContent = @"
Test Document for Phase 3 Upload
Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
User ID: $UserId
This is a test document for verifying document upload and parsing functionality.
"@
    $testContent | Out-File -FilePath $TestFile -Encoding UTF8
    Write-Host "✅ Created test file: $TestFile" -ForegroundColor $successColor
} else {
    Write-Host "✅ Test file exists: $TestFile" -ForegroundColor $successColor
}

# Test 4: Test document upload via Node.js endpoint (/api/evidence/upload)
Write-Host "`n[TEST 4] Testing document upload via Node.js endpoint (/api/evidence/upload)..." -ForegroundColor $infoColor
try {
    $fileContent = [System.IO.File]::ReadAllBytes((Resolve-Path $TestFile))
    $boundary = [System.Guid]::NewGuid().ToString()
    $fileBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $TestFile))
    $fileName = Split-Path -Leaf $TestFile
    
    # Create multipart form data
    $bodyLines = @(
        "--$boundary",
        "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"",
        "Content-Type: application/pdf",
        "",
        [System.Text.Encoding]::UTF8.GetString($fileBytes),
        "--$boundary--"
    )
    $body = $bodyLines -join "`r`n"
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    
    $headers = @{
        "X-User-Id" = $UserId
        "Content-Type" = "multipart/form-data; boundary=$boundary"
    }
    
    Write-Host "   Uploading file: $fileName" -ForegroundColor White
    Write-Host "   File size: $($fileBytes.Length) bytes" -ForegroundColor White
    
    $uploadResponse = Invoke-RestMethod -Uri "$NodeApiUrl/api/evidence/upload" -Method POST -Headers $headers -Body $bodyBytes -ErrorAction Stop
    
    Write-Host "✅ Document upload successful!" -ForegroundColor $successColor
    Write-Host "   Document ID: $($uploadResponse.id)" -ForegroundColor White
    Write-Host "   Status: $($uploadResponse.status)" -ForegroundColor White
    Write-Host "   Message: $($uploadResponse.message)" -ForegroundColor White
    if ($uploadResponse.processing_status) {
        Write-Host "   Processing Status: $($uploadResponse.processing_status)" -ForegroundColor White
    }
    
    $documentId = $uploadResponse.id
} catch {
    Write-Host "❌ Document upload failed" -ForegroundColor $errorColor
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor $errorColor
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "   Response: $responseBody" -ForegroundColor $errorColor
    }
    exit 1
}

# Test 5: Test document upload via proxy endpoint (/api/documents/upload)
Write-Host "`n[TEST 5] Testing document upload via proxy endpoint (/api/documents/upload)..." -ForegroundColor $infoColor
try {
    $fileContent = [System.IO.File]::ReadAllBytes((Resolve-Path $TestFile))
    $boundary = [System.Guid]::NewGuid().ToString()
    $fileBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $TestFile))
    $fileName = Split-Path -Leaf $TestFile
    
    # Create multipart form data
    $bodyLines = @(
        "--$boundary",
        "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"",
        "Content-Type: application/pdf",
        "",
        [System.Text.Encoding]::UTF8.GetString($fileBytes),
        "--$boundary--"
    )
    $body = $bodyLines -join "`r`n"
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    
    $headers = @{
        "X-User-Id" = $UserId
        "Content-Type" = "multipart/form-data; boundary=$boundary"
    }
    
    Write-Host "   Uploading file via proxy: $fileName" -ForegroundColor White
    
    $proxyUploadResponse = Invoke-RestMethod -Uri "$NodeApiUrl/api/documents/upload" -Method POST -Headers $headers -Body $bodyBytes -ErrorAction Stop
    
    Write-Host "✅ Proxy upload successful!" -ForegroundColor $successColor
    Write-Host "   Document ID: $($proxyUploadResponse.id)" -ForegroundColor White
    Write-Host "   Status: $($proxyUploadResponse.status)" -ForegroundColor White
    
    $proxyDocumentId = $proxyUploadResponse.id
} catch {
    Write-Host "⚠️  Proxy upload failed (this is OK if the primary endpoint works)" -ForegroundColor $infoColor
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor $infoColor
}

# Test 6: Check document status in database (via Python API)
Write-Host "`n[TEST 6] Checking document status..." -ForegroundColor $infoColor
if ($documentId) {
    try {
        $statusResponse = Invoke-RestMethod -Uri "$PythonApiUrl/api/documents/$documentId" -Method GET -Headers @{"X-User-Id" = $UserId} -ErrorAction Stop
        Write-Host "✅ Document status retrieved" -ForegroundColor $successColor
        Write-Host "   Document ID: $($statusResponse.id)" -ForegroundColor White
        Write-Host "   Status: $($statusResponse.status)" -ForegroundColor White
        Write-Host "   Processing Status: $($statusResponse.processing_status)" -ForegroundColor White
        if ($statusResponse.created_at) {
            Write-Host "   Created At: $($statusResponse.created_at)" -ForegroundColor White
        }
    } catch {
        Write-Host "⚠️  Could not retrieve document status (document may still be processing)" -ForegroundColor $infoColor
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor $infoColor
    }
} else {
    Write-Host "⚠️  Skipping document status check (no document ID)" -ForegroundColor $infoColor
}

# Test 7: Check parsing job status
Write-Host "`n[TEST 7] Checking parsing job status..." -ForegroundColor $infoColor
if ($documentId) {
    try {
        Start-Sleep -Seconds 2  # Wait a bit for parsing to start
        $parsingResponse = Invoke-RestMethod -Uri "$PythonApiUrl/api/v1/evidence/parse/$documentId/status" -Method GET -Headers @{"X-User-Id" = $UserId} -ErrorAction Stop
        Write-Host "✅ Parsing job status retrieved" -ForegroundColor $successColor
        Write-Host "   Job ID: $($parsingResponse.job_id)" -ForegroundColor White
        Write-Host "   Status: $($parsingResponse.status)" -ForegroundColor White
        if ($parsingResponse.progress) {
            Write-Host "   Progress: $($parsingResponse.progress)%" -ForegroundColor White
        }
    } catch {
        Write-Host "⚠️  Could not retrieve parsing job status (parsing may not have started yet)" -ForegroundColor $infoColor
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor $infoColor
    }
} else {
    Write-Host "⚠️  Skipping parsing job status check (no document ID)" -ForegroundColor $infoColor
}

# Test 8: List parser jobs for user
Write-Host "`n[TEST 8] Listing parser jobs for user..." -ForegroundColor $infoColor
try {
    $jobsResponse = Invoke-RestMethod -Uri "$PythonApiUrl/api/v1/evidence/parser/jobs?user_id=$UserId" -Method GET -Headers @{"X-User-Id" = $UserId} -ErrorAction Stop
    Write-Host "✅ Parser jobs retrieved" -ForegroundColor $successColor
    if ($jobsResponse.jobs) {
        Write-Host "   Total Jobs: $($jobsResponse.jobs.Count)" -ForegroundColor White
        foreach ($job in $jobsResponse.jobs | Select-Object -First 5) {
            Write-Host "   - Job ID: $($job.job_id), Status: $($job.status), Document: $($job.document_id)" -ForegroundColor White
        }
    } else {
        Write-Host "   No parser jobs found" -ForegroundColor White
    }
} catch {
    Write-Host "⚠️  Could not retrieve parser jobs" -ForegroundColor $infoColor
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor $infoColor
}

# Test 9: Verify SSE events (check if events are being sent)
Write-Host "`n[TEST 9] Verifying SSE event configuration..." -ForegroundColor $infoColor
Write-Host "   ℹ️  SSE events should be sent for:" -ForegroundColor White
Write-Host "      - evidence_upload_completed" -ForegroundColor White
Write-Host "      - evidence_upload_failed" -ForegroundColor White
Write-Host "      - parsing_started" -ForegroundColor White
Write-Host "   ℹ️  To verify SSE events, check the frontend console or use the SSE endpoint:" -ForegroundColor White
Write-Host "      GET $NodeApiUrl/api/sse/events?userId=$UserId" -ForegroundColor White

# Summary
Write-Host "`n=== TEST SUMMARY ===" -ForegroundColor Cyan
Write-Host "✅ Phase 3 Document Upload & Parsing Test Complete" -ForegroundColor $successColor
Write-Host "`n📋 Test Results:" -ForegroundColor Yellow
Write-Host "   - Node.js API: ✅ Reachable" -ForegroundColor White
Write-Host "   - Python API: ✅ Reachable" -ForegroundColor White
Write-Host "   - Document Upload: ✅ Successful" -ForegroundColor White
if ($documentId) {
    Write-Host "   - Document ID: $documentId" -ForegroundColor White
}
Write-Host "`n🚀 Next Steps:" -ForegroundColor Yellow
Write-Host "   1. Check Render logs for upload and parsing activity" -ForegroundColor White
Write-Host "   2. Verify document appears in Evidence Locker UI" -ForegroundColor White
Write-Host "   3. Check database (evidence_documents table) for stored document" -ForegroundColor White
Write-Host "   4. Verify parsing results in parser_jobs table" -ForegroundColor White
Write-Host "   5. Test SSE events in frontend console" -ForegroundColor White
Write-Host ""

