# 🎨 Phase 4: Frontend Integration Guide

## ✅ All Endpoints Are Ready!

All Phase 4 evidence ingestion endpoints are **live and ready** to be wired into the frontend.

## 🚀 **IMPORTANT: Unified Orchestrator Available!**

**⚠️ CRITICAL FOR FE TEAM:** We have a **unified orchestrator** that ingests from **ALL connected sources at once** in parallel!

### **Use This Endpoint:**
```typescript
POST /api/evidence/ingest/all
```

**Why use this instead of individual endpoints?**
- ✅ **One API call** instead of 4 separate calls
- ✅ **Parallel processing** - all sources ingest simultaneously (faster!)
- ✅ **Unified results** - aggregated totals + breakdown by provider
- ✅ **Better UX** - single "Ingest All" button instead of 4 buttons
- ✅ **Error handling** - if one source fails, others continue

**This is the recommended approach for the main ingestion flow!**

---

## 🔧 **How The Unified Orchestrator Works (Technical Details)**

### **Architecture Overview**

The unified orchestrator (`unifiedIngestionService.ts`) is a smart service that coordinates ingestion from multiple evidence sources simultaneously.

### **Step-by-Step Process:**

1. **Discovery Phase**
   - Queries `evidence_sources` table for all connected sources
   - Filters by `status = 'connected'`
   - Optionally filters by specific providers if `providers` array is provided
   - Returns list of active sources (Gmail, Outlook, Google Drive, Dropbox)

2. **Parallel Processing**
   - Creates ingestion promises for **each connected source simultaneously**
   - Uses `Promise.allSettled()` to run all sources **in parallel** (not sequential!)
   - All sources process at the same time - much faster than calling them one by one

3. **Result Aggregation**
   - Collects results from all sources (even if some fail)
   - Aggregates totals:
     - `totalDocumentsIngested` = sum of all `documentsIngested` from all sources
     - `totalItemsProcessed` = sum of all `emailsProcessed`/`filesProcessed` from all sources
   - Creates breakdown object with per-provider results
   - Collects all errors and tags them with provider name (e.g., `[gmail] Error message`)

4. **Error Handling**
   - Uses `Promise.allSettled()` instead of `Promise.all()` - this means:
     - If one source fails, **others continue processing**
     - You get **partial success** - successful sources return results even if others fail
     - Errors are collected and tagged, not thrown
   - Each provider's errors are included in the `errors` array with provider prefix

5. **Response Format**
   - Returns unified result with:
     - Overall success status (true if no errors, false if any errors)
     - Aggregated totals
     - Per-provider breakdown in `results` object
     - All errors (tagged by provider)

### **Code Flow Example:**

```typescript
// Backend (unifiedIngestionService.ts)
async ingestFromAllSources(userId, options) {
  // 1. Get connected sources
  const connectedSources = await getConnectedSources(userId, options.providers);
  // Returns: [{ provider: 'gmail' }, { provider: 'outlook' }, ...]

  // 2. Create parallel promises
  const ingestionPromises = connectedSources.map(source => 
    ingestFromSource(userId, source.provider, options)
  );
  // Creates: [gmailPromise, outlookPromise, gdrivePromise, dropboxPromise]

  // 3. Execute ALL in parallel
  const results = await Promise.allSettled(ingestionPromises);
  // All 4 sources process simultaneously!

  // 4. Aggregate results
  results.forEach((result, index) => {
    const provider = connectedSources[index].provider;
    if (result.status === 'fulfilled') {
      // Success - add to totals and breakdown
      totalDocumentsIngested += result.value.documentsIngested;
      results[provider] = result.value;
    } else {
      // Failed - collect error but continue
      errors.push(`[${provider}] ${result.reason}`);
    }
  });

  // 5. Return unified result
  return {
    success: errors.length === 0,
    totalDocumentsIngested,
    totalItemsProcessed,
    errors,
    results: { gmail, outlook, gdrive, dropbox }
  };
}
```

### **Performance Benefits:**

- **Sequential (Individual Endpoints):**
  - Gmail: 5 seconds
  - Outlook: 4 seconds
  - Google Drive: 6 seconds
  - Dropbox: 3 seconds
  - **Total: 18 seconds** ⏱️

