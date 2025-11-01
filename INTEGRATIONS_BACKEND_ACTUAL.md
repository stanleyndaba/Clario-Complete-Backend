# Integrations-Backend - What It Actually Does (From Code)

## 🎯 What It Is

**Integrations-backend** is a Node.js/Express service that handles:
1. **OAuth connections** to Amazon SP-API, Gmail, and Stripe
2. **Data synchronization** from Amazon (claims, inventory, fees)
3. **Evidence collection** from Gmail (emails, attachments)
4. **Background jobs** for syncing and detection

---

## 📍 Endpoints (From `src/index.ts` & Routes)

### **Amazon Integration** (`/api/v1/integrations/amazon` or `/api/integrations/amazon`)
- `GET /auth/start` - Start Amazon OAuth
- `GET /auth/callback` - Handle OAuth callback
- `POST /sync` - Sync Amazon data (claims, inventory, fees)
- `GET /claims` - Get Amazon claims
- `GET /inventory` - Get Amazon inventory
- `GET /fees` - Get Amazon fees (mock)
- `POST /disconnect` - Disconnect Amazon account

### **Gmail Integration** (`/api/v1/integrations/gmail`)
- OAuth endpoints for Gmail connection
- Email fetching and search
- Attachment extraction

### **Stripe Integration** (`/api/v1/integrations/stripe`)
- OAuth endpoints for Stripe Connect
- Account status checking
- Transaction fetching

### **Sync Routes** (`/api/sync`)
- `POST /start` - Start sync job
- `GET /status` - Get sync status
- `GET /history` - Get sync history
- `POST /force` - Force sync

### **Integration Management** (`/api/integrations`)
- `GET /` - Get all integrations
- `GET /:provider/status` - Get integration status
- `POST /:provider/reconnect` - Reconnect integration
- `POST /:provider/disconnect` - Disconnect integration

### **Other Routes**
- `/api/detections` - Detection endpoints
- `/api/disputes` - Dispute management
- `/api/autoclaim` - Auto-claim endpoints
- `/api/internal-events` - Internal event handling
- `/api/stripe-webhook` - Stripe webhook handler
- `/api/sse` - Server-sent events (real-time updates)
- `/api/enhanced-sync` - Enhanced sync features

---

## 🔧 Services (From `src/services/`)

### **amazonService.ts**
- **Real SP-API Integration**: Uses actual Amazon SP-API endpoints
- **Token Management**: Handles OAuth token refresh
- **Data Fetching**: 
  - `fetchClaims()` - Gets Amazon claims/reimbursements
  - `fetchInventory()` - Gets inventory data
  - `fetchFees()` - Gets fee data
- **Sync**: `syncData()` - Orchestrates full data sync

### **gmailService.ts**
- **Gmail OAuth**: Handles Gmail OAuth flow
- **Email Fetching**: Gets emails, searches emails
- **Attachment Extraction**: Downloads attachments from emails

### **stripeService.ts**
- **Stripe OAuth**: Handles Stripe Connect OAuth
- **Account Management**: Gets Stripe account status
- **Transaction Fetching**: Gets Stripe transactions

### **detectionService.ts**
- Detects discrepancies and anomalies
- Processes financial events

### **enhancedDetectionService.ts**
- Enhanced detection algorithms
- Queue-based processing

### **evidenceService.ts**
- Evidence collection and validation
- Document processing

### **disputeService.ts**
- Dispute submission management
- Case tracking

### **financialEventsService.ts**
- Processes Amazon financial events
- Event ingestion

---

## 🏭 Background Jobs (From `src/jobs/`)

### **amazonSyncJob.ts**
- **Purpose**: Periodic sync of Amazon data
- **Does**:
  1. Checks if user has valid Amazon token
  2. Syncs claims → saves to database
  3. Syncs inventory → saves to database
  4. Syncs fees → saves to database
  5. Ingests financial events
  6. Triggers detection job
  7. Sends notifications on errors

### **orchestrationJob.ts**
- Orchestrates multi-step data ingestion
- 5-step process with progress tracking

### **silentStripeOnboardingJob.ts**
- Automatically creates Stripe account after Amazon OAuth
- Background onboarding process

---

## 💾 Database Integration

Uses **Supabase** for:
- Token storage (encrypted OAuth tokens)
- Integration status tracking
- Sync logs
- Claims data
- Inventory data
- Evidence documents
- Case file ledger

---

## 🔐 Security Features

- **JWT Authentication** - All endpoints require JWT tokens
- **Token Encryption** - OAuth tokens encrypted at rest
- **Rate Limiting** - 1000 requests per 15 minutes
- **CORS** - Configured for frontend domains
- **Helmet** - Security headers

---

## 📊 What It Actually Does for Your MVP

1. **Connects Users to Amazon**
   - OAuth flow → Stores tokens
   - Syncs data (claims, inventory, fees)
   - Saves to database

2. **Connects Users to Gmail**
   - OAuth flow → Stores tokens
   - Fetches emails with attachments
   - Extracts evidence documents

3. **Connects Users to Stripe**
   - OAuth flow → Stores tokens
   - Checks account status
   - Fetches transaction history

4. **Background Sync**
   - Runs periodic jobs to sync Amazon data
   - Detects discrepancies
   - Triggers detection pipeline

5. **Real-time Updates**
   - Server-sent events (SSE) for progress tracking
   - WebSocket-like updates

---

## ⚠️ What It Does NOT Do

- **Payment Processing** - That's the Stripe Payments service
- **PDF Generation** - That's the Cost Documentation service
- **ML Prediction** - That's the Refund Engine
- **Evidence Validation** - That's the MCDE service

---

## 🔗 Integration Points

**Integrations-backend sends data to:**
- Refund Engine (claims, discrepancies)
- MCDE (evidence, documents)
- Orchestrator (via API calls)

**Integrations-backend receives from:**
- Orchestrator (sync triggers)
- Frontend (user actions)

---

## ✅ Status: Deployed & Working

**Render URL**: https://clario-complete-backend-mvak.onrender.com

**Health Check**: `GET /health` returns `{ status: 'ok' }`

**Root Endpoint**: `GET /` returns `{ message: 'Opside Integrations API', version: '1.0.0' }`

---

**Bottom Line**: This service is the **OAuth and data sync hub**. It connects users to Amazon/Gmail/Stripe, syncs their data, and feeds it to other services for processing.

