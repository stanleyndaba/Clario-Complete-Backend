# Agent 9: Billing Engine — Analysis

**Date:** 2025-01-27  
**Status:** Analysis Complete — Ready for Implementation

---

## 📋 Agent 9 Requirements

1. **Stripe Integration**
   - Charge users 20% commission on recovered amounts
   - Process payments via Stripe PaymentIntents
   - Handle payment failures and retries

2. **Revenue Share Model (20%)**
   - Calculate 20% platform fee from recovered amount
   - Calculate 80% seller payout
   - Apply minimum fee thresholds

3. **Only Charge After Money is Recovered**
   - Wait for `recovery_status = 'reconciled'` from Agent 8
   - Only charge when actual payout is confirmed
   - No charges for pending or failed recoveries

---

## ✅ What Exists

### 1. **Stripe Payments Service** (`stripe-payments/`)

#### **Fee Calculator Service** (`stripe-payments/src/services/feeCalculator.ts`)
- ✅ `calculateFees()` — Calculates 20% platform fee and 80% seller payout
- ✅ `getFeeBreakdown()` — Returns fee breakdown with percentages
- ✅ `validateFeeCalculation()` — Validates fee calculations
- ✅ `getMinimumFee()` — Returns minimum fee (50 cents)
- ✅ `calculateEffectiveFeePercentage()` — Calculates effective fee percentage
- ✅ `meetsMinimumFeeRequirements()` — Checks if fee meets minimum

**Key Logic:**
```typescript
// Calculate platform fee (20%)
const platformFeeCents = Math.round(
  (amountRecoveredCents * FEE_CONFIG.PLATFORM_FEE_PERCENTAGE) / 100
);

// Ensure minimum fee
const finalPlatformFee = Math.max(platformFeeCents, FEE_CONFIG.MINIMUM_FEE_CENTS);

// Calculate seller payout (80%)
const sellerPayoutCents = amountRecoveredCents - finalPlatformFee;
```

#### **Stripe Service** (`stripe-payments/src/services/stripeService.ts`)
- ✅ `createPaymentIntent()` — Creates Stripe PaymentIntent for charging
- ✅ `createTransfer()` — Transfers seller payout to seller's Stripe account
- ✅ `getPaymentIntent()` — Retrieves PaymentIntent status
- ✅ `getTransfer()` — Retrieves transfer status
- ✅ `createCustomer()` — Creates Stripe customer
- ✅ `createSetupIntent()` — Creates SetupIntent for payment method collection

#### **Charge Commission Endpoint** (`stripe-payments/src/controllers/checkoutController.ts`)
- ✅ `chargeCommission()` — POST `/api/v1/stripe/charge-commission`
- ✅ Validates request
- ✅ Calculates fees (20% platform fee)
- ✅ Creates transaction record
- ✅ Adds payment job to queue
- ✅ Handles idempotency

**Request Format:**
```typescript
{
  userId: number;
  claimId?: number;
  amountRecoveredCents: number;
  currency: string; // 'usd', 'eur', etc.
  idempotencyKey?: string;
  paymentMethodId?: string;
  customerId?: string;
}
```

#### **Payout Job Queue** (`stripe-payments/src/jobs/payoutJob.ts`)
- ✅ Background job processing for payments
- ✅ Retry logic with exponential backoff
- ✅ PaymentIntent creation and confirmation
- ✅ Transfer creation for seller payouts
- ✅ Status updates and error handling

#### **Database Schema** (`stripe-payments/prisma/schema.prisma`)
- ✅ `StripeTransaction` table — Tracks all billing transactions
- ✅ `StripeAccount` table — Tracks user Stripe accounts
- ✅ `StripeSubscription` table — Tracks subscriptions
- ✅ `TransactionAudit` table — Audit trail for transactions
- ✅ `StripeWebhookEvent` table — Webhook event logs

**StripeTransaction Schema:**
```prisma
model StripeTransaction {
  id                      Int      @id @default(autoincrement())
  userId                  Int
  claimId                 Int?     // optional FK to refund claim
  amountRecoveredCents    Int      // cents
  platformFeeCents        Int      // 20% fee in cents
  sellerPayoutCents       Int      // 80% in cents
  currency                String   @default("usd")
  stripePaymentIntentId   String?  @unique
  stripeChargeId          String?
  stripeTransferId        String?
  status                  String   // pending, charged, failed, refunded, transferred, cancelled
  idempotencyKey          String?  @unique
  metadata                Json?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
}
```

