# Agent 10: Notifications Engine — Analysis

**Date:** 2025-01-27  
**Status:** Analysis Complete — Ready for Implementation

---

## 📋 Agent 10 Requirements

1. **WebSocket Push Events**
   - Real-time notifications to connected users
   - Event-driven architecture

2. **Email Notifications**
   - SendGrid/Postmark integration
   - HTML email templates

3. **Events to Handle:**
   - Claim Detected
   - Evidence Found
   - Case Filed
   - Refund Approved
   - Funds Deposited

---

## ✅ What Exists

### 1. **WebSocket Service** (`src/services/websocketService.ts`)

**Status:** ✅ **IMPLEMENTED**

**Features:**
- ✅ Socket.IO server initialization
- ✅ User authentication and room management
- ✅ `sendNotificationToUser()` — Send notifications to specific users
- ✅ `broadcastSyncProgress()` — Broadcast sync progress
- ✅ `emitWorkflowPhaseEvent()` — Emit workflow phase events
- ✅ Connection management

**Key Methods:**
```typescript
sendNotificationToUser(userId: string, notification: {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  data?: any;
}): void

emitWorkflowPhaseEvent(
  userId: string,
  phaseNumber: number,
  event: 'started' | 'completed' | 'failed',
  data?: any
): void
```

**Current Usage:**
- Used by `orchestrationJob.ts` for workflow events
- Used by `detectionService.ts` for claim detection notifications
- Used by `amazonSyncJob.ts` for sync progress

### 2. **Email Service** (`src/notifications/services/delivery/email_service.ts`)

**Status:** ✅ **IMPLEMENTED**

**Features:**
- ✅ SendGrid integration
- ✅ Postmark support (placeholder)
- ✅ Email template generation
- ✅ `sendNotification()` — Send notification via email
- ✅ `sendEmail()` — Send custom email

**Key Methods:**
```typescript
async sendNotification(notification: Notification): Promise<void>
async sendEmail(emailData: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void>
```

**Configuration:**
- `EMAIL_PROVIDER` — 'sendgrid' | 'postmark'
- `EMAIL_API_KEY` — API key for email provider
- `EMAIL_FROM_EMAIL` — From email address
- `EMAIL_FROM_NAME` — From name

### 3. **Notification Service** (`src/notifications/services/notification_service.ts`)

**Status:** ⚠️ **PARTIALLY IMPLEMENTED**

**Features:**
- ✅ `createNotification()` — Create and queue notification
- ✅ `getNotifications()` — Get notifications with filters
- ✅ `markAsRead()` — Mark notification as read
- ✅ `getNotificationStats()` — Get notification statistics
- ✅ Delivery via WebSocket and Email
- ⚠️ **WebSocket service is stubbed** (`NoopWebSocketService`)
- ⚠️ **Worker is stubbed** (`NoopNotificationWorker`)

**Key Methods:**
```typescript
async createNotification(event: NotificationEvent): Promise<Notification>
async deliverNotification(notification: Notification): Promise<void>
```

**Current Issue:**
- WebSocket service is a no-op stub (line 13-18)
- Worker is disabled for demo stability (line 20-24)

### 4. **Notification Model** (`src/notifications/models/notification.ts`)

**Status:** ✅ **IMPLEMENTED**

**Features:**
- ✅ Database model with Supabase
- ✅ CRUD operations
- ✅ Status management (pending, sent, delivered, read, failed)
- ✅ Priority levels (low, normal, high, urgent)
- ✅ Channel support (in_app, email, both)

**Current Event Types:**
```typescript
export enum NotificationType {
  CLAIM_DETECTED = 'claim_detected',        // ✅ Exists
  INTEGRATION_COMPLETED = 'integration_completed',
  PAYMENT_PROCESSED = 'payment_processed',
  SYNC_COMPLETED = 'sync_completed',
  DISCREPANCY_FOUND = 'discrepancy_found',
  SYSTEM_ALERT = 'system_alert',
  USER_ACTION_REQUIRED = 'user_action_required'
}
```

