/**
 * Billing Worker
 * Automated background worker for charging users after money is recovered
 * Runs every 5 minutes, processes reconciled recoveries, and charges 20% platform fee
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import billingService, { BillingRequest, BillingResult } from '../services/billingService';

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
      logger.info('💳 [BILLING] Starting billing run for all tenants');

      // Get reconciled cases that need billing
      const { data: casesNeedingBilling, error } = await supabaseAdmin
        .from('dispute_cases')
        .select(`
          id,
          seller_id,
          claim_amount,
          actual_payout_amount,
          currency,
          recovery_status,
          billing_status,
          billing_retry_count
        `)
        .eq('recovery_status', 'reconciled')
        .or('billing_status.is.null,billing_status.eq.pending')
        .limit(50); // Process up to 50 cases per run

      if (error) {
        logger.error('❌ [BILLING] Failed to get cases needing billing', { error: error.message });
        stats.errors.push(`Failed to get cases: ${error.message}`);
        return stats;
      }

      if (!casesNeedingBilling || casesNeedingBilling.length === 0) {
        logger.debug('ℹ️ [BILLING] No reconciled cases needing billing');
        return stats;
      }

      logger.info(`📋 [BILLING] Found ${casesNeedingBilling.length} cases needing billing`);

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

          // Get actual payout amount (use actual_payout_amount if available, otherwise claim_amount)
          const amountRecovered = disputeCase.actual_payout_amount || disputeCase.claim_amount;
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

          // Get recovery ID if exists
          const { data: recovery } = await supabaseAdmin
            .from('recoveries')
            .select('id')
            .eq('dispute_id', disputeCase.id)
            .limit(1)
            .single();

          // Process billing
          const result = await this.processBillingForRecovery(
            disputeCase.id,
            recovery?.id || null,
            disputeCase.seller_id,
            amountRecoveredCents,
            disputeCase.currency || 'usd',
            disputeCase.billing_retry_count || 0
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

      logger.info('✅ [BILLING] Billing run completed', stats);
      return stats;

    } catch (error: any) {
      logger.error('❌ [BILLING] Fatal error in billing run', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
      return stats;
    }
  }

  /**
   * Process billing for a single recovery
   */
  async processBillingForRecovery(
    disputeId: string,
    recoveryId: string | null,
    userId: string,
    amountRecoveredCents: number,
    currency: string,
    currentRetryCount: number
  ): Promise<BillingResult> {
    try {
      logger.info('💳 [BILLING] Processing billing for recovery', {
        disputeId,
        recoveryId,
        userId,
        amountRecoveredCents,
        currency
      });

      // Update billing status to 'processing' (if column exists)
      await supabaseAdmin
        .from('dispute_cases')
        .update({
          billing_status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', disputeId);

      // Charge commission with retry
      const billingRequest: BillingRequest = {
        disputeId,
        recoveryId: recoveryId || undefined,
        userId,
        amountRecoveredCents,
        currency,
        idempotencyKey: `billing-${disputeId}-${Date.now()}`
      };

      const result = await billingService.chargeCommissionWithRetry(billingRequest, 3);

      // Calculate fees for logging
      const feeCalculation = billingService.calculateFees(amountRecoveredCents, currency);

      if (result.success) {
        // Create billing transaction record
        const { data: billingTransaction, error: insertError } = await supabaseAdmin
          .from('billing_transactions')
          .insert({
            dispute_id: disputeId,
            recovery_id: recoveryId,
            user_id: userId,
            amount_recovered_cents: amountRecoveredCents,
            platform_fee_cents: feeCalculation.platformFeeCents,
            seller_payout_cents: feeCalculation.sellerPayoutCents,
            currency,
            stripe_transaction_id: result.stripeTransactionId || null,
            stripe_payment_intent_id: result.stripePaymentIntentId || null,
            billing_status: 'charged',
            idempotency_key: billingRequest.idempotencyKey,
            metadata: {
              retry_count: currentRetryCount,
              processed_at: new Date().toISOString()
            }
          })
          .select()
          .single();

        if (insertError) {
          logger.error('❌ [BILLING] Failed to create billing transaction', {
            disputeId,
            error: insertError.message
          });
        }

        // Update dispute case
        await supabaseAdmin
          .from('dispute_cases')
          .update({
            billing_status: 'charged',
            billing_transaction_id: billingTransaction?.id || null,
            platform_fee_cents: feeCalculation.platformFeeCents,
            seller_payout_cents: feeCalculation.sellerPayoutCents,
            billed_at: new Date().toISOString(),
            billing_retry_count: 0,
            updated_at: new Date().toISOString()
          })
          .eq('id', disputeId);

        logger.info('✅ [BILLING] Billing completed successfully', {
          disputeId,
          billingTransactionId: billingTransaction?.id,
          platformFeeCents: feeCalculation.platformFeeCents
        });

        // 🎯 AGENT 10 INTEGRATION: Notify when funds are deposited (billing complete)
        try {
          const notificationHelper = (await import('../services/notificationHelper')).default;
          await notificationHelper.notifyFundsDeposited(userId, {
            disputeId,
            recoveryId: recoveryId || undefined,
            amount: amountRecoveredCents / 100, // Convert cents to dollars
            currency,
            platformFee: feeCalculation.platformFeeCents / 100,
            sellerPayout: feeCalculation.sellerPayoutCents / 100,
            billingStatus: 'charged'
          });
        } catch (notifError: any) {
          logger.warn('⚠️ [BILLING] Failed to send notification', {
            error: notifError.message
          });
        }

        return {
          success: true,
          billingTransactionId: billingTransaction?.id,
          stripeTransactionId: result.stripeTransactionId,
          stripePaymentIntentId: result.stripePaymentIntentId,
          platformFeeCents: feeCalculation.platformFeeCents,
          sellerPayoutCents: feeCalculation.sellerPayoutCents,
          status: 'charged'
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

