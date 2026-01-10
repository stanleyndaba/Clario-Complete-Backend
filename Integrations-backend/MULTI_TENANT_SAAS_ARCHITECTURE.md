# Multi-Tenant SaaS Architecture Implementation Plan
## Enterprise-Grade Production-Ready v2.0

---

## Executive Overview

This plan converts the current Opside platform from a **user-centric** (`seller_id`) model to a full **multi-tenant SaaS** model where:
- A **Tenant** = An organization/workspace (e.g., a company, agency, or team)
- Multiple **Users** can belong to one Tenant (with roles)
- ALL data is scoped to `tenant_id`, not `user_id`

This enables agencies to manage multiple Amazon seller clients, enterprise teams to collaborate, and proper B2B SaaS billing.

---

## ✅ Existing Infrastructure Confirmed

### `stripe-payments/` Microservice
**Purpose**: Handles actual money movement (separate from main backend)

| Model | Function |
| :--- | :--- |
| `StripeCustomer` | Maps external user ID to Stripe customer |
| `StripeSubscription` | SaaS subscription lifecycle |
| `StripeTransaction` | 20% platform fee extraction per recovery |
| `StripeInvoice` | Invoice records for billing |
| `TransactionAudit` | Financial audit trail |
| `PayoutJobQueue` | Background payout processing |

**Integration Point**: Agent 9 (The Banker) calls this service via `STRIPE_PAYMENTS_URL`.

---

## Current State Analysis

### Database Isolation Pattern (TODAY)
- Uses **`seller_id`** as the isolation key (mapped to Supabase `auth.uid()`)
- Supabase RLS policies enforce: `auth.uid() = seller_id`
- The backend uses `supabaseAdmin` (service role) to **bypass RLS**
- `userIdMiddleware.ts` extracts `userId` from headers/JWT

### Tables Requiring `tenant_id` Addition (~35 tables)

| Category | Tables |
| :--- | :--- |
| **Core Data** | `orders`, `shipments`, `returns`, `settlements`, `inventory` |
| **Detection** | `financial_events`, `detection_results`, `detection_queue`, `detection_thresholds`, `detection_whitelist` |
| **Disputes** | `dispute_cases`, `dispute_automation_rules`, `dispute_evidence`, `dispute_audit_log` |
| **Evidence** | `evidence_sources`, `evidence_documents`, `evidence_line_items`, `dispute_evidence_links`, `proof_packets`, `smart_prompts`, `evidence_match_results` |
| **Workers** | `parser_jobs`, `ingestion_jobs`, `filing_jobs`, `billing_jobs`, `recoveries` |
| **System** | `agent_events`, `notifications`, `learning_insights`, `threshold_optimizations`, `sync_detection_triggers`, `sync_snapshots`, `realtime_alerts` |
| **Access** | `tokens`, `users`, `referral_invites`, `seller_proxy_assignments`, `user_notes` |

---

## 1️⃣ Tenant Lifecycle States (Gap Fix)