**Missing Event Types:**
- ❌ `EVIDENCE_FOUND` — Evidence document ingested/parsed
- ❌ `CASE_FILED` — Dispute case filed with Amazon
- ❌ `REFUND_APPROVED` — Case approved by Amazon
- ❌ `FUNDS_DEPOSITED` — Money recovered and deposited

### 5. **SSE Routes** (`src/routes/sseRoutes.ts`)

**Status:** ✅ **IMPLEMENTED**

**Features:**
- ✅ Server-Sent Events endpoint (`/api/sse/status`)
- ✅ SSE notifications endpoint (`/api/sse/notifications`)
- ✅ Connection management via `sseHub`
- ✅ Heartbeat to keep connections alive

**Endpoints:**
- `GET /api/sse/status` — General status stream
- `GET /api/sse/notifications` — Notification stream

### 6. **Database Migration** (`src/notifications/migrations/001_create_notifications_table.sql`)

**Status:** ✅ **IMPLEMENTED**

**Features:**
- ✅ `notifications` table with all required columns
- ✅ Indexes for performance
- ✅ RLS policies
- ✅ Auto-update triggers
- ⚠️ **Missing event types** in CHECK constraint

**Current CHECK Constraint:**
```sql
type TEXT NOT NULL CHECK (type IN (
    'claim_detected',           -- ✅ Exists
    'integration_completed',
    'payment_processed',
    'sync_completed',
    'discrepancy_found',
    'system_alert',
    'user_action_required'
))
```

**Missing Types:**
- `evidence_found`
- `case_filed`
- `refund_approved`
- `funds_deposited`

---

## ❌ What's Missing

### 1. **Missing Event Types**
- ❌ `evidence_found` — When evidence document is ingested/parsed
- ❌ `case_filed` — When dispute case is filed with Amazon
- ❌ `refund_approved` — When case is approved by Amazon
- ❌ `funds_deposited` — When money is recovered and deposited

### 2. **No Integration with Agents 4-9**
- ❌ Agent 4 (Evidence Ingestion) — No notification when evidence is found
- ❌ Agent 5 (Document Parsing) — No notification when parsing completes
- ❌ Agent 6 (Evidence Matching) — No notification when match found
- ❌ Agent 7 (Refund Filing) — No notification when case is filed/approved
- ❌ Agent 8 (Recoveries) — No notification when funds are deposited
- ❌ Agent 9 (Billing) — No notification when billing completes

### 3. **WebSocket Service Stubbed**
- ⚠️ `notification_service.ts` uses `NoopWebSocketService` (no-op)
- ⚠️ Needs to use actual `websocketService` from `src/services/websocketService.ts`

### 4. **No Automated Notification Worker**
- ⚠️ `notification_worker.ts` is stubbed (`NoopNotificationWorker`)
- ❌ No background worker to process queued notifications
- ❌ No polling for events from Agents 4-9

### 5. **No Unified Notification Helper**
- ❌ No helper function that Agents 4-9 can call
- ❌ No standardized notification format
- ❌ No automatic WebSocket + Email delivery

---

## 🎯 What Needs to be Built

### 1. **Notification Worker** (`src/workers/notificationsWorker.ts`)

**Purpose:** Automated background worker that processes queued notifications

**Features:**
- Polls `notifications` table for `status = 'pending'`
- Delivers via WebSocket and Email
- Retry logic for failed deliveries
- Runs every 1 minute

**Key Methods:**
- `start()` — Start the worker
- `stop()` — Stop the worker
- `processPendingNotifications()` — Process queued notifications
- `deliverNotification()` — Deliver via WebSocket + Email

### 2. **Notification Helper Service** (`src/services/notificationHelper.ts`)

**Purpose:** Unified helper that Agents 4-9 can call to send notifications

**Features:**
- Simple API: `notifyUser(userId, eventType, data)`
- Automatically creates notification record
- Delivers via WebSocket + Email
- Handles all event types

