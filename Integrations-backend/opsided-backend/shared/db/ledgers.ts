import { getLogger } from '../utils/logger';
import { getDatabase } from './connection';

const logger = getLogger('Ledgers');

interface ReportData {
  id: string;
  type: string;
  amount?: number;
  currency?: string;
  date: string;
  sku?: string;
  orderId?: string;
  description?: string;
  source: string;
  externalId?: string;
  metadata: { [key: string]: any };
}

interface StoreOptions {
  startDate: string;
  endDate: string;
  source: string;
  syncType: 'historical' | 'real-time';
}

interface SyncStatus {
  userId: string;
  reportType: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  recordsProcessed: number;
  totalRecords: number;
  startDate: string;
  endDate: string;
  lastUpdated: string;
  errorMessage?: string;
}

class Ledgers {
  async storeReportData(
    userId: string,
    reportType: string,
    data: ReportData[],
    options: StoreOptions
  ): Promise<void> {
    try {
      logger.info(`Storing ${data.length} records for user ${userId}, report type: ${reportType}`);

      // Begin transaction
      const trx = await getDatabase().transaction();

      try {
        // Store the main report data
        await this.insertReportData(trx, userId, reportType, data, options);

        // Update sync status
        await this.updateSyncStatus(trx, userId, reportType, {
          status: 'completed',
          recordsProcessed: data.length,
          totalRecords: data.length,
          startDate: options.startDate,
          endDate: options.endDate,
          lastUpdated: new Date().toISOString(),
        });

        // Commit transaction
        await trx.commit();

        logger.info(`Successfully stored ${data.length} records for user ${userId}, report type: ${reportType}`);

      } catch (error) {
        // Rollback transaction on error
        await trx.rollback();
        throw error;
      }

    } catch (error) {
      logger.error(`Error storing report data for user ${userId}, report type: ${reportType}:`, error);
      throw error;
    }
  }