- **Parallel (Unified Orchestrator):**
  - All sources: 6 seconds (longest one)
  - **Total: 6 seconds** ⚡
  - **3x faster!**

### **Error Resilience:**

If Gmail fails but others succeed:
```json
{
  "success": false,  // Overall false because Gmail failed
  "totalDocumentsIngested": 10,  // From Outlook + GDrive + Dropbox
  "totalItemsProcessed": 30,
  "errors": ["[gmail] No access token found"],
  "results": {
    "outlook": { "success": true, "documentsIngested": 3, ... },
    "gdrive": { "success": true, "documentsIngested": 4, ... },
    "dropbox": { "success": true, "documentsIngested": 3, ... }
    // gmail not included because it failed
  }
}
```

**Key Point:** You still get results from successful sources even if one fails!

---

## 📡 Available API Endpoints

### **1. Evidence Ingestion Endpoints**

#### **Gmail Ingestion** (Already exists, enhanced)
```typescript
POST /api/evidence/ingest/gmail
Body: {
  query?: string;           // Optional: Gmail search query
  maxResults?: number;     // Optional: Max emails to process (default: 50)
  autoParse?: boolean;     // Optional: Auto-trigger parsing (default: true)
}

Response: {
  success: boolean;
  documentsIngested: number;
  emailsProcessed: number;
  errors: string[];
  message: string;
}
```

#### **Outlook Ingestion** (NEW ✨)
```typescript
POST /api/evidence/ingest/outlook
Body: {
  query?: string;           // Optional: Outlook search query
  maxResults?: number;     // Optional: Max emails to process (default: 50)
  autoParse?: boolean;     // Optional: Auto-trigger parsing (default: true)
}

Response: {
  success: boolean;
  documentsIngested: number;
  emailsProcessed: number;
  errors: string[];
  message: string;
}
```

#### **Google Drive Ingestion** (NEW ✨)
```typescript
POST /api/evidence/ingest/gdrive
Body: {
  query?: string;           // Optional: Drive search query
  maxResults?: number;     // Optional: Max files to process (default: 50)
  autoParse?: boolean;     // Optional: Auto-trigger parsing (default: true)
  folderId?: string;       // Optional: Specific folder ID to ingest from
}

Response: {
  success: boolean;
  documentsIngested: number;
  filesProcessed: number;
  errors: string[];
  message: string;
}
```

#### **Dropbox Ingestion** (NEW ✨)
```typescript
POST /api/evidence/ingest/dropbox
Body: {
  query?: string;           // Optional: Dropbox search query
  maxResults?: number;     // Optional: Max files to process (default: 50)
  autoParse?: boolean;     // Optional: Auto-trigger parsing (default: true)
  folderPath?: string;     // Optional: Specific folder path to ingest from
}

Response: {
  success: boolean;
  documentsIngested: number;
  filesProcessed: number;
  errors: string[];
  message: string;
}
```

#### **Unified Ingestion** (NEW ✨) - **RECOMMENDED: Use This!**
**🚀 This is the MAIN endpoint you should use!**

Ingests from **ALL connected sources simultaneously in parallel**. Much faster and better UX than calling individual endpoints.

```typescript
POST /api/evidence/ingest/all
Body: {
  providers?: string[];     // Optional: ['gmail', 'outlook', 'gdrive', 'dropbox'] - if not provided, uses all connected
  query?: string;           // Optional: Search query (applied to all providers)
  maxResults?: number;     // Optional: Max items per provider (default: 50)
  autoParse?: boolean;     // Optional: Auto-trigger parsing (default: true)
  folderId?: string;       // Optional: Google Drive folder ID
  folderPath?: string;     // Optional: Dropbox folder path
}

Response: {
  success: boolean;
  totalDocumentsIngested: number;        // Sum of all sources
  totalItemsProcessed: number;           // Sum of all sources
  errors: string[];                      // All errors (tagged with provider)
  results: {
    gmail?: { 
      success: boolean;
      documentsIngested: number; 
      emailsProcessed: number; 
      errors: string[] 
    };
    outlook?: { 
      success: boolean;
      documentsIngested: number; 
      emailsProcessed: number; 
      errors: string[] 
    };
    gdrive?: { 
      success: boolean;
      documentsIngested: number; 
      filesProcessed: number; 
      errors: string[] 
    };
    dropbox?: { 
      success: boolean;
      documentsIngested: number; 
      filesProcessed: number; 
      errors: string[] 
    };
  };
  message: string;
}
```

