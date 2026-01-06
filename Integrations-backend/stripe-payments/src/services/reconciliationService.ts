import { prisma } from '@/prisma/client';
import { TransactionLogger } from './transactionLogger';
import { StripeService } from './stripeService';
import { TRANSACTION_STATUS } from '@/config/stripeConfig';

export interface ReconciliationRequest {
  transactionId: number;
  reason: string;
  metadata?: Record<string, any>;
}

export interface ReconciliationResult {
  success: boolean;
  data?: {
    transactionId: number;
    oldStatus: string;
    newStatus: string;
    actionsTaken: string[];
  };
  error?: string;
}

export interface ClawbackRequest {
  transactionId: number;
  reason: string;
  refundAmountCents?: number;
  metadata?: Record<string, any>;
}

export interface ClawbackResult {
  success: boolean;
  data?: {
    transactionId: number;
    refundId?: string;
    actionsTaken: string[];
  };
  error?: string;
}

/**
 * Reconciliation Service
 * Handles reconciliation of transactions and clawback scenarios
 */
export class ReconciliationService {
  /**
   * Reconcile a transaction with Stripe events
   */
  static async reconcileTransaction(request: ReconciliationRequest): Promise<ReconciliationResult> {
    try {
      const { transactionId, reason, metadata } = request;

      // Get the transaction
      const transaction = await prisma.stripeTransaction.findUnique({
        where: { id: transactionId },
        include: {
          webhookEvents: true,
          auditTrail: true,
        },
      });

      if (!transaction) {
        return {
          success: false,
          error: 'Transaction not found',
        };
      }

      const actionsTaken: string[] = [];
      let newStatus = transaction.status;

      // Check for payment intent status
      if (transaction.stripePaymentIntentId) {
        try {
          const paymentIntent = await StripeService.getPaymentIntent(transaction.stripePaymentIntentId);
          
          if (paymentIntent.status === 'succeeded' && transaction.status !== TRANSACTION_STATUS.CHARGED) {
            newStatus = TRANSACTION_STATUS.CHARGED;
            actionsTaken.push('Updated status to charged based on PaymentIntent');
          } else if (paymentIntent.status === 'canceled' && transaction.status !== TRANSACTION_STATUS.CANCELLED) {
            newStatus = TRANSACTION_STATUS.CANCELLED;
            actionsTaken.push('Updated status to cancelled based on PaymentIntent');
          } else if (paymentIntent.status === 'requires_payment_method' && transaction.status !== TRANSACTION_STATUS.PENDING) {
            newStatus = TRANSACTION_STATUS.PENDING;
            actionsTaken.push('Updated status to pending based on PaymentIntent');
          }
        } catch (error) {
          console.error('Error checking PaymentIntent status:', error);
        }
      }

      // Check for transfer status
      if (transaction.stripeTransferId) {
        try {
          const transfer = await prisma.stripeWebhookEvent.findFirst({
            where: {
              eventType: { in: ['transfer.paid', 'transfer.failed'] },
              payload: {
                path: ['data', 'object', 'id'],
                equals: transaction.stripeTransferId,
              },
            },
          });

          if (transfer) {
            if (transfer.eventType === 'transfer.paid' && transaction.status !== TRANSACTION_STATUS.TRANSFERRED) {
              newStatus = TRANSACTION_STATUS.TRANSFERRED;
              actionsTaken.push('Updated status to transferred based on webhook event');
            } else if (transfer.eventType === 'transfer.failed' && transaction.status !== TRANSACTION_STATUS.FAILED) {
              newStatus = TRANSACTION_STATUS.FAILED;
              actionsTaken.push('Updated status to failed based on webhook event');
            }
          }
        } catch (error) {
          console.error('Error checking transfer status:', error);
        }
      }

      // Update transaction if status changed
      if (newStatus !== transaction.status) {
        await prisma.stripeTransaction.update({
          where: { id: transactionId },
          data: { status: newStatus },
        });

        // Log the reconciliation
        await TransactionLogger.logTransaction({
          action: 'transaction_reconciled',
          transactionId,
          userId: transaction.userId,
          status: 'success',
          metadata: {
            reason,
            oldStatus: transaction.status,
            newStatus,
            actionsTaken,
            ...metadata,
          },
        });
      }

      return {
        success: true,
        data: {
          transactionId,
          oldStatus: transaction.status,
          newStatus,
          actionsTaken,
        },
      };
    } catch (error) {
      console.error('Error reconciling transaction:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reconcile transaction',
      };
    }
  }

