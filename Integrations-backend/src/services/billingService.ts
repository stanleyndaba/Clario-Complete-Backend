/**
 * Billing Service
 * Handles billing operations for recovered amounts
 * Integrates with Stripe Payments API to charge 20% platform fee
 */

import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import axios from 'axios';

export interface BillingRequest {
  disputeId: string;
  recoveryId?: string;
  userId: string;
  amountRecoveredCents: number;
  currency?: string;
  idempotencyKey?: string;
}

export interface BillingResult {
  success: boolean;
  billingTransactionId?: string;
  stripeTransactionId?: number;
  stripePaymentIntentId?: string;
  platformFeeCents?: number;
  sellerPayoutCents?: number;
  status?: 'pending' | 'charged' | 'failed';
  error?: string;
}

export interface FeeCalculation {
  amountRecoveredCents: number;
  platformFeeCents: number;
  sellerPayoutCents: number;
  currency: string;
}

class BillingService {
  private stripePaymentsUrl: string | null;
  private platformFeePercentage: number = 20; // 20% platform fee
  private minimumFeeCents: number = 50; // $0.50 minimum fee

  constructor() {
    this.stripePaymentsUrl = process.env.STRIPE_PAYMENTS_URL || null;
    if (this.stripePaymentsUrl) {
      logger.info('💳 [BILLING] Billing Service initialized', {
        stripePaymentsUrl: this.stripePaymentsUrl
      });
    } else {
      logger.warn('💳 [BILLING] STRIPE_PAYMENTS_URL not configured - billing service disabled until configured');
    }
  }

  /**
   * Calculate platform fee (20%) and seller payout (80%)
   */
  calculateFees(amountRecoveredCents: number, currency: string = 'usd'): FeeCalculation {
    if (amountRecoveredCents <= 0) {
      throw new Error('Amount must be positive');
    }

    // Calculate platform fee (20%)
    const platformFeeCents = Math.round(
      (amountRecoveredCents * this.platformFeePercentage) / 100
    );

    // Ensure minimum fee
    const finalPlatformFee = Math.max(platformFeeCents, this.minimumFeeCents);

    // Calculate seller payout (80%)
    const sellerPayoutCents = amountRecoveredCents - finalPlatformFee;

    // Validate that seller payout is not negative
    if (sellerPayoutCents < 0) {
      throw new Error('Seller payout cannot be negative');
    }

    return {
      amountRecoveredCents,
      platformFeeCents: finalPlatformFee,
      sellerPayoutCents,
      currency
    };
  }

