import { PrismaClient } from '@prisma/client';
import { 
  CostDocAuditLog, 
  AuditEvent, 
  DocumentStatus,
  SyncCrossCheck 
} from '../types/costDocumentation';

const prisma = new PrismaClient();

export class AuditService {
  /**
   * Log an audit event for a cost documentation action
   */
  async logEvent(
    docId: string,
    event: AuditEvent,
    actor: string,
    prevHash?: string,
    newHash?: string,
    details?: Record<string, any>
  ): Promise<CostDocAuditLog> {
    return prisma.costDocAuditLog.create({
      data: {
        doc_id: docId,
        event,
        actor,
        prev_hash: prevHash,
        new_hash: newHash,
        details
      }
    });
  }

  /**
   * Log document creation
   */
  async logDocumentCreated(
    docId: string,
    actor: string,
    contentHash: string,
    details?: Record<string, any>
  ): Promise<CostDocAuditLog> {
    return this.logEvent(
      docId,
      AuditEvent.CREATED,
      actor,
      undefined,
      contentHash,
      details
    );
  }

  /**
   * Log document lock (immutability)
   */
  async logDocumentLocked(
    docId: string,
    actor: string,
    contentHash: string,
    details?: Record<string, any>
  ): Promise<CostDocAuditLog> {
    return this.logEvent(
      docId,
      AuditEvent.LOCKED,
      actor,
      undefined,
      contentHash,
      {
        ...details,
        locked_at: new Date().toISOString(),
        immutable: true
      }
    );
  }

  /**
   * Log document export
   */
  async logDocumentExported(
    docId: string,
    actor: string,
    exportBundleId: string,
    details?: Record<string, any>
  ): Promise<CostDocAuditLog> {
    return this.logEvent(
      docId,
      AuditEvent.EXPORTED,
      actor,
      undefined,
      undefined,
      {
        ...details,
        export_bundle_id: exportBundleId,
        exported_at: new Date().toISOString()
      }
    );
  }

  /**
   * Log document refresh (sync cross-check)
   */
  async logDocumentRefreshed(
    docId: string,
    actor: string,
    prevHash: string,
    newHash: string,
    details?: Record<string, any>
  ): Promise<CostDocAuditLog> {
    return this.logEvent(
      docId,
      AuditEvent.REFRESHED,
      actor,
      prevHash,
      newHash,
      {
        ...details,
        refresh_reason: 'sync_cross_check',
        refreshed_at: new Date().toISOString()
      }
    );
  }

  /**
   * Log sync warning
   */
  async logSyncWarning(
    docId: string,
    actor: string,
    warningDetails: Record<string, any>
  ): Promise<CostDocAuditLog> {
    return this.logEvent(
      docId,
      AuditEvent.SYNC_WARNING,
      actor,
      undefined,
      undefined,
      {
        ...warningDetails,
        warning_type: 'sync_mismatch',
        logged_at: new Date().toISOString()
      }
    );
  }

  /**
   * Get audit trail for a document
   */
  async getDocumentAuditTrail(
    docId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    logs: CostDocAuditLog[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.costDocAuditLog.findMany({
        where: { doc_id: docId },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit
      }),
      prisma.costDocAuditLog.count({
        where: { doc_id: docId }
      })
    ]);

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Get audit trail by event type
   */
  async getAuditTrailByEvent(
    event: AuditEvent,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    logs: CostDocAuditLog[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.costDocAuditLog.findMany({
        where: { event },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        include: {
          document: {
            select: {
              id: true,
              anomaly_id: true,
              seller_id: true,
              status: true
            }
          }
        }
      }),
      prisma.costDocAuditLog.count({
        where: { event }
      })
    ]);

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Get audit trail by actor
   */
  async getAuditTrailByActor(
    actor: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    logs: CostDocAuditLog[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.costDocAuditLog.findMany({
        where: { actor },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        include: {
          document: {
            select: {
              id: true,
              anomaly_id: true,
              seller_id: true,
              status: true
            }
          }
        }
      }),
      prisma.costDocAuditLog.count({
        where: { actor }
      })
    ]);

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Get audit trail within date range
   */
  async getAuditTrailByDateRange(
    startDate: Date,
    endDate: Date,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    logs: CostDocAuditLog[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.costDocAuditLog.findMany({
        where: {
          timestamp: {
            gte: startDate,
            lte: endDate
          }
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        include: {
          document: {
            select: {
              id: true,
              anomaly_id: true,
              seller_id: true,
              status: true
            }
          }
        }
      }),
      prisma.costDocAuditLog.count({
        where: {
          timestamp: {
            gte: startDate,
            lte: endDate
          }
        }
      })
    ]);

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Get document state transition history
   */
  async getDocumentStateTransitions(docId: string): Promise<{
    transitions: Array<{
      from: string | null;
      to: string;
      timestamp: string;
      actor: string;
      event: AuditEvent;
    }>;
  }> {
    const logs = await prisma.costDocAuditLog.findMany({
      where: { doc_id: docId },
      orderBy: { timestamp: 'asc' },
      select: {
        event: true,
        timestamp: true,
        actor: true,
        prev_hash: true,
        new_hash: true
      }
    });

    const transitions = logs.map((log, index) => {
      const prevLog = index > 0 ? logs[index - 1] : null;
      return {
        from: prevLog?.new_hash || null,
        to: log.new_hash || 'status_change',
        timestamp: log.timestamp,
        actor: log.actor,
        event: log.event
      };
    });

    return { transitions };
  }

  /**
   * Get audit summary statistics
   */
  async getAuditSummary(): Promise<{
    totalEvents: number;
    eventsByType: Record<AuditEvent, number>;
    eventsByActor: Record<string, number>;
    recentActivity: number; // Events in last 24 hours
  }> {
    const [totalEvents, eventsByType, eventsByActor, recentActivity] = await Promise.all([
      prisma.costDocAuditLog.count(),
      prisma.costDocAuditLog.groupBy({
        by: ['event'],
        _count: { event: true }
      }),
      prisma.costDocAuditLog.groupBy({
        by: ['actor'],
        _count: { actor: true }
      }),
      prisma.costDocAuditLog.count({
        where: {
          timestamp: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      })
    ]);

    const eventsByTypeMap = eventsByType.reduce((acc, item) => {
      acc[item.event as AuditEvent] = item._count.event;
      return acc;
    }, {} as Record<AuditEvent, number>);

    const eventsByActorMap = eventsByActor.reduce((acc, item) => {
      acc[item.actor] = item._count.actor;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalEvents,
      eventsByType: eventsByTypeMap,
      eventsByActor: eventsByActorMap,
      recentActivity
    };
  }

  /**
   * Clean up old audit logs (for data retention policies)
   */
  async cleanupOldAuditLogs(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    
    const result = await prisma.costDocAuditLog.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate
        }
      }
    });

    return result.count;
  }
}

export const auditService = new AuditService(); 