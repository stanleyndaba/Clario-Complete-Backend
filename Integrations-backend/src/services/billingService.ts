import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import {
  BillingInterval,
  PlanTier,
} from './subscriptionBillingTruthService';
import { resolveYocoCheckoutLink } from './yocoCheckoutLinkService';

export interface BillingRequest {
  invoiceId: string;
  subscriptionId: string;
  tenantId: string;
  userId?: string | null;
  amountDueCents: number;
  currency?: string;
  planTier: PlanTier;
  billingInterval: BillingInterval;
  periodStart?: string | null;
  periodEnd?: string | null;
  promoNote?: string | null;
  idempotencyKey?: string;
}

export interface BillingResult {
  success: boolean;
  paymentProvider?: 'yoco' | null;
  paymentLinkKey?: string | null;
  paymentLinkUrl?: string | null;
  amountDueCents?: number;
  status?: 'pending' | 'paid' | 'failed' | 'disabled';
  error?: string;
}

const LEGACY_RECOVERY_BILLING_DISABLED = 'Legacy recovery-based billing is disabled. Margin now uses flat subscription billing only.';

class BillingService {
  constructor() {
    logger.info('💳 [BILLING] Billing Service initialized for flat subscription pricing');
  }

  async chargeSubscription(request: BillingRequest): Promise<BillingResult> {
    try {
      logger.info('💳 [BILLING] Processing subscription billing', {
        invoiceId: request.invoiceId,
        subscriptionId: request.subscriptionId,
        tenantId: request.tenantId,
        amountDueCents: request.amountDueCents,
        planTier: request.planTier,
        billingInterval: request.billingInterval,
      });

      if (request.amountDueCents <= 0) {
        return {
          success: true,
          amountDueCents: 0,
          status: 'paid',
          paymentProvider: null,
          paymentLinkKey: null,
          paymentLinkUrl: null,
        };
      }

      const paymentLink = resolveYocoCheckoutLink({
        planTier: request.planTier,
        billingInterval: request.billingInterval,
        billingAmountCents: request.amountDueCents,
      });

      return {
        success: true,
        paymentProvider: paymentLink.paymentProvider,
        paymentLinkKey: paymentLink.paymentLinkKey,
        paymentLinkUrl: paymentLink.paymentLinkUrl,
        amountDueCents: request.amountDueCents,
        status: 'pending',
        error: paymentLink.paymentLinkUrl ? undefined : `YOCO payment link unavailable: ${paymentLink.mappingStatus}`,
      };
    } catch (error: any) {
      logger.error('❌ [BILLING] Failed to process subscription billing', {
        invoiceId: request.invoiceId,
        subscriptionId: request.subscriptionId,
        tenantId: request.tenantId,
        error: error.message,
      });

      return {
        success: false,
        amountDueCents: request.amountDueCents,
        status: 'failed',
        error: error.message || 'Failed to process subscription billing',
      };
    }
  }

  async chargeSubscriptionWithRetry(request: BillingRequest, maxRetries: number = 3): Promise<BillingResult> {
    let lastResult: BillingResult = { success: false, status: 'failed' };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.chargeSubscription(request);
        if (result.success) return result;
        lastResult = result;
      } catch (error: any) {
        lastResult = { success: false, status: 'failed', error: error.message };
      }

      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return lastResult;
  }

  async logBillingError(params: {
    userId?: string | null;
    disputeId?: string | null;
    recoveryId?: string | null;
    error: Error | string;
    retryCount?: number;
    maxRetries?: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      const errorMessage = params.error instanceof Error ? params.error.message : params.error;
      await supabaseAdmin.from('billing_errors').insert({
        dispute_id: params.disputeId || null,
        recovery_id: params.recoveryId || null,
        user_id: params.userId || 'unknown-user',
        error_type: 'subscription_billing_failed',
        error_message: errorMessage,
        retry_count: params.retryCount ?? 0,
        max_retries: params.maxRetries ?? 3,
        metadata: params.metadata || {},
      });
    } catch (logError) {
      logger.error('❌ [BILLING] Failed to log billing error', { error: logError });
    }
  }

  calculateFees(): never {
    throw new Error(LEGACY_RECOVERY_BILLING_DISABLED);
  }

  async chargeCommission(): Promise<BillingResult> {
    return {
      success: false,
      status: 'disabled',
      error: LEGACY_RECOVERY_BILLING_DISABLED,
    };
  }

  async chargeVaultedPayment(): Promise<BillingResult> {
    return {
      success: false,
      status: 'disabled',
      error: LEGACY_RECOVERY_BILLING_DISABLED,
    };
  }

  async chargeCommissionWithRetry(): Promise<BillingResult> {
    return {
      success: false,
      status: 'disabled',
      error: LEGACY_RECOVERY_BILLING_DISABLED,
    };
  }
}

export default new BillingService();
