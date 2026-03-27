import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { evaluateAndPersistCaseEligibility } from './agent7EligibilityService';
import logger from '../utils/logger';
import manualReviewService from './manualReviewService';

type ResumeMode = 'proof' | 'auto_file';

const AUTO_RESUME_REVIEW_REASONS = new Set([
  'missing_required_document_family',
  'user_auto_file_disabled'
]);

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch {
      return [value.trim()];
    }
  }
  return [];
}

function isDynamicProofReason(reason: string): boolean {
  const normalized = normalize(reason);
  return (
    normalized === 'missing_evidence_links' ||
    normalized === 'missing_product_identifier' ||
    normalized === 'missing_order_identifier' ||
    normalized === 'missing_shipment_identifier' ||
    normalized === 'missing_required_document_family' ||
    normalized.startsWith('insufficient_evidence_documents:') ||
    normalized.startsWith('historical_') ||
    normalized.startsWith('case_not_ready_for_filing_status:')
  );
}

async function isAutoFileEnabledForUser(userId: string): Promise<boolean> {
  try {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('user_notification_preferences')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.warn('[AGENT7 RESUME] Failed to load auto-file preference', {
        userId,
        error: error.message
      });
      return false;
    }

    const enabled = (data?.preferences as any)?.auto_file_cases?.enabled;
    return typeof enabled === 'boolean' ? enabled : true;
  } catch (error: any) {
    logger.warn('[AGENT7 RESUME] Error loading auto-file preference', {
      userId,
      error: error.message
    });
    return false;
  }
}

class Agent7ResumeService {
  private async getPendingReviewReasons(disputeIds: string[]): Promise<Map<string, string[]>> {
    const reviewReasonsByDispute = new Map<string, string[]>();
    if (!disputeIds.length) return reviewReasonsByDispute;

    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('manual_review_queue')
      .select('dispute_id, status, context')
      .in('dispute_id', disputeIds)
      .in('status', ['pending', 'assigned', 'in_review']);

    if (error || !data) {
      if (error) {
        logger.warn('[AGENT7 RESUME] Failed to load pending review reasons', {
          error: error.message
        });
      }
      return reviewReasonsByDispute;
    }

    for (const row of data as any[]) {
      const disputeId = String(row.dispute_id || '').trim();
      if (!disputeId) continue;
      const reason = String(row?.context?.review_reason || '').trim();
      if (!reason) continue;
      const current = reviewReasonsByDispute.get(disputeId) || [];
      current.push(reason);
      reviewReasonsByDispute.set(disputeId, current);
    }

    return reviewReasonsByDispute;
  }

  private getResumeMode(blockReasons: string[], reviewReasons: string[]): ResumeMode | null {
    const normalizedReviewReasons = reviewReasons.map(normalize);
    const normalizedBlockReasons = blockReasons.map(normalize);

    if (
      normalizedReviewReasons.includes('user_auto_file_disabled') ||
      (normalizedBlockReasons.length > 0 && normalizedBlockReasons.every((reason) => reason === 'user_auto_file_disabled'))
    ) {
      return 'auto_file';
    }

    if (
      normalizedReviewReasons.includes('missing_required_document_family') ||
      (normalizedBlockReasons.length > 0 && normalizedBlockReasons.every(isDynamicProofReason))
    ) {
      return 'proof';
    }

    return null;
  }

  private async clearResumeReasons(
    disputeCase: any,
    mode: ResumeMode
  ): Promise<void> {
    const client = supabaseAdmin || supabase;
    const blockReasons = toArray(disputeCase.block_reasons);
    const remainingReasons = blockReasons.filter((reason) => {
      if (mode === 'auto_file') {
        return normalize(reason) !== 'user_auto_file_disabled';
      }
      return !isDynamicProofReason(reason);
    });

    const nextLastError = remainingReasons.length > 0
      ? (disputeCase.last_error || remainingReasons.join('; '))
      : null;

    const { error } = await client
      .from('dispute_cases')
      .update({
        block_reasons: remainingReasons,
        last_error: nextLastError,
        updated_at: new Date().toISOString()
      })
      .eq('id', disputeCase.id)
      .eq('tenant_id', disputeCase.tenant_id);

    if (error) {
      throw new Error(`Failed to clear resume reasons: ${error.message}`);
    }
  }

  async archiveResolvedReviews(
    disputeId: string,
    reasonCodes?: string[],
    note?: string
  ): Promise<number> {
    return manualReviewService.archiveFilingExceptions(disputeId, {
      reasonCodes,
      note
    });
  }

