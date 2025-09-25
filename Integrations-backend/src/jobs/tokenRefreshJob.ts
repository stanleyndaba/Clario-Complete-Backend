import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import amazonService from '../services/amazonService';

const REFRESH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const INTERVAL_MS = 5 * 60 * 1000; // run every 5 minutes

export class TokenRefreshJob {
  private intervalId: NodeJS.Timeout | null = null;

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.run().catch((e) => logger.error('TokenRefreshJob run failed', { error: (e as any)?.message }));
    }, INTERVAL_MS);
    logger.info('TokenRefreshJob started', { intervalMs: INTERVAL_MS });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('TokenRefreshJob stopped');
    }
  }

  async run(): Promise<void> {
    try {
      const threshold = new Date(Date.now() + REFRESH_WINDOW_MS).toISOString();
      const { data: tokens, error } = await supabase
        .from('tokens')
        .select('user_id, provider, expires_at')
        .lte('expires_at', threshold);
      if (error) {
        logger.warn('Failed querying tokens for refresh', { error: error.message });
        return;
      }
      if (!tokens || tokens.length === 0) return;

      for (const t of tokens) {
        if (t.provider !== 'amazon') continue;
        try {
          await amazonService.refreshAccessToken(t.user_id);
          logger.info('Refreshed token for user', { userId: t.user_id, provider: t.provider });
        } catch (e) {
          logger.warn('Token refresh failed for user', { userId: t.user_id, error: (e as any)?.message });
        }
      }
    } catch (e) {
      logger.error('TokenRefreshJob unexpected error', { error: (e as any)?.message });
    }
  }
}

export const tokenRefreshJob = new TokenRefreshJob();
export default tokenRefreshJob;

