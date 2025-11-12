# 📄 Phase 4: Evidence Ingestion - The Paper Trail Without the Paper

## 🎯 Phase 4 Definition

**Evidence Ingestion - The Paper Trail Without the Paper**

- **Connects to**: Gmail, Outlook, Google Drive, Dropbox
- **Securely ingests**: Invoices, receipts, shipping docs
- **Metadata-first approach**: No raw PDF scanning unless needed
- **User Experience**: No digging, no uploading → Clario already "has the receipts"

---

## ✅ What We Already Have

### 1. **Gmail Integration** ✅ **COMPLETE**

**OAuth & Connection:**
- ✅ `evidenceSourcesController.ts` - OAuth flow for Gmail
- ✅ `gmailController.ts` - Gmail OAuth initiation and callback
- ✅ `gmailRoutes.ts` - Gmail API routes
- ✅ Token storage in `tokenManager`

**Ingestion Service:**
- ✅ `gmailIngestionService.ts` - **Full implementation**
  - Fetches emails with attachments
  - Extracts attachments from emails
  - Searches for invoices/receipts/FBA reports
  - Stores documents in database
  - Triggers automatic parsing
  - SSE real-time updates

**Routes:**
- ✅ `POST /api/evidence/ingest/gmail` - Trigger Gmail ingestion
- ✅ `GET /api/v1/integrations/gmail/auth` - OAuth initiation
- ✅ `GET /api/v1/integrations/gmail/callback` - OAuth callback
- ✅ `GET /api/v1/integrations/gmail/status` - Connection status

**Status**: ✅ **100% Complete** - Ready for production

---

### 2. **Outlook Integration** ⚠️ **PARTIAL**

**OAuth & Connection:**
- ✅ `evidenceSourcesController.ts` - OAuth flow for Outlook
  - OAuth URL generation
  - Token exchange
  - Profile fetching
  - Database storage

**Ingestion Service:**
- ❌ **MISSING**: `outlookIngestionService.ts`
  - No service to fetch Outlook emails
  - No service to extract attachments
  - No service to search for invoices/receipts

**Routes:**
- ✅ `POST /api/v1/integrations/outlook/connect` - OAuth initiation
- ✅ `GET /api/v1/integrations/outlook/callback` - OAuth callback
- ❌ **MISSING**: `POST /api/evidence/ingest/outlook` - Ingestion endpoint

**Status**: ⚠️ **30% Complete** - OAuth works, ingestion missing

**What's Needed:**
1. Create `outlookIngestionService.ts` (similar to `gmailIngestionService.ts`)
2. Use Microsoft Graph API to fetch emails
3. Extract attachments from Outlook emails
4. Add `POST /api/evidence/ingest/outlook` route
5. Integrate with evidence ingestion pipeline

---

### 3. **Google Drive Integration** ⚠️ **PARTIAL**

**OAuth & Connection:**
- ✅ `evidenceSourcesController.ts` - OAuth flow for Google Drive
  - OAuth URL generation
  - Token exchange
  - Profile fetching
  - Database storage

**Ingestion Service:**
- ❌ **MISSING**: `googleDriveIngestionService.ts`
  - No service to list Google Drive files
  - No service to download files
  - No service to search for invoices/receipts

**Routes:**
- ✅ `POST /api/v1/integrations/gdrive/connect` - OAuth initiation
- ✅ `GET /api/v1/integrations/gdrive/callback` - OAuth callback
- ❌ **MISSING**: `POST /api/evidence/ingest/gdrive` - Ingestion endpoint

**Status**: ⚠️ **30% Complete** - OAuth works, ingestion missing

**What's Needed:**
1. Create `googleDriveIngestionService.ts`
2. Use Google Drive API to list files
3. Search for invoices/receipts by name/metadata
4. Download files (metadata-first, full download only if needed)
5. Add `POST /api/evidence/ingest/gdrive` route
6. Integrate with evidence ingestion pipeline

---

### 4. **Dropbox Integration** ⚠️ **PARTIAL**

**OAuth & Connection:**
- ✅ `evidenceSourcesController.ts` - OAuth flow for Dropbox
  - OAuth URL generation
  - Token exchange
  - Profile fetching
  - Database storage

**Ingestion Service:**
- ❌ **MISSING**: `dropboxIngestionService.ts`
  - No service to list Dropbox files
  - No service to download files
  - No service to search for invoices/receipts

**Routes:**
- ✅ `POST /api/v1/integrations/dropbox/connect` - OAuth initiation
- ✅ `GET /api/v1/integrations/dropbox/callback` - OAuth callback
- ❌ **MISSING**: `POST /api/evidence/ingest/dropbox` - Ingestion endpoint

**Status**: ⚠️ **30% Complete** - OAuth works, ingestion missing

**What's Needed:**
1. Create `dropboxIngestionService.ts`
2. Use Dropbox API to list files
3. Search for invoices/receipts by name/metadata
4. Download files (metadata-first, full download only if needed)
5. Add `POST /api/evidence/ingest/dropbox` route
6. Integrate with evidence ingestion pipeline

---

## 📊 Overall Phase 4 Status

### ✅ **Complete (25%)**
- Gmail integration (100%)
- OAuth for all providers (100%)

### ⚠️ **Partial (30%)**
- Outlook OAuth (100%), Ingestion (0%)
- Google Drive OAuth (100%), Ingestion (0%)
- Dropbox OAuth (100%), Ingestion (0%)

