import { subDays } from 'date-fns';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export type RejectionCategory =
  | 'MISSING_DOCUMENT'
  | 'OUT_OF_WINDOW'
  | 'ALREADY_REIMBURSED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'INVALID_CLAIM'
  | 'UNKNOWN';

export interface RejectionMemoryInput {
  userId: string;
  disputeId: string;
  detectionResultId?: string | null;
  anomalyType?: string | null;
  claimType?: string | null;
  amazonCaseId?: string | null;
  claimAmount?: number | null;
  currency?: string | null;
  rawReasonText: string;
  rejectionCategory: RejectionCategory;
  orderId?: string | null;
  evidenceProvided?: string[];
  timestamp?: Date;
}

export interface RejectionPreventionDecision {
  blocked: boolean;
  filingStatus: string;
  status?: string;
  reason: string;
  category: RejectionCategory;
  metadata: Record<string, any>;
}

const SUPPORTING_DOCUMENT_KEYWORDS = [
  'invoice',
  'proof',
  'pod',
  'tracking',
  'receipt',
  'delivery'
];

export function classifyRejectionReason(rawReason: string): RejectionCategory {
  const reason = (rawReason || '').toLowerCase();

  if (!reason.trim()) {
    return 'UNKNOWN';
  }

  if (
    reason.includes('already reimbursed') ||
    reason.includes('already refunded') ||
    reason.includes('already credited') ||
    reason.includes('already paid') ||
    reason.includes('duplicate reimbursement')
  ) {
    return 'ALREADY_REIMBURSED';
  }

  if (
    reason.includes('eligible period') ||
    reason.includes('outside') ||
    reason.includes('out of window') ||
    reason.includes('time window') ||
    reason.includes('too late') ||
    reason.includes('past due') ||
    reason.includes('expired')
  ) {
    return 'OUT_OF_WINDOW';
  }

  if (
    reason.includes('invoice') ||
    reason.includes('proof') ||
    reason.includes('provide documentation') ||
    reason.includes('missing document') ||
    reason.includes('attach document')
  ) {
    return 'MISSING_DOCUMENT';
  }

  if (
    reason.includes('insufficient evidence') ||
    reason.includes('insufficient proof') ||
    reason.includes('unable to verify') ||
    reason.includes('not enough evidence')
  ) {
    return 'INSUFFICIENT_EVIDENCE';
  }

  if (
    reason.includes('invalid claim') ||
    reason.includes('wrong claim') ||
    reason.includes('incorrect claim') ||
    reason.includes('ineligible') ||
    reason.includes('not eligible') ||
    reason.includes('does not match')
  ) {
    return 'INVALID_CLAIM';
  }

  return 'UNKNOWN';
}

export async function recordRejectionMemory(input: RejectionMemoryInput): Promise<boolean> {
  try {
    const { data: disputeCase, error: loadError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, evidence_attachments')
      .eq('id', input.disputeId)
      .maybeSingle();

    if (loadError || !disputeCase) {
      logger.error('[REJECTION MEMORY] Failed to load dispute for rejection memory', {
        disputeId: input.disputeId,
        error: loadError?.message
      });
      return false;
    }

    const evidenceAttachments = {
      ...(disputeCase.evidence_attachments || {}),
      rejection_category: input.rejectionCategory,
      raw_reason_text: input.rawReasonText,
      rejection_recorded_at: (input.timestamp || new Date()).toISOString(),
      detection_result_id: input.detectionResultId || null,
      dispute_case_id: input.disputeId,
      anomaly_type: input.anomalyType || input.claimType || null,
      order_id: input.orderId || null,
      amazon_case_id: input.amazonCaseId || null
    };

    const { error } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        evidence_attachments: evidenceAttachments,
        updated_at: new Date().toISOString()
      })
      .eq('id', input.disputeId);

    if (error) {
      logger.error('[REJECTION MEMORY] Failed to store rejection memory', {
        disputeId: input.disputeId,
        error: error.message
      });
      return false;
    }

    logger.info('[REJECTION MEMORY] Rejection memory stored', {
      disputeId: input.disputeId,
      detectionResultId: input.detectionResultId,
      rejectionCategory: input.rejectionCategory
    });
    return true;
  } catch (error: any) {
    logger.error('[REJECTION MEMORY] Exception storing rejection memory', {
      disputeId: input.disputeId,
      error: error.message
    });
    return false;
  }
}

