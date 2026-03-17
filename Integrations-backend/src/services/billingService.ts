import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import paypalService from './paypalService';

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
  paypalInvoiceId?: string;
  platformFeeCents?: number;
  sellerPayoutCents?: number;
  status?: 'pending' | 'charged' | 'failed' | 'disabled' | 'sent';
  error?: string;
}

export interface FeeCalculation {
  amountRecoveredCents: number;
  platformFeeCents: number;
  sellerPayoutCents: number;
  currency: string;
}

/**
 * Billing Service (Strictly PayPal)
 * Handles billing operations for recovered amounts via PayPal Invoicing
 */
class BillingService {
  private platformFeePercentage: number = 20; // 20% platform fee
  private minimumFeeCents: number = 50; // $0.50 minimum fee

  constructor() {
    logger.info('💳 [BILLING] Billing Service initialized with PayPal');
  }

  /**
   * Calculate platform fee (20%) and seller payout (80%)
   */
  calculateFees(amountRecoveredCents: number, currency: string = 'usd'): FeeCalculation {
    if (amountRecoveredCents < 0) {
      throw new Error('Amount recovered cannot be negative');
    }

    if (amountRecoveredCents === 0) {
      return {
        amountRecoveredCents: 0,
        platformFeeCents: 0,
        sellerPayoutCents: 0,
        currency
      };
    }

    const platformFeeCents = Math.round((amountRecoveredCents * this.platformFeePercentage) / 100);
    const finalPlatformFee = Math.min(Math.max(platformFeeCents, this.minimumFeeCents), amountRecoveredCents);
    const sellerPayoutCents = amountRecoveredCents - finalPlatformFee;

    return {
      amountRecoveredCents,
      platformFeeCents: finalPlatformFee,
      sellerPayoutCents,
      currency
    };
  }

