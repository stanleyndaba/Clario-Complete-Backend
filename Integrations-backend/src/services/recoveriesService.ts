/**
 * Recoveries Service
 * Handles payout detection, matching, and reconciliation
 * Wraps Amazon SP-API payout detection and Python reconciliation logic
 */

import axios from 'axios';
import logger from '../utils/logger';
import { resolveTenantSlug } from '../utils/tenantEventRouting';
import { supabaseAdmin } from '../database/supabaseClient';

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

  /**
   * Detect payouts from Amazon SP-API for a user
   */
  async detectPayouts(userId: string, startDate?: Date, endDate?: Date, tenantId?: string): Promise<any[]> {
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

      // store_id intentionally omitted - column not in DB schema yet
      /*
      if (storeId) {
        query.eq('store_id', storeId);
      }
      */

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
        orderId: event.amazon_order_id,
        amount: this.extractPayoutAmount(event),
        currency: event.currency || 'USD',
        status: 'paid',
        payoutDate: event.event_date,
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
  async matchPayoutToClaim(payout: any, userId: string, tenantId?: string): Promise<PayoutMatch | null> {
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
            id, seller_id, claim_amount, currency, status, provider_case_id,
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
          return this.createMatch(disputeCase, payout);
        }
      }

      // Try to match by amount (fuzzy match) - order_id is in detection_results.evidence
      // Get all approved cases and filter by order_id from evidence JSONB
      let disputeCasesQuery = supabaseAdmin
        .from('dispute_cases')
        .select(`
          id, seller_id, claim_amount, currency, status, provider_case_id,
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
        for (const disputeCase of approvedCases) {
          const evidence = disputeCase.detection_results?.evidence || {};
          const reimbursementId =
            evidence.amazon_reimbursement_id ||
            evidence.reimbursement_id ||
            evidence.amazon_event_id ||
            null;

          if (reimbursementId && reimbursementId === payout.amazonReimbursementId) {
            return this.createMatch(disputeCase, payout);
          }
        }
      }

      if (approvedCases.length > 0 && payout.orderId) {
        // Filter by order_id from detection_results.evidence
        const matchingCases = approvedCases.filter((dc: any) => {
          const evidence = dc.detection_results?.evidence || {};
          return evidence.order_id === payout.orderId;
        });

        // Find best match by amount (within threshold)
        for (const disputeCase of matchingCases) {
          const expectedAmount = parseFloat(disputeCase.claim_amount?.toString() || '0');
          const actualAmount = payout.amount;
          const difference = Math.abs(expectedAmount - actualAmount);

          // Match if amount is within 5% or $1.00
          if (difference <= Math.max(expectedAmount * 0.05, 1.00)) {
            return this.createMatch(disputeCase, payout);
          }
        }
      }

      // Try to match by SKU + date range (last resort)
      if ((payout.sku || payout.asin) && approvedCases.length > 0) {
        // Filter by SKU from detection_results.evidence
        const matchingCases = approvedCases.filter((dc: any) => {
          const evidence = dc.detection_results?.evidence || {};
          return evidence.sku === payout.sku || evidence.asin === payout.asin;
        });

        // Find best match by amount
        for (const disputeCase of matchingCases) {
          const expectedAmount = parseFloat(disputeCase.claim_amount?.toString() || '0');
          const actualAmount = payout.amount;
          const difference = Math.abs(expectedAmount - actualAmount);

          if (difference <= Math.max(expectedAmount * 0.10, 2.00)) {
            logger.warn('⚠️ [RECOVERIES] Fuzzy match found (by SKU + amount)', {
              disputeId: disputeCase.id,
              expectedAmount,
              actualAmount,
              difference
            });
            return this.createMatch(disputeCase, payout);
          }
        }
      }

      // Strict amount fallback: only if there is exactly one unambiguous close candidate for this seller.
      if (approvedCases.length > 0) {
        const candidates = approvedCases
          .map((disputeCase: any) => {
            const expectedAmount = parseFloat(disputeCase.claim_amount?.toString() || '0');
            const difference = Math.abs(expectedAmount - payout.amount);
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
          logger.warn('[Agent8] Strict amount fallback match', {
            disputeId: candidates[0].disputeCase.id,
            payoutId: payout.id,
            expectedAmount: candidates[0].expectedAmount,
            actualAmount: payout.amount,
            difference: candidates[0].difference
          });
          return this.createMatch(candidates[0].disputeCase, payout);
        }
      }

      logger.warn('⚠️ [RECOVERIES] No matching claim found for payout', {
        userId,
        tenantId,
        payoutId: payout.id,
        orderId: payout.orderId,
        amount: payout.amount
      });

      return null;

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to match payout to claim', {
        userId,
        payoutId: payout.id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Create a payout match from dispute case and payout
   */
  private createMatch(disputeCase: any, payout: any): PayoutMatch {
    const expectedAmount = parseFloat(disputeCase.claim_amount?.toString() || '0');
    const actualAmount = payout.amount;
    const discrepancy = Math.abs(expectedAmount - actualAmount);

    let discrepancyType: 'none' | 'underpaid' | 'overpaid' = 'none';
    if (discrepancy > this.reconciliationThreshold) {
      discrepancyType = actualAmount < expectedAmount ? 'underpaid' : 'overpaid';
    }

    // Extract order_id from detection_results.evidence JSONB
    const evidence = disputeCase.detection_results?.evidence || {};
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
      payoutDate: payout.payoutDate || new Date().toISOString()
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
        discrepancy: match.discrepancy
      });

      // Determine reconciliation status
      let status: 'reconciled' | 'discrepancy' | 'failed' = 'reconciled';
      if (match.discrepancy > this.reconciliationThreshold) {
        status = 'discrepancy';
      }

      // Store recovery record
      const { data: recovery, error: insertError } = await supabaseAdmin
        .from('recoveries')
        .insert({
          dispute_id: match.disputeId,
          user_id: userId,
          tenant_id: tenantId,
          // store_id intentionally omitted - column not in DB schema yet
          amazon_case_id: match.amazonCaseId,
          expected_amount: match.expectedAmount,
          actual_amount: match.actualAmount,
          discrepancy: match.discrepancy,
          discrepancy_type: match.discrepancyType === 'none' ? null : match.discrepancyType,
          reconciliation_status: status,
          payout_date: match.payoutDate,
          amazon_reimbursement_id: match.amazonReimbursementId,
          matched_at: new Date().toISOString(),
          reconciled_at: status === 'reconciled' ? new Date().toISOString() : null
        })
        .select()
        .single();

      if (insertError) {
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

      // Log lifecycle event
      await this.logLifecycleEvent(recovery.id, match.disputeId, userId, {
        eventType: status === 'reconciled' ? 'reconciled' : 'discrepancy_detected',
        eventData: {
          expectedAmount: match.expectedAmount,
          actualAmount: match.actualAmount,
          discrepancy: match.discrepancy,
          discrepancyType: match.discrepancyType,
          status
        }
      });

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
          updated_at: new Date().toISOString()
        })
        .eq('id', match.disputeId);

      if (tenantId) {
        disputeUpdateQuery = disputeUpdateQuery.eq('tenant_id', tenantId);
      }

      await disputeUpdateQuery;

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
        reconciliationStatus: status
      });

      try {
        const sseHub = (await import('../utils/sseHub')).default;
        const tenantSlug = await resolveTenantSlug(tenantId);
        sseHub.sendEvent(userId, 'payout.detected', {
          tenant_id: tenantId,
          tenant_slug: tenantSlug,
          dispute_case_id: match.disputeId,
          recovery_id: recovery.id,
          amount: match.actualAmount,
          currency: 'USD',
          amazon_case_id: match.amazonCaseId,
          reimbursement_id: match.amazonReimbursementId,
          status,
          expected_amount: match.expectedAmount,
          actual_amount: match.actualAmount,
          message: `Payout detected for case ${match.disputeId}`
        });

        sseHub.sendEvent(userId, 'detection.payout_received', {
          tenant_id: tenantId,
          tenant_slug: tenantSlug,
          dispute_case_id: match.disputeId,
          recovery_id: recovery.id,
          claimId: match.disputeId,
          amount: match.actualAmount,
          currency: 'USD',
          status,
          message: `Payout received: $${Number(match.actualAmount || 0).toFixed(2)}`
        });
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
        discrepancyType: match.discrepancyType !== 'none' ? match.discrepancyType : undefined
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
        error: error.message
      };
    }
  }

  /**
   * Process recovery for a single approved case
   */
  async processRecoveryForCase(disputeId: string, userId: string, tenantId?: string): Promise<ReconciliationResult | null> {
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

      const { data: disputeCase } = await disputeCaseQuery.single();

      if (!disputeCase) {
        logger.warn('⚠️ [RECOVERIES] Dispute case not found', { disputeId, userId });
        return null;
      }

      if (disputeCase.status !== 'approved') {
        logger.debug('ℹ️ [RECOVERIES] Case not approved, skipping', {
          disputeId,
          status: disputeCase.status
        });
        return null;
      }

      // Check if already reconciled
      if (disputeCase.recovery_status === 'reconciled') {
        logger.debug('ℹ️ [RECOVERIES] Case already reconciled', { disputeId });
        return null;
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
        const match = await this.matchPayoutToClaim(payout, userId, tenantId);

        if (match && match.disputeId === disputeId) {
          // Found match - reconcile
          return await this.reconcilePayout(match, userId, tenantId);
        }
      }

      logger.info('ℹ️ [RECOVERIES] No payout found for case yet', {
        disputeId,
        payoutCount: payouts.length
      });

      return null;

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to process recovery for case', {
        disputeId,
        userId,
        error: error.message
      });
      return null;
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
      event.raw_payload?.amount ??
      0
    );

    return Number.isFinite(payloadAmount) ? payloadAmount : 0;
  }
}

// Export singleton instance
const recoveriesService = new RecoveriesService();
export default recoveriesService;

