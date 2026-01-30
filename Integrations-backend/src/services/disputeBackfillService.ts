import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface DetectionForDispute {
  id: string;
  seller_id: string;
  estimated_value?: number | null;
  currency?: string | null;
  severity?: string | null;
  confidence_score?: number | null;
  anomaly_type?: string | null;
  created_at?: string | null;
  sync_id?: string | null;
  store_id?: string | null;
}

type DisputeCaseRow = {
  id: string;
  detection_result_id: string;
  seller_id: string;
  status: string;
  claim_amount: number | null;
  currency: string | null;
  resolution_date?: string | null;
  case_number?: string | null;
  created_at?: string | null;
};

const CASE_PREFIX = 'CASE';
const DEFAULT_CURRENCY = 'USD';

const normalizeCurrency = (currency?: string | null) =>
  currency ? currency.toUpperCase() : DEFAULT_CURRENCY;

const sanitizeSegment = (value?: string | null) =>
  value ? value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : '';

const deriveCaseNumber = (detection: DetectionForDispute, index: number) => {
  const syncPart = sanitizeSegment(detection.sync_id)?.slice(-6) || 'SYNC';
  const idPart = detection.id ? detection.id.replace(/-/g, '').slice(0, 8).toUpperCase() : `DET${index}`;
  return `${CASE_PREFIX}-${syncPart}-${idPart}`;
};

const deriveCaseStatus = (detection: DetectionForDispute): 'approved' | 'submitted' | 'pending' => {
  const confidence = detection.confidence_score ?? 0;
  const severity = (detection.severity || '').toLowerCase();
  if (confidence >= 0.88 || severity === 'critical' || severity === 'high') {
    return 'approved';
  }
  if (confidence >= 0.72 || severity === 'medium') {
    return 'submitted';
  }
  return 'pending';
};

const deriveCaseType = (anomalyType?: string | null) => {
  const type = (anomalyType || '').toLowerCase();
  if (type.includes('fee')) return 'fee_dispute';
  if (type.includes('shipment')) return 'shipment_discrepancy';
  if (type.includes('inventory')) return 'inventory_adjustment';
  return 'amazon_fba';
};

const toIsoOrNull = (value?: string | null) => {
  if (!value) return null;
  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
};

const addDays = (isoDate: string, days: number) => {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

export async function upsertDisputesAndRecoveriesFromDetections(
  detections: DetectionForDispute[]
): Promise<void> {
  if (!detections?.length) return;

  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    logger.warn('[DISPUTE BACKFILL] Supabase admin client unavailable, skipping dispute creation');
    return;
  }

  const nowIso = new Date().toISOString();
  const disputePayload = detections.map((detection, index) => {
    const claimAmount = Number(detection.estimated_value ?? 0);
    const status = deriveCaseStatus(detection);
    const detectionIso = toIsoOrNull(detection.created_at) || nowIso;
    const submissionDate = status === 'pending' ? null : detectionIso;
    const isApproved = status === 'approved';
    const resolutionDate = isApproved ? submissionDate : null;
    const actualPayout = isApproved ? claimAmount : null;
    const expectedPayoutDate = (() => {
      if (isApproved && resolutionDate) return resolutionDate;
      const baseDate = submissionDate || detectionIso;
      const leadDays = status === 'submitted' ? 5 : 10;
      return addDays(baseDate || nowIso, leadDays);
    })();

    return {
      seller_id: detection.seller_id,
      store_id: detection.store_id || null,
      detection_result_id: detection.id,
      case_number: deriveCaseNumber(detection, index),
      status,
      claim_amount: claimAmount,
      currency: normalizeCurrency(detection.currency),
      case_type: deriveCaseType(detection.anomaly_type),
      provider: 'amazon',
      submission_date: submissionDate,
      resolution_date: resolutionDate,
      resolution_amount: actualPayout,
      expected_payout_date: expectedPayoutDate,
      recovery_status: isApproved ? 'reconciled' : 'pending',
      actual_payout_amount: actualPayout,
      reconciled_at: isApproved ? resolutionDate : null,
      created_at: detectionIso,
      updated_at: nowIso
    };
  });

  // Insert dispute cases - handle duplicates gracefully by inserting one by one if needed
  let disputes: any[] = [];

  // Try batch insert first
  const { data: batchResult, error: batchError } = await supabaseAdmin
    .from('dispute_cases')
    .insert(disputePayload)
    .select('id, detection_result_id, seller_id, store_id, status, claim_amount, currency, resolution_date, case_number, created_at');

  if (batchError) {
    // If batch fails (likely duplicates), try inserting one by one
    if (batchError.message?.includes('duplicate') || batchError.message?.includes('unique')) {
      logger.warn('⚠️ [DISPUTE BACKFILL] Batch insert failed, trying individual inserts', {
        error: batchError.message
      });

      for (const dispute of disputePayload) {
        try {
          const { data: single, error: singleError } = await supabaseAdmin
            .from('dispute_cases')
            .insert(dispute)
            .select('id, detection_result_id, seller_id, store_id, status, claim_amount, currency, resolution_date, case_number, created_at')
            .single();

          if (single && !singleError) {
            disputes.push(single);
          }
        } catch (e) {
          // Skip duplicates silently
        }
      }
    } else {
      logger.error('❌ [DISPUTE BACKFILL] Failed to insert dispute cases', { error: batchError.message });
      throw batchError;
    }
  } else if (batchResult) {
    disputes = batchResult;
  }

  if (!disputes?.length) return;

  const approvedDisputes = disputes.filter((dispute) => (dispute.status || '').toLowerCase() === 'approved');
  if (!approvedDisputes.length) return;

  const { data: existingRecoveries, error: existingError } = await supabaseAdmin
    .from('recoveries')
    .select('dispute_id')
    .in(
      'dispute_id',
      approvedDisputes.map((dispute) => dispute.id)
    );

  if (existingError) {
    logger.warn('⚠️ [DISPUTE BACKFILL] Failed to read existing recoveries', { error: existingError.message });
  }

  const existingIds: Set<string> = new Set((existingRecoveries || []).map((row: any) => row.dispute_id));
  const recoveriesPayload = buildRecoveryPayload(approvedDisputes, existingIds);
  if (!recoveriesPayload.length) return;

  const { error: recoveryError } = await supabaseAdmin
    .from('recoveries')
    .insert(recoveriesPayload);

  if (recoveryError) {
    logger.error('❌ [DISPUTE BACKFILL] Failed to insert recoveries', { error: recoveryError.message });
    throw recoveryError;
  }
}

const buildRecoveryPayload = (disputes: DisputeCaseRow[], existingIds: Set<string>) => {
  const nowIso = new Date().toISOString();
  return disputes
    .filter((dispute) => !existingIds.has(dispute.id))
    .map((dispute) => {
      const payoutDate = dispute.resolution_date || dispute.created_at || nowIso;
      const amount = Number(dispute.claim_amount ?? 0);
      return {
        dispute_id: dispute.id,
        user_id: dispute.seller_id,
        store_id: dispute.store_id || null,
        expected_amount: amount,
        actual_amount: amount,
        discrepancy: 0,
        discrepancy_type: null,
        reconciliation_status: 'reconciled',
        payout_date: payoutDate,
        amazon_case_id: dispute.case_number,
        matched_at: payoutDate,
        reconciled_at: payoutDate,
        created_at: dispute.created_at || payoutDate,
        updated_at: nowIso
      };
    });
};

