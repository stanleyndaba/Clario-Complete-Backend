import { getLogger } from '../../../shared/utils/logger';
import { getDatabase } from '../../../shared/db/connection';
import { AmazonSPAPIService, AmazonSPAPIConfig } from './amazonSPAPIService';
import { InventoryReconciliationService, ReconciliationResult } from './inventoryReconciliationService';
import { InventoryItem, InventorySyncLog, Discrepancy } from '../models/InventoryItem';
import { progressBus } from './progressBus';

const logger = getLogger('SyncOrchestratorService');

export interface SyncJob {
  id: string;
  userId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  type: 'full' | 'incremental' | 'discrepancy_only';
  sourceSystems: string[];
  startedAt: Date;
  completedAt?: Date;
  progress: {
    current: number;
    total: number;
    percentage: number;
  };
  metadata: {
    errors: string[];
    warnings: string[];
    sourceData: { [key: string]: number };
    reconciliationResults: { [key: string]: ReconciliationResult };
  };
}

export interface SyncJobStatus {
  jobId: string;
  userId: string;
  status: string;
  progress: number;
  startedAt: Date;
  estimatedCompletion?: Date;
  lastUpdate: Date;
  errors: string[];
  warnings: string[];
}

export interface SyncMetrics {
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  averageDuration: number;
  lastSyncTimestamp: Date;
  discrepanciesFound: number;
  discrepanciesResolved: number;
  itemsSynced: number;
  sourceSystemHealth: { [key: string]: { status: string; lastSync: Date | null; errorCount: number } };
}

export class SyncOrchestratorService {
  private activeJobs: Map<string, SyncJob> = new Map();
  private amazonService: AmazonSPAPIService | null = null;
  private reconciliationService: InventoryReconciliationService;
  private retryAttempts: Map<string, number> = new Map();
  private maxRetries = 3;
  private retryDelay = 5000; // 5 seconds

  constructor() {
    this.reconciliationService = new InventoryReconciliationService();
  }

  async initializeAmazonService(userId: string): Promise<void> {
    try {
      const db = getDatabase();
      
      // Get Amazon integration details from database
      const amazonIntegration = await db('amazon_integrations')
        .where({ user_id: userId })
        .first();

      if (!amazonIntegration) {
        logger.warn(`No Amazon integration found for user ${userId}`);
        return;
      }

      // Get OAuth tokens
      const oauthToken = await db('oauth_tokens')
        .where({ user_id: userId, provider: 'amazon' })
        .first();

      if (!oauthToken) {
        logger.warn(`No OAuth token found for Amazon integration for user ${userId}`);
        return;
      }

      const config: AmazonSPAPIConfig = {
        clientId: process.env.AMAZON_CLIENT_ID || '',
        clientSecret: process.env.AMAZON_CLIENT_SECRET || '',
        refreshToken: oauthToken.refresh_token || '',
        marketplaceId: amazonIntegration.marketplace_id,
        sellerId: amazonIntegration.seller_id || '',
        region: amazonIntegration.region || 'us-east-1',
      };

      this.amazonService = new AmazonSPAPIService(config);
      logger.info(`Amazon SP-API service initialized for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to initialize Amazon service for user ${userId}:`, error);
    }
  }

