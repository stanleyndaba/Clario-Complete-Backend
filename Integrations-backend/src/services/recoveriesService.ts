/**
 * Recoveries Service
 * Handles payout detection, matching, and reconciliation
 * Wraps Amazon SP-API payout detection and Python reconciliation logic
 */

import axios from 'axios';
import logger from '../utils/logger';
import { resolveTenantSlug } from '../utils/tenantEventRouting';
import { supabaseAdmin } from '../database/supabaseClient';
import runtimeCapacityService from './runtimeCapacityService';
import financialWorkItemService from './financialWorkItemService';
import {
  type OperationalExplanation,
  type OperationalState,
  buildOperationalDecision
} from '../utils/operationalContinuity';

function parseJsonObject(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

export interface PayoutMatch {
  disputeId: string;
  amazonCaseId?: string;
  orderId: string;
  expectedAmount: number;
  actualAmount: number;
  discrepancy: number;
  discrepancyType: 'none' | 'underpaid' | 'overpaid';
  amazonReimbursementId?: string;
  payoutDate?: string;
  reconciliation_strategy: 'AUTO_MATCH' | 'SMART_MATCH';
  match_explanation: {
    competing_candidates: number;
    selected_basis: string;
    confidence: number;
  };
  evidenceAttachments?: Record<string, any>;
}

export interface ReconciliationResult {
  success: boolean;
  recoveryId?: string;
  status: 'reconciled' | 'discrepancy' | 'failed';
  expectedAmount: number;
  actualAmount: number;
  discrepancy: number;
  discrepancyType?: 'underpaid' | 'overpaid';
  error?: string;
  reconciliation_strategy?: 'AUTO_MATCH' | 'SMART_MATCH';
  match_explanation?: {
    competing_candidates: number;
    selected_basis: string;
    confidence: number;
  };
  operational_state?: OperationalState;
  operational_explanation?: OperationalExplanation;
}

export interface RecoveryMatchDecision {
  reconciliation_strategy: 'AUTO_MATCH' | 'SMART_MATCH' | 'QUARANTINED';
  match: PayoutMatch | null;
  match_explanation: {
    competing_candidates: number;
    selected_basis: string;
    confidence: number;
  };
  reason?: string;
  candidate_dispute_ids?: string[];
}

interface RecoveryCandidateScore {
  disputeCase: any;
  confidence: number;
  rankingScore: number;
  amountDifference: number;
  timeDistanceDays: number;
  selectedBasis: string;
}

export interface RecoveryLifecycleEvent {
  eventType: 'payout_detected' | 'matched' | 'reconciled' | 'discrepancy_detected' | 'error';
  eventData: any;
}

class RecoveriesService {
  private pythonApiUrl: string;
  private reconciliationThreshold: number = 0.01; // 1 cent threshold

  constructor() {
    this.pythonApiUrl = process.env.PYTHON_API_URL || 'https://docker-api-13.onrender.com';
    this.reconciliationThreshold = parseFloat(process.env.RECONCILIATION_THRESHOLD || '0.01');
  }

  private buildOperationalResult(
    operationalState: OperationalState,
    explanation: Partial<OperationalExplanation>,
    overrides: Partial<ReconciliationResult> = {}
  ): ReconciliationResult {
    const decision = buildOperationalDecision(operationalState, explanation);
    return {
      success: false,
      status: 'failed',
      expectedAmount: Number(overrides.expectedAmount || 0),
      actualAmount: Number(overrides.actualAmount || 0),
      discrepancy: Number(overrides.discrepancy || 0),
      ...overrides,
      operational_state: decision.operational_state,
      operational_explanation: decision.operational_explanation
    };
  }

  private async quarantineAmbiguousRecovery(
    payout: any,
    userId: string,
    tenantId: string | undefined,
    reason: string,
    candidateDisputeIds: string[] = [],
    matchExplanation?: {
      competing_candidates: number;
      selected_basis: string;
      confidence: number;
    }
  ): Promise<void> {
    runtimeCapacityService.incrementCounter('ambiguous_recoveries');
    const timestamp = new Date().toISOString();
    const quarantinePayload = {
      reconciliation_strategy: 'QUARANTINED',
      match_explanation: matchExplanation || {
        competing_candidates: candidateDisputeIds.length,
        selected_basis: 'quarantine',
        confidence: 0
      },
      quarantine_state: 'ambiguous_recovery',
      quarantine_reason: reason,
      tenant_id: tenantId || null,
      payout_id: payout.id || null,
      amazon_reimbursement_id: payout.amazonReimbursementId || null,
      amazon_case_id: payout.amazonCaseId || payout.metadata?.amazon_case_id || payout.metadata?.case_id || null,
      reference_id: payout.referenceId || null,
      settlement_id: payout.settlementId || null,
      payout_batch_id: payout.payoutBatchId || null,
      order_id: payout.orderId || null,
      amount: payout.amount || null,
      candidate_dispute_ids: candidateDisputeIds
    };

    if (candidateDisputeIds.length > 0) {
      await supabaseAdmin
        .from('dispute_cases')
        .update({
          recovery_status: 'quarantined',
          last_error: reason,
          updated_at: new Date().toISOString()
        })
        .in('id', candidateDisputeIds);

      if (tenantId) {
        const tenantSlug = await resolveTenantSlug(tenantId);
        for (const disputeId of candidateDisputeIds) {
          const { item } = await financialWorkItemService.enqueueRecoveryWork({
            tenantId,
            tenantSlug,
            userId,
            disputeCaseId: disputeId,
            sourceEventType: 'recovery.quarantined',
            sourceEventId: String(payout.id || disputeId),
            payload: quarantinePayload
          });

          await financialWorkItemService.quarantine('recovery', item.id, reason, {
            ...(item.payload || {}),
            ...quarantinePayload
          });
        }
      }
    }

    try {
      await supabaseAdmin
        .from('recovery_lifecycle_logs')
        .insert({
          recovery_id: null,
          dispute_id: null,
          user_id: userId,
          event_type: 'error',
          event_data: {
            ...quarantinePayload,
            reason,
            quarantined_at: timestamp
          }
        });
    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to log ambiguous recovery quarantine', {
        payoutId: payout.id,
        reason,
        error: error.message
      });
    }
  }

  private toAmount(value: any): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private normalizeToken(value: any): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().toLowerCase();
    return normalized || null;
  }

  private parseDate(value: any): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private getExpectedAmount(disputeCase: any): number {
    return this.toAmount(disputeCase?.approved_amount) || this.toAmount(disputeCase?.claim_amount);
  }

  private buildMatchExplanation(
    competingCandidates: number,
    selectedBasis: string,
    confidence: number
  ): {
    competing_candidates: number;
    selected_basis: string;
    confidence: number;
  } {
    return {
      competing_candidates: competingCandidates,
      selected_basis: selectedBasis,
      confidence: Number(confidence.toFixed(2))
    };
  }

  private getCaseDates(disputeCase: any): Date[] {
    const evidence = parseJsonObject(disputeCase?.detection_results?.evidence);
    const attachments = parseJsonObject(disputeCase?.evidence_attachments);

    const candidates = [
      disputeCase?.resolution_date,
      disputeCase?.updated_at,
      disputeCase?.created_at,
      evidence?.approved_at,
      evidence?.reimbursement_date,
      evidence?.shipment_date,
      evidence?.order_date,
      evidence?.delivery_date,
      attachments?.approved_at,
      attachments?.reimbursement_date,
      attachments?.shipment_date,
      attachments?.order_date
    ]
      .map((value) => this.parseDate(value))
      .filter((value): value is Date => Boolean(value));

    return candidates;
  }

  private computeTimeProximity(disputeCase: any, payout: any): { score: number; days: number } {
    const payoutDate = this.parseDate(
      payout?.payoutDate ||
      payout?.postedAt ||
      payout?.posted_at ||
      payout?.eventDate ||
      payout?.created_at
    );

    if (!payoutDate) {
      return { score: 0, days: Number.MAX_SAFE_INTEGER };
    }

    const dayDistances = this.getCaseDates(disputeCase)
      .map((caseDate) => Math.abs(payoutDate.getTime() - caseDate.getTime()) / (1000 * 60 * 60 * 24));

    if (dayDistances.length === 0) {
      return { score: 0, days: Number.MAX_SAFE_INTEGER };
    }

    const closestDays = Math.min(...dayDistances);
    if (closestDays <= 7) return { score: 0.5, days: closestDays };
    if (closestDays <= 14) return { score: 0.4, days: closestDays };
    if (closestDays <= 30) return { score: 0.3, days: closestDays };
    if (closestDays <= 60) return { score: 0.15, days: closestDays };
    return { score: 0, days: closestDays };
  }

  private computeAmountCloseness(expectedAmount: number, actualAmount: number, tolerance: number): number {
    if (expectedAmount <= 0 || actualAmount <= 0 || tolerance <= 0) {
      return 0;
    }

    const difference = Math.abs(expectedAmount - actualAmount);
    if (difference > tolerance) {
      return 0;
    }

    return Math.max(0, 1 - (difference / tolerance));
  }

  private scoreCandidate(
    disputeCase: any,
    payout: any,
    basis: 'order_amount' | 'sku_asin_amount' | 'amount_time_fallback'
  ): RecoveryCandidateScore {
    const evidence = parseJsonObject(disputeCase?.detection_results?.evidence);
    const expectedAmount = this.getExpectedAmount(disputeCase);
    const actualAmount = this.toAmount(payout?.amount);
    const amountDifference = Math.abs(expectedAmount - actualAmount);
    const { score: timeScore, days } = this.computeTimeProximity(disputeCase, payout);

    let rankingScore = 0;
    let maxScore = 1;
    let selectedBasis: string = basis;

    if (basis === 'order_amount') {
      const tolerance = Math.max(expectedAmount * 0.05, 1.0);
      const amountCloseness = this.computeAmountCloseness(expectedAmount, actualAmount, tolerance);
      rankingScore = 0.8 + (amountCloseness * 0.1) + timeScore;
      maxScore = 1.4;
      selectedBasis = 'order_id_amount_time_ranked';
    } else if (basis === 'sku_asin_amount') {
      const tolerance = Math.max(expectedAmount * 0.1, 2.0);
      const amountCloseness = this.computeAmountCloseness(expectedAmount, actualAmount, tolerance);
      const skuMatches = this.normalizeToken(evidence?.sku) && this.normalizeToken(evidence?.sku) === this.normalizeToken(payout?.sku);
      const asinMatches = this.normalizeToken(evidence?.asin) && this.normalizeToken(evidence?.asin) === this.normalizeToken(payout?.asin);
      const identifierScore = skuMatches && asinMatches ? 0.75 : 0.6;
      rankingScore = identifierScore + (amountCloseness * 0.15) + timeScore;
      maxScore = 1.4;
      selectedBasis = skuMatches && asinMatches ? 'sku_and_asin_amount_time_ranked' : 'sku_or_asin_amount_time_ranked';
    } else {
      const tolerance = Math.max(expectedAmount * 0.05, 1.0);
      const amountCloseness = this.computeAmountCloseness(expectedAmount, actualAmount, tolerance);
      rankingScore = 0.55 + (amountCloseness * 0.2) + timeScore;
      maxScore = 1.25;
      selectedBasis = 'strict_amount_time_ranked';
    }

    return {
      disputeCase,
      confidence: Number(Math.min(1, rankingScore / maxScore).toFixed(2)),
      rankingScore,
      amountDifference,
      timeDistanceDays: Number.isFinite(days) ? days : Number.MAX_SAFE_INTEGER,
      selectedBasis
    };
  }

  private buildDecision(
    reconciliationStrategy: 'AUTO_MATCH' | 'SMART_MATCH' | 'QUARANTINED',
    explanation: {
      competing_candidates: number;
      selected_basis: string;
      confidence: number;
    },
    match: PayoutMatch | null,
    reason?: string,
    candidateDisputeIds: string[] = []
  ): RecoveryMatchDecision {
    return {
      reconciliation_strategy: reconciliationStrategy,
      match,
      match_explanation: explanation,
      reason,
      candidate_dispute_ids: candidateDisputeIds
    };
  }

  private async hasConflictingFinancialSignal(
    payout: any,
    selectedDisputeId: string,
    tenantId?: string
  ): Promise<boolean> {
    const reimbursementId = payout?.amazonReimbursementId || payout?.id;
    if (reimbursementId) {
      let reimbursementQuery = supabaseAdmin
        .from('recoveries')
        .select('id, dispute_id')
        .eq('amazon_reimbursement_id', reimbursementId)
        .neq('dispute_id', selectedDisputeId)
        .limit(1);

      if (tenantId) {
        reimbursementQuery = reimbursementQuery.eq('tenant_id', tenantId);
      }

      const { data: reimbursementConflict, error } = await reimbursementQuery.maybeSingle();
      if (!error && reimbursementConflict) {
        return true;
      }
    }

    const amazonCaseId = payout?.amazonCaseId || payout?.metadata?.amazon_case_id || payout?.metadata?.case_id;
    if (amazonCaseId) {
      let caseQuery = supabaseAdmin
        .from('recoveries')
        .select('id, dispute_id')
        .eq('amazon_case_id', amazonCaseId)
        .neq('dispute_id', selectedDisputeId)
        .limit(1);

      if (tenantId) {
        caseQuery = caseQuery.eq('tenant_id', tenantId);
      }

      const { data: caseConflict, error } = await caseQuery.maybeSingle();
      if (!error && caseConflict) {
        return true;
      }
    }

    return false;
  }

  private async resolveUniqueMatch(
    disputeCase: any,
    payout: any,
    userId: string,
    tenantId: string | undefined,
    selectedBasis: string
  ): Promise<RecoveryMatchDecision> {
    const conflict = await this.hasConflictingFinancialSignal(payout, disputeCase.id, tenantId);
    const explanation = this.buildMatchExplanation(1, selectedBasis, 1.0);

    if (conflict) {
      await this.quarantineAmbiguousRecovery(
        payout,
        userId,
        tenantId,
        'payout_conflicts_with_existing_recovery_signal',
        [disputeCase.id],
        explanation
      );
      return this.buildDecision('QUARANTINED', explanation, null, 'payout_conflicts_with_existing_recovery_signal', [disputeCase.id]);
    }

    return this.buildDecision(
      'AUTO_MATCH',
      explanation,
      this.createMatch(disputeCase, payout, 'AUTO_MATCH', explanation)
    );
  }

  private async resolveRankedCandidateSet(params: {
    payout: any;
    userId: string;
    tenantId?: string;
    candidates: any[];
    basis: 'order_amount' | 'sku_asin_amount' | 'amount_time_fallback';
    quarantineReason: string;
  }): Promise<RecoveryMatchDecision> {
    const { payout, userId, tenantId, candidates, basis, quarantineReason } = params;
    const scored = candidates
      .map((candidate) => this.scoreCandidate(candidate, payout, basis))
      .sort((left, right) => {
        if (right.confidence !== left.confidence) return right.confidence - left.confidence;
        if (right.rankingScore !== left.rankingScore) return right.rankingScore - left.rankingScore;
        if (left.amountDifference !== right.amountDifference) return left.amountDifference - right.amountDifference;
        return left.timeDistanceDays - right.timeDistanceDays;
      });

    const best = scored[0];
    const explanation = this.buildMatchExplanation(
      scored.length,
      best?.selectedBasis || `${basis}_ranked`,
      best?.confidence || 0
    );
    const candidateIds = scored.map((candidate) => candidate.disputeCase.id);

    if (!best || best.confidence < 0.75) {
      await this.quarantineAmbiguousRecovery(
        payout,
        userId,
        tenantId,
        quarantineReason,
        candidateIds,
        explanation
      );
      return this.buildDecision('QUARANTINED', explanation, null, quarantineReason, candidateIds);
    }

    const conflict = await this.hasConflictingFinancialSignal(payout, best.disputeCase.id, tenantId);
    if (conflict) {
      await this.quarantineAmbiguousRecovery(
        payout,
        userId,
        tenantId,
        'payout_conflicts_with_existing_recovery_signal',
        candidateIds,
        explanation
      );
      return this.buildDecision('QUARANTINED', explanation, null, 'payout_conflicts_with_existing_recovery_signal', candidateIds);
    }

    return this.buildDecision(
      'SMART_MATCH',
      explanation,
      this.createMatch(best.disputeCase, payout, 'SMART_MATCH', explanation)
    );
  }

  private async findExistingRecovery(
    match: PayoutMatch,
    tenantId?: string
  ): Promise<any | null> {
    const tenantScopedId = tenantId || null;

    if (match.amazonReimbursementId) {
      let reimbursementQuery = supabaseAdmin
        .from('recoveries')
        .select('*')
        .eq('amazon_reimbursement_id', match.amazonReimbursementId)
        .is('deleted_at', null)
        .limit(1);

      if (tenantScopedId) {
        reimbursementQuery = reimbursementQuery.eq('tenant_id', tenantScopedId);
      }

      const { data, error } = await reimbursementQuery.maybeSingle();
      if (error) {
        throw new Error(`Failed to lookup existing reimbursement recovery: ${error.message}`);
      }
      if (data) {
        return data;
      }
    }

    let disputeQuery = supabaseAdmin
      .from('recoveries')
      .select('*')
      .eq('dispute_id', match.disputeId)
      .is('deleted_at', null)
      .limit(1);

    if (tenantScopedId) {
      disputeQuery = disputeQuery.eq('tenant_id', tenantScopedId);
    }

    const { data: disputeRecovery, error: disputeError } = await disputeQuery.maybeSingle();
    if (disputeError) {
      throw new Error(`Failed to lookup existing dispute recovery: ${disputeError.message}`);
    }

    return disputeRecovery || null;
  }

  private async compensateRecoveryPartialWrite(
    recoveryId: string,
    disputeId: string,
    reason: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    await supabaseAdmin
      .from('recoveries')
      .update({
        reconciliation_status: 'failed',
        reconciled_at: null,
        updated_at: timestamp
      })
      .eq('id', recoveryId);

    await this.logLifecycleEvent(recoveryId, disputeId, 'system', {
      eventType: 'error',
      eventData: {
        reason,
        compensated: true,
        timestamp
      }
    });
  }

  /**
   * Detect payouts from Amazon SP-API for a user
   */
  async detectPayouts(userId: string, startDate?: Date, endDate?: Date, tenantId?: string, storeId?: string): Promise<any[]> {
    try {
      logger.info('🔍 [RECOVERIES] Detecting payouts from Amazon', {
        userId,
        tenantId,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString()
      });

      // Fetch financial events from SP-API (reimbursements)
      const query = supabaseAdmin
        .from('financial_events')
        .select('*')
        .eq('seller_id', userId);

      if (tenantId) {
        query.eq('tenant_id', tenantId);
      }

      if (storeId) {
        query.eq('store_id', storeId);
      }

      const { data: financialEvents, error } = await query
        .in('event_type', ['reimbursement', 'Reimbursement'])
        .gte('event_date', startDate?.toISOString() || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .lte('event_date', endDate?.toISOString() || new Date().toISOString())
        .order('event_date', { ascending: false })
        .limit(100);

      if (error) {
        logger.error('❌ [RECOVERIES] Failed to fetch financial events', {
          userId,
          error: error.message
        });
        return [];
      }

      // Transform financial events to payout format
      const payouts = (financialEvents || []).map((event: any) => ({
        id: event.id,
        amazonReimbursementId: event.amazon_event_id,
        referenceId: event.reference_id,
        orderId: event.amazon_order_id,
        amount: this.extractPayoutAmount(event),
        currency: event.currency || 'USD',
        status: 'paid',
        payoutDate: event.event_date,
        settlementId: event.settlement_id || null,
        payoutBatchId: event.payout_batch_id || null,
        sku: event.amazon_sku || event.raw_payload?.SellerSKU || event.raw_payload?.seller_sku,
        asin: event.raw_payload?.ASIN || event.raw_payload?.asin,
        metadata: event.raw_payload || {}
      })).filter((event: any) => event.amount > 0);

      logger.info('[Agent8] payout events loaded', {
        userId,
        tenantId,
        financialEventRows: financialEvents?.length || 0,
        usablePayouts: payouts.length
      });

      if (payouts.length > 0) {
        logger.info('✅ [RECOVERIES] Using reimbursement events from database', {
          userId,
          tenantId,
          usablePayouts: payouts.length
        });
        return payouts;
      }

      // Only fall back to Amazon Service when the database does not already contain payout truth.
      try {
        const { default: amazonService } = await import('./amazonService');
        const claims = await amazonService.fetchClaims(userId, startDate, endDate);

        // Filter for approved/reimbursed claims
        const amazonPayouts = (claims || []).filter((claim: any) =>
          claim.status === 'approved' || claim.status === 'paid'
        );

        logger.info('✅ [RECOVERIES] Detected payouts', {
          userId,
          count: amazonPayouts.length,
          fromFinancialEvents: financialEvents?.length || 0,
          fromAmazonService: amazonPayouts.length
        });

        return amazonPayouts;

      } catch (error: any) {
        logger.warn('⚠️ [RECOVERIES] Could not fetch from Amazon Service, using database only', {
          userId,
          error: error.message
        });
      }

      return payouts;

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to detect payouts', {
        userId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Match payout to a claim/dispute case
   */
  async matchPayoutToClaim(payout: any, userId: string, tenantId?: string): Promise<RecoveryMatchDecision> {
    try {
      logger.info('🔗 [RECOVERIES] Matching payout to claim', {
        userId,
        tenantId,
        payoutId: payout.id,
        orderId: payout.orderId,
        amount: payout.amount
      });

      // Try to match by provider_case_id first (most reliable)
      // Check if payout has amazonCaseId or if we can extract it from metadata
      const amazonCaseId = payout.amazonCaseId || payout.metadata?.amazon_case_id || payout.metadata?.case_id;

      if (amazonCaseId) {
        let caseQuery = supabaseAdmin
          .from('dispute_cases')
          .select(`
            id, seller_id, claim_amount, approved_amount, currency, status, provider_case_id, evidence_attachments,
            created_at, updated_at, resolution_date,
            detection_result_id,
            detection_results (evidence)
          `)
          .eq('seller_id', userId)
          .eq('provider_case_id', amazonCaseId)
          .eq('status', 'approved');

        if (tenantId) {
          caseQuery = caseQuery.eq('tenant_id', tenantId);
        }

        const { data: disputeCase } = await caseQuery.single();

        if (disputeCase) {
          return await this.resolveUniqueMatch(disputeCase, payout, userId, tenantId, 'amazon_case_id_exact');
        }
      }

      // Try to match by amount (fuzzy match) - order_id is in detection_results.evidence
      // Get all approved cases and filter by order_id from evidence JSONB
      let disputeCasesQuery = supabaseAdmin
        .from('dispute_cases')
        .select(`
          id, seller_id, claim_amount, approved_amount, currency, status, provider_case_id, evidence_attachments,
          created_at, updated_at, resolution_date,
          detection_result_id,
          detection_results (evidence)
        `)
        .eq('seller_id', userId)
        .eq('status', 'approved')
        .limit(50);

      if (tenantId) {
        disputeCasesQuery = disputeCasesQuery.eq('tenant_id', tenantId);
      }

      const { data: disputeCases } = await disputeCasesQuery;

      const approvedCases = disputeCases || [];

      if (payout.amazonReimbursementId && approvedCases.length > 0) {
        const reimbursementMatches = approvedCases.filter((disputeCase: any) => {
          const evidence = parseJsonObject(disputeCase.detection_results?.evidence);
          const reimbursementId =
            evidence.amazon_reimbursement_id ||
            evidence.reimbursement_id ||
            evidence.amazon_event_id ||
            null;

          return reimbursementId && reimbursementId === payout.amazonReimbursementId;
        });

        if (reimbursementMatches.length === 1) {
          return await this.resolveUniqueMatch(reimbursementMatches[0], payout, userId, tenantId, 'reimbursement_id_exact');
        }

        if (reimbursementMatches.length > 1) {
          const explanation = this.buildMatchExplanation(
            reimbursementMatches.length,
            'reimbursement_id_exact_conflict',
            1.0
          );
          await this.quarantineAmbiguousRecovery(
            payout,
            userId,
            tenantId,
            'multiple_cases_share_reimbursement_identifier',
            reimbursementMatches.map((candidate: any) => candidate.id),
            explanation
          );
          return this.buildDecision(
            'QUARANTINED',
            explanation,
            null,
            'multiple_cases_share_reimbursement_identifier',
            reimbursementMatches.map((candidate: any) => candidate.id)
          );
        }
      }

      if (payout.referenceId && approvedCases.length > 0) {
        const referenceMatches = approvedCases.filter((disputeCase: any) => {
          const evidence = parseJsonObject(disputeCase.detection_results?.evidence);
          const caseEvidence = parseJsonObject(disputeCase.evidence_attachments);
          const referenceIds = [
            evidence.reference_id,
            evidence.amazon_reference_id,
            evidence.reimbursement_reference_id,
            caseEvidence.reference_id,
            caseEvidence.amazon_reference_id,
            caseEvidence.reimbursement_reference_id
          ].filter(Boolean);
          return referenceIds.includes(payout.referenceId);
        });

        if (referenceMatches.length === 1) {
          return await this.resolveUniqueMatch(referenceMatches[0], payout, userId, tenantId, 'reference_id_exact');
        }

        if (referenceMatches.length > 1) {
          const explanation = this.buildMatchExplanation(
            referenceMatches.length,
            'reference_id_exact_conflict',
            0.9
          );
          await this.quarantineAmbiguousRecovery(
            payout,
            userId,
            tenantId,
            'multiple_cases_share_reference_identifier',
            referenceMatches.map((candidate: any) => candidate.id),
            explanation
          );
          return this.buildDecision(
            'QUARANTINED',
            explanation,
            null,
            'multiple_cases_share_reference_identifier',
            referenceMatches.map((candidate: any) => candidate.id)
          );
        }
      }

      if ((payout.settlementId || payout.payoutBatchId) && approvedCases.length > 0) {
        const settlementMatches = approvedCases.filter((disputeCase: any) => {
          const evidence = parseJsonObject(disputeCase.detection_results?.evidence);
          const caseEvidence = parseJsonObject(disputeCase.evidence_attachments);
          const settlementIds = [
            evidence.settlement_id,
            evidence.payout_batch_id,
            caseEvidence.settlement_id,
            caseEvidence.payout_batch_id
          ].filter(Boolean);
          return settlementIds.includes(payout.settlementId) || settlementIds.includes(payout.payoutBatchId);
        });

        if (settlementMatches.length === 1) {
          return await this.resolveUniqueMatch(settlementMatches[0], payout, userId, tenantId, 'settlement_or_batch_id_exact');
        }

        if (settlementMatches.length > 1) {
          const explanation = this.buildMatchExplanation(
            settlementMatches.length,
            'settlement_or_batch_id_exact_conflict',
            0.9
          );
          await this.quarantineAmbiguousRecovery(
            payout,
            userId,
            tenantId,
            'multiple_cases_share_settlement_or_batch_identifier',
            settlementMatches.map((candidate: any) => candidate.id),
            explanation
          );
          return this.buildDecision(
            'QUARANTINED',
            explanation,
            null,
            'multiple_cases_share_settlement_or_batch_identifier',
            settlementMatches.map((candidate: any) => candidate.id)
          );
        }
      }

      if (approvedCases.length > 0 && (payout.metadata?.dispute_case_id || payout.metadata?.amazon_case_id || payout.metadata?.case_id)) {
        const explicitMatches = approvedCases.filter((disputeCase: any) =>
          payout.metadata?.dispute_case_id === disputeCase.id ||
          payout.metadata?.amazon_case_id === disputeCase.provider_case_id ||
          payout.metadata?.case_id === disputeCase.provider_case_id
        );

        if (explicitMatches.length === 1) {
          return await this.resolveUniqueMatch(explicitMatches[0], payout, userId, tenantId, 'explicit_case_link_exact');
        }

        if (explicitMatches.length > 1) {
          const explanation = this.buildMatchExplanation(
            explicitMatches.length,
            'explicit_case_link_exact_conflict',
            0.95
          );
          await this.quarantineAmbiguousRecovery(
            payout,
            userId,
            tenantId,
            'multiple_cases_share_explicit_case_link_metadata',
            explicitMatches.map((candidate: any) => candidate.id),
            explanation
          );
          return this.buildDecision(
            'QUARANTINED',
            explanation,
            null,
            'multiple_cases_share_explicit_case_link_metadata',
            explicitMatches.map((candidate: any) => candidate.id)
          );
        }
      }

      if (approvedCases.length > 0 && payout.orderId) {
        const matchingCases = approvedCases.filter((dc: any) => {
          const evidence = parseJsonObject(dc.detection_results?.evidence);
          return evidence.order_id === payout.orderId;
        });

        const closeMatches = matchingCases.filter((disputeCase: any) => {
          const expectedAmount = this.getExpectedAmount(disputeCase);
          const actualAmount = this.toAmount(payout.amount);
          const difference = Math.abs(expectedAmount - actualAmount);
          return difference <= Math.max(expectedAmount * 0.05, 1.00);
        });

        if (closeMatches.length === 1) {
          return this.buildDecision(
            'SMART_MATCH',
            this.buildMatchExplanation(1, 'order_id_amount_time_ranked', 0.88),
            this.createMatch(
              closeMatches[0],
              payout,
              'SMART_MATCH',
              this.buildMatchExplanation(1, 'order_id_amount_time_ranked', 0.88)
            )
          );
        }

        if (closeMatches.length > 1) {
          return await this.resolveRankedCandidateSet({
            payout,
            userId,
            tenantId,
            candidates: closeMatches,
            basis: 'order_amount',
            quarantineReason: 'multiple_cases_share_order_and_amount_match'
          });
        }
      }

      if ((payout.sku || payout.asin) && approvedCases.length > 0) {
        const matchingCases = approvedCases.filter((dc: any) => {
          const evidence = parseJsonObject(dc.detection_results?.evidence);
          return evidence.sku === payout.sku || evidence.asin === payout.asin;
        });

        const closeMatches = matchingCases.filter((disputeCase: any) => {
          const expectedAmount = this.getExpectedAmount(disputeCase);
          const actualAmount = this.toAmount(payout.amount);
          const difference = Math.abs(expectedAmount - actualAmount);
          return difference <= Math.max(expectedAmount * 0.10, 2.00);
        });

        if (closeMatches.length === 1) {
          return await this.resolveRankedCandidateSet({
            payout,
            userId,
            tenantId,
            candidates: closeMatches,
            basis: 'sku_asin_amount',
            quarantineReason: 'sku_or_asin_fuzzy_match_requires_manual_resolution'
          });
        }

        if (closeMatches.length > 1) {
          return await this.resolveRankedCandidateSet({
            payout,
            userId,
            tenantId,
            candidates: closeMatches,
            basis: 'sku_asin_amount',
            quarantineReason: 'sku_or_asin_fuzzy_match_requires_manual_resolution'
          });
        }
      }

      if (approvedCases.length > 0) {
        const candidates = approvedCases
          .map((disputeCase: any) => {
            const expectedAmount = this.getExpectedAmount(disputeCase);
            const difference = Math.abs(expectedAmount - this.toAmount(payout.amount));
            const threshold = Math.max(expectedAmount * 0.05, 1.00);
            return {
              disputeCase,
              expectedAmount,
              difference,
              threshold
            };
          })
          .filter((candidate: any) => candidate.expectedAmount > 0 && candidate.difference <= candidate.threshold)
          .sort((a: any, b: any) => a.difference - b.difference);

        if (candidates.length === 1) {
          return await this.resolveRankedCandidateSet({
            payout,
            userId,
            tenantId,
            candidates: [candidates[0].disputeCase],
            basis: 'amount_time_fallback',
            quarantineReason: 'strict_amount_fallback_requires_manual_resolution'
          });
        }

        if (candidates.length > 1) {
          return await this.resolveRankedCandidateSet({
            payout,
            userId,
            tenantId,
            candidates: candidates.map((candidate: any) => candidate.disputeCase),
            basis: 'amount_time_fallback',
            quarantineReason: 'strict_amount_fallback_requires_manual_resolution'
          });
        }
      }

      logger.warn('⚠️ [RECOVERIES] No matching claim found for payout', {
        userId,
        tenantId,
        payoutId: payout.id,
        orderId: payout.orderId,
        amount: payout.amount
      });

      const explanation = this.buildMatchExplanation(0, 'no_candidate_match', 0);
      await this.quarantineAmbiguousRecovery(
        payout,
        userId,
        tenantId,
        'no_case_match_found_for_payout',
        [],
        explanation
      );
      return this.buildDecision('QUARANTINED', explanation, null, 'no_case_match_found_for_payout');

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to match payout to claim', {
        userId,
        payoutId: payout.id,
        error: error.message
      });
      const explanation = this.buildMatchExplanation(0, 'match_error', 0);
      await this.quarantineAmbiguousRecovery(
        payout,
        userId,
        tenantId,
        'recovery_match_engine_error',
        [],
        explanation
      );
      return this.buildDecision('QUARANTINED', explanation, null, 'recovery_match_engine_error');
    }
  }

  /**
   * Create a payout match from dispute case and payout
   */
  private createMatch(
    disputeCase: any,
    payout: any,
    reconciliationStrategy: 'AUTO_MATCH' | 'SMART_MATCH',
    matchExplanation: {
      competing_candidates: number;
      selected_basis: string;
      confidence: number;
    }
  ): PayoutMatch {
    const expectedAmount = this.getExpectedAmount(disputeCase);
    const actualAmount = this.toAmount(payout.amount);
    const discrepancy = Math.abs(expectedAmount - actualAmount);

    let discrepancyType: 'none' | 'underpaid' | 'overpaid' = 'none';
    if (discrepancy > this.reconciliationThreshold) {
      discrepancyType = actualAmount < expectedAmount ? 'underpaid' : 'overpaid';
    }

    // Extract order_id from detection_results.evidence JSONB
    const evidence = parseJsonObject(disputeCase.detection_results?.evidence);
    const orderId = evidence.order_id || '';

    return {
      disputeId: disputeCase.id,
      amazonCaseId: disputeCase.provider_case_id,
      orderId: orderId,
      expectedAmount,
      actualAmount,
      discrepancy,
      discrepancyType,
      amazonReimbursementId: payout.amazonReimbursementId || payout.id,
      payoutDate: payout.payoutDate || new Date().toISOString(),
      reconciliation_strategy: reconciliationStrategy,
      match_explanation: matchExplanation,
      evidenceAttachments: parseJsonObject(disputeCase.evidence_attachments)
    };
  }

  /**
   * Reconcile payout with expected claim amount
   */
  async reconcilePayout(match: PayoutMatch, userId: string, tenantId?: string): Promise<ReconciliationResult> {
    try {
      logger.info('💰 [RECOVERIES] Reconciling payout', {
        userId,
        tenantId,
        disputeId: match.disputeId,
        expectedAmount: match.expectedAmount,
        actualAmount: match.actualAmount,
        discrepancy: match.discrepancy,
        reconciliationStrategy: match.reconciliation_strategy
      });

      // Determine reconciliation status
      let status: 'reconciled' | 'discrepancy' | 'failed' = 'reconciled';
      if (match.discrepancy > this.reconciliationThreshold) {
        status = 'discrepancy';
      }

      const timestamp = new Date().toISOString();
      const recoveryPayload = {
        dispute_id: match.disputeId,
        user_id: userId,
        tenant_id: tenantId,
        amazon_case_id: match.amazonCaseId,
        expected_amount: match.expectedAmount,
        actual_amount: match.actualAmount,
        discrepancy: match.discrepancy,
        discrepancy_type: match.discrepancyType === 'none' ? null : match.discrepancyType,
        reconciliation_status: status,
        payout_date: match.payoutDate,
        amazon_reimbursement_id: match.amazonReimbursementId,
        matched_at: timestamp,
        reconciled_at: status === 'reconciled' ? timestamp : null
      };

      let recovery = await this.findExistingRecovery(match, tenantId);
      if (recovery?.id) {
        const { data: updatedRecovery, error: updateRecoveryError } = await supabaseAdmin
          .from('recoveries')
          .update({
            ...recoveryPayload,
            updated_at: timestamp
          })
          .eq('id', recovery.id)
          .select()
          .single();

        if (updateRecoveryError || !updatedRecovery) {
          logger.error('❌ [RECOVERIES] Failed to reuse existing recovery record', {
            disputeId: match.disputeId,
            recoveryId: recovery.id,
            error: updateRecoveryError?.message
          });
          return {
            success: false,
            status: 'failed',
            expectedAmount: match.expectedAmount,
            actualAmount: match.actualAmount,
            discrepancy: match.discrepancy,
            error: updateRecoveryError?.message || 'Failed to update existing recovery record'
          };
        }
        recovery = updatedRecovery;
      } else {
        const { data: insertedRecovery, error: insertError } = await supabaseAdmin
          .from('recoveries')
          .insert(recoveryPayload)
          .select()
          .single();

        if (insertError) {
          if ((insertError as any).code === '23505') {
            runtimeCapacityService.incrementCounter('duplicate_recovery_conflicts');
            recovery = await this.findExistingRecovery(match, tenantId);
          }

          if (!recovery?.id) {
            logger.error('❌ [RECOVERIES] Failed to store recovery record', {
              disputeId: match.disputeId,
              error: insertError.message
            });
            return {
              success: false,
              status: 'failed',
              expectedAmount: match.expectedAmount,
              actualAmount: match.actualAmount,
              discrepancy: match.discrepancy,
              error: insertError.message
            };
          }
        } else {
          recovery = insertedRecovery;
        }
      }

      try {
        await this.logLifecycleEvent(recovery.id, match.disputeId, userId, {
          eventType: 'matched',
          eventData: {
            reconciliation_strategy: match.reconciliation_strategy,
            match_explanation: match.match_explanation,
            amazon_reimbursement_id: match.amazonReimbursementId || null,
            amazon_case_id: match.amazonCaseId || null
          }
        });

        await this.logLifecycleEvent(recovery.id, match.disputeId, userId, {
          eventType: status === 'reconciled' ? 'reconciled' : 'discrepancy_detected',
          eventData: {
            expectedAmount: match.expectedAmount,
            actualAmount: match.actualAmount,
            discrepancy: match.discrepancy,
            discrepancyType: match.discrepancyType,
            status,
            reconciliation_strategy: match.reconciliation_strategy,
            match_explanation: match.match_explanation
          }
        });
      } catch (lifecycleError: any) {
        const compensationReason = `Recovery lifecycle log failed after recovery persistence: ${lifecycleError.message}`;
        logger.error('❌ [RECOVERIES] Recovery lifecycle logging failed after persistence', {
          disputeId: match.disputeId,
          recoveryId: recovery.id,
          error: lifecycleError.message
        });
        await this.compensateRecoveryPartialWrite(recovery.id, match.disputeId, compensationReason);
        return {
          success: false,
          status: 'failed',
          expectedAmount: match.expectedAmount,
          actualAmount: match.actualAmount,
          discrepancy: match.discrepancy,
          error: compensationReason
        };
      }

      const evidenceAttachments = parseJsonObject(match.evidenceAttachments);
      const decisionIntelligence = parseJsonObject(evidenceAttachments?.decision_intelligence);

      // Update dispute case
      let disputeUpdateQuery = supabaseAdmin
        .from('dispute_cases')
        .update({
          recovery_status: status === 'reconciled' ? 'reconciled' : 'discrepancy',
          reconciled_at: status === 'reconciled' ? new Date().toISOString() : null,
          approved_amount: match.expectedAmount,
          actual_payout_amount: match.actualAmount,
          recovered_amount: match.actualAmount,
          // 🎯 AGENT 9 INTEGRATION: Set billing_status = 'pending' when reconciled
          billing_status: status === 'reconciled' ? 'pending' : null,
          evidence_attachments: {
            ...evidenceAttachments,
            decision_intelligence: {
              ...decisionIntelligence,
              recovery_match: {
                reconciliation_strategy: match.reconciliation_strategy,
                match_explanation: match.match_explanation,
                amazon_reimbursement_id: match.amazonReimbursementId || null,
                amazon_case_id: match.amazonCaseId || null,
                matched_at: timestamp
              }
            }
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', match.disputeId);

      if (tenantId) {
        disputeUpdateQuery = disputeUpdateQuery.eq('tenant_id', tenantId);
      }

      const { error: disputeUpdateError } = await disputeUpdateQuery;

      if (disputeUpdateError) {
        const compensationReason = `Dispute case update failed after recovery persistence: ${disputeUpdateError.message}`;
        logger.error('❌ [RECOVERIES] Dispute case update failed after recovery persistence', {
          disputeId: match.disputeId,
          recoveryId: recovery.id,
          error: disputeUpdateError.message
        });
        await this.compensateRecoveryPartialWrite(recovery.id, match.disputeId, compensationReason);
        return {
          success: false,
          status: 'failed',
          expectedAmount: match.expectedAmount,
          actualAmount: match.actualAmount,
          discrepancy: match.discrepancy,
          error: compensationReason
        };
      }

      logger.info('✅ [RECOVERIES] Payout reconciled', {
        recoveryId: recovery.id,
        disputeId: match.disputeId,
        status
      });
      logger.info('[Agent8] payout detected → case matched → recovery created', {
        tenantId,
        userId,
        disputeId: match.disputeId,
        recoveryId: recovery.id,
          reimbursementId: match.amazonReimbursementId,
          expectedAmount: match.expectedAmount,
          actualAmount: match.actualAmount,
          reconciliationStatus: status,
          reconciliationStrategy: match.reconciliation_strategy,
          matchExplanation: match.match_explanation
      });

      try {
        const sseHub = (await import('../utils/sseHub')).default;
        const tenantSlug = await resolveTenantSlug(tenantId);
        await sseHub.sendTenantEvent('payout.detected', {
          tenant_id: tenantId,
          tenant_slug: tenantSlug,
          seller_id: userId,
          dispute_case_id: match.disputeId,
          recovery_id: recovery.id,
          amount: match.actualAmount,
          currency: 'USD',
          amazon_case_id: match.amazonCaseId,
          reimbursement_id: match.amazonReimbursementId,
          status,
          expected_amount: match.expectedAmount,
          actual_amount: match.actualAmount,
          reconciliation_strategy: match.reconciliation_strategy,
          match_explanation: match.match_explanation,
          message: `Payout detected for case ${match.disputeId}`
        }, tenantSlug, tenantId);

        await sseHub.sendTenantEvent('detection.payout_received', {
          tenant_id: tenantId,
          tenant_slug: tenantSlug,
          seller_id: userId,
          dispute_case_id: match.disputeId,
          recovery_id: recovery.id,
          claimId: match.disputeId,
          amount: match.actualAmount,
          currency: 'USD',
          status,
          reconciliation_strategy: match.reconciliation_strategy,
          match_explanation: match.match_explanation,
          message: `Payout received: $${Number(match.actualAmount || 0).toFixed(2)}`
        }, tenantSlug, tenantId);
      } catch (eventError: any) {
        logger.warn('⚠️ [RECOVERIES] Failed to emit payout events', {
          disputeId: match.disputeId,
          error: eventError.message
        });
      }

      // 🎯 AGENT 11 INTEGRATION: Log recovery event
      try {
        const agentEventLogger = (await import('./agentEventLogger')).default;
        await agentEventLogger.logRecovery({
          userId,
          disputeId: match.disputeId,
          success: status === 'reconciled',
          recoveryId: recovery.id,
          expectedAmount: match.expectedAmount,
          actualAmount: match.actualAmount,
          reconciliationStatus: status,
          duration: 0
        });
      } catch (logError: any) {
        logger.warn('⚠️ [RECOVERIES] Failed to log event', {
          error: logError.message
        });
      }

      // AGENT 11 REAL LOOP: feed reimbursement truth into the confidence calibrator.
      try {
        const { upsertOutcomeForDispute } = await import('./detection/confidenceCalibrator');
        await upsertOutcomeForDispute({
          dispute_id: match.disputeId,
          actual_outcome: status === 'reconciled' ? 'approved' : 'partial',
          recovery_amount: Number(match.actualAmount || 0),
          amazon_case_id: match.amazonCaseId,
          resolution_date: match.payoutDate ? new Date(match.payoutDate) : new Date(),
          notes: status === 'reconciled'
            ? 'Reimbursement detected and reconciled'
            : `Reimbursement detected with ${status} outcome`
        });
      } catch (calibrationError: any) {
        logger.warn('⚠️ [RECOVERIES] Failed to sync reimbursement outcome to calibrator', {
          disputeId: match.disputeId,
          error: calibrationError.message
        });
      }

      // 🎯 AGENT 10 INTEGRATION: Notify when funds are deposited (reconciled)
      if (status === 'reconciled') {
        try {
          const tenantSlug = await resolveTenantSlug(tenantId);
          const { item: billingItem, created } = await financialWorkItemService.enqueueBillingWork({
            tenantId: tenantId || '',
            tenantSlug,
            userId,
            disputeCaseId: match.disputeId,
            recoveryId: recovery.id,
            sourceEventType: 'payout.detected',
            sourceEventId: recovery.id,
            payload: {
              recovery_id: recovery.id,
              dispute_case_id: match.disputeId,
              amount_recovered: match.actualAmount,
              expected_amount: match.expectedAmount,
              currency: 'USD'
            }
          });

          try {
            const sseHub = (await import('../utils/sseHub')).default;
            await sseHub.sendTenantEvent('billing.work_created', {
              tenant_id: tenantId,
              tenant_slug: tenantSlug,
              seller_id: userId,
              dispute_case_id: match.disputeId,
              recovery_id: recovery.id,
              billing_work_item_id: billingItem.id,
              message: created
                ? `Billing work created for recovery ${recovery.id}`
                : `Billing work already exists for recovery ${recovery.id}`
            }, tenantSlug, tenantId);
          } catch (eventError: any) {
            logger.warn('⚠️ [RECOVERIES] Failed to emit billing.work_created event', {
              recoveryId: recovery.id,
              error: eventError.message
            });
          }

        } catch (billingWorkError: any) {
          logger.warn('⚠️ [RECOVERIES] Failed to enqueue billing work', {
            recoveryId: recovery.id,
            disputeId: match.disputeId,
            error: billingWorkError.message
          });
        }

        try {
          const notificationHelper = (await import('../services/notificationHelper')).default;
          await notificationHelper.notifyFundsDeposited(userId, {
            tenantId,
            disputeId: match.disputeId,
            recoveryId: recovery.id,
            amount: match.actualAmount,
            currency: 'usd',
            billingStatus: 'pending' // Will be updated by Agent 9
          });
        } catch (notifError: any) {
          logger.warn('⚠️ [RECOVERIES] Failed to send notification', {
            error: notifError.message
          });
        }
      }

      return {
        success: true,
        recoveryId: recovery.id,
        status,
        expectedAmount: match.expectedAmount,
        actualAmount: match.actualAmount,
        discrepancy: match.discrepancy,
        discrepancyType: match.discrepancyType !== 'none' ? match.discrepancyType : undefined,
        reconciliation_strategy: match.reconciliation_strategy,
        match_explanation: match.match_explanation,
        ...buildOperationalDecision('READY', {
          reason: 'Recovery reconciliation completed successfully.',
          next_action: status === 'reconciled' ? 'await_billing_lane' : 'review_discrepancy'
        })
      };

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to reconcile payout', {
        disputeId: match.disputeId,
        error: error.message
      });
      return {
        success: false,
        status: 'failed',
        expectedAmount: match.expectedAmount,
        actualAmount: match.actualAmount,
        discrepancy: match.discrepancy,
        error: error.message,
        reconciliation_strategy: match.reconciliation_strategy,
        match_explanation: match.match_explanation,
        ...buildOperationalDecision('RETRY_SCHEDULED', {
          reason: error.message || 'Recovery reconciliation failed and should be retried.',
          next_action: 'retry_reconciliation'
        })
      };
    }
  }

  /**
   * Process recovery for a single approved case
   */
  async processRecoveryForCase(disputeId: string, userId: string, tenantId?: string): Promise<ReconciliationResult> {
    try {
      logger.info('🔄 [RECOVERIES] Processing recovery for case', {
        disputeId,
        userId,
        tenantId
      });

      // Get dispute case
      let disputeCaseQuery = supabaseAdmin
        .from('dispute_cases')
        .select('*')
        .eq('id', disputeId)
        .eq('seller_id', userId);

      if (tenantId) {
        disputeCaseQuery = disputeCaseQuery.eq('tenant_id', tenantId);
      }

      const { data: disputeCase, error: disputeCaseError } = await disputeCaseQuery.maybeSingle();

      if (disputeCaseError) {
        return this.buildOperationalResult('RETRY_SCHEDULED', {
          reason: `Failed to load dispute case for recovery processing: ${disputeCaseError.message}`,
          retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          next_action: 'retry_case_lookup'
        });
      }

      if (!disputeCase) {
        logger.warn('⚠️ [RECOVERIES] Dispute case not found', { disputeId, userId });
        return this.buildOperationalResult('FAILED_DURABLE', {
          reason: 'Dispute case no longer exists for recovery processing.',
          next_action: 'close_or_rebuild_recovery_work_item'
        });
      }

      if (disputeCase.status !== 'approved') {
        logger.debug('ℹ️ [RECOVERIES] Case not approved, skipping', {
          disputeId,
          status: disputeCase.status
        });
        return this.buildOperationalResult('BLOCKED_OPERATIONAL', {
          reason: `Recovery processing is blocked until the case reaches approved status (current: ${disputeCase.status}).`,
          blocking_guard: 'case_not_approved',
          next_action: 'wait_for_case_approval'
        });
      }

      // Check if already reconciled
      if (disputeCase.recovery_status === 'reconciled') {
        logger.debug('ℹ️ [RECOVERIES] Case already reconciled', { disputeId });
        return this.buildOperationalResult('BLOCKED_OPERATIONAL', {
          reason: 'Recovery has already been reconciled for this case.',
          blocking_guard: 'already_reconciled',
          next_action: 'close_recovery_work_item'
        }, {
          recoveryId: disputeCase.recovery_id || undefined,
          status: 'reconciled',
          expectedAmount: Number(disputeCase.approved_amount || disputeCase.claim_amount || 0),
          actualAmount: Number(disputeCase.actual_payout_amount || disputeCase.recovered_amount || 0),
          discrepancy: 0
        });
      }

      if (disputeCase.recovery_status === 'quarantined') {
        logger.warn('⚠️ [RECOVERIES] Case recovery is quarantined, but re-evaluation is allowed for new payout truth', { disputeId });
      }

      // Detect payouts for this user (last 30 days)
      const payouts = await this.detectPayouts(
        userId,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date(),
        tenantId
      );

      // Try to match payout to this case
      for (const payout of payouts) {
        const decision = await this.matchPayoutToClaim(payout, userId, tenantId);

        if (decision.reconciliation_strategy !== 'QUARANTINED' && decision.match && decision.match.disputeId === disputeId) {
          // Found match - reconcile
          return await this.reconcilePayout(decision.match, userId, tenantId);
        }
      }

      logger.info('ℹ️ [RECOVERIES] No payout found for case yet', {
        disputeId,
        payoutCount: payouts.length
      });

      const retryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      return this.buildOperationalResult('DEFERRED_EXPLICIT', {
        reason: payouts.length > 0
          ? 'Payouts were detected, but none defensibly matched this case yet.'
          : 'No payout has been detected for this case yet.',
        retry_at: retryAt,
        next_action: 'wait_for_next_payout_detection'
      }, {
        expectedAmount: Number(disputeCase.approved_amount || disputeCase.claim_amount || 0),
        actualAmount: 0,
        discrepancy: 0
      });

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to process recovery for case', {
        disputeId,
        userId,
        error: error.message
      });
      return this.buildOperationalResult('RETRY_SCHEDULED', {
        reason: error.message || 'Recovery processing failed unexpectedly.',
        retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        next_action: 'retry_recovery_processing'
      });
    }
  }

  /**
   * Log lifecycle event
   */
  private async logLifecycleEvent(
    recoveryId: string,
    disputeId: string,
    userId: string,
    event: RecoveryLifecycleEvent
  ): Promise<void> {
    try {
      await supabaseAdmin
        .from('recovery_lifecycle_logs')
        .insert({
          recovery_id: recoveryId,
          dispute_id: disputeId,
          user_id: userId,
          event_type: event.eventType,
          event_data: event.eventData
        });

      logger.debug('📝 [RECOVERIES] Lifecycle event logged', {
        recoveryId,
        disputeId,
        eventType: event.eventType
      });

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to log lifecycle event', {
        recoveryId,
        error: error.message
      });
    }
  }

  private extractPayoutAmount(event: any): number {
    const directAmount = Number(event.amount ?? 0);
    if (Number.isFinite(directAmount) && directAmount !== 0) {
      return directAmount;
    }

    const payloadAmount = Number(
      event.raw_payload?.AdjustmentAmount?.CurrencyAmount ??
      event.raw_payload?.LiquidationProceedsAmount?.CurrencyAmount ??
      event.raw_payload?._canonical?.amount ??
      event.raw_payload?.amount ??
      0
    );

    return Number.isFinite(payloadAmount) ? payloadAmount : 0;
  }
}

// Export singleton instance
const recoveriesService = new RecoveriesService();
export default recoveriesService;

