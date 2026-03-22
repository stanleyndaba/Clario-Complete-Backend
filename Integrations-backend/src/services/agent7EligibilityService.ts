import { supabaseAdmin } from '../database/supabaseClient';

export interface FilingEligibilityResult {
  eligible: boolean;
  reasons: string[];
  confidenceScore: number | null;
  claimType: string;
}

interface EligibilityContext {
  disputeCase: any;
  detectionResult: any | null;
  evidenceDocuments: any[];
  linkedEvidenceCount: number;
}

const DEFAULT_CONFIDENCE_THRESHOLD = Number(
  process.env.AGENT7_CONFIDENCE_THRESHOLD ||
  process.env.EVIDENCE_CONFIDENCE_AUTO ||
  '0.85'
);

const CLAIM_WINDOWS_DAYS: Record<string, number> = {
  inbound: 270,
  fc_damage: 60,
  refund_return: 45,
  generic: 90
};

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function parseJsonObject(value: any) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

function getEvidenceExtract(document: any) {
  return parseJsonObject(document?.parsed_metadata) || parseJsonObject(document?.extracted) || {};
}

function getEvidenceItems(document: any): any[] {
  const extract = getEvidenceExtract(document);
  return Array.isArray(extract?.items) ? extract.items : [];
}

function hasDangerousDocument(document: any): boolean {
  const haystack = `${document?.filename || ''} ${document?.raw_text || ''}`.toLowerCase();
  return /(credit\s*note|creditnote|refund|returned?|return\s+authorization|rma|credit memo)/i.test(haystack);
}

function resolveClaimProfile(caseType: string) {
  const normalized = normalize(caseType);
  if (
    normalized.includes('inbound') ||
    normalized.includes('shipment') ||
    normalized.includes('lost') ||
    normalized.includes('missing')
  ) {
    return {
      key: 'inbound',
      windowDays: CLAIM_WINDOWS_DAYS.inbound,
      requiresOrderId: false,
      requiresShipmentId: true,
      requiresProductId: true,
      requiresUnitCost: true,
      requiredDocTypes: ['shipping'],
      requiredOneOfDocTypes: ['invoice', 'po']
    };
  }

  if (
    normalized.includes('warehouse') ||
    normalized.includes('fulfillment') ||
    normalized.includes('damage') ||
    normalized.includes('fc_')
  ) {
    return {
      key: 'fc_damage',
      windowDays: CLAIM_WINDOWS_DAYS.fc_damage,
      requiresOrderId: false,
      requiresShipmentId: false,
      requiresProductId: true,
      requiresUnitCost: true,
      requiredDocTypes: [],
      requiredOneOfDocTypes: ['invoice', 'po']
    };
  }

  if (normalized.includes('refund') || normalized.includes('return')) {
    return {
      key: 'refund_return',
      windowDays: CLAIM_WINDOWS_DAYS.refund_return,
      requiresOrderId: true,
      requiresShipmentId: false,
      requiresProductId: true,
      requiresUnitCost: true,
      requiredDocTypes: [],
      requiredOneOfDocTypes: ['invoice', 'po']
    };
  }

  return {
    key: 'generic',
    windowDays: CLAIM_WINDOWS_DAYS.generic,
    requiresOrderId: false,
    requiresShipmentId: false,
    requiresProductId: true,
    requiresUnitCost: true,
    requiredDocTypes: [],
    requiredOneOfDocTypes: ['invoice', 'po']
  };
}

