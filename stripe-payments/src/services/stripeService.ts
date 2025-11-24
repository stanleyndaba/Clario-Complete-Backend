import Stripe from 'stripe';
import { stripe, STRIPE_CONFIG, TRANSACTION_STATUS, ACCOUNT_STATUS } from '@/config/stripeConfig';
import { prisma } from '@/prisma/client';
import { FeeCalculatorService } from './feeCalculator';
import { TransactionLogger } from './transactionLogger';
import { SupportedCurrency } from '@/config/stripeConfig';

export interface CreatePaymentIntentRequest {
  userId: number;
  claimId?: number;
  amountRecoveredCents: number;
  currency: SupportedCurrency;
  paymentMethodId?: string;
  customerId?: string;
  metadata?: Record<string, string>;
}

export interface CreatePaymentIntentResponse {
  success: boolean;
  data?: {
    paymentIntentId: string;
    clientSecret: string;
    amount: number;
    currency: string;
    status: string;
  };
  error?: string;
}

export interface CreateTransferRequest {
  userId: number;
  transactionId: number;
  amountCents: number;
  currency: SupportedCurrency;
  destinationAccountId: string;
  metadata?: Record<string, string>;
}

export interface CreateTransferResponse {
  success: boolean;
  data?: {
    transferId: string;
    amount: number;
    currency: string;
    status: string;
  };
  error?: string;
}

export interface StripeAccountInfo {
  id: string;
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities: Record<string, string>;
}

/**
 * Stripe Service
 * Handles all Stripe API interactions
 */
export class StripeService {
  /**
   * Create a PaymentIntent for charging the platform fee
   */
  static async createPaymentIntent(request: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponse> {
    try {
      const { userId, claimId, amountRecoveredCents, currency, paymentMethodId, customerId, metadata } = request;

      // Calculate fees
      const feeCalculation = FeeCalculatorService.calculateFees({
        amountRecoveredCents,
        currency,
        userId,
        claimId,
      });

      if (!feeCalculation.success || !feeCalculation.data) {
        return {
          success: false,
          error: feeCalculation.error || 'Failed to calculate fees',
        };
      }

      const { platformFee } = feeCalculation.data;

      // Create PaymentIntent
      const paymentIntentData: Stripe.PaymentIntentCreateParams = {
        amount: platformFee,
        currency,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          userId: userId.toString(),
          claimId: claimId?.toString() || '',
          amountRecoveredCents: amountRecoveredCents.toString(),
          platformFeeCents: platformFee.toString(),
          sellerPayoutCents: feeCalculation.data.sellerPayout.toString(),
          ...metadata,
        },
      };

      // Add payment method if provided
      if (paymentMethodId) {
        paymentIntentData.payment_method = paymentMethodId;
        paymentIntentData.confirm = true;
      }

      // Add customer if provided
      if (customerId) {
        paymentIntentData.customer = customerId;
      }

      const paymentIntent = await stripe.paymentIntents.create(paymentIntentData, {
        idempotencyKey: metadata?.idempotencyKey,
      });

      // Log the transaction creation
      await TransactionLogger.logTransaction({
        action: 'payment_intent_created',
        transactionId: 0, // Will be updated when transaction is created
        userId,
        status: 'success',
        stripeEventId: paymentIntent.id,
        metadata: {
          amount: platformFee,
          currency,
          paymentIntentId: paymentIntent.id,
        },
      });

      return {
        success: true,
        data: {
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret!,
          amount: platformFee,
          currency,
          status: paymentIntent.status,
        },
      };
    } catch (error) {
      console.error('Error creating PaymentIntent:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create PaymentIntent',
      };
    }
  }

  /**
   * Create a transfer to seller's Stripe account
   */
  static async createTransfer(request: CreateTransferRequest): Promise<CreateTransferResponse> {
    try {
      const { userId, transactionId, amountCents, currency, destinationAccountId, metadata } = request;

      const transferData: Stripe.TransferCreateParams = {
        amount: amountCents,
        currency,
        destination: destinationAccountId,
        metadata: {
          userId: userId.toString(),
          transactionId: transactionId.toString(),
          ...metadata,
        },
      };

      const transfer = await stripe.transfers.create(transferData, {
        idempotencyKey: metadata?.idempotencyKey,
      });

      // Log the transfer creation
      await TransactionLogger.logTransaction({
        action: 'transfer_created',
        transactionId,
        userId,
        status: 'success',
        stripeEventId: transfer.id,
        metadata: {
          amount: amountCents,
          currency,
          transferId: transfer.id,
        },
      });

      return {
        success: true,
        data: {
          transferId: transfer.id,
          amount: amountCents,
          currency,
          status: transfer.status,
        },
      };
    } catch (error) {
      console.error('Error creating transfer:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create transfer',
      };
    }
  }

