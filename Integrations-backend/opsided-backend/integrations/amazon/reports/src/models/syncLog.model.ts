import { getDatabase } from '@/shared/db/connection';
import { getLogger } from '@/shared/utils/logger';
import { SyncStatus, SyncLog as SyncLogType } from '@/types';

const logger = getLogger('SyncLogModel');

export interface SyncLogData {
  id: string;
  userId: string;
  syncType: 'full' | 'incremental';
  status: SyncStatus;
  startTime: Date;
  endTime?: Date;
  totalReports: number;
  processedReports: number;
  failedReports: number;
  errorMessage?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export class SyncLogModel {
  private db = getDatabase();

  /**
   * Create a new sync log record
   */
  async create(data: Omit<SyncLogData, 'id' | 'createdAt' | 'updatedAt'>): Promise<SyncLogData> {
    try {
      const [syncLog] = await this.db('sync_logs')
        .insert({
          ...data,
          metadata: JSON.stringify(data.metadata),
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');

      logger.info(`Created sync log: ${syncLog.id}`, { userId: data.userId, syncType: data.syncType });

      return this.mapFromDb(syncLog);
    } catch (error) {
      logger.error('Failed to create sync log:', error);
      throw error;
    }
  }

  /**
   * Find a sync log by ID
   */
  async findById(id: string): Promise<SyncLogData | null> {
    try {
      const syncLog = await this.db('sync_logs')
        .where({ id })
        .first();

      return syncLog ? this.mapFromDb(syncLog) : null;
    } catch (error) {
      logger.error('Failed to find sync log by ID:', error);
      throw error;
    }
  }

  /**
   * Find sync logs by user ID
   */
  async findByUserId(userId: string, limit = 50, offset = 0): Promise<SyncLogData[]> {
    try {
      const syncLogs = await this.db('sync_logs')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return syncLogs.map(syncLog => this.mapFromDb(syncLog));
    } catch (error) {
      logger.error('Failed to find sync logs by user ID:', error);
      throw error;
    }
  }

  /**
   * Find active sync for a user
   */
  async findActiveSync(userId: string): Promise<SyncLogData | null> {
    try {
      const syncLog = await this.db('sync_logs')
        .where({ 
          user_id: userId,
          status: SyncStatus.RUNNING
        })
        .first();

      return syncLog ? this.mapFromDb(syncLog) : null;
    } catch (error) {
      logger.error('Failed to find active sync:', error);
      throw error;
    }
  }

  /**
   * Update sync status
   */
  async updateStatus(id: string, status: SyncStatus, metadata?: Record<string, any>): Promise<void> {
    try {
      const updateData: any = {
        status,
        updated_at: new Date()
      };

      if (status === SyncStatus.COMPLETED || status === SyncStatus.FAILED) {
        updateData.end_time = new Date();
      }

      if (metadata) {
        updateData.metadata = JSON.stringify(metadata);
      }

      await this.db('sync_logs')
        .where({ id })
        .update(updateData);

      logger.info(`Updated sync status: ${id} -> ${status}`);
    } catch (error) {
      logger.error('Failed to update sync status:', error);
      throw error;
    }
  }

  /**
   * Update sync progress
   */
  async updateProgress(
    id: string, 
    processedReports: number, 
    failedReports: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const updateData: any = {
        processed_reports: processedReports,
        failed_reports: failedReports,
        updated_at: new Date()
      };

      if (metadata) {
        updateData.metadata = JSON.stringify(metadata);
      }

      await this.db('sync_logs')
        .where({ id })
        .update(updateData);

      logger.info(`Updated sync progress: ${id}`, { processedReports, failedReports });
    } catch (error) {
      logger.error('Failed to update sync progress:', error);
      throw error;
    }
  }

  /**
   * Update sync error
   */
  async updateError(id: string, errorMessage: string): Promise<void> {
    try {
      await this.db('sync_logs')
        .where({ id })
        .update({
          error_message: errorMessage,
          status: SyncStatus.FAILED,
          end_time: new Date(),
          updated_at: new Date()
        });

      logger.error(`Updated sync error: ${id}`, { errorMessage });
    } catch (error) {
      logger.error('Failed to update sync error:', error);
      throw error;
    }
  }

  /**
   * Complete sync
   */
  async completeSync(id: string, processedReports: number, failedReports: number): Promise<void> {
    try {
      await this.db('sync_logs')
        .where({ id })
        .update({
          status: SyncStatus.COMPLETED,
          processed_reports: processedReports,
          failed_reports: failedReports,
          end_time: new Date(),
          updated_at: new Date()
        });

      logger.info(`Completed sync: ${id}`, { processedReports, failedReports });
    } catch (error) {
      logger.error('Failed to complete sync:', error);
      throw error;
    }
  }

  /**
   * Get sync statistics for a user
   */
  async getStats(userId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    running: number;
    averageDuration: number;
  }> {
    try {
      const stats = await this.db('sync_logs')
        .where({ user_id: userId })
        .select('status')
        .count('* as count')
        .groupBy('status');

      const durationStats = await this.db('sync_logs')
        .where({ user_id: userId })
        .whereNotNull('end_time')
        .select(
          this.db.raw('AVG(EXTRACT(EPOCH FROM (end_time - start_time))) as avg_duration')
        )
        .first();

      const result = {
        total: 0,
        completed: 0,
        failed: 0,
        running: 0,
        averageDuration: durationStats?.avg_duration || 0
      };

      stats.forEach(stat => {
        const count = parseInt(stat.count as string);
        result.total += count;
        
        switch (stat.status) {
          case SyncStatus.COMPLETED:
            result.completed = count;
            break;
          case SyncStatus.FAILED:
            result.failed = count;
            break;
          case SyncStatus.RUNNING:
            result.running = count;
            break;
        }
      });

      return result;
    } catch (error) {
      logger.error('Failed to get sync stats:', error);
      throw error;
    }
  }

  /**
   * Find recent syncs
   */
  async findRecentSyncs(limit = 20): Promise<SyncLogData[]> {
    try {
      const syncLogs = await this.db('sync_logs')
        .orderBy('created_at', 'desc')
        .limit(limit);

      return syncLogs.map(syncLog => this.mapFromDb(syncLog));
    } catch (error) {
      logger.error('Failed to find recent syncs:', error);
      throw error;
    }
  }

  /**
   * Clean up old sync logs
   */
  async cleanupOldSyncLogs(daysOld = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.db('sync_logs')
        .where('created_at', '<', cutoffDate)
        .whereIn('status', [SyncStatus.COMPLETED, SyncStatus.FAILED])
        .del();

      logger.info(`Cleaned up ${result} old sync logs`);
      return result;
    } catch (error) {
      logger.error('Failed to cleanup old sync logs:', error);
      throw error;
    }
  }

  /**
   * Map database record to SyncLogData interface
   */
  private mapFromDb(dbRecord: any): SyncLogData {
    return {
      id: dbRecord.id,
      userId: dbRecord.user_id,
      syncType: dbRecord.sync_type as 'full' | 'incremental',
      status: dbRecord.status as SyncStatus,
      startTime: new Date(dbRecord.start_time),
      endTime: dbRecord.end_time ? new Date(dbRecord.end_time) : undefined,
      totalReports: dbRecord.total_reports,
      processedReports: dbRecord.processed_reports,
      failedReports: dbRecord.failed_reports,
      errorMessage: dbRecord.error_message,
      metadata: dbRecord.metadata ? JSON.parse(dbRecord.metadata) : {},
      createdAt: new Date(dbRecord.created_at),
      updatedAt: new Date(dbRecord.updated_at)
    };
  }
}

export const syncLogModel = new SyncLogModel(); 