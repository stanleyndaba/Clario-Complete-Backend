import { getRedisClient } from '../utils/redisClient';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';

const QUEUE_KEY = 'pending_disputes_queue';

export class DisputeSubmissionWorker {
  private running = false;

  async enqueue(disputeId: string) {
    const redis = await getRedisClient();
    // node-redis v4 uses camelCase command methods
    await (redis as any).lPush(QUEUE_KEY, disputeId);
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
        // brPop returns [key, element] | null in v4 client wrappers
        const res = await (redis as any).brPop(QUEUE_KEY, 5);
        if (!res) { continue; }
        const disputeId = Array.isArray(res) ? (res[1] as string) : (res.element as string);

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

