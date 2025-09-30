import { getRedisClient } from '../utils/redisClient';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';

// Skip Redis-dependent workers when Redis is disabled
if (process.env.DISABLE_REDIS === 'true') {
  console.log('Redis disabled - skipping DisputeSubmissionWorker');
  export const disputeSubmissionWorker = {
    start: () => console.log('DisputeSubmissionWorker disabled - Redis not available'),
    stop: () => console.log('DisputeSubmissionWorker disabled - Redis not available')
  };
} else {
  // Original worker code here...

const QUEUE_KEY = 'pending_disputes_queue';

export class DisputeSubmissionWorker {
  private running = false;

  async enqueue(disputeId: string) {
    const redis = await getRedisClient();
    await redis.lpush(QUEUE_KEY, disputeId);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop() { this.running = false; }

  private async loop() {
    const redis = await getRedisClient();
    while (this.running) {
      try {
        const res = await redis.brpop(QUEUE_KEY, 5);
        if (!res) { continue; }
        const disputeId = res.element as string;

        // Load dispute details
        const { data: dispute, error } = await supabase
          .from('dispute_cases')
          .select('*')
          .eq('id', disputeId)
          .single();
        if (error || !dispute) {
          logger.warn('Dispute not found for submission', { disputeId });
          continue;
        }

        // Mark submitting
        await supabase.from('dispute_cases').update({ submission_status: 'submitting', submitted_at: new Date().toISOString() }).eq('id', disputeId);

        // TODO: Submit via SP-API or headless automation. Stub follows.
        await new Promise(r => setTimeout(r, 1000));

        // Mark submitted
        await supabase.from('dispute_cases').update({ submission_status: 'submitted' }).eq('id', disputeId);
        logger.info('Dispute submitted', { disputeId });
      } catch (e) {
        logger.error('Dispute submission error', { error: e instanceof Error ? e.message : e });
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

export const disputeSubmissionWorker = new DisputeSubmissionWorker();
export default disputeSubmissionWorker;