**How it works:**
1. Automatically finds all connected sources (Gmail, Outlook, Google Drive, Dropbox)
2. Processes them **in parallel** using `Promise.allSettled()` (all at once, not sequential!)
3. Aggregates results from all sources
4. Returns unified totals + breakdown by provider
5. If one source fails, others continue (graceful error handling)

**Example Response:**
```json
{
  "success": true,
  "totalDocumentsIngested": 15,
  "totalItemsProcessed": 42,
  "errors": [],
  "results": {
    "gmail": {
      "success": true,
      "documentsIngested": 5,
      "emailsProcessed": 12,
      "errors": []
    },
    "outlook": {
      "success": true,
      "documentsIngested": 3,
      "emailsProcessed": 8,
      "errors": []
    },
    "gdrive": {
      "success": true,
      "documentsIngested": 4,
      "filesProcessed": 15,
      "errors": []
    },
    "dropbox": {
      "success": true,
      "documentsIngested": 3,
      "filesProcessed": 7,
      "errors": []
    }
  },
  "message": "Ingested 15 documents from 42 items across all sources"
}
```

---

### **2. Evidence Source Management Endpoints**

#### **List All Connected Sources**
```typescript
GET /api/evidence/sources

Response: {
  success: boolean;
  sources: Array<{
    id: string;
    provider: 'gmail' | 'outlook' | 'gdrive' | 'dropbox';
    account_email: string;
    status: 'connected' | 'disconnected' | 'error';
    last_sync_at: string | null;
    created_at: string;
    metadata: Record<string, any>;
  }>;
  count: number;
}
```

#### **Get Source Details**
```typescript
GET /api/evidence/sources/:id

Response: {
  success: boolean;
  source: {
    id: string;
    provider: string;
    account_email: string;
    status: string;
    // ... all source fields
  };
}
```

#### **Check Source Status**
```typescript
GET /api/evidence/sources/:id/status

Response: {
  success: boolean;
  status: {
    connected: boolean;
    status: string;
    lastSync: string | null;
    hasToken: boolean;
    provider: string;
  };
}
```

#### **Disconnect Source**
```typescript
DELETE /api/evidence/sources/:id

Response: {
  success: boolean;
  message: string;
  source: {
    id: string;
    provider: string;
    status: 'disconnected';
  };
}
```

---

## 🎨 Frontend Implementation Examples

### **React/TypeScript Example**

```typescript
// services/evidenceIngestionService.ts
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export interface IngestionOptions {
  query?: string;
  maxResults?: number;
  autoParse?: boolean;
  folderId?: string;      // For Google Drive
  folderPath?: string;    // For Dropbox
}

export interface IngestionResult {
  success: boolean;
  documentsIngested: number;
  emailsProcessed?: number;
  filesProcessed?: number;
  errors: string[];
  message: string;
}

export interface UnifiedIngestionResult extends IngestionResult {
  totalDocumentsIngested: number;
  totalItemsProcessed: number;
  results: {
    gmail?: IngestionResult;
    outlook?: IngestionResult;
    gdrive?: IngestionResult;
    dropbox?: IngestionResult;
  };
}

export const evidenceIngestionService = {
  // Gmail
  async ingestGmail(options: IngestionOptions = {}): Promise<IngestionResult> {
    const response = await axios.post(`${API_BASE}/api/evidence/ingest/gmail`, options);
    return response.data;
  },

  // Outlook
  async ingestOutlook(options: IngestionOptions = {}): Promise<IngestionResult> {
    const response = await axios.post(`${API_BASE}/api/evidence/ingest/outlook`, options);
    return response.data;
  },

  // Google Drive
  async ingestGoogleDrive(options: IngestionOptions = {}): Promise<IngestionResult> {
    const response = await axios.post(`${API_BASE}/api/evidence/ingest/gdrive`, options);
    return response.data;
  },

  // Dropbox
  async ingestDropbox(options: IngestionOptions = {}): Promise<IngestionResult> {
    const response = await axios.post(`${API_BASE}/api/evidence/ingest/dropbox`, options);
    return response.data;
  },

  // Unified - Ingest from all sources (RECOMMENDED - Use this!)
  // This processes all connected sources in parallel - much faster!
  async ingestAll(options: IngestionOptions & { providers?: string[] } = {}): Promise<UnifiedIngestionResult> {
    const response = await axios.post(`${API_BASE}/api/evidence/ingest/all`, options);
    return response.data;
  },

  // Source Management
  async getSources() {
    const response = await axios.get(`${API_BASE}/api/evidence/sources`);
    return response.data;
  },

  async getSource(id: string) {
    const response = await axios.get(`${API_BASE}/api/evidence/sources/${id}`);
    return response.data;
  },

  async getSourceStatus(id: string) {
    const response = await axios.get(`${API_BASE}/api/evidence/sources/${id}/status`);
    return response.data;
  },

  async disconnectSource(id: string) {
    const response = await axios.delete(`${API_BASE}/api/evidence/sources/${id}`);
    return response.data;
  }
};
```