function collectIdentifiers(context: EligibilityContext) {
  const disputeCase = context.disputeCase || {};
  const detectionResult = context.detectionResult || {};
  const caseEvidence = parseJsonObject(disputeCase.evidence_attachments);
  const detectionEvidence = parseJsonObject(detectionResult.evidence);

  const shipmentIds = uniqueStrings([
    disputeCase.shipment_id,
    disputeCase.fba_shipment_id,
    disputeCase.reference_id,
    detectionEvidence.shipment_id,
    detectionEvidence.fba_shipment_id,
    detectionEvidence.reference_id,
    caseEvidence.shipment_id
  ]);

  const orderIds = uniqueStrings([
    disputeCase.order_id,
    detectionResult.order_id,
    detectionEvidence.order_id,
    caseEvidence.order_id
  ]);

  const productIds = uniqueStrings([
    disputeCase.sku,
    disputeCase.asin,
    detectionResult.sku,
    detectionResult.asin,
    detectionEvidence.sku,
    detectionEvidence.asin,
    detectionEvidence.fnsku,
    caseEvidence.sku,
    caseEvidence.asin,
    caseEvidence.fnsku
  ]);

  return { shipmentIds, orderIds, productIds };
}

function resolveReferenceDate(context: EligibilityContext, claimType: string): Date | null {
  const disputeCase = context.disputeCase || {};
  const detectionResult = context.detectionResult || {};
  const caseEvidence = parseJsonObject(disputeCase.evidence_attachments);
  const detectionEvidence = parseJsonObject(detectionResult.evidence);

  const profile = resolveClaimProfile(claimType);
  const candidates = [
    detectionEvidence.report_date,
    detectionEvidence.reported_at,
    detectionEvidence.discovery_date,
    detectionEvidence.discovered_at,
    detectionEvidence.event_date,
    detectionEvidence.delivery_date,
    detectionEvidence.shipment_received_at,
    caseEvidence.report_date,
    caseEvidence.discovery_date,
    disputeCase.submission_date
  ];

  if (profile.key === 'inbound') {
    candidates.unshift(
      detectionEvidence.shipment_date,
      detectionEvidence.delivered_at,
      detectionEvidence.shipment_delivered_at
    );
  }

  for (const candidate of candidates) {
    const parsed = candidate ? new Date(String(candidate)) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function matchesCaseIdentity(document: any, identifiers: ReturnType<typeof collectIdentifiers>) {
  const extract = getEvidenceExtract(document);
  const items = getEvidenceItems(document);
  const normalizedProducts = new Set(identifiers.productIds.map((value) => normalize(value)));
  const normalizedOrders = new Set(identifiers.orderIds.map((value) => normalize(value)));
  const normalizedShipments = new Set(identifiers.shipmentIds.map((value) => normalize(value)));

  const extractValues = uniqueStrings([
    extract?.sku,
    extract?.asin,
    extract?.fnsku,
    extract?.order_id,
    extract?.shipment_id,
    extract?.fba_shipment_id,
    ...(Array.isArray(extract?.skus) ? extract.skus : []),
    ...(Array.isArray(extract?.asins) ? extract.asins : []),
    ...(Array.isArray(extract?.order_ids) ? extract.order_ids : []),
    ...(Array.isArray(extract?.shipment_ids) ? extract.shipment_ids : [])
  ]).map((value) => normalize(value));

  const itemValues = items.flatMap((item) => uniqueStrings([
    item?.sku,
    item?.asin,
    item?.fnsku
  ])).map((value) => normalize(value));

  return [...extractValues, ...itemValues].some((value) =>
    normalizedProducts.has(value) || normalizedOrders.has(value) || normalizedShipments.has(value)
  );
}

function hasUnitCostEvidence(documents: any[]) {
  return documents.some((document) => {
    const items = getEvidenceItems(document);
    return items.some((item) => {
      const unitCost = toNumber(item?.unit_cost ?? item?.unitPrice ?? item?.cost);
      return unitCost !== null && unitCost > 0;
    });
  });
}

function getConfidenceScore(context: EligibilityContext): number | null {
  const disputeCase = context.disputeCase || {};
  const detectionResult = context.detectionResult || {};
  const attachmentConfidence = toNumber(parseJsonObject(disputeCase.evidence_attachments)?.match_confidence);
  const matchConfidence = toNumber(detectionResult.match_confidence);
  const detectionConfidence = toNumber(detectionResult.confidence_score);
  return attachmentConfidence ?? matchConfidence ?? detectionConfidence ?? null;
}

function normalizeStoredReasons(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean);
      }
    } catch {
      return [value];
    }
  }
  return [];
}

