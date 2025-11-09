# Phase 3: Document Upload & Parsing Test Guide

## 🎯 Goal

Verify that the full document ingestion flow works end-to-end:
1. **Upload** → Frontend → Node.js → Python → Database
2. **Parsing** → Automatically triggered after upload
3. **SSE Events** → Real-time updates sent to frontend
4. **UI Display** → Document metadata and parsing results appear in Evidence Locker

---

## 🧪 Test Plan

### Step 1: Backend API Verification

#### 1.1 Test Node.js API Health
```powershell
curl https://opside-node-api-woco.onrender.com/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-09T..."
}
```

#### 1.2 Test Python API Health
```powershell
curl https://python-api-newest.onrender.com/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

---

### Step 2: Document Upload Testing

#### 2.1 Upload via Node.js Endpoint (`/api/evidence/upload`)

**Endpoint:** `POST /api/evidence/upload`

**Headers:**
- `X-User-Id: test-user-phase3-{timestamp}`
- `Content-Type: multipart/form-data`

**Request Body:**
- Field name: `file` (singular, for multiple files)
- Files: PDF, image, or text document

**PowerShell Test:**
```powershell
# Create test file
"Test Document" | Out-File -FilePath test-doc.pdf -Encoding UTF8

# Upload via Node.js endpoint
$fileBytes = [System.IO.File]::ReadAllBytes("test-doc.pdf")
$boundary = [System.Guid]::NewGuid().ToString()
$body = @"
--$boundary
Content-Disposition: form-data; name="file"; filename="test-doc.pdf"
Content-Type: application/pdf

$([System.Text.Encoding]::UTF8.GetString($fileBytes))
--$boundary--
"@

Invoke-RestMethod -Uri "https://opside-node-api-woco.onrender.com/api/evidence/upload" `
  -Method POST `
  -Headers @{
    "X-User-Id" = "test-user-phase3"
    "Content-Type" = "multipart/form-data; boundary=$boundary"
  } `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

**Expected Response:**
```json
{
  "id": "doc-123",
  "status": "uploaded",
  "uploaded_at": "2025-11-09T...",
  "message": "Documents uploaded successfully (1 files)",
  "processing_status": "processing"
}
```

#### 2.2 Upload via Proxy Endpoint (`/api/documents/upload`)

**Endpoint:** `POST /api/documents/upload`

**Same request format as above**, but using the proxy endpoint.

**Expected Response:** Same as above.

---

### Step 3: Verify Document Storage

#### 3.1 Check Document in Database

**Endpoint:** `GET /api/documents/{document_id}`

**PowerShell Test:**
```powershell
$documentId = "doc-123"  # From upload response
Invoke-RestMethod -Uri "https://python-api-newest.onrender.com/api/documents/$documentId" `
  -Method GET `
  -Headers @{"X-User-Id" = "test-user-phase3"}
```

**Expected Response:**
```json
{
  "id": "doc-123",
  "user_id": "test-user-phase3",
  "provider": "manual_upload",
  "filename": "test-doc.pdf",
  "content_type": "application/pdf",
  "size_bytes": 1234,
  "processing_status": "processing",
  "created_at": "2025-11-09T...",
  "metadata": {
    "claim_id": null,
    "upload_method": "manual",
    "original_filename": "test-doc.pdf"
  }
}
```

---

### Step 4: Verify Parsing Trigger

#### 4.1 Check Parsing Job Status

**Endpoint:** `GET /api/v1/evidence/parse/{document_id}/status`

**PowerShell Test:**
```powershell
$documentId = "doc-123"
Invoke-RestMethod -Uri "https://python-api-newest.onrender.com/api/v1/evidence/parse/$documentId/status" `
  -Method GET `
  -Headers @{"X-User-Id" = "test-user-phase3"}
```

**Expected Response:**
```json
{
  "job_id": "job-456",
  "document_id": "doc-123",
  "status": "processing",
  "progress": 50,
  "created_at": "2025-11-09T...",
  "updated_at": "2025-11-09T..."
}
```

#### 4.2 List Parser Jobs

**Endpoint:** `GET /api/v1/evidence/parser/jobs?user_id={user_id}`

**PowerShell Test:**
```powershell
Invoke-RestMethod -Uri "https://python-api-newest.onrender.com/api/v1/evidence/parser/jobs?user_id=test-user-phase3" `
  -Method GET `
  -Headers @{"X-User-Id" = "test-user-phase3"}