### **React Component Example**

```typescript
// components/EvidenceIngestion.tsx
import React, { useState, useEffect } from 'react';
import { evidenceIngestionService } from '../services/evidenceIngestionService';

export const EvidenceIngestion: React.FC = () => {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Load connected sources on mount
  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    try {
      const response = await evidenceIngestionService.getSources();
      setSources(response.sources || []);
    } catch (error) {
      console.error('Failed to load sources:', error);
    }
  };

  // 🚀 RECOMMENDED: Use this for main ingestion flow
  // This calls the unified orchestrator which processes ALL sources in parallel
  const handleIngestAll = async () => {
    setLoading(true);
    setResult(null);
    try {
      // Single API call - ingests from ALL connected sources simultaneously!
      const result = await evidenceIngestionService.ingestAll({
        maxResults: 50,
        autoParse: true
        // Optional: providers: ['gmail', 'outlook'] to filter specific sources
      });
      setResult(result);
      // Reload sources to update last_sync_at
      await loadSources();
    } catch (error) {
      console.error('Ingestion failed:', error);
      setResult({ success: false, errors: [error.message] });
    } finally {
      setLoading(false);
    }
  };

  const handleIngestProvider = async (provider: string) => {
    setLoading(true);
    setResult(null);
    try {
      let result;
      switch (provider) {
        case 'gmail':
          result = await evidenceIngestionService.ingestGmail({ maxResults: 50 });
          break;
        case 'outlook':
          result = await evidenceIngestionService.ingestOutlook({ maxResults: 50 });
          break;
        case 'gdrive':
          result = await evidenceIngestionService.ingestGoogleDrive({ maxResults: 50 });
          break;
        case 'dropbox':
          result = await evidenceIngestionService.ingestDropbox({ maxResults: 50 });
          break;
      }
      setResult(result);
      await loadSources();
    } catch (error) {
      console.error('Ingestion failed:', error);
      setResult({ success: false, errors: [error.message] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="evidence-ingestion">
      <h2>Evidence Ingestion</h2>

      {/* Connected Sources */}
      <div className="sources-list">
        <h3>Connected Sources</h3>
        {sources.length === 0 ? (
          <p>No sources connected. Connect sources via OAuth first.</p>
        ) : (
          <ul>
            {sources.map((source) => (
              <li key={source.id}>
                <strong>{source.provider}</strong>: {source.account_email}
                <span className={`status ${source.status}`}>{source.status}</span>
                <button onClick={() => handleIngestProvider(source.provider)}>
                  Ingest Now
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 🚀 RECOMMENDED: Unified Ingestion Button */}
      {/* This uses the unified orchestrator - processes all sources in parallel */}
      <button 
        onClick={handleIngestAll} 
        disabled={loading || sources.length === 0}
        className="btn-primary"
      >
        {loading ? 'Ingesting from All Sources...' : '🚀 Ingest from All Sources (Unified)'}
      </button>
      <p className="help-text">
        Uses unified orchestrator - processes all connected sources simultaneously in parallel
      </p>

      {/* Results */}
      {result && (
        <div className={`result ${result.success ? 'success' : 'error'}`}>
          <h4>{result.success ? '✅ Success' : '❌ Error'}</h4>
          {result.totalDocumentsIngested !== undefined ? (
            <>
              <p>Total Documents: {result.totalDocumentsIngested}</p>
              <p>Total Items Processed: {result.totalItemsProcessed}</p>
              {result.results && (
                <div>
                  {Object.entries(result.results).map(([provider, providerResult]) => (
                    <p key={provider}>
                      {provider}: {providerResult.documentsIngested} documents
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p>Documents Ingested: {result.documentsIngested}</p>
              <p>Items Processed: {result.emailsProcessed || result.filesProcessed}</p>
            </>
          )}
          {result.errors && result.errors.length > 0 && (
            <div className="errors">
              <strong>Errors:</strong>
              <ul>
                {result.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

---

## 🔔 Real-time Updates (SSE)

The backend sends SSE events for ingestion progress. Connect to SSE in your frontend:

```typescript
// Connect to SSE for real-time updates
const eventSource = new EventSource(`${API_BASE}/api/sse?userId=${userId}`);