**Key Methods:**
```typescript
async notifyClaimDetected(userId: string, claimData: any): Promise<void>
async notifyEvidenceFound(userId: string, evidenceData: any): Promise<void>
async notifyCaseFiled(userId: string, caseData: any): Promise<void>
async notifyRefundApproved(userId: string, caseData: any): Promise<void>
async notifyFundsDeposited(userId: string, recoveryData: any): Promise<void>
```

### 3. **Database Migration** (`migrations/017_notifications_worker.sql`)

**Purpose:** Add missing event types to notifications table

**Changes:**
- Add `evidence_found`, `case_filed`, `refund_approved`, `funds_deposited` to CHECK constraint
- Update `NotificationType` enum in TypeScript

### 4. **Agent Integration** (Update Agents 4-9)

**Agent 4 (Evidence Ingestion):**
- When document ingested → `notifyEvidenceFound()`

**Agent 5 (Document Parsing):**
- When parsing completes → `notifyEvidenceFound()` (with parsed data)

**Agent 6 (Evidence Matching):**
- When match found → `notifyEvidenceFound()` (with match details)

**Agent 7 (Refund Filing):**
- When case filed → `notifyCaseFiled()`
- When case approved → `notifyRefundApproved()`

**Agent 8 (Recoveries):**
- When funds deposited → `notifyFundsDeposited()`

**Agent 9 (Billing):**
- When billing completes → `notifyFundsDeposited()` (with billing details)

### 5. **Fix WebSocket Integration**

**Changes:**
- Replace `NoopWebSocketService` with actual `websocketService`
- Update `notification_service.ts` to use real WebSocket service

### 6. **Test Script** (`scripts/test-agent10-notifications.ts`)

**Test Cases:**
- Migration verification (event types)
- Notification creation
- WebSocket delivery
- Email delivery
- Integration with Agents 4-9
- Event type handling

---

## 🔄 Integration Flow

```
Agent 4 (Evidence Ingestion)
  ↓
  Document ingested
  ↓
  notificationHelper.notifyEvidenceFound()
  ↓
Agent 10 (Notifications Worker)
  ↓
  Creates notification record
  ↓
  Delivers via WebSocket + Email
  ↓
  User receives notification
```

**Similar flow for:**
- Agent 5 → Evidence Found
- Agent 6 → Evidence Found (with match)
- Agent 7 → Case Filed, Refund Approved
- Agent 8 → Funds Deposited
- Agent 9 → Funds Deposited (with billing)

---

## 📊 Summary

**What Exists:**
- ✅ WebSocket Service (Socket.IO)
- ✅ Email Service (SendGrid/Postmark)
- ✅ Notification Service (partially working)
- ✅ Notification Model (database)
- ✅ SSE Routes
- ✅ Database migration (needs update)

**What's Missing:**
- ❌ Missing event types (`evidence_found`, `case_filed`, `refund_approved`, `funds_deposited`)
- ❌ No integration with Agents 4-9
- ❌ WebSocket service stubbed in notification_service
- ❌ No automated notification worker
- ❌ No unified notification helper

**Build Required:**
1. `notificationHelper.ts` — Unified helper for Agents 4-9
2. `notificationsWorker.ts` — Automated background worker
3. `017_notifications_worker.sql` — Migration to add event types
4. Agent integrations — Update Agents 4-9 to call notificationHelper
5. Fix WebSocket integration — Replace stub with real service
6. Test script — Verify all functionality

---

## 🎯 Key Requirements

1. **WebSocket Push Events**
   - Use existing `websocketService` (not stub)
   - Real-time delivery to connected users

2. **Email Notifications**
   - Use existing `emailService`
   - HTML templates for each event type

3. **Event Types:**
   - Claim Detected ✅ (exists)
   - Evidence Found ❌ (needs to be added)
   - Case Filed ❌ (needs to be added)
   - Refund Approved ❌ (needs to be added)
   - Funds Deposited ❌ (needs to be added)

4. **Integration:**
   - Agents 4-9 should call `notificationHelper` when events occur
   - Automatic WebSocket + Email delivery

---

**Status:** Ready for Implementation ✅

