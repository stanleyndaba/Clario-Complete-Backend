import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SYSTEM_SIGNAL_EVENT_TYPES,
  SYSTEM_SIGNAL_REGISTRY,
  buildSignalDedupeKey,
  createActionRoute,
  getSystemSignalDefinition
} from '../src/notifications/systemSignals';
import { NotificationChannel } from '../src/notifications/models/notification';
import { buildNotificationEmailViewModel } from '../src/notifications/services/delivery/email_presenter';
import { normalizeAgent10EventPayload } from '../src/utils/agent10Event';

function expect(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message);
}

const requiredEvents = [
  'recovery.opportunity_identified',
  'case.approval_required',
  'deadline.critical',
  'payout.confirmed',
  'reconciliation.completed',
  'reconciliation.partial_match',
  'reconciliation.review_required',
  'reconciliation.unmatched',
  'integration.amazon.authentication_invalid',
  'integration.quickbooks.authentication_invalid',
  'integration.xero.authentication_invalid'
] as const;

for (const eventType of requiredEvents) {
  expect(SYSTEM_SIGNAL_EVENT_TYPES.includes(eventType), `Registry is missing ${eventType}`);
  const definition = getSystemSignalDefinition(eventType);
  expect(Boolean(definition.domain), `${eventType} must have a domain`);
  expect(Boolean(definition.deliveryPolicy), `${eventType} must have a delivery policy`);
  expect(Boolean(definition.defaultExternalTitle), `${eventType} must have external-safe copy`);
  expect(Boolean(definition.defaultExternalBody), `${eventType} must have external-safe summary`);
}

const baseDedupeInput = {
  eventType: 'case.approval_required' as const,
  tenantId: 'tenant-a',
  recipientUserId: 'user-a',
  objectType: 'dispute_case',
  objectId: 'case-a',
  businessTransitionKey: 'pending_approval:missing_evidence'
};
const dedupeA = buildSignalDedupeKey(baseDedupeInput);
const dedupeB = buildSignalDedupeKey(baseDedupeInput);
const dedupeC = buildSignalDedupeKey({ ...baseDedupeInput, businessTransitionKey: 'pending_approval:new_evidence' });
assert.equal(dedupeA, dedupeB, 'Identical business transitions must create identical dedupe keys');
assert.notEqual(dedupeA, dedupeC, 'A changed business transition must create a new dedupe key');
expect(dedupeA.startsWith('ss1:'), 'Dedupe keys must be versioned System Signal keys');

const approval = getSystemSignalDefinition('case.approval_required');
const approvalRoute = createActionRoute(approval, 'dispute_case', 'case-a');
assert.deepEqual(approvalRoute, {
  target: 'case',
  objectType: 'dispute_case',
  objectId: 'case-a',
  action: 'approve_filing',
  fallbackTarget: 'notifications'
});

assert.equal(
  SYSTEM_SIGNAL_REGISTRY['recovery.opportunity_identified'].requestedChannel,
  NotificationChannel.IN_APP,
  'Informational recovery opportunities must not become automatic email'
);
assert.equal(
  SYSTEM_SIGNAL_REGISTRY['payout.confirmed'].requestedChannel,
  NotificationChannel.IN_APP,
  'Informational payout confirmation must not become automatic email'
);
assert.equal(
  SYSTEM_SIGNAL_REGISTRY['deadline.critical'].requestedChannel,
  NotificationChannel.BOTH,
  'Critical deadline signals require in-app plus external escalation eligibility'
);
assert.equal(
  SYSTEM_SIGNAL_REGISTRY['integration.amazon.authentication_invalid'].providerState,
  'seller_auth_failure',
  'Amazon auth failure must remain distinct from provider outages'
);

const normalizedSignalPayload = normalizeAgent10EventPayload('notification', {
  system_signal: { signal_id: '22222222-2222-2222-2222-222222222222', event_type: 'payout.confirmed' }
}, { tenantId: 'tenant-a', entityType: 'recovery', entityId: 'recovery-a' });
assert.equal(normalizedSignalPayload.system_signal?.event_type, 'payout.confirmed');
assert.equal(normalizedSignalPayload.payload?.system_signal?.signal_id, '22222222-2222-2222-2222-222222222222');

const financialSignalEmail = buildNotificationEmailViewModel({
  id: '11111111-1111-1111-1111-111111111111',
  user_id: 'user-a',
  tenant_id: 'tenant-a',
  type: 'payment_processed',
  title: 'Recovery #CASE-4729 confirmed for $1,892.34',
  message: 'QuickBooks matched SKU B0ABCDEF to supplier invoice INV-948.',
  status: 'delivered',
  priority: 'high',
  channel: 'both',
  payload: {
    system_signal: {
      signal_id: '22222222-2222-2222-2222-222222222222',
      external_title: 'Recovery action required',
      external_body: 'A recovery requires your review in Margin.',
      action_type: 'review_reconciliation'
    }
  },
  system_signal_id: '22222222-2222-2222-2222-222222222222',
  signal_sensitivity: 'financial_sensitive',
  external_title: 'Recovery action required',
  external_body: 'A recovery requires your review in Margin.',
  created_at: new Date(),
  updated_at: new Date()
} as any, { frontendUrl: 'https://margin-finance.com' });
for (const forbiddenValue of ['$1,892.34', 'CASE-4729', 'B0ABCDEF', 'INV-948', 'QuickBooks', 'supplier']) {
  expect(!financialSignalEmail.email_subject.includes(forbiddenValue), `External subject leaked ${forbiddenValue}`);
  expect(!financialSignalEmail.email_summary.includes(forbiddenValue), `External summary leaked ${forbiddenValue}`);
}
assert.equal(financialSignalEmail.email_subject, 'Recovery action required');
assert.equal(financialSignalEmail.email_summary, 'A recovery requires your review in Margin.');

const migrationPath = path.join(__dirname, '..', 'migrations', '125_system_signals_v1_foundation.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
for (const requiredFragment of [
  'ADD COLUMN IF NOT EXISTS system_signal_id UUID',
  'signal_event_type TEXT',
  'notification_signal_deliveries',
  'uq_notification_signal_delivery_channel',
  'client_received_at',
  'tenant_id UUID NOT NULL'
]) {
  expect(migration.includes(requiredFragment), `Migration must include ${requiredFragment}`);
}

console.log('System Signals V1 contract checks passed.');