```sql
-- tenants table with FULL lifecycle
CREATE TABLE IF NOT EXISTS tenants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,  -- URL-friendly: /app/:slug/dashboard
  
  -- Lifecycle State
  status TEXT DEFAULT 'active' CHECK (status IN (
    'active',           -- Normal operation
    'trialing',         -- Free trial period
    'suspended',        -- Payment failure - deny new actions
    'read_only',        -- Past due - can view, cannot create
    'canceled',         -- User canceled - archive data
    'deleted'           -- Marked for purge
  )),
  
  -- Billing
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'professional', 'enterprise')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  
  -- Trial
  trial_ends_at TIMESTAMPTZ,
  
  -- Soft Delete & Data Retention
  deleted_at TIMESTAMPTZ,          -- ⚠️ Soft delete
  data_purge_scheduled_at TIMESTAMPTZ,  -- Purge after X days
  
  -- Metadata
  settings JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lifecycle behavior enforcement function
CREATE OR REPLACE FUNCTION check_tenant_can_write()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT status FROM tenants WHERE id = NEW.tenant_id) IN ('suspended', 'read_only', 'deleted') THEN
    RAISE EXCEPTION 'Tenant is not in active state - write operations blocked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Lifecycle Behavior Matrix

| Status | Can Read | Can Write | Can Billing | Behavior |
| :--- | :---: | :---: | :---: | :--- |
| `active` | ✅ | ✅ | ✅ | Full access |
| `trialing` | ✅ | ✅ | ⚠️ Limited | Trial limits enforced |
| `suspended` | ✅ | ❌ | ❌ | Payment required banner |
| `read_only` | ✅ | ❌ | ✅ | Grace period, pay to unlock |
| `canceled` | ✅ | ❌ | ❌ | Data export available |
| `deleted` | ❌ | ❌ | ❌ | 30-day purge countdown |

---

## 2️⃣ Soft Deletes + Data Retention (Gap Fix)

```sql
-- Add deleted_at to ALL critical tables
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE evidence_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE recoveries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Create view that excludes soft-deleted records
CREATE OR REPLACE VIEW active_dispute_cases AS
SELECT * FROM dispute_cases WHERE deleted_at IS NULL;