  async startSyncJob(
    userId: string,
    type: 'full' | 'incremental' | 'discrepancy_only' = 'full',
    sourceSystems: string[] = ['amazon']
  ): Promise<string> {
    const jobId = `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: SyncJob = {
      id: jobId,
      userId,
      status: 'pending',
      type,
      sourceSystems,
      startedAt: new Date(),
      progress: { current: 0, total: 0, percentage: 0 },
      metadata: {
        errors: [],
        warnings: [],
        sourceData: {},
        reconciliationResults: {},
      },
    };

    this.activeJobs.set(jobId, job);
    logger.info(`Created sync job ${jobId} for user ${userId}`);

    // Start the job asynchronously
    this.executeSyncJob(jobId).catch(error => {
      logger.error(`Sync job ${jobId} failed:`, error);
    });

    return jobId;
  }

  private async executeSyncJob(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    try {
      job.status = 'running';
      job.startedAt = new Date();
      
      logger.info(`Starting sync job ${jobId} for user ${job.userId}`);
      progressBus.emitProgress({
        jobId: job.id,
        userId: job.userId,
        percentage: 0,
        current: 0,
        total: 0,
        status: job.status,
        errors: [],
        warnings: [],
        timestamp: new Date().toISOString(),
      });

      // Initialize services
      await this.initializeAmazonService(job.userId);

      // Execute sync based on type
      switch (job.type) {
        case 'full':
          await this.executeFullSync(job);
          break;
        case 'incremental':
          await this.executeIncrementalSync(job);
          break;
        case 'discrepancy_only':
          await this.executeDiscrepancyDetection(job);
          break;
      }

      job.status = 'completed';
      job.completedAt = new Date();
      job.progress = { current: job.progress.total, total: job.progress.total, percentage: 100 };
      
      logger.info(`Sync job ${jobId} completed successfully`);
      progressBus.emitProgress({
        jobId: job.id,
        userId: job.userId,
        percentage: 100,
        current: job.progress.current,
        total: job.progress.total,
        status: job.status,
        errors: job.metadata.errors,
        warnings: job.metadata.warnings,
        timestamp: new Date().toISOString(),
      });
      
      // Clean up retry attempts
      this.retryAttempts.delete(jobId);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      job.metadata.errors.push(errorMessage);
      
      // Check if we should retry
      const retryCount = this.retryAttempts.get(jobId) || 0;
      if (retryCount < this.maxRetries) {
        logger.warn(`Sync job ${jobId} failed, retrying in ${this.retryDelay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        this.retryAttempts.set(jobId, retryCount + 1);
        
        // Schedule retry
        setTimeout(() => {
          this.executeSyncJob(jobId).catch(error => {
            logger.error(`Retry of sync job ${jobId} failed:`, error);
          });
        }, this.retryDelay * Math.pow(2, retryCount)); // Exponential backoff
        
        return;
      }

      // Max retries exceeded
      job.status = 'failed';
      job.completedAt = new Date();
      logger.error(`Sync job ${jobId} failed after ${this.maxRetries} retries`);
      progressBus.emitProgress({
        jobId: job.id,
        userId: job.userId,
        percentage: job.progress.percentage,
        current: job.progress.current,
        total: job.progress.total,
        status: job.status,
        errors: job.metadata.errors,
        warnings: job.metadata.warnings,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async executeFullSync(job: SyncJob): Promise<void> {
    logger.info(`Executing full sync for job ${job.id}`);

    const results: { [key: string]: ReconciliationResult } = {};

    for (const sourceSystem of job.sourceSystems) {
      try {
        logger.info(`Syncing from ${sourceSystem} for user ${job.userId}`);
        
        let sourceData: any[] = [];
        
        // Fetch data from source system
        switch (sourceSystem) {
          case 'amazon':
            if (this.amazonService) {
              const amazonData = await this.amazonService.fetchInventoryItems([job.userId]);
              sourceData = this.amazonService.convertToInternalFormat(amazonData, job.userId);
              job.metadata.sourceData[sourceSystem] = sourceData.length;
              // Additionally ingest financial events for reconciliation and billing triggers
              try {
                const finEvents = await this.amazonService.fetchFinancialEvents([job.userId]);
                job.metadata.sourceData['amazon_financial_events'] = finEvents.length;
              } catch {}
            } else {
              throw new Error('Amazon service not initialized');
            }
            break;
          
          default:
            logger.warn(`Unknown source system: ${sourceSystem}`);
            continue;
        }

        // Update progress
        job.progress.total += sourceData.length;
        
        // Reconcile inventory
        const reconciliationResult = await this.reconciliationService.reconcileInventory(
          job.userId,
          sourceSystem,
          sourceData
        );

        results[sourceSystem] = reconciliationResult;
        job.metadata.reconciliationResults[sourceSystem] = reconciliationResult;

        // Update progress
        job.progress.current += sourceData.length;
        job.progress.percentage = Math.round((job.progress.current / job.progress.total) * 100);
        // Emit progress event (simple log; could be wired to WebSocket broker)
        logger.info(`Progress ${job.id}: ${job.progress.percentage}%`);

        logger.info(`Completed sync from ${sourceSystem}: ${reconciliationResult.itemsProcessed} items processed`);
        progressBus.emitProgress({
          jobId: job.id,
          userId: job.userId,
          percentage: job.progress.percentage,
          current: job.progress.current,
          total: job.progress.total,
          status: job.status,
          errors: job.metadata.errors,
          warnings: job.metadata.warnings,
          timestamp: new Date().toISOString(),
        });

      } catch (error) {
        const errorMessage = `Error syncing from ${sourceSystem}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        job.metadata.errors.push(errorMessage);
        logger.error(errorMessage, error);
        
        // Continue with other source systems
      }
    }

    // Log final results
    const totalProcessed = Object.values(results).reduce((sum, result) => sum + result.itemsProcessed, 0);
    const totalDiscrepancies = Object.values(results).reduce((sum, result) => sum + result.discrepanciesFound, 0);
    
    logger.info(`Full sync completed for job ${job.id}: ${totalProcessed} items processed, ${totalDiscrepancies} discrepancies found`);
  }

  private async executeIncrementalSync(job: SyncJob): Promise<void> {
    logger.info(`Executing incremental sync for job ${job.id}`);

    // Get last sync timestamp for each source system
    const db = getDatabase();
    const lastSyncLogs = await db('inventory_sync_logs')
      .where({ user_id: job.userId, status: 'completed' })
      .orderBy('completed_at', 'desc')
      .limit(job.sourceSystems.length);

    const lastSyncMap = new Map(lastSyncLogs.map(log => [log.provider, log.completed_at]));

    for (const sourceSystem of job.sourceSystems) {
      try {
        const lastSync = lastSyncMap.get(sourceSystem);
        if (!lastSync) {
          logger.warn(`No previous sync found for ${sourceSystem}, falling back to full sync`);
          await this.executeFullSync(job);
          return;
        }

        // For incremental sync, we would typically only fetch changes since last sync
        // For now, we'll implement a simplified version that fetches all data
        // but could be enhanced to use timestamps for filtering
        logger.info(`Executing incremental sync from ${sourceSystem} since ${lastSync}`);
        
        // This would be enhanced to only fetch changed items
        await this.executeFullSync(job);

      } catch (error) {
        const errorMessage = `Error in incremental sync from ${sourceSystem}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        job.metadata.errors.push(errorMessage);
        logger.error(errorMessage, error);
      }
    }
  }

  private async executeDiscrepancyDetection(job: SyncJob): Promise<void> {
    logger.info(`Executing discrepancy detection for job ${job.id}`);

    try {
      // Get discrepancy summary
      const discrepancySummary = await this.reconciliationService.getDiscrepancySummary(job.userId);
      
      job.metadata.sourceData['discrepancies'] = discrepancySummary.total;
      job.progress.total = 1;
      job.progress.current = 1;
      job.progress.percentage = 100;

      logger.info(`Discrepancy detection completed: ${discrepancySummary.total} discrepancies found`);

    } catch (error) {
      const errorMessage = `Error in discrepancy detection: ${error instanceof Error ? error.message : 'Unknown error'}`;
      job.metadata.errors.push(errorMessage);
      logger.error(errorMessage, error);
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<SyncJobStatus | null> {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return null;
    }

    return {
      jobId: job.id,
      userId: job.userId,
      status: job.status,
      progress: job.progress.percentage,
      startedAt: job.startedAt,
      estimatedCompletion: this.calculateEstimatedCompletion(job),
      lastUpdate: new Date(),
      errors: job.metadata.errors,
      warnings: job.metadata.warnings,
    };
  }

  async getAllJobStatuses(userId?: string): Promise<SyncJobStatus[]> {
    const jobs = userId 
      ? Array.from(this.activeJobs.values()).filter(job => job.userId === userId)
      : Array.from(this.activeJobs.values());

    return jobs.map(job => ({
      jobId: job.id,
      userId: job.userId,
      status: job.status,
      progress: job.progress.percentage,
      startedAt: job.startedAt,
      estimatedCompletion: this.calculateEstimatedCompletion(job),
      lastUpdate: new Date(),
      errors: job.metadata.errors,
      warnings: job.metadata.warnings,
    }));
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === 'running') {
      job.status = 'cancelled';
      job.completedAt = new Date();
      logger.info(`Job ${jobId} cancelled`);
      return true;
    }

    return false;
  }

  async getSyncMetrics(userId?: string): Promise<SyncMetrics> {
    try {
      const db = getDatabase();
      
      // Get job statistics
      let jobQuery = db('inventory_sync_logs');
      if (userId) {
        jobQuery = jobQuery.where({ user_id: userId });
      }

      const allJobs = await jobQuery;
      const successfulJobs = allJobs.filter(job => job.status === 'completed').length;
      const failedJobs = allJobs.filter(job => job.status === 'failed').length;
      const totalJobs = allJobs.length;

      // Calculate average duration
      const completedJobs = allJobs.filter(job => job.status === 'completed' && job.completed_at);
      const totalDuration = completedJobs.reduce((sum, job) => {
        const duration = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
        return sum + duration;
      }, 0);
      const averageDuration = completedJobs.length > 0 ? totalDuration / completedJobs.length : 0;

      // Get last sync timestamp
      const lastSync = allJobs
        .filter(job => job.status === 'completed')
        .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0];

      // Get discrepancy statistics
      let discrepancyQuery = db('discrepancies');
      if (userId) {
        discrepancyQuery = discrepancyQuery.where({ user_id: userId });
      }

      const allDiscrepancies = await discrepancyQuery;
      const discrepanciesFound = allDiscrepancies.length;
      const discrepanciesResolved = allDiscrepancies.filter(d => d.status === 'resolved').length;

      // Get total items synced
      let itemsQuery = db('inventory_items');
      if (userId) {
        itemsQuery = itemsQuery.where({ user_id: userId });
      }

      const allItems = await itemsQuery;
      const itemsSynced = allItems.length;

      // Get source system health
      const sourceSystemHealth: { [key: string]: { status: string; lastSync: Date | null; errorCount: number } } = {};
      
      if (this.amazonService) {
        try {
          const amazonHealth = await this.amazonService.getInventoryHealth();
          sourceSystemHealth.amazon = amazonHealth;
        } catch (error) {
          sourceSystemHealth.amazon = {
            status: 'unhealthy',
            lastSync: null,
            errorCount: 1,
          };
        }
      }

      return {
        totalJobs,
        successfulJobs,
        failedJobs,
        averageDuration,
        lastSyncTimestamp: lastSync ? new Date(lastSync.completed_at) : new Date(0),
        discrepanciesFound,
        discrepanciesResolved,
        itemsSynced,
        sourceSystemHealth,
      };

    } catch (error) {
      logger.error('Error getting sync metrics:', error);
      return {
        totalJobs: 0,
        successfulJobs: 0,
        failedJobs: 0,
        averageDuration: 0,
        lastSyncTimestamp: new Date(0),
        discrepanciesFound: 0,
        discrepanciesResolved: 0,
        itemsSynced: 0,
        sourceSystemHealth: {},
      };
    }
  }

  private calculateEstimatedCompletion(job: SyncJob): Date | undefined {
    if (job.status !== 'running' || job.progress.total === 0) {
      return undefined;
    }

    const elapsed = Date.now() - job.startedAt.getTime();
    const progress = job.progress.current / job.progress.total;
    
    if (progress === 0) {
      return undefined;
    }

    const estimatedTotal = elapsed / progress;
    const remaining = estimatedTotal - elapsed;
    
    return new Date(Date.now() + remaining);
  }

  async cleanupCompletedJobs(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = Date.now() - maxAge;
    const jobsToRemove: string[] = [];

    for (const [jobId, job] of this.activeJobs.entries()) {
      if (job.status === 'completed' || job.status === 'failed') {
        if (job.completedAt && job.completedAt.getTime() < cutoff) {
          jobsToRemove.push(jobId);
        }
      }
    }

    for (const jobId of jobsToRemove) {
      this.activeJobs.delete(jobId);
      this.retryAttempts.delete(jobId);
    }

    if (jobsToRemove.length > 0) {
      logger.info(`Cleaned up ${jobsToRemove.length} completed jobs`);
    }
  }

  async getActiveJobsCount(): Promise<number> {
    return Array.from(this.activeJobs.values()).filter(job => job.status === 'running').length;
  }

  async getJobHistory(userId: string, limit: number = 50): Promise<InventorySyncLog[]> {
    try {
      const db = getDatabase();
      const logs = await db('inventory_sync_logs')
        .where({ user_id: userId })
        .orderBy('started_at', 'desc')
        .limit(limit);
      
      return logs.map(log => new InventorySyncLog(log));
    } catch (error) {
      logger.error(`Error getting job history for user ${userId}:`, error);
      return [];
    }
  }
}

