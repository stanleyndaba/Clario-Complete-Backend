# Evidence Sources Backend Endpoints - Required Implementation

## 🚨 Issue

The frontend is trying to connect to evidence sources (Gmail, Outlook, Google Drive, Dropbox) but the backend endpoints are returning 404 errors.

## ✅ Frontend Implementation

The frontend is now using:
- **Endpoint**: `POST /api/v1/integrations/{provider}/connect`
- **Providers**: `gmail`, `outlook`, `gdrive`, `dropbox`
- **Parameters**: `redirect_uri` (query parameter)
- **Expected Response**: `{ auth_url: string, redirect_url?: string }`

## 🔌 Required Backend Endpoints

### 1. Connect Evidence Sources
**Endpoint**: `POST /api/v1/integrations/{provider}/connect`

**Providers**: `gmail`, `outlook`, `gdrive`, `dropbox`

**Query Parameters**:
- `redirect_uri` (required): The frontend callback URL

**Request Example**:
```
POST /api/v1/integrations/gmail/connect?redirect_uri=https://your-frontend.vercel.app/auth/callback
```

**Expected Response**:
```json
{
  "auth_url": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "redirect_url": "https://your-frontend.vercel.app/auth/callback"
}
```

**Error Response**:
```json
{
  "error": "Error message",
  "ok": false
}
```

### 2. Get Gmail Status
**Endpoint**: `GET /api/v1/integrations/gmail/status`

**Expected Response**:
```json
{
  "connected": true,
  "lastSync": "2024-01-01T00:00:00Z",
  "email": "user@example.com"
}
```

### 3. Disconnect Gmail
**Endpoint**: `DELETE /api/v1/integrations/gmail/disconnect`

**Expected Response**:
```json
{
  "ok": true,
  "message": "Gmail disconnected successfully"
}
```

### 4. Get Integration Status (with Evidence Providers)
**Endpoint**: `GET /api/v1/integrations/status`

**Expected Response**:
```json
{
  "amazon_connected": true,
  "docs_connected": true,
  "lastSync": "2024-01-01T00:00:00Z",
  "lastIngest": "2024-01-01T00:00:00Z",
  "providerIngest": {
    "gmail": {
      "connected": true,
      "lastIngest": "2024-01-01T00:00:00Z",
      "scopes": ["mail.readonly"]
    },
    "outlook": {
      "connected": false,
      "error": "Connection expired"
    },
    "gdrive": {
      "connected": true,
      "lastIngest": "2024-01-01T00:00:00Z",
      "scopes": ["drive.readonly"]
    },
    "dropbox": {
      "connected": false
    }
  }
}
```

### 5. Evidence Ingestion Endpoints
**Endpoint**: `POST /api/evidence/ingest/gmail`

**Request Body**:
```json
{
  "query": "from:amazon.com has:attachment",
  "maxResults": 50,
  "autoParse": true
}
```

**Expected Response**:
```json
{
  "success": true,
  "documentsIngested": 5,
  "emailsProcessed": 10,
  "errors": [],
  "message": "Ingested 5 documents from 10 emails"
}
```

**Endpoint**: `GET /api/evidence/status`

**Expected Response**:
```json
{
  "hasConnectedSource": true,
  "lastIngestion": "2024-01-01T00:00:00Z",
  "documentsCount": 25,
  "processingCount": 3
}
```

### 6. Evidence Settings Endpoints
**Endpoint**: `POST /api/evidence/auto-collect`

**Request Body**:
```json
{
  "enabled": true
}
```

**Endpoint**: `POST /api/evidence/schedule`

**Request Body**:
```json
{
  "schedule": "daily_0200"
}
```

**Endpoint**: `POST /api/evidence/filters`

**Request Body**:
```json
{
  "includeSenders": ["invoices@"],
  "excludeSenders": [],
  "fileTypes": ["pdf", "png"],
  "folders": ["/Finance"]
}
```

## 🔧 Backend Implementation Notes

### OAuth Flow for Evidence Providers

1. **User clicks "Connect Gmail"**
   - Frontend calls: `POST /api/v1/integrations/gmail/connect?redirect_uri=...`
   - Backend should:
     - Generate OAuth state token
     - Create OAuth authorization URL
     - Return `auth_url` in response

2. **User authorizes in OAuth provider**
   - OAuth provider redirects to: `{redirect_uri}?code=...&state=...`

3. **Backend handles callback**
   - Frontend calls: `GET /api/v1/integrations/gmail/callback?code=...&state=...`
   - Backend should:
     - Exchange code for access token
     - Store token in database (encrypted)
     - Return success response

4. **Frontend refreshes status**
   - Frontend calls: `GET /api/v1/integrations/status`
   - Backend returns updated connection status

### Provider-Specific OAuth Endpoints

Each provider may need different OAuth configurations:

- **Gmail**: Google OAuth 2.0
- **Outlook**: Microsoft OAuth 2.0
- **Google Drive**: Google OAuth 2.0 (same as Gmail, different scopes)
- **Dropbox**: Dropbox OAuth 2.0

### Error Handling

All endpoints should return consistent error responses:

```json
{
  "ok": false,
  "error": "Error message here",
  "status": 404
}
```

## 📝 Current Status

- ✅ Frontend is ready and wired to backend endpoints
- ❌ Backend endpoint `POST /api/v1/integrations/{provider}/connect` may not be implemented
- ❌ Backend may need to implement OAuth flow for evidence providers

## 🚀 Next Steps

1. **Backend Team**: Implement `POST /api/v1/integrations/{provider}/connect` endpoint
2. **Backend Team**: Implement OAuth callback handlers for each provider
3. **Backend Team**: Implement status endpoints for evidence providers
4. **Testing**: Test OAuth flow end-to-end for each provider

## 🔗 Related Documentation

- `PHASE3_FRONTEND_IMPLEMENTATION_GUIDE.md` - Frontend implementation guide
- `PHASE3_GMAIL_INGESTION_IMPLEMENTATION.md` - Gmail ingestion backend details
- `PHASE3_BACKEND_IMPLEMENTATION_COMPLETE.md` - Backend implementation status