export function evaluateCaseEligibility(context: EligibilityContext): FilingEligibilityResult {
  const disputeCase = context.disputeCase || {};
  const detectionResult = context.detectionResult || {};
  const filingStatus = normalize(disputeCase.filing_status);
  const status = normalize(disputeCase.status);
  const recoveryStatus = normalize(disputeCase.recovery_status);
  const billingStatus = normalize(disputeCase.billing_status);
  const claimType = normalize(disputeCase.case_type || detectionResult.anomaly_type || 'generic');
  const profile = resolveClaimProfile(claimType);
  const identifiers = collectIdentifiers(context);
  const confidenceScore = getConfidenceScore(context);
  const reasons = new Set<string>();
  const evidenceDocuments = context.evidenceDocuments || [];
  const storedReasons = normalizeStoredReasons(disputeCase.block_reasons);

  for (const reason of storedReasons) {
    if (reason) reasons.add(reason);
  }

  if (!context.linkedEvidenceCount || evidenceDocuments.length === 0) {
    reasons.add('missing_evidence_links');
  }

  if (!identifiers.productIds.length && profile.requiresProductId) {
    reasons.add('missing_product_identifier');
  }

  if (!identifiers.orderIds.length && profile.requiresOrderId) {
    reasons.add('missing_order_identifier');
  }

  if (!identifiers.shipmentIds.length && profile.requiresShipmentId) {
    reasons.add('missing_shipment_identifier');
  }

  if (!['pending', 'retrying', 'pending_approval', 'blocked', 'failed'].includes(filingStatus)) {
    reasons.add(`case_not_ready_for_filing_status:${filingStatus || 'unknown'}`);
  }

  if (['approved', 'rejected', 'denied', 'closed', 'won'].includes(status)) {
    reasons.add(`case_status_not_fileable:${status}`);
  }

  if (['reconciled', 'matched'].includes(recoveryStatus) || toNumber(disputeCase.recovered_amount) || toNumber(disputeCase.actual_payout_amount)) {
    reasons.add('already_recovered_or_reconciled');
  }

  if (billingStatus && billingStatus !== 'pending') {
    reasons.add(`billing_conflict:${billingStatus}`);
  }

  if (['duplicate_blocked', 'already_reimbursed', 'quarantined_dangerous_doc', 'payment_required'].includes(filingStatus)) {
    reasons.add(`filing_conflict:${filingStatus}`);
  }

  if (evidenceDocuments.some((document) => hasDangerousDocument(document))) {
    reasons.add('dangerous_or_prohibited_document_detected');
  }

  const invalidDocs = evidenceDocuments.filter((document) => {
    const parserStatus = normalize(document.parser_status);
    return !['completed', 'processing'].includes(parserStatus);
  });
  if (invalidDocs.length > 0) {
    reasons.add('evidence_not_fully_parsed');
  }

  const matchedDocs = evidenceDocuments.filter((document) => matchesCaseIdentity(document, identifiers));
  if (evidenceDocuments.length > 0 && matchedDocs.length === 0) {
    reasons.add('evidence_identity_mismatch');
  }

  for (const requiredType of profile.requiredDocTypes) {
    if (!evidenceDocuments.some((document) => normalize(document.doc_type) === requiredType)) {
      reasons.add(`missing_required_document_type:${requiredType}`);
    }
  }

  if (
    profile.requiredOneOfDocTypes.length > 0 &&
    !evidenceDocuments.some((document) => profile.requiredOneOfDocTypes.includes(normalize(document.doc_type)))
  ) {
    reasons.add(`missing_required_document_family:${profile.requiredOneOfDocTypes.join('|')}`);
  }

  if (profile.requiresUnitCost && !hasUnitCostEvidence(evidenceDocuments)) {
    reasons.add('missing_unit_cost_proof');
  }

  if (confidenceScore === null) {
    reasons.add('missing_match_confidence');
  } else if (confidenceScore < DEFAULT_CONFIDENCE_THRESHOLD) {
    reasons.add(`confidence_below_threshold:${confidenceScore.toFixed(3)}`);
  }

  const referenceDate = resolveReferenceDate(context, claimType);
  if (!referenceDate) {
    reasons.add('missing_policy_window_reference_date');
  } else {
    const ageDays = (Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > profile.windowDays) {
      reasons.add(`outside_policy_window:${profile.windowDays}d`);
    }
  }

  return {
    eligible: reasons.size === 0,
    reasons: Array.from(reasons),
    confidenceScore,
    claimType: profile.key
  };
}

