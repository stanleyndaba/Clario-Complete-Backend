import 'dotenv/config';
import logger from '../src/utils/logger';
import { supabaseAdmin } from '../src/database/supabaseClient';

const addDays = (iso: string, days: number) => {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

async function backfillExpectedPayouts() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    throw new Error('Supabase admin client unavailable. Set SUPABASE_SERVICE_ROLE_KEY.');
  }

  logger.info('[EXPECTED PAYOUT BACKFILL] Fetching dispute cases missing expected_payout_date');

  const { data: disputes, error } = await supabaseAdmin
    .from('dispute_cases')
    .select('id, status, created_at, submission_date, resolution_date, expected_payout_date')
    .is('expected_payout_date', null);

  if (error) throw error;
  if (!disputes || disputes.length === 0) {
    logger.info('[EXPECTED PAYOUT BACKFILL] Nothing to update');
    return;
  }

  const updates = disputes.map((dispute) => {
    const createdAt = dispute.created_at || new Date().toISOString();
    const submission = dispute.submission_date || createdAt;
    const resolution = dispute.resolution_date || submission;

    let expected: string;
    if ((dispute.status || '').toLowerCase() === 'approved') {
      expected = resolution;
    } else if ((dispute.status || '').toLowerCase() === 'submitted') {
      expected = addDays(submission, 5);
    } else {
      expected = addDays(createdAt, 10);
    }

    return {
      id: dispute.id,
      expected_payout_date: expected
    };
  });

  logger.info('[EXPECTED PAYOUT BACKFILL] Updating records', { count: updates.length });

  for (const update of updates) {
    const { error: updateError } = await supabaseAdmin
      .from('dispute_cases')
      .update({ expected_payout_date: update.expected_payout_date })
      .eq('id', update.id);

    if (updateError) throw updateError;
  }

  logger.info('[EXPECTED PAYOUT BACKFILL] Completed successfully');
}

backfillExpectedPayouts()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('[EXPECTED PAYOUT BACKFILL] Failed', { error: err?.message || err });
    process.exit(1);
  });