```

**Expected Response:**
```json
{
  "jobs": [
    {
      "job_id": "job-456",
      "document_id": "doc-123",
      "status": "completed",
      "progress": 100,
      "created_at": "2025-11-09T...",
      "updated_at": "2025-11-09T..."
    }
  ],
  "total": 1
}
```

---

### Step 5: Verify SSE Events

#### 5.1 Check SSE Endpoint

**Endpoint:** `GET /api/sse/events?userId={user_id}`

**PowerShell Test:**
```powershell
# SSE events are sent in real-time, so check frontend console or logs
# Or use the SSE endpoint to verify events are being sent
Invoke-WebRequest -Uri "https://opside-node-api-woco.onrender.com/api/sse/events?userId=test-user-phase3" `
  -Method GET `
  -Headers @{"Accept" = "text/event-stream"}
```

**Expected Events:**
- `evidence_upload_completed` - When upload succeeds
- `evidence_upload_failed` - When upload fails
- `parsing_started` - When parsing begins
- `parsing_completed` - When parsing finishes

---

### Step 6: Frontend UI Verification

#### 6.1 Navigate to Evidence Locker

1. Go to your frontend (Vercel) app
2. Log in
3. Open the **Evidence Locker** section

#### 6.2 Upload Document via UI

1. Click **"Upload Document"** button
2. Select a file (PDF, image, or text)
3. Click **"Upload"**

#### 6.3 Verify Upload Progress

- Upload progress bar should appear
- Confirmation message/toast should show
- Document should appear in the document list

#### 6.4 Verify Parsing Status

- Document status should show "Processing" → "Completed"
- Parsing results should appear (if available)
- Metadata should be displayed (filename, size, date, etc.)

---

## ✅ Success Criteria

### Backend Tests
- [x] Node.js API is reachable
- [x] Python API is reachable
- [x] Document upload succeeds (both endpoints)
- [x] Document is stored in database
- [x] Parsing job is triggered automatically
- [x] Parsing job status can be retrieved
- [x] SSE events are sent (check logs)

### Frontend Tests
- [x] Upload button works
- [x] File selection works
- [x] Upload progress is shown
- [x] Confirmation message appears
- [x] Document appears in Evidence Locker
- [x] Parsing status updates in real-time
- [x] SSE events are received (check console)

---

## 🐛 Troubleshooting

### Issue: Upload Fails with 401 Unauthorized

**Solution:**
- Ensure `X-User-Id` header is set
- Check if authentication token is required
- Verify user ID is valid

### Issue: Upload Fails with 400 Bad Request

**Solution:**
- Check file format (should be PDF, image, or text)
- Verify `file` field name is used (singular)
- Check file size (max 50MB)

### Issue: Parsing Doesn't Start

**Solution:**
- Check Python API logs for errors
- Verify `BackgroundTasks` is working
- Check database for document record
- Verify parsing endpoint is accessible

### Issue: SSE Events Not Received

**Solution:**
- Check SSE endpoint is accessible
- Verify user ID matches
- Check frontend SSE connection
- Review Render logs for SSE events

### Issue: Document Doesn't Appear in UI

**Solution:**
- Check database for document record
- Verify user ID matches
- Check frontend API calls
- Review browser console for errors

---

## 📊 Test Results Template

```
Test Date: ___________
Tester: ___________
Environment: Production / Staging

Backend Tests:
- Node.js API: ✅ / ❌
- Python API: ✅ / ❌
- Document Upload: ✅ / ❌
- Document Storage: ✅ / ❌
- Parsing Trigger: ✅ / ❌
- SSE Events: ✅ / ❌

Frontend Tests:
- Upload UI: ✅ / ❌
- Upload Progress: ✅ / ❌
- Document Display: ✅ / ❌
- Parsing Status: ✅ / ❌
- SSE Events: ✅ / ❌

Issues Found:
1. ___________
2. ___________

Notes:
___________
```

---

## 🚀 Next Steps

After successful Phase 3 testing:

1. **Document Results** - Record test results and any issues
2. **Fix Issues** - Address any bugs or problems found
3. **Optimize Performance** - Improve upload speed and parsing time
4. **Phase 4 Preparation** - Begin planning Evidence Analysis Layer

---

## 📝 Automated Test Script

Run the automated test script:

```powershell
.\test-phase3-document-upload.ps1
```

This script will:
- Test all backend endpoints
- Verify document upload
- Check parsing status
- List parser jobs
- Verify SSE events

---

## 🔗 Related Documentation

- [Document Upload Fix Implementation](./DOCUMENT_UPLOAD_FIX_IMPLEMENTATION.md)
- [Phase 3 Backend Implementation](./PHASE3_BACKEND_IMPLEMENTATION_COMPLETE.md)
- [Evidence Sources Backend Endpoints](./EVIDENCE_SOURCES_BACKEND_ENDPOINTS.md)

