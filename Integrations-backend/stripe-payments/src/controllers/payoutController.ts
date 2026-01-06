import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '@/prisma/client';
import { ReconciliationService } from '@/services/reconciliationService';
import { TransactionLogger } from '@/services/transactionLogger';
import { PayoutJobQueue } from '@/jobs/payoutJob';
import { getIdempotencyStats } from '@/utils/idempotency';

/**
 * Payout Controller
 * Handles reconciliation and admin operations
 */
export class PayoutController {
  /**
   * Reconcile a transaction
   */
  static async reconcileTransaction(req: Request, res: Response) {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
        });
      }

      const { transactionId, reason } = req.body;

      const result = await ReconciliationService.reconcileTransaction({
        transactionId,
        reason,
      });

      if (!result.success) {
        return res.status(400).json({
          error: 'Reconciliation failed',
          message: result.error || 'Failed to reconcile transaction',
        });
      }

      res.json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in reconcileTransaction:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to reconcile transaction',
      });
    }
  }

  /**
   * Handle clawback scenario
   */
  static async handleClawback(req: Request, res: Response) {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
        });
      }

      const { transactionId, reason, refundAmountCents } = req.body;

      const result = await ReconciliationService.handleClawback({
        transactionId,
        reason,
        refundAmountCents,
      });

      if (!result.success) {
        return res.status(400).json({
          error: 'Clawback failed',
          message: result.error || 'Failed to handle clawback',
        });
      }

      res.json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in handleClawback:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to handle clawback',
      });
    }
  }

  /**
   * Get reconciliation summary
   */
  static async getReconciliationSummary(req: Request, res: Response) {
    try {
      const summary = await ReconciliationService.getReconciliationSummary();

      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      console.error('Error in getReconciliationSummary:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to get reconciliation summary',
      });
    }
  }

  /**
   * Process all pending reconciliations
   */
  static async processAllPendingReconciliations(req: Request, res: Response) {
    try {
      const result = await ReconciliationService.processAllPendingReconciliations();

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error in processAllPendingReconciliations:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to process pending reconciliations',
      });
    }
  }

  /**
   * Get queue statistics
   */
  static async getQueueStats(req: Request, res: Response) {
    try {
      const stats = await PayoutJobQueue.getQueueStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error('Error in getQueueStats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to get queue statistics',
      });
    }
  }

  /**
   * Get audit trail for a transaction
   */
  static async getTransactionAuditTrail(req: Request, res: Response) {
    try {
      const transactionId = parseInt(req.params.transactionId);

      if (!transactionId) {
        return res.status(400).json({
          error: 'Invalid transaction ID',
          message: 'Transaction ID is required',
        });
      }

      const auditTrail = await TransactionLogger.getTransactionAuditTrail(transactionId);

      res.json({
        success: true,
        data: auditTrail,
      });
    } catch (error) {
      console.error('Error in getTransactionAuditTrail:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to get audit trail',
      });
    }
  }

  /**
   * Get user audit summary
   */
  static async getUserAuditSummary(req: Request, res: Response) {
    try {
      const userId = parseInt(req.params.userId);
      const days = parseInt(req.query.days as string) || 30;

      if (!userId) {
        return res.status(400).json({
          error: 'Invalid user ID',
          message: 'User ID is required',
        });
      }

      const summary = await TransactionLogger.getUserAuditSummary(userId, days);

      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      console.error('Error in getUserAuditSummary:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to get user audit summary',
      });
    }
  }

  /**
   * Get unprocessed webhook events
   */
  static async getUnprocessedWebhookEvents(req: Request, res: Response) {
    try {
      const events = await TransactionLogger.getUnprocessedWebhookEvents();

      res.json({
        success: true,
        data: events,
      });
    } catch (error) {
      console.error('Error in getUnprocessedWebhookEvents:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to get unprocessed webhook events',
      });
    }
  }

  /**
   * Retry failed transaction
   */
  static async retryFailedTransaction(req: Request, res: Response) {
    try {
      const { transactionId } = req.body;

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

      if (transaction.status !== 'failed') {
        return res.status(400).json({
          error: 'Invalid transaction status',
          message: 'Only failed transactions can be retried',
        });
      }

      // Reset transaction status
      await prisma.stripeTransaction.update({
        where: { id: transactionId },
        data: { status: 'pending' },
      });

      // Add payment job to queue
      await PayoutJobQueue.addPaymentJob({
        transactionId,
        userId: transaction.userId,
        claimId: transaction.claimId || undefined,
        amountRecoveredCents: transaction.amountRecoveredCents,
        currency: transaction.currency,
        paymentMethodId: transaction.stripePaymentMethodId || undefined,
        customerId: transaction.stripeCustomerId || undefined,
      });

      // Log the retry
      await TransactionLogger.logTransaction({
        action: 'transaction_retry_initiated',
        transactionId,
        userId: transaction.userId,
        status: 'success',
        metadata: {
          reason: 'Manual retry',
        },
      });

      res.json({
        success: true,
        message: 'Transaction retry initiated',
        data: {
          transactionId,
          status: 'pending',
        },
      });
    } catch (error) {
      console.error('Error in retryFailedTransaction:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to retry transaction',
      });
    }
  }

  /**
   * Clean up old data
   */
  static async cleanupOldData(req: Request, res: Response) {
    try {
      const { daysToKeep = 90 } = req.body;

      const auditLogsCleaned = await TransactionLogger.cleanupOldAuditLogs(daysToKeep);
      const webhookEventsCleaned = await TransactionLogger.cleanupOldWebhookEvents(30);

      res.json({
        success: true,
        data: {
          auditLogsCleaned,
          webhookEventsCleaned,
          message: 'Cleanup completed successfully',
        },
      });
    } catch (error) {
      console.error('Error in cleanupOldData:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to cleanup old data',
      });
    }
  }

  /**
   * Get idempotency key statistics
   */
  static async getIdempotencyStats(req: Request, res: Response) {
    try {
      const stats = await getIdempotencyStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error('Error in getIdempotencyStats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to get idempotency stats',
      });
    }
  }
}

// Validation schemas
export const reconcileTransactionValidation = [
  body('transactionId').isInt().withMessage('Transaction ID must be an integer'),
  body('reason').isString().isLength({ min: 1 }).withMessage('Reason is required'),
];

export const handleClawbackValidation = [
  body('transactionId').isInt().withMessage('Transaction ID must be an integer'),
  body('reason').isString().isLength({ min: 1 }).withMessage('Reason is required'),
  body('refundAmountCents').optional().isInt({ min: 0 }).withMessage('Refund amount must be a positive integer'),
];

export const retryFailedTransactionValidation = [
  body('transactionId').isInt().withMessage('Transaction ID must be an integer'),
];

export const cleanupOldDataValidation = [
  body('daysToKeep').optional().isInt({ min: 1, max: 365 }).withMessage('Days to keep must be between 1 and 365'),
]; 