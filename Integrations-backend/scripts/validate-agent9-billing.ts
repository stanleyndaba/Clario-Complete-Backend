import 'dotenv/config';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../src/database/supabaseClient';
import billingCreditService from '../src/services/billingCreditService';
import billingService from '../src/services/billingService';
import billingWorker from '../src/workers/billingWorker';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function ensureValidationUser(tag: string) {
  const userId = randomUUID();
  const email = `${tag}-${userId.slice(0, 8)}@margin-validation.local`;

  const { error } = await supabaseAdmin
    .from('users')
    .insert({
      id: userId,
      email,
      amazon_seller_id: `AMZ-${tag}-${userId.slice(0, 8)}`,
      seller_id: userId,
      tenant_id: TENANT_ID,
      is_paid_beta: true
    });

  if (error) {
    throw new Error(`Failed to create validation user ${tag}: ${error.message}`);
  }

  return userId;
}

async function createValidationDetectionAndCase(userId: string, amount: number, tag: string) {
  const detectionId = randomUUID();
  const disputeId = randomUUID();
  const recoveryId = randomUUID();
  const syncId = `agent9-${tag}-${Date.now()}`;
  const caseNumber = `AG9-${tag.toUpperCase()}-${Date.now().toString().slice(-6)}`;

  const { error: detectionError } = await supabaseAdmin
    .from('detection_results')
    .insert({
      id: detectionId,
      seller_id: userId,
      tenant_id: TENANT_ID,
      sync_id: syncId,
      anomaly_type: 'missing_unit',
      severity: 'medium',
      estimated_value: amount,
      currency: 'USD',
      confidence_score: 0.92,
      evidence: { order_id: `ORDER-${tag}` },
      status: 'disputed'
    });

  if (detectionError) {
    throw new Error(`Failed to create validation detection ${tag}: ${detectionError.message}`);
  }

  const { error: disputeError } = await supabaseAdmin
    .from('dispute_cases')
    .insert({
      id: disputeId,
      seller_id: userId,
      tenant_id: TENANT_ID,
      detection_result_id: detectionId,
      case_number: caseNumber,
      status: 'approved',
      filing_status: 'pending',
      claim_amount: amount,
      actual_payout_amount: amount,
      currency: 'USD',
      case_type: 'amazon_fba',
      provider: 'amazon',
      recovery_status: 'reconciled',
      evidence_attachments: {},
      provider_response: {}
    });

  if (disputeError) {
    throw new Error(`Failed to create validation dispute case ${tag}: ${disputeError.message}`);
  }

  const { error: recoveryError } = await supabaseAdmin
    .from('recoveries')
    .insert({
      id: recoveryId,
      tenant_id: TENANT_ID,
      dispute_id: disputeId,
      user_id: userId,
      expected_amount: amount,
      actual_amount: amount,
      discrepancy: 0,
      reconciliation_status: 'reconciled',
      matched_at: new Date().toISOString(),
      reconciled_at: new Date().toISOString()
    });

  if (recoveryError) {
    throw new Error(`Failed to create validation recovery ${tag}: ${recoveryError.message}`);
  }

  return { detectionId, disputeId, recoveryId };
}

