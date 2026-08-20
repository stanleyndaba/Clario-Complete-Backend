import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for the safe launch-critical producer certification');

// Producer tests must never send provider email. Canonical persistence and in-app
// delivery remain covered by the real foundation while external credentials stay off.
process.env.RESEND_API_KEY = '';
process.env.REDIS_URL = '';

const tag = `ssv1_launch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const ids = {
  tenantId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  connectedAuditId: crypto.randomUUID(),
  manualAuditId: crypto.randomUUID(),
  partialAuditId: crypto.randomUUID(),
  caseId: crypto.randomUUID(),
  retryCaseId: crypto.randomUUID(),
};

function assertEqual<T>(actual: T, expected: T, message: string) {
  assert.equal(actual, expected, message);
}

async function countSignals(client: Client, eventType: string, objectId: string) {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM notifications
     WHERE tenant_id = $1
       AND signal_event_type = $2
       AND signal_object_id = $3`,
    [ids.tenantId, eventType, objectId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function cleanup(client: Client) {
  await client.query(
    `DELETE FROM notification_signal_deliveries
     WHERE notification_id IN (SELECT id FROM notifications WHERE tenant_id = $1)`,
    [ids.tenantId]
  );
  await client.query(`DELETE FROM notifications WHERE tenant_id = $1`, [ids.tenantId]);
  await client.query(`DELETE FROM refund_filing_errors WHERE user_id = $1`, [ids.userId]);
  await client.query(`DELETE FROM case_messages WHERE tenant_id = $1`, [ids.tenantId]);
  await client.query(`DELETE FROM dispute_cases WHERE tenant_id = $1`, [ids.tenantId]);
  await client.query(`DELETE FROM audit_control_statements WHERE tenant_id = $1`, [ids.tenantId]);
  await client.query(`DELETE FROM audit_runs WHERE tenant_id = $1`, [ids.tenantId]);
  await client.query(`DELETE FROM tenant_memberships WHERE tenant_id = $1`, [ids.tenantId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [ids.userId]);
  // User and membership lifecycle triggers can create audit records during teardown.
  // Delete them last, immediately before the synthetic tenant is removed.
  await client.query(`DELETE FROM audit_logs WHERE tenant_id = $1`, [ids.tenantId]);
  await client.query(`DELETE FROM tenants WHERE id = $1`, [ids.tenantId]);
}

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { auditRunService } = await import('../src/services/auditRunService');
    const { default: amazonCaseThreadService } = await import('../src/services/amazonCaseThreadService');
    const { default: refundFilingWorker } = await import('../src/workers/refundFilingWorker');
    const { systemSignalService } = await import('../src/notifications/services/system_signal_service');

    const now = new Date().toISOString();
    const findingsSummary = {
      finalStatus: 'complete_with_findings', findingsCount: 2, recordsReviewed: 24,
      evidenceReadyCount: 1, sourcesUnavailable: [], sourcesReviewed: ['Orders'], scopeValue: 100,
    };
    const cleanSummary = {
      finalStatus: 'complete_no_findings', findingsCount: 0, recordsReviewed: 24,
      evidenceReadyCount: 0, sourcesUnavailable: [], sourcesReviewed: ['Orders'], scopeValue: 0,
    };
    const partialSummary = {
      finalStatus: 'partial_no_findings', findingsCount: 0, recordsReviewed: 0,
      evidenceReadyCount: 0, sourcesUnavailable: ['Settlements'], sourcesReviewed: ['Orders'], scopeValue: 0,
    };

    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)`,
      [ids.tenantId, `${tag} Tenant`, tag]
    );
    await client.query(
      `INSERT INTO users (id, tenant_id, email, seller_id, amazon_seller_id)
       VALUES ($1, $2, $3, $4, $4)`,
      [ids.userId, ids.tenantId, `${tag}@example.test`, `${tag}-seller`]
    );
    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, is_active) VALUES ($1, $2, true)`,
      [ids.tenantId, ids.userId]
    );
    await client.query(
      `INSERT INTO audit_runs (id, user_id, tenant_id, sync_id, status, source_type, summary, completed_at)
       VALUES
       ($1, $2, $3, $4, 'completed', 'sp_api', $5::jsonb, $6),
       ($7, $2, $3, $8, 'completed', 'csv_upload', $9::jsonb, $6),
       ($10, $2, $3, $11, 'completed', 'csv_upload', $12::jsonb, $6)`,
      [
        ids.connectedAuditId, ids.userId, ids.tenantId, `${tag}-sync-connected`, JSON.stringify(findingsSummary), now,
        ids.manualAuditId, `${tag}-sync-manual`, JSON.stringify(cleanSummary),
        ids.partialAuditId, `${tag}-sync-partial`, JSON.stringify(partialSummary),
      ]
    );

    const persistedAudits = await client.query<any>(
      `SELECT * FROM audit_runs WHERE tenant_id = $1 ORDER BY created_at`, [ids.tenantId]
    );
    const byId = new Map(persistedAudits.rows.map((row) => [row.id, row]));
    const emitAudit = (auditRunService as any).emitCompletedAuditSignal.bind(auditRunService);
    for (let index = 0; index < 5; index += 1) {
      await emitAudit(byId.get(ids.connectedAuditId), findingsSummary);
      await emitAudit(byId.get(ids.manualAuditId), cleanSummary);
      await emitAudit(byId.get(ids.partialAuditId), partialSummary);
    }
    assertEqual(await countSignals(client, 'audit.completed_findings', ids.connectedAuditId), 1, 'five connected completion executions must create one findings signal');
    assertEqual(await countSignals(client, 'audit.completed_no_findings', ids.manualAuditId), 1, 'five manual completion executions must create one clean-completion signal');
    assertEqual(await countSignals(client, 'audit.completed_findings', ids.partialAuditId), 0, 'partial audit must not be misrepresented as a complete findings signal');
    assertEqual(await countSignals(client, 'audit.completed_no_findings', ids.partialAuditId), 0, 'partial audit must not be misrepresented as a clean-completion signal');
    assertEqual(await countSignals(client, 'integration.amazon.authentication_invalid', ids.manualAuditId), 0, 'manual CSV completion must not produce an Amazon connection signal');

    await client.query(
      `INSERT INTO dispute_cases
       (id, tenant_id, seller_id, case_number, amazon_case_id, claim_amount, case_type, provider,
        filing_status, eligibility_status, eligible_to_file, block_reasons, case_state, case_origin, evidence_attachments)
       VALUES
       ($1, $2, $3, $4, $5, 100, 'amazon_fba', 'amazon', 'pending', 'READY', true, '[]'::jsonb, 'pending', 'detection_pipeline', '{}'::jsonb),
       ($6, $2, $3, $7, $8, 90, 'amazon_fba', 'amazon', 'pending', 'READY', true, '[]'::jsonb, 'pending', 'detection_pipeline', '{}'::jsonb)`,
      [ids.caseId, ids.tenantId, ids.userId, `${tag}-case`, `${tag}-amazon-case`, ids.retryCaseId, `${tag}-retry-case`, `${tag}-retry-amazon-case`]
    );

    await client.query(
      `INSERT INTO case_messages
       (tenant_id, dispute_case_id, amazon_case_id, provider, provider_message_id, direction, subject, body_text, state_signal, received_at)
       VALUES ($1, $2, $3, 'gmail', $4, 'inbound', 'Amazon case update', 'We received your case update.', 'pending', $5)`,
      [ids.tenantId, ids.caseId, `${tag}-amazon-case`, `${tag}-message-pending`, now]
    );
    const caseRecord = {
      id: ids.caseId, seller_id: ids.userId, case_number: `${tag}-case`, tenant_id: ids.tenantId,
    };
    const emitCase = (amazonCaseThreadService as any).emitCaseStateNotification.bind(amazonCaseThreadService);
    for (let index = 0; index < 5; index += 1) {
      await emitCase({
        tenantId: ids.tenantId, disputeCase: caseRecord, amazonCaseId: `${tag}-amazon-case`,
        providerMessageId: `${tag}-message-pending`, nextState: 'pending', subject: 'Amazon case update', bodyText: 'We received your case update.'
      });
    }
    assertEqual(await countSignals(client, 'case.amazon_response_received', ids.caseId), 1, 'five inbound Amazon message replays must create one response signal');

    await client.query(
      `UPDATE dispute_cases SET case_state = 'needs_evidence', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [ids.caseId, ids.tenantId]
    );
    await client.query(
      `INSERT INTO case_messages
       (tenant_id, dispute_case_id, amazon_case_id, provider, provider_message_id, direction, subject, body_text, state_signal, received_at)
       VALUES ($1, $2, $3, 'gmail', $4, 'inbound', 'Additional evidence requested', 'Please provide the invoice.', 'needs_evidence', $5)`,
      [ids.tenantId, ids.caseId, `${tag}-amazon-case`, `${tag}-message-evidence`, now]
    );
    for (let index = 0; index < 5; index += 1) {
      await emitCase({
        tenantId: ids.tenantId, disputeCase: caseRecord, amazonCaseId: `${tag}-amazon-case`,
        providerMessageId: `${tag}-message-evidence`, nextState: 'needs_evidence', subject: 'Additional evidence requested', bodyText: 'Please provide the invoice.'
      });
    }
    assertEqual(await countSignals(client, 'case.evidence_requested', ids.caseId), 1, 'five evidence-request message replays must create one canonical signal');

    await client.query(
      `INSERT INTO case_messages
       (tenant_id, dispute_case_id, amazon_case_id, provider, provider_message_id, direction, subject, body_text, attachments, sent_at)
       VALUES ($1, $2, $3, 'gmail', $4, 'outbound', 'Evidence response', 'Attached evidence supplied.', $5::jsonb, $6)`,
      [ids.tenantId, ids.caseId, `${tag}-amazon-case`, `${tag}-message-evidence-reply`, JSON.stringify([{ evidence_document_id: `${tag}-document` }]), now]
    );
    const resolvedEvidence = await systemSignalService.resolveOpenSignalsForObject({
      tenantId: ids.tenantId, objectType: 'dispute_case', objectId: ids.caseId,
      actionType: 'review_evidence', eventType: 'case.evidence_requested',
      actionState: 'completed', resolutionReason: 'evidence_response_sent'
    });
    assertEqual(resolvedEvidence, 1, 'persisted evidence reply must resolve the one matching evidence-request signal');
    const evidenceState = await client.query<{ signal_state: string; action_state: string }>(
      `SELECT signal_state, action_state FROM notifications
       WHERE tenant_id = $1 AND signal_event_type = 'case.evidence_requested' AND signal_object_id = $2`,
      [ids.tenantId, ids.caseId]
    );
    assertEqual(evidenceState.rows[0]?.signal_state, 'resolved', 'evidence reply must resolve, not merely acknowledge, the signal');
    assertEqual(evidenceState.rows[0]?.action_state, 'completed', 'evidence reply must complete the required action');

    const invokeTerminalFailure = (refundFilingWorker as any).handleFilingFailure.bind(refundFilingWorker);
    const terminalFailure = {
      success: false, status: 'failed', idempotency_key: `${tag}-terminal-attempt`,
      error_message: 'Synthetic terminal filing failure for safe certification only.'
    };
    for (let index = 0; index < 5; index += 1) {
      await invokeTerminalFailure(ids.caseId, ids.userId, terminalFailure, 2);
    }
    assertEqual(await countSignals(client, 'filing.failed', ids.caseId), 1, 'terminal filing replay must create one seller-impacting failure signal');
    const terminalState = await client.query<{ filing_status: string; state: string }>(
      `SELECT filing_status, evidence_attachments #>> '{decision_intelligence,operational_state}' AS state
       FROM dispute_cases WHERE id = $1 AND tenant_id = $2`,
      [ids.caseId, ids.tenantId]
    );
    assertEqual(terminalState.rows[0]?.filing_status, 'failed', 'filing failure signal requires persisted terminal filing status');
    assertEqual(terminalState.rows[0]?.state, 'FAILED_DURABLE', 'filing failure signal requires persisted durable operational state');

    await invokeTerminalFailure(ids.retryCaseId, ids.userId, {
      success: false, status: 'failed', idempotency_key: `${tag}-transient-attempt`, error_message: 'Synthetic retryable failure.'
    }, 0);
    assertEqual(await countSignals(client, 'filing.failed', ids.retryCaseId), 0, 'retryable filing failure must not create a seller signal');

    await client.query(
      `UPDATE dispute_cases SET filing_status = 'filed', status = 'submitted', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`, [ids.caseId, ids.tenantId]
    );
    const resolvedFailure = await systemSignalService.resolveOpenSignalsForObject({
      tenantId: ids.tenantId, objectType: 'dispute_case', objectId: ids.caseId,
      actionType: 'review_case', eventType: 'filing.failed',
      actionState: 'completed', resolutionReason: 'filing_submitted_after_failure'
    });
    assertEqual(resolvedFailure, 1, 'persisted successful filing must resolve the matching terminal failure signal');

    const summary = {
      auditFindingsSignals: await countSignals(client, 'audit.completed_findings', ids.connectedAuditId),
      manualAuditCleanSignals: await countSignals(client, 'audit.completed_no_findings', ids.manualAuditId),
      amazonResponseSignals: await countSignals(client, 'case.amazon_response_received', ids.caseId),
      evidenceRequestSignals: await countSignals(client, 'case.evidence_requested', ids.caseId),
      terminalFilingFailureSignals: await countSignals(client, 'filing.failed', ids.caseId),
      transientFilingFailureSignals: await countSignals(client, 'filing.failed', ids.retryCaseId),
    };
    console.log('LAUNCH_CRITICAL_PRODUCER_CERTIFICATION_PASS', JSON.stringify(summary));
  } finally {
    await cleanup(client);
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('LAUNCH_CRITICAL_PRODUCER_CERTIFICATION_FAILED', error);
    process.exit(1);
  });
