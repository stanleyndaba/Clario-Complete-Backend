import 'dotenv/config';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../src/database/supabaseClient';
import {
  calculateCalibratedConfidence,
  upsertOutcomeForDispute,
  invalidateCache
} from '../src/services/detection/confidenceCalibrator';

async function proveAgent11CalibrationLoop(): Promise<void> {
  const anomalyType = `agent11_calibration_test_${Date.now()}`;
  const rawConfidence = 0.9;

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, tenant_id, email')
    .limit(1)
    .maybeSingle();

  if (userError || !user) {
    throw new Error(`Unable to load a test user: ${userError?.message || 'no users found'}`);
  }

  const sellerId = user.id;
  const tenantId = user.tenant_id || '00000000-0000-0000-0000-000000000001';
  const createdDetectionIds: string[] = [];
  const createdDisputeIds: string[] = [];

  try {
    invalidateCache();
    const before = await calculateCalibratedConfidence(anomalyType, rawConfidence);

    console.log('\n=== BASELINE ===');
    console.log(JSON.stringify(before, null, 2));

    for (let i = 0; i < 5; i++) {
      const detectionId = randomUUID();
      const disputeId = randomUUID();
      createdDetectionIds.push(detectionId);
      createdDisputeIds.push(disputeId);

      const { error: detectionError } = await supabaseAdmin
        .from('detection_results')
        .insert({
          id: detectionId,
          tenant_id: tenantId,
          seller_id: sellerId,
          sync_id: `agent11-proof-sync-${Date.now()}-${i}`,
          anomaly_type: anomalyType,
          severity: 'medium',
          estimated_value: 100,
          currency: 'USD',
          confidence_score: rawConfidence,
          evidence: { source: 'agent11-proof', order_id: `AGENT11-PROOF-${i}` },
          status: 'pending'
        });

      if (detectionError) {
        throw new Error(`Failed to create detection result ${i}: ${detectionError.message}`);
      }

      const { error: disputeError } = await supabaseAdmin
        .from('dispute_cases')
        .insert({
          id: disputeId,
          tenant_id: tenantId,
          seller_id: sellerId,
          detection_result_id: detectionId,
          case_number: `AG11-PROOF-${i}-${Date.now()}`,
          case_type: 'amazon_fba',
          provider: 'amazon',
          claim_amount: 100,
          currency: 'USD',
          filing_status: 'filed',
          status: 'pending'
        });

      if (disputeError) {
        throw new Error(`Failed to create dispute case ${i}: ${disputeError.message}`);
      }

      const synced = await upsertOutcomeForDispute({
        dispute_id: disputeId,
        actual_outcome: 'rejected',
        recovery_amount: 0,
        amazon_case_id: `AG11-AMZ-${i}`,
        resolution_date: new Date(),
        notes: 'Agent 11 calibration proof script rejection outcome'
      });

      if (!synced) {
        throw new Error(`Failed to sync outcome for dispute ${disputeId}`);
      }
    }

    const { data: storedOutcomes, error: outcomeError } = await supabaseAdmin
      .from('detection_outcomes')
      .select('id, detection_result_id, anomaly_type, actual_outcome, recovery_amount, created_at')
      .eq('anomaly_type', anomalyType)
      .order('created_at', { ascending: true });

    if (outcomeError) {
      throw new Error(`Failed to load stored outcomes: ${outcomeError.message}`);
    }

    invalidateCache();
    const after = await calculateCalibratedConfidence(anomalyType, rawConfidence);

    console.log('\n=== STORED OUTCOMES ===');
    console.log(JSON.stringify(storedOutcomes, null, 2));

    console.log('\n=== CALIBRATED AFTER OUTCOMES ===');
    console.log(JSON.stringify(after, null, 2));

    console.log('\n=== PROOF SUMMARY ===');
    console.log(JSON.stringify({
      anomalyType,
      rawConfidence,
      storedOutcomeCount: storedOutcomes?.length || 0,
      beforeCalibratedConfidence: before.calibrated_confidence,
      afterCalibratedConfidence: after.calibrated_confidence,
      changed: before.calibrated_confidence !== after.calibrated_confidence
    }, null, 2));

  } finally {
    if (createdDisputeIds.length > 0) {
      await supabaseAdmin
        .from('dispute_cases')
        .delete()
        .in('id', createdDisputeIds);
    }

    if (createdDetectionIds.length > 0) {
      await supabaseAdmin
        .from('detection_results')
        .delete()
        .in('id', createdDetectionIds);
    }

    invalidateCache();
  }
}

proveAgent11CalibrationLoop().catch((error) => {
  console.error(error);
  process.exit(1);
});
