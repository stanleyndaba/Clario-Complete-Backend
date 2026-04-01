/**
 * Billing Worker
 * Automated background worker for charging users after money is recovered
 * Runs every 5 minutes, processes reconciled recoveries, and charges 20% platform fee
 * 
 * MULTI-TENANT: Processes each tenant's data in isolation
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import { createTenantScopedQueryById } from '../database/tenantScopedClient';
import billingService, { BillingRequest, BillingResult } from '../services/billingService';
import billingCreditService from '../services/billingCreditService';
import workerContinuationService from '../services/workerContinuationService';
import runtimeCapacityService from '../services/runtimeCapacityService';
import operationalControlService from '../services/operationalControlService';
import financialWorkItemService from '../services/financialWorkItemService';
import {
  buildStableBillingIdempotencyKey,
  resolveCanonicalBillingEligibility,
  resolveCanonicalBillingEligibilityMap,
  shouldEnqueueBackstopBilling,
  type CanonicalBillingEligibility,
} from '../services/billingCanonicalTruth';
import { resolveTenantSlug } from '../utils/tenantEventRouting';

export interface BillingStats {
  processed: number;
  charged: number;
  failed: number;
  skipped: number;
  errors: string[];
}

class BillingWorker {
  private executionSchedule: string = process.env.BILLING_EXECUTION_LANE_SCHEDULE || '*/20 * * * * *';
  private backstopSchedule: string = process.env.BILLING_BACKSTOP_SCHEDULE || '*/5 * * * *';
  private executionJob: cron.ScheduledTask | null = null;
  private backstopJob: cron.ScheduledTask | null = null;
  private isExecutionRunning: boolean = false;
  private isBackstopRunning: boolean = false;
  private readonly workerName = 'billing';
  private readonly executionLaneName = 'billing-execution';
  private readonly backstopLaneName = 'billing-backstop';
  private static readonly BATCH_SIZE = Number(process.env.BILLING_BATCH_SIZE || '75');
  private static readonly WORK_BATCH_SIZE = Number(process.env.BILLING_WORK_BATCH_SIZE || '25');
  private tenantRotationOffset: number = 0;

  private buildExecutionMetadata(item: any, extra: Record<string, any> = {}): Record<string, any> {
    const timestamp = new Date().toISOString();
    return {
      ...(item?.payload || {}),
      execution_lane: this.executionLaneName,
      execution_runtime_role: process.env.RUNTIME_ROLE || 'monolith',
      execution_owned_by: 'billing',
      execution_processed_at: timestamp,
      last_processed_at: timestamp,
      last_execution_lane: this.executionLaneName,
      last_runtime_role: process.env.RUNTIME_ROLE || 'monolith',
      ...extra
    };
  }

  private async emitBillingEvent(
    eventType: string,
    item: any,
    extra: Record<string, any> = {}
  ): Promise<void> {
    try {
      const sseHub = (await import('../utils/sseHub')).default;
      await sseHub.sendTenantEvent(eventType, {
        event_type: eventType,
        entity_type: 'billing_transaction',
        entity_id: item.recovery_id || item.dispute_case_id,
        tenant_id: item.tenant_id,
        tenant_slug: item.tenant_slug,
        seller_id: item.user_id,
        dispute_case_id: item.dispute_case_id,
        recovery_id: item.recovery_id || null,
        billing_work_item_id: item.id,
        execution_lane: this.executionLaneName,
        runtime_role: process.env.RUNTIME_ROLE || 'monolith',
        timestamp: new Date().toISOString(),
        ...extra
      }, item.tenant_slug, item.tenant_id);
    } catch {}
  }

  private rotateTenants<T>(tenants: T[]): T[] {
    if (tenants.length <= 1) return tenants;
    const offset = this.tenantRotationOffset % tenants.length;
    this.tenantRotationOffset = (this.tenantRotationOffset + 1) % tenants.length;
    return [...tenants.slice(offset), ...tenants.slice(0, offset)];
  }

  /**
   * Start the worker
   */
  start(): void {
    if (this.executionJob || this.backstopJob) {
      logger.warn('⚠️ [BILLING] Worker already started');
      return;
    }

    logger.info('🚀 [BILLING] Starting Billing Worker', {
      executionSchedule: this.executionSchedule,
      backstopSchedule: this.backstopSchedule
    });

    this.executionJob = cron.schedule(this.executionSchedule, async () => {
      if (this.isExecutionRunning) {
        runtimeCapacityService.recordWorkerSkip(this.executionLaneName, 'previous_billing_execution_run_still_in_progress');
        logger.debug('⏸️ [BILLING] Previous execution lane run still in progress, skipping');
        return;
      }

      this.isExecutionRunning = true;
      try {
        await this.runBillingForAllTenants();
      } catch (error: any) {
        logger.error('❌ [BILLING] Error in billing execution lane', { error: error.message });
      } finally {
        this.isExecutionRunning = false;
      }
    });

    this.backstopJob = cron.schedule(this.backstopSchedule, async () => {
      if (this.isBackstopRunning) {
        runtimeCapacityService.recordWorkerSkip(this.backstopLaneName, 'previous_billing_backstop_run_still_in_progress');
        logger.debug('⏸️ [BILLING] Previous backstop run still in progress, skipping');
        return;
      }

      this.isBackstopRunning = true;
      try {
        await this.runBillingBackstopSweepForAllTenants();
      } catch (error: any) {
        logger.error('❌ [BILLING] Error in billing backstop sweep', { error: error.message });
      } finally {
        this.isBackstopRunning = false;
      }
    });

    logger.info('✅ [BILLING] Worker started successfully');
  }

  private async markBillingStateDivergence(
    disputeId: string,
    billingTransactionId: string | null,
    message: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    if (billingTransactionId) {
      await supabaseAdmin
        .from('billing_transactions')
        .update({
          billing_status: 'failed',
          metadata: {
            divergence_reason: message,
            diverged_at: timestamp
          },
          updated_at: timestamp
        })
        .eq('id', billingTransactionId);
    }

    await supabaseAdmin
      .from('dispute_cases')
      .update({
        billing_status: 'failed',
        updated_at: timestamp
      })
      .eq('id', disputeId);
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.executionJob) {
      this.executionJob.stop();
      this.executionJob = null;
    }
    if (this.backstopJob) {
      this.backstopJob.stop();
      this.backstopJob = null;
    }
    logger.info('🛑 [BILLING] Worker stopped');
  }

  /**
   * Run billing for all tenants
   * MULTI-TENANT: Fetches active tenants and processes each in isolation
   */
  async runBillingForAllTenants(): Promise<BillingStats> {
    const stats: BillingStats = {
      processed: 0,
      charged: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    try {
      runtimeCapacityService.recordWorkerStart(this.executionLaneName, { mode: 'execution_lane' });
      const billingEnabled = await operationalControlService.isEnabled('billing_charge', true);
      if (!billingEnabled) {
        runtimeCapacityService.setCircuitBreaker('billing-charge', 'open', 'operator_disabled');
        logger.warn('⏸️ [BILLING] Billing worker paused by operator control');
        runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
          processed: 0,
          succeeded: 0,
          failed: 0,
          metadata: { paused: true, reason: 'operator_disabled' }
        });
        return stats;
      }
      runtimeCapacityService.setCircuitBreaker('billing-charge', 'closed', null);
      logger.info('💳 [BILLING] Starting billing execution lane for all tenants');

      // Get all active tenants
      const { data: tenants, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id, name, status')
        .in('status', ['active', 'trialing'])
        .is('deleted_at', null);

      if (tenantError) {
        logger.error('❌ [BILLING] Failed to get active tenants', { error: tenantError.message });
        stats.errors.push(`Failed to get tenants: ${tenantError.message}`);
        runtimeCapacityService.recordWorkerEnd(this.workerName, {
          failed: 1,
          lastError: tenantError.message
        });
        return stats;
      }

      if (!tenants || tenants.length === 0) {
        logger.debug('ℹ️ [BILLING] No active tenants found');
        runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
          processed: 0,
          succeeded: 0,
          failed: 0
        });
        return stats;
      }

      logger.info(`📋 [BILLING] Processing ${tenants.length} active tenants`);

      // Process each tenant in isolation
      const orderedTenants = this.rotateTenants((tenants || []) as Array<{ id: string; name?: string }>);
      for (const tenant of orderedTenants) {
        try {
          const tenantStats = await this.runBillingForTenant(tenant.id);
          stats.processed += tenantStats.processed;
          stats.charged += tenantStats.charged;
          stats.failed += tenantStats.failed;
          stats.skipped += tenantStats.skipped;
          stats.errors.push(...tenantStats.errors);
        } catch (error: any) {
          logger.error('❌ [BILLING] Error processing tenant', {
            tenantId: tenant.id,
            tenantName: tenant.name,
            error: error.message
          });
          stats.errors.push(`Tenant ${tenant.id}: ${error.message}`);
        }
      }

      logger.info('✅ [BILLING] Billing run completed', stats);
      runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
        processed: stats.processed,
        succeeded: stats.charged,
        failed: stats.failed
      });
      return stats;

    } catch (error: any) {
      logger.error('❌ [BILLING] Fatal error in billing run', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
      runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
        processed: stats.processed,
        succeeded: stats.charged,
        failed: stats.failed || 1,
        lastError: error.message
      });
      return stats;
    }
  }

  /**
   * Run billing for a specific tenant
   * MULTI-TENANT: Uses tenant-scoped queries for isolation
   */
  async runBillingForTenant(tenantId: string): Promise<BillingStats> {
    const stats: BillingStats = {
      processed: 0,
      charged: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    const workStats = await this.processPendingBillingWorkForTenant(tenantId);
    stats.processed += workStats.processed;
    stats.charged += workStats.charged;
    stats.failed += workStats.failed;
    stats.skipped += workStats.skipped;
    stats.errors.push(...workStats.errors);

    return stats;

    // Legacy scan path retained below only for reference; event-driven work items are now primary.

    const cursor = await workerContinuationService.getCursor(this.workerName, tenantId);
    const tenantQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
    const backlogQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
    const oldestQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');

    // Get reconciled cases that need billing for this tenant
    let query = tenantQuery
      .select(`
        id,
        seller_id,
        claim_amount,
        actual_payout_amount,
        currency,
        recovery_status,
        billing_status,
        billing_retry_count,
        tenant_id
      `)
      .eq('recovery_status', 'reconciled')
      .or('billing_status.is.null,billing_status.eq.pending')
      .order('id', { ascending: true })
      .limit(BillingWorker.BATCH_SIZE);

    if (cursor) {
      query = query.gt('id', cursor);
    }

    const [backlogResult, oldestResult] = await Promise.all([
      backlogQuery
        .select('*', { count: 'exact', head: true })
        .eq('recovery_status', 'reconciled')
        .or('billing_status.is.null,billing_status.eq.pending'),
      oldestQuery
        .select('updated_at')
        .eq('recovery_status', 'reconciled')
        .or('billing_status.is.null,billing_status.eq.pending')
        .order('updated_at', { ascending: true })
        .limit(1)
    ]);

    let { data: casesNeedingBilling, error } = await query;

    if ((!casesNeedingBilling || casesNeedingBilling.length === 0) && cursor) {
      const wrapped = await createTenantScopedQueryById(tenantId, 'dispute_cases')
        .select(`
        id,
        seller_id,
        claim_amount,
        actual_payout_amount,
        currency,
        recovery_status,
        billing_status,
        billing_retry_count,
        tenant_id
      `)
        .eq('recovery_status', 'reconciled')
        .or('billing_status.is.null,billing_status.eq.pending')
        .order('id', { ascending: true })
        .limit(BillingWorker.BATCH_SIZE);
      casesNeedingBilling = wrapped.data;
      error = wrapped.error as any;
    }

    const oldestUpdatedAt = oldestResult.data?.[0]?.updated_at as string | undefined;
    runtimeCapacityService.updateBacklog(
      `${this.workerName}:${tenantId}`,
      backlogResult.count || 0,
      oldestUpdatedAt ? Math.max(0, Date.now() - new Date(oldestUpdatedAt).getTime()) : null
    );

    if (error) {
      logger.error('❌ [BILLING] Failed to get cases needing billing', { tenantId, error: error.message });
      stats.errors.push(`Failed to get cases: ${error.message}`);
      return stats;
    }

    if (!casesNeedingBilling || casesNeedingBilling.length === 0) {
      await workerContinuationService.clearCursor(this.workerName, tenantId);
      runtimeCapacityService.recordWorkerEnd(`${this.workerName}:${tenantId}`, {
        processed: 0,
        succeeded: 0,
        failed: 0,
        backlogDepth: backlogResult.count || 0,
        oldestItemAgeMs: oldestUpdatedAt ? Math.max(0, Date.now() - new Date(oldestUpdatedAt).getTime()) : null
      });
      logger.debug('ℹ️ [BILLING] No reconciled cases needing billing', { tenantId });
      return stats;
    }

    logger.info(`📋 [BILLING] Found ${casesNeedingBilling.length} cases needing billing`, { tenantId });

    // Process each case
    for (const disputeCase of casesNeedingBilling) {
      try {
        stats.processed++;

        // Skip if already charged
        if (disputeCase.billing_status === 'charged') {
          stats.skipped++;
          logger.debug('⏭️ [BILLING] Case already charged', { disputeId: disputeCase.id });
          continue;
        }

        // Skip if max retries exceeded
        if ((disputeCase.billing_retry_count || 0) >= 3) {
          stats.skipped++;
          logger.warn('⏭️ [BILLING] Max retries exceeded, skipping', {
            disputeId: disputeCase.id,
            retryCount: disputeCase.billing_retry_count
          });
          continue;
        }

        const canonicalEligibility = await resolveCanonicalBillingEligibility({
          tenantId,
          disputeCaseId: disputeCase.id,
        });

        if (!canonicalEligibility.charge_eligible || !canonicalEligibility.verified_paid_amount || canonicalEligibility.verified_paid_amount <= 0) {
          stats.skipped++;
          logger.warn('⏭️ [BILLING] Canonical payout truth not ready, skipping', {
            disputeId: disputeCase.id,
            payoutStatus: canonicalEligibility.payout_status,
            eligibilityReason: canonicalEligibility.eligibility_reason
          });
          continue;
        }

        // Convert to cents
        const amountRecoveredCents = Math.round(canonicalEligibility.verified_paid_amount * 100);

        // Get recovery ID if exists (tenant-scoped)
        const recoveryQuery = createTenantScopedQueryById(tenantId, 'recoveries');
        const { data: recovery } = await recoveryQuery
          .select('id, recovery_cycle_id')
          .eq('dispute_id', disputeCase.id)
          .limit(1)
          .single();

        const stableIdempotencyKey = buildStableBillingIdempotencyKey({
          recoveryId: recovery?.id || null,
          disputeCaseId: disputeCase.id,
        });
        const billingCurrency = String(disputeCase.currency || '').trim();
        if (!billingCurrency) {
          stats.skipped++;
          logger.warn('⏭️ [BILLING] Billing currency unavailable, skipping', {
            disputeId: disputeCase.id,
          });
          continue;
        }

        // Process billing
        const result = await this.processBillingForRecovery(
          disputeCase.id,
          recovery?.id || null,
          recovery?.recovery_cycle_id || null,
          disputeCase.seller_id,
          tenantId,
          amountRecoveredCents,
          billingCurrency,
          disputeCase.billing_retry_count || 0,
          stableIdempotencyKey,
          canonicalEligibility
        );

        if (result.success) {
          stats.charged++;
        } else {
          stats.failed++;
          stats.errors.push(`Case ${disputeCase.id}: ${result.error}`);
        }

        // Small delay between cases
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error: any) {
        logger.error('❌ [BILLING] Error processing case', {
          disputeId: disputeCase.id,
          error: error.message
        });
        stats.failed++;
        stats.errors.push(`Case ${disputeCase.id}: ${error.message}`);
      }
    }

    await workerContinuationService.setCursor(
      this.workerName,
      tenantId,
      casesNeedingBilling[casesNeedingBilling.length - 1]?.id || null,
      { processed: stats.processed, backlogDepth: backlogResult.count || 0 }
    );

    runtimeCapacityService.recordWorkerEnd(`${this.workerName}:${tenantId}`, {
      processed: stats.processed,
      succeeded: stats.charged,
      failed: stats.failed,
      backlogDepth: backlogResult.count || 0,
      oldestItemAgeMs: oldestUpdatedAt ? Math.max(0, Date.now() - new Date(oldestUpdatedAt).getTime()) : null
    });

    logger.info('✅ [BILLING] Tenant billing run completed', { tenantId, stats });
    return stats;
  }


  /**
   * Process billing for a single recovery
   */
  async processBillingForRecovery(
    disputeId: string,
    recoveryId: string | null,
    recoveryCycleId: string | null,
    userId: string,
    tenantId: string,
    amountRecoveredCents: number,
    currency: string,
    currentRetryCount: number,
    stableIdempotencyKey: string,
    canonicalEligibility: CanonicalBillingEligibility
  ): Promise<BillingResult> {
    let billingTransactionId: string | null = null;
    try {
      logger.info('💳 [BILLING] Processing billing for recovery', {
        disputeId,
        recoveryId,
        userId,
        tenantId,
        amountRecoveredCents,
        currency,
        payoutStatus: canonicalEligibility.payout_status,
        chargeEligibilitySource: canonicalEligibility.eligibility_source
      });

      const { data: existingTransaction, error: existingError } = await supabaseAdmin
        .from('billing_transactions')
        .select('id, billing_status, recovery_id, dispute_id, credit_applied_cents, amount_due_cents, platform_fee_cents, seller_payout_cents, credit_balance_after_cents, paypal_invoice_id')
        .eq('idempotency_key', stableIdempotencyKey)
        .maybeSingle();

      if (existingError) {
        throw new Error(`Failed to check existing billing transaction: ${existingError.message}`);
      }

      if (existingTransaction && existingTransaction.billing_status !== 'failed') {
        logger.info('ℹ️ [BILLING] Existing billing transaction found, reusing', {
          disputeId,
          recoveryId,
          billingTransactionId: existingTransaction.id,
          billingStatus: existingTransaction.billing_status
        });

        return {
          success: true,
          billingTransactionId: existingTransaction.id,
          paypalInvoiceId: existingTransaction.paypal_invoice_id || undefined,
          platformFeeCents: existingTransaction.platform_fee_cents || 0,
          sellerPayoutCents: existingTransaction.seller_payout_cents || 0,
          amountDueCents: existingTransaction.amount_due_cents || 0,
          creditAppliedCents: existingTransaction.credit_applied_cents || 0,
          status: existingTransaction.billing_status
        };
      }

      // Update billing status to 'processing' (if column exists)
      await supabaseAdmin
        .from('dispute_cases')
        .update({
          billing_status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', disputeId);

      const feeCalculation = billingService.calculateFees(amountRecoveredCents, currency);
      const creditPreview = await billingCreditService.previewCreditApplication(
        {
          tenantId,
          userId,
          sellerId: userId
        },
        feeCalculation.platformFeeCents
      );

      const billingRequest: BillingRequest = {
        disputeId,
        recoveryId: recoveryId || undefined,
        userId,
        amountRecoveredCents,
        platformFeeCents: feeCalculation.platformFeeCents,
        sellerPayoutCents: feeCalculation.sellerPayoutCents,
        creditAppliedCents: creditPreview.creditAppliedCents,
        amountDueCents: creditPreview.amountDueCents,
        currency,
        idempotencyKey: stableIdempotencyKey
      };

      let result: BillingResult;
      if (creditPreview.amountDueCents <= 0) {
        result = {
          success: true,
          platformFeeCents: feeCalculation.platformFeeCents,
          sellerPayoutCents: feeCalculation.sellerPayoutCents,
          amountDueCents: 0,
          creditAppliedCents: creditPreview.creditAppliedCents,
          status: 'credited'
        };
      } else {
        result = await billingService.chargeCommissionWithRetry(billingRequest, 3);
      }

      if (result.success) {
        const transactionPayload = {
          dispute_id: disputeId,
          recovery_id: recoveryId,
          recovery_cycle_id: recoveryCycleId,
          tenant_id: tenantId,
          user_id: userId,
          amount_recovered_cents: amountRecoveredCents,
          platform_fee_cents: feeCalculation.platformFeeCents,
          seller_payout_cents: feeCalculation.sellerPayoutCents,
          credit_applied_cents: creditPreview.creditAppliedCents,
          amount_due_cents: creditPreview.amountDueCents,
          credit_balance_after_cents: creditPreview.balanceAfterCents,
          currency,
          paypal_invoice_id: result.paypalInvoiceId || null,
          provider: 'paypal',
          billing_type: 'success_fee',
          billing_status: creditPreview.amountDueCents <= 0 ? 'credited' : (result.status || 'sent'),
          idempotency_key: billingRequest.idempotencyKey,
          metadata: {
            retry_count: currentRetryCount,
            processed_at: new Date().toISOString(),
            credit_applied_cents: creditPreview.creditAppliedCents,
            amount_due_cents: creditPreview.amountDueCents,
            credit_balance_after_cents: creditPreview.balanceAfterCents,
            charge_eligible: canonicalEligibility.charge_eligible,
            charge_eligibility_reason: canonicalEligibility.eligibility_reason,
            charge_eligibility_source: canonicalEligibility.eligibility_source,
            payout_status: canonicalEligibility.payout_status,
            verified_paid_amount: canonicalEligibility.verified_paid_amount,
            outstanding_amount: canonicalEligibility.outstanding_amount,
            variance_amount: canonicalEligibility.variance_amount,
            proof_event_date: canonicalEligibility.proof_of_payment?.event_date || null,
            settlement_id: canonicalEligibility.proof_of_payment?.settlement_id || null,
            payout_batch_id: canonicalEligibility.proof_of_payment?.payout_batch_id || null
          }
        };

        let billingTransaction: any = null;
        let insertError: any = null;

        if (existingTransaction?.id) {
          const { data, error } = await supabaseAdmin
            .from('billing_transactions')
            .update({
              ...transactionPayload,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingTransaction.id)
            .select()
            .single();
          billingTransaction = data;
          insertError = error;
        } else {
          const { data, error } = await supabaseAdmin
            .from('billing_transactions')
            .insert(transactionPayload)
            .select()
            .single();
          billingTransaction = data;
          insertError = error;
        }

        if (insertError || !billingTransaction?.id) {
          logger.error('❌ [BILLING] Failed to create billing transaction', {
            disputeId,
            error: insertError?.message
          });
          throw new Error(`Failed to create billing transaction: ${insertError?.message || 'unknown error'}`);
        }

        billingTransactionId = billingTransaction.id;

        const creditApplyResult = await billingCreditService.applyCreditToBilling(
          {
            tenantId,
            userId,
            sellerId: userId
          },
          billingTransaction.id,
          recoveryCycleId,
          creditPreview.creditAppliedCents,
          'paypal'
        );

        const { error: billingTransactionUpdateError } = await supabaseAdmin
          .from('billing_transactions')
          .update({
            credit_balance_after_cents: creditApplyResult.balanceAfterCents,
            updated_at: new Date().toISOString()
          })
          .eq('id', billingTransaction.id);

        if (billingTransactionUpdateError) {
          const divergenceMessage = `Billing transaction ${billingTransaction.id} persisted but credit balance update failed: ${billingTransactionUpdateError.message}`;
          await this.markBillingStateDivergence(disputeId, billingTransaction.id, divergenceMessage);
          throw new Error(divergenceMessage);
        }

        // Update dispute case
        const { error: disputeBillingUpdateError } = await supabaseAdmin
          .from('dispute_cases')
          .update({
            billing_status: creditPreview.amountDueCents <= 0 ? 'credited' : (result.status || 'sent'),
            billing_transaction_id: billingTransaction.id,
            platform_fee_cents: feeCalculation.platformFeeCents,
            seller_payout_cents: feeCalculation.sellerPayoutCents,
            billed_at: new Date().toISOString(),
            billing_retry_count: 0,
            updated_at: new Date().toISOString()
          })
          .eq('id', disputeId);

        if (disputeBillingUpdateError) {
          const divergenceMessage = `Billing transaction ${billingTransaction.id} persisted but dispute case update failed: ${disputeBillingUpdateError.message}`;
          await this.markBillingStateDivergence(disputeId, billingTransaction.id, divergenceMessage);
          throw new Error(divergenceMessage);
        }

        logger.info('✅ [BILLING] Billing completed successfully', {
          disputeId,
          billingTransactionId: billingTransaction.id,
          platformFeeCents: feeCalculation.platformFeeCents,
          creditAppliedCents: creditPreview.creditAppliedCents,
          amountDueCents: creditPreview.amountDueCents
        });

        // 🎯 AGENT 11 INTEGRATION: Log billing event
        try {
          const agentEventLogger = (await import('../services/agentEventLogger')).default;
          await agentEventLogger.logBilling({
            userId,
            disputeId,
            success: true,
            amountRecovered: amountRecoveredCents / 100,
            platformFee: feeCalculation.platformFeeCents / 100,
            sellerPayout: feeCalculation.sellerPayoutCents / 100,
            paypalInvoiceId: result.paypalInvoiceId,
            duration: 0
          });
        } catch (logError: any) {
          logger.warn('⚠️ [BILLING] Failed to log event', {
            error: logError.message
          });
        }

        // 🎯 AGENT 10 INTEGRATION: Notify when funds are deposited (billing complete)
        try {
          const notificationHelper = (await import('../services/notificationHelper')).default;
          await notificationHelper.notifyFundsDeposited(userId, {
            tenantId,
            disputeId,
            recoveryId: recoveryId || undefined,
            amount: amountRecoveredCents / 100,
            currency,
            platformFee: feeCalculation.platformFeeCents / 100,
            sellerPayout: feeCalculation.sellerPayoutCents / 100,
            billingStatus: creditPreview.amountDueCents <= 0 ? 'credited' : 'sent'
          });
        } catch (notifError: any) {
          logger.warn('⚠️ [BILLING] Failed to send notification', {
            error: notifError.message
          });
        }

        return {
          success: true,
          billingTransactionId: billingTransaction.id,
          paypalInvoiceId: result.paypalInvoiceId,
          platformFeeCents: feeCalculation.platformFeeCents,
          sellerPayoutCents: feeCalculation.sellerPayoutCents,
          amountDueCents: creditPreview.amountDueCents,
          creditAppliedCents: creditPreview.creditAppliedCents,
          status: creditPreview.amountDueCents <= 0 ? 'credited' : 'sent'
        };

      } else {
        // Billing failed - update status and log error
        const newRetryCount = currentRetryCount + 1;

        await supabaseAdmin
          .from('dispute_cases')
          .update({
            billing_status: newRetryCount >= 3 ? 'failed' : 'pending',
            billing_retry_count: newRetryCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', disputeId);

        // Log error
        await billingService.logBillingError(
          disputeId,
          recoveryId,
          userId,
          result.error || 'Failed to charge commission',
          newRetryCount,
          3
        );

        logger.error('❌ [BILLING] Billing failed', {
          disputeId,
          retryCount: newRetryCount,
          error: result.error
        });

        // 🎯 AGENT 11 INTEGRATION: Log billing failure
        try {
          const agentEventLogger = (await import('../services/agentEventLogger')).default;
          await agentEventLogger.logBilling({
            userId,
            disputeId,
            success: false,
            amountRecovered: amountRecoveredCents / 100,
            platformFee: feeCalculation.platformFeeCents / 100,
            sellerPayout: feeCalculation.sellerPayoutCents / 100,
            duration: 0,
            error: result.error || 'Billing failed'
          });
        } catch (logError: any) {
          logger.warn('⚠️ [BILLING] Failed to log event', {
            error: logError.message
          });
        }

        return {
          success: false,
          status: 'failed',
          error: result.error || 'Failed to charge commission'
        };
      }

    } catch (error: any) {
      logger.error('❌ [BILLING] Failed to process billing for recovery', {
        disputeId,
        userId,
        error: error.message
      });

      if (billingTransactionId) {
        await this.markBillingStateDivergence(disputeId, billingTransactionId, error.message);
      }

      // Update status to failed
      await supabaseAdmin
        .from('dispute_cases')
        .update({
          billing_status: 'failed',
          billing_retry_count: (currentRetryCount || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', disputeId);

      // Log error
      await billingService.logBillingError(
        disputeId,
        recoveryId,
        userId,
        error,
        (currentRetryCount || 0) + 1,
        3
      );

      return {
        success: false,
        status: 'failed',
        error: error.message
      };
    }
  }

  async runBillingBackstopSweepForAllTenants(): Promise<{ tenantsProcessed: number; enqueued: number; errors: string[] }> {
    const result = { tenantsProcessed: 0, enqueued: 0, errors: [] as string[] };

    try {
      runtimeCapacityService.recordWorkerStart(this.backstopLaneName, { mode: 'backstop_sweep' });
      const billingEnabled = await operationalControlService.isEnabled('billing_charge', true);
      if (!billingEnabled) {
        runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
          processed: 0,
          succeeded: 0,
          failed: 0,
          metadata: { paused: true, reason: 'operator_disabled' }
        });
        return result;
      }

      logger.info('💳 [BILLING] Starting billing backstop sweep for all tenants');

      const { data: tenants, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name')
        .in('status', ['active', 'trialing'])
        .is('deleted_at', null);

      if (error) {
        runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
          failed: 1,
          lastError: error.message
        });
        throw error;
      }

      const orderedTenants = this.rotateTenants((tenants || []) as Array<{ id: string; name?: string }>);
      for (const tenant of orderedTenants) {
        try {
          result.tenantsProcessed++;
          result.enqueued += await this.enqueueMissingBillingWorkItemsForTenant(tenant.id);
        } catch (tenantError: any) {
          result.errors.push(`Tenant ${tenant.id}: ${tenantError.message}`);
        }
      }

      runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
        processed: result.tenantsProcessed,
        succeeded: result.enqueued,
        failed: result.errors.length
      });
      return result;
    } catch (error: any) {
      runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
        processed: result.tenantsProcessed,
        succeeded: result.enqueued,
        failed: result.errors.length || 1,
        lastError: error.message
      });
      result.errors.push(error.message);
      return result;
    }
  }

  private async processPendingBillingWorkForTenant(tenantId: string): Promise<BillingStats> {
    const stats: BillingStats = {
      processed: 0,
      charged: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    const backlogState = await this.getBillingWorkBacklog(tenantId);
    runtimeCapacityService.updateBacklog(`${this.executionLaneName}:${tenantId}`, backlogState.backlogDepth, backlogState.oldestItemAgeMs, {
      mode: 'event_driven_primary'
    });

    for (let i = 0; i < BillingWorker.WORK_BATCH_SIZE; i++) {
      const item = await financialWorkItemService.claimNext('billing', `${this.executionLaneName}:${tenantId}`, tenantId);
      if (!item) {
        break;
      }

      await this.emitBillingEvent('billing.work_claimed', item, {
        status: item.status,
        last_claimed_at: item.payload?.last_claimed_at || item.updated_at || new Date().toISOString()
      });

      const result = await this.processBillingWorkItem(item);
      stats.processed++;

      if (result === 'completed') {
        stats.charged++;
      } else if (result === 'deferred' || result === 'quarantined') {
        stats.skipped++;
      } else if (result === 'failed') {
        stats.failed++;
      }
    }

    return stats;
  }

  private async processBillingWorkItem(item: any): Promise<'completed' | 'deferred' | 'quarantined' | 'failed'> {
    try {
      const { data: disputeCase, error } = await supabaseAdmin
        .from('dispute_cases')
        .select('seller_id, currency, billing_retry_count, billing_status')
        .eq('id', item.dispute_case_id)
        .single();

      if (error || !disputeCase) {
        throw new Error(error?.message || `Dispute case ${item.dispute_case_id} not found`);
      }

      const canonicalEligibility = await resolveCanonicalBillingEligibility({
        tenantId: item.tenant_id,
        disputeCaseId: item.dispute_case_id,
      });

      if (!canonicalEligibility.charge_eligible || !canonicalEligibility.verified_paid_amount || canonicalEligibility.verified_paid_amount <= 0) {
        const nextAttemptAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await financialWorkItemService.defer(
          'billing',
          item.id,
          'payout_not_canonically_confirmed',
          15 * 60 * 1000,
          this.buildExecutionMetadata(item, {
            lifecycle_state: 'deferred',
            defer_count: Number(item?.payload?.defer_count || 0) + 1,
            deferred_reason: 'payout_not_canonically_confirmed',
            last_deferred_reason: 'payout_not_canonically_confirmed',
            next_attempt_at: nextAttemptAt,
            charge_eligible: canonicalEligibility.charge_eligible,
            charge_eligibility_reason: canonicalEligibility.eligibility_reason,
            charge_eligibility_source: canonicalEligibility.eligibility_source,
            payout_status: canonicalEligibility.payout_status,
            verified_paid_amount: canonicalEligibility.verified_paid_amount,
            outstanding_amount: canonicalEligibility.outstanding_amount,
            variance_amount: canonicalEligibility.variance_amount,
            proof_event_date: canonicalEligibility.proof_of_payment?.event_date || null,
            settlement_id: canonicalEligibility.proof_of_payment?.settlement_id || null,
            payout_batch_id: canonicalEligibility.proof_of_payment?.payout_batch_id || null
          })
        );
        await this.emitBillingEvent('billing.work_deferred', item, {
          status: 'pending',
          reason: 'payout_not_canonically_confirmed',
          defer_count: Number(item?.payload?.defer_count || 0) + 1,
          next_attempt_at: nextAttemptAt,
          charge_eligible: canonicalEligibility.charge_eligible,
          charge_eligibility_reason: canonicalEligibility.eligibility_reason,
          charge_eligibility_source: canonicalEligibility.eligibility_source,
          payout_status: canonicalEligibility.payout_status,
          verified_paid_amount: canonicalEligibility.verified_paid_amount
        });
        return 'deferred';
      }

      const billingCurrency = String(disputeCase.currency || '').trim();
      if (!billingCurrency) {
        const nextAttemptAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await financialWorkItemService.defer(
          'billing',
          item.id,
          'billing_currency_unavailable',
          15 * 60 * 1000,
          this.buildExecutionMetadata(item, {
            lifecycle_state: 'deferred',
            defer_count: Number(item?.payload?.defer_count || 0) + 1,
            deferred_reason: 'billing_currency_unavailable',
            last_deferred_reason: 'billing_currency_unavailable',
            next_attempt_at: nextAttemptAt,
          })
        );
        await this.emitBillingEvent('billing.work_deferred', item, {
          status: 'pending',
          reason: 'billing_currency_unavailable',
          defer_count: Number(item?.payload?.defer_count || 0) + 1,
          next_attempt_at: nextAttemptAt,
        });
        return 'deferred';
      }

      const stableIdempotencyKey = buildStableBillingIdempotencyKey({
        recoveryId: item.recovery_id || null,
        disputeCaseId: item.dispute_case_id,
      });

      const result = await this.processBillingForRecovery(
        item.dispute_case_id,
        item.recovery_id || null,
        item.payload?.recovery_cycle_id || null,
        disputeCase.seller_id,
        item.tenant_id,
        Math.round(Number(canonicalEligibility.verified_paid_amount || 0) * 100),
        billingCurrency,
        disputeCase.billing_retry_count || 0,
        stableIdempotencyKey,
        canonicalEligibility
      );

      if (result.success) {
        await financialWorkItemService.complete('billing', item.id, {
          ...this.buildExecutionMetadata(item, {
          lifecycle_state: 'completed',
          billing_status: result.status,
          billing_transaction_id: result.billingTransactionId || null,
          completed_at: new Date().toISOString()
          })
        });
        await this.emitBillingEvent('billing.completed', item, {
          status: result.status,
          billing_transaction_id: result.billingTransactionId || null
        });
        await this.emitBillingEvent('billing.processed', item, {
          status: result.status,
          billing_transaction_id: result.billingTransactionId || null
        });

        return 'completed';
      }

      const attempts = Number(item?.attempts || 0) + 1;
      const maxAttempts = Number(item?.max_attempts || 5);
      const predictedTerminalState = attempts >= maxAttempts ? 'failed_retry_exhausted' : 'pending';
      const terminalState = await financialWorkItemService.fail('billing', item, result.error || 'Billing failed', {
        ...this.buildExecutionMetadata(item, {
        lifecycle_state: predictedTerminalState === 'failed_retry_exhausted' ? 'failed_retry_exhausted' : 'failed',
        failed_reason: result.error || 'Billing failed'
        })
      });
      await this.emitBillingEvent(
        terminalState === 'failed_retry_exhausted' ? 'billing.failed_retry_exhausted' : 'billing.failed',
        item,
        {
          status: terminalState,
          reason: result.error || 'Billing failed',
          error: result.error || 'Billing failed'
        }
      );

      return 'failed';
    } catch (error: any) {
      const attempts = Number(item?.attempts || 0) + 1;
      const maxAttempts = Number(item?.max_attempts || 5);
      const predictedTerminalState = attempts >= maxAttempts ? 'failed_retry_exhausted' : 'pending';
      const terminalState = await financialWorkItemService.fail('billing', item, error.message, {
        ...this.buildExecutionMetadata(item, {
        lifecycle_state: predictedTerminalState === 'failed_retry_exhausted' ? 'failed_retry_exhausted' : 'failed',
        failed_reason: error.message
        })
      });
      await this.emitBillingEvent(
        terminalState === 'failed_retry_exhausted' ? 'billing.failed_retry_exhausted' : 'billing.failed',
        item,
        {
          status: terminalState,
          reason: error.message,
          error: error.message
        }
      );

      return 'failed';
    }
  }

  private async getBillingWorkBacklog(tenantId: string): Promise<{ backlogDepth: number; oldestItemAgeMs: number | null }> {
    const [pendingCount, oldestPending] = await Promise.all([
      supabaseAdmin
        .from('billing_work_items')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending'),
      supabaseAdmin
        .from('billing_work_items')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    ]);

    const oldestCreatedAt = oldestPending.data?.created_at as string | undefined;
    return {
      backlogDepth: pendingCount.count || 0,
      oldestItemAgeMs: oldestCreatedAt ? Math.max(0, Date.now() - new Date(oldestCreatedAt).getTime()) : null
    };
  }

  private async enqueueMissingBillingWorkItemsForTenant(tenantId: string): Promise<number> {
    const cursor = await workerContinuationService.getCursor(`${this.workerName}-backstop`, tenantId);
    let query = createTenantScopedQueryById(tenantId, 'dispute_cases')
      .select('id, seller_id, tenant_id, billing_status, billing_transaction_id')
      .or('billing_status.is.null,billing_status.eq.pending,billing_status.eq.failed')
      .order('id', { ascending: true })
      .limit(BillingWorker.BATCH_SIZE);

    if (cursor) {
      query = query.gt('id', cursor);
    }

    let { data: casesNeedingBilling, error } = await query;
    if ((!casesNeedingBilling || casesNeedingBilling.length === 0) && cursor) {
      const wrapped = await createTenantScopedQueryById(tenantId, 'dispute_cases')
        .select('id, seller_id, tenant_id, billing_status, billing_transaction_id')
        .or('billing_status.is.null,billing_status.eq.pending,billing_status.eq.failed')
        .order('id', { ascending: true })
        .limit(BillingWorker.BATCH_SIZE);
      casesNeedingBilling = wrapped.data as any;
      error = wrapped.error as any;
    }

    if (error || !casesNeedingBilling || casesNeedingBilling.length === 0) {
      await workerContinuationService.clearCursor(`${this.workerName}-backstop`, tenantId);
      return 0;
    }

    const tenantSlug = await resolveTenantSlug(tenantId);
    const eligibilityByDisputeId = await resolveCanonicalBillingEligibilityMap({
      tenantId,
      disputeCaseIds: (casesNeedingBilling || []).map((row: any) => String(row.id || '')).filter(Boolean),
    });
    let created = 0;

    for (const disputeCase of casesNeedingBilling) {
      const canonicalEligibility = eligibilityByDisputeId[String(disputeCase.id)] || null;
      if (!canonicalEligibility || !shouldEnqueueBackstopBilling({
        billingStatus: disputeCase.billing_status,
        billingTransactionId: disputeCase.billing_transaction_id,
        chargeEligible: canonicalEligibility.charge_eligible,
      })) {
        continue;
      }

      const { data: recovery } = await createTenantScopedQueryById(tenantId, 'recoveries')
        .select('id')
        .eq('dispute_id', disputeCase.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const result = await financialWorkItemService.enqueueBillingWork({
        tenantId,
        tenantSlug,
        userId: disputeCase.seller_id,
        disputeCaseId: disputeCase.id,
        recoveryId: recovery?.id || null,
        sourceEventType: 'billing.backstop_sweep',
        sourceEventId: recovery?.id || disputeCase.id,
        payload: {
          dispute_case_id: disputeCase.id,
          recovery_id: recovery?.id || null,
          sweep: true,
          charge_eligible: canonicalEligibility.charge_eligible,
          charge_eligibility_reason: canonicalEligibility.eligibility_reason,
          charge_eligibility_source: canonicalEligibility.eligibility_source,
          payout_status: canonicalEligibility.payout_status,
          verified_paid_amount: canonicalEligibility.verified_paid_amount,
          outstanding_amount: canonicalEligibility.outstanding_amount,
          variance_amount: canonicalEligibility.variance_amount,
          proof_event_date: canonicalEligibility.proof_of_payment?.event_date || null,
          settlement_id: canonicalEligibility.proof_of_payment?.settlement_id || null,
          payout_batch_id: canonicalEligibility.proof_of_payment?.payout_batch_id || null
        }
      });

      if (result.created) {
        created++;
      }
    }

    await workerContinuationService.setCursor(
      `${this.workerName}-backstop`,
      tenantId,
      casesNeedingBilling[casesNeedingBilling.length - 1]?.id || null,
      { enqueued: created }
    );

    return created;
  }
}

// Export singleton instance
const billingWorker = new BillingWorker();
export default billingWorker;

