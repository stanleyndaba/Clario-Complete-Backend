import cron from 'node-cron';
import logger from '../utils/logger';
import amazonService from '../services/amazonService';
import { notificationService } from '../notifications/services/notification_service';
import tokenManager from '../utils/tokenManager';
import { supabase } from '../database/supabaseClient';
import financialEventsService from '../services/financialEventsService';
import detectionService from '../services/detectionService';

export class AmazonSyncJob {
  private isRunning = false;

  async syncUserData(userId: string): Promise<string> {
    const syncId = `sync_${userId}_${Date.now()}`;
    
    try {
      logger.info('Starting Amazon sync for user', { userId, syncId });

      // Check if user has valid Amazon token
      const isConnected = await tokenManager.isTokenValid(userId, 'amazon');
      if (!isConnected) {
        logger.info('User not connected to Amazon, skipping sync', { userId, syncId });
        return syncId;
      }

      // Sync claims
      const claimsResult = await amazonService.fetchClaims(userId);
      const claims = claimsResult.data || claimsResult; // Handle both formats
      await this.saveClaimsToDatabase(userId, Array.isArray(claims) ? claims : []);

      // Sync inventory - NOW GETTING REAL DATA FROM SP-API
      try {
        const inventoryResult = await amazonService.fetchInventory(userId);
        const inventory = inventoryResult.data || inventoryResult; // Handle both formats
        await this.saveInventoryToDatabase(userId, Array.isArray(inventory) ? inventory : []);
        
        logger.info('Inventory sync completed', { 
          userId, 
          syncId, 
          itemCount: Array.isArray(inventory) ? inventory.length : 0,
          fromApi: inventoryResult.fromApi || false
        });
      } catch (inventoryError: any) {
        // Log inventory sync failure but don't fail entire sync
        logger.error('Inventory sync failed (non-critical)', { 
          error: inventoryError.message, 
          userId, 
          syncId 
        });
        
        // Still continue with other sync operations
      }

      // Sync fees and financial events
      const feesResult = await amazonService.fetchFees(userId);
      const fees = feesResult.data || feesResult; // Handle both formats
      await this.saveFeesToDatabase(userId, Array.isArray(fees) ? fees : []);
      
      // Ingest financial events
      await this.ingestFinancialEvents(userId, fees);

      // Trigger detection job
      await this.triggerDetectionJob(userId, syncId);

      logger.info('Amazon sync completed successfully', { userId, syncId });
      return syncId;
    } catch (error: any) {
      logger.error('Error during Amazon sync', { userId, syncId, error: error?.message });
      if (error.status === 401) {
        await notificationService.createNotification({
          type: 'integration_warning' as any,
          user_id: userId,
          title: 'Amazon connection needs attention',
          message: 'Your Amazon connection appears to be revoked or expired. Please reconnect to continue syncing.',
          priority: 'high' as any,
          channel: 'in_app' as any,
          payload: { provider: 'amazon' },
          immediate: true,
        });
      }
      return syncId;
    }
  }