export async function loadEligibilityContext(caseId: string, tenantId: string): Promise<EligibilityContext> {
  const { data: disputeCase, error: disputeError } = await supabaseAdmin
    .from('dispute_cases')
    .select('*')
    .eq('id', caseId)
    .eq('tenant_id', tenantId)
    .single();

  if (disputeError || !disputeCase) {
    throw new Error('Dispute case not found');
  }

  const detectionId = disputeCase.detection_result_id || null;
  const { data: detectionResult } = detectionId
    ? await supabaseAdmin
        .from('detection_results')
        .select('*')
        .eq('id', detectionId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
    : { data: null as any };

  const { data: evidenceLinks } = await supabaseAdmin
    .from('dispute_evidence_links')
    .select('evidence_document_id')
    .eq('tenant_id', tenantId)
    .eq('dispute_case_id', caseId);

  const evidenceIds = (evidenceLinks || []).map((link: any) => link.evidence_document_id).filter(Boolean);
  const { data: evidenceDocuments } = evidenceIds.length
    ? await supabaseAdmin
        .from('evidence_documents')
        .select('id, doc_type, filename, raw_text, extracted, parsed_metadata, parser_status, document_date, supplier_name, invoice_number, purchase_order_number, total_amount')
        .eq('tenant_id', tenantId)
        .in('id', evidenceIds)
    : { data: [] as any[] };

  return {
    disputeCase,
    detectionResult: detectionResult || null,
    evidenceDocuments: evidenceDocuments || [],
    linkedEvidenceCount: evidenceIds.length
  };
}

export async function evaluateAndPersistCaseEligibility(caseId: string, tenantId: string) {
  const context = await loadEligibilityContext(caseId, tenantId);
  const result = evaluateCaseEligibility(context);
  const disputeCase = context.disputeCase;
  const currentFilingStatus = normalize(disputeCase.filing_status);

  const updates: Record<string, any> = {
    eligible_to_file: result.eligible,
    block_reasons: result.reasons,
    estimated_recovery_amount: toNumber(disputeCase.estimated_recovery_amount) ?? toNumber(disputeCase.claim_amount) ?? 0,
    updated_at: new Date().toISOString()
  };

  if (!result.eligible) {
    updates.last_error = result.reasons.join('; ');
    if (['pending', 'retrying', 'blocked', 'failed', 'pending_approval', ''].includes(currentFilingStatus)) {
      updates.filing_status = 'blocked';
    }
  } else {
    updates.last_error = null;
    if (currentFilingStatus === 'blocked') {
      updates.filing_status = 'pending';
    }
  }

  const { data: updatedCase, error: updateError } = await supabaseAdmin
    .from('dispute_cases')
    .update(updates)
    .eq('id', caseId)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();

  if (updateError) {
    throw new Error(`Failed to persist filing eligibility: ${updateError.message}`);
  }

  return {
    ...result,
    disputeCase: updatedCase,
    detectionResult: context.detectionResult,
    evidenceDocuments: context.evidenceDocuments
  };
}