async function main() {
  const originalCharge = billingService.chargeCommissionWithRetry.bind(billingService);

  (billingService as any).chargeCommissionWithRetry = async (request: any) => ({
    success: true,
    status: 'sent',
    paypalInvoiceId: `SIM-${request.disputeId.slice(0, 8)}`,
    platformFeeCents: request.platformFeeCents,
    sellerPayoutCents: request.sellerPayoutCents,
    amountDueCents: request.amountDueCents,
    creditAppliedCents: request.creditAppliedCents
  });

  try {
    // Scenario A + B seller
    const sellerB = await ensureValidationUser('agent9b');
    const creditA = await billingCreditService.recordPriorityPrepaidCredit(
      { tenantId: TENANT_ID, userId: sellerB, sellerId: sellerB },
      `agent9-scenario-a-${sellerB}`,
      9900,
      'paypal'
    );
    const balanceAfterA = await billingCreditService.getAvailableCreditBalanceCents({
      tenantId: TENANT_ID, userId: sellerB, sellerId: sellerB
    });

    const scenarioBEntities = await createValidationDetectionAndCase(sellerB, 1750, 'scenario-b');
    const scenarioBResult = await billingWorker.processBillingForRecovery(
      scenarioBEntities.disputeId,
      scenarioBEntities.recoveryId,
      creditA.recoveryCycleId,
      sellerB,
      TENANT_ID,
      175000,
      'usd',
      0,
      `billing-recovery-${scenarioBEntities.recoveryId}`
    );

    const scenarioBRepeat = await billingWorker.processBillingForRecovery(
      scenarioBEntities.disputeId,
      scenarioBEntities.recoveryId,
      creditA.recoveryCycleId,
      sellerB,
      TENANT_ID,
      175000,
      'usd',
      0,
      `billing-recovery-${scenarioBEntities.recoveryId}`
    );

    const { data: scenarioBTx } = await supabaseAdmin
      .from('billing_transactions')
      .select('*')
      .eq('recovery_id', scenarioBEntities.recoveryId)
      .maybeSingle();

    const { data: scenarioBCountRows } = await supabaseAdmin
      .from('billing_transactions')
      .select('id')
      .eq('recovery_id', scenarioBEntities.recoveryId);

    // Scenario C seller
    const sellerC = await ensureValidationUser('agent9c');
    const creditC = await billingCreditService.recordPriorityPrepaidCredit(
      { tenantId: TENANT_ID, userId: sellerC, sellerId: sellerC },
      `agent9-scenario-c-${sellerC}`,
      9900,
      'paypal'
    );
    const scenarioCEntities = await createValidationDetectionAndCase(sellerC, 300, 'scenario-c');
    const scenarioCResult = await billingWorker.processBillingForRecovery(
      scenarioCEntities.disputeId,
      scenarioCEntities.recoveryId,
      creditC.recoveryCycleId,
      sellerC,
      TENANT_ID,
      30000,
      'usd',
      0,
      `billing-recovery-${scenarioCEntities.recoveryId}`
    );

    const { data: scenarioCTx } = await supabaseAdmin
      .from('billing_transactions')
      .select('*')
      .eq('recovery_id', scenarioCEntities.recoveryId)
      .maybeSingle();

    const balanceAfterC = await billingCreditService.getAvailableCreditBalanceCents({
      tenantId: TENANT_ID, userId: sellerC, sellerId: sellerC
    });

    const { count: reimbursementEventsCount } = await supabaseAdmin
      .from('financial_events')
      .select('*', { count: 'exact', head: true })
      .in('event_type', ['reimbursement', 'Reimbursement']);

    console.log(JSON.stringify({
      scenarioA: {
        credit_record_created: !!creditA.ledgerId,
        recovery_cycle_id: creditA.recoveryCycleId,
        credit_balance_cents: balanceAfterA
      },
      scenarioB: {
        billing_result: scenarioBResult,
        repeat_result: scenarioBRepeat,
        billing_transaction: scenarioBTx ? {
          id: scenarioBTx.id,
          platform_fee_cents: scenarioBTx.platform_fee_cents,
          credit_applied_cents: scenarioBTx.credit_applied_cents,
          amount_due_cents: scenarioBTx.amount_due_cents,
          credit_balance_after_cents: scenarioBTx.credit_balance_after_cents,
          paypal_invoice_id: scenarioBTx.paypal_invoice_id || scenarioBTx.metadata?.paypal_invoice_id || null
        } : null,
        billing_row_count: scenarioBCountRows?.length || 0
      },
      scenarioC: {
        billing_result: scenarioCResult,
        billing_transaction: scenarioCTx ? {
          id: scenarioCTx.id,
          platform_fee_cents: scenarioCTx.platform_fee_cents,
          credit_applied_cents: scenarioCTx.credit_applied_cents,
          amount_due_cents: scenarioCTx.amount_due_cents,
          credit_balance_after_cents: scenarioCTx.credit_balance_after_cents,
          billing_status: scenarioCTx.billing_status
        } : null,
        remaining_credit_cents: balanceAfterC
      },
      liveDb: {
        reimbursement_events: reimbursementEventsCount || 0
      }
    }, null, 2));
  } finally {
    (billingService as any).chargeCommissionWithRetry = originalCharge;
  }
}

main().catch((error) => {
  console.error('❌', error.message);
  process.exit(1);
});