-- Scheduled purge job (run daily)
-- Permanently delete records where deleted_at < NOW() - INTERVAL '90 days'
```

### Data Retention Policy

| Data Type | Soft Delete Period | Hard Delete After |
| :--- | :--- | :--- |
| Tenant | 30 days | 90 days |
| User Membership | 30 days | 90 days |
| Dispute Cases | 90 days | 1 year (compliance) |
| Financial Records | Never soft delete | 7 years (legal) |
| Audit Logs | Never delete | 7 years (legal) |

---

## 3️⃣ Comprehensive Indexing Strategy (Gap Fix)

```sql
-- Primary tenant isolation indexes (CRITICAL - add NOW)
CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_id ON dispute_cases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_id ON detection_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant_id ON evidence_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_tenant_id ON recoveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tokens_tenant_id ON tokens(tenant_id);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_status ON dispute_cases(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_created ON dispute_cases(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_status ON detection_results(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant_date ON evidence_documents(tenant_id, document_date);

-- Multi-account support (for agencies)
CREATE INDEX IF NOT EXISTS idx_tokens_tenant_seller ON tokens(tenant_id, seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_seller ON orders(tenant_id, seller_id);

-- Soft delete aware indexes
CREATE INDEX IF NOT EXISTS idx_dispute_cases_active ON dispute_cases(tenant_id, status) 
  WHERE deleted_at IS NULL;
```

---

## 4️⃣ Multi-Tenant User Selection (Gap Fix)

### Selection Strategy: **URL Slug + Session Fallback**

```
URL Pattern: /app/:tenantSlug/dashboard
Example:     /app/acme-corp/disputes
```

### Tenant Resolution Order
1. **URL Path**: Extract from `/app/:tenantSlug/*`
2. **Session/Cookie**: `X-Tenant-Id` header or `active_tenant_id` cookie
3. **Default**: First active membership (for root `/app` route)

### Database Schema

```sql
-- Track user's last active tenant
ALTER TABLE users ADD COLUMN IF NOT EXISTS 
  last_active_tenant_id UUID REFERENCES tenants(id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS 
  last_active_at TIMESTAMPTZ;
```

### Backend Implementation

```typescript
// tenantMiddleware.ts - Resolution Logic
export async function resolveTenant(req: Request): Promise<string> {
  const userId = (req as any).userId;
  
  // 1. Check URL path
  const slugMatch = req.path.match(/^\/app\/([^\/]+)/);
  if (slugMatch) {
    const tenant = await getTenantBySlug(slugMatch[1]);
    if (tenant && await userHasMembership(userId, tenant.id)) {
      return tenant.id;
    }
    throw new ForbiddenError('No access to this tenant');
  }
  
  // 2. Check header
  const headerTenantId = req.headers['x-tenant-id'] as string;
  if (headerTenantId && await userHasMembership(userId, headerTenantId)) {
    return headerTenantId;
  }
  
  // 3. Use last active or first membership
  return await getDefaultTenantForUser(userId);
}
```

### Frontend Implementation

```tsx
// URL-based tenant routing
<Routes>
  <Route path="/app/:tenantSlug/*" element={<TenantLayout />}>
    <Route path="dashboard" element={<Dashboard />} />
    <Route path="disputes" element={<Disputes />} />
  </Route>
</Routes>

// Tenant switcher component
function TenantSwitcher() {
  const { tenants, activeTenant, switchTenant } = useTenant();
  
  return (
    <Select value={activeTenant.slug} onChange={(slug) => {
      navigate(`/app/${slug}/dashboard`);
    }}>
      {tenants.map(t => <Option key={t.id} value={t.slug}>{t.name}</Option>)}
    </Select>
  );
}
```

---

## 5️⃣ Stripe Billing Integration (Gap Fix)

### Model: One Subscription Per Tenant

```sql
-- Link stripe-payments microservice to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS 
  stripe_customer_id TEXT;  -- Maps to StripeCustomer.externalUserId

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS 
  stripe_subscription_id TEXT;  -- Maps to StripeSubscription.stripeSubscriptionId
```

### Plan Feature Limits

```typescript
// config/planLimits.ts
export const PLAN_LIMITS = {
  free: {
    maxAmazonAccounts: 1,
    maxMonthlyRecoveries: 10,
    maxEvidenceDocs: 50,
    autoFilingEnabled: false,
    apiAccessEnabled: false,
    supportTier: 'community'
  },
  starter: {
    maxAmazonAccounts: 3,
    maxMonthlyRecoveries: 100,
    maxEvidenceDocs: 500,
    autoFilingEnabled: true,
    apiAccessEnabled: false,
    supportTier: 'email'
  },
  professional: {
    maxAmazonAccounts: 10,
    maxMonthlyRecoveries: 1000,
    maxEvidenceDocs: 5000,
    autoFilingEnabled: true,
    apiAccessEnabled: true,
    supportTier: 'priority'
  },
  enterprise: {
    maxAmazonAccounts: Infinity,
    maxMonthlyRecoveries: Infinity,
    maxEvidenceDocs: Infinity,
    autoFilingEnabled: true,
    apiAccessEnabled: true,
    supportTier: 'dedicated'
  }
};
```

### Billing Roles

| Role | Can View Billing | Can Manage Subscription | Can Add Payment Method |
| :--- | :---: | :---: | :---: |
| `owner` | ✅ | ✅ | ✅ |
| `admin` | ✅ | ⚠️ (with owner approval) | ❌ |
| `member` | ❌ | ❌ | ❌ |
| `viewer` | ❌ | ❌ | ❌ |

---

## 6️⃣ Audit Logging (Gap Fix)

```sql
-- Comprehensive audit log for financial platform compliance
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_user_id UUID,  -- NULL for system actions
  actor_type TEXT CHECK (actor_type IN ('user', 'system', 'worker', 'webhook')),
  
  -- Action Details
  action TEXT NOT NULL,  -- 'dispute.created', 'recovery.approved', 'billing.charged'
  resource_type TEXT NOT NULL,  -- 'dispute', 'recovery', 'user', 'tenant'
  resource_id TEXT,
  
  -- Change Tracking
  payload_before JSONB,
  payload_after JSONB,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  request_id TEXT,  -- Correlation ID
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- Partition by month for performance (optional for scale)
-- CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

### Audit Service

```typescript
// services/auditService.ts
export async function logAudit(params: {
  tenantId: string;
  actorUserId?: string;
  actorType: 'user' | 'system' | 'worker' | 'webhook';
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: any;
  after?: any;
  req?: Request;
}) {
  await supabaseAdmin.from('audit_logs').insert({
    tenant_id: params.tenantId,
    actor_user_id: params.actorUserId,
    actor_type: params.actorType,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    payload_before: params.before,
    payload_after: params.after,
    ip_address: params.req?.ip,
    user_agent: params.req?.headers['user-agent'],
    request_id: params.req?.headers['x-request-id']
  });
}
```

---

## 7️⃣ Background Workers: Cross-Tenant Safety (Gap Fix)

### Queue Partitioning Strategy

```typescript
// Job queue naming pattern
const QUEUE_NAME_PATTERN = 'jobs:{tenant_id}:{worker_type}';

// Examples:
// jobs:tenant-abc123:filing
// jobs:tenant-abc123:billing
// jobs:tenant-abc123:detection

// Worker picks up jobs only for specific tenants or round-robin
async function processFilingJobs() {
  // Option 1: Tenant-tagged jobs with priority
  const job = await queue.dequeue({
    queuePattern: 'jobs:*:filing',
    priority: ['enterprise', 'professional', 'starter', 'free']
  });
  
  // Option 2: Fair scheduling across tenants
  const job = await queue.dequeueFairShare('filing');
}
```

### Rate Limits Per Tenant

```typescript
// config/workerLimits.ts
export const WORKER_LIMITS_BY_PLAN = {
  free: {
    maxConcurrentJobs: 1,
    maxJobsPerHour: 10,
    maxRetries: 2
  },
  starter: {
    maxConcurrentJobs: 3,
    maxJobsPerHour: 100,
    maxRetries: 3
  },
  professional: {
    maxConcurrentJobs: 10,
    maxJobsPerHour: 500,
    maxRetries: 5
  },
  enterprise: {
    maxConcurrentJobs: 50,
    maxJobsPerHour: 5000,
    maxRetries: 10
  }
};
```

### Failure Isolation

```typescript
// Each tenant's job failures don't affect others
async function processJob(job: TenantJob) {
  try {
    await executeJob(job);
  } catch (error) {
    // Log to tenant-specific error tracker
    await logJobError(job.tenant_id, job.id, error);
    
    // Increment tenant-specific failure counter
    await incrementTenantFailureCount(job.tenant_id);
    
    // Circuit breaker: if tenant has too many failures, pause their jobs
    if (await getTenantFailureCount(job.tenant_id) > FAILURE_THRESHOLD) {
      await pauseTenantJobs(job.tenant_id, '1h');
      await notifyTenantAdmin(job.tenant_id, 'Jobs paused due to repeated failures');
    }
    
    throw error; // Re-throw for retry logic
  }
}
```

---

## 8️⃣ Observability Per Tenant (Gap Fix)

### Per-Tenant Metrics

```typescript
// utils/tenantMetrics.ts
import { Counter, Histogram } from 'prom-client';

// Error tracking per tenant
const errorCounter = new Counter({
  name: 'opside_errors_total',
  help: 'Total errors by tenant and type',
  labelNames: ['tenant_id', 'error_type', 'service']
});

// Request latency per tenant
const requestLatency = new Histogram({
  name: 'opside_request_duration_seconds',
  help: 'Request latency by tenant',
  labelNames: ['tenant_id', 'endpoint', 'method'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

// Recovery value per tenant
const recoveryValue = new Counter({
  name: 'opside_recovery_value_cents',
  help: 'Total recovery value in cents by tenant',
  labelNames: ['tenant_id', 'status']
});

// Usage tracking
export function trackTenantUsage(tenantId: string, metric: string, value: number) {
  // Store in time-series for billing/analytics
}
```

### Tenant Health Dashboard

```typescript
// GET /api/admin/tenants/:tenantId/health
interface TenantHealth {
  tenantId: string;
  status: 'healthy' | 'degraded' | 'critical';
  metrics: {
    errorRate24h: number;
    avgLatencyMs: number;
    activeJobs: number;
    failedJobs24h: number;
    recoveryValue30d: number;
  };
  alerts: string[];
}
```

---

## 9️⃣ RLS & Service Role Documentation (Gap Fix)

### When RLS is ACTIVE (Supabase anon client)

| Context | RLS Active | Notes |
| :--- | :---: | :--- |
| Frontend direct queries | ✅ | User can only see their tenant data |
| Supabase Edge Functions | ✅ | Inherits user JWT |
| Realtime subscriptions | ✅ | Filtered by RLS |

### When RLS is BYPASSED (supabaseAdmin)

| Context | RLS Bypassed | Reason |
| :--- | :---: | :--- |
| Backend API routes | ✅ | We enforce tenant filter in code |
| Background workers | ✅ | No user context, job contains tenant_id |
| Scheduled jobs | ✅ | System operations |
| Webhook handlers | ✅ | External service callbacks |
| Admin operations | ✅ | Internal tooling |

### Safety Guardrails

```typescript
// EVERY supabaseAdmin query MUST include tenant_id
// Use tenantGuard() to enforce

import { tenantGuard } from '@/utils/tenantGuard';

async function getDisputeById(disputeId: string, tenantId: string) {
  tenantGuard(tenantId); // Throws if missing
  
  const { data } = await supabaseAdmin
    .from('dispute_cases')
    .select('*')
    .eq('id', disputeId)
    .eq('tenant_id', tenantId)  // MANDATORY
    .single();
    
  return data;
}

// tenantGuard() implementation
export function tenantGuard(tenantId: string | undefined): asserts tenantId is string {
  if (!tenantId) {
    throw new Error('[SECURITY VIOLATION] Database operation attempted without tenant_id');
  }
}
```

---

## Migration Execution Order

| # | File | Description |
| :--- | :--- | :--- |
| 1 | `042_create_tenants_table.sql` | Create tenants + memberships + invitations tables |
| 2 | `043_create_audit_logs.sql` | Create audit_logs table |
| 3 | `044_add_tenant_id_columns.sql` | Add nullable tenant_id to all 35 tables |
| 4 | `045_add_soft_delete_columns.sql` | Add deleted_at to critical tables |
| 5 | `046_create_default_tenant.sql` | Insert default tenant |
| 6 | `047_backfill_tenant_ids.sql` | Populate existing records with default tenant |
| 7 | `048_add_tenant_constraints.sql` | Add NOT NULL + FK constraints |
| 8 | `049_add_tenant_indexes.sql` | Create all indexes |
| 9 | `050_update_rls_policies.sql` | Update all RLS policies for tenant isolation |
| 10 | `051_create_lifecycle_triggers.sql` | Add lifecycle enforcement triggers |

---

## Deliverables Checklist

### Database
- [ ] 10 SQL migration files  
- [ ] Tenant lifecycle state machine
- [ ] Soft delete columns
- [ ] Comprehensive indexes
- [ ] Audit logs table
- [ ] Updated RLS policies

### Backend
- [ ] `tenantMiddleware.ts` (new)
- [ ] `tenantScopedClient.ts` (new)  
- [ ] `auditService.ts` (new)
- [ ] `tenantGuard.ts` (new)
- [ ] Updated `userIdMiddleware.ts`
- [ ] Updated all 9 workers
- [ ] Tenant management API routes
- [ ] Plan limits enforcement

### Frontend
- [ ] `TenantContext.tsx` (new)
- [ ] `TenantSwitcher` component
- [ ] URL-based tenant routing `/app/:slug/*`
- [ ] Billing management UI

### Observability
- [ ] Per-tenant error tracking
- [ ] Per-tenant latency metrics
- [ ] Per-tenant usage analytics
- [ ] Tenant health dashboard

### Tests
- [ ] Tenant isolation tests
- [ ] Cross-tenant access denial tests
- [ ] Worker tenant validation tests
- [ ] RLS bypass safety tests
- [ ] Lifecycle state enforcement tests

### Documentation
- [ ] Developer guide: "How tenancy works"
- [ ] RLS bypass documentation
- [ ] Runbook: tenant lifecycle management

---

## Risk Mitigation

| Risk | Mitigation |
| :--- | :--- |
| Breaking existing users | Default tenant auto-created, safe backfill |
| Performance impact | Indexes added in dedicated migration |
| RLS bypass by admin client | tenantGuard() enforced in all queries |
| Worker isolation | Job payloads validated, queue partitioning |
| Data leaks | Audit logging for all sensitive operations |
| Billing disputes | 7-year financial record retention |

