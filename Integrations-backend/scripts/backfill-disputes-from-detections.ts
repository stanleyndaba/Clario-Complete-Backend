import 'dotenv/config';
import logger from '../src/utils/logger';
import { supabaseAdmin } from '../src/database/supabaseClient';
import {
  upsertDisputesAndRecoveriesFromDetections,
  DetectionForDispute
} from '../src/services/disputeBackfillService';

async function backfill() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    throw new Error('Supabase admin client is not configured. Check SUPABASE_SERVICE_ROLE_KEY.');
  }

  logger.info('[DISPUTE BACKFILL] Fetching detection results for backfill');

  const { data, error } = await supabaseAdmin
    .from('detection_results')
    .select('id, seller_id, estimated_value, currency, severity, confidence_score, anomaly_type, created_at, sync_id');

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    logger.warn('[DISPUTE BACKFILL] No detection results found to backfill');
    return;
  }

  logger.info('[DISPUTE BACKFILL] Upserting dispute and recovery records', { count: data.length });
  await upsertDisputesAndRecoveriesFromDetections(data as DetectionForDispute[]);
  logger.info('[DISPUTE BACKFILL] Completed successfully');
}

backfill()
  .then(() => {
    logger.info('[DISPUTE BACKFILL] Script finished');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('[DISPUTE BACKFILL] Script failed', { error: err?.message || err });
    process.exit(1);
  });