### 2. **Existing Billing Triggers** (Manual)

#### **Refund Engine** (`FBA Refund Predictor/refund-engine/src/api/controllers/claimsController.ts`)
- ✅ When claim status changes to `paid`, triggers Stripe commission charge
- ✅ Calls `POST /api/v1/stripe/charge-commission`
- ✅ Records billing audit event

**Code:**
```typescript
if (newStatus === 'paid' && prevStatus !== newStatus) {
  await fetch(`${stripeUrl}/api/v1/stripe/charge-commission`, {
    method: 'POST',
    body: JSON.stringify({
      userId: req.user.id,
      claimId: id,
      amountRecoveredCents: Math.round((updatedClaim?.claim_amount || 0) * 100),
      currency: 'usd',
    }),
  });
}
```

#### **Orchestration Job** (`Integrations-backend/src/jobs/orchestrationJob.ts`)
- ✅ Phase 7: Payout Received — Calculates 20% platform fee
- ✅ Calls Stripe service to process fee
- ⚠️ **Note:** Uses hardcoded endpoint `/api/v1/stripe/process-fee` (may not exist)

---

## ❌ What's Missing (TypeScript Backend — Integrations-backend)

### 1. **No TypeScript Billing Worker**
- ❌ No automated background worker in `Integrations-backend`
- ❌ No polling for reconciled recoveries
- ❌ No automatic billing trigger when `recovery_status = 'reconciled'`
- ❌ Billing only happens via manual API calls

### 2. **No Billing Service in Integrations-backend**
- ❌ No service wrapper for Stripe Payments API
- ❌ No retry logic at TypeScript level
- ❌ No error handling for billing failures
- ❌ No integration with Supabase for billing records

### 3. **No Integration with Agent 8**
- ❌ Agent 8 sets `recovery_status = 'reconciled'` but doesn't trigger billing
- ❌ No automatic billing when recovery is reconciled
- ❌ Manual intervention required to charge users

### 4. **No Database Tables in Supabase**
- ❌ No `billing_transactions` table in Supabase
- ❌ No `billing_errors` table for error logging
- ❌ No tracking of billing status per recovery
- ❌ No link between `recoveries` and `billing_transactions`

### 5. **No Migration Script**
- ❌ No migration for billing-related tables
- ❌ No columns on `dispute_cases` for billing status
- ❌ No indexes for billing queries

### 6. **No Error Logging**
- ❌ No dedicated error table for billing failures
- ❌ No retry tracking for failed billing attempts
- ❌ No structured logging for billing operations

---

## 🎯 What Needs to be Built

### 1. **Billing Service** (`src/services/billingService.ts`)

**Purpose:** Wrap Stripe Payments API with retry logic and error handling

**Key Methods:**
- `chargeCommission()` — Call Stripe Payments API to charge commission
- `chargeCommissionWithRetry()` — Retry logic with exponential backoff
- `getBillingStatus()` — Get billing status for a recovery
- `logBillingError()` — Log billing errors to `billing_errors` table

**Integration:**
- Calls `POST ${STRIPE_PAYMENTS_URL}/api/v1/stripe/charge-commission`
- Uses `amountRecoveredCents` from `recoveries.actual_amount` (or `dispute_cases.actual_payout_amount`)
- Calculates 20% fee using existing fee calculator logic
- Handles idempotency keys

### 2. **Billing Worker** (`src/workers/billingWorker.ts`)

**Purpose:** Automated background worker that polls for reconciled recoveries and triggers billing

**Schedule:** Every 5 minutes

**Key Methods:**
- `start()` — Start the worker
- `stop()` — Stop the worker
- `runBillingForAllTenants()` — Process all reconciled recoveries
- `processBillingForRecovery()` — Process billing for a single recovery

**Logic:**
1. Poll `dispute_cases` for cases with:
   - `recovery_status = 'reconciled'`
   - `billing_status IS NULL OR billing_status = 'pending'`
