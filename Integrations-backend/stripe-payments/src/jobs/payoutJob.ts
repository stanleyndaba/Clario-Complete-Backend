import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '@/prisma/client';
import { StripeService } from '@/services/stripeService';
import { TransactionLogger } from '@/services/transactionLogger';
import { ReconciliationService } from '@/services/reconciliationService';
import { TRANSACTION_STATUS } from '@/config/stripeConfig';
import config from '@/config/env';
import { cleanupExpiredIdempotencyKeys } from '@/utils/idempotency';

// Redis connection
const redis = new Redis(config.REDIS_URL);

// Queue names
export const QUEUE_NAMES = {
  PAYOUT: 'payout',
  RECONCILIATION: 'reconciliation',
  CLEANUP: 'cleanup',
} as const;

// Job types
export const JOB_TYPES = {
  PROCESS_PAYMENT: 'process_payment',
  PROCESS_TRANSFER: 'process_transfer',
  RECONCILE_TRANSACTION: 'reconcile_transaction',
  CLEANUP_OLD_DATA: 'cleanup_old_data',
} as const;

export interface ProcessPaymentJobData {
  transactionId: number;
  userId: number;
  claimId?: number;
  amountRecoveredCents: number;
  currency: string;
  paymentMethodId?: string;
  customerId?: string;
  retryCount?: number;
}

export interface ProcessTransferJobData {
  transactionId: number;
  userId: number;
  amountCents: number;
  currency: string;
  destinationAccountId: string;
  retryCount?: number;
}

export interface ReconciliationJobData {
  transactionId: number;
  reason: string;
  retryCount?: number;
}

/**
 * Payout Job Queue
 * Handles background processing of payments and transfers
 */
export class PayoutJobQueue {
  private static payoutQueue: Queue;
  private static reconciliationQueue: Queue;
  private static cleanupQueue: Queue;

  /**
   * Initialize queues
   */
  static initialize() {
    this.payoutQueue = new Queue(QUEUE_NAMES.PAYOUT, { connection: redis });
    this.reconciliationQueue = new Queue(QUEUE_NAMES.RECONCILIATION, { connection: redis });
    this.cleanupQueue = new Queue(QUEUE_NAMES.CLEANUP, { connection: redis });

    // Start workers
    this.startWorkers();
  }

  /**
   * Start background workers
   */
  private static startWorkers() {
    // Payout worker
    const payoutWorker = new Worker(
      QUEUE_NAMES.PAYOUT,
      async (job: Job) => {
        const { type, data } = job.data;

        switch (type) {
          case JOB_TYPES.PROCESS_PAYMENT:
            return await this.processPayment(data as ProcessPaymentJobData);
          case JOB_TYPES.PROCESS_TRANSFER:
            return await this.processTransfer(data as ProcessTransferJobData);
          default:
            throw new Error(`Unknown job type: ${type}`);
        }
      },
      {
        connection: redis,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      }
    );

    // Reconciliation worker
    const reconciliationWorker = new Worker(
      QUEUE_NAMES.RECONCILIATION,
      async (job: Job) => {
        const { type, data } = job.data;

        switch (type) {
          case JOB_TYPES.RECONCILE_TRANSACTION:
            return await this.reconcileTransaction(data as ReconciliationJobData);
          default:
            throw new Error(`Unknown job type: ${type}`);
        }
      },
      {
        connection: redis,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      }
    );

    // Cleanup worker
    const cleanupWorker = new Worker(
      QUEUE_NAMES.CLEANUP,
      async (job: Job) => {
        const { type } = job.data;

        switch (type) {
          case JOB_TYPES.CLEANUP_OLD_DATA:
            return await this.cleanupOldData();
          default:
            throw new Error(`Unknown job type: ${type}`);
        }
      },
      {
        connection: redis,
        removeOnComplete: { age: 3600 },
        removeOnFail: { count: 50 },
      }
    );

    // Error handling
    payoutWorker.on('error', (error) => {
      console.error('Payout worker error:', error);
    });

    reconciliationWorker.on('error', (error) => {
      console.error('Reconciliation worker error:', error);
    });

    cleanupWorker.on('error', (error) => {
      console.error('Cleanup worker error:', error);
    });

    // Failed job handling
    payoutWorker.on('failed', async (job, error) => {
      if (!job) {
        console.error('Payout job failed but no job reference was provided:', error);
        return;
      }

      console.error(`Job ${job.id} failed:`, error);
      
      const retryCount = job.data.data?.retryCount || 0;
      if (retryCount < 3) {
        // Retry with exponential backoff
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        await this.payoutQueue.add(
          job.name,
          {
            ...job.data,
            data: { ...job.data.data, retryCount: retryCount + 1 },
          },
          { delay }
        );
      } else {
        // Log final failure
        await TransactionLogger.logTransaction({
          action: 'job_failed_permanently',
          transactionId: job.data.data?.transactionId || 0,
          userId: job.data.data?.userId || 0,
          status: 'failed',
          metadata: {
            jobType: job.data.type,
            error: error.message,
            retryCount,
          },
        });
      }
    });
  }

