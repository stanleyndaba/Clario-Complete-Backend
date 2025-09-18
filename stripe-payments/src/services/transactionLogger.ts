import { prisma } from '@/prisma/client';

export interface LogTransactionRequest {
  action: string;
  transactionId: number;
  userId: number;
  status: 'success' | 'failed' | 'pending';
  stripeEventId?: string;
  metadata?: Record<string, any>;
}

export interface LogWebhookEventRequest {
  eventId: string;
  eventType: string;
  payload: any;
  transactionId?: number;
}

/**
 * Transaction Logger Service
 * Handles logging of all transaction-related events for audit trails
 */
export class TransactionLogger {
  /**
   * Log a transaction event
   */
  static async logTransaction(request: LogTransactionRequest): Promise<void> {
    try {
      await prisma.transactionAudit.create({
        data: {
          transactionId: request.transactionId,
          action: request.action,
          status: request.status,
          stripeEventId: request.stripeEventId,
          metadata: request.metadata || {},
        },
      });
    } catch (error) {
      console.error('Error logging transaction:', error);
      // Don't throw - logging should not break the main flow
    }
  }

  /**
   * Log a webhook event
   */
  static async logWebhookEvent(request: LogWebhookEventRequest): Promise<void> {
    try {
      await prisma.stripeWebhookEvent.create({
        data: {
          eventId: request.eventId,
          eventType: request.eventType,
          payload: request.payload,
          transactionId: request.transactionId,
        },
      });
    } catch (error) {
      console.error('Error logging webhook event:', error);
      // Don't throw - logging should not break the main flow
    }
  }

  /**
   * Mark webhook event as processed
   */
  static async markWebhookEventProcessed(eventId: string): Promise<void> {
    try {
      await prisma.stripeWebhookEvent.update({
        where: { eventId },
        data: {
          processed: true,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      console.error('Error marking webhook event as processed:', error);
    }
  }

  /**
   * Get transaction audit trail
   */
  static async getTransactionAuditTrail(transactionId: number): Promise<any[]> {
    try {
      return await prisma.transactionAudit.findMany({
        where: { transactionId },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      console.error('Error getting transaction audit trail:', error);
      return [];
    }
  }

  /**
   * Get unprocessed webhook events
   */
  static async getUnprocessedWebhookEvents(): Promise<any[]> {
    try {
      return await prisma.stripeWebhookEvent.findMany({
        where: { processed: false },
        orderBy: { receivedAt: 'asc' },
      });
    } catch (error) {
      console.error('Error getting unprocessed webhook events:', error);
      return [];
    }
  }

  /**
   * Get webhook events by type
   */
  static async getWebhookEventsByType(eventType: string, limit: number = 100): Promise<any[]> {
    try {
      return await prisma.stripeWebhookEvent.findMany({
        where: { eventType },
        orderBy: { receivedAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      console.error('Error getting webhook events by type:', error);
      return [];
    }
  }

  /**
   * Get audit summary for a user
   */
  static async getUserAuditSummary(userId: number, days: number = 30): Promise<any> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const auditEvents = await prisma.transactionAudit.findMany({
        where: {
          transaction: {
            userId,
          },
          createdAt: {
            gte: startDate,
          },
        },
        include: {
          transaction: {
            select: {
              id: true,
              amountRecoveredCents: true,
              platformFeeCents: true,
              currency: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const summary = {
        totalEvents: auditEvents.length,
        successfulEvents: auditEvents.filter(e => e.status === 'success').length,
        failedEvents: auditEvents.filter(e => e.status === 'failed').length,
        pendingEvents: auditEvents.filter(e => e.status === 'pending').length,
        totalAmount: 0,
        totalFees: 0,
        currencyBreakdown: {} as Record<string, number>,
      };

      auditEvents.forEach(event => {
        if (event.transaction) {
          summary.totalAmount += event.transaction.amountRecoveredCents;
          summary.totalFees += event.transaction.platformFeeCents;
          
          const currency = event.transaction.currency;
          if (!summary.currencyBreakdown[currency]) {
            summary.currencyBreakdown[currency] = 0;
          }
          summary.currencyBreakdown[currency] += event.transaction.amountRecoveredCents;
        }
      });

      return summary;
    } catch (error) {
      console.error('Error getting user audit summary:', error);
      return {
        totalEvents: 0,
        successfulEvents: 0,
        failedEvents: 0,
        pendingEvents: 0,
        totalAmount: 0,
        totalFees: 0,
        currencyBreakdown: {},
      };
    }
  }

  /**
   * Clean up old audit logs (older than specified days)
   */
  static async cleanupOldAuditLogs(daysToKeep: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await prisma.transactionAudit.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      return result.count;
    } catch (error) {
      console.error('Error cleaning up old audit logs:', error);
      return 0;
    }
  }

  /**
   * Clean up old webhook events (older than specified days)
   */
  static async cleanupOldWebhookEvents(daysToKeep: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await prisma.stripeWebhookEvent.deleteMany({
        where: {
          receivedAt: {
            lt: cutoffDate,
          },
          processed: true,
        },
      });

      return result.count;
    } catch (error) {
      console.error('Error cleaning up old webhook events:', error);
      return 0;
    }
  }
} 