  /**
   * Charge commission via Stripe Payments API
   */
  async chargeCommission(request: BillingRequest): Promise<BillingResult> {
    try {
      if (!this.stripePaymentsUrl) {
        throw new Error('Stripe payments service is not configured (set STRIPE_PAYMENTS_URL)');
      }

      logger.info('💳 [BILLING] Charging commission', {
        disputeId: request.disputeId,
        userId: request.userId,
        amountRecoveredCents: request.amountRecoveredCents
      });

      // Calculate fees
      const feeCalculation = this.calculateFees(
        request.amountRecoveredCents,
        request.currency || 'usd'
      );

      // Generate idempotency key if not provided
      const idempotencyKey = request.idempotencyKey || 
        `billing-${request.disputeId}-${Date.now()}`;

      // Call Stripe Payments API
      const response = await axios.post(
        `${this.stripePaymentsUrl}/api/v1/stripe/charge-commission`,
        {
          userId: parseInt(request.userId, 10),
          claimId: request.disputeId, // Note: Stripe API expects claimId as number, but we pass disputeId as string
          amountRecoveredCents: request.amountRecoveredCents,
          currency: request.currency || 'usd',
          idempotencyKey,
          metadata: {
            disputeId: request.disputeId,
            recoveryId: request.recoveryId,
            source: 'billing_worker'
          }
        },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || 'Failed to charge commission');
      }

      const transactionData = response.data.data;

      logger.info('✅ [BILLING] Commission charged successfully', {
        disputeId: request.disputeId,
        transactionId: transactionData.transactionId,
        platformFeeCents: feeCalculation.platformFeeCents
      });

      return {
        success: true,
        stripeTransactionId: transactionData.transactionId,
        stripePaymentIntentId: transactionData.paymentIntentId,
        platformFeeCents: feeCalculation.platformFeeCents,
        sellerPayoutCents: feeCalculation.sellerPayoutCents,
        status: transactionData.status || 'pending'
      };

    } catch (error: any) {
      logger.error('❌ [BILLING] Failed to charge commission', {
        disputeId: request.disputeId,
        userId: request.userId,
        error: error.message,
        response: error.response?.data
      });

      return {
        success: false,
        status: 'failed',
        error: error.message || 'Failed to charge commission'
      };
    }
  }

  /**
   * Charge commission with retry logic
   */
  async chargeCommissionWithRetry(
    request: BillingRequest,
    maxRetries: number = 3
  ): Promise<BillingResult> {
    if (!this.stripePaymentsUrl) {
      const errorMessage = 'Stripe payments service disabled (STRIPE_PAYMENTS_URL not set)';
      logger.info('💳 [BILLING] Skipping commission charge - Stripe not configured', {
        disputeId: request.disputeId,
        userId: request.userId,
        error: errorMessage
      });
      return {
        success: false,
        status: 'disabled',
        error: errorMessage
      };
    }

    let lastError: any;
    let lastResult: BillingResult | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.chargeCommission(request);

        if (result.success) {
          return result;
        }

        lastResult = result;
        lastError = new Error(result.error || 'Failed to charge commission');

        if (attempt < maxRetries) {
          const delay = 2000 * Math.pow(2, attempt); // Exponential backoff
          logger.warn(`🔄 [BILLING] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
            disputeId: request.disputeId,
            error: lastError.message
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (error: any) {
        lastError = error;
        lastResult = {
          success: false,
          status: 'failed',
          error: error.message
        };

        if (attempt < maxRetries) {
          const delay = 2000 * Math.pow(2, attempt);
          logger.warn(`🔄 [BILLING] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
            disputeId: request.disputeId,
            error: error.message
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('❌ [BILLING] All retry attempts exhausted', {
      disputeId: request.disputeId,
      maxRetries,
      error: lastError?.message
    });

    return lastResult || {
      success: false,
      status: 'failed',
      error: lastError?.message || 'Failed to charge commission after retries'
    };
  }

  /**
   * Get billing status for a dispute case
   */
  async getBillingStatus(disputeId: string): Promise<{
    billingStatus: string | null;
    billingTransactionId: string | null;
    platformFeeCents: number | null;
    billedAt: string | null;
  }> {
    try {
      // Get dispute case
      const { data: disputeCase } = await supabaseAdmin
        .from('dispute_cases')
        .select('billing_status, billing_transaction_id, platform_fee_cents, billed_at')
        .eq('id', disputeId)
        .single();

      if (!disputeCase) {
        return {
          billingStatus: null,
          billingTransactionId: null,
          platformFeeCents: null,
          billedAt: null
        };
      }

      return {
        billingStatus: disputeCase.billing_status || null,
        billingTransactionId: disputeCase.billing_transaction_id || null,
        platformFeeCents: disputeCase.platform_fee_cents || null,
        billedAt: disputeCase.billed_at || null
      };

    } catch (error: any) {
      logger.error('❌ [BILLING] Failed to get billing status', {
        disputeId,
        error: error.message
      });
      return {
        billingStatus: null,
        billingTransactionId: null,
        platformFeeCents: null,
        billedAt: null
      };
    }
  }

  /**
   * Log billing error
   */
  async logBillingError(
    disputeId: string,
    recoveryId: string | null,
    userId: string,
    error: Error | string,
    retryCount: number = 0,
    maxRetries: number = 3
  ): Promise<void> {
    try {
      const errorMessage = error instanceof Error ? error.message : error;
      const errorStack = error instanceof Error ? error.stack : null;

      await supabaseAdmin
        .from('billing_errors')
        .insert({
          dispute_id: disputeId,
          recovery_id: recoveryId,
          user_id: userId,
          error_type: 'billing_failed',
          error_message: errorMessage,
          error_stack: errorStack,
          retry_count: retryCount,
          max_retries: maxRetries,
          metadata: {
            timestamp: new Date().toISOString()
          }
        });

      logger.debug('📝 [BILLING] Error logged', {
        disputeId,
        errorMessage
      });

    } catch (logError: any) {
      logger.error('❌ [BILLING] Failed to log error', {
        disputeId,
        error: logError.message
      });
    }
  }
}

// Export singleton instance
const billingService = new BillingService();
export default billingService;

