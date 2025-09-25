import cron from 'node-cron';
import logger from '../utils/logger';
import amazonService from '../services/amazonService';
import { notificationService } from '../notifications/services/notification_service';
import tokenManager from '../utils/tokenManager';
// import { supabase } from '../database/supabaseClient';
import financialEventsService, { FinancialEvent } from '../services/financialEventsService';
import detectionService from '../services/detectionService';
import telemetryService from '../services/telemetryService';

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

      // Sync claims via reimbursements report
      const claims = await amazonService.fetchClaims(userId);
      await this.saveClaimsToDatabase(userId, claims);

      // Sync inventory via real SP-API summaries
      const inventory = await amazonService.fetchInventory(userId);
      await this.saveInventoryToDatabase(userId, inventory);
      await telemetryService.record({
        userId,
        streamType: 'inventory',
        marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'NA',
        lastSuccess: new Date(),
        recordsIngested: inventory.length
      });

      // Sync fees via fee preview report
      const fees = await amazonService.fetchFees(userId);
      await this.saveFeesToDatabase(userId, fees);
      
      // Ingest financial events (fees)
      await this.ingestFinancialEvents(userId, fees);

      // Ingest reimbursements as financial events
      try {
        const reimbursements = await amazonService.getRealFbaReimbursements(userId);
        await this.ingestReimbursementEvents(userId, reimbursements);
        await telemetryService.record({ userId, streamType: 'reimbursements', marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'NA', lastSuccess: new Date(), recordsIngested: reimbursements.length });
      } catch (e) {
        logger.warn('Reimbursement ingestion failed (non-fatal)', { userId, error: (e as any)?.message });
      }

      // Ingest shipments
      try {
        const shipments = await amazonService.getRealShipmentData(userId);
        await this.ingestShipmentEvents(userId, shipments);
        await telemetryService.record({ userId, streamType: 'shipments', marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'NA', lastSuccess: new Date(), recordsIngested: shipments.length });
      } catch (e) {
        logger.warn('Shipment ingestion failed (non-fatal)', { userId, error: (e as any)?.message });
      }

      // Ingest returns
      try {
        const returns = await amazonService.getRealReturnsData(userId);
        await this.ingestReturnEvents(userId, returns);
        await telemetryService.record({ userId, streamType: 'returns', marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'NA', lastSuccess: new Date(), recordsIngested: returns.length });
      } catch (e) {
        logger.warn('Returns ingestion failed (non-fatal)', { userId, error: (e as any)?.message });
      }

      // Ingest removals
      try {
        const removals = await amazonService.getRealRemovalData(userId);
        await this.ingestRemovalEvents(userId, removals);
        await telemetryService.record({ userId, streamType: 'removals', marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'NA', lastSuccess: new Date(), recordsIngested: removals.length });
      } catch (e) {
        logger.warn('Removals ingestion failed (non-fatal)', { userId, error: (e as any)?.message });
      }

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
      for (const _ of claims) {
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
      // TODO: Implement actual database save for inventory
      // This is a stub implementation
      logger.info('Saving Amazon inventory to database', { userId, count: inventory.length });
      
      // Mock database save
      for (const _ of inventory) {
        // Simulate database operation
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      logger.info('Amazon inventory saved to database', { userId, count: inventory.length });
    } catch (error) {
      logger.error('Error saving Amazon inventory to database', { error, userId });
      throw error;
    }
  }

  private async saveFeesToDatabase(userId: string, fees: any[]): Promise<void> {
    try {
      // TODO: Implement actual database save for fees
      // This is a stub implementation
      logger.info('Saving Amazon fees to database', { userId, count: fees.length });
      
      // Mock database save
      for (const _ of fees) {
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

      const financialEvents: FinancialEvent[] = fees.map((fee: any) => ({
        seller_id: userId,
        event_type: 'fee',
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
   * Ingest reimbursement events
   */
  private async ingestReimbursementEvents(userId: string, rows: any[]): Promise<void> {
    try {
      logger.info('Ingesting reimbursement events', { userId, count: rows.length });

      const events: FinancialEvent[] = rows.map((r: any) => ({
        seller_id: userId,
        event_type: 'reimbursement',
        amount: Number(r.amount || r.total_amount || r.reimbursement_amount || 0),
        currency: r.currency || 'USD',
        raw_payload: r,
        amazon_event_id: r.reimbursement_id || r.case_id,
        amazon_order_id: r.amazon_order_id || r.order_id,
        amazon_sku: r.sku || r.seller_sku,
        event_date: r.posted_date ? new Date(r.posted_date) : new Date()
      }));

      if (events.length > 0) {
        await financialEventsService.ingestEvents(events);
        for (const event of events) {
          await financialEventsService.archiveToS3(event);
        }
      }

      logger.info('Reimbursement events ingested successfully', { userId, events: events.length });
    } catch (error) {
      logger.error('Error ingesting reimbursement events', { error, userId });
    }
  }

  private async ingestShipmentEvents(userId: string, rows: any[]): Promise<void> {
    try {
      logger.info('Ingesting shipment events', { userId, count: rows.length });
      const events: FinancialEvent[] = rows.map((r: any) => ({
        seller_id: userId,
        event_type: 'shipment',
        amount: Number(r.amount || 0),
        currency: r.currency || 'USD',
        raw_payload: r,
        amazon_event_id: r.shipment_id || r.event_id,
        amazon_order_id: r.amazon_order_id || r.order_id,
        amazon_sku: r.sku || r.seller_sku,
        event_date: r.posted_date ? new Date(r.posted_date) : new Date()
      }));
      if (events.length > 0) {
        await financialEventsService.ingestEvents(events);
        for (const event of events) await financialEventsService.archiveToS3(event);
      }
    } catch (error) {
      logger.error('Error ingesting shipment events', { error, userId });
    }
  }

  private async ingestReturnEvents(userId: string, rows: any[]): Promise<void> {
    try {
      logger.info('Ingesting return events', { userId, count: rows.length });
      const events: FinancialEvent[] = rows.map((r: any) => ({
        seller_id: userId,
        event_type: 'return',
        amount: Number(r.amount || 0),
        currency: r.currency || 'USD',
        raw_payload: r,
        amazon_event_id: r.return_id || r.event_id,
        amazon_order_id: r.amazon_order_id || r.order_id,
        amazon_sku: r.sku || r.seller_sku,
        event_date: r.posted_date ? new Date(r.posted_date) : new Date()
      }));
      if (events.length > 0) {
        await financialEventsService.ingestEvents(events);
        for (const event of events) await financialEventsService.archiveToS3(event);
      }
    } catch (error) {
      logger.error('Error ingesting return events', { error, userId });
    }
  }

  private async ingestRemovalEvents(userId: string, rows: any[]): Promise<void> {
    try {
      logger.info('Ingesting removal events', { userId, count: rows.length });
      const events: FinancialEvent[] = rows.map((r: any) => ({
        seller_id: userId,
        event_type: 'shipment',
        amount: Number(r.amount || 0),
        currency: r.currency || 'USD',
        raw_payload: r,
        amazon_event_id: r.removal_order_id || r.event_id,
        amazon_order_id: r.amazon_order_id || r.order_id,
        amazon_sku: r.sku || r.seller_sku,
        event_date: r.posted_date ? new Date(r.posted_date) : new Date()
      }));
      if (events.length > 0) {
        await financialEventsService.ingestEvents(events);
        for (const event of events) await financialEventsService.archiveToS3(event);
      }
    } catch (error) {
      logger.error('Error ingesting removal events', { error, userId });
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
    // Run every 4 hours
    cron.schedule('0 */4 * * *', async () => {
      logger.info('Starting scheduled Amazon sync job');
      await this.syncAllUsers();
    });

    logger.info('Amazon sync job scheduled to run every 4 hours');
  }

  stopScheduledSync(): void {
    // TODO: Implement job stopping mechanism
    logger.info('Amazon sync job stopped');
  }
}

export const amazonSyncJob = new AmazonSyncJob();
export default amazonSyncJob; 