  /**
   * Handle clawback scenario (Amazon refund reversal)
   */
  static async handleClawback(request: ClawbackRequest): Promise<ClawbackResult> {
    try {
      const { transactionId, reason, refundAmountCents, metadata } = request;

      // Get the transaction
      const transaction = await prisma.stripeTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        return {
          success: false,
          error: 'Transaction not found',
        };
      }

      const actionsTaken: string[] = [];

      // Mark transaction for reversal
      await prisma.stripeTransaction.update({
        where: { id: transactionId },
        data: { status: TRANSACTION_STATUS.REVERSAL_NEEDED },
      });

      actionsTaken.push('Marked transaction for reversal');

      // If we have a PaymentIntent, attempt to refund
      if (transaction.stripePaymentIntentId) {
        try {
          const refundAmount = refundAmountCents || transaction.platformFeeCents;
          const refund = await StripeService.refundPaymentIntent(transaction.stripePaymentIntentId, refundAmount);
          
          actionsTaken.push(`Created refund: ${refund.id}`);

          // Log the refund
          await TransactionLogger.logTransaction({
            action: 'clawback_refund_created',
            transactionId,
            userId: transaction.userId,
            status: 'success',
            stripeEventId: refund.id,
            metadata: {
              reason,
              refundAmount,
              refundId: refund.id,
              ...metadata,
            },
          });
        } catch (error) {
          console.error('Error creating refund for clawback:', error);
          actionsTaken.push('Failed to create refund - manual intervention required');
        }
      }

      // Log the clawback
      await TransactionLogger.logTransaction({
        action: 'clawback_initiated',
        transactionId,
        userId: transaction.userId,
        status: 'success',
        metadata: {
          reason,
          refundAmountCents,
          actionsTaken,
          ...metadata,
        },
      });

      return {
        success: true,
        data: {
          transactionId,
          actionsTaken,
        },
      };
    } catch (error) {
      console.error('Error handling clawback:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to handle clawback',
      };
    }
  }

  /**
   * Find transactions that need reconciliation
   */
  static async findTransactionsNeedingReconciliation(): Promise<any[]> {
    try {
      // Find transactions that are pending but have associated webhook events
      const transactions = await prisma.stripeTransaction.findMany({
        where: {
          status: TRANSACTION_STATUS.PENDING,
          OR: [
            { stripePaymentIntentId: { not: null } },
            { stripeTransferId: { not: null } },
          ],
        },
        include: {
          webhookEvents: {
            where: {
              eventType: {
                in: ['payment_intent.succeeded', 'payment_intent.payment_failed', 'transfer.paid', 'transfer.failed'],
              },
            },
          },
        },
      });

      return transactions.filter(t => t.webhookEvents.length > 0);
    } catch (error) {
      console.error('Error finding transactions needing reconciliation:', error);
      return [];
    }
  }

  /**
   * Get reconciliation summary
   */
  static async getReconciliationSummary(): Promise<any> {
    try {
      const summary = {
        totalTransactions: 0,
        pendingTransactions: 0,
        chargedTransactions: 0,
        failedTransactions: 0,
        transferredTransactions: 0,
        reversalNeededTransactions: 0,
        unprocessedWebhookEvents: 0,
      };

      // Get transaction counts by status
      const statusCounts = await prisma.stripeTransaction.groupBy({
        by: ['status'],
        _count: { id: true },
      });

      statusCounts.forEach(count => {
        summary.totalTransactions += count._count.id;
        switch (count.status) {
          case TRANSACTION_STATUS.PENDING:
            summary.pendingTransactions = count._count.id;
            break;
          case TRANSACTION_STATUS.CHARGED:
            summary.chargedTransactions = count._count.id;
            break;
          case TRANSACTION_STATUS.FAILED:
            summary.failedTransactions = count._count.id;
            break;
          case TRANSACTION_STATUS.TRANSFERRED:
            summary.transferredTransactions = count._count.id;
            break;
          case TRANSACTION_STATUS.REVERSAL_NEEDED:
            summary.reversalNeededTransactions = count._count.id;
            break;
        }
      });

      // Get unprocessed webhook events count
      const unprocessedCount = await prisma.stripeWebhookEvent.count({
        where: { processed: false },
      });
      summary.unprocessedWebhookEvents = unprocessedCount;

      return summary;
    } catch (error) {
      console.error('Error getting reconciliation summary:', error);
      return {
        totalTransactions: 0,
        pendingTransactions: 0,
        chargedTransactions: 0,
        failedTransactions: 0,
        transferredTransactions: 0,
        reversalNeededTransactions: 0,
        unprocessedWebhookEvents: 0,
      };
    }
  }

  /**
   * Process all pending reconciliations
   */
  static async processAllPendingReconciliations(): Promise<{ processed: number; errors: number }> {
    try {
      const transactions = await this.findTransactionsNeedingReconciliation();
      let processed = 0;
      let errors = 0;

      for (const transaction of transactions) {
        const result = await this.reconcileTransaction({
          transactionId: transaction.id,
          reason: 'Automatic reconciliation',
        });

        if (result.success) {
          processed++;
        } else {
          errors++;
        }
      }

      return { processed, errors };
    } catch (error) {
      console.error('Error processing pending reconciliations:', error);
      return { processed: 0, errors: 1 };
    }
  }
} 