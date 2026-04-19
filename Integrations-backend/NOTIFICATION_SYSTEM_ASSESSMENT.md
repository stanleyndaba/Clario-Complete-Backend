# 🔔 Notification System — Full Assessment

**Date:** 2026-02-19 (Updated)
**Status:** Assessment Complete — Final Strategy Confirmed

---

## 🌟 North Star

> **"Recovering money, putting money back into their pockets."**

This is the only thing that matters enough to interrupt a user's inbox. Everything else stays inside the app.

---

## 📧 Final Email Strategy: Only 2 Emails

We use **Resend** as our email provider.

Only two events warrant an email — the two moments when **money moves in the user's favor:**

| # | Email | Trigger Point | Source File | Current Status |
|---|-------|---------------|-------------|----------------|
| 1 | **🎉 Claim Approved** | Amazon approves a reimbursement | [refundFilingWorker.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/refundFilingWorker.ts) L1552-1569 → calls `notifyRefundApproved()` | ✅ In-app exists, ❌ Email NOT sent |
| 2 | **💰 Money Recovered (Reimbursed)** | Funds deposited into seller account | [billingWorker.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/billingWorker.ts) L377-378 → calls `notifyFundsDeposited()` | ✅ In-app exists, ❌ Email NOT sent |

### Scrutiny: Exact Code Paths for the 2 Emails

**Email 1 — Claim Approved** (`notifyRefundApproved`):
- **Triggered when:** `refundFilingWorker.pollCaseStatuses()` detects `statusResult.status === 'approved'` (line 1522)
- **What happens:** Loads case data → calls `notificationHelper.notifyRefundApproved(seller_id, {...})` (line 1557)
- **Current channel:** `NotificationChannel.BOTH` is set, but email doesn't fire because no email provider key is configured
- **Notification title:** `"Recovered $X.XX"` — ✅ Perfect north-star messaging
- **Notification body:** `"Amazon approved the reimbursement. Cleared and scheduled for payout."` — ✅ Clear action-oriented copy
- **Priority:** `URGENT` — ✅ Correct

**Email 2 — Money Recovered** (`notifyFundsDeposited`):
- **Triggered from 3 places:**
  1. `billingWorker.ts` L377 — after successful Stripe billing
  2. `recoveriesService.ts` L388 — recovery detection confirms deposit
  3. `agent2DataSyncService.ts` L456 — data sync detects reimbursement
- **Current channel:** `NotificationChannel.BOTH` is set, but email doesn't fire
- **Notification title:** `"Deposit Confirmed: $X.XX"` — ✅ Perfect
- **Notification body:** includes fee breakdown when billing status is `'charged'` — ✅ Transparent
- **Priority:** `URGENT` — ✅ Correct

### What's Needed to Enable the 2 Emails

| Step | Detail | Status |
|------|--------|--------|
| 1 | Install Resend SDK: `npm install resend` | ❌ Not done |
| 2 | Add `RESEND_API_KEY` to `.env` and Render | ❌ Not done |
| 3 | Add `EMAIL_FROM` (e.g., `notifications@opside.io` or Resend-verified domain) | ❌ Not done |
| 4 | Keep `email_service.ts` Resend-only and remove legacy provider fallbacks | ✅ Done |
| 5 | Map `REFUND_APPROVED` and `FUNDS_DEPOSITED` types to branded Resend email templates | ❌ Not done |
| 6 | Verify `EmailService.initialize()` is called on server startup | ❌ Not verified |
| 7 | Test both emails with real data | ❌ Not done |

---

## ✅ Everything Else = In-App Notifications (Toasts + Bell + Hub)

All non-money events use in-app channels only: SSE toasts (real-time) + persisted notifications (bell count + hub history).

