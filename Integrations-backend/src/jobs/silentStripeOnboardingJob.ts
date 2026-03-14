import { Queue, Worker, Job } from 'bullmq';
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { createSilentConnectAccount } from '../services/stripeOnboardingService';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  const errorMsg = '❌ [FATAL] [STRIPE ONBOARDING] REDIS_URL is not configured.';
  logger.error(errorMsg);
  throw new Error(errorMsg);
}

let redisConnection: any;
try {
  const parsed = new URL(redisUrl);
  redisConnection = {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 6379,
    ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
    maxRetriesPerRequest: null,
    ...(parsed.protocol === 'rediss:' && {
      tls: {
                rejectUnauthorized: false
            }
        })
    };
} catch (error: any) {
    logger.error('[STRIPE ONBOARDING] Failed to parse REDIS_URL', { error: error.message });
    throw error;
}

export const silentStripeOnboardingQueue = new Queue('silent-stripe-onboarding', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  }
});

new Worker('silent-stripe-onboarding', async (job: Job) => {
  const { userId } = job.data;
  try {
    // Fetch user email
    const { data: user, error } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();
    if (error || !user) {
      logger.error('Silent Stripe onboarding: user not found', { userId });
      throw new Error('User not found for Stripe onboarding');
    }
    // Create Stripe Connect account
    await createSilentConnectAccount(userId, user.email);
    logger.info('Silent Stripe onboarding: Stripe account created', { userId });
  } catch (err: any) {
    logger.error('Silent Stripe onboarding job failed', { userId, error: err.message });
    // Optional: notify admin on repeated failures (could integrate notifications service)
    throw err;
  }
}, { connection: redisConnection });

