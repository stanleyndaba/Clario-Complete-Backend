import { getDatabase } from '@/shared/db/connection';
import { getLogger } from '@/shared/utils/logger';
import { 
  ReportMetadata, 
  ReportStatus, 
  ReportType, 
  ReportMetadataSchema 
} from '@/types';

const logger = getLogger('ReportModel');

export interface ReportData {
  id: string;
  userId: string;
  reportId: string;
  reportType: ReportType;
  dataStartTime: Date;
  dataEndTime: Date;
  marketplaceIds: string[];
  reportDocumentId?: string;
  processingStatus: ReportStatus;
  s3Key?: string;
  recordCount?: number;
  processingTime?: number;
  errorMessage?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export class ReportModel {
  private db = getDatabase();

  /**
   * Create a new report record
   */
  async create(data: Omit<ReportData, 'id' | 'createdAt' | 'updatedAt'>): Promise<ReportData> {
    try {
      const [report] = await this.db('reports')
        .insert({
          ...data,
          metadata: JSON.stringify(data.metadata),
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');

      logger.info(`Created report record: ${report.id}`, { reportId: data.reportId, userId: data.userId });

      return this.mapFromDb(report);
    } catch (error) {
      logger.error('Failed to create report record:', error);
      throw error;
    }
  }

  /**
   * Find a report by ID
   */
  async findById(id: string): Promise<ReportData | null> {
    try {
      const report = await this.db('reports')
        .where({ id })
        .first();

      return report ? this.mapFromDb(report) : null;
    } catch (error) {
      logger.error('Failed to find report by ID:', error);
      throw error;
    }
  }

  /**
   * Find a report by Amazon report ID
   */
  async findByReportId(reportId: string): Promise<ReportData | null> {
    try {
      const report = await this.db('reports')
        .where({ report_id: reportId })
        .first();

      return report ? this.mapFromDb(report) : null;
    } catch (error) {
      logger.error('Failed to find report by report ID:', error);
      throw error;
    }
  }

  /**
   * Find reports by user ID
   */
  async findByUserId(userId: string, limit = 100, offset = 0): Promise<ReportData[]> {
    try {
      const reports = await this.db('reports')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return reports.map(report => this.mapFromDb(report));
    } catch (error) {
      logger.error('Failed to find reports by user ID:', error);
      throw error;
    }
  }

  /**
   * Find reports by status
   */
  async findByStatus(status: ReportStatus, limit = 100): Promise<ReportData[]> {
    try {
      const reports = await this.db('reports')
        .where({ processing_status: status })
        .orderBy('created_at', 'asc')
        .limit(limit);

      return reports.map(report => this.mapFromDb(report));
    } catch (error) {
      logger.error('Failed to find reports by status:', error);
      throw error;
    }
  }

  /**
   * Update report status
   */
  async updateStatus(id: string, status: ReportStatus, metadata?: Record<string, any>): Promise<void> {
    try {
      const updateData: any = {
        processing_status: status,
        updated_at: new Date()
      };

      if (metadata) {
        updateData.metadata = JSON.stringify(metadata);
      }

      await this.db('reports')
        .where({ id })
        .update(updateData);

      logger.info(`Updated report status: ${id} -> ${status}`);
    } catch (error) {
      logger.error('Failed to update report status:', error);
      throw error;
    }
  }

  /**
   * Update report processing results
   */
  async updateProcessingResults(
    id: string, 
    recordCount: number, 
    processingTime: number, 
    s3Key?: string
  ): Promise<void> {
    try {
      await this.db('reports')
        .where({ id })
        .update({
          record_count: recordCount,
          processing_time: processingTime,
          s3_key: s3Key,
          processing_status: ReportStatus.COMPLETED,
          updated_at: new Date()
        });

      logger.info(`Updated report processing results: ${id}`, { recordCount, processingTime });
    } catch (error) {
      logger.error('Failed to update report processing results:', error);
      throw error;
    }
  }

  /**
   * Update report error
   */
  async updateError(id: string, errorMessage: string): Promise<void> {
    try {
      await this.db('reports')
        .where({ id })
        .update({
          error_message: errorMessage,
          processing_status: ReportStatus.FAILED,
          updated_at: new Date()
        });

      logger.error(`Updated report error: ${id}`, { errorMessage });
    } catch (error) {
      logger.error('Failed to update report error:', error);
      throw error;
    }
  }

  /**
   * Delete report by ID
   */
  async deleteById(id: string): Promise<void> {
    try {
      await this.db('reports')
        .where({ id })
        .del();

      logger.info(`Deleted report: ${id}`);
    } catch (error) {
      logger.error('Failed to delete report:', error);
      throw error;
    }
  }

  /**
   * Get report statistics for a user
   */
  async getStats(userId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
    inProgress: number;
  }> {
    try {
      const stats = await this.db('reports')
        .where({ user_id: userId })
        .select('processing_status')
        .count('* as count')
        .groupBy('processing_status');

      const result = {
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        inProgress: 0
      };

      stats.forEach(stat => {
        const count = parseInt(stat.count as string);
        result.total += count;
        
        switch (stat.processing_status) {
          case ReportStatus.COMPLETED:
            result.completed = count;
            break;
          case ReportStatus.FAILED:
            result.failed = count;
            break;
          case ReportStatus.PENDING:
            result.pending = count;
            break;
          case ReportStatus.IN_PROGRESS:
            result.inProgress = count;
            break;
        }
      });

      return result;
    } catch (error) {
      logger.error('Failed to get report stats:', error);
      throw error;
    }
  }

  /**
   * Find reports that need processing
   */
  async findPendingReports(limit = 50): Promise<ReportData[]> {
    try {
      const reports = await this.db('reports')
        .whereIn('processing_status', [ReportStatus.PENDING, ReportStatus.IN_PROGRESS])
        .whereNotNull('report_document_id')
        .orderBy('created_at', 'asc')
        .limit(limit);

      return reports.map(report => this.mapFromDb(report));
    } catch (error) {
      logger.error('Failed to find pending reports:', error);
      throw error;
    }
  }

  /**
   * Clean up old failed reports
   */
  async cleanupOldFailedReports(daysOld = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.db('reports')
        .where('processing_status', ReportStatus.FAILED)
        .where('created_at', '<', cutoffDate)
        .del();

      logger.info(`Cleaned up ${result} old failed reports`);
      return result;
    } catch (error) {
      logger.error('Failed to cleanup old failed reports:', error);
      throw error;
    }
  }

  /**
   * Map database record to ReportData interface
   */
  private mapFromDb(dbRecord: any): ReportData {
    return {
      id: dbRecord.id,
      userId: dbRecord.user_id,
      reportId: dbRecord.report_id,
      reportType: dbRecord.report_type as ReportType,
      dataStartTime: new Date(dbRecord.data_start_time),
      dataEndTime: new Date(dbRecord.data_end_time),
      marketplaceIds: dbRecord.marketplace_ids,
      reportDocumentId: dbRecord.report_document_id,
      processingStatus: dbRecord.processing_status as ReportStatus,
      s3Key: dbRecord.s3_key,
      recordCount: dbRecord.record_count,
      processingTime: dbRecord.processing_time,
      errorMessage: dbRecord.error_message,
      metadata: dbRecord.metadata ? JSON.parse(dbRecord.metadata) : {},
      createdAt: new Date(dbRecord.created_at),
      updatedAt: new Date(dbRecord.updated_at)
    };
  }
}

export const reportModel = new ReportModel(); 