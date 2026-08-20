import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';
import request from 'supertest';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for the safe HTTP approval boundary certification');

// Test mode preserves the full Express middleware stack but prevents the app from binding its normal port.
process.env.NODE_ENV = 'test';
// HTTP approval certification must not send email; provider delivery is certified separately using a disposable inbox.
process.env.RESEND_API_KEY = '';
process.env.INTERNAL_API_KEY = `ssv1-http-${crypto.randomUUID()}`;

const tag = `ssv1_http_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const now = new Date();
const ids = {
  tenantA: crypto.randomUUID(),
  tenantB: crypto.randomUUID(),
  userA: crypto.randomUUID(),
  userB: crypto.randomUUID(),
  detectionA: crypto.randomUUID(),
  caseA: crypto.randomUUID(),
  evidenceA: crypto.randomUUID(),
  subscriptionA: crypto.randomUUID(),
};

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { default: refundFilingWorker } = await import('../src/workers/refundFilingWorker');
    // The HTTP boundary certifies authentication, tenant scope, authoritative persistence, and signal resolution.
    // It deliberately replaces only downstream Amazon queue dispatch, which is not this test's boundary and
    // must never send a synthetic claim to Amazon.
    const originalAddJob = refundFilingWorker.addJob.bind(refundFilingWorker);
    (refundFilingWorker as any).addJob = async (caseId: string) => ({
      id: `certified-noop-${caseId}`,
      mode: 'queued',
      attempted: false,
      proofBacked: true,
    });

    try {
      const { default: app } = await import('../src/index');
      const { systemSignalService } = await import('../src/notifications/services/system_signal_service');

      await client.query(
        `INSERT INTO tenants (id, name, slug) VALUES
         ($1, $2, $3), ($4, $5, $6)`,
        [
          ids.tenantA, `${tag} Tenant A`, `${tag}-a`,
          ids.tenantB, `${tag} Tenant B`, `${tag}-b`,
        ],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, email, seller_id, amazon_seller_id, is_paid_beta) VALUES
         ($1, $2, $3, $4, $4, true), ($5, $6, $7, $8, $8, true)`,
        [
          ids.userA, ids.tenantA, `${tag}.a@example.test`, `${tag}-seller-a`,
          ids.userB, ids.tenantB, `${tag}.b@example.test`, `${tag}-seller-b`,
        ],
      );
      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, is_active, role) VALUES
         ($1, $2, true, 'owner'), ($3, $4, true, 'owner')`,
        [ids.tenantA, ids.userA, ids.tenantB, ids.userB],
      );
      await client.query(
        `INSERT INTO billing_subscriptions
         (id, provider, tenant_id, user_id, product_key, provider_plan_code, status, amount_subunits,
          currency, billing_interval, current_period_start, current_period_end, metadata, provider_response)
         VALUES ($1, 'paystack', $2, $3, 'recovery_workspace_monthly', $4, 'active', 100,
                 'USD', 'monthly', $5, $6, '{}'::jsonb, '{}'::jsonb)`,
        [
          ids.subscriptionA,
          ids.tenantA,
          ids.userA,
          `${tag}-plan`,
          new Date(now.getTime() - 60_000).toISOString(),
          new Date(now.getTime() + 86_400_000).toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO detection_results
         (id, tenant_id, seller_id, sync_id, anomaly_type, severity, estimated_value, confidence_score, evidence, source_type)
         VALUES ($1, $2, $3, $4, 'reimbursement_issue', 'high', 12500, 0.99, $5::jsonb, 'sp_api')`,
        [
          ids.detectionA,
          ids.tenantA,
          ids.userA,
          `${tag}-sync`,
          JSON.stringify({
            asin: 'B0CERT1234',
            order_id: '123-1234567-1234567',
            quantity: 1,
            report_date: now.toISOString(),
          }),
        ],
      );
      await client.query(
        `INSERT INTO dispute_cases
         (id, tenant_id, seller_id, detection_result_id, case_number, claim_amount, estimated_recovery_amount,
          case_type, provider, filing_status, eligibility_status, eligible_to_file, block_reasons,
          case_state, case_origin, evidence_attachments)
         VALUES
         ($1, $2, $3, $4, $5, 12500, 12500, 'generic_recovery', 'amazon', 'pending_approval',
          'READY', true, '[]'::jsonb, 'pending', 'detection_pipeline', $6::jsonb)`,
        [
          ids.caseA,
          ids.tenantA,
          ids.userA,
          ids.detectionA,
          `${tag}-case`,
          JSON.stringify({ asin: 'B0CERT1234', order_id: '123-1234567-1234567', quantity: 1, units: 1, unit_count: 1, match_confidence: 0.99, report_date: now.toISOString() }),
        ],
      );
      await client.query(
        `INSERT INTO evidence_documents
         (id, tenant_id, seller_id, doc_type, filename, raw_text, extracted, parsed_metadata, parser_status, document_date, total_amount)
         VALUES ($1, $2, $3, 'invoice', $4, $5, $6::jsonb, $6::jsonb, 'completed', $7, 12500)`,
        [
          ids.evidenceA,
          ids.tenantA,
          `${tag}-seller-a`,
          `${tag}-invoice.pdf`,
          `Synthetic invoice ${tag} for B0CERT1234`,
          JSON.stringify({
            asin: 'B0CERT1234',
            order_id: '123-1234567-1234567',
            items: [{ asin: 'B0CERT1234', quantity: 1, unit_cost: 12500 }],
          }),
          now.toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO dispute_evidence_links
         (tenant_id, dispute_case_id, evidence_document_id, relevance_score, matched_context)
         VALUES ($1, $2, $3, 1.0, $4::jsonb)`,
        [ids.tenantA, ids.caseA, ids.evidenceA, JSON.stringify({ certification: tag })],
      );

      const accepted = await systemSignalService.accept({
        tenantId: ids.tenantA,
        recipientUserId: ids.userA,
        eventType: 'case.approval_required',
        objectType: 'dispute_case',
        objectId: ids.caseA,
        businessTransitionKey: 'http_boundary_pending_approval',
        privateTitle: 'Approval required',
        privateBody: 'Synthetic safe certification case is ready for review.',
      });
      assertEqual(accepted.deduped, false, 'fixture must create exactly one approval-required canonical signal');

      const before = await client.query<{ filing_status: string; signal_state: string; action_state: string }>(
        `SELECT c.filing_status, n.signal_state, n.action_state
         FROM dispute_cases c
         JOIN notifications n ON n.id = $2
         WHERE c.id = $1`,
        [ids.caseA, accepted.notification.id],
      );
      assertEqual(before.rows[0]?.filing_status, 'pending_approval', 'fixture case must begin pending approval');
      assertEqual(before.rows[0]?.signal_state, 'open', 'fixture signal must begin open');
      assertEqual(before.rows[0]?.action_state, 'pending', 'fixture action must begin pending');

      const agent = request(app);
      const commonHeaders = {
        'x-internal-api-key': process.env.INTERNAL_API_KEY!,
        'content-type': 'application/json',
      };

      const crossTenant = await agent
        .post(`/api/disputes/approve-filing?tenantSlug=${encodeURIComponent(`${tag}-a`)}`)
        .set(commonHeaders)
        .set('x-user-id', ids.userB)
        .send({ dispute_id: ids.caseA });
      assert(crossTenant.status === 403 || crossTenant.status === 401, `cross-tenant request must be denied, received ${crossTenant.status}`);

      const afterDenied = await client.query<{ filing_status: string; signal_state: string; action_state: string }>(
        `SELECT c.filing_status, n.signal_state, n.action_state
         FROM dispute_cases c
         JOIN notifications n ON n.id = $2
         WHERE c.id = $1`,
        [ids.caseA, accepted.notification.id],
      );
      assertEqual(afterDenied.rows[0]?.filing_status, 'pending_approval', 'cross-tenant denial must not mutate case state');
      assertEqual(afterDenied.rows[0]?.signal_state, 'open', 'cross-tenant denial must not resolve signal');
      assertEqual(afterDenied.rows[0]?.action_state, 'pending', 'cross-tenant denial must not complete action');

      const approved = await agent
        .post(`/api/disputes/approve-filing?tenantSlug=${encodeURIComponent(`${tag}-a`)}`)
        .set(commonHeaders)
        .set('x-user-id', ids.userA)
        .send({ dispute_id: ids.caseA });
      assertEqual(approved.status, 200, `authenticated approval must succeed: ${JSON.stringify(approved.body)}`);
      assertEqual(approved.body?.success, true, 'approval response must confirm success');
      assertEqual(approved.body?.dispute_id, ids.caseA, 'approval response must name the approved case');

      const final = await client.query<{
        filing_status: string;
        eligibility_status: string;
        eligible_to_file: boolean;
        signal_state: string;
        action_state: string;
        seller_state: string;
        resolved_at: string | null;
      }>(
        `SELECT c.filing_status, c.eligibility_status, c.eligible_to_file,
                n.signal_state, n.action_state, n.seller_state, n.resolved_at
         FROM dispute_cases c
         JOIN notifications n ON n.id = $2
         WHERE c.id = $1`,
        [ids.caseA, accepted.notification.id],
      );
      assertEqual(final.rows[0]?.filing_status, 'pending', 'approval must put case into pending filing state');
      assertEqual(final.rows[0]?.eligibility_status, 'READY', 'approval must preserve the re-evaluated ready state');
      assertEqual(final.rows[0]?.eligible_to_file, true, 'approval must retain filing eligibility');
      assertEqual(final.rows[0]?.signal_state, 'resolved', 'approval must resolve the open canonical signal');
      assertEqual(final.rows[0]?.action_state, 'completed', 'approval must complete the canonical action state');
      assert(Boolean(final.rows[0]?.resolved_at), 'approval resolution must persist a resolved timestamp');

      console.log(`HTTP_APPROVAL_BOUNDARY_CERTIFICATION=${JSON.stringify({
        caseId: ids.caseA.slice(0, 8),
        notificationId: accepted.notification.id.slice(0, 8),
        crossTenantStatus: crossTenant.status,
        approvedStatus: approved.status,
        finalCaseStatus: final.rows[0]?.filing_status,
        finalSignalState: final.rows[0]?.signal_state,
        finalActionState: final.rows[0]?.action_state,
      })}`);
    } finally {
      (refundFilingWorker as any).addJob = originalAddJob;
    }
  } finally {
    await client.query(`DELETE FROM notification_signal_deliveries WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM notifications WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM dispute_evidence_links WHERE tenant_id = $1`, [ids.tenantA]).catch(() => undefined);
    await client.query(`DELETE FROM evidence_documents WHERE tenant_id = $1`, [ids.tenantA]).catch(() => undefined);
    await client.query(`DELETE FROM dispute_cases WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM detection_results WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM billing_subscriptions WHERE id = $1`, [ids.subscriptionA]).catch(() => undefined);
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