  private async saveClaimsToDatabase(userId: string, claims: any[]): Promise<void> {
    try {
      // TODO: Implement actual database save for claims
      // This is a stub implementation
      logger.info('Saving Amazon claims to database', { userId, count: claims.length });
      
      // Mock database save
      for (const claim of claims) {
        // Simulate database operation
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      logger.info('Amazon claims saved to database', { userId, count: claims.length });
    } catch (error) {
      logger.error('Error saving Amazon claims to database', { error, userId });
      throw error;
    }
  }

  private async saveInventoryToDatabase(userId: string, inventory: any[]): Promise<void> {
    try {
      logger.info('Saving Amazon inventory to database', { userId, count: inventory.length });
      
      if (inventory.length === 0) {
        logger.info('No inventory items to save', { userId });
        return;
      }

      // Save to Supabase inventory_items table
      // First, get existing items to update vs create
      const { data: existingItems, error: fetchError } = await supabase
        .from('inventory_items')
        .select('sku')
        .eq('user_id', userId);

      if (fetchError) {
        logger.warn('Error fetching existing inventory items, proceeding with inserts', { error: fetchError, userId });
      }

      const existingSkus = new Set(existingItems?.map((item: any) => item.sku) || []);
      const itemsToInsert: any[] = [];
      const itemsToUpdate: any[] = [];

      // Prepare inventory items for database
      for (const item of inventory) {
        // Store additional Amazon-specific data in dimensions JSONB field
        const dimensionsData: any = {
          asin: item.asin,
          fnSku: item.fnSku,
          condition: item.condition,
          location: item.location || 'FBA',
          damaged: item.damaged || 0,
          lastUpdated: item.lastUpdated,
          source: 'amazon',
          syncedAt: new Date().toISOString()
        };

        const dbItem: any = {
          user_id: userId,
          sku: item.sku,
          quantity_available: item.quantity || 0,
          quantity_reserved: item.reserved || 0,
          quantity_shipped: 0,
          is_active: item.status === 'active',
          updated_at: new Date().toISOString(),
          // Store Amazon metadata in dimensions JSONB field (if available)
          dimensions: Object.keys(dimensionsData).some(key => dimensionsData[key]) ? dimensionsData : null
        };

        if (existingSkus.has(item.sku)) {
          itemsToUpdate.push(dbItem);
        } else {
          itemsToInsert.push({
            ...dbItem,
            reorder_point: 10,
            reorder_quantity: 50,
            created_at: new Date().toISOString()
          });
        }
      }

      // Insert new items
      if (itemsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('inventory_items')
          .insert(itemsToInsert);

        if (insertError) {
          logger.error('Error inserting inventory items', { error: insertError, userId, count: itemsToInsert.length });
          throw new Error(`Failed to insert inventory items: ${insertError.message}`);
        }
        logger.info('Inserted new inventory items', { userId, count: itemsToInsert.length });
      }

      // Update existing items
      for (const item of itemsToUpdate) {
        const updateData: any = {
          quantity_available: item.quantity_available,
          quantity_reserved: item.quantity_reserved,
          is_active: item.is_active,
          updated_at: item.updated_at
        };
        
        // Include dimensions if it exists
        if (item.dimensions) {
          updateData.dimensions = item.dimensions;
        }

        const { error: updateError } = await supabase
          .from('inventory_items')
          .update(updateData)
          .eq('user_id', userId)
          .eq('sku', item.sku);

        if (updateError) {
          logger.error('Error updating inventory item', { error: updateError, userId, sku: item.sku });
          // Continue with other items even if one fails
        }
      }

      if (itemsToUpdate.length > 0) {
        logger.info('Updated existing inventory items', { userId, count: itemsToUpdate.length });
      }
      
      logger.info('Amazon inventory saved to database successfully', { 
        userId, 
        total: inventory.length,
        inserted: itemsToInsert.length,
        updated: itemsToUpdate.length
      });
    } catch (error: any) {
      logger.error('Error saving Amazon inventory to database', { error: error.message, userId });
      throw error;
    }
  }

  private async saveFeesToDatabase(userId: string, fees: any[]): Promise<void> {
    try {
      // TODO: Implement actual database save for fees
      // This is a stub implementation
      logger.info('Saving Amazon fees to database', { userId, count: fees.length });
      
      // Mock database save
      for (const fee of fees) {
        // Simulate database operation
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      logger.info('Amazon fees saved to database', { userId, count: fees.length });
    } catch (error) {
      logger.error('Error saving Amazon fees to database', { error, userId });
      throw error;
    }
  }

  /**
   * Ingest financial events from Amazon data
   */
  private async ingestFinancialEvents(userId: string, fees: any[]): Promise<void> {
    try {
      logger.info('Ingesting financial events', { userId, fees_count: fees.length });

      const financialEvents = fees.map(fee => ({
        seller_id: userId,
        event_type: 'fee' as const,
        amount: fee.amount || 0,
        currency: fee.currency || 'USD',
        raw_payload: fee,
        amazon_event_id: fee.eventId,
        amazon_order_id: fee.orderId,
        amazon_sku: fee.sku,
        event_date: fee.eventDate ? new Date(fee.eventDate) : new Date()
      }));

      if (financialEvents.length > 0) {
        await financialEventsService.ingestEvents(financialEvents);
        
        // Archive to S3
        for (const event of financialEvents) {
          await financialEventsService.archiveToS3(event);
        }
      }

      logger.info('Financial events ingested successfully', { 
        userId, 
        events_count: financialEvents.length 
      });
    } catch (error) {
      logger.error('Error ingesting financial events', { error, userId });
      // Don't throw error as financial events ingestion is not critical for sync
    }
  }

  /**
   * Trigger detection job after sync completion
   */
  private async triggerDetectionJob(userId: string, syncId: string): Promise<void> {
    try {
      logger.info('Triggering detection job', { userId, syncId });

      const detectionJob = {
        seller_id: userId,
        sync_id: syncId,
        timestamp: new Date().toISOString()
      };

      await detectionService.enqueueDetectionJob(detectionJob);

      logger.info('Detection job triggered successfully', { userId, syncId });
    } catch (error) {
      logger.error('Error triggering detection job', { error, userId, syncId });
      // Don't throw error as detection is not critical for sync
    }
  }

  async syncAllUsers(): Promise<void> {
    if (this.isRunning) {
      logger.info('Amazon sync job already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Starting Amazon sync job for all users');

      // TODO: Get all users with Amazon integration
      // This is a stub implementation
      const usersWithAmazon = await this.getUsersWithAmazonIntegration();

      for (const userId of usersWithAmazon) {
        await this.syncUserData(userId);
        // Add delay between users to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('Amazon sync job completed for all users');
    } catch (error) {
      logger.error('Error in Amazon sync job', { error });
    } finally {
      this.isRunning = false;
    }
  }

  private async getUsersWithAmazonIntegration(): Promise<string[]> {
    try {
      // TODO: Implement actual database query to get users with Amazon integration
      // This is a stub implementation
      logger.info('Fetching users with Amazon integration');
      
      // Mock response - in production, this would query the database
      const mockUsers = ['user-1', 'user-2', 'user-3'];
      
      logger.info('Found users with Amazon integration', { count: mockUsers.length });
      return mockUsers;
    } catch (error) {
      logger.error('Error fetching users with Amazon integration', { error });
      return [];
    }
  }

  startScheduledSync(): void {
    // Run every hour
    cron.schedule('0 * * * *', async () => {
      logger.info('Starting scheduled Amazon sync job');
      await this.syncAllUsers();
    });

    logger.info('Amazon sync job scheduled to run every hour');
  }

  stopScheduledSync(): void {
    // TODO: Implement job stopping mechanism
    logger.info('Amazon sync job stopped');
  }
}

export const amazonSyncJob = new AmazonSyncJob();
export default amazonSyncJob; 