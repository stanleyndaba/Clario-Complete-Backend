/**
 * Billing Worker
 * Active billing now follows tenant subscription truth only.
 * Legacy recovery-fee billing work is quarantined and never charged.
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import billingService from '../services/billingService';
import operationalControlService from '../services/operationalControlService';
import runtimeCapacityService from '../services/runtimeCapacityService';
import {
  addBillingInterval,
  advanceSubscriptionBillingWindow,
  BillingInvoiceRow,
  BillingSubscriptionRow,
  buildSubscriptionInvoiceId,
  buildSubscriptionInvoicePayload,
  ensureTenantBillingSubscription,
  upsertSubscriptionInvoice,
} from '../services/subscriptionBillingTruthService';

export interface BillingStats {
  processed: number;
  charged: number;
  failed: number;
  skipped: number;
  errors: string[];
}

type SubscriptionInvoiceProcessResult = {
  success: boolean;
  invoice?: BillingInvoiceRow;
  error?: string;
};

class BillingWorker {
  private executionSchedule: string = process.env.BILLING_EXECUTION_LANE_SCHEDULE || '*/20 * * * * *';
  private backstopSchedule: string = process.env.BILLING_BACKSTOP_SCHEDULE || '*/5 * * * *';
  private executionJob: cron.ScheduledTask | null = null;
  private backstopJob: cron.ScheduledTask | null = null;
  private isExecutionRunning: boolean = false;
  private isBackstopRunning: boolean = false;
  private readonly executionLaneName = 'billing-execution';
  private readonly backstopLaneName = 'billing-backstop';

  start(): void {
    if (this.executionJob || this.backstopJob) {
      logger.warn('⚠️ [BILLING] Worker already started');
      return;
    }

    logger.info('🚀 [BILLING] Starting Billing Worker', {
      executionSchedule: this.executionSchedule,
      backstopSchedule: this.backstopSchedule,
      billingModel: 'flat_subscription',
    });

    this.executionJob = cron.schedule(this.executionSchedule, async () => {
      if (this.isExecutionRunning) {
        runtimeCapacityService.recordWorkerSkip(this.executionLaneName, 'previous_billing_execution_run_still_in_progress');
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
  }

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

  async runBillingForAllTenants(): Promise<BillingStats> {
    const stats: BillingStats = {
      processed: 0,
      charged: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    try {
      runtimeCapacityService.recordWorkerStart(this.executionLaneName, { mode: 'subscription_execution_lane' });
      const billingEnabled = await operationalControlService.isEnabled('billing_charge', true);
      if (!billingEnabled) {
        runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
          processed: 0,
          succeeded: 0,
          failed: 0,
          metadata: { paused: true, reason: 'operator_disabled' },
        });
        return stats;
      }

      const { data: tenants, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id, name, status')
        .in('status', ['active', 'trialing', 'suspended', 'read_only'])
        .is('deleted_at', null);

      if (tenantError) {
        throw tenantError;
      }

      for (const tenant of tenants || []) {
        try {
          const tenantStats = await this.runBillingForTenant(tenant.id);
          stats.processed += tenantStats.processed;
          stats.charged += tenantStats.charged;
          stats.failed += tenantStats.failed;
          stats.skipped += tenantStats.skipped;
          stats.errors.push(...tenantStats.errors);
        } catch (error: any) {
          stats.errors.push(`Tenant ${tenant.id}: ${error.message}`);
        }
      }

      runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
        processed: stats.processed,
        succeeded: stats.charged,
        failed: stats.failed,
      });
      return stats;
    } catch (error: any) {
      stats.errors.push(error.message);
      runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
        processed: stats.processed,
        succeeded: stats.charged,
        failed: stats.failed || 1,
        lastError: error.message,
      });
      return stats;
    }
  }

  async runBillingForTenant(tenantId: string): Promise<BillingStats> {
    const stats: BillingStats = {
      processed: 0,
      charged: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    await this.quarantineLegacyRecoveryBillingWorkForTenant(tenantId);
    const subscription = await ensureTenantBillingSubscription(tenantId);

    if (!subscription) {
      stats.skipped += 1;
      return stats;
    }

    if (!subscription.next_billing_date) {
      stats.skipped += 1;
      return stats;
    }

    const dueAt = new Date(subscription.next_billing_date);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() > Date.now()) {
      stats.skipped += 1;
      return stats;
    }

    const periodStart = subscription.current_period_start_at || subscription.next_billing_date;
    const periodEnd = subscription.current_period_end_at || addBillingInterval(periodStart, subscription.billing_interval);

    const { data: existingInvoice, error: existingError } = await supabaseAdmin
      .from('billing_invoices')
      .select('id, status')
      .eq('subscription_id', subscription.id)
      .eq('invoice_model', 'subscription')
      .eq('billing_period_start', periodStart)
      .eq('billing_period_end', periodEnd)
      .maybeSingle();

    if (existingError) {
      stats.failed += 1;
      stats.errors.push(existingError.message);
      return stats;
    }

    if (existingInvoice && existingInvoice.status !== 'failed' && existingInvoice.status !== 'void') {
      stats.skipped += 1;
      return stats;
    }

    stats.processed += 1;
    const result = await this.processSubscriptionInvoice(subscription);

    if (result.success) {
      if (result.invoice?.status === 'paid') {
        stats.charged += 1;
      } else {
        stats.skipped += 1;
      }
    } else {
      stats.failed += 1;
      if (result.error) stats.errors.push(result.error);
    }

    return stats;
  }

  async runBillingBackstopSweepForAllTenants(): Promise<{ tenantsProcessed: number; enqueued: number; errors: string[] }> {
    const result = { tenantsProcessed: 0, enqueued: 0, errors: [] as string[] };

    try {
      runtimeCapacityService.recordWorkerStart(this.backstopLaneName, { mode: 'subscription_backstop' });
      const billingEnabled = await operationalControlService.isEnabled('billing_charge', true);
      if (!billingEnabled) {
        runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
          processed: 0,
          succeeded: 0,
          failed: 0,
          metadata: { paused: true, reason: 'operator_disabled' },
        });
        return result;
      }

      const { data: tenants, error } = await supabaseAdmin
        .from('tenants')
        .select('id')
        .in('status', ['active', 'trialing', 'suspended', 'read_only'])
        .is('deleted_at', null);

      if (error) {
        throw error;
      }

      for (const tenant of tenants || []) {
        result.tenantsProcessed += 1;
        try {
          const ensured = await ensureTenantBillingSubscription(tenant.id);
          if (ensured) result.enqueued += 1;
          await this.quarantineLegacyRecoveryBillingWorkForTenant(tenant.id);
        } catch (tenantError: any) {
          result.errors.push(`Tenant ${tenant.id}: ${tenantError.message}`);
        }
      }

      runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
        processed: result.tenantsProcessed,
        succeeded: result.enqueued,
        failed: result.errors.length,
      });
      return result;
    } catch (error: any) {
      result.errors.push(error.message);
      runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
        processed: result.tenantsProcessed,
        succeeded: result.enqueued,
        failed: result.errors.length || 1,
        lastError: error.message,
      });
      return result;
    }
  }

  private async resolveSubscriptionBillingOwner(subscription: BillingSubscriptionRow): Promise<string | null> {
    if (subscription.user_id) return subscription.user_id;

    const { data } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id, role, created_at')
      .eq('tenant_id', subscription.tenant_id)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    const owner = (data || []).sort((left: any, right: any) => {
      const leftRank = left.role === 'owner' ? 0 : left.role === 'admin' ? 1 : 2;
      const rightRank = right.role === 'owner' ? 0 : right.role === 'admin' ? 1 : 2;
      return leftRank - rightRank;
    })[0];

    return owner?.user_id ? String(owner.user_id) : null;
  }

  private async processSubscriptionInvoice(subscription: BillingSubscriptionRow): Promise<SubscriptionInvoiceProcessResult> {
    const billingOwnerUserId = await this.resolveSubscriptionBillingOwner(subscription);
    const invoiceDateIso = new Date().toISOString();
    const invoiceId = buildSubscriptionInvoiceId(subscription, invoiceDateIso);
    const billingRequest = {
      invoiceId,
      subscriptionId: subscription.id,
      tenantId: subscription.tenant_id,
      userId: billingOwnerUserId,
      amountDueCents: subscription.billing_amount_cents,
      currency: subscription.billing_currency,
      planTier: subscription.plan_tier,
      billingInterval: subscription.billing_interval,
      periodStart: subscription.current_period_start_at || subscription.next_billing_date,
      periodEnd: subscription.current_period_end_at || (subscription.next_billing_date ? addBillingInterval(subscription.next_billing_date, subscription.billing_interval) : null),
      promoNote: undefined,
      idempotencyKey: `${subscription.id}:${subscription.next_billing_date || 'no-date'}`,
    } as const;

    const chargeResult = await billingService.chargeSubscriptionWithRetry(billingRequest, 2);
    const status = chargeResult.status === 'disabled'
      ? 'failed'
      : (chargeResult.status || 'failed');
    const provider = chargeResult.paymentProvider || subscription.billing_provider || null;
    const invoicePayload = buildSubscriptionInvoicePayload({
      subscription,
      invoiceDateIso,
      status,
      provider,
      providerInvoiceId: null,
      providerChargeId: null,
      paymentProvider: chargeResult.paymentProvider || null,
      paymentLinkKey: chargeResult.paymentLinkKey || null,
      paymentLinkUrl: chargeResult.paymentLinkUrl || null,
      amountChargedCents: status === 'paid' ? subscription.billing_amount_cents : null,
      userId: billingOwnerUserId,
      metadata: {
        charge_success: chargeResult.success,
        charge_error: chargeResult.error || null,
      },
    });

    try {
      const invoice = await upsertSubscriptionInvoice(invoicePayload);
      if (chargeResult.success) {
        await advanceSubscriptionBillingWindow(subscription, invoice);
      } else {
        await supabaseAdmin
          .from('tenant_billing_subscriptions')
          .update({
            subscription_status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription.id);
      }

      if (!chargeResult.success && chargeResult.error) {
        await billingService.logBillingError({
          userId: billingOwnerUserId,
          error: chargeResult.error,
          retryCount: 1,
          maxRetries: 2,
          metadata: {
            subscription_id: subscription.id,
            invoice_id: invoice.invoice_id,
            billing_model: 'flat_subscription',
          },
        });
      }

      return {
        success: chargeResult.success,
        invoice,
        error: chargeResult.error,
      };
    } catch (error: any) {
      await billingService.logBillingError({
        userId: billingOwnerUserId,
        error,
        retryCount: 1,
        maxRetries: 2,
        metadata: {
          subscription_id: subscription.id,
          billing_model: 'flat_subscription',
        },
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async quarantineLegacyRecoveryBillingWorkForTenant(tenantId: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('billing_work_items')
      .update({
        status: 'quarantined',
        last_error: 'legacy_recovery_billing_disabled',
        locked_at: null,
        locked_by: null,
        next_attempt_at: null,
        updated_at: timestamp,
      })
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'processing']);

    if (error) {
      logger.warn('⚠️ [BILLING] Failed to quarantine legacy recovery billing work items', {
        tenantId,
        error: error.message,
      });
    }
  }
}

const billingWorker = new BillingWorker();
export default billingWorker;