  /**
   * Process payment job
   */
  private static async processPayment(data: ProcessPaymentJobData) {
    const { transactionId, userId, claimId, amountRecoveredCents, currency, paymentMethodId, customerId, retryCount = 0 } = data;

    try {
      // Get transaction
      const transaction = await prisma.stripeTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      // Check if already processed
      if (transaction.status !== TRANSACTION_STATUS.PENDING) {
        return { success: true, message: 'Transaction already processed' };
      }

      // Create PaymentIntent
      const paymentIntentResult = await StripeService.createPaymentIntent({
        userId,
        claimId,
        amountRecoveredCents,
        currency: currency as any,
        paymentMethodId,
        customerId,
        metadata: {
          transactionId: transactionId.toString(),
          retryCount: retryCount.toString(),
          idempotencyKey: `pi:${transactionId}`,
        },
      });

      if (!paymentIntentResult.success) {
        throw new Error(paymentIntentResult.error || 'Failed to create PaymentIntent');
      }

      // Update transaction with PaymentIntent ID
      await prisma.stripeTransaction.update({
        where: { id: transactionId },
        data: {
          stripePaymentIntentId: paymentIntentResult.data!.paymentIntentId,
          stripeCustomerId: customerId,
          stripePaymentMethodId: paymentMethodId,
        },
      });

      // Log the job completion
      await TransactionLogger.logTransaction({
        action: 'payment_job_completed',
        transactionId,
        userId,
        status: 'success',
        metadata: {
          paymentIntentId: paymentIntentResult.data!.paymentIntentId,
          retryCount,
        },
      });

      return {
        success: true,
        paymentIntentId: paymentIntentResult.data!.paymentIntentId,
      };
    } catch (error) {
      console.error('Error processing payment job:', error);
      
      // Log the failure
      await TransactionLogger.logTransaction({
        action: 'payment_job_failed',
        transactionId,
        userId,
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          retryCount,
        },
      });

      throw error;
    }
  }

  /**
   * Process transfer job
   */
  private static async processTransfer(data: ProcessTransferJobData) {
    const { transactionId, userId, amountCents, currency, destinationAccountId, retryCount = 0 } = data;

    try {
      // Get transaction
      const transaction = await prisma.stripeTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      // Check if already transferred
      if (transaction.status === TRANSACTION_STATUS.TRANSFERRED) {
        return { success: true, message: 'Transfer already completed' };
      }

      // Create transfer
      const transferResult = await StripeService.createTransfer({
        userId,
        transactionId,
        amountCents,
        currency: currency as any,
        destinationAccountId,
        metadata: {
          retryCount: retryCount.toString(),
          idempotencyKey: `tr:${transactionId}`,
        },
      });

      if (!transferResult.success) {
        throw new Error(transferResult.error || 'Failed to create transfer');
      }

      // Update transaction with transfer ID
      await prisma.stripeTransaction.update({
        where: { id: transactionId },
        data: {
          stripeTransferId: transferResult.data!.transferId,
        },
      });

      // Log the job completion
      await TransactionLogger.logTransaction({
        action: 'transfer_job_completed',
        transactionId,
        userId,
        status: 'success',
        metadata: {
          transferId: transferResult.data!.transferId,
          retryCount,
        },
      });

      return {
        success: true,
        transferId: transferResult.data!.transferId,
      };
    } catch (error) {
      console.error('Error processing transfer job:', error);
      
      // Log the failure
      await TransactionLogger.logTransaction({
        action: 'transfer_job_failed',
        transactionId,
        userId,
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          retryCount,
        },
      });

      throw error;
    }
  }

  /**
   * Reconcile transaction job
   */
  private static async reconcileTransaction(data: ReconciliationJobData) {
    const { transactionId, reason, retryCount = 0 } = data;

    try {
      const result = await ReconciliationService.reconcileTransaction({
        transactionId,
        reason,
        metadata: { retryCount },
      });

      if (!result.success) {
        throw new Error(result.error || 'Reconciliation failed');
      }

      return result.data;
    } catch (error) {
      console.error('Error reconciling transaction:', error);
      throw error;
    }
  }

  /**
   * Cleanup old data job
   */
  private static async cleanupOldData() {
    try {
      const auditLogsCleaned = await TransactionLogger.cleanupOldAuditLogs(90);
      const webhookEventsCleaned = await TransactionLogger.cleanupOldWebhookEvents(30);
      const idempotencyKeysCleaned = await this.cleanupExpiredIdempotencyKeys();

      return {
        auditLogsCleaned,
        webhookEventsCleaned,
        idempotencyKeysCleaned,
      };
    } catch (error) {
      console.error('Error cleaning up old data:', error);
      throw error;
    }
  }

  /**
   * Clean up expired idempotency keys
   */
  private static async cleanupExpiredIdempotencyKeys(): Promise<number> {
    try {
      return await cleanupExpiredIdempotencyKeys();
    } catch (error) {
      console.error('Error cleaning up expired idempotency keys:', error);
      return 0;
    }
  }

  /**
   * Add payment job to queue
   */
  static async addPaymentJob(data: ProcessPaymentJobData, delay?: number) {
    return await this.payoutQueue.add(
      JOB_TYPES.PROCESS_PAYMENT,
      { type: JOB_TYPES.PROCESS_PAYMENT, data },
      { delay }
    );
  }

  /**
   * Add transfer job to queue
   */
  static async addTransferJob(data: ProcessTransferJobData, delay?: number) {
    return await this.payoutQueue.add(
      JOB_TYPES.PROCESS_TRANSFER,
      { type: JOB_TYPES.PROCESS_TRANSFER, data },
      { delay }
    );
  }

  /**
   * Add reconciliation job to queue
   */
  static async addReconciliationJob(data: ReconciliationJobData, delay?: number) {
    return await this.reconciliationQueue.add(
      JOB_TYPES.RECONCILE_TRANSACTION,
      { type: JOB_TYPES.RECONCILE_TRANSACTION, data },
      { delay }
    );
  }

  /**
   * Add cleanup job to queue
   */
  static async addCleanupJob(delay?: number) {
    return await this.cleanupQueue.add(
      JOB_TYPES.CLEANUP_OLD_DATA,
      { type: JOB_TYPES.CLEANUP_OLD_DATA },
      { delay }
    );
  }

  /**
   * Get queue statistics
   */
  static async getQueueStats() {
    const payoutStats = await this.payoutQueue.getJobCounts();
    const reconciliationStats = await this.reconciliationQueue.getJobCounts();
    const cleanupStats = await this.cleanupQueue.getJobCounts();

    return {
      payout: payoutStats,
      reconciliation: reconciliationStats,
      cleanup: cleanupStats,
    };
  }

  /**
   * Close all queues
   */
  static async close() {
    await this.payoutQueue.close();
    await this.reconciliationQueue.close();
    await this.cleanupQueue.close();
    await redis.quit();
  }
} 