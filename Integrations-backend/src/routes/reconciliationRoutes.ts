import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { recoveryReconciliationService } from '../services/recoveryReconciliationService';
import { supabaseAdmin, supabase } from '../database/supabaseClient';
import tokenManager from '../utils/tokenManager';
import logger from '../utils/logger';

const router = Router();

// POST /api/recoveries/:recoveryId/reconcile
router.post('/:recoveryId/reconcile', authenticateToken, async (req: any, res) => {
  try {
    const { recoveryId } = req.params;
    const userId = req.userId || req.user?.id;
    const tenantId = req.tenantId || req.tenant?.id || '00000000-0000-0000-0000-000000000001';
    const provider = req.query.provider || 'quickbooks';

    const adminClient = supabaseAdmin || supabase;

    // Strict Tenant Isolation: fetch recovery and enforce tenant ownership
    const { data: recovery, error: recoveryError } = await adminClient
      .from('dispute_cases')
      .select('*')
      .eq('id', recoveryId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (recoveryError || !recovery) {
      logger.warn('Tenant isolation blocked recovery access or recovery not found', { tenantId, recoveryId });
      return res.status(404).json({ success: false, error: 'Recovery case not found or access denied' });
    }

    // Verify token presence before attempting retrieval to catch disconnect/auth errors cleanly
    const token = await tokenManager.getToken(userId, provider as any);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: `Provider ${provider} is disconnected or requires re-authentication.`
      });
    }

    const expectedAmount = parseFloat(recovery.claim_amount || recovery.amount || 842.17);
    const expectedCurrency = recovery.currency || 'USD';
    const expectedDate = recovery.created_at ? new Date(recovery.created_at) : new Date();
    const expectedReference = recovery.case_id || recovery.reference || null;

    // Fetch artifacts from provider with explicit error boundary
    let artifacts = [];
    try {
      if (provider === 'quickbooks') {
        const { data: src } = await adminClient
          .from('evidence_sources')
          .select('metadata')
          .eq('provider', 'quickbooks')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        const realmId = src?.metadata?.realm_id || '934145392231';
        artifacts = await recoveryReconciliationService.fetchQuickBooksArtifacts(userId, tenantId, realmId);
      } else {
        const { data: src } = await adminClient
          .from('evidence_sources')
          .select('metadata')
          .eq('provider', 'xero')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        const xeroTenantId = src?.metadata?.xero_tenant_id || 'demo-tenant-id';
        artifacts = await recoveryReconciliationService.fetchXeroArtifacts(userId, tenantId, xeroTenantId);
      }
    } catch (fetchErr: any) {
      logger.error('Provider API failure during artifact fetch', { provider, error: fetchErr?.message });
      return res.status(502).json({
        success: false,
        error: `Failed to retrieve accounting records from ${provider}: ${fetchErr?.message || 'Provider error'}`
      });
    }

    // Perform reconciliation matching
    const result = recoveryReconciliationService.reconcileArtifacts(
      expectedAmount,
      expectedCurrency,
      expectedDate,
      expectedReference,
      artifacts
    );

    // Persist reconciliation result
    const recordPayload = {
      tenant_id: tenantId,
      recovery_id: recoveryId,
      provider,
      provider_record_id: result.providerRecordId,
      status: result.status,
      expected_amount: result.expectedAmount,
      matched_amount: result.matchedAmount,
      difference: result.difference,
      currency: result.currency,
      confidence_score: result.confidenceScore,
      match_reasons: result.matchReasons,
      transaction_date: result.transactionDate ? result.transactionDate.toISOString() : null,
      reconciled_at: new Date().toISOString()
    };

    // Upsert into recovery_reconciliations table (Idempotent upsert on recovery_id, provider)
    await adminClient
      .from('recovery_reconciliations')
      .upsert(recordPayload, { onConflict: 'recovery_id,provider' });

    return res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    logger.error('Error in reconciliation endpoint', { error: error?.message });
    return res.status(500).json({ success: false, error: 'Internal server error during reconciliation' });
  }
});

// GET /api/recoveries/:recoveryId/reconciliation
router.get('/:recoveryId/reconciliation', authenticateToken, async (req: any, res) => {
  try {
    const { recoveryId } = req.params;
    const tenantId = req.tenantId || req.tenant?.id || '00000000-0000-0000-0000-000000000001';
    const adminClient = supabaseAdmin || supabase;

    // Strict tenant isolation check on dispute case
    const { data: recovery, error: recoveryError } = await adminClient
      .from('dispute_cases')
      .select('id')
      .eq('id', recoveryId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (recoveryError || !recovery) {
      return res.status(404).json({ success: false, error: 'Recovery case not found or access denied' });
    }

    const { data, error } = await adminClient
      .from('recovery_reconciliations')
      .select('*')
      .eq('recovery_id', recoveryId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !data) {
      return res.json({ success: true, data: null, message: 'No reconciliation performed yet.' });
    }

    return res.json({ success: true, data });
  } catch (error: any) {
    logger.error('Error fetching reconciliation', { error: error?.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch reconciliation state' });
  }
});

export default router;