  private async insertReportData(
    trx: any,
    userId: string,
    reportType: string,
    data: ReportData[],
    options: StoreOptions
  ): Promise<void> {
    try {
      // Prepare batch insert data
      const insertData = data.map(record => ({
        user_id: userId,
        report_type: reportType,
        record_id: record.id,
        record_type: record.type,
        amount: record.amount || 0,
        currency: record.currency || 'USD',
        record_date: record.date,
        sku: record.sku,
        order_id: record.orderId,
        description: record.description,
        source: record.source,
        external_id: record.externalId,
        metadata: JSON.stringify(record.metadata),
        sync_type: options.syncType,
        sync_start_date: options.startDate,
        sync_end_date: options.endDate,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      // Insert in batches to avoid memory issues
      const batchSize = 1000;
      for (let i = 0; i < insertData.length; i += batchSize) {
        const batch = insertData.slice(i, i + batchSize);
        await trx('case_file_ledger').insert(batch);
      }

      logger.info(`Inserted ${insertData.length} records into case_file_ledger`);

    } catch (error) {
      logger.error(`Error inserting report data:`, error);
      throw error;
    }
  }

  private async updateSyncStatus(
    trx: any,
    userId: string,
    reportType: string,
    status: Partial<SyncStatus>
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      await trx('sync_status')
        .where({
          user_id: userId,
          report_type: reportType,
        })
        .update({
          ...status,
          updated_at: now,
        });

      logger.info(`Updated sync status for user ${userId}, report type: ${reportType}`);

    } catch (error) {
      logger.error(`Error updating sync status:`, error);
      throw error;
    }
  }

  async getSyncStatus(userId: string, reportType?: string): Promise<SyncStatus[]> {
    try {
      let query = getDatabase()('sync_status').where('user_id', userId);
      
      if (reportType) {
        query = query.where('report_type', reportType);
      }

      const statuses = await query.orderBy('updated_at', 'desc');
      
      logger.info(`Retrieved sync status for user ${userId}: ${statuses.length} records`);
      return statuses;

    } catch (error) {
      logger.error(`Error getting sync status for user ${userId}:`, error);
      throw error;
    }
  }

  async createSyncStatus(
    userId: string,
    reportType: string,
    startDate: string,
    endDate: string
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      await getDatabase()('sync_status').insert({
        user_id: userId,
        report_type: reportType,
        status: 'pending',
        records_processed: 0,
        total_records: 0,
        start_date: startDate,
        end_date: endDate,
        created_at: now,
        updated_at: now,
      });

      logger.info(`Created sync status for user ${userId}, report type: ${reportType}`);

    } catch (error) {
      logger.error(`Error creating sync status:`, error);
      throw error;
    }
  }

  async getReportData(
    userId: string,
    reportType?: string,
    startDate?: string,
    endDate?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<ReportData[]> {
    try {
      let query = getDatabase()('case_file_ledger').where('user_id', userId);

      if (reportType) {
        query = query.where('report_type', reportType);
      }

      if (startDate) {
        query = query.where('record_date', '>=', startDate);
      }

      if (endDate) {
        query = query.where('record_date', '<=', endDate);
      }

      const records = await query
        .orderBy('record_date', 'desc')
        .limit(limit)
        .offset(offset);

      // Transform database records to ReportData format
      const reportData: ReportData[] = records.map(record => ({
        id: record.record_id,
        type: record.record_type,
        amount: record.amount,
        currency: record.currency,
        date: record.record_date,
        sku: record.sku,
        orderId: record.order_id,
        description: record.description,
        source: record.source,
        externalId: record.external_id,
        metadata: JSON.parse(record.metadata || '{}'),
      }));

      logger.info(`Retrieved ${reportData.length} records for user ${userId}`);
      return reportData;

    } catch (error) {
      logger.error(`Error getting report data for user ${userId}:`, error);
      throw error;
    }
  }

  async getReportSummary(userId: string, startDate?: string, endDate?: string): Promise<any> {
    try {
      let query = getDatabase()('case_file_ledger').where('user_id', userId);

      if (startDate) {
        query = query.where('record_date', '>=', startDate);
      }

      if (endDate) {
        query = query.where('record_date', '<=', endDate);
      }

      const summary = await query
        .select(
          'report_type',
          'record_type',
          'currency',
          getDatabase().raw('COUNT(*) as record_count'),
          getDatabase().raw('SUM(amount) as total_amount')
        )
        .groupBy('report_type', 'record_type', 'currency');

      logger.info(`Retrieved summary for user ${userId}: ${summary.length} groups`);
      return summary;

    } catch (error) {
      logger.error(`Error getting report summary for user ${userId}:`, error);
      throw error;
    }
  }

  async deleteReportData(
    userId: string,
    reportType: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    try {
      const deletedCount = await getDatabase()('case_file_ledger')
        .where({
          user_id: userId,
          report_type: reportType,
        })
        .whereBetween('record_date', [startDate, endDate])
        .del();

      logger.info(`Deleted ${deletedCount} records for user ${userId}, report type: ${reportType}`);
      return deletedCount;

    } catch (error) {
      logger.error(`Error deleting report data for user ${userId}:`, error);
      throw error;
    }
  }

  async getDuplicateRecords(userId: string, reportType: string): Promise<ReportData[]> {
    try {
      const duplicates = await getDatabase()('case_file_ledger')
        .where({
          user_id: userId,
          report_type: reportType,
        })
        .whereNotNull('external_id')
        .groupBy('external_id')
        .having(getDatabase().raw('COUNT(*) > 1'))
        .select('external_id');

      logger.info(`Found ${duplicates.length} duplicate external IDs for user ${userId}, report type: ${reportType}`);
      return duplicates;

    } catch (error) {
      logger.error(`Error getting duplicate records for user ${userId}:`, error);
      throw error;
    }
  }

  async removeDuplicates(userId: string, reportType: string): Promise<number> {
    try {
      // Get duplicate records
      const duplicates = await this.getDuplicateRecords(userId, reportType);
      
      let totalRemoved = 0;

      for (const duplicate of duplicates) {
        // Keep the most recent record, delete the rest
        const recordsToDelete = await getDatabase()('case_file_ledger')
          .where({
            user_id: userId,
            report_type: reportType,
            external_id: duplicate.externalId,
          })
          .orderBy('created_at', 'desc')
          .offset(1); // Skip the first (most recent) record

        if (recordsToDelete.length > 0) {
          const deletedCount = await getDatabase()('case_file_ledger')
            .whereIn('id', recordsToDelete.map(r => r.id))
            .del();

          totalRemoved += deletedCount;
        }
      }

      logger.info(`Removed ${totalRemoved} duplicate records for user ${userId}, report type: ${reportType}`);
      return totalRemoved;

    } catch (error) {
      logger.error(`Error removing duplicates for user ${userId}:`, error);
      throw error;
    }
  }

  async saveCaseFile(userId: string, claimId: string, data: {
    mcdeDocId?: string;
    caseStatus?: string;
    syncedAt?: string;
    rawData?: any;
    normalizedData?: any;
    auditLog?: any;
  }): Promise<void> {
    try {
      // Idempotency: upsert by user_id + claim_id
      const now = new Date().toISOString();
      await getDatabase()('refund_engine_cases')
        .insert({
          user_id: userId,
          claim_id: claimId,
          mcde_doc_id: data.mcdeDocId || null,
          case_status: data.caseStatus || 'synced',
          synced_at: data.syncedAt || now,
          raw_data: JSON.stringify(data.rawData || {}),
          normalized_data: JSON.stringify(data.normalizedData || {}),
          audit_log: JSON.stringify(data.auditLog || []),
          created_at: now,
        })
        .onConflict(['user_id', 'claim_id'])
        .merge();
      logger.info('Case file saved', { userId, claimId });
    } catch (error) {
      logger.error('Error saving case file', { userId, claimId, error });
      throw error;
    }
  }

  async updateCaseFileStatus(userId: string, claimId: string, status: string, auditLog?: any): Promise<void> {
    try {
      const now = new Date().toISOString();
      await getDatabase()('refund_engine_cases')
        .where({ user_id: userId, claim_id: claimId })
        .update({
          case_status: status,
          audit_log: auditLog ? JSON.stringify(auditLog) : undefined,
          synced_at: now,
        });
      logger.info('Case file status updated', { userId, claimId, status });
    } catch (error) {
      logger.error('Error updating case file status', { userId, claimId, error });
      throw error;
    }
  }

  async getCaseFilesForUser(userId: string): Promise<any[]> {
    try {
      const cases = await getDatabase()('refund_engine_cases')
        .where({ user_id: userId })
        .orderBy('synced_at', 'desc');
      logger.info('Fetched case files for user', { userId, count: cases.length });
      return cases;
    } catch (error) {
      logger.error('Error fetching case files for user', { userId, error });
      throw error;
    }
  }

  // Method to initialize database tables if they don't exist
  async initializeTables(): Promise<void> {
    try {
      logger.info('Initializing ledger tables');

      // Create case_file_ledger table
      await getDatabase().schema.createTableIfNotExists('case_file_ledger', (table) => {
        table.increments('id').primary();
        table.string('user_id').notNullable();
        table.string('report_type').notNullable();
        table.string('record_id').notNullable();
        table.string('record_type').notNullable();
        table.decimal('amount', 15, 2).defaultTo(0);
        table.string('currency', 3).defaultTo('USD');
        table.timestamp('record_date').notNullable();
        table.string('sku');
        table.string('order_id');
        table.text('description');
        table.string('source').notNullable();
        table.string('external_id');
        table.json('metadata');
        table.string('sync_type').notNullable();
        table.date('sync_start_date').notNullable();
        table.date('sync_end_date').notNullable();
        table.timestamp('created_at').defaultTo(getDatabase().fn.now());
        table.timestamp('updated_at').defaultTo(getDatabase().fn.now());

        // Indexes for performance
        table.index(['user_id', 'report_type']);
        table.index(['user_id', 'record_date']);
        table.index(['external_id']);
        table.index(['sync_type']);
      });

      // Create sync_status table
      await getDatabase().schema.createTableIfNotExists('sync_status', (table) => {
        table.increments('id').primary();
        table.string('user_id').notNullable();
        table.string('report_type').notNullable();
        table.string('status').notNullable(); // pending, in_progress, completed, failed
        table.integer('records_processed').defaultTo(0);
        table.integer('total_records').defaultTo(0);
        table.date('start_date').notNullable();
        table.date('end_date').notNullable();
        table.text('error_message');
        table.timestamp('created_at').defaultTo(getDatabase().fn.now());
        table.timestamp('updated_at').defaultTo(getDatabase().fn.now());

        // Indexes for performance
        table.index(['user_id', 'report_type']);
        table.index(['status']);
        table.index(['updated_at']);
      });

      logger.info('Ledger tables initialized successfully');

    } catch (error) {
      logger.error('Error initializing ledger tables:', error);
      throw error;
    }
  }
}

export const ledgers = new Ledgers();
export default ledgers; 