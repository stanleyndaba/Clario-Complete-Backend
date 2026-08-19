import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { Client } from 'pg';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for the safe System Signals certification run');

process.env.RESEND_API_KEY = '';

const tag = `ssv1_cert_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const ids = {
  tenantA: crypto.randomUUID(),
  tenantB: crypto.randomUUID(),
  userA: crypto.randomUUID(),
  userB: crypto.randomUUID(),
  detectionA: crypto.randomUUID(),
  detectionB: crypto.randomUUID(),
  caseA: crypto.randomUUID(),
  caseB: crypto.randomUUID()
};

type CertificationSummary = {
  canonicalSignalId: string;
  canonicalNotificationId: string;
  secondTransitionSignalId: string;
  deadlineSignalCount: number;
  notificationCount: number;
  inAppDeliveryCount: number;
  tenantBSignalVisibility: number;
  readBeforeApprovalState: string | null;
  resolvedState: string | null;
  resolvedActionState: string | null;
  legacyReadState: string | null;
  privacySubject: string;
  privacySummary: string;
  providerUnmatchedCount: number;
  amazonProviderState: string | null;
  realtimeDeliveryStatus: string | null;
  emailDeliveryStatus: string | null;
  reconciliationUnmatchedCount: number;
};

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { systemSignalService } = await import('../src/notifications/services/system_signal_service');
    const { default: Notification, NotificationStatus, NotificationType } = await import('../src/notifications/models/notification');
    const { buildNotificationEmailViewModel } = await import('../src/notifications/services/delivery/email_presenter');

    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES
       ($1, $2, $3), ($4, $5, $6)`,
      [ids.tenantA, `${tag} Tenant A`, `${tag}-a`, ids.tenantB, `${tag} Tenant B`, `${tag}-b`]
    );
    await client.query(
      `INSERT INTO users (id, tenant_id, email, seller_id, amazon_seller_id) VALUES
       ($1, $2, $3, $4, $4), ($5, $6, $7, $8, $8)`,
      [
        ids.userA, ids.tenantA, `${tag}.a@example.test`, `${tag}-seller-a`,
        ids.userB, ids.tenantB, `${tag}.b@example.test`, `${tag}-seller-b`
      ]
    );
    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, is_active) VALUES
       ($1, $2, true), ($3, $4, true)`,
      [ids.tenantA, ids.userA, ids.tenantB, ids.userB]
    );
    await client.query(
      `INSERT INTO detection_results
       (id, tenant_id, seller_id, sync_id, anomaly_type, severity, estimated_value, confidence_score, evidence, source_type)
       VALUES
       ($1, $2, $3, $4, 'missing_unit', 'high', 12400, 0.98, $5::jsonb, 'sp_api'),
       ($6, $7, $8, $9, 'missing_unit', 'high', 120, 0.98, $10::jsonb, 'sp_api')`,
      [
        ids.detectionA, ids.tenantA, ids.userA, `${tag}-sync-a`, JSON.stringify({ certification: tag }),
        ids.detectionB, ids.tenantB, ids.userB, `${tag}-sync-b`, JSON.stringify({ certification: tag })
      ]
    );
    await client.query(
      `INSERT INTO dispute_cases
       (id, tenant_id, seller_id, detection_result_id, case_number, claim_amount, case_type, provider,
        filing_status, eligibility_status, eligible_to_file, block_reasons, case_state, case_origin)
       VALUES
       ($1, $2, $3, $4, $5, 12400, 'amazon_fba', 'amazon', 'pending_approval', 'READY', true, '[]'::jsonb, 'pending', 'detection_pipeline'),
       ($6, $7, $8, $9, $10, 120, 'amazon_fba', 'amazon', 'pending_approval', 'READY', true, '[]'::jsonb, 'pending', 'detection_pipeline')`,
      [
        ids.caseA, ids.tenantA, ids.userA, ids.detectionA, `${tag}-case-a`,
        ids.caseB, ids.tenantB, ids.userB, ids.detectionB, `${tag}-case-b`
      ]
    );

    const approvalInput = {
      tenantId: ids.tenantA,
      recipientUserId: ids.userA,
      eventType: 'case.approval_required' as const,
      objectType: 'dispute_case',
      objectId: ids.caseA,
      businessTransitionKey: 'pending_approval:certification',
      privateTitle: 'Approval required',
      privateBody: 'Evidence is ready for review.',
      detailedBody: 'Synthetic case detail for safe certification only.'
    };
    const first = await systemSignalService.accept(approvalInput);
    assertEqual(first.deduped, false, 'first approved fixture transition must create a signal');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const duplicate = await systemSignalService.accept(approvalInput);
      assertEqual(duplicate.deduped, true, `duplicate attempt ${attempt + 2} must resolve to the existing signal`);
      assertEqual(duplicate.signalId, first.signalId, 'duplicate attempts must retain canonical signal identity');
    }

    const canonicalRows = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE tenant_id = $1 AND dedupe_key = $2`,
      [ids.tenantA, first.notification.dedupe_key]
    );
    assertEqual(canonicalRows.rows[0]?.count, '1', 'five identical transitions must create one notification row');
    const deliveryRows = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM notification_signal_deliveries
       WHERE notification_id = $1 AND channel = 'in_app'`,
      [first.notification.id]
    );
    assertEqual(deliveryRows.rows[0]?.count, '1', 'canonical signal must create one in-app delivery row');
    const deliveryStates = await client.query<{ channel: string; status: string }>(
      `SELECT channel, status FROM notification_signal_deliveries WHERE notification_id = $1 ORDER BY channel`,
      [first.notification.id]
    );
    const deliveryByChannel = new Map(deliveryStates.rows.map((row) => [row.channel, row.status]));
    assertEqual(deliveryByChannel.get('in_app'), 'persisted', 'in-app delivery must record persisted truth');
    assertEqual(deliveryByChannel.get('realtime'), 'attempted', 'realtime transport must record attempted truth');

    const changedTransition = await systemSignalService.accept({
      ...approvalInput,
      businessTransitionKey: 'pending_approval:certification:material_change'
    });
    assertEqual(changedTransition.deduped, false, 'a materially changed transition must create a distinct signal');

    const deadlineInput = {
      tenantId: ids.tenantA,
      recipientUserId: ids.userA,
      eventType: 'deadline.critical' as const,
      objectType: 'detection_result',
      objectId: ids.detectionA,
      businessTransitionKey: 'deadline_band:critical',
      policyWindowKey: '2030-01-15',
      privateTitle: 'Claim deadline requires attention',
      privateBody: 'This recovery deadline requires immediate review.'
    };
    const deadlineOne = await systemSignalService.accept(deadlineInput);
    const deadlineTwo = await systemSignalService.accept(deadlineInput);
    assertEqual(deadlineOne.signalId, deadlineTwo.signalId, 'same deadline threshold band must remain idempotent');
    assertEqual(deadlineTwo.deduped, true, 'second deadline run must dedupe');
    const deadlineRows = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE tenant_id = $1 AND signal_event_type = 'deadline.critical' AND signal_object_id = $2`,
      [ids.tenantA, ids.detectionA]
    );
    assertEqual(deadlineRows.rows[0]?.count, '1', 'deadline scheduler rerun must not create a second signal');

    let crossTenantDenied = false;
    try {
      await systemSignalService.accept({
        ...approvalInput,
        recipientUserId: ids.userB,
        businessTransitionKey: 'cross_tenant_attempt'
      });
    } catch (error) {
      crossTenantDenied = String(error).includes('SYSTEM_SIGNAL_RECIPIENT_NOT_FOUND_FOR_TENANT');
    }
    assertEqual(crossTenantDenied, true, 'Tenant A must not create a signal for Tenant B user without membership');

    const tenantBVisibility = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND id = $3`,
      [ids.tenantB, ids.userB, first.notification.id]
    );
    assertEqual(tenantBVisibility.rows[0]?.count, '0', 'Tenant B cannot list Tenant A signal by tenant/user scope');
    let acknowledgementDenied = false;
    try {
      await systemSignalService.acknowledge(first.notification, ids.tenantB, ids.userB);
    } catch (error) {
      acknowledgementDenied = String(error).includes('SYSTEM_SIGNAL_ACCESS_DENIED');
    }
    assertEqual(acknowledgementDenied, true, 'Tenant B cannot acknowledge Tenant A signal');
    const crossTenantResolution = await systemSignalService.resolveOpenSignalsForObject({
      tenantId: ids.tenantB,
      objectType: 'dispute_case',
      objectId: ids.caseA,
      actionType: 'approve_filing',
      resolutionReason: 'cross_tenant_attempt'
    });
    assertEqual(crossTenantResolution, 0, 'Tenant B cannot resolve Tenant A signal');

    const readBeforeApproval = await Notification.findById(first.notification.id);
    assert(readBeforeApproval, 'canonical notification must be retrievable from the real database');
    await readBeforeApproval.markAsRead();
    const afterRead = await client.query<{ signal_state: string | null; action_state: string | null; seller_state: string | null }>(
      `SELECT signal_state, action_state, seller_state FROM notifications WHERE id = $1`,
      [first.notification.id]
    );
    assertEqual(afterRead.rows[0]?.signal_state, 'open', 'reading must not resolve a signal');
    assertEqual(afterRead.rows[0]?.action_state, 'pending', 'reading must not complete required action');
    assertEqual(afterRead.rows[0]?.seller_state, 'read', 'read interaction must persist independently');

    await client.query(
      `UPDATE dispute_cases
       SET filing_status = 'pending', eligibility_status = 'READY', eligible_to_file = true, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [ids.caseA, ids.tenantA]
    );
    const resolvedCount = await systemSignalService.resolveOpenSignalsForObject({
      tenantId: ids.tenantA,
      objectType: 'dispute_case',
      objectId: ids.caseA,
      actionType: 'approve_filing',
      actionState: 'completed',
      resolutionReason: 'seller_approved_filing_certification'
    });
    assertEqual(resolvedCount, 2, 'approval completion must resolve the open approval signals for the same case');
    const resolved = await client.query<{ signal_state: string | null; action_state: string | null; resolved_at: Date | null }>(
      `SELECT signal_state, action_state, resolved_at FROM notifications WHERE id = $1`,
      [first.notification.id]
    );
    assertEqual(resolved.rows[0]?.signal_state, 'resolved', 'authoritative approval completion must resolve signal');
    assertEqual(resolved.rows[0]?.action_state, 'completed', 'authoritative approval completion must complete action');
    assert(Boolean(resolved.rows[0]?.resolved_at), 'resolved signal must have a resolved timestamp');

    const financialSignal = await systemSignalService.accept({
      tenantId: ids.tenantA,
      recipientUserId: ids.userA,
      eventType: 'reconciliation.review_required',
      objectType: 'recovery',
      objectId: `${tag}-recovery`,
      businessTransitionKey: 'financial_sensitive_certification',
      privateTitle: 'Recovery reconciliation requires review',
      privateBody: 'R12,400, Case #882, ASIN B0CERT, SKU CERT-SKU, supplier Cert Supplier, invoice INV-882, and QuickBooks QB-882 are available in authenticated detail.',
      detailedBody: 'Synthetic internal financial detail only.',
      externalTitle: 'Recovery action required',
      externalBody: 'A recovery requires your review in Margin.'
    });
    const emailView = buildNotificationEmailViewModel(financialSignal.notification as any, { frontendUrl: 'https://margin-finance.com' });
    for (const forbidden of ['R12,400', 'Case #882', 'B0CERT', 'CERT-SKU', 'Cert Supplier', 'INV-882', 'QuickBooks', 'QB-882']) {
      assert(!emailView.email_subject.includes(forbidden), `external subject leaked ${forbidden}`);
      assert(!emailView.email_summary.includes(forbidden), `external summary leaked ${forbidden}`);
    }

    const amazonAuth = await systemSignalService.accept({
      tenantId: ids.tenantA,
      recipientUserId: ids.userA,
      eventType: 'integration.amazon.authentication_invalid',
      objectType: 'integration_connection',
      objectId: 'amazon',
      businessTransitionKey: 'certification_401',
      privateTitle: 'Amazon connection requires attention',
      privateBody: 'Recovery monitoring is paused until access is restored.'
    });
    const unmatchedBefore = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE tenant_id = $1 AND signal_event_type = 'reconciliation.unmatched'`,
      [ids.tenantA]
    );
    assertEqual(unmatchedBefore.rows[0]?.count, '0', 'provider authentication failure must not become reconciliation.unmatched');
    assertEqual(amazonAuth.notification.signal_provider_state, 'seller_auth_failure', 'Amazon 401 must remain seller auth failure');
    const unmatchedOutcome = await systemSignalService.accept({
      tenantId: ids.tenantA,
      recipientUserId: ids.userA,
      eventType: 'reconciliation.unmatched',
      objectType: 'recovery',
      objectId: `${tag}-successful-search`,
      businessTransitionKey: 'successful_search_no_credible_match',
      privateTitle: 'Recovery reconciliation completed',
      privateBody: 'No credible accounting match was found in the completed search.'
    });
    assertEqual(unmatchedOutcome.notification.signal_provider_state, 'business_outcome', 'successful no-match outcome must remain a business outcome');
    const unmatchedAfter = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE tenant_id = $1 AND signal_event_type = 'reconciliation.unmatched'`,
      [ids.tenantA]
    );
    assertEqual(unmatchedAfter.rows[0]?.count, '1', 'successful search with no credible match must create reconciliation.unmatched');

    const legacy = await Notification.create({
      user_id: ids.userA,
      tenant_id: ids.tenantA,
      type: NotificationType.SYNC_COMPLETED,
      title: 'Legacy certification notification',
      message: 'No canonical metadata is present.'
    });
    assertEqual(legacy.system_signal_id, null, 'legacy notification must remain valid without System Signal metadata');
    const legacyList = await Notification.findMany({ user_id: ids.userA, tenant_id: ids.tenantA });
    assert(legacyList.some((row) => row.id === legacy.id), 'legacy notification must remain listable');
    await legacy.markAsRead();
    const legacyAfterRead = await client.query<{ status: string }>(`SELECT status FROM notifications WHERE id = $1`, [legacy.id]);
    assertEqual(legacyAfterRead.rows[0]?.status, NotificationStatus.READ, 'legacy notification must retain mark-read behavior');
    await Notification.markAllAsRead(ids.userA, ids.tenantA);

    const finalCanonical = await client.query<{
      id: string;
      system_signal_id: string;
      signal_event_type: string;
      signal_severity: string;
      signal_sensitivity: string;
      signal_delivery_policy: string;
      signal_state: string;
      seller_state: string;
      action_state: string;
    }>(
      `SELECT id, system_signal_id, signal_event_type, signal_severity, signal_sensitivity,
              signal_delivery_policy, signal_state, seller_state, action_state
       FROM notifications WHERE id = $1`,
      [first.notification.id]
    );
    const totalNotifications = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM notifications WHERE tenant_id = $1`, [ids.tenantA]);

    const summary: CertificationSummary = {
      canonicalSignalId: String(finalCanonical.rows[0]?.system_signal_id || '').slice(0, 8),
      canonicalNotificationId: String(finalCanonical.rows[0]?.id || '').slice(0, 8),
      secondTransitionSignalId: changedTransition.signalId.slice(0, 8),
      deadlineSignalCount: Number(deadlineRows.rows[0]?.count || 0),
      notificationCount: Number(totalNotifications.rows[0]?.count || 0),
      inAppDeliveryCount: Number(deliveryRows.rows[0]?.count || 0),
      tenantBSignalVisibility: Number(tenantBVisibility.rows[0]?.count || 0),
      readBeforeApprovalState: afterRead.rows[0]?.signal_state || null,
      resolvedState: resolved.rows[0]?.signal_state || null,
      resolvedActionState: resolved.rows[0]?.action_state || null,
      legacyReadState: legacyAfterRead.rows[0]?.status || null,
      privacySubject: emailView.email_subject,
      privacySummary: emailView.email_summary,
      providerUnmatchedCount: Number(unmatchedBefore.rows[0]?.count || 0),
      amazonProviderState: amazonAuth.notification.signal_provider_state || null,
      realtimeDeliveryStatus: deliveryByChannel.get('realtime') || null,
      emailDeliveryStatus: deliveryByChannel.get('email') || null,
      reconciliationUnmatchedCount: Number(unmatchedAfter.rows[0]?.count || 0)
    };
    console.log(`SYSTEM_SIGNALS_REAL_DB_CERTIFICATION=${JSON.stringify(summary)}`);
  } finally {
    await client.query(`DELETE FROM notification_signal_deliveries WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM notifications WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM dispute_cases WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM detection_results WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM tenant_memberships WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.userA, ids.userB]]).catch(() => undefined);
    await client.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