2. For each case:
   - Get `actual_payout_amount` from `dispute_cases` or `recoveries`
   - Call `billingService.chargeCommissionWithRetry()`
   - Update `billing_status = 'charged'` or `'failed'`
   - Log to `billing_transactions` table
3. Handle errors and retries

### 3. **Database Migration** (`migrations/016_billing_worker.sql`)

**New Tables:**
- `billing_transactions` — Tracks all billing attempts
- `billing_errors` — Logs billing errors

**New Columns:**
- `dispute_cases.billing_status` — `pending`, `charged`, `failed`, `refunded`
- `dispute_cases.billed_at` — Timestamp when billing occurred
- `dispute_cases.billing_retry_count` — Number of retry attempts

**Schema:**
```sql
CREATE TABLE billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  recovery_id UUID REFERENCES recoveries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  amount_recovered_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  seller_payout_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  stripe_transaction_id INTEGER, -- FK to stripe-payments StripeTransaction
  stripe_payment_intent_id TEXT,
  billing_status TEXT NOT NULL CHECK (billing_status IN ('pending', 'charged', 'failed', 'refunded')),
  idempotency_key TEXT UNIQUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE billing_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  recovery_id UUID REFERENCES recoveries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT FALSE
);
```

### 4. **Agent 8 Integration** (`src/workers/recoveriesWorker.ts`)

**Changes:**
- When `recovery_status = 'reconciled'`, set `billing_status = 'pending'`
- Optionally trigger immediate billing (non-blocking)

### 5. **Worker Registration** (`src/index.ts`)

**Changes:**
- Import `billingWorker`
- Register worker with `ENABLE_BILLING_WORKER` environment variable
- Start worker on server startup

### 6. **Test Script** (`scripts/test-agent9-billing.ts`)

**Test Cases:**
- Migration verification
- Service initialization
- Worker initialization
- Database operations (billing_transactions, billing_errors)
- Integration with Agent 8
- Fee calculation (20% platform fee)
- Retry logic
- Error logging

---

## 🔄 Integration Flow

```
Agent 8 (Recoveries Worker)
  ↓
  Payout detected and matched
  ↓
  Reconciliation completed
  ↓
  Sets recovery_status = 'reconciled'
  ↓
  Sets billing_status = 'pending'
  ↓
Agent 9 (Billing Worker)
  ↓
  Polls for cases with billing_status = 'pending'
  ↓
  Gets actual_payout_amount from dispute_cases or recoveries
  ↓
  Calculates 20% platform fee
  ↓
  Calls Stripe Payments API (chargeCommission)
  ↓
  Creates billing_transaction record
  ↓
  Updates billing_status = 'charged' or 'failed'
  ↓
  If failed: Retry with exponential backoff (max 3 retries)
  ↓
  Logs errors to billing_errors table
  ↓
  If charged: Ready for Agent 10 (Notifications Engine)
```

---

## 📊 Summary

**Stripe Payments Service:** ✅ Complete
- Fee calculation (20%)
- PaymentIntent creation
- Transaction management
- Payout job queue

**TypeScript Backend:** ❌ Missing
- No billing worker
- No billing service
- No database tables
- No integration with Agent 8

**Build Required:**
1. `billingService.ts` — Service wrapper for Stripe Payments API
2. `billingWorker.ts` — Automated background worker
3. `016_billing_worker.sql` — Database migration
4. Agent 8 integration — Set `billing_status = 'pending'` when reconciled
5. Test script — Verify billing functionality

---

## 🎯 Key Requirements

1. **Only Charge After Recovery is Reconciled**
   - Wait for `recovery_status = 'reconciled'` from Agent 8
   - Use `actual_payout_amount` (not expected amount)
   - No charges for pending or failed recoveries

2. **20% Revenue Share**
   - Calculate 20% platform fee from recovered amount
   - Calculate 80% seller payout
   - Apply minimum fee (50 cents)

3. **Stripe Integration**
   - Call Stripe Payments API (`/api/v1/stripe/charge-commission`)
   - Handle PaymentIntent creation and confirmation
   - Process seller payouts (optional, via Stripe Connect)

4. **Error Handling**
   - Retry logic (max 3 retries, exponential backoff)
   - Error logging to `billing_errors` table
   - Idempotency keys to prevent duplicate charges

---

**Status:** Ready for Implementation ✅

