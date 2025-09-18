import { getLogger } from '../../../shared/utils/logger';
import { InventoryItem, Discrepancy, InventorySyncLog } from '../models/InventoryItem';
import { SyncOrchestratorService } from './syncOrchestratorService';
import { InventoryReconciliationService } from './inventoryReconciliationService';

const logger = getLogger('SyncService');

interface SyncResult {
  success: boolean;
  syncedItems: number;
  errors: string[];
  message: string;
  jobId?: string;
}

interface SyncStatus {
  lastSync: Date;
  totalItems: number;
  syncedItems: number;
  errors: number;
  status: 'idle' | 'running' | 'completed' | 'failed';
}

class SyncService {
  private syncJobs = new Map<string, SyncStatus>();
  private syncOrchestrator: SyncOrchestratorService;
  private reconciliationService: InventoryReconciliationService;
  public notificationService: any;

  constructor() {
    this.syncOrchestrator = new SyncOrchestratorService();
    this.reconciliationService = new InventoryReconciliationService();
  }

  async startSync(userId: string, source?: string, syncType: 'full' | 'incremental' | 'discrepancy_only' = 'full'): Promise<SyncResult> {
    try {
      logger.info(`Starting sync for user ${userId}, source: ${source || 'all'}, type: ${syncType}`);

      // Check if user exists (this would be enhanced with actual user validation)
      // For now, we'll proceed with the sync

      // Update sync status
      this.syncJobs.set(userId, {
        lastSync: new Date(),
        totalItems: 0,
        syncedItems: 0,
        errors: 0,
        status: 'running',
      });

      // Start sync job using orchestrator
      const sourceSystems = source ? [source] : ['amazon']; // Default to Amazon, can be extended
      const jobId = await this.syncOrchestrator.startSyncJob(userId, syncType, sourceSystems);

      logger.info(`Sync job started for user ${userId} with job ID: ${jobId}`);

      return {
        success: true,
        syncedItems: 0, // Will be updated as job progresses
        errors: [],
        message: `Sync job started successfully with ID: ${jobId}`,
        jobId,
      };

    } catch (error) {
      logger.error(`Sync failed for user ${userId}:`, error);
      
      const status = this.syncJobs.get(userId);
      if (status) {
        status.status = 'failed';
        status.errors = 1;
        this.syncJobs.set(userId, status);
      }

      return {
        success: false,
        syncedItems: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        message: 'Sync failed',
      };
    }
  }

  async getSyncStatus(userId: string): Promise<SyncStatus | null> {
    return this.syncJobs.get(userId) || null;
  }

  async getJobStatus(jobId: string): Promise<any> {
    try {
      return await this.syncOrchestrator.getJobStatus(jobId);
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}:`, error);
      return null;
    }
  }

  async getAllJobStatuses(userId?: string): Promise<any[]> {
    try {
      return await this.syncOrchestrator.getAllJobStatuses(userId);
    } catch (error) {
      logger.error('Error getting all job statuses:', error);
      return [];
    }
  }

  async getDiscrepancies(
    userId: string, 
    source?: string, 
    location?: string
  ): Promise<any[]> {
    try {
      logger.info(`Getting discrepancies for user ${userId}`);

      // Get discrepancy summary from reconciliation service
      const discrepancySummary = await this.reconciliationService.getDiscrepancySummary(userId);
      
      let discrepancies = discrepancySummary.recentDiscrepancies;

      // Filter by source if provided
      if (source) {
        discrepancies = discrepancies.filter(d => d.sourceSystem === source);
      }

      // Filter by location if provided (this would need to be enhanced based on your data structure)
      if (location) {
        // For now, we'll skip location filtering as it's not in the current discrepancy structure
        logger.warn('Location filtering not yet implemented for discrepancies');
      }

      logger.info(`Found ${discrepancies.length} discrepancies for user ${userId}`);
      return discrepancies;

    } catch (error) {
      logger.error(`Error getting discrepancies for user ${userId}:`, error);
      return [];
    }
  }

  async getDiscrepancySummary(userId: string): Promise<any> {
    try {
      return await this.reconciliationService.getDiscrepancySummary(userId);
    } catch (error) {
      logger.error(`Error getting discrepancy summary for user ${userId}:`, error);
      return {
        total: 0,
        bySeverity: {},
        byStatus: {},
        recentDiscrepancies: [],
      };
    }
  }

  async reconcileInventory(userId: string, discrepancies: any[]): Promise<any> {
    try {
      logger.info(`Reconciling inventory for user ${userId}`);

      const results = [];

      for (const discrepancy of discrepancies) {
        try {
          // Find inventory item
          const inventoryItems = await InventoryItem.findBySku(discrepancy.sku, userId);
          
          if (inventoryItems.length > 0) {
            const item = inventoryItems[0];
            
            // Update quantity to expected value
            await item.updateQuantity(discrepancy.sourceValue);
            
            results.push({
              sku: discrepancy.sku,
              success: true,
              oldQuantity: discrepancy.targetValue,
              newQuantity: discrepancy.sourceValue,
            });
          } else {
            // Create new inventory item
            await InventoryItem.create({
              sku: discrepancy.sku,
              quantity_available: discrepancy.sourceValue,
              quantity_reserved: 0,
              quantity_shipped: 0,
              reorder_point: 10,
              reorder_quantity: 50,
              is_active: true,
              user_id: userId,
              metadata: {
                source_system: discrepancy.sourceSystem,
                created_from_discrepancy: true,
                last_synced: new Date(),
              },
            });

            results.push({
              sku: discrepancy.sku,
              success: true,
              action: 'created',
              quantity: discrepancy.sourceValue,
            });
          }
        } catch (error) {
          logger.error(`Error reconciling item ${discrepancy.sku}:`, error);
          results.push({
            sku: discrepancy.sku,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info(`Inventory reconciliation completed for user ${userId}`);

      return {
        success: true,
        reconciledItems: results.filter(r => r.success).length,
        failedItems: results.filter(r => !r.success).length,
        results,
      };

    } catch (error) {
      logger.error(`Error reconciling inventory for user ${userId}:`, error);
      throw error;
    }
  }

  async getSyncMetrics(userId?: string): Promise<any> {
    try {
      return await this.syncOrchestrator.getSyncMetrics(userId);
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

  async cancelSyncJob(jobId: string): Promise<boolean> {
    try {
      return await this.syncOrchestrator.cancelJob(jobId);
    } catch (error) {
      logger.error(`Error cancelling job ${jobId}:`, error);
      return false;
    }
  }

  async getJobHistory(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const logs = await this.syncOrchestrator.getJobHistory(userId, limit);
      return logs.map(log => log.toJSON());
    } catch (error) {
      logger.error(`Error getting job history for user ${userId}:`, error);
      return [];
    }
  }

  async addReconciliationRule(userId: string, rule: any): Promise<any> {
    try {
      return await this.reconciliationService.addReconciliationRule(userId, rule);
    } catch (error) {
      logger.error(`Error adding reconciliation rule for user ${userId}:`, error);
      throw error;
    }
  }

  async getReconciliationRules(userId: string): Promise<any[]> {
    try {
      return await this.reconciliationService.getReconciliationRules(userId);
    } catch (error) {
      logger.error(`Error getting reconciliation rules for user ${userId}:`, error);
      return [];
    }
  }

  // Legacy method for backward compatibility
  private async simulateSync(userId: string, source?: string): Promise<void> {
    // This method is kept for backward compatibility but is no longer used
    // The actual sync is now handled by the orchestrator service
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info(`Simulated sync completed for user ${userId}`);
  }
}

export const syncService = new SyncService(); 