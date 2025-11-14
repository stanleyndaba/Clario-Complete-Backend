/**
 * Phase 2 Sync Orchestrator
 * Coordinates all Phase 2 sync operations with retry logic and rate limiting
 */

import logger from '../utils/logger';
import { AmazonSyncJob } from './amazonSyncJob';
import ordersService from '../services/ordersService';
import shipmentsService from '../services/shipmentsService';
import returnsService from '../services/returnsService';
import settlementsService from '../services/settlementsService';
import { logAuditEvent } from '../security/auditLogger';

export interface SyncResult {
  success: boolean;
  dataType: string;
  count: number;
  error?: string;
  duration: number;
}

export interface Phase2SyncSummary {
  syncId: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  results: SyncResult[];
  totalDuration: number;
  success: boolean;
}

export class Phase2SyncOrchestrator {
  private syncJob: AmazonSyncJob;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 5000; // 5 seconds
  private readonly RATE_LIMIT_DELAY_MS = 2000; // 2 seconds between API calls

  constructor() {
    this.syncJob = new AmazonSyncJob();
  }

  /**
   * Execute full Phase 2 sync for a user
   */
  async executeFullSync(userId: string): Promise<Phase2SyncSummary> {
    const syncId = `phase2_sync_${userId}_${Date.now()}`;
    const startTime = new Date();
    const results: SyncResult[] = [];

    logger.info('Starting Phase 2 full sync', { userId, syncId });

    try {
      // 1. Sync Inventory (existing)
      const inventoryResult = await this.syncWithRetry(
        'inventory',
        async () => {
          const result = await this.syncJob.syncUserData(userId);
          return { count: 0, syncId: result.syncId }; // Count will be updated from logs
        }
      );
      results.push(inventoryResult);

      // 2. Sync Orders
      await this.delay(this.RATE_LIMIT_DELAY_MS);
      const ordersResult = await this.syncWithRetry(
        'orders',
        async () => {
          const result = await ordersService.fetchOrders(userId);
          const normalized = result.data || [];
          await ordersService.saveOrdersToDatabase(userId, normalized);
          return { count: normalized.length };
        }
      );
      results.push(ordersResult);

      // 3. Sync Shipments
      await this.delay(this.RATE_LIMIT_DELAY_MS);
      const shipmentsResult = await this.syncWithRetry(
        'shipments',
        async () => {
          const result = await shipmentsService.fetchShipments(userId);
          const shipments = result.data || [];
          if (shipments.length > 0) {
            const normalized = shipmentsService.normalizeShipments(shipments, userId);
            await shipmentsService.saveShipmentsToDatabase(userId, normalized);
            return { count: normalized.length };
          }
          return { count: 0 };
        }
      );
      results.push(shipmentsResult);

      // 4. Sync Returns
      await this.delay(this.RATE_LIMIT_DELAY_MS);
      const returnsResult = await this.syncWithRetry(
        'returns',
        async () => {
          const result = await returnsService.fetchReturns(userId);
          const returns = result.data || [];
          if (returns.length > 0) {
            const normalized = returnsService.normalizeReturns(returns, userId);
            await returnsService.saveReturnsToDatabase(userId, normalized);
            return { count: normalized.length };
          }
          return { count: 0 };
        }
      );
      results.push(returnsResult);

      // 5. Sync Settlements
      await this.delay(this.RATE_LIMIT_DELAY_MS);
      const settlementsResult = await this.syncWithRetry(
        'settlements',
        async () => {
          const result = await settlementsService.fetchSettlements(userId);
          const settlements = result.data || [];
          if (settlements.length > 0) {
            const normalized = settlementsService.normalizeSettlements(settlements, userId);
            await settlementsService.saveSettlementsToDatabase(userId, normalized);
            return { count: normalized.length };
          }
          return { count: 0 };
        }
      );
      results.push(settlementsResult);

      const endTime = new Date();
      const totalDuration = endTime.getTime() - startTime.getTime();
      const success = results.every(r => r.success);

      const summary: Phase2SyncSummary = {
        syncId,
        userId,
        startTime,
        endTime,
        results,
        totalDuration,
        success
      };

      logger.info('Phase 2 full sync completed', {
        userId,
        syncId,
        success,
        totalDuration: `${totalDuration}ms`,
        results: results.map(r => `${r.dataType}: ${r.count}`)
      });

      await logAuditEvent({
        event_type: 'phase2_sync_completed',
        user_id: userId,
        metadata: {
          syncId,
          success,
          totalDuration,
          results: results.map(r => ({ type: r.dataType, count: r.count, success: r.success }))
        },
        severity: success ? 'low' : 'high'
      });

      return summary;
    } catch (error: any) {
      const endTime = new Date();
      const totalDuration = endTime.getTime() - startTime.getTime();

      logger.error('Phase 2 full sync failed', {
        userId,
        syncId,
        error: error.message,
        totalDuration: `${totalDuration}ms`
      });

      await logAuditEvent({
        event_type: 'phase2_sync_failed',
        user_id: userId,
        metadata: {
          syncId,
          error: error.message,
          totalDuration
        },
        severity: 'high'
      });

      return {
        syncId,
        userId,
        startTime,
        endTime,
        results,
        totalDuration,
        success: false
      };
    }
  }

  /**
   * Sync with retry logic
   */
  private async syncWithRetry(
    dataType: string,
    syncFn: () => Promise<{ count: number; syncId?: string }>
  ): Promise<SyncResult> {
    let lastError: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        logger.info(`Syncing ${dataType} (attempt ${attempt}/${this.MAX_RETRIES})`);
        const result = await syncFn();
        const duration = Date.now() - startTime;

        return {
          success: true,
          dataType,
          count: result.count,
          duration
        };
      } catch (error: any) {
        lastError = error;
        logger.warn(`${dataType} sync failed (attempt ${attempt}/${this.MAX_RETRIES})`, {
          error: error.message,
          attempt
        });

        if (attempt < this.MAX_RETRIES) {
          await this.delay(this.RETRY_DELAY_MS * attempt); // Exponential backoff
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      success: false,
      dataType,
      count: 0,
      error: lastError?.message || 'Unknown error',
      duration
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new Phase2SyncOrchestrator();

