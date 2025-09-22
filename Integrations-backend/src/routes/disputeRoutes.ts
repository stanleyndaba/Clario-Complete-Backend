import { Router } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import enhancedDetectionService from '../services/enhancedDetectionService';
import sseHub from '../utils/sseHub';
import { withRetry } from '../utils/retry';
import { disputeSubmissionWorker } from '../jobs/disputeSubmissionWorker';
import { supabase } from '../database/supabaseClient';
import predictablePayoutService from '../services/predictablePayoutService';
import evidenceValidatorService from '../services/evidenceValidatorService';
import { smartPromptService } from '../services/smartPromptService';

const router = Router();

router.use((req, res, next) => {
  try {
    return (authenticateToken as any)(req as any, res as any, next as any);
  } catch {
    return next();
  }
});

// POST /api/v1/integrations/disputes/start
router.post('/start', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { detectionResultId } = (req.body || {}) as any;
    if (!detectionResultId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'detectionResultId is required' } });
    }

    // Fetch detection result and create dispute case
    const { data: result, error: fetchError } = await supabase
      .from('detection_results')
      .select('*')
      .eq('id', detectionResultId)
      .eq('seller_id', userId)
      .single();

    if (fetchError || !result) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Detection result not found' } });
    }

    // Evidence validation step before filing
    const candidate = { sellerId: userId, sku: (result as any).sku, asin: (result as any).asin, quantity: (result as any).quantity, detectionDate: (result as any).detected_at } as any;
    const validation = await (evidenceValidatorService as any).validate(candidate);

    let dispute: any;
    if (validation.status === 'proof_found') {
      // Create dispute, link evidence, and enqueue filing
      dispute = await (enhancedDetectionService as any).createDisputeCase(result as any);
      await supabase
        .from('dispute_evidence_links')
        .insert({ dispute_case_id: dispute.id, evidence_document_id: validation.evidenceDocumentId, relevance_score: 0.99, matched_context: { source: 'auto' } });
      await disputeSubmissionWorker.enqueue(dispute.id);
      await withRetry(async () => { sseHub.sendEvent(userId, 'dispute', { type: 'dispute', id: dispute.id, status: 'submitted', pathway: 'auto_with_evidence' }); return undefined; }, 3, 200);
      return res.json({ success: true, dispute, pathway: 'auto_with_evidence' });
    }

    if (validation.status === 'ambiguity') {
      const promptId = await (smartPromptService as any).createEvidenceSelectionPrompt(
        userId,
        null,
        `Select the correct invoice for SKU ${(result as any).sku || (result as any).asin}`,
        (validation.options || []).map((o: any, idx: number) => ({ id: String(idx + 1), label: o.label, evidence_document_id: o.evidenceDocumentId }))
      );
      await withRetry(async () => { sseHub.sendEvent(userId, 'dispute', { type: 'dispute_blocked', reason: 'evidence_ambiguity', promptId }); return undefined; }, 3, 200);
      return res.json({ success: true, next: 'await_user_selection', promptId });
    }

    await withRetry(async () => { sseHub.sendEvent(userId, 'dispute', { type: 'dispute_skipped', reason: 'no_evidence' }); return undefined; }, 3, 200);
    return res.json({ success: true, next: 'no_evidence' });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/disputes/status/:id
router.get('/status/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { id } = req.params as any;
    const { data, error } = await supabase
      .from('dispute_cases')
      .select('*')
      .eq('id', id)
      .eq('seller_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Dispute not found' } });
    }

    const prediction = await (predictablePayoutService as any).estimate(id, userId);
    const expectedAmount = (data as any).expected_amount ?? prediction.expectedAmount;
    const expectedPaidDate = (data as any).expected_paid_date ?? prediction.expectedPaidDate;
    const confidence = (data as any).confidence ?? prediction.confidence;
    return res.json({ success: true, dispute: data, amountRecovered: (data as any).resolution_amount || 0, paidDate: (data as any).resolution_date || null, expectedAmount, expectedPaidDate, confidence });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/disputes
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { data, error } = await supabase
      .from('dispute_cases')
      .select('id, detection_result_id, status, created_at, resolution_date, case_number')
      .eq('seller_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: (error as any).message } });
    }

    const disputes = (data || []).map((d: any) => ({
      disputeId: d.id,
      caseId: d.case_number,
      status: d.status,
      submittedAt: d.created_at,
      resolvedAt: d.resolution_date || null
    }));

    return res.json({ success: true, disputes });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

export default router;