eventSource.addEventListener('evidence_ingestion_started', (event) => {
  const data = JSON.parse(event.data);
  console.log('Ingestion started:', data);
  // Update UI: Show loading indicator
});

eventSource.addEventListener('evidence_ingestion_completed', (event) => {
  const data = JSON.parse(event.data);
  console.log('Ingestion completed:', data);
  // Update UI: Show success, update counts
});

eventSource.addEventListener('evidence_ingestion_failed', (event) => {
  const data = JSON.parse(event.data);
  console.log('Ingestion failed:', data);
  // Update UI: Show error message
});
```

---

## 🎯 UI Components to Build

### **1. Evidence Sources List**
- Show all connected sources (Gmail, Outlook, Google Drive, Dropbox)
- Display connection status
- Show last sync time
- "Ingest Now" button per source (optional - for individual ingestion)
- "Disconnect" button

### **2. Unified Ingestion Button** ⭐ **PRIMARY BUTTON**
**🚀 This should be the MAIN ingestion button!**

- **"Ingest from All Sources"** button (prominent, primary action)
- Uses `POST /api/evidence/ingest/all` endpoint
- Shows progress indicator during ingestion
- Displays aggregated results:
  - Total documents ingested (sum of all sources)
  - Total items processed (sum of all sources)
  - Breakdown by provider (Gmail: X, Outlook: Y, etc.)
  - Error messages (if any, tagged by provider)
- Real-time updates via SSE
- Much faster than individual ingestion (parallel processing)

### **3. Ingestion Results Display**
- Total documents ingested
- Breakdown by provider
- Error messages (if any)
- Success/error indicators

### **4. Source Connection Status**
- Connection status indicator
- Token validity check
- Last sync timestamp
- Reconnect option

---

## ✅ Ready to Wire!

**All endpoints are live and ready.** You can start wiring them into your frontend immediately!

## 🎯 **Recommended Implementation Strategy**

### **Primary Flow (Use This!):**
1. **Main Button:** "Ingest from All Sources" 
   - Uses `POST /api/evidence/ingest/all`
   - Processes all connected sources in parallel
   - Shows unified results with breakdown

### **Secondary Flow (Optional):**
2. **Individual Buttons:** Per-source ingestion buttons
   - Uses individual endpoints (`/ingest/gmail`, `/ingest/outlook`, etc.)
   - For users who want to ingest from specific sources only

### **Quick Start:**
1. Create `evidenceIngestionService.ts` (copy the example above)
2. Create `EvidenceIngestion.tsx` component (copy the example above)
3. **Make the unified ingestion button PRIMARY** (big, prominent)
4. Add individual source buttons as secondary (smaller, optional)
5. Add the component to your Evidence Locker or Integrations page
6. Test with connected OAuth sources

**That's it!** 🚀

## ⚠️ **Important Notes for FE Team:**

1. **Use `/api/evidence/ingest/all` as the primary ingestion method** - it's faster and provides better UX
2. **The unified orchestrator processes sources in parallel** - don't call individual endpoints sequentially, use the unified one!
3. **Results include breakdown by provider** - you can show both total and per-provider stats
4. **Error handling is graceful** - if one source fails, others continue and you get partial results
5. **SSE events are sent** - listen for `evidence_ingestion_started` and `evidence_ingestion_completed` for real-time updates