  async reevaluateCaseIfResumable(
    disputeCase: any,
    reviewReasons?: string[]
  ): Promise<{ resumed: boolean; mode: ResumeMode | null; archivedCount: number; reason?: string }> {
    const blockReasons = toArray(disputeCase?.block_reasons);
    const reasonsFromQueue = (reviewReasons || []).filter(Boolean);
    const mode = this.getResumeMode(blockReasons, reasonsFromQueue);

    if (!mode) {
      return { resumed: false, mode: null, archivedCount: 0, reason: 'not_auto_resumable' };
    }

    if (mode === 'auto_file') {
      const enabled = await isAutoFileEnabledForUser(disputeCase.seller_id);
      if (!enabled) {
        return { resumed: false, mode, archivedCount: 0, reason: 'auto_file_still_disabled' };
      }
    }

    await this.clearResumeReasons(disputeCase, mode);
    const eligibility = await evaluateAndPersistCaseEligibility(disputeCase.id, disputeCase.tenant_id);
    const filingStatus = normalize(eligibility.disputeCase?.filing_status);
    const eligible = eligibility.eligible === true && filingStatus === 'pending';

    if (!eligible) {
      return {
        resumed: false,
        mode,
        archivedCount: 0,
        reason: eligibility.reasons.join('; ') || 'still_blocked'
      };
    }

    const reasonCodes = mode === 'auto_file'
      ? ['user_auto_file_disabled']
      : ['missing_required_document_family'];

    const archivedCount = await this.archiveResolvedReviews(
      disputeCase.id,
      reasonCodes,
      mode === 'auto_file'
        ? 'Archived automatically after seller re-enabled auto-file and the case passed eligibility.'
        : 'Archived automatically after evidence/proof blockers cleared and the case became filing-ready.'
    );

    logger.info('[AGENT7 RESUME] Resumed filing candidate automatically', {
      disputeId: disputeCase.id,
      tenantId: disputeCase.tenant_id,
      mode,
      archivedCount
    });

    return { resumed: true, mode, archivedCount };
  }

  async reevaluateClearableCasesForTenant(
    tenantId: string,
    limit = 25
  ): Promise<{ evaluated: number; resumed: number; archived: number; skipped: number }> {
    const stats = {
      evaluated: 0,
      resumed: 0,
      archived: 0,
      skipped: 0
    };

    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('dispute_cases')
      .select('id, seller_id, tenant_id, filing_status, status, block_reasons, last_error')
      .eq('tenant_id', tenantId)
      .in('filing_status', ['pending_approval', 'blocked'])
      .in('status', ['pending', 'submitted'])
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to load resumable cases: ${error.message}`);
    }

    const cases = data || [];
    const reviewReasonsByDispute = await this.getPendingReviewReasons(cases.map((item: any) => item.id));

    for (const disputeCase of cases as any[]) {
      stats.evaluated += 1;
      const result = await this.reevaluateCaseIfResumable(
        disputeCase,
        reviewReasonsByDispute.get(disputeCase.id) || []
      );
      if (result.resumed) {
        stats.resumed += 1;
        stats.archived += result.archivedCount;
      } else {
        stats.skipped += 1;
      }
    }

    return stats;
  }

  async reevaluateClearableCasesForUser(
    userId: string,
    limit = 25
  ): Promise<{ evaluated: number; resumed: number; archived: number; skipped: number }> {
    const stats = {
      evaluated: 0,
      resumed: 0,
      archived: 0,
      skipped: 0
    };

    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('dispute_cases')
      .select('id, seller_id, tenant_id, filing_status, status, block_reasons, last_error')
      .eq('seller_id', userId)
      .in('filing_status', ['pending_approval', 'blocked'])
      .in('status', ['pending', 'submitted'])
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to load resumable user cases: ${error.message}`);
    }

    const cases = data || [];
    const reviewReasonsByDispute = await this.getPendingReviewReasons(cases.map((item: any) => item.id));

    for (const disputeCase of cases as any[]) {
      stats.evaluated += 1;
      const result = await this.reevaluateCaseIfResumable(
        disputeCase,
        reviewReasonsByDispute.get(disputeCase.id) || []
      );
      if (result.resumed) {
        stats.resumed += 1;
        stats.archived += result.archivedCount;
      } else {
        stats.skipped += 1;
      }
    }

    return stats;
  }
}

const agent7ResumeService = new Agent7ResumeService();
export default agent7ResumeService;
