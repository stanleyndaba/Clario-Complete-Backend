import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import recoveryFinancialTruthService from './recoveryFinancialTruthService';
import { evaluateCanonicalEvidenceTruth } from './canonicalEvidenceService';

export interface DisputeCaseQueueFilters {
  tenantSlug?: string;
  explicitTenantId?: string;
  requestTenantId?: string | null;
  requestTenantSlug?: string | null;
  userId?: string | null;
  search?: string;
  status?: string;
  gate_state?: string;
  filing_status?: string;
  recovery_status?: string;
  billing_status?: string;
  evidence_state?: string;
  rejection_category?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  page_size?: number;
}

interface ResolvedScope {
  tenantId: string;
  tenantSlug: string | null;
}

export type EligibilityStatus =
  | 'READY'
  | 'DUPLICATE_BLOCKED'
  | 'INSUFFICIENT_DATA'
  | 'THREAD_ONLY'
  | 'SAFETY_HOLD';

const BILLING_COMPLETE_STATUSES = new Set(['paid', 'charged', 'credited', 'completed']);
const REJECTED_STATUSES = new Set(['rejected', 'denied']);
const APPROVED_STATUSES = new Set(['approved', 'won']);
const FILED_STATUSES = new Set(['filed', 'submitted', 'resubmitted', 'filing', 'submitting']);
const AUTHORITATIVE_SUBMISSION_OUTCOMES = new Set(['submitted', 'accepted', 'filed', 'success', 'open', 'in_progress']);
const ACTIVE_AMAZON_REVIEW_STATUSES = new Set(['submitted', 'under review', 'in review']);
const BLOCKED_FILING_STATUSES = new Set([
  'blocked',
  'pending_safety_verification',
  'duplicate_blocked',
  'already_reimbursed',
  'quarantined_dangerous_doc',
  'blocked_invalid_date',
  'skipped_low_value'
]);
const BLOCKED_EVIDENCE_STATES = new Set(['missing evidence', 'weak evidence', 'needs review']);
const DETECTED_FILING_READY_THRESHOLD = 0.6;
const REVIEW_FILINGS = new Set([
  'pending_approval',
  'pending_safety_verification',
  'quarantined_dangerous_doc',
  'blocked_invalid_date',
  'duplicate_blocked',
  'already_reimbursed',
  'skipped_low_value'
]);
const INVALID_TENANT_SLUGS = new Set(['beta', 'null', 'undefined']);

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMoney(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function countAttachmentManifest(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function buildSubmissionProof(submission: any) {
  if (!submission) return null;

  const normalizedOutcome = normalize(submission.outcome || submission.status);
  const externalReference = String(
    submission.external_reference ||
    submission.amazon_case_id ||
    ''
  ).trim() || null;
  const fallbackSubmissionId = String(submission.submission_id || '').trim() || null;
  const proofReference = externalReference || (
    fallbackSubmissionId && AUTHORITATIVE_SUBMISSION_OUTCOMES.has(normalizedOutcome)
      ? fallbackSubmissionId
      : null
  );

  return {
    id: submission.id || null,
    submission_id: fallbackSubmissionId,
    amazon_case_id: String(submission.amazon_case_id || '').trim() || null,
    external_reference: String(submission.external_reference || '').trim() || null,
    proof_reference: proofReference,
    proof_present: Boolean(proofReference),
    submitted_at: submission.submission_timestamp || submission.created_at || null,
    request_started_at: submission.request_started_at || null,
    response_received_at: submission.response_received_at || null,
    submission_channel: String(submission.submission_channel || '').trim() || null,
    attachment_count: countAttachmentManifest(submission.attachment_manifest),
    status: submission.status || null,
    outcome: submission.outcome || null
  };
}

function buildOpportunityCaseNumber(id: string | null | undefined) {
  const compact = String(id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return `OPP-${compact.slice(0, 8) || 'UNFILED'}`;
}

function deriveRowIdentityTruth(entityType: 'dispute_case' | 'detection', linkedDisputeCaseId: string | null) {
  const hasRealDisputeCase = entityType === 'dispute_case' && Boolean(linkedDisputeCaseId);
  return {
    row_type: hasRealDisputeCase ? 'dispute_case' : 'orphan_detection',
    entity_type: entityType,
    has_real_dispute_case: hasRealDisputeCase,
    linked_dispute_case_id: hasRealDisputeCase ? linkedDisputeCaseId : null,
    brief_available: hasRealDisputeCase
  } as const;
}

export function deriveQueueActionTruth(row: {
  entity_type: 'dispute_case' | 'detection';
  has_real_dispute_case: boolean;
  linked_dispute_case_id: string | null;
  filing_status: string | null;
  eligible_to_file: boolean | null;
  eligibility_status?: EligibilityStatus | null;
}) {
  const filingStatus = normalize(row.filing_status);
  const hasLinkedDisputeCase = row.has_real_dispute_case === true && Boolean(row.linked_dispute_case_id);
  const isReady = row.eligibility_status === 'READY' && row.eligible_to_file === true;
  const canApprove = hasLinkedDisputeCase && isReady && filingStatus === 'pending_approval';
  const canRetry = hasLinkedDisputeCase && isReady && filingStatus === 'failed';
  const canFile = hasLinkedDisputeCase && isReady && ['pending', 'retrying'].includes(filingStatus);
  const canOpenBrief = hasLinkedDisputeCase;
  const canOpenCaseDetail =
    row.entity_type === 'dispute_case'
      ? hasLinkedDisputeCase
      : row.entity_type === 'detection';

  return {
    can_file: canFile,
    can_retry: canRetry,
    can_approve: canApprove,
    can_open_brief: canOpenBrief,
    can_open_case_detail: canOpenCaseDetail
  } as const;
}

function deriveEligibilityStatus(record: any, fallback?: EligibilityStatus): EligibilityStatus {
  const explicit = String(
    record?.eligibility_status ||
    record?.evidence_attachments?.decision_intelligence?.eligibility_status ||
    ''
  ).trim().toUpperCase();

  if (['READY', 'DUPLICATE_BLOCKED', 'INSUFFICIENT_DATA', 'THREAD_ONLY', 'SAFETY_HOLD'].includes(explicit)) {
    return explicit as EligibilityStatus;
  }

  if (fallback) return fallback;
  if (record?.case_origin === 'amazon_thread_backfill') return 'THREAD_ONLY';
  if (normalize(record?.filing_status) === 'duplicate_blocked') return 'DUPLICATE_BLOCKED';
  if (normalize(record?.filing_status) === 'pending_safety_verification') return 'INSUFFICIENT_DATA';
  if (record?.eligible_to_file === true && ['pending', 'retrying'].includes(normalize(record?.filing_status))) return 'READY';
  return 'SAFETY_HOLD';
}

function compareValues(left: unknown, right: unknown) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  const leftDate = new Date(String(left));
  const rightDate = new Date(String(right));
  if (!Number.isNaN(leftDate.getTime()) && !Number.isNaN(rightDate.getTime())) {
    return leftDate.getTime() - rightDate.getTime();
  }

  return String(left).localeCompare(String(right));
}

async function resolveScope(filters: DisputeCaseQueueFilters): Promise<ResolvedScope> {
  const tenantSlug = String(filters.tenantSlug || '').trim() || null;
  const explicitTenantId = String(filters.explicitTenantId || '').trim() || null;
  const requestTenantId = String(filters.requestTenantId || '').trim() || null;
  const requestTenantSlug = String(filters.requestTenantSlug || '').trim() || null;
  const userId = String(filters.userId || '').trim() || null;

  if (tenantSlug && INVALID_TENANT_SLUGS.has(tenantSlug.toLowerCase())) {
    throw new Error('Invalid tenant context');
  }

  if (!tenantSlug) {
    if (explicitTenantId) {
      if (!requestTenantId || requestTenantId !== explicitTenantId) {
        throw new Error('Invalid tenant context');
      }
    }

    if (requestTenantId) {
      return {
        tenantId: requestTenantId,
        tenantSlug: requestTenantSlug || null
      };
    }
    throw new Error('Tenant context required');
  }

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, slug')
    .eq('slug', tenantSlug)
    .is('deleted_at', null)
    .maybeSingle();

  if (tenantError) {
    throw new Error('Failed to resolve tenant context');
  }

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  if (userId) {
    const safeUserId = convertUserIdToUuid(userId);
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('tenant_memberships')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('user_id', safeUserId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (membershipError) {
      throw new Error('Failed to verify tenant membership');
    }

    if (!membership && requestTenantId !== tenant.id) {
      throw new Error('You do not have access to this tenant');
    }
  } else if (requestTenantId && requestTenantId !== tenant.id) {
    throw new Error('Invalid tenant context');
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug || tenantSlug
  };
}

function deriveApprovedAmount(record: any): number | null {
  return toMoney(record?.approved_amount);
}

function getMatchedDocumentCount(record: any, linkedDocumentCount: number) {
  if (linkedDocumentCount > 0) return linkedDocumentCount;
  if (typeof record?.matched_document_count === 'number' && record.matched_document_count > 0) return record.matched_document_count;
  if (Array.isArray(record?.matched_document_ids)) return record.matched_document_ids.length;
  if (record?.evidence_attachments?.document_id) return 1;
  if (Array.isArray(record?.evidence_document_ids)) return record.evidence_document_ids.length;
  return 0;
}

function deriveEvidenceState(record: any, matchedDocumentCount: number, evidenceTruth?: ReturnType<typeof evaluateCanonicalEvidenceTruth> | null) {
  const filingStatus = normalize(record?.filing_status);
  const rejectionCategory = record?.evidence_attachments?.rejection_category || null;
  const rejectionReason = record?.rejection_reason || null;
  const blockReasons = Array.isArray(record?.block_reasons) ? record.block_reasons : [];
  const matchConfidence = toNumber(record?.evidence_attachments?.match_confidence);

  if (evidenceTruth && evidenceTruth.linkedDocumentCount === 0) return 'Missing Evidence';
  if (evidenceTruth && !evidenceTruth.isEvidenceComplete) {
    return evidenceTruth.missingRequirements.includes('proof_snapshot') ? 'Needs Review' : 'Missing Evidence';
  }
  if (matchedDocumentCount === 0) return 'Missing Evidence';
  if (rejectionCategory || rejectionReason || blockReasons.length > 0 || filingStatus === 'blocked' || REVIEW_FILINGS.has(filingStatus)) return 'Needs Review';
  if (matchConfidence !== null && matchConfidence < 0.5) return 'Weak Evidence';
  if (record?.eligible_to_file === true && ['pending', 'retrying'].includes(filingStatus)) return 'Ready';
  return 'Matched';
}

function deriveNextAction(row: any) {
  const status = normalize(row.status);
  const filingStatus = normalize(row.filing_status);
  const recoveryStatus = normalize(row.recovery_status);
  const billingStatus = normalize(row.billing_status);
  const operationalState = normalize(row.operational_state);
  const eligibilityStatus = deriveEligibilityStatus(row);
  const hasLinkedDisputeCase = row.has_real_dispute_case === true && Boolean(row.linked_dispute_case_id);

  if (!hasLinkedDisputeCase && row.entity_type === 'detection') {
    if (normalize(row.proof_status) === 'supportable_but_not_case_eligible') {
      return 'Supportable - case not created yet';
    }
    return Number(row.matched_document_count || 0) > 0
      ? 'Detection only - review required'
      : 'Waiting for evidence';
  }

  if (BILLING_COMPLETE_STATUSES.has(billingStatus)) return 'Billing complete';
  if (recoveryStatus === 'reconciled' && billingStatus === 'pending') return 'Billing pending';
  if (recoveryStatus === 'reconciled') return 'Recovered';
  if (eligibilityStatus === 'DUPLICATE_BLOCKED') return 'Duplicate detected - not filed';
  if (eligibilityStatus === 'THREAD_ONLY') {
    return row.case_origin === 'amazon_thread_backfill' || row.amazon_case_id
      ? 'Amazon thread detected'
      : 'Existing case already linked';
  }
  if (eligibilityStatus === 'INSUFFICIENT_DATA') return 'Awaiting verified identifiers';
  if (eligibilityStatus === 'SAFETY_HOLD' && filingStatus === 'blocked') return 'Safety hold';
  if (operationalState === 'retry_scheduled') return 'Retry scheduled';
  if (operationalState === 'deferred_explicit') return 'Deferred operationally';
  if (operationalState === 'blocked_operational') return 'Dispatch blocked';
  if (operationalState === 'failed_durable') return 'Operational failure';
  if (row.actual_payout_amount) return 'Payout detected, review reconciliation';
  if (REJECTED_STATUSES.has(status) || row.rejection_reason || row.rejection_category) return 'Review rejection';
  if (APPROVED_STATUSES.has(status)) return 'Waiting for payout';
  if (FILED_STATUSES.has(filingStatus)) return 'Filed / awaiting Amazon';
  if (filingStatus === 'pending_safety_verification') return 'Awaiting identifiers';
  if (filingStatus === 'blocked' || row.eligible_to_file === false) return 'Blocked';
  if (row.evidence_state === 'Missing Evidence') return 'Waiting for evidence';
  if (row.evidence_state === 'Weak Evidence' || row.evidence_state === 'Needs Review') return 'Needs review';
  if (row.eligible_to_file === true && ['pending', 'retrying'].includes(filingStatus)) {
    return 'Ready to file';
  }
  return 'Manual review';
}

export async function getDisputeCaseQueue(filters: DisputeCaseQueueFilters) {
  const scope = await resolveScope(filters);
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.page_size) || 25));
  const sortBy = String(filters.sort_by || 'updated_at');
  const sortOrder = normalize(filters.sort_order) === 'asc' ? 'asc' : 'desc';

  const rows: any[] = [];
  const batchSize = 1000;
  let from = 0;

  while (true) {
    let disputeQuery = supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('tenant_id', scope.tenantId)
      .order('updated_at', { ascending: false })
      .range(from, from + batchSize - 1);

    const { data: batch, error: disputeError } = await disputeQuery;
    if (disputeError) {
      throw new Error(`Failed to load dispute cases: ${disputeError.message || 'unknown query error'}`);
    }

    const disputeCases = batch || [];
    rows.push(...disputeCases);
    if (disputeCases.length < batchSize) break;
    from += batchSize;
  }

  const disputeIds = rows.map((row: any) => row.id);
  const detectionIds = rows.map((row: any) => row.detection_result_id).filter(Boolean);
  const linkedDetectionIds = new Set(detectionIds);
  const orphanDetections: any[] = [];
  let detectionFrom = 0;

  while (true) {
    const { data: detectionBatch, error: detectionBatchError } = await supabaseAdmin
      .from('detection_results')
      .select('*')
      .eq('tenant_id', scope.tenantId)
      .order('updated_at', { ascending: false })
      .range(detectionFrom, detectionFrom + batchSize - 1);

    if (detectionBatchError) {
      throw new Error(`Failed to load detection results: ${detectionBatchError.message || 'unknown query error'}`);
    }

    const filteredBatch = (detectionBatch || []).filter((row: any) => !linkedDetectionIds.has(row.id));
    orphanDetections.push(...filteredBatch);

    if ((detectionBatch || []).length < batchSize) break;
    detectionFrom += batchSize;
  }

  const storeIds = [
    ...rows.map((row: any) => row.store_id).filter(Boolean),
    ...orphanDetections.map((row: any) => row.store_id).filter(Boolean)
  ];

  const [{ data: evidenceLinks }, { data: detectionRows }, { data: stores }, { data: billingRows }, { data: submissionRows }] = await Promise.all([
    disputeIds.length
      ? supabaseAdmin
          .from('dispute_evidence_links')
          .select('dispute_case_id, evidence_document_id, evidence_documents(id, doc_type, raw_text, extracted, parsed_metadata, parser_status)')
          .eq('tenant_id', scope.tenantId)
          .in('dispute_case_id', disputeIds)
      : Promise.resolve({ data: [] as any[] }),
    detectionIds.length
      ? supabaseAdmin
          .from('detection_results')
          .select('id, anomaly_type, order_id, sku, asin')
          .eq('tenant_id', scope.tenantId)
          .in('id', detectionIds)
      : Promise.resolve({ data: [] as any[] }),
    storeIds.length
      ? supabaseAdmin
          .from('stores')
          .select('id, name')
          .in('id', storeIds)
      : Promise.resolve({ data: [] as any[] }),
    disputeIds.length
      ? supabaseAdmin
          .from('billing_transactions')
          .select('dispute_id, billing_status, platform_fee_cents, updated_at, created_at')
          .in('dispute_id', disputeIds)
      : Promise.resolve({ data: [] as any[] }),
    disputeIds.length
      ? supabaseAdmin
          .from('dispute_submissions')
          .select('id, dispute_id, submission_id, amazon_case_id, external_reference, submission_timestamp, request_started_at, response_received_at, submission_channel, attachment_manifest, status, outcome, created_at, updated_at')
          .eq('tenant_id', scope.tenantId)
          .in('dispute_id', disputeIds)
      : Promise.resolve({ data: [] as any[] })
  ]);

  const linkedDocumentsByCase = new Map<string, any[]>();
  for (const link of evidenceLinks || []) {
    const current = linkedDocumentsByCase.get(link.dispute_case_id) || [];
    const linkedDocument = Array.isArray((link as any)?.evidence_documents)
      ? (link as any).evidence_documents[0]
      : (link as any)?.evidence_documents;
    if (linkedDocument) {
      current.push(linkedDocument);
    }
    linkedDocumentsByCase.set(link.dispute_case_id, current);
  }

  const detectionById = new Map<string, any>();
  for (const detection of detectionRows || []) {
    detectionById.set(detection.id, detection);
  }

  const storeById = new Map<string, string>();
  for (const store of stores || []) {
    storeById.set(store.id, store.name);
  }

  const latestBillingByDisputeId = new Map<string, any>();
  for (const billing of billingRows || []) {
    const current = latestBillingByDisputeId.get(billing.dispute_id);
    const billingTimestamp = billing.updated_at || billing.created_at || '';
    const currentTimestamp = current?.updated_at || current?.created_at || '';
    if (!current || billingTimestamp > currentTimestamp) {
      latestBillingByDisputeId.set(billing.dispute_id, billing);
    }
  }

  const latestSubmissionByDisputeId = new Map<string, any>();
  for (const submission of submissionRows || []) {
    const current = latestSubmissionByDisputeId.get(submission.dispute_id);
    const submissionTimestamp = submission.response_received_at || submission.submission_timestamp || submission.updated_at || submission.created_at || '';
    const currentTimestamp = current?.response_received_at || current?.submission_timestamp || current?.updated_at || current?.created_at || '';
    if (!current || submissionTimestamp > currentTimestamp) {
      latestSubmissionByDisputeId.set(submission.dispute_id, submission);
    }
  }

  const enrichedRows = rows.map((record: any) => {
    const detection = record.detection_result_id ? detectionById.get(record.detection_result_id) : null;
    const latestBilling = latestBillingByDisputeId.get(record.id);
    const latestSubmission = latestSubmissionByDisputeId.get(record.id);
    const decisionIntelligence = record?.evidence_attachments?.decision_intelligence || {};
    const proofSnapshot = decisionIntelligence?.proof_snapshot || null;
    const filingStrategy = typeof decisionIntelligence?.filing_strategy === 'string'
      ? decisionIntelligence.filing_strategy
      : null;
    const explanationPayload = decisionIntelligence?.explanation_payload || proofSnapshot?.explanationPayload || null;
    const operationalState = typeof decisionIntelligence?.operational_state === 'string'
      ? decisionIntelligence.operational_state
      : null;
    const operationalExplanation = decisionIntelligence?.operational_explanation || null;
    const eligibilityStatus = deriveEligibilityStatus(record);
    const evidenceTruth = evaluateCanonicalEvidenceTruth({
      disputeCase: record,
      linkedDocuments: linkedDocumentsByCase.get(record.id) || []
    });
    const matchedDocumentCount = evidenceTruth.linkedDocumentCount;
    const requestedAmount = toMoney(record.claim_amount);
    const approvedAmount = deriveApprovedAmount(record);
    const actualPayoutAmount = toMoney(record.recovered_amount ?? record.actual_payout_amount);
    const billedAmount = latestBilling?.platform_fee_cents != null
      ? Number((Number(latestBilling.platform_fee_cents) / 100).toFixed(2))
      : toMoney(record?.billed_amount);
    const billingStatus = normalize(latestBilling?.billing_status || record.billing_status) || null;
    const rejectionCategory = record?.evidence_attachments?.rejection_category || null;
    const rejectionReason = record?.rejection_reason || null;
    const evidenceState = deriveEvidenceState(record, matchedDocumentCount, evidenceTruth);
    const identityTruth = deriveRowIdentityTruth('dispute_case', record.id || null);
    const missingRequirements = Array.from(
      new Set([
        ...(Array.isArray(proofSnapshot?.missingRequirements) ? proofSnapshot.missingRequirements : []),
        ...evidenceTruth.missingRequirements
      ])
    );
    const effectiveEligibleToFile =
      eligibilityStatus === 'READY' &&
      record.eligible_to_file === true &&
      evidenceTruth.isEvidenceComplete;
    const proofStatus = effectiveEligibleToFile
      ? (proofSnapshot?.filingRecommendation || 'filing_ready')
      : 'missing_requirements';
    const manualReviewReason = missingRequirements[0] ||
      (Array.isArray(record.block_reasons) && record.block_reasons.length > 0
        ? record.block_reasons[0]
        : (proofSnapshot?.riskFlags?.[0] || null));

    const row = {
      dispute_case_id: record.id,
      detection_result_id: record.detection_result_id || null,
      ...identityTruth,
      case_number: record.case_number || null,
      claim_number: record.claim_id || record.case_number || null,
      case_type: record.case_type || detection?.anomaly_type || null,
      anomaly_type: detection?.anomaly_type || record.case_type || null,
      case_origin: record.case_origin || 'detection_pipeline',
      status: record.status || null,
      filing_status: record.filing_status || null,
      recovery_status: record.recovery_status || null,
      billing_status: billingStatus,
      eligibility_status: eligibilityStatus,
      eligible_to_file: effectiveEligibleToFile,
      block_reasons: Array.isArray(record.block_reasons) ? record.block_reasons : [],
      last_error: record.last_error || null,
      requested_amount: requestedAmount,
      approved_amount: approvedAmount,
      actual_payout_amount: actualPayoutAmount,
      billed_amount: billedAmount,
      currency: record.currency || 'USD',
      evidence_state: evidenceState,
      filing_strategy: filingStrategy,
      explanation_payload: explanationPayload,
      operational_state: operationalState,
      operational_explanation: operationalExplanation,
      operational_updated_at: decisionIntelligence?.operational_updated_at || null,
      proof_status: proofStatus,
      missing_requirements: missingRequirements,
      manual_review_reason: manualReviewReason,
      payout_proof_status: actualPayoutAmount != null
        ? 'verified'
        : normalize(record.recovery_status) === 'quarantined'
          ? 'quarantined'
          : APPROVED_STATUSES.has(normalize(record.status))
            ? 'awaiting_payout'
            : 'not_applicable',
      quarantine_reason: normalize(record.recovery_status) === 'quarantined'
        ? (record.last_error || null)
        : null,
      matched_document_count: matchedDocumentCount,
      rejection_category: rejectionCategory,
      rejection_reason: rejectionReason,
      created_at: record.created_at || null,
      updated_at: record.updated_at || record.created_at || null,
      amazon_case_id: record.amazon_case_id || null,
      store_name: storeById.get(record.store_id) || null,
      order_id: record.order_id || detection?.order_id || null,
      sku: record.sku || detection?.sku || null,
      asin: record.asin || detection?.asin || null,
      expected_payout_amount: actualPayoutAmount == null && record.expected_payout_date ? approvedAmount : null,
      expected_payout_date: record.expected_payout_date || null,
      submission_proof: buildSubmissionProof(latestSubmission)
    };

    return {
      ...row,
      ...deriveQueueActionTruth(row),
      next_action: deriveNextAction(row)
    };
  });

  const detectedRows = orphanDetections.map((record: any) => {
    const matchedDocumentCount = getMatchedDocumentCount(record, 0);
    const confidenceScore = toNumber(record.confidence_score) ?? 0;
    const isSupportable = matchedDocumentCount > 0 && confidenceScore >= DETECTED_FILING_READY_THRESHOLD;
    const eligibilityStatus: EligibilityStatus = matchedDocumentCount > 0 ? 'SAFETY_HOLD' : 'INSUFFICIENT_DATA';
    const identityTruth = deriveRowIdentityTruth('detection', null);
    const row = {
      dispute_case_id: record.id,
      detection_result_id: record.id,
      ...identityTruth,
      case_number: buildOpportunityCaseNumber(record.id),
      claim_number: buildOpportunityCaseNumber(record.id),
      case_type: record.case_type || record.anomaly_type || null,
      anomaly_type: record.anomaly_type || record.case_type || null,
      case_origin: 'detection_pipeline',
      status: record.status || 'detected',
      filing_status: null,
      recovery_status: null,
      billing_status: null,
      eligibility_status: eligibilityStatus,
      eligible_to_file: false,
      block_reasons: matchedDocumentCount === 0 ? ['missing_evidence'] : ['supportable_but_not_case_eligible'],
      requested_amount: toMoney(record.estimated_value),
      approved_amount: null,
      actual_payout_amount: null,
      billed_amount: null,
      currency: record.currency || 'USD',
      evidence_state: deriveEvidenceState(
        {
          ...record,
          eligible_to_file: false,
          filing_status: null,
          block_reasons: matchedDocumentCount === 0 ? ['missing_evidence'] : ['supportable_but_not_case_eligible']
        },
        matchedDocumentCount
      ),
      filing_strategy: null,
      explanation_payload: null,
      operational_state: null,
      operational_explanation: null,
      operational_updated_at: null,
      proof_status: isSupportable ? 'supportable_but_not_case_eligible' : 'missing_requirements',
      missing_requirements: matchedDocumentCount > 0 ? ['case_creation_required'] : ['supporting_document'],
      manual_review_reason: matchedDocumentCount === 0 ? 'missing_evidence' : 'supportable_but_not_case_eligible',
      payout_proof_status: 'not_applicable',
      quarantine_reason: null,
      matched_document_count: matchedDocumentCount,
      rejection_category: null,
      rejection_reason: null,
      created_at: record.created_at || null,
      updated_at: record.updated_at || record.created_at || null,
      amazon_case_id: null,
      store_name: storeById.get(record.store_id) || null,
      order_id: record.order_id || record.evidence?.order_id || null,
      sku: record.sku || record.evidence?.sku || null,
      asin: record.asin || record.evidence?.asin || null,
      expected_payout_amount: toMoney(record.estimated_value),
      expected_payout_date: null,
      submission_proof: null
    };

    return {
      ...row,
      ...deriveQueueActionTruth(row),
      next_action: deriveNextAction(row)
    };
  });

  const allRows = [...enrichedRows, ...detectedRows];

  const search = normalize(filters.search);
  const evidenceFilter = normalize(filters.evidence_state);
  const rejectionCategoryFilter = normalize(filters.rejection_category);
  const statusFilter = normalize(filters.status);
  const gateStateFilter = normalize(filters.gate_state);
  const filingStatusFilter = normalize(filters.filing_status);
  const recoveryStatusFilter = normalize(filters.recovery_status);
  const billingStatusFilter = normalize(filters.billing_status);

  const filteredRows = allRows.filter((row) => {
    const searchMatch = !search || [
      row.case_number,
      row.claim_number,
      row.amazon_case_id,
      row.store_name,
      row.order_id,
      row.sku,
      row.asin,
      row.case_type,
      row.anomaly_type,
      row.rejection_reason
    ].some((value) => normalize(value).includes(search));

    const statusMatch = !statusFilter || statusFilter === 'all' || normalize(row.status) === statusFilter;
    const gateStateMatch = !gateStateFilter || gateStateFilter === 'all' || (() => {
      const eligibilityStatus = normalize(deriveEligibilityStatus(row));
      const filingStatus = normalize(row.filing_status);

      switch (gateStateFilter) {
        case 'ready':
          return eligibilityStatus === 'ready';
        case 'blocked':
          return filingStatus === 'blocked'
            || filingStatus === 'pending_safety_verification'
            || ['duplicate_blocked', 'insufficient_data', 'thread_only', 'safety_hold'].includes(eligibilityStatus);
        case 'duplicate_blocked':
          return eligibilityStatus === 'duplicate_blocked';
        case 'insufficient_data':
          return eligibilityStatus === 'insufficient_data';
        case 'thread_only':
          return eligibilityStatus === 'thread_only';
        case 'safety_hold':
          return eligibilityStatus === 'safety_hold';
        case 'pending_safety_verification':
          return filingStatus === 'pending_safety_verification';
        default:
          return true;
      }
    })();
    const filingMatch = !filingStatusFilter || filingStatusFilter === 'all' || normalize(row.filing_status) === filingStatusFilter;
    const recoveryMatch = !recoveryStatusFilter || recoveryStatusFilter === 'all' || normalize(row.recovery_status) === recoveryStatusFilter;
    const billingMatch = !billingStatusFilter || billingStatusFilter === 'all' || normalize(row.billing_status) === billingStatusFilter;
    const evidenceMatch = !evidenceFilter || evidenceFilter === 'all' || normalize(row.evidence_state) === evidenceFilter;
    const rejectionMatch = !rejectionCategoryFilter || rejectionCategoryFilter === 'all' || normalize(row.rejection_category) === rejectionCategoryFilter;
    return searchMatch && statusMatch && gateStateMatch && filingMatch && recoveryMatch && billingMatch && evidenceMatch && rejectionMatch;
  });

  const sortedRows = [...filteredRows].sort((left, right) => {
    const leftValue = (left as any)[sortBy];
    const rightValue = (right as any)[sortBy];
    const comparison = compareValues(leftValue, rightValue);
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const pagedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  const summaryInputIds = Array.from(
    new Set(
      filteredRows
        .map((row) => String(row.dispute_case_id || row.detection_result_id || '').trim())
        .filter(Boolean)
    )
  );

  const financialTruth = summaryInputIds.length
    ? await recoveryFinancialTruthService.getFinancialTruth({
        tenantId: scope.tenantId,
        caseIds: summaryInputIds
      })
    : null;

  const verifiedPaidCount = financialTruth
    ? financialTruth.summaries.filter((summary) => summary.payout_status === 'paid').length
    : null;
  const financialTruthByInputId = new Map(
    (financialTruth?.summaries || []).map((summary) => [String(summary.input_id || '').trim(), summary])
  );

  const supportableRows = filteredRows.filter((row) => {
    const filingStatus = normalize(row.filing_status);
    return row.has_real_dispute_case === true
      && typeof row.requested_amount === 'number'
      && row.requested_amount > 0
      && ['pending', 'retrying', 'pending_approval'].includes(filingStatus);
  });

  const supportableCurrencies = Array.from(
    new Set(
      supportableRows
        .map((row) => String(row.currency || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const supportableClaimCount = supportableRows.length;
  const supportableReadyToFileCount = supportableRows.filter((row) => row.can_file || row.can_retry || row.can_approve).length;
  const supportableCurrency = supportableCurrencies.length === 1 ? supportableCurrencies[0] : null;
  const supportableClaimValue = supportableCurrency
    ? Number(
        supportableRows
          .reduce((sum, row) => sum + Number(row.requested_amount || 0), 0)
          .toFixed(2)
      )
    : null;

  const getFinancialSummaryForRow = (row: any) => {
    const inputId = String(row.dispute_case_id || row.detection_result_id || '').trim();
    return financialTruthByInputId.get(inputId) || null;
  };

  const hasLinkedDisputeCase = (row: any) => row.has_real_dispute_case === true && Boolean(row.linked_dispute_case_id);

  const isRejectedRow = (row: any) =>
    REJECTED_STATUSES.has(normalize(row.status)) || Boolean(row.rejection_reason) || Boolean(row.rejection_category);

  const isRecoveredRow = (row: any) => {
    const financialSummary = getFinancialSummaryForRow(row);
    return normalize(row.recovery_status) === 'reconciled'
      || Boolean(row.actual_payout_amount)
      || financialSummary?.payout_status === 'paid';
  };

  const isFiledRow = (row: any) => {
    const filingStatus = normalize(row.filing_status);
    const status = normalize(row.status);
    return hasLinkedDisputeCase(row)
      && (FILED_STATUSES.has(filingStatus) || ACTIVE_AMAZON_REVIEW_STATUSES.has(status));
  };

  const isApprovedPendingPayoutRow = (row: any) => {
    const status = normalize(row.status);
    return hasLinkedDisputeCase(row)
      && APPROVED_STATUSES.has(status)
      && !isRecoveredRow(row);
  };

  const isBillingPendingRow = (row: any) => {
    const billingStatus = normalize(row.billing_status);
    return billingStatus === 'pending' && isRecoveredRow(row);
  };

  const isBlockedRow = (row: any) => {
    if (row.can_file === true || row.can_retry === true || row.can_approve === true) {
      return false;
    }
    if (isFiledRow(row) || isApprovedPendingPayoutRow(row) || isRecoveredRow(row) || isRejectedRow(row)) {
      return false;
    }

    const eligibilityStatus = normalize(deriveEligibilityStatus(row));
    const filingStatus = normalize(row.filing_status);
    const evidenceState = normalize(row.evidence_state);
    const operationalState = normalize(row.operational_state);

    return ['duplicate_blocked', 'thread_only', 'insufficient_data', 'safety_hold'].includes(eligibilityStatus)
      || BLOCKED_FILING_STATUSES.has(filingStatus)
      || BLOCKED_EVIDENCE_STATES.has(evidenceState)
      || ['blocked_operational', 'failed_durable'].includes(operationalState);
  };

  const blockedCount = filteredRows.filter(isBlockedRow).length;
  const readyToFileCount = filteredRows.filter((row) => row.can_file === true).length;
  const filedCount = filteredRows.filter(isFiledRow).length;
  const rejectedCount = filteredRows.filter((row) => REJECTED_STATUSES.has(normalize(row.status)) || !!row.rejection_reason || !!row.rejection_category).length;
  const approvedPendingPayoutCount = filteredRows.filter(isApprovedPendingPayoutRow).length;
  const recoveredCount = filteredRows.filter(isRecoveredRow).length;
  const billingPendingCount = filteredRows.filter(isBillingPendingRow).length;

  const lastUpdatedAt = filteredRows
    .map((row) => row.updated_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] || null;

  return {
    tenant_id: scope.tenantId,
    tenant_slug: scope.tenantSlug,
    total_cases: allRows.length,
    filtered_results: filteredRows.length,
    blocked_count: blockedCount,
    ready_to_file_count: readyToFileCount,
    filed_count: filedCount,
    rejected_count: rejectedCount,
    approved_pending_payout_count: approvedPendingPayoutCount,
    recovered_count: recoveredCount,
    verified_paid_count: verifiedPaidCount,
    billing_pending_count: billingPendingCount,
    supportable_claim_count: supportableClaimCount,
    supportable_claim_value: supportableClaimValue,
    supportable_ready_to_file_count: supportableReadyToFileCount,
    supportable_currency: supportableCurrency,
    last_updated_at: lastUpdatedAt,
    page,
    page_size: pageSize,
    rows: pagedRows
  };
}
