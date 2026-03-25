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

export interface BillingStats {
  processed: number;
  charged: number;
  failed: number;
  skipped: number;
  errors: string[];
}

class BillingWorker {
  private schedule: string = '*/5 * * * *'; // Every 5 minutes
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private readonly workerName = 'billing';
  private static readonly BATCH_SIZE = Number(process.env.BILLING_BATCH_SIZE || '75');
  private tenantRotationOffset: number = 0;

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
    if (this.cronJob) {
      logger.warn('⚠️ [BILLING] Worker already started');
      return;
    }

    logger.info('🚀 [BILLING] Starting Billing Worker', {
      schedule: this.schedule
    });

    // Schedule billing job (every 5 minutes)
    this.cronJob = cron.schedule(this.schedule, async () => {
      if (this.isRunning) {
        runtimeCapacityService.recordWorkerSkip(this.workerName, 'previous_billing_run_still_in_progress');
        logger.debug('⏸️ [BILLING] Previous run still in progress, skipping');
        return;
      }

      this.isRunning = true;
      try {
        await this.runBillingForAllTenants();
      } catch (error: any) {
        logger.error('❌ [BILLING] Error in billing job', { error: error.message });
      } finally {
        this.isRunning = false;
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
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
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
      runtimeCapacityService.recordWorkerStart(this.workerName);
      const billingEnabled = await operationalControlService.isEnabled('billing_charge', true);
      if (!billingEnabled) {
        runtimeCapacityService.setCircuitBreaker('billing-charge', 'open', 'operator_disabled');
        logger.warn('⏸️ [BILLING] Billing worker paused by operator control');
        runtimeCapacityService.recordWorkerEnd(this.workerName, {
          processed: 0,
          succeeded: 0,
          failed: 0,
          metadata: { paused: true, reason: 'operator_disabled' }
        });
        return stats;
      }
      runtimeCapacityService.setCircuitBreaker('billing-charge', 'closed', null);
      logger.info('💳 [BILLING] Starting billing run for all tenants');

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
        runtimeCapacityService.recordWorkerEnd(this.workerName, {
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
      runtimeCapacityService.recordWorkerEnd(this.workerName, {
        processed: stats.processed,
        succeeded: stats.charged,
        failed: stats.failed
      });
      return stats;

    } catch (error: any) {
      logger.error('❌ [BILLING] Fatal error in billing run', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
      runtimeCapacityService.recordWorkerEnd(this.workerName, {
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

        // Bill only on confirmed payout truth.
        const amountRecovered = disputeCase.actual_payout_amount;
        if (!amountRecovered || amountRecovered <= 0) {
          stats.skipped++;
          logger.warn('⏭️ [BILLING] Invalid amount, skipping', {
            disputeId: disputeCase.id,
            amountRecovered
          });
          continue;
        }

        // Convert to cents
        const amountRecoveredCents = Math.round(amountRecovered * 100);

        // Get recovery ID if exists (tenant-scoped)
        const recoveryQuery = createTenantScopedQueryById(tenantId, 'recoveries');
        const { data: recovery } = await recoveryQuery
          .select('id, recovery_cycle_id')
          .eq('dispute_id', disputeCase.id)
          .limit(1)
          .single();

        const stableIdempotencyKey = recovery?.id
          ? `billing-recovery-${recovery.id}`
          : `billing-dispute-${disputeCase.id}`;

        // Process billing
        const result = await this.processBillingForRecovery(
          disputeCase.id,
          recovery?.id || null,
          recovery?.recovery_cycle_id || null,
          disputeCase.seller_id,
          tenantId,
          amountRecoveredCents,
          disputeCase.currency || 'usd',
          disputeCase.billing_retry_count || 0,
          stableIdempotencyKey
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
    stableIdempotencyKey: string
  ): Promise<BillingResult> {
    let billingTransactionId: string | null = null;
    try {
      logger.info('💳 [BILLING] Processing billing for recovery', {
        disputeId,
        recoveryId,
        userId,
        tenantId,
        amountRecoveredCents,
        currency
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
            credit_balance_after_cents: creditPreview.balanceAfterCents
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
}

// Export singleton instance
const billingWorker = new BillingWorker();
export default billingWorker;