async function loadRecentRejectionMemories(params: {
  userId: string;
  anomalyType: string;
}): Promise<any[]> {
  const since = subDays(new Date(), 90).toISOString();
  const { data: disputes, error } = await supabaseAdmin
    .from('dispute_cases')
    .select(`
      id,
      seller_id,
      case_type,
      detection_result_id,
      evidence_attachments,
      updated_at,
      detection_results (
        anomaly_type,
        evidence
      )
    `)
    .eq('seller_id', params.userId)
    .gte('updated_at', since)
    .not('detection_result_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error || !disputes) {
    logger.warn('[REJECTION MEMORY] Failed to load recent rejection memories', {
      userId: params.userId,
      anomalyType: params.anomalyType,
      error: error?.message
    });
    return [];
  }

  return disputes.filter((dispute: any) => {
    const rememberedCategory = dispute.evidence_attachments?.rejection_category;
    const rememberedType = dispute.evidence_attachments?.anomaly_type || dispute.detection_results?.anomaly_type || dispute.case_type;
    return rememberedCategory && rememberedType === params.anomalyType;
  });
}

export async function getRejectionPreventionDecision(params: {
  userId: string;
  anomalyType?: string | null;
  orderId?: string | null;
  evidenceIds: string[];
}): Promise<RejectionPreventionDecision | null> {
  const anomalyType = params.anomalyType || null;
  if (!anomalyType) {
    return null;
  }

  try {
    const memories = await loadRecentRejectionMemories({
      userId: params.userId,
      anomalyType
    });

    if (memories.length === 0) {
      return null;
    }

    const exactOrderMemory = params.orderId
      ? memories.find((memory: any) => memory.evidence_attachments?.order_id === params.orderId)
      : null;

    const memory = exactOrderMemory || memories[0];
    const category = (memory.evidence_attachments?.rejection_category || 'UNKNOWN') as RejectionCategory;
    const rawReason = memory.evidence_attachments?.raw_reason_text || 'Recent rejection memory';

    switch (category) {
      case 'ALREADY_REIMBURSED':
        if (params.orderId && memory.evidence_attachments?.order_id === params.orderId) {
          return {
            blocked: true,
            filingStatus: 'already_reimbursed',
            status: 'closed',
            reason: `Blocked by rejection memory: ${rawReason}`,
            category,
            metadata: {
              block_reason: 'rejection_memory_already_reimbursed',
              rejection_reason: rawReason,
              rejection_memory_id: memory.id
            }
          };
        }
        return null;

      case 'OUT_OF_WINDOW':
        return {
          blocked: true,
          filingStatus: 'blocked',
          status: 'closed',
          reason: `Blocked by rejection memory: ${rawReason}`,
          category,
          metadata: {
            block_reason: 'rejection_memory_out_of_window',
            rejection_reason: rawReason,
            rejection_memory_id: memory.id
          }
        };

      case 'INVALID_CLAIM':
        return {
          blocked: true,
          filingStatus: 'blocked',
          status: 'closed',
          reason: `Blocked by rejection memory: ${rawReason}`,
          category,
          metadata: {
            block_reason: 'rejection_memory_invalid_claim',
            rejection_reason: rawReason,
            rejection_memory_id: memory.id
          }
        };

      case 'MISSING_DOCUMENT': {
        const hasEvidence = await hasSupportingEvidence(params.evidenceIds, params.userId);
        if (!hasEvidence) {
          return {
            blocked: true,
            filingStatus: 'pending_approval',
            reason: `Held for review by rejection memory: ${rawReason}`,
            category,
            metadata: {
              approval_reason: 'rejection_memory_missing_document',
              rejection_reason: rawReason,
              rejection_memory_id: memory.id
            }
          };
        }
        return null;
      }

      case 'INSUFFICIENT_EVIDENCE':
        if (params.evidenceIds.length < 2) {
          return {
            blocked: true,
            filingStatus: 'pending_approval',
            reason: `Held for review by rejection memory: ${rawReason}`,
            category,
            metadata: {
              approval_reason: 'rejection_memory_insufficient_evidence',
              rejection_reason: rawReason,
              rejection_memory_id: memory.id
            }
          };
        }
        return null;

      default:
        return null;
    }
  } catch (error: any) {
    logger.warn('[REJECTION MEMORY] Failed to evaluate rejection prevention decision', {
      userId: params.userId,
      anomalyType,
      error: error.message
    });
    return null;
  }
}
async function hasSupportingEvidence(evidenceIds: string[], sellerId: string): Promise<boolean> {
  if (!evidenceIds.length) {
    return false;
  }

  const { data: docs, error } = await supabaseAdmin
    .from('evidence_documents')
    .select('id, filename, doc_type')
    .in('id', evidenceIds)
    .eq('seller_id', sellerId);

  if (error || !docs) {
    logger.warn('[REJECTION MEMORY] Failed to inspect supporting evidence', {
      sellerId,
      error: error?.message
    });
    return false;
  }

  return docs.some((doc: any) => {
    const haystack = `${doc.doc_type || ''} ${doc.filename || ''}`.toLowerCase();
    return SUPPORTING_DOCUMENT_KEYWORDS.some((keyword) => haystack.includes(keyword));
  });
}
