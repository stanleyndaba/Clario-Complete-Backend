import cron from 'node-cron';
import { getLogger } from '../../../shared/utils/logger';
import { syncService } from '../services/syncService';
import { User } from '../../../shared/models/User';

const logger = getLogger('InventoryJob');

interface JobConfig {
  schedule: string;
  enabled: boolean;
  description: string;
}

class InventoryJob {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private config: JobConfig = {
    schedule: '0 */6 * * *', // Every 6 hours
    enabled: true,
    description: 'Inventory synchronization job',
  };

  constructor() {
    this.initializeJobs();
  }

  private initializeJobs(): void {
    if (!this.config.enabled) {
      logger.info('Inventory jobs are disabled');
      return;
    }

    // Main inventory sync job
    const syncJob = cron.schedule(this.config.schedule, async () => {
      await this.runInventorySync();
    }, {
      scheduled: false,
      timezone: 'UTC',
    });

    this.jobs.set('inventory-sync', syncJob);

    // Discrepancy detection job (runs every 2 hours)
    const discrepancyJob = cron.schedule('0 */2 * * *', async () => {
      await this.runDiscrepancyDetection();
    }, {
      scheduled: false,
      timezone: 'UTC',
    });

    this.jobs.set('discrepancy-detection', discrepancyJob);

    logger.info('Inventory jobs initialized');
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting inventory jobs...');

      for (const [name, job] of this.jobs) {
        job.start();
        logger.info(`Started job: ${name}`);
      }

      logger.info('All inventory jobs started successfully');
    } catch (error) {
      logger.error('Error starting inventory jobs:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      logger.info('Stopping inventory jobs...');

      for (const [name, job] of this.jobs) {
        job.stop();
        logger.info(`Stopped job: ${name}`);
      }

      logger.info('All inventory jobs stopped successfully');
    } catch (error) {
      logger.error('Error stopping inventory jobs:', error);
      throw error;
    }
  }

  private async runInventorySync(): Promise<void> {
    try {
      logger.info('Starting scheduled inventory sync...');

      // Get all users (in a real app, you might want to filter active users)
      // For now, we'll simulate with mock user IDs
      const mockUserIds = ['user-1', 'user-2', 'user-3'];

      let totalSynced = 0;
      let totalErrors = 0;

      for (const userId of mockUserIds) {
        try {
          const result = await syncService.startSync(userId);
          
          if (result.success) {
            totalSynced += result.syncedItems;
            logger.info(`Sync completed for user ${userId}: ${result.syncedItems} items`);
          } else {
            totalErrors += result.errors.length;
            logger.error(`Sync failed for user ${userId}: ${result.errors.join(', ')}`);
          }
        } catch (error) {
          totalErrors++;
          logger.error(`Error syncing user ${userId}:`, error);
        }
      }

      logger.info(`Scheduled inventory sync completed. Synced: ${totalSynced}, Errors: ${totalErrors}`);

    } catch (error) {
      logger.error('Error in scheduled inventory sync:', error);
    }
  }

  private async runDiscrepancyDetection(): Promise<void> {
    try {
      logger.info('Starting scheduled discrepancy detection...');

      // Get all users
      const mockUserIds = ['user-1', 'user-2', 'user-3'];

      let totalDiscrepancies = 0;

      for (const userId of mockUserIds) {
        try {
          const discrepancies = await syncService.getDiscrepancies(userId);
          
          if (discrepancies.length > 0) {
            totalDiscrepancies += discrepancies.length;
            logger.warn(`Found ${discrepancies.length} discrepancies for user ${userId}`);
            
            // Log high severity discrepancies
            const highSeverity = discrepancies.filter(d => d.severity === 'high');
            if (highSeverity.length > 0) {
              logger.error(`High severity discrepancies for user ${userId}:`, highSeverity);
            }
          } else {
            logger.info(`No discrepancies found for user ${userId}`);
          }
        } catch (error) {
          logger.error(`Error detecting discrepancies for user ${userId}:`, error);
        }
      }

      logger.info(`Scheduled discrepancy detection completed. Total discrepancies: ${totalDiscrepancies}`);

    } catch (error) {
      logger.error('Error in scheduled discrepancy detection:', error);
    }
  }

  // Manual job triggers
  async triggerSync(userId?: string): Promise<void> {
    try {
      if (userId) {
        logger.info(`Manually triggering sync for user ${userId}`);
        await syncService.startSync(userId);
      } else {
        logger.info('Manually triggering sync for all users');
        await this.runInventorySync();
      }
    } catch (error) {
      logger.error('Error in manual sync trigger:', error);
      throw error;
    }
  }

  async triggerDiscrepancyDetection(userId?: string): Promise<void> {
    try {
      if (userId) {
        logger.info(`Manually triggering discrepancy detection for user ${userId}`);
        await syncService.getDiscrepancies(userId);
      } else {
        logger.info('Manually triggering discrepancy detection for all users');
        await this.runDiscrepancyDetection();
      }
    } catch (error) {
      logger.error('Error in manual discrepancy detection trigger:', error);
      throw error;
    }
  }

  // Job status
  getJobStatus(): { [key: string]: boolean } {
    const status: { [key: string]: boolean } = {};
    
    for (const [name, job] of this.jobs) {
      status[name] = job.getStatus() === 'scheduled';
    }
    
    return status;
  }

  // Update job configuration
  updateConfig(newConfig: Partial<JobConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Job configuration updated:', this.config);
  }
}

export const inventoryJob = new InventoryJob(); 