| # | Event | Channel | Trigger Code | Scrutinized Status |
|---|-------|---------|--------------|-------------------|
| 1 | **Account connected** | ✅ In-app (SSE toast) | `amazonController.ts` L906 → `sseHub.sendEvent(userId, 'message', {...})` | ⚠️ **SSE fire-and-forget only.** Shows toast if user is online. NOT persisted to `notifications` table — if user reloads, it's gone. |
| 2 | **Sync started** | ✅ In-app (SSE toast) | `syncJobManager.ts` L289 → `sseHub.sendEvent(userId, 'sync.started', {...})` | ⚠️ **SSE only, not persisted.** Also sends a duplicate via `'message'` event (L309). Frontend `use-phase3-notifications.ts` handles `sync_complete` type but NOT `sync.started`. |
| 3 | **Sync completed** | ✅ In-app (SSE toast) | `syncJobManager.ts` L840 → `sseHub.sendEvent(userId, 'sync.completed', {...})` | ⚠️ **SSE only, not persisted.** Frontend hook renders toast with claim count + value for `sync_complete` type. |
| 4 | **Sync failed** | ✅ In-app (SSE toast) | `syncJobManager.ts` L924 → `sseHub.sendEvent(userId, 'sync.failed', {...})` | ⚠️ **SSE only, not persisted.** Frontend hook renders red toast for `sync_failed` type. |
| 5 | **Discrepancy found** | ✅ In-app (persisted + toast) | `agent2DataSyncService.ts` L2539 → `notificationHelper.notifyClaimDetected(userId, {...})` + L2507 → `sseHub.sendEvent(userId, 'detection.completed', {...})` | ✅ **Fully working.** Persisted via `notificationService.createNotification()` + WebSocket push + SSE toast. Shows in bell + hub. |
| 6 | **Evidence matched** | ✅ In-app (persisted + toast) | `evidenceMatchingService.ts` L1130 → `notificationHelper.notifyEvidenceFound(...)` + `evidenceMatchingWorker.ts` L498 → `sseHub.sendEvent(userId, 'matching_completed', {...})` | ✅ **Fully working.** Dual-channel: persisted notification + SSE toast. |
| 7 | **Claim filed** | ✅ In-app (persisted + toast) | `refundFilingWorker.ts` L1423 → `notificationHelper.notifyCaseFiled(seller_id, {...})` | ✅ **Fully working.** Persisted + WebSocket push. Triggered after successful filing or automator execution. |
| 8 | **Status update** | ✅ In-app (SSE toast) | `detectionService.ts` L2142 → `sseHub.sendEvent(sellerId, 'detection_status_changed', {...})` | ⚠️ **SSE only for status changes.** The `detection_status_changed` event fires but is NOT persisted via `notificationHelper`. Only approval triggers `notifyRefundApproved` (which IS persisted). |
| 9 | **Amazon case created** | ✅ In-app (persisted) | Covered by `notifyCaseFiled` — fires when `updateCaseAfterFiling` runs and `amazon_case_id` is saved (L1363-1364 + L1422-1430) | ✅ **Working.** The `notifyCaseFiled` payload includes `amazonCaseId` already. No separate notification needed. |
| 10 | **Rejection / Denial notice** | ⚠️ In-app | `refundFilingWorker.ts` L1287-1327 → processes denial, feeds to Agent 11 learning, marks for retry | 🔴 **NO USER NOTIFICATION.** Denial is logged to `agentEventLogger` and processed by `learningWorker.processRejection()`, but **no toast, no bell, no SSE event is sent to the user.** The user has no idea their claim was rejected. |
| 11 | **Agent 11 learning** | ⚠️ In-app | `learningWorker.ts` — runs pattern analysis, threshold updates, model retraining | 🔴 **COMPLETELY SILENT.** `learningWorker.ts` has zero calls to `sseHub`, `notificationHelper`, or `websocketService`. The user never knows when Agent 11 learns something new or updates thresholds. |
| 12 | **Claim expiring** | ✅ In-app (SSE toast) | `detectionService.ts` L1940 → `sseHub.sendEvent(sellerId, 'claim_expiring', {...})` | ⚠️ **SSE only, not persisted.** Frontend `use-phase3-notifications.ts` handles `claim_expiring` with urgency-based styling and a toast. |
| 13 | **Weekly summary** | ❌ Missing | No code exists anywhere | 🔴 **NOT IMPLEMENTED.** No cron job, no worker, no aggregation logic. `schedulerService.ts` handles ingestion scheduling only. Would need to be a new in-app notification card generated weekly. |

