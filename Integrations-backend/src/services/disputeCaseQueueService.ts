import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';

export interface DisputeCaseQueueFilters {
  tenantSlug?: string;
  explicitTenantId?: string;
  requestTenantId?: string | null;
  requestTenantSlug?: string | null;
  userId?: string | null;
  search?: string;
  status?: string;
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

const BILLING_COMPLETE_STATUSES = new Set(['paid', 'charged', 'credited', 'completed']);
const REJECTED_STATUSES = new Set(['rejected', 'denied']);
const APPROVED_STATUSES = new Set(['approved', 'won']);
const FILED_STATUSES = new Set(['filed', 'submitted', 'resubmitted', 'filing', 'submitting']);
const REVIEW_FILINGS = new Set([
  'pending_approval',
  'quarantined_dangerous_doc',
  'blocked_invalid_date',
  'duplicate_blocked',
  'already_reimbursed',
  'skipped_low_value'
]);
const INVALID_TENANT_SLUGS = new Set(['default', 'beta', 'null', 'undefined']);

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
  if (record?.evidence_attachments?.document_id) return 1;
  if (Array.isArray(record?.evidence_document_ids)) return record.evidence_document_ids.length;
  return 0;
}

function deriveEvidenceState(record: any, matchedDocumentCount: number) {
  const filingStatus = normalize(record?.filing_status);
  const rejectionCategory = record?.evidence_attachments?.rejection_category || null;
  const rejectionReason = record?.rejection_reason || null;
  const blockReasons = Array.isArray(record?.block_reasons) ? record.block_reasons : [];
  const matchConfidence = toNumber(record?.evidence_attachments?.match_confidence);

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

  if (BILLING_COMPLETE_STATUSES.has(billingStatus)) return 'Billing complete';
  if (recoveryStatus === 'reconciled' && billingStatus === 'pending') return 'Billing pending';
  if (recoveryStatus === 'reconciled') return 'Recovered';
  if (row.actual_payout_amount) return 'Payout detected, review reconciliation';
  if (REJECTED_STATUSES.has(status) || row.rejection_reason || row.rejection_category) return 'Review rejection';
  if (APPROVED_STATUSES.has(status)) return 'Waiting for payout';
  if (FILED_STATUSES.has(filingStatus)) return 'Filed / awaiting Amazon';
  if (filingStatus === 'blocked' || row.eligible_to_file === false) return 'Blocked';
  if (row.evidence_state === 'Missing Evidence') return 'Waiting for evidence';
  if (row.evidence_state === 'Weak Evidence' || row.evidence_state === 'Needs Review') return 'Needs review';
  if (row.eligible_to_file === true && ['pending', 'retrying'].includes(filingStatus)) return 'Ready to file';
  return 'Manual review';
}