### ❌ **Missing (45%)**
- Outlook ingestion service
- Google Drive ingestion service
- Dropbox ingestion service
- Unified ingestion orchestration
- Metadata-first optimization

---

## 🚀 Implementation Plan

### **Priority 1: Outlook Ingestion** (Week 1)

**Why**: Many users use Outlook for business email

**Tasks:**
1. Create `outlookIngestionService.ts`
   - Use Microsoft Graph API (`https://graph.microsoft.com/v1.0/me/messages`)
   - Fetch emails with attachments
   - Extract attachments (similar to Gmail)
   - Search for invoices/receipts
   - Store documents in database
   - Trigger automatic parsing

2. Add route to `evidenceRoutes.ts`:
   ```typescript
   POST /api/evidence/ingest/outlook
   ```

3. Test with real Outlook account

**Dependencies:**
- Microsoft Graph API credentials
- Token storage (already handled in OAuth)

---

### **Priority 2: Google Drive Ingestion** (Week 2)

**Why**: Many users store invoices/receipts in Google Drive

**Tasks:**
1. Create `googleDriveIngestionService.ts`
   - Use Google Drive API (`https://www.googleapis.com/drive/v3`)
   - List files in Drive
   - Search for invoices/receipts by name/metadata
   - **Metadata-first**: Get file metadata first, download only if needed
   - Store documents in database
   - Trigger automatic parsing

2. Add route to `evidenceRoutes.ts`:
   ```typescript
   POST /api/evidence/ingest/gdrive
   ```

3. Implement metadata-first optimization:
   - Check file name, MIME type, metadata
   - Only download if it's a relevant document type
   - Skip non-relevant files

**Dependencies:**
- Google Drive API credentials (already have OAuth)
- File metadata extraction

---

### **Priority 3: Dropbox Ingestion** (Week 3)

**Why**: Some users store invoices/receipts in Dropbox

**Tasks:**
1. Create `dropboxIngestionService.ts`
   - Use Dropbox API (`https://api.dropboxapi.com/2`)
   - List files in Dropbox
   - Search for invoices/receipts by name/metadata
   - **Metadata-first**: Get file metadata first, download only if needed
   - Store documents in database
   - Trigger automatic parsing

2. Add route to `evidenceRoutes.ts`:
   ```typescript
   POST /api/evidence/ingest/dropbox
   ```

3. Implement metadata-first optimization

**Dependencies:**
- Dropbox API credentials (already have OAuth)
- File metadata extraction

---

### **Priority 4: Unified Ingestion Orchestration** (Week 4)

**Why**: Users should be able to ingest from all sources at once

**Tasks:**
1. Create `unifiedIngestionService.ts`
   - Orchestrate ingestion from all connected sources
   - Parallel processing
   - Aggregate results
   - Handle errors gracefully

2. Add route:
   ```typescript
   POST /api/evidence/ingest/all
   ```

3. Add ingestion scheduling:
   - Automatic periodic ingestion
   - Configurable schedules
   - Background jobs

---

## 📋 Required Endpoints

### **Evidence Ingestion Endpoints**

```
POST /api/evidence/ingest/gmail       ✅ EXISTS
POST /api/evidence/ingest/outlook     ❌ MISSING
POST /api/evidence/ingest/gdrive      ❌ MISSING
POST /api/evidence/ingest/dropbox     ❌ MISSING
POST /api/evidence/ingest/all         ❌ MISSING (unified)
```

### **Evidence Source Management**

```
GET  /api/evidence/sources            ❌ MISSING (list all connected sources)
GET  /api/evidence/sources/:id        ❌ MISSING (get source details)
DELETE /api/evidence/sources/:id      ❌ MISSING (disconnect source)
GET  /api/evidence/sources/:id/status ❌ MISSING (check connection status)
```

---

## 🔧 Technical Implementation Details

### **Metadata-First Approach**

**Goal**: Minimize API calls and bandwidth by checking metadata before downloading files.

**Implementation:**
1. **List files** with metadata only (name, MIME type, size, modified date)
2. **Filter** by:
   - File name patterns (invoice, receipt, FBA, etc.)
   - MIME types (PDF, images, etc.)
   - File size (reasonable limits)
3. **Download** only relevant files
4. **Store metadata** in database first
5. **Download content** only when needed for parsing

**Benefits:**
- Faster ingestion
- Lower API quota usage
- Better user experience
- Cost-effective

---

### **Unified Service Pattern**

All ingestion services should follow the same pattern:

```typescript
interface IngestionService {
  ingestEvidence(
    userId: string,
    options: {
      query?: string;
      maxResults?: number;
      autoParse?: boolean;
    }
  ): Promise<IngestionResult>;
}

interface IngestionResult {
  success: boolean;
  documentsIngested: number;
  itemsProcessed: number;
  errors: string[];
  jobId?: string;
}
```

---

## 🎯 Success Criteria

### **Phase 4 Complete When:**
- ✅ Gmail ingestion works (already done)
- ✅ Outlook ingestion works
- ✅ Google Drive ingestion works
- ✅ Dropbox ingestion works
- ✅ Metadata-first optimization implemented
- ✅ Unified ingestion orchestration
- ✅ All sources can be connected via OAuth
- ✅ Documents automatically parsed after ingestion
- ✅ Real-time updates via SSE

---

## 📝 Next Steps

1. **Start with Outlook Ingestion** (highest priority)
2. **Then Google Drive** (common storage)
3. **Then Dropbox** (less common but needed)
4. **Finally Unified Orchestration** (polish)

**Ready to start building Outlook ingestion?** 🚀