---

## 🔍 Scrutiny Findings: The Hard Truth

### What's Actually Working End-to-End ✅

These events produce a persisted notification (in the DB) AND a real-time toast:

| Event | Persisted | Real-time Toast | Bell Count | Hub History |
|-------|:---------:|:---------------:|:----------:|:-----------:|
| Discrepancy found | ✅ | ✅ | ✅ | ✅ |
| Evidence matched | ✅ | ✅ | ✅ | ✅ |
| Claim filed | ✅ | ✅ | ✅ | ✅ |
| Refund approved | ✅ | ✅ | ✅ | ✅ |
| Funds deposited | ✅ | ✅ | ✅ | ✅ |
| Amazon challenge | ✅ | ✅ | ✅ | ✅ |

### What's SSE-Only (Toast But No Persistence) ⚠️

These events show a toast IF the user is online, but are lost forever if they're not:

| Event | Persisted | Toast (online only) | Problem |
|-------|:---------:|:-------------------:|---------|
| Account connected | ❌ | ✅ | Raw `sseHub.sendEvent` — not routed through `notificationHelper` |
| Sync started | ❌ | ✅ | Raw `sseHub.sendEvent` — fire-and-forget |
| Sync completed | ❌ | ✅ | Raw `sseHub.sendEvent` — fire-and-forget |
| Sync failed | ❌ | ✅ | Raw `sseHub.sendEvent` — fire-and-forget |
| Status update | ❌ | ✅ | Raw `sseHub.sendEvent` — only approval is persisted |
| Claim expiring | ❌ | ✅ | Raw `sseHub.sendEvent` — critical event not persisted |

### What's Completely Missing 🔴

| Event | Has Code | Has Notification | Impact |
|-------|:--------:|:----------------:|--------|
| Rejection notice | ✅ Logic exists | ❌ No notification | User doesn't know their claim was denied |
| Agent 11 learning | ✅ Worker exists | ❌ Zero notification calls | User has no visibility into ML improvements |
| Weekly summary | ❌ No code | ❌ No notification | No periodic recap of account health |

---

## 🏗️ What Exists (Current Infrastructure)

### Backend Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    NOTIFICATION STACK                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Agent Workers / Services                                    │
│   ├─ agent2DataSyncService.ts    (sync events)               │
│   ├─ detectionService.ts         (claim detection events)    │
│   ├─ evidenceIngestionWorker.ts  (evidence events)           │
│   ├─ documentParsingWorker.ts    (parsing events)            │
│   ├─ evidenceMatchingService.ts  (matching events)           │
│   ├─ refundFilingWorker.ts       (case filed/approved)       │
│   ├─ billingWorker.ts            (funds deposited)           │
│   ├─ recoveriesService.ts        (funds deposited)           │
│   └─ disputeRoutes.ts           (amazon challenge)           │
│         │                                │                   │
│         ▼                                ▼                   │
│  notificationHelper.ts           sseHub.ts                   │
│  (6 typed methods)               (direct SSE push)           │
│         │                                │                   │
│         ▼                                ▼                   │
│  notification_service.ts         SSE Connection Pool         │
│  (CRUD + delivery)               (per-user, per-tenant)      │
│         │                                                    │
│         ├──▶ WebSocket/SSE delivery ✅                       │
│         └──▶ Email delivery ❌ (not configured)              │
│                    │                                         │
│              email_service.ts                                │
│              (Resend-only delivery)                          │
│              ⚠️ Requires RESEND_API_KEY                      │
│                                                              │
│  notificationsWorker.ts                                      │
│  (Cron: every 2 min, processes queued notifications)         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Backend Files