  /**
   * Charge commission via PayPal Invoicing
   */
  async chargeCommission(request: BillingRequest): Promise<BillingResult> {
    try {
      logger.info('💳 [BILLING] Charging commission via PayPal', {
        disputeId: request.disputeId,
        amountRecoveredCents: request.amountRecoveredCents
      });

      // 1. Fetch user record
      let userEmail = 'billing-fallback@margin-finance.com';
      const { data: userRecord, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email, seller_id')
        .eq('seller_id', request.userId)
        .single();

      if (userRecord?.email) {
        userEmail = userRecord.email;
      } else {
        logger.warn('⚠️ [BILLING] Using fallback email for shadow user', {
          userId: request.userId,
          fallbackEmail: userEmail
        });
      }

      // 2. Calculate fees
      const fees = this.calculateFees(request.amountRecoveredCents, request.currency || 'USD');

      // 3. Create PayPal Invoice
      const invoiceData = {
        detail: {
          reference: request.disputeId,
          currency_code: fees.currency.toUpperCase(),
          note: "Platform Service Fee (20%) for successful Amazon FBA recovery.",
          term: "Payable on receipt",
          payment_term: {
            term_type: "NET_10"
          }
        },
        invoicer: {
          business_name: "Margin Finance",
          email_address: "mvelo@margin-finance.com"
        },
        primary_recipients: [
          {
            billing_info: {
              email_address: userRecord?.email || "mvelo.ndaba@gmail.com",
              name: {
                given_name: "Valued",
                surname: "Merchant"
              }
            }
          }
        ],
        items: [
          {
            name: "Recovery Commission (20%)",
            description: `Commission for recovered funds on dispute ${request.disputeId}`,
            quantity: "1",
            unit_amount: {
              currency_code: fees.currency.toUpperCase(),
              value: (fees.platformFeeCents / 100).toFixed(2)
            }
          }
        ],
        configuration: {
          allow_tip: false,
          tax_inclusive: false
        }
      };

      const paypalInvoice = await paypalService.createInvoice(invoiceData);
      
      // 4. Send Invoice immediately
      const sent = await paypalService.sendInvoice(paypalInvoice.id);

      if (!sent) {
        throw new Error('Failed to send PayPal invoice after creation');
      }

      logger.info('✅ [BILLING] PayPal commission invoice sent successfully', {
        disputeId: request.disputeId,
        paypalInvoiceId: paypalInvoice.id,
        platformFeeCents: fees.platformFeeCents
      });

      return {
        success: true,
        paypalInvoiceId: paypalInvoice.id,
        platformFeeCents: fees.platformFeeCents,
        sellerPayoutCents: fees.sellerPayoutCents,
        status: 'sent'
      };

    } catch (error: any) {
      if (error.response?.data) {
        console.error('❌ [BILLING] PayPal API Error Details:', JSON.stringify(error.response.data, null, 2));
      }
      logger.error('❌ [BILLING] Failed to charge commission via PayPal', {
        disputeId: request.disputeId,
        userId: request.userId,
        error: error.message
      });

      return {
        success: false,
        status: 'failed',
        error: error.message || 'Failed to charge commission'
      };
    }
  }

  /**
   * Charge commission using a vaulted payment method (Auto-Charge)
   */
  async chargeVaultedPayment(request: BillingRequest): Promise<BillingResult> {
    try {
      logger.info('💳 [BILLING] Auto-charging via PayPal Vault', {
        disputeId: request.disputeId,
        userId: request.userId
      });

      // 1. Fetch user record for vault token
      const { data: userRecord, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, paypal_payment_token')
        .eq('seller_id', request.userId)
        .single();

      if (!userRecord?.paypal_payment_token) {
        logger.warn('⚠️ [BILLING] No vaulted payment method found for user, falling back to invoice', {
          userId: request.userId
        });
        return this.chargeCommission(request);
      }

      // 2. Calculate fees
      const fees = this.calculateFees(request.amountRecoveredCents, request.currency || 'USD');

      // 3. Create PayPal Order using Vault ID
      const amount = (fees.platformFeeCents / 100).toFixed(2);
      const chargeResult = await paypalService.chargePaymentToken(
        userRecord.paypal_payment_token,
        amount,
        fees.currency,
        request.disputeId
      );

      logger.info('✅ [BILLING] Automated charge successful', {
        disputeId: request.disputeId,
        orderId: chargeResult.id
      });

      return {
        success: true,
        platformFeeCents: fees.platformFeeCents,
        sellerPayoutCents: fees.sellerPayoutCents,
        status: 'charged',
        metadata: {
          paypalOrderId: chargeResult.id
        }
      } as any;

    } catch (error: any) {
      logger.error('❌ [BILLING] Automated charge failed', {
        disputeId: request.disputeId,
        error: error.message
      });
      
      // Fallback to invoice if auto-charge fails
      return this.chargeCommission(request);
    }
  }

  /**
   * Charge commission with retry logic
   */
  async chargeCommissionWithRetry(request: BillingRequest, maxRetries: number = 3): Promise<BillingResult> {
    let lastResult: BillingResult = { success: false, status: 'failed' };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.chargeCommission(request);
        if (result.success) return result;
        lastResult = result;
      } catch (error: any) {
        lastResult = { success: false, status: 'failed', error: error.message };
      }
      
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return lastResult;
  }

  /**
   * Log billing error
   */
  async logBillingError(disputeId: string, recoveryId: string | null, userId: string, error: Error | string, retryCount: number = 0, maxRetries: number = 3): Promise<void> {
    try {
      const errorMessage = error instanceof Error ? error.message : error;
      await supabaseAdmin.from('billing_errors').insert({
        dispute_id: disputeId,
        recovery_id: recoveryId,
        user_id: userId,
        error_type: 'billing_failed_paypal',
        error_message: errorMessage,
        retry_count: retryCount,
        max_retries: maxRetries
      });
    } catch (logError) {
      logger.error('❌ [BILLING] Failed to log error', { disputeId, error: logError });
    }
  }

  // Backwards compatibility for Worker
  async calculateFeesDeprecated(amount: number) { return this.calculateFees(amount); }
}

export default new BillingService();