export async function getDisputeCaseQueue(filters: DisputeCaseQueueFilters) {
  const scope = await resolveScope(filters);
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.page_size) || 25));
  const sortBy = String(filters.sort_by || 'updated_at');
  const sortOrder = normalize(filters.sort_order) === 'asc' ? 'asc' : 'desc';

  const totalCasesQuery = await supabaseAdmin
    .from('dispute_cases')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', scope.tenantId);

  if (totalCasesQuery.error) {
    throw new Error('Failed to count dispute cases');
  }

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

    if (filters.status && filters.status !== 'all') {
      disputeQuery = disputeQuery.eq('status', filters.status);
    }
    if (filters.filing_status && filters.filing_status !== 'all') {
      disputeQuery = disputeQuery.eq('filing_status', filters.filing_status);
    }
    if (filters.recovery_status && filters.recovery_status !== 'all') {
      disputeQuery = disputeQuery.eq('recovery_status', filters.recovery_status);
    }
    if (filters.billing_status && filters.billing_status !== 'all') {
      disputeQuery = disputeQuery.eq('billing_status', filters.billing_status);
    }

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
  const storeIds = rows.map((row: any) => row.store_id).filter(Boolean);

  const [{ data: evidenceLinks }, { data: detectionRows }, { data: stores }, { data: billingRows }] = await Promise.all([
    disputeIds.length
      ? supabaseAdmin
          .from('dispute_evidence_links')
          .select('dispute_case_id, evidence_document_id')
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
      : Promise.resolve({ data: [] as any[] })
  ]);

  const evidenceCountByCase = new Map<string, number>();
  for (const link of evidenceLinks || []) {
    const current = evidenceCountByCase.get(link.dispute_case_id) || 0;
    evidenceCountByCase.set(link.dispute_case_id, current + 1);
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

  const enrichedRows = rows.map((record: any) => {
    const detection = record.detection_result_id ? detectionById.get(record.detection_result_id) : null;
    const latestBilling = latestBillingByDisputeId.get(record.id);
    const decisionIntelligence = record?.evidence_attachments?.decision_intelligence || {};
    const proofSnapshot = decisionIntelligence?.proof_snapshot || null;
    const filingStrategy = typeof decisionIntelligence?.filing_strategy === 'string'
      ? decisionIntelligence.filing_strategy
      : null;
    const explanationPayload = decisionIntelligence?.explanation_payload || proofSnapshot?.explanationPayload || null;
    const matchedDocumentCount = getMatchedDocumentCount(record, evidenceCountByCase.get(record.id) || 0);
    const requestedAmount = toMoney(record.claim_amount);
    const approvedAmount = deriveApprovedAmount(record);
    const actualPayoutAmount = toMoney(record.recovered_amount ?? record.actual_payout_amount);
    const billedAmount = latestBilling?.platform_fee_cents != null
      ? Number((Number(latestBilling.platform_fee_cents) / 100).toFixed(2))
      : toMoney(record?.billed_amount);
    const billingStatus = normalize(latestBilling?.billing_status || record.billing_status) || null;
    const rejectionCategory = record?.evidence_attachments?.rejection_category || null;
    const rejectionReason = record?.rejection_reason || null;
    const evidenceState = deriveEvidenceState(record, matchedDocumentCount);

    const row = {
      dispute_case_id: record.id,
      detection_result_id: record.detection_result_id || null,
      case_number: record.case_number || null,
      claim_number: record.claim_id || record.case_number || null,
      case_type: record.case_type || detection?.anomaly_type || null,
      anomaly_type: detection?.anomaly_type || record.case_type || null,
      status: record.status || null,
      filing_status: record.filing_status || null,
      recovery_status: record.recovery_status || null,
      billing_status: billingStatus,
      eligible_to_file: record.eligible_to_file === true,
      block_reasons: Array.isArray(record.block_reasons) ? record.block_reasons : [],
      requested_amount: requestedAmount,
      approved_amount: approvedAmount,
      actual_payout_amount: actualPayoutAmount,
      billed_amount: billedAmount,
      currency: record.currency || 'USD',
      evidence_state: evidenceState,
      filing_strategy: filingStrategy,
      explanation_payload: explanationPayload,
      proof_status: proofSnapshot?.filingRecommendation || null,
      missing_requirements: Array.isArray(proofSnapshot?.missingRequirements) ? proofSnapshot.missingRequirements : [],
      manual_review_reason: Array.isArray(record.block_reasons) && record.block_reasons.length > 0
        ? record.block_reasons[0]
        : (proofSnapshot?.riskFlags?.[0] || null),
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
      expected_payout_date: record.expected_payout_date || null
    };

    return {
      ...row,
      next_action: deriveNextAction(row)
    };
  });

  const search = normalize(filters.search);
  const evidenceFilter = normalize(filters.evidence_state);
  const rejectionCategoryFilter = normalize(filters.rejection_category);

  const filteredRows = enrichedRows.filter((row) => {
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

    const evidenceMatch = !evidenceFilter || evidenceFilter === 'all' || normalize(row.evidence_state) === evidenceFilter;
    const rejectionMatch = !rejectionCategoryFilter || rejectionCategoryFilter === 'all' || normalize(row.rejection_category) === rejectionCategoryFilter;
    return searchMatch && evidenceMatch && rejectionMatch;
  });

  const sortedRows = [...filteredRows].sort((left, right) => {
    const leftValue = (left as any)[sortBy];
    const rightValue = (right as any)[sortBy];
    const comparison = compareValues(leftValue, rightValue);
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const pagedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  const blockedCount = filteredRows.filter((row) => ['Waiting for evidence', 'Needs review', 'Review rejection'].includes(row.next_action)).length;
  const readyToFileCount = filteredRows.filter((row) => row.next_action === 'Ready to file').length;
  const filedCount = filteredRows.filter((row) => row.next_action === 'Filed / awaiting Amazon').length;
  const rejectedCount = filteredRows.filter((row) => REJECTED_STATUSES.has(normalize(row.status)) || !!row.rejection_reason || !!row.rejection_category).length;
  const approvedPendingPayoutCount = filteredRows.filter((row) => APPROVED_STATUSES.has(normalize(row.status)) && !row.actual_payout_amount).length;
  const recoveredCount = filteredRows.filter((row) => normalize(row.recovery_status) === 'reconciled' || !!row.actual_payout_amount).length;
  const billingPendingCount = filteredRows.filter((row) => row.next_action === 'Billing pending').length;

  const lastUpdatedAt = filteredRows
    .map((row) => row.updated_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] || null;

  return {
    tenant_id: scope.tenantId,
    tenant_slug: scope.tenantSlug,
    total_cases: totalCasesQuery.count || 0,
    filtered_results: filteredRows.length,
    blocked_count: blockedCount,
    ready_to_file_count: readyToFileCount,
    filed_count: filedCount,
    rejected_count: rejectedCount,
    approved_pending_payout_count: approvedPendingPayoutCount,
    recovered_count: recoveredCount,
    billing_pending_count: billingPendingCount,
    last_updated_at: lastUpdatedAt,
    page,
    page_size: pageSize,
    rows: pagedRows
  };
}
