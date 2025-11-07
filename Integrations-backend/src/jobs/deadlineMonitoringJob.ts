import cron from 'node-cron';
import logger from '../utils/logger';
import detectionService from '../services/detectionService';
import sseHub from '../utils/sseHub';

export class DeadlineMonitoringJob {
  private isRunning = false;
  private cronJob: cron.ScheduledTask | null = null;

  /**
   * Start the deadline monitoring job
   * Runs every hour to check for expiring claims
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Deadline monitoring job is already running');
      return;
    }

    // Run every hour
    this.cronJob = cron.schedule('0 * * * *', async () => {
      await this.checkExpiringClaims();
    });

    // Also run on startup
    this.checkExpiringClaims().catch(error => {
      logger.error('Error in initial deadline check', { error });
    });

    this.isRunning = true;
    logger.info('Deadline monitoring job started');
  }

  /**
   * Stop the deadline monitoring job
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.isRunning = false;
    logger.info('Deadline monitoring job stopped');
  }

  /**
   * Check for expiring claims and update expired ones
   */
  private async checkExpiringClaims(): Promise<void> {
    try {
      logger.info('Running deadline monitoring check');

      // Update expired claims
      const expiredCount = await detectionService.updateExpiredClaims();
      if (expiredCount > 0) {
        logger.info('Marked expired claims', { count: expiredCount });
      }

      // Get all active sellers with pending claims
      const { data: sellers, error } = await (await import('../database/supabaseClient')).supabase
        .from('detection_results')
        .select('seller_id')
        .eq('expired', false)
        .not('deadline_date', 'is', null)
        .lte('days_remaining', 7)
        .gte('days_remaining', 0)
        .in('status', ['pending', 'reviewed']);

      if (error) {
        logger.error('Error fetching sellers with expiring claims', { error });
        return;
      }

      if (!sellers || sellers.length === 0) {
        logger.info('No expiring claims found');
        return;
      }

      // Get unique seller IDs
      const uniqueSellerIds = [...new Set(sellers.map((s: any) => s.seller_id as string))];

      // Check expiring claims for each seller
      for (const sellerId of uniqueSellerIds) {
        await detectionService.checkExpiringClaims([sellerId]);
      }

      logger.info('Deadline monitoring check completed', {
        sellers_checked: uniqueSellerIds.length,
        expired_count: expiredCount
      });
    } catch (error) {
      logger.error('Error in deadline monitoring check', { error });
    }
  }
}

export const deadlineMonitoringJob = new DeadlineMonitoringJob();

