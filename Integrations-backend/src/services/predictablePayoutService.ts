import axios from 'axios';
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface PayoutPrediction {
  expectedPaidDate: string;
  expectedAmount: number;
  confidence: number;
}

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export const predictablePayoutService = {
  async estimate(disputeId: string, userId: string): Promise<PayoutPrediction> {
    try {
      // Load dispute timeline
      const { data: dispute, error } = await supabase
        .from('dispute_cases')
        .select('id, created_at, submission_date, resolution_date, resolution_amount, marketplace_id, status')
        .eq('id', disputeId)
        .eq('seller_id', userId)
        .single();
      if (error || !dispute) throw new Error('Dispute not found');

      const detectionDate = new Date(dispute.created_at);
      const submissionDate = dispute.submission_date ? new Date(dispute.submission_date) : undefined as any;
      const approvalDate = dispute.resolution_date ? new Date(dispute.resolution_date) : undefined as any;

      // Historical lag stats (simple sample from this user's recent disputes)
      const { data: history } = await supabase
        .from('dispute_cases')
        .select('created_at, submission_date, resolution_date, resolution_amount')
        .eq('seller_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      const lagsDetectionToSubmission = (history || [])
        .filter(r => r.submission_date)
        .map(r => (new Date(r.submission_date as any).getTime() - new Date(r.created_at).getTime()) / (24*3600*1000));
      const lagsSubmissionToApproval = (history || [])
        .filter(r => r.submission_date && r.resolution_date)
        .map(r => (new Date(r.resolution_date as any).getTime() - new Date(r.submission_date as any).getTime()) / (24*3600*1000));
      const avgDetToSub = average(lagsDetectionToSubmission) || 2;
      const avgSubToAppr = average(lagsSubmissionToApproval) || 5;

      // SP-API recent events to infer amounts and posting cadence
      let spAmountHint: number | undefined;
      let spPostedDate: string | undefined;
      try {
        const spUrl = process.env['SP_API_EVENTS_URL'];
        const spKey = process.env['SP_API_KEY'];
        const spSecret = process.env['SP_API_SECRET'];
        if (spUrl && spKey && spSecret) {
          const resp = await axios.get(`${spUrl}/financial-events`, {
            params: { userId, disputeId },
            headers: { 'X-Api-Key': spKey, 'X-Api-Secret': spSecret },
            timeout: 10000
          });
          const events = resp.data?.events || [];
          const matched = events.find((e: any) => e.disputeId === disputeId || e.claimId === disputeId) || events[0];
          if (matched) {
            spAmountHint = Number(matched.amount) || undefined;
            spPostedDate = matched.postedDate || matched.paidDate;
          }
        }
      } catch (e) {
        logger.warn('SP-API events fetch failed in predictor', { error: e instanceof Error ? e.message : String(e) });
      }

      // Marketplace cadence (fallback 7 days) – can be configured per marketplace via env or table
      const cadenceDays = Number(process.env['DEFAULT_SETTLEMENT_CADENCE_DAYS'] || '7');

      // Compute expected timeline
      const baseSubmission = submissionDate || new Date(detectionDate.getTime() + avgDetToSub * 24*3600*1000);
      const baseApproval = approvalDate || new Date(baseSubmission.getTime() + avgSubToAppr * 24*3600*1000);
      const expectedPaidDate = spPostedDate ? new Date(spPostedDate) : new Date(baseApproval.getTime() + cadenceDays * 24*3600*1000);

      // Expected amount: prefer SP hint, else resolution amount, else simple heuristic
      const expectedAmount = spAmountHint ?? dispute.resolution_amount ?? 0;

      // Confidence: more data -> higher confidence
      let confidence = 0.5;
      if (spPostedDate && spAmountHint !== undefined) confidence = 0.9;
      else if (approvalDate && dispute.resolution_amount) confidence = 0.75;
      else if (submissionDate) confidence = 0.6;

      const result: PayoutPrediction = {
        expectedPaidDate: expectedPaidDate.toISOString(),
        expectedAmount: Number(expectedAmount.toFixed(2)),
        confidence
      };

      // Best-effort persistence to DB if columns exist (no-op if schema lacks fields)
      try {
        await supabase
          .from('dispute_cases')
          .update({
            // These columns may not exist yet; update will be ignored/fail silently below
            expected_paid_date: result.expectedPaidDate,
            expected_amount: result.expectedAmount,
            confidence: result.confidence
          } as any)
          .eq('id', disputeId)
          .eq('seller_id', userId);
      } catch (e) {
        logger.warn('predictablePayoutService: could not persist prediction (schema may lack columns)', {
          disputeId,
          userId,
          error: e instanceof Error ? e.message : String(e)
        });
      }

      return result;
    } catch (error) {
      logger.error('predictablePayoutService.estimate failed', { error, disputeId, userId });
      // Conservative fallback
      const fallbackDate = new Date(Date.now() + 7*24*3600*1000).toISOString();
      return { expectedPaidDate: fallbackDate, expectedAmount: 0, confidence: 0.5 };
    }
  }
};

export default predictablePayoutService;

