import { Request, Response } from 'express';
import { prisma } from '@/prisma/client';
import { StripeService } from '@/services/stripeService';
import { TransactionLogger } from '@/services/transactionLogger';
import { ReconciliationService } from '@/services/reconciliationService';
import { PayoutJobQueue } from '@/jobs/payoutJob';
import { WEBHOOK_EVENTS, TRANSACTION_STATUS } from '@/config/stripeConfig';

/**
 * Webhook Controller
 * Handles Stripe webhook events
 */
export class WebhookController {
  /**
   * Process Stripe webhook events
   */
  static async handleWebhook(req: Request, res: Response) {
    try {
      const event = (req as any).stripeEvent;

      if (!event) {
        return res.status(400).json({
          error: 'Missing Stripe event',
          message: 'Stripe event is required',
        });
      }

      console.log(`Processing webhook event: ${event.type} (${event.id})`);

      // Log the webhook event
      await TransactionLogger.logWebhookEvent({
        eventId: event.id,
        eventType: event.type,
        payload: event,
      });

      // Process the event based on type
      let result;
      switch (event.type) {
        case WEBHOOK_EVENTS.PAYMENT_INTENT_SUCCEEDED:
          result = await this.handlePaymentIntentSucceeded(event);
          break;
        case WEBHOOK_EVENTS.PAYMENT_INTENT_FAILED:
          result = await this.handlePaymentIntentFailed(event);
          break;
        case WEBHOOK_EVENTS.CHARGE_SUCCEEDED:
          result = await this.handleChargeSucceeded(event);
          break;
        case WEBHOOK_EVENTS.CHARGE_FAILED:
          result = await this.handleChargeFailed(event);
          break;
        case WEBHOOK_EVENTS.CHARGE_REFUNDED:
          result = await this.handleChargeRefunded(event);
          break;
        case WEBHOOK_EVENTS.TRANSFER_PAID:
          result = await this.handleTransferPaid(event);
          break;
        case WEBHOOK_EVENTS.TRANSFER_FAILED:
          result = await this.handleTransferFailed(event);
          break;
        case WEBHOOK_EVENTS.ACCOUNT_UPDATED:
          result = await this.handleAccountUpdated(event);
          break;
        default:
          console.log(`Unhandled webhook event type: ${event.type}`);
          result = { success: true, message: 'Event type not handled' };
      }

      // Mark webhook event as processed
      await TransactionLogger.markWebhookEventProcessed(event.id);

      res.json({
        success: true,
        message: 'Webhook processed successfully',
        eventId: event.id,
        eventType: event.type,
        result,
      });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to process webhook',
      });
    }
  }

  /**
   * Handle payment_intent.succeeded event
   */
  private static async handlePaymentIntentSucceeded(event: any) {
    try {
      const paymentIntent = event.data.object;
      const transactionId = parseInt(paymentIntent.metadata?.transactionId);

      if (!transactionId) {
        console.log('No transaction ID found in PaymentIntent metadata');
        return { success: true, message: 'No transaction ID found' };
      }

      // Get transaction
      const transaction = await prisma.stripeTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        console.log(`Transaction ${transactionId} not found`);
        return { success: false, error: 'Transaction not found' };
      }

      // Update transaction status
      await prisma.stripeTransaction.update({
        where: { id: transactionId },
        data: {
          status: TRANSACTION_STATUS.CHARGED,
          stripeChargeId: paymentIntent.latest_charge,
        },
      });

      // Log the success
      await TransactionLogger.logTransaction({
        action: 'payment_intent_succeeded',
        transactionId,
        userId: transaction.userId,
        status: 'success',
        stripeEventId: event.id,
        metadata: {
          paymentIntentId: paymentIntent.id,
          chargeId: paymentIntent.latest_charge,
          amount: paymentIntent.amount,
        },
      });

      // If seller has a Connect account, create transfer
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId: transaction.userId },
      });

      if (stripeAccount && stripeAccount.payoutsEnabled) {
        // Add transfer job to queue
        await PayoutJobQueue.addTransferJob({
          transactionId,
          userId: transaction.userId,
          amountCents: transaction.sellerPayoutCents,
          currency: transaction.currency,
          destinationAccountId: stripeAccount.stripeAccountId,
        });
      }

      return { success: true, message: 'Payment succeeded and transfer queued' };
    } catch (error) {
      console.error('Error handling payment_intent.succeeded:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle payment_intent.payment_failed event
   */
  private static async handlePaymentIntentFailed(event: any) {
    try {
      const paymentIntent = event.data.object;
      const transactionId = parseInt(paymentIntent.metadata?.transactionId);

      if (!transactionId) {
        return { success: true, message: 'No transaction ID found' };
      }

      // Update transaction status
      await prisma.stripeTransaction.update({
        where: { id: transactionId },
        data: { status: TRANSACTION_STATUS.FAILED },
      });

      // Log the failure
      await TransactionLogger.logTransaction({
        action: 'payment_intent_failed',
        transactionId,
        userId: 0, // Will be updated when we get the transaction
        status: 'failed',
        stripeEventId: event.id,
        metadata: {
          paymentIntentId: paymentIntent.id,
          failureReason: paymentIntent.last_payment_error?.message,
        },
      });

      return { success: true, message: 'Payment failed recorded' };
    } catch (error) {
      console.error('Error handling payment_intent.payment_failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle charge.succeeded event
   */
  private static async handleChargeSucceeded(event: any) {
    try {
      const charge = event.data.object;
      
      // Find transaction by charge ID
      const transaction = await prisma.stripeTransaction.findFirst({
        where: { stripeChargeId: charge.id },
      });

      if (!transaction) {
        return { success: true, message: 'No transaction found for charge' };
      }

      // Update transaction status if not already charged
      if (transaction.status !== TRANSACTION_STATUS.CHARGED) {
        await prisma.stripeTransaction.update({
          where: { id: transaction.id },
          data: { status: TRANSACTION_STATUS.CHARGED },
        });
      }

      // Log the success
      await TransactionLogger.logTransaction({
        action: 'charge_succeeded',
        transactionId: transaction.id,
        userId: transaction.userId,
        status: 'success',
        stripeEventId: event.id,
        metadata: {
          chargeId: charge.id,
          amount: charge.amount,
        },
      });

      return { success: true, message: 'Charge succeeded recorded' };
    } catch (error) {
      console.error('Error handling charge.succeeded:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle charge.failed event
   */
  private static async handleChargeFailed(event: any) {
    try {
      const charge = event.data.object;
      
      // Find transaction by charge ID
      const transaction = await prisma.stripeTransaction.findFirst({
        where: { stripeChargeId: charge.id },
      });

      if (!transaction) {
        return { success: true, message: 'No transaction found for charge' };
      }

      // Update transaction status
      await prisma.stripeTransaction.update({
        where: { id: transaction.id },
        data: { status: TRANSACTION_STATUS.FAILED },
      });

      // Log the failure
      await TransactionLogger.logTransaction({
        action: 'charge_failed',
        transactionId: transaction.id,
        userId: transaction.userId,
        status: 'failed',
        stripeEventId: event.id,
        metadata: {
          chargeId: charge.id,
          failureReason: charge.failure_message,
        },
      });

      return { success: true, message: 'Charge failed recorded' };
    } catch (error) {
      console.error('Error handling charge.failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle charge.refunded event
   */
  private static async handleChargeRefunded(event: any) {
    try {
      const charge = event.data.object;
      
      // Find transaction by charge ID
      const transaction = await prisma.stripeTransaction.findFirst({
        where: { stripeChargeId: charge.id },
      });

      if (!transaction) {
        return { success: true, message: 'No transaction found for charge' };
      }

      // Update transaction status
      await prisma.stripeTransaction.update({
        where: { id: transaction.id },
        data: { status: TRANSACTION_STATUS.REFUNDED },
      });

      // Log the refund
      await TransactionLogger.logTransaction({
        action: 'charge_refunded',
        transactionId: transaction.id,
        userId: transaction.userId,
        status: 'success',
        stripeEventId: event.id,
        metadata: {
          chargeId: charge.id,
          refundAmount: charge.amount_refunded,
        },
      });

      return { success: true, message: 'Charge refunded recorded' };
    } catch (error) {
      console.error('Error handling charge.refunded:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle transfer.paid event
   */
  private static async handleTransferPaid(event: any) {
    try {
      const transfer = event.data.object;
      
      // Find transaction by transfer ID
      const transaction = await prisma.stripeTransaction.findFirst({
        where: { stripeTransferId: transfer.id },
      });

      if (!transaction) {
        return { success: true, message: 'No transaction found for transfer' };
      }

      // Update transaction status
      await prisma.stripeTransaction.update({
        where: { id: transaction.id },
        data: { status: TRANSACTION_STATUS.TRANSFERRED },
      });

      // Log the transfer success
      await TransactionLogger.logTransaction({
        action: 'transfer_paid',
        transactionId: transaction.id,
        userId: transaction.userId,
        status: 'success',
        stripeEventId: event.id,
        metadata: {
          transferId: transfer.id,
          amount: transfer.amount,
          destination: transfer.destination,
        },
      });

      return { success: true, message: 'Transfer paid recorded' };
    } catch (error) {
      console.error('Error handling transfer.paid:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle transfer.failed event
   */
  private static async handleTransferFailed(event: any) {
    try {
      const transfer = event.data.object;
      
      // Find transaction by transfer ID
      const transaction = await prisma.stripeTransaction.findFirst({
        where: { stripeTransferId: transfer.id },
      });

      if (!transaction) {
        return { success: true, message: 'No transaction found for transfer' };
      }

      // Update transaction status
      await prisma.stripeTransaction.update({
        where: { id: transaction.id },
        data: { status: TRANSACTION_STATUS.FAILED },
      });

      // Log the transfer failure
      await TransactionLogger.logTransaction({
        action: 'transfer_failed',
        transactionId: transaction.id,
        userId: transaction.userId,
        status: 'failed',
        stripeEventId: event.id,
        metadata: {
          transferId: transfer.id,
          failureReason: transfer.failure_message,
        },
      });

      return { success: true, message: 'Transfer failed recorded' };
    } catch (error) {
      console.error('Error handling transfer.failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle account.updated event
   */
  private static async handleAccountUpdated(event: any) {
    try {
      const account = event.data.object;
      
      // Find Stripe account by account ID
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { stripeAccountId: account.id },
      });

      if (!stripeAccount) {
        return { success: true, message: 'No local account found for Stripe account' };
      }

      // Update account status
      await prisma.stripeAccount.update({
        where: { id: stripeAccount.id },
        data: {
          status: account.status,
          chargesEnabled: account.charges_enabled || false,
          payoutsEnabled: account.payouts_enabled || false,
          detailsSubmitted: account.details_submitted || false,
        },
      });

      // Log the account update
      await TransactionLogger.logTransaction({
        action: 'account_updated',
        transactionId: 0, // Not applicable for account updates
        userId: stripeAccount.userId,
        status: 'success',
        stripeEventId: event.id,
        metadata: {
          accountId: account.id,
          status: account.status,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
        },
      });

      return { success: true, message: 'Account updated recorded' };
    } catch (error) {
      console.error('Error handling account.updated:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Simulate payout for testing
   */
  static async simulatePayout(req: Request, res: Response) {
    try {
      const { transactionId, eventType = 'payment_intent.succeeded' } = req.body;

      if (!transactionId) {
        return res.status(400).json({
          error: 'Missing transaction ID',
          message: 'Transaction ID is required',
        });
      }

      // Get transaction
      const transaction = await prisma.stripeTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        return res.status(404).json({
          error: 'Transaction not found',
          message: 'No transaction found with this ID',
        });
      }

      // Create simulated webhook event
      const simulatedEvent = {
        id: `evt_simulated_${Date.now()}`,
        type: eventType,
        data: {
          object: {
            id: transaction.stripePaymentIntentId || `pi_simulated_${Date.now()}`,
            metadata: {
              transactionId: transactionId.toString(),
            },
            amount: transaction.platformFeeCents,
            currency: transaction.currency,
            status: 'succeeded',
            latest_charge: `ch_simulated_${Date.now()}`,
          },
        },
      };

      // Process the simulated event
      const result = await this.handleWebhook({ body: simulatedEvent } as any, res);

      return res.json({
        success: true,
        message: 'Payout simulation completed',
        eventId: simulatedEvent.id,
        result,
      });
    } catch (error) {
      console.error('Error in simulatePayout:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to simulate payout',
      });
    }
  }
} 