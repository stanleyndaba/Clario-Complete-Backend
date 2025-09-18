import Stripe from 'stripe';
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2023-10-16',
});

const MAX_RETRIES = 3;
const BASE_DELAY = 1000; // ms

export async function createSilentConnectAccount(userId: string, email: string): Promise<string> {
  let attempt = 0;
  let lastError: any = null;
  while (attempt < MAX_RETRIES) {
    try {
      logger.info('Creating Stripe Connect account (silent onboarding)', { userId });
      const account = await stripe.accounts.create({
        type: 'express',
        email,
        metadata: { user_id: userId },
      }, { idempotencyKey: `acct_create_${userId}` });
      // Store in DB
      const { error } = await supabase
        .from('stripe_accounts')
        .upsert({
          user_id: userId,
          stripe_account_id: account.id,
        }, { onConflict: 'user_id' });
      if (error) {
        logger.error('Failed to store Stripe account in DB', { userId, error: error.message });
        throw new Error('Failed to store Stripe account in DB');
      }
      logger.info('Stripe Connect account created and stored', { userId, stripeAccountId: account.id });
      return account.id;
    } catch (err: any) {
      lastError = err;
      logger.error('Stripe Connect onboarding failed', { userId, attempt, error: err.message });
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(res => setTimeout(res, BASE_DELAY * Math.pow(2, attempt)));
      }
      attempt++;
    }
  }
  throw lastError;
}

export async function getStripeAccountStatus(userId: string): Promise<'created' | 'not_found'> {
  const { data, error } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id')
    .eq('user_id', userId)
    .single();
  if (error || !data) return 'not_found';
  return 'created';
}

export async function getStripeAccountId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return data.stripe_account_id;
}