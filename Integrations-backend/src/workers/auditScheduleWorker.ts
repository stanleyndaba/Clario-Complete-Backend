import cron from 'node-cron';
import auditRunService from '../services/auditRunService';
import logger from '../utils/logger';

class AuditScheduleWorker {
  private cronTask: cron.ScheduledTask | null = null;
  private isRunning = false;

  start(): void {
    if (this.cronTask) {
      logger.warn('[AUDIT SCHEDULE] Worker already running');
      return;
    }

    this.cronTask = cron.schedule('*/15 * * * *', async () => {
      await this.runDueSchedules();
    }, {
      scheduled: true,
      timezone: 'UTC',
    });

    logger.info('[AUDIT SCHEDULE] Worker started');
  }

  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    logger.info('[AUDIT SCHEDULE] Worker stopped');
  }

  async runDueSchedules(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[AUDIT SCHEDULE] Previous run still in progress, skipping');
      return;
    }

    this.isRunning = true;
    try {
      const result = await auditRunService.processDueSchedules();
      if (result.processed > 0) {
        logger.info('[AUDIT SCHEDULE] Processed scheduled audits', result);
      }
    } catch (error: any) {
      logger.error('[AUDIT SCHEDULE] Worker run failed', { error: error?.message });
    } finally {
      this.isRunning = false;
    }
  }
}

const auditScheduleWorker = new AuditScheduleWorker();
export default auditScheduleWorker;
