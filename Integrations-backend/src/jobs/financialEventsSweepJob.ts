import cron from 'node-cron';
import logger from '../utils/logger';
import amazonService from '../services/amazonService';
import { FinancialEvent, financialEventsService } from '../services/financialEventsService';
import tokenManager from '../utils/tokenManager';

export class FinancialEventsSweepJob {
  private isRunning = false;

  startScheduledSweep(): void {
    // Run every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      logger.info('Starting scheduled Financial Events sweep');
      await this.sweepAllUsers();
    });
    logger.info('Financial Events sweep scheduled to run every 6 hours');
  }

  async sweepAllUsers(): Promise<void> {
    if (this.isRunning) {
      logger.info('Financial Events sweep already running, skipping');
      return;
    }
    this.isRunning = true;
    try {
      const users = await this.getUsersWithAmazonIntegration();
      for (const userId of users) {
        try {
          const connected = await tokenManager.isTokenValid(userId, 'amazon');
          if (!connected) continue;
          await this.sweepUser(userId);
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          logger.warn('Financial sweep failed for user', { userId, error: (e as any)?.message });
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async sweepUser(userId: string): Promise<void> {
    logger.info('Sweeping financial events for user', { userId });
    // Reimbursements
    try {
      const reimb = await amazonService.getRealFbaReimbursements(userId);
      await this.ingest(userId, reimb, 'reimbursement');
    } catch (e) {
      logger.warn('Sweep reimbursements failed', { userId, error: (e as any)?.message });
    }
    // Fee preview
    try {
      const fees = await amazonService.getRealFeeDiscrepancies(userId);
      await this.ingest(userId, fees, 'fee');
    } catch (e) {
      logger.warn('Sweep fees failed', { userId, error: (e as any)?.message });
    }
    // Shipments
    try {
      const shipments = await amazonService.getRealShipmentData(userId);
      await this.ingest(userId, shipments, 'shipment');
    } catch (e) {
      logger.warn('Sweep shipments failed', { userId, error: (e as any)?.message });
    }
    // Returns
    try {
      const returns = await amazonService.getRealReturnsData(userId);
      await this.ingest(userId, returns, 'return');
    } catch (e) {
      logger.warn('Sweep returns failed', { userId, error: (e as any)?.message });
    }
    // Removals (track as shipment-type operational events for now)
    try {
      const removals = await amazonService.getRealRemovalData(userId);
      await this.ingest(userId, removals, 'shipment');
    } catch (e) {
      logger.warn('Sweep removals failed', { userId, error: (e as any)?.message });
    }
  }

  private async ingest(userId: string, rows: any[], kind: FinancialEvent['event_type']): Promise<void> {
    const events: FinancialEvent[] = rows.map((r: any) => ({
      seller_id: userId,
      event_type: kind,
      amount: Number(r.amount || r.total_amount || r.reimbursement_amount || 0),
      currency: r.currency || 'USD',
      raw_payload: r,
      amazon_event_id: r.reimbursement_id || r.case_id || r.event_id || r.shipment_id || r.return_id || r.removal_order_id,
      amazon_order_id: r.amazon_order_id || r.order_id,
      amazon_sku: r.sku || r.seller_sku,
      event_date: r.posted_date ? new Date(r.posted_date) : new Date()
    }));
    if (events.length === 0) return;
    await financialEventsService.ingestEvents(events);
    for (const e of events) await financialEventsService.archiveToS3(e);
    logger.info('Financial events ingested (sweep)', { userId, kind, count: events.length });
  }

  private async getUsersWithAmazonIntegration(): Promise<string[]> {
    // TODO: Replace with real query
    return ['user-1'];
  }
}

export const financialEventsSweepJob = new FinancialEventsSweepJob();
export default financialEventsSweepJob;

