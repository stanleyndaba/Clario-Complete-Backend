/**
 * Recoveries Service
 * Handles payout detection, matching, and reconciliation
 * Wraps Amazon SP-API payout detection and Python reconciliation logic
 */

import axios from 'axios';
import logger from '../utils/logger';
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
  async detectPayouts(userId: string, startDate?: Date, endDate?: Date): Promise<any[]> {
    try {
      logger.info('🔍 [RECOVERIES] Detecting payouts from Amazon', {
        userId,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString()
      });

      // Fetch financial events from SP-API (reimbursements)
      const { data: financialEvents, error } = await supabaseAdmin
        .from('financial_events')
        .select('*')
        .eq('seller_id', userId)
        .eq('event_type', 'Reimbursement')
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

      // Also try fetching from Amazon Service (if available)
      try {
        const { default: amazonService } = await import('./amazonService');
        const claims = await amazonService.fetchClaims(userId, startDate, endDate);

        // Filter for approved/reimbursed claims
        const payouts = (claims || []).filter((claim: any) =>
          claim.status === 'approved' || claim.status === 'paid'
        );

        logger.info('✅ [RECOVERIES] Detected payouts', {
          userId,
          count: payouts.length,
          fromFinancialEvents: financialEvents?.length || 0,
          fromAmazonService: payouts.length
        });

        return payouts;

      } catch (error: any) {
        logger.warn('⚠️ [RECOVERIES] Could not fetch from Amazon Service, using database only', {
          userId,
          error: error.message
        });
      }

      // Transform financial events to payout format
      const payouts = (financialEvents || []).map((event: any) => ({
        id: event.id,
        amazonReimbursementId: event.amazon_event_id,
        orderId: event.amazon_order_id,
        amount: parseFloat(event.amount?.toString() || '0'),
        currency: event.currency || 'USD',
        status: 'paid',
        payoutDate: event.event_date,
        sku: event.amazon_sku,
        metadata: event.raw_payload || {}
      }));

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
  async matchPayoutToClaim(payout: any, userId: string): Promise<PayoutMatch | null> {
    try {
      logger.info('🔗 [RECOVERIES] Matching payout to claim', {
        userId,
        payoutId: payout.id,
        orderId: payout.orderId,
        amount: payout.amount
      });

      // Try to match by provider_case_id first (most reliable)
      // Check if payout has amazonCaseId or if we can extract it from metadata
      const amazonCaseId = payout.amazonCaseId || payout.metadata?.amazon_case_id || payout.metadata?.case_id;

      if (amazonCaseId) {
        const { data: disputeCase } = await supabaseAdmin
          .from('dispute_cases')
          .select(`
            id, seller_id, claim_amount, currency, status, provider_case_id,
            detection_result_id,
            detection_results (evidence)
          `)
          .eq('seller_id', userId)
          .eq('provider_case_id', amazonCaseId)
          .eq('status', 'approved')
          .single();

        if (disputeCase) {
          return this.createMatch(disputeCase, payout);
        }
      }

      // Try to match by amount (fuzzy match) - order_id is in detection_results.evidence
      // Get all approved cases and filter by order_id from evidence JSONB
      const { data: disputeCases } = await supabaseAdmin
        .from('dispute_cases')
        .select(`
          id, seller_id, claim_amount, currency, status, provider_case_id,
          detection_result_id,
          detection_results (evidence)
        `)
        .eq('seller_id', userId)
        .eq('status', 'approved')
        .limit(50);

      if (disputeCases && disputeCases.length > 0 && payout.orderId) {
        // Filter by order_id from detection_results.evidence
        const matchingCases = disputeCases.filter((dc: any) => {
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
      if (payout.sku && disputeCases && disputeCases.length > 0) {
        // Filter by SKU from detection_results.evidence
        const matchingCases = disputeCases.filter((dc: any) => {
          const evidence = dc.detection_results?.evidence || {};
          return evidence.sku === payout.sku;
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

      logger.warn('⚠️ [RECOVERIES] No matching claim found for payout', {
        userId,
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
  async reconcilePayout(match: PayoutMatch, userId: string): Promise<ReconciliationResult> {
    try {
      logger.info('💰 [RECOVERIES] Reconciling payout', {
        userId,
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
      await supabaseAdmin
        .from('dispute_cases')
        .update({
          recovery_status: status === 'reconciled' ? 'reconciled' : 'discrepancy',
          reconciled_at: status === 'reconciled' ? new Date().toISOString() : null,
          actual_payout_amount: match.actualAmount,
          // 🎯 AGENT 9 INTEGRATION: Set billing_status = 'pending' when reconciled
          billing_status: status === 'reconciled' ? 'pending' : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', match.disputeId);

      logger.info('✅ [RECOVERIES] Payout reconciled', {
        recoveryId: recovery.id,
        disputeId: match.disputeId,
        status
      });

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

      // 🎯 AGENT 10 INTEGRATION: Notify when funds are deposited (reconciled)
      if (status === 'reconciled') {
        try {
          const notificationHelper = (await import('../services/notificationHelper')).default;
          await notificationHelper.notifyFundsDeposited(userId, {
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
  async processRecoveryForCase(disputeId: string, userId: string): Promise<ReconciliationResult | null> {
    try {
      logger.info('🔄 [RECOVERIES] Processing recovery for case', {
        disputeId,
        userId
      });

      // Get dispute case
      const { data: disputeCase } = await supabaseAdmin
        .from('dispute_cases')
        .select('*')
        .eq('id', disputeId)
        .eq('seller_id', userId)
        .single();

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
        new Date()
      );

      // Try to match payout to this case
      for (const payout of payouts) {
        const match = await this.matchPayoutToClaim(payout, userId);

        if (match && match.disputeId === disputeId) {
          // Found match - reconcile
          return await this.reconcilePayout(match, userId);
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
}

// Export singleton instance
const recoveriesService = new RecoveriesService();
export default recoveriesService;