| File | Role | Status |
|------|------|--------|
| [sseHub.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/utils/sseHub.ts) | SSE connection manager (per-user, per-tenant) | ✅ Working |
| [notificationHelper.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/notificationHelper.ts) | Typed notification methods for all agents | ✅ Working |
| [notification_service.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/notifications/services/notification_service.ts) | Core CRUD + delivery dispatcher | ✅ Working |
| [notificationsWorker.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/notificationsWorker.ts) | Cron processor (every 2 min) | ✅ Working |
| [email_service.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/notifications/services/delivery/email_service.ts) | Email sender | ✅ Resend-only |
| [notification.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/notifications/models/notification.ts) | Data model + Supabase CRUD | ✅ Working |

### Frontend Files

| File | Role | Status |
|------|------|--------|
| [NotificationsProvider.tsx](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/opside-complete-frontend/src/components/providers/NotificationsProvider.tsx) | React context, SSE listener, fetch + mark-as-read | ✅ Working |
| [NotificationBell.tsx](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/opside-complete-frontend/src/components/layout/NotificationBell.tsx) | Bell icon + dropdown with unread count | ✅ Working |
| [use-phase3-notifications.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/opside-complete-frontend/src/hooks/use-phase3-notifications.ts) | SSE hook for 6 event types + toast rendering | ✅ Working |
| [NotificationHub.tsx](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/opside-complete-frontend/src/pages/NotificationHub.tsx) | Full-page notification history + preferences | ✅ Working |

### Notification Types (Defined in Model)

```typescript
enum NotificationType {
  CLAIM_DETECTED        = 'claim_detected',         // ✅ Triggered (in-app only)
  EVIDENCE_FOUND        = 'evidence_found',          // ✅ Triggered (in-app only)
  CASE_FILED            = 'case_filed',              // ✅ Triggered (in-app only)
  REFUND_APPROVED       = 'refund_approved',         // ✅ Triggered (in-app + EMAIL)
  FUNDS_DEPOSITED       = 'funds_deposited',         // ✅ Triggered (in-app + EMAIL)
  INTEGRATION_COMPLETED = 'integration_completed',   // ❌ Defined but NEVER triggered
  PAYMENT_PROCESSED     = 'payment_processed',       // ❌ Defined but NEVER triggered
  SYNC_COMPLETED        = 'sync_completed',          // ❌ Defined but NEVER triggered via helper
  DISCREPANCY_FOUND     = 'discrepancy_found',       // ❌ Defined but NEVER triggered via helper
}
```

---

## 🔴 Critical Gaps (Updated After Scrutiny)

### Gap 1: Email Provider Not Configured

**Problem:** Email delivery requires a valid `RESEND_API_KEY`. If production still carries stale legacy email variables without `RESEND_API_KEY`, email delivery fails closed instead of falling back to another provider.

**Impact:** The 2 most important emails (Claim Approved + Money Recovered) are not being sent.

**Fix Required:**
- Configure `RESEND_API_KEY` and `EMAIL_FROM` in `.env` / Render
- Build 2 branded email templates (Claim Approved + Money Recovered)
- Verify `EmailService.initialize()` is called on startup

---

### Gap 2: Rejection Notice — User Is Never Told