  /**
   * Create or update a Stripe customer
   */
  static async createCustomer(userId: number, email: string, name?: string): Promise<string> {
    try {
      // Reuse existing mapping if present
      const mapping = await prisma.stripeCustomer.findUnique({ where: { id: userId } });
      if (!mapping) {
        throw new Error('Stripe customer mapping not found. Ensure /stripe/customer-map has been called.');
      }

      if (mapping.stripeCustomerId) {
        return mapping.stripeCustomerId;
      }

      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          externalUserId: mapping.externalUserId,
        },
      });

      await prisma.stripeCustomer.update({
        where: { id: userId },
        data: {
          stripeCustomerId: customer.id,
          email,
        },
      });

      return customer.id;
    } catch (error) {
      console.error('Error creating customer:', error);
      throw new Error('Failed to create customer');
    }
  }

  /**
   * Create a SetupIntent for saving payment methods
   */
  static async createSetupIntent(customerId: string, metadata?: Record<string, string>): Promise<string> {
    try {
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        metadata,
      });

      return setupIntent.client_secret!;
    } catch (error) {
      console.error('Error creating SetupIntent:', error);
      throw new Error('Failed to create SetupIntent');
    }
  }

  /**
   * Create a subscription for a customer
   */
  static async createSubscription(userId: number, customerId: string, priceId?: string) {
    try {
      const price = priceId || STRIPE_CONFIG.PRICE_ID;
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
        metadata: { userId: userId.toString() },
      });

      await prisma.stripeSubscription.create({
        data: {
          userId,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: customerId,
          priceId: price,
          status: subscription.status,
          currentPeriodStart: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : null,
          currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
        },
      });

      const latestInvoice: any = subscription.latest_invoice;
      const clientSecret = latestInvoice?.payment_intent?.client_secret as string | undefined;

      return { subscriptionId: subscription.id, clientSecret };
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw new Error('Failed to create subscription');
    }
  }

  /**
   * Cancel a subscription
   */
  static async cancelSubscription(stripeSubscriptionId: string, cancelAtPeriodEnd: boolean = true) {
    try {
      const sub = await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: cancelAtPeriodEnd });
      await prisma.stripeSubscription.update({
        where: { stripeSubscriptionId },
        data: {
          status: sub.status,
          cancelAtPeriodEnd: sub.cancel_at_period_end || false,
          canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        },
      });
      return sub.status;
    } catch (error) {
      console.error('Error canceling subscription:', error);
      throw new Error('Failed to cancel subscription');
    }
  }

  /**
   * Create a Stripe Connect account
   */
  static async createConnectAccount(userId: number, email: string, country: string): Promise<StripeAccountInfo> {
    try {
      const account = await stripe.accounts.create({
        type: 'express',
        country,
        email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          userId: userId.toString(),
        },
      });

      return {
        id: account.id,
        status: account.status,
        chargesEnabled: account.charges_enabled || false,
        payoutsEnabled: account.payouts_enabled || false,
        detailsSubmitted: account.details_submitted || false,
        capabilities: account.capabilities || {},
      };
    } catch (error) {
      console.error('Error creating Connect account:', error);
      throw new Error('Failed to create Connect account');
    }
  }

  /**
   * Get Stripe account information
   */
  static async getAccountInfo(accountId: string): Promise<StripeAccountInfo> {
    try {
      const account = await stripe.accounts.retrieve(accountId);

      return {
        id: account.id,
        status: account.status,
        chargesEnabled: account.charges_enabled || false,
        payoutsEnabled: account.payouts_enabled || false,
        detailsSubmitted: account.details_submitted || false,
        capabilities: account.capabilities || {},
      };
    } catch (error) {
      console.error('Error retrieving account:', error);
      throw new Error('Failed to retrieve account');
    }
  }

  /**
   * Create an account link for Connect onboarding
   */
  static async createAccountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
    try {
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });

      return accountLink.url;
    } catch (error) {
      console.error('Error creating account link:', error);
      throw new Error('Failed to create account link');
    }
  }

  /**
   * Retrieve a PaymentIntent
   */
  static async getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    try {
      return await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      console.error('Error retrieving PaymentIntent:', error);
      throw new Error('Failed to retrieve PaymentIntent');
    }
  }

  /**
   * Confirm a PaymentIntent
   */
  static async confirmPaymentIntent(paymentIntentId: string, paymentMethodId?: string): Promise<Stripe.PaymentIntent> {
    try {
      const confirmData: Stripe.PaymentIntentConfirmParams = {};
      
      if (paymentMethodId) {
        confirmData.payment_method = paymentMethodId;
      }

      return await stripe.paymentIntents.confirm(paymentIntentId, confirmData);
    } catch (error) {
      console.error('Error confirming PaymentIntent:', error);
      throw new Error('Failed to confirm PaymentIntent');
    }
  }

  /**
   * Refund a PaymentIntent
   */
  static async refundPaymentIntent(paymentIntentId: string, amount?: number): Promise<Stripe.Refund> {
    try {
      const refundData: Stripe.RefundCreateParams = {
        payment_intent: paymentIntentId,
      };

      if (amount) {
        refundData.amount = amount;
      }

      return await stripe.refunds.create(refundData);
    } catch (error) {
      console.error('Error refunding PaymentIntent:', error);
      throw new Error('Failed to refund PaymentIntent');
    }
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
    try {
      return stripe.webhooks.constructEvent(payload, signature, STRIPE_CONFIG.WEBHOOK_SECRET);
    } catch (error) {
      console.error('Error verifying webhook signature:', error);
      throw new Error('Invalid webhook signature');
    }
  }
} 