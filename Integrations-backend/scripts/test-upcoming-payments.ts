import 'dotenv/config';
import logger from '../src/utils/logger';
import { supabase, supabaseAdmin } from '../src/database/supabaseClient';

const client = supabaseAdmin || supabase;

async function testUpcomingPayments(userId: string) {
  if (!client) {
    throw new Error('Supabase client unavailable');
  }

  const { data, error } = await client
    .from('dispute_cases')
    .select('id, seller_id, claim_amount, currency, status, expected_payout_date, created_at')
    .eq('seller_id', userId)
    .in('status', ['filed', 'approved', 'pending'])
    .not('expected_payout_date', 'is', null)
    .order('expected_payout_date', { ascending: true });

  if (error) throw error;

  logger.info(`[UPCOMING PAYMENTS TEST] Found ${data?.length || 0} rows for ${userId}`);
  console.table(
    (data || []).map((row) => ({
      id: row.id,
      status: row.status,
      amount: row.claim_amount,
      expected: row.expected_payout_date,
      created: row.created_at,
    }))
  );
}

const userId = process.argv[2] || 'demo-user';

testUpcomingPayments(userId)
  .then(() => {
    logger.info('Test completed');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Test failed', { error: err?.message || err });
    process.exit(1);
  });

