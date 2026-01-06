import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '@/prisma/client';
import { StripeService } from '@/services/stripeService';
import { FeeCalculatorService } from '@/services/feeCalculator';
import { PayoutJobQueue } from '@/jobs/payoutJob';
import { processIdempotency, storeIdempotencyKey } from '@/utils/idempotency';
import { TRANSACTION_STATUS } from '@/config/stripeConfig';
import { STRIPE_CONFIG } from '@/config/stripeConfig';

export interface ChargeCommissionRequest {
  userId: number;
  claimId?: number;
  amountRecoveredCents: number;
  currency: string;
  idempotencyKey?: string;
  paymentMethodId?: string;
  customerId?: string;
}

export interface ConnectAccountRequest {
  userId: number;
  email: string;
  country: string;
  returnUrl: string;
  refreshUrl: string;
}

/**
 * Checkout Controller
 * Handles Stripe Connect onboarding and commission charging
 */
export class CheckoutController {
  /**
   * Initiate Stripe Connect onboarding
   */
  static async connectAccount(req: Request, res: Response) {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
        });
      }

      const { userId, email, country, returnUrl, refreshUrl }: ConnectAccountRequest = req.body;

      // Check if user already has a Stripe account
      const existingAccount = await prisma.stripeAccount.findUnique({
        where: { userId },
      });

      if (existingAccount) {
        // Get updated account info from Stripe
        const accountInfo = await StripeService.getAccountInfo(existingAccount.stripeAccountId);
        
        return res.json({
          success: true,
          data: {
            stripeAccountId: existingAccount.stripeAccountId,
            status: accountInfo.status,
            chargesEnabled: accountInfo.chargesEnabled,
            payoutsEnabled: accountInfo.payoutsEnabled,
            detailsSubmitted: accountInfo.detailsSubmitted,
            onboardingUrl: null, // Already onboarded
          },
        });
      }

      // Create new Connect account
      const accountInfo = await StripeService.createConnectAccount(userId, email, country);

      // Store account in database
      await prisma.stripeAccount.create({
        data: {
          userId,
          stripeAccountId: accountInfo.id,
          status: accountInfo.status,
          chargesEnabled: accountInfo.chargesEnabled,
          payoutsEnabled: accountInfo.payoutsEnabled,
          detailsSubmitted: accountInfo.detailsSubmitted,
        },
      });

      // Create onboarding link
      const onboardingUrl = await StripeService.createAccountLink(
        accountInfo.id,
        returnUrl,
        refreshUrl
      );

      res.json({
        success: true,
        data: {
          stripeAccountId: accountInfo.id,
          status: accountInfo.status,
          chargesEnabled: accountInfo.chargesEnabled,
          payoutsEnabled: accountInfo.payoutsEnabled,
          detailsSubmitted: accountInfo.detailsSubmitted,
          onboardingUrl,
        },
      });
    } catch (error) {
      console.error('Error in connectAccount:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to create Connect account',
      });
    }
  }

  /**
   * Get Stripe account status
   */
  static async getAccountStatus(req: Request, res: Response) {
    try {
      const userId = parseInt(req.params.userId);

      if (!userId) {
        return res.status(400).json({
          error: 'Invalid user ID',
          message: 'User ID is required',
        });
      }

      const account = await prisma.stripeAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        return res.status(404).json({
          error: 'Account not found',
          message: 'No Stripe account found for this user',
        });
      }

      // Get updated info from Stripe
      const accountInfo = await StripeService.getAccountInfo(account.stripeAccountId);

      // Update local database with latest info
      await prisma.stripeAccount.update({
        where: { id: account.id },
        data: {
          status: accountInfo.status,
          chargesEnabled: accountInfo.chargesEnabled,
          payoutsEnabled: accountInfo.payoutsEnabled,
          detailsSubmitted: accountInfo.detailsSubmitted,
        },
      });

      res.json({
        success: true,
        data: {
          stripeAccountId: account.stripeAccountId,
          status: accountInfo.status,
          chargesEnabled: accountInfo.chargesEnabled,
          payoutsEnabled: accountInfo.payoutsEnabled,
          detailsSubmitted: accountInfo.detailsSubmitted,
          capabilities: accountInfo.capabilities,
        },
      });
    } catch (error) {
      console.error('Error in getAccountStatus:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to get account status',
      });
    }
  }

  /**
   * Charge commission (called by refund-engine when refund is confirmed)
   */
  static async chargeCommission(req: Request, res: Response) {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
        });
      }

      const {
        userId,
        claimId,
        amountRecoveredCents,
        currency,
        idempotencyKey,
        paymentMethodId,
        customerId,
      }: ChargeCommissionRequest = req.body;

      // Check idempotency
      const idempotencyResult = await processIdempotency(req, userId, '/api/v1/stripe/charge-commission');
      
      if (idempotencyResult.isDuplicate && idempotencyResult.cachedResponse) {
        return res.json(idempotencyResult.cachedResponse);
      }

      // Calculate fees
      const feeCalculation = FeeCalculatorService.calculateFees({
        amountRecoveredCents,
        currency: currency as any,
        userId,
        claimId,
      });

      if (!feeCalculation.success || !feeCalculation.data) {
        return res.status(400).json({
          error: 'Fee calculation failed',
          message: feeCalculation.error || 'Failed to calculate fees',
        });
      }

      // Check if transaction already exists for this claim
      if (claimId) {
        const existingTransaction = await prisma.stripeTransaction.findFirst({
          where: { claimId },
        });

        if (existingTransaction) {
          const response = {
            success: true,
            data: {
              transactionId: existingTransaction.id,
              status: existingTransaction.status,
              message: 'Transaction already exists for this claim',
            },
          };

          // Store idempotency response
          if (idempotencyKey) {
            await storeIdempotencyKey(idempotencyKey, userId, '/api/v1/stripe/charge-commission', response);
          }

          return res.json(response);
        }
      }

      // Create transaction record
      const transaction = await prisma.stripeTransaction.create({
        data: {
          userId,
          claimId,
          amountRecoveredCents,
          platformFeeCents: feeCalculation.data.platformFee,
          sellerPayoutCents: feeCalculation.data.sellerPayout,
          currency: feeCalculation.data.currency,
          status: TRANSACTION_STATUS.PENDING,
          idempotencyKey,
          metadata: {
            paymentMethodId,
            customerId,
          },
        },
      });

      // Add payment job to queue
      await PayoutJobQueue.addPaymentJob({
        transactionId: transaction.id,
        userId,
        claimId,
        amountRecoveredCents,
        currency,
        paymentMethodId,
        customerId,
      });

      const response = {
        success: true,
        data: {
          transactionId: transaction.id,
          status: transaction.status,
          platformFeeCents: transaction.platformFeeCents,
          sellerPayoutCents: transaction.sellerPayoutCents,
          currency: transaction.currency,
          message: 'Commission charge initiated',
        },
      };

      // Store idempotency response
      if (idempotencyKey) {
        await storeIdempotencyKey(idempotencyKey, userId, '/api/v1/stripe/charge-commission', response);
      }

      res.json(response);
    } catch (error) {
      console.error('Error in chargeCommission:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to charge commission',
      });
    }
  }

  /**
   * Create or fetch Stripe customer and SetupIntent
   */
  static async createCustomerAndSetupIntent(req: Request, res: Response) {
    try {
      const { userId, email, name } = req.body as { userId: number; email: string; name?: string };
      if (!userId || !email) {
        return res.status(400).json({ error: 'Missing parameters', message: 'userId and email are required' });
      }

      const customerId = await StripeService.createCustomer(userId, email, name);
      const clientSecret = await StripeService.createSetupIntent(customerId, { userId: String(userId) });

      return res.json({ success: true, data: { customerId, setupClientSecret: clientSecret } });
    } catch (error) {
      console.error('Error in createCustomerAndSetupIntent:', error);
      return res.status(500).json({ error: 'Internal server error', message: 'Failed to create customer/setup intent' });
    }
  }

  /**
   * Create subscription for a user/customer
   */
  static async createSubscription(req: Request, res: Response) {
    try {
      const { userId, customerId, priceId } = req.body as { userId: number; customerId: string; priceId?: string };
      if (!userId || !customerId) {
        return res.status(400).json({ error: 'Missing parameters', message: 'userId and customerId are required' });
      }

      const result = await StripeService.createSubscription(userId, customerId, priceId || STRIPE_CONFIG.PRICE_ID);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error in createSubscription:', error);
      return res.status(500).json({ error: 'Internal server error', message: 'Failed to create subscription' });
    }
  }

  /**
   * Cancel subscription
   */
  static async cancelSubscription(req: Request, res: Response) {
    try {
      const { stripeSubscriptionId, cancelAtPeriodEnd = true } = req.body as { stripeSubscriptionId: string; cancelAtPeriodEnd?: boolean };
      if (!stripeSubscriptionId) {
        return res.status(400).json({ error: 'Missing parameter', message: 'stripeSubscriptionId is required' });
      }
      const status = await StripeService.cancelSubscription(stripeSubscriptionId, cancelAtPeriodEnd);
      return res.json({ success: true, data: { status } });
    } catch (error) {
      console.error('Error in cancelSubscription:', error);
      return res.status(500).json({ error: 'Internal server error', message: 'Failed to cancel subscription' });
    }
  }

  /**
   * Get transaction by ID
   */
  static async getTransaction(req: Request, res: Response) {
    try {
      const transactionId = parseInt(req.params.transactionId);

      if (!transactionId) {
        return res.status(400).json({
          error: 'Invalid transaction ID',
          message: 'Transaction ID is required',
        });
      }

      const transaction = await prisma.stripeTransaction.findUnique({
        where: { id: transactionId },
        include: {
          auditTrail: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!transaction) {
        return res.status(404).json({
          error: 'Transaction not found',
          message: 'No transaction found with this ID',
        });
      }

      res.json({
        success: true,
        data: transaction,
      });
    } catch (error) {
      console.error('Error in getTransaction:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to get transaction',
      });
    }
  }

  /**
   * List transactions for user
   */
  static async listTransactions(req: Request, res: Response) {
    try {
      const userId = parseInt(req.params.userId);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string;

      if (!userId) {
        return res.status(400).json({
          error: 'Invalid user ID',
          message: 'User ID is required',
        });
      }

      const where: any = { userId };
      if (status) {
        where.status = status;
      }

      const transactions = await prisma.stripeTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          auditTrail: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      const total = await prisma.stripeTransaction.count({ where });

      res.json({
        success: true,
        data: {
          transactions,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      console.error('Error in listTransactions:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to list transactions',
      });
    }
  }
}

// Validation schemas
export const connectAccountValidation = [
  body('userId').isInt().withMessage('User ID must be an integer'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('country').isLength({ min: 2, max: 2 }).withMessage('Country must be a 2-letter code'),
  body('returnUrl').isURL().withMessage('Valid return URL is required'),
  body('refreshUrl').isURL().withMessage('Valid refresh URL is required'),
];

export const chargeCommissionValidation = [
  body('userId').isInt().withMessage('User ID must be an integer'),
  body('amountRecoveredCents').isInt({ min: 1 }).withMessage('Amount must be a positive integer'),
  body('currency').isIn(['usd', 'eur', 'gbp', 'cad']).withMessage('Invalid currency'),
  body('claimId').optional().isInt().withMessage('Claim ID must be an integer'),
  body('idempotencyKey').optional().isUUID().withMessage('Invalid idempotency key format'),
  body('paymentMethodId').optional().isString().withMessage('Payment method ID must be a string'),
  body('customerId').optional().isString().withMessage('Customer ID must be a string'),
]; 