**Problem:** When Amazon denies a claim (`statusResult.status === 'denied'` at [refundFilingWorker.ts L1287](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/refundFilingWorker.ts#L1287)), the system logs the rejection for Agent 11 learning and marks the case for retry — but **sends zero notification to the user.** No SSE event, no toast, no bell count.

**Impact:** User has no idea their claim was rejected. They see "Claim Filed" but never see follow-up status.

**Fix Required:**
- Add `sseHub.sendEvent(userId, 'notification', {...})` or route through `notificationHelper.notifyUser()` after denial detection
- Include rejection reason + "We're retrying with stronger evidence" messaging
- Channel: `IN_APP` only (toast + persisted)

---

### Gap 3: Agent 11 Learning — Completely Silent

**Problem:** [learningWorker.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/learningWorker.ts) runs pattern analysis, threshold updates, outcome analysis, long-tail pattern exploration, and model retraining — but has **zero calls** to `sseHub`, `notificationHelper`, or any notification mechanism. The user has absolutely no visibility into what Agent 11 is doing.

**Impact:** Users miss a huge value-add: the system is learning and improving, but they don't know it.

**Fix Required:**
- Add in-app notifications for key learning events: "Improved detection accuracy by X%", "Identified new recovery pattern", "Updated detection thresholds"
- Channel: `IN_APP` only (pleasant, non-intrusive toasts)

---

### Gap 4: SSE-Only Events Not Persisted

**Problem:** 6 important events use raw `sseHub.sendEvent()` instead of going through `notificationHelper`:
- Account connected (`amazonController.ts` L906)
- Sync started/completed/failed (`syncJobManager.ts` L289/840/924)
- Status update (`detectionService.ts` L2142)
- Claim expiring (`detectionService.ts` L1940)

**Impact:** If users are offline when these events fire, they are lost forever. No bell count increment, no hub history entry.

**Fix Required:**
- Route these through `notificationHelper.notifyUser()` so they're persisted in the `notifications` table
- This ensures the bell always shows accurate unread counts

---

### Gap 5: Weekly Summary — No Code Exists

**Problem:** No cron job, no worker, no aggregation logic exists for a weekly summary. User requested this as an in-app notification (not email).

**Fix Required:**
- Create `weeklySummaryWorker.ts` with cron schedule `0 8 * * 1` (Monday 8am)
- Generate one `NotificationType` = `'weekly_summary'` notification per user
- Aggregate: claims detected, cases filed, funds recovered, pending items
- Channel: `IN_APP` only

---

### Previous Gaps (Retained from Original Assessment)

#### Gap: No "Account Connected" Notification (Persistence)

**Problem:** `amazonController.ts` sends a raw SSE message for OAuth completion (L906), but the `INTEGRATION_COMPLETED` type is never used. The event is NOT persisted.

**Fix:** Route through `notificationHelper.notifyUser()` with `NotificationType.INTEGRATION_COMPLETED`. Channel: `IN_APP`.

#### Gap: 4 Notification Types Defined But Never Triggered

| Type | Defined | Triggered |
|------|---------|-----------
| `integration_completed` | ✅ | ❌ |
| `payment_processed` | ✅ | ❌ |
| `sync_completed` | ✅ | ❌ (SSE only, not via helper) |
| `discrepancy_found` | ✅ | ❌ (SSE only, not via helper) |

---

## 📋 Implementation Checklist (Updated)

### Priority 1: Enable 2 Emails via Resend
- [ ] Install `resend` SDK: `npm install resend`
- [ ] Add Resend as provider in `email_service.ts`
- [ ] Set `RESEND_API_KEY` in `.env` and Render
- [ ] Set `EMAIL_FROM` (verified Resend domain)
- [ ] Create **Claim Approved** email template (branded, north-star copy)
- [ ] Create **Money Recovered** email template (branded, payout breakdown)
- [ ] Verify `EmailService.initialize()` is called during server startup
- [ ] Test both emails end-to-end

### Priority 2: Fix Missing In-App Notifications
- [ ] **Rejection notice** — Add toast + persisted notification in `refundFilingWorker.ts` L1287-1327
- [ ] **Agent 11 learning** — Add notifications in `learningWorker.ts` for key learning milestones
- [ ] **Weekly summary** — Create `weeklySummaryWorker.ts` (in-app only)

### Priority 3: Persist SSE-Only Events
- [ ] Account connected → `notificationHelper.notifyUser()` with `INTEGRATION_COMPLETED`
- [ ] Sync started/completed/failed → `notificationHelper.notifyUser()` with `SYNC_COMPLETED`
- [ ] Status update → `notificationHelper.notifyUser()` with relevant type
- [ ] Claim expiring → `notificationHelper.notifyUser()` (critical event must persist)

---

## 🧪 Scrutiny Testing Plan

### Test 1: Claim Approved Email (Email 1 of 2)
1. Poll case statuses or mock an approval in Supabase
2. Verify: In-app toast appears: "Recovered $X.XX"
3. Verify: Notification persisted in `notifications` table
4. Verify: **Email received** via Resend with branded template
5. Verify: Email includes approved amount, case ID, dashboard link

### Test 2: Money Recovered Email (Email 2 of 2)
1. Mock a funds deposit event
2. Verify: In-app toast appears: "Deposit Confirmed: $X.XX"
3. Verify: Notification includes fee breakdown (if billing charged)
4. Verify: **Email received** via Resend with payout breakdown
5. Verify: Email includes: recovered amount, platform fee, net payout

### Test 3: In-App Events (No Email)
1. Connect Amazon account → verify toast (account connected)
2. Trigger sync → verify "Sync Started" toast + "Sync Completed" toast
3. Trigger detection → verify "Discrepancy Found" bell count + toast
4. File a claim → verify "Claim Filed" bell count + toast
5. Mock a rejection → verify rejection toast with retry message

### Test 4: Notification Bell & Hub
1. Trigger 5 different notification types
2. Verify: Bell shows correct unread count
3. Click bell → verify dropdown shows latest notifications
4. Click "Mark all as read" → verify count resets to 0
5. Navigate to Notification Hub → verify full history is shown
6. Verify: Notifications correctly categorized by type

### Test 5: Offline Resilience (Persistence)
1. Close browser (disconnect SSE)
2. Trigger 3 notifications via backend
3. Re-open browser
4. Verify: All 3 notifications appear in history on page load
5. Verify: Bell shows correct unread count

### Test 6: Agent 11 Learning Notifications
1. Trigger learning worker for a user
2. Verify: Toast shows learning milestone
3. Verify: Notification persisted and visible in hub

### Test 7: Weekly Summary
1. Set cron to run in 1 minute (for testing)
2. Verify: In-app notification card generated per user
3. Verify: Card shows claims detected, cases filed, funds recovered
4. Reset cron to `0 8 * * 1` (Monday 8am)

---

## 📁 Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| **MODIFY** | `email_service.ts` | Add Resend as email provider |
| **MODIFY** | `email_service.ts` | Create 2 branded email templates (Claim Approved + Money Recovered) |
| **MODIFY** | `refundFilingWorker.ts` | Add rejection notification for user (in-app) |
| **MODIFY** | `learningWorker.ts` | Add learning milestone notifications (in-app) |
| **MODIFY** | `amazonController.ts` | Persist account connected via `notificationHelper` |
| **MODIFY** | `syncJobManager.ts` | Persist sync events via `notificationHelper` |
| **MODIFY** | `detectionService.ts` | Persist status changes + claim expiring via `notificationHelper` |
| **MODIFY** | `notification.ts` (model) | Add `WEEKLY_SUMMARY` type |
| **CREATE** | `weeklySummaryWorker.ts` | Weekly in-app summary cron worker |
| **MODIFY** | `index.ts` | Register `weeklySummaryWorker` |
| **MODIFY** | `.env` / Render | Add `RESEND_API_KEY`, `EMAIL_FROM` |

---

## 🎯 Definition of Done

### Emails (2 only)
- ✅ Resend SDK installed and configured
- ✅ **Claim Approved** email arrives at user inbox with branded template
- ✅ **Money Recovered** email arrives with payout breakdown

### In-App (Everything Else)
- ✅ Every event in the matrix produces a toast when user is online
- ✅ Every notification is persisted in `notifications` table
- ✅ Bell icon shows accurate unread count
- ✅ Notification Hub shows full, categorized history
- ✅ Offline users see missed notifications on page load
- ✅ Rejection notices are surfaced to users
- ✅ Agent 11 learning milestones are visible
- ✅ Weekly summary card appears every Monday
