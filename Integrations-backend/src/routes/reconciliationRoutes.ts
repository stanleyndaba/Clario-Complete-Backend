import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { recoveryReconciliationService } from '../services/recoveryReconciliationService';
import { accountingIntelligenceService, AccountingProvider } from '../services/accountingIntelligenceService';
import { supabaseAdmin, supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { systemSignalService } from '../notifications/services/system_signal_service';

const router = Router();

function isAccountingProvider(value: unknown): value is AccountingProvider {
  return value === 'quickbooks' || value === 'xero';
}

function tenantIdFrom(req: any): string | null {
  return req.tenant?.tenantId || req.tenantId || null;
}

async function persistUnavailableReconciliation(input: {
  tenantId: string;
  recoveryId: string;
  provider: AccountingProvider;
  expectedAmount: number;
  currency: string;
  reason: string;
}): Promise<void> {
  const db = supabaseAdmin || supabase;
  const { error } = await db.from('recovery_reconciliations').upsert({
    tenant_id: input.tenantId,
    recovery_id: input.recoveryId,
    provider: input.provider,
    status: 'ACCOUNTING_EVIDENCE_UNAVAILABLE',
    evidence_state: 'unavailable',
    expected_amount: input.expectedAmount,
    matched_amount: null,
    difference: null,
    currency: input.currency,
    confidence_score: 0,
    match_reasons: [input.reason],
    transaction_date: null,
    reconciled_at: new Date().toISOString()
  }, { onConflict: 'recovery_id,provider' });
  if (error) throw new Error(`RECONCILIATION_UNAVAILABLE_PERSIST_FAILED:${error.message}`);
}

// POST /api/recoveries/:recoveryId/reconcile
router.post('/:recoveryId/reconcile', authenticateToken, async (req: any, res) => {
  try {
    const recoveryId = String(req.params.recoveryId || '').trim();
    const userId = req.userId || req.user?.id;
    const tenantId = tenantIdFrom(req);
    const provider = String(req.query.provider || '').trim();
    if (!tenantId || !userId) return res.status(403).json({ success: false, error: 'Active workspace identity is required.' });
    if (!isAccountingProvider(provider)) return res.status(400).json({ success: false, error: 'provider must be quickbooks or xero' });

    const db = supabaseAdmin || supabase;
    const { data: recovery, error: recoveryError } = await db
      .from('dispute_cases')
      .select('*')
      .eq('id', recoveryId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (recoveryError || !recovery) return res.status(404).json({ success: false, error: 'Recovery case not found or access denied' });

    const expectedAmountCandidate = recovery.claim_amount ?? recovery.amount ?? null;
    const expectedAmount = expectedAmountCandidate === null || expectedAmountCandidate === undefined || expectedAmountCandidate === ''
      ? null
      : Number(expectedAmountCandidate);
    const expectedCurrency = recovery.currency || 'USD';
    const expectedDate = recovery.created_at ? new Date(recovery.created_at) : null;
    const expectedReference = recovery.case_id || recovery.reference || null;
    if (expectedAmount === null || !Number.isFinite(expectedAmount)) {
      return res.status(422).json({
        success: false,
        error: 'expected_amount_unavailable',
        message: 'Accounting reconciliation cannot proceed because the recovery expected amount is unavailable.',
        data: { expected_amount: null, currency: expectedCurrency, reconciliation_status: 'unavailable' }
      });
    }

    // Canonical-only boundary: no provider API call, no token lookup, no fallback.
    const evidence = await accountingIntelligenceService.getCanonicalArtifacts(tenantId, provider, userId);
    if (evidence.state === 'unavailable') {
      await persistUnavailableReconciliation({
        tenantId,
        recoveryId,
        provider,
        expectedAmount,
        currency: expectedCurrency,
        reason: evidence.reason || 'ACCOUNTING_EVIDENCE_UNAVAILABLE'
      });
      await systemSignalService.accept({
        tenantId,
        recipientUserId: userId,
        eventType: 'reconciliation.processing_paused',
        objectType: 'recovery',
        objectId: recoveryId,
        businessTransitionKey: `${provider}:evidence_unavailable:${evidence.reason || 'unknown'}`,
        providerState: 'provider_outage',
        privateTitle: 'Accounting evidence is unavailable',
        privateBody: 'Margin did not treat this provider issue as an unmatched recovery. Reconnect or sync the accounting source before retrying.',
        payload: { provider, reconciliation_status: 'ACCOUNTING_EVIDENCE_UNAVAILABLE', evidence_state: 'unavailable' }
      });
      return res.status(424).json({
        success: false,
        error: 'ACCOUNTING_EVIDENCE_UNAVAILABLE',
        message: 'Canonical accounting evidence is unavailable; no business matching was performed.',
        data: { provider, evidence_state: 'unavailable', reason: evidence.reason || 'ACCOUNTING_EVIDENCE_UNAVAILABLE' }
      });
    }

    const result = recoveryReconciliationService.reconcileArtifacts(
      expectedAmount,
      expectedCurrency,
      expectedDate,
      expectedReference,
      evidence.artifacts
    );

    let accountingEvidenceId: string | null = null;
    if (result.accountingRecordId) {
      const { data: linkedEvidence } = await db
        .from('accounting_evidence')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('accounting_record_id', result.accountingRecordId)
        .limit(1)
        .maybeSingle();
      accountingEvidenceId = linkedEvidence?.id || null;
    }

    const evidenceState = evidence.state === 'no_data' ? 'no_data' : result.status === 'NEEDS_REVIEW' ? 'needs_review' : 'available';
    const { error: persistError } = await db.from('recovery_reconciliations').upsert({
      tenant_id: tenantId,
      recovery_id: recoveryId,
      provider,
      provider_record_id: result.providerRecordId,
      accounting_record_id: result.accountingRecordId,
      accounting_evidence_id: accountingEvidenceId,
      evidence_state: evidenceState,
      status: result.status,
      expected_amount: result.expectedAmount,
      matched_amount: result.matchedAmount,
      difference: result.difference,
      currency: result.currency,
      confidence_score: result.confidenceScore,
      match_reasons: result.matchReasons,
      transaction_date: result.transactionDate ? result.transactionDate.toISOString() : null,
      reconciled_at: new Date().toISOString()
    }, { onConflict: 'recovery_id,provider' });
    if (persistError) throw new Error(`RECONCILIATION_PERSIST_FAILED:${persistError.message}`);

    const eventByStatus = {
      RECONCILED: 'reconciliation.completed',
      PARTIAL_MATCH: 'reconciliation.partial_match',
      NEEDS_REVIEW: 'reconciliation.review_required',
      UNMATCHED: 'reconciliation.unmatched'
    } as const;
    const eventType = eventByStatus[result.status];
    await systemSignalService.accept({
      tenantId,
      recipientUserId: userId,
      eventType,
      objectType: 'recovery',
      objectId: recoveryId,
      businessTransitionKey: `${provider}:${result.status}:${result.providerRecordId || 'no_record'}`,
      causationId: result.accountingRecordId || undefined,
      payload: {
        provider,
        reconciliation_status: result.status,
        evidence_state: evidenceState,
        accounting_record_id: result.accountingRecordId,
        accounting_evidence_id: accountingEvidenceId
      }
    });

    return res.json({ success: true, data: { ...result, evidenceState, accountingEvidenceId } });
  } catch (error: any) {
    logger.error('Error in canonical reconciliation endpoint', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: 'Internal server error during reconciliation' });
  }
});

// GET /api/recoveries/:recoveryId/reconciliation
router.get('/:recoveryId/reconciliation', authenticateToken, async (req: any, res) => {
  try {
    const recoveryId = String(req.params.recoveryId || '').trim();
    const tenantId = tenantIdFrom(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Active workspace identity is required.' });
    const db = supabaseAdmin || supabase;

    const { data: recovery, error: recoveryError } = await db
      .from('dispute_cases')
      .select('id')
      .eq('id', recoveryId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (recoveryError || !recovery) return res.status(404).json({ success: false, error: 'Recovery case not found or access denied' });

    const { data, error } = await db
      .from('recovery_reconciliations')
      .select('*')
      .eq('recovery_id', recoveryId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !data) return res.json({ success: true, data: null, message: 'No reconciliation performed yet.' });
    return res.json({ success: true, data });
  } catch (error: any) {
    logger.error('Error fetching reconciliation', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: 'Failed to fetch reconciliation state' });
  }
});

export default router;
