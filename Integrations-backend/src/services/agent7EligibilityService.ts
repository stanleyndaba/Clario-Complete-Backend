import { supabaseAdmin } from '../database/supabaseClient';
import {
  AdaptiveDecisionProfile,
  computeEvidenceStrengthSnapshot,
  getAdaptiveDecisionProfile
} from './closedLoopIntelligenceService';

export interface FilingEligibilityResult {
  eligible: boolean;
  reasons: string[];
  confidenceScore: number | null;
  claimType: string;
  proofSnapshot?: ProofSnapshot;
  successProbability?: number | null;
  priorityScore?: number | null;
  evidenceStrength?: number | null;
  adaptiveConfidenceThreshold?: number | null;
  decisionProfile?: AdaptiveDecisionProfile | null;
}

export type FilingStrategy = 'AUTO' | 'SMART' | 'BLOCKED';

export interface ExplanationPayload {
  missing_fields: string[];
  assumptions: string[];
  justification: string;
}

export interface ProofSnapshot {
  claimFamily: string;
  requiredRequirements: string[];
  missingRequirements: string[];
  matchedIdentifiers: {
    productIds: string[];
    orderIds: string[];
    shipmentIds: string[];
  };
  unitCostProofStatus: 'present' | 'missing' | 'not_required';
  deadlineStatus: 'within_window' | 'outside_window' | 'missing_reference_date';
  riskFlags: string[];
  filingRecommendation: 'filing_ready' | 'smart_filing' | 'ineligible';
  filingStrategy: FilingStrategy;
  explanationPayload: ExplanationPayload;
  evidenceDocumentCount: number;
  linkedEvidenceCount: number;
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
  transfer_loss: 90,
  warehouse_damage: 60,
  fee_overcharge: 90,
  missing_return: 45,
  reimbursement_missing: 90,
  refund_return: 45,
  generic: 90
};

const IDENTIFIER_PLACEHOLDER_TOKENS = new Set([
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'unknown',
  'missing',
  'placeholder',
  'sample',
  'demo',
  'test',
  'todo',
  'tbd',
  'fake',
  '-',
  '--'
]);

const IDENTIFIER_SAFETY_REASONS = new Set([
  'missing_product_identifier',
  'missing_order_identifier',
  'missing_shipment_identifier',
  'missing_trustworthy_product_identifier',
  'missing_trustworthy_order_identifier',
  'missing_trustworthy_shipment_identifier',
  'missing_required_identifiers',
  'awaiting_verified_identifiers'
]);

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

function compactIdentifier(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, '');
}

function isPlaceholderIdentifier(value: unknown): boolean {
  const raw = String(value || '').trim();
  const normalized = normalize(raw);
  if (!raw) return true;
  if (IDENTIFIER_PLACEHOLDER_TOKENS.has(normalized)) return true;
  if (/\b(test|demo|sample|placeholder|unknown|missing|fake|dummy|todo|tbd)\b/i.test(raw)) return true;

  const compact = compactIdentifier(raw).toLowerCase();
  if (/^(.)\1{4,}$/.test(compact)) return true;
  if (/^(12345|123456|1234567|12345678|abcdef|abc123)$/i.test(compact)) return true;
  return false;
}

function hasIdentifierCharacters(value: unknown, minimumLength: number): boolean {
  const compact = compactIdentifier(value);
  return compact.length >= minimumLength && /[a-z0-9]/i.test(compact);
}

function isTrustworthyProductIdentifier(value: unknown): boolean {
  const candidate = String(value || '').trim();
  if (!candidate || isPlaceholderIdentifier(candidate)) return false;
  if (/^[A-Z0-9]{10}$/i.test(compactIdentifier(candidate))) return true;
  return hasIdentifierCharacters(candidate, 3);
}

function isTrustworthyOrderIdentifier(value: unknown): boolean {
  const candidate = String(value || '').trim();
  if (!candidate || isPlaceholderIdentifier(candidate)) return false;
  if (/^\d{3}-\d{7}-\d{7}$/.test(candidate)) return true;
  return hasIdentifierCharacters(candidate, 8);
}

function isTrustworthyShipmentIdentifier(value: unknown): boolean {
  const candidate = String(value || '').trim();
  if (!candidate || isPlaceholderIdentifier(candidate)) return false;
  return hasIdentifierCharacters(candidate, 6);
}

export function isIdentifierSafetyReason(reason: string): boolean {
  return IDENTIFIER_SAFETY_REASONS.has(normalize(reason));
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
    normalized.includes('fee') ||
    normalized.includes('overcharge') ||
    normalized.includes('dimension') ||
    normalized.includes('weight') ||
    normalized.includes('storage')
  ) {
    return {
      key: 'fee_overcharge',
      windowDays: CLAIM_WINDOWS_DAYS.fee_overcharge,
      requiresOrderId: false,
      requiresShipmentId: false,
      requiresProductId: true,
      requiresUnitCost: false,
      requiredDocTypes: [],
      requiredOneOfDocTypes: ['invoice', 'inventory', 'reference']
    };
  }

  if (
    normalized.includes('return') ||
    normalized.includes('refund')
  ) {
    return {
      key: 'missing_return',
      windowDays: CLAIM_WINDOWS_DAYS.missing_return,
      requiresOrderId: true,
      requiresShipmentId: false,
      requiresProductId: true,
      requiresUnitCost: true,
      requiredDocTypes: [],
      requiredOneOfDocTypes: ['invoice', 'reference']
    };
  }

  if (
    normalized.includes('reimbursement') ||
    normalized.includes('adjustment')
  ) {
    return {
      key: 'reimbursement_missing',
      windowDays: CLAIM_WINDOWS_DAYS.reimbursement_missing,
      requiresOrderId: false,
      requiresShipmentId: false,
      requiresProductId: true,
      requiresUnitCost: false,
      requiredDocTypes: [],
      requiredOneOfDocTypes: ['inventory', 'reference']
    };
  }

  if (normalized.includes('transfer')) {
    return {
      key: 'transfer_loss',
      windowDays: CLAIM_WINDOWS_DAYS.transfer_loss,
      requiresOrderId: false,
      requiresShipmentId: true,
      requiresProductId: true,
      requiresUnitCost: true,
      requiredDocTypes: ['shipping'],
      requiredOneOfDocTypes: ['invoice', 'po', 'inventory']
    };
  }

  if (
    normalized.includes('warehouse') ||
    normalized.includes('fulfillment') ||
    normalized.includes('damage') ||
    normalized.includes('fc_')
  ) {
    return {
      key: 'warehouse_damage',
      windowDays: CLAIM_WINDOWS_DAYS.warehouse_damage,
      requiresOrderId: false,
      requiresShipmentId: false,
      requiresProductId: true,
      requiresUnitCost: true,
      requiredDocTypes: [],
      requiredOneOfDocTypes: ['invoice', 'po', 'inventory']
    };
  }

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
    normalized.includes('fc_damage')
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

function classifyMissingRequirement(reason: string): string | null {
  if (!reason) return null;
  if (reason === 'missing_evidence_links') return 'evidence_links';
  if (reason.startsWith('insufficient_evidence_documents:')) return 'minimum_evidence_documents';
  if (reason === 'missing_product_identifier') return 'product_identifier';
  if (reason === 'missing_trustworthy_product_identifier') return 'product_identifier';
  if (reason === 'missing_order_identifier') return 'order_identifier';
  if (reason === 'missing_trustworthy_order_identifier') return 'order_identifier';
  if (reason === 'missing_shipment_identifier') return 'shipment_identifier';
  if (reason === 'missing_trustworthy_shipment_identifier') return 'shipment_identifier';
  if (reason.startsWith('missing_required_document_type:')) return `document_type:${reason.split(':')[1]}`;
  if (reason.startsWith('missing_required_document_family:')) return `document_family:${reason.split(':')[1]}`;
  if (reason === 'missing_unit_cost_proof') return 'unit_cost_proof';
  if (reason === 'evidence_not_fully_parsed') return 'parsed_evidence';
  if (reason === 'evidence_identity_mismatch') return 'identity_match';
  if (reason.startsWith('confidence_below_threshold:')) return 'confidence_threshold';
  if (reason === 'missing_policy_window_reference_date') return 'policy_window_reference_date';
  return null;
}

function isHardBlockReason(reason: string): boolean {
  return (
    isIdentifierSafetyReason(reason) ||
    reason === 'missing_evidence_links' ||
    reason === 'dangerous_or_prohibited_document_detected' ||
    reason === 'already_recovered_or_reconciled' ||
    reason === 'evidence_identity_mismatch' ||
    reason.startsWith('outside_policy_window:') ||
    reason.startsWith('filing_conflict:duplicate_blocked') ||
    reason.startsWith('filing_conflict:already_reimbursed') ||
    reason.startsWith('filing_conflict:quarantined_dangerous_doc') ||
    reason.startsWith('filing_conflict:payment_required') ||
    reason.startsWith('case_not_ready_for_filing_status:') ||
    reason.startsWith('case_status_not_fileable:')
  );
}

function finalRequiredIdentifierMissing(
  profile: ReturnType<typeof resolveClaimProfile>,
  trustworthyIdentifiers: {
    trustworthyProductIds: string[];
    trustworthyOrderIds: string[];
    trustworthyShipmentIds: string[];
  }
): boolean {
  return (
    (profile.requiresProductId && trustworthyIdentifiers.trustworthyProductIds.length === 0) ||
    (profile.requiresOrderId && trustworthyIdentifiers.trustworthyOrderIds.length === 0) ||
    (profile.requiresShipmentId && trustworthyIdentifiers.trustworthyShipmentIds.length === 0)
  );
}

function classifyFilingStrategy(reasons: string[]): FilingStrategy {
  if (reasons.some((reason) => isHardBlockReason(reason))) {
    return 'BLOCKED';
  }

  if (reasons.length === 0) {
    return 'AUTO';
  }

  return 'SMART';
}

function classifyFilingRecommendation(strategy: FilingStrategy): ProofSnapshot['filingRecommendation'] {
  if (strategy === 'AUTO') {
    return 'filing_ready';
  }

  if (strategy === 'SMART') {
    return 'smart_filing';
  }

  return 'ineligible';
}

function buildExplanationPayload(params: {
  profile: ReturnType<typeof resolveClaimProfile>;
  reasons: string[];
  missingRequirements: string[];
  filingStrategy: FilingStrategy;
}): ExplanationPayload {
  const { profile, reasons, missingRequirements, filingStrategy } = params;
  const assumptions = new Set<string>();
  const identifierSafetyBlocked = reasons.some((reason) => isIdentifierSafetyReason(reason));

  for (const reason of reasons) {
    if (reason.startsWith('missing_required_document_family:') || reason.startsWith('missing_required_document_type:')) {
      assumptions.add('Claim scope is limited to the linked evidence already verified in the platform.');
    }

    if (reason === 'missing_unit_cost_proof') {
      assumptions.add('Amount should be constrained to the most conservative supported figure available.');
    }

    if (reason === 'evidence_not_fully_parsed') {
      assumptions.add('Structured parsing is incomplete, so filing relies only on verified identifiers and linked documents.');
    }

    if (reason.startsWith('confidence_below_threshold:') || reason === 'missing_match_confidence') {
      assumptions.add('Confidence is below the ideal threshold, so only the strongest verified case facts should be used.');
    }

    if (reason.startsWith('historical_')) {
      assumptions.add('Historical rejection patterns were considered, but the claim can still be filed conservatively.');
    }

    if (reason === 'missing_policy_window_reference_date') {
      assumptions.add('Reference timing is inferred from the best available case timestamps.');
    }

    if (isIdentifierSafetyReason(reason)) {
      assumptions.add('Amazon-facing filing must use seller-verified identifiers, not inferred or placeholder values.');
    }
  }

  let justification = `Claim has complete evidence coverage for ${profile.key} and can be filed without scope reduction.`;
  if (filingStrategy === 'SMART') {
    justification = `Claim has enough verified evidence to file conservatively for ${profile.key}. Missing or weak proof is explicitly disclosed and the claim scope should be reduced to supported facts only.`;
  } else if (filingStrategy === 'BLOCKED') {
    justification = identifierSafetyBlocked
      ? `Claim cannot be filed safely for ${profile.key} because required identifiers are missing or not trustworthy enough to send to Amazon.`
      : `Claim cannot be filed safely for ${profile.key} because the current evidence indicates fraud risk, contradiction, a policy-window violation, or no usable evidence.`;
  }

  return {
    missing_fields: missingRequirements,
    assumptions: Array.from(assumptions),
    justification
  };
}

function buildProofSnapshot(params: {
  profile: ReturnType<typeof resolveClaimProfile>;
  identifiers: ReturnType<typeof collectIdentifiers>;
  reasons: string[];
  evidenceDocuments: any[];
  linkedEvidenceCount: number;
}): ProofSnapshot {
  const { profile, identifiers, reasons, evidenceDocuments, linkedEvidenceCount } = params;
  const requiredRequirements = [
    ...(profile.requiresProductId ? ['product_identifier'] : []),
    ...(profile.requiresOrderId ? ['order_identifier'] : []),
    ...(profile.requiresShipmentId ? ['shipment_identifier'] : []),
    ...(profile.requiresUnitCost ? ['unit_cost_proof'] : []),
    ...profile.requiredDocTypes.map((docType) => `document_type:${docType}`),
    ...(profile.requiredOneOfDocTypes.length > 0
      ? [`document_family:${profile.requiredOneOfDocTypes.join('|')}`]
      : [])
  ];

  const missingRequirements = Array.from(
    new Set(
      reasons
        .map(classifyMissingRequirement)
        .filter((value): value is string => Boolean(value))
    )
  );

  let deadlineStatus: ProofSnapshot['deadlineStatus'] = 'within_window';
  if (reasons.includes('missing_policy_window_reference_date')) {
    deadlineStatus = 'missing_reference_date';
  } else if (reasons.some((reason) => reason.startsWith('outside_policy_window:'))) {
    deadlineStatus = 'outside_window';
  }

  const riskFlags = reasons.filter((reason) => !classifyMissingRequirement(reason));
  const filingStrategy = classifyFilingStrategy(reasons);
  const explanationPayload = buildExplanationPayload({
    profile,
    reasons,
    missingRequirements,
    filingStrategy
  });

  return {
    claimFamily: profile.key,
    requiredRequirements,
    missingRequirements,
    matchedIdentifiers: {
      productIds: identifiers.productIds,
      orderIds: identifiers.orderIds,
      shipmentIds: identifiers.shipmentIds
    },
    unitCostProofStatus: profile.requiresUnitCost
      ? (reasons.includes('missing_unit_cost_proof') ? 'missing' : 'present')
      : 'not_required',
    deadlineStatus,
    riskFlags,
    filingRecommendation: classifyFilingRecommendation(filingStrategy),
    filingStrategy,
    explanationPayload,
    evidenceDocumentCount: evidenceDocuments.length,
    linkedEvidenceCount
  };
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

function isAutoClearableStoredReason(reason: string): boolean {
  const normalized = normalize(reason);
  return (
    normalized === 'missing_evidence_links' ||
    normalized === 'missing_product_identifier' ||
    normalized === 'missing_trustworthy_product_identifier' ||
    normalized === 'missing_order_identifier' ||
    normalized === 'missing_trustworthy_order_identifier' ||
    normalized === 'missing_shipment_identifier' ||
    normalized === 'missing_trustworthy_shipment_identifier' ||
    normalized === 'missing_required_identifiers' ||
    normalized === 'awaiting_verified_identifiers' ||
    normalized === 'missing_required_document_family' ||
    normalized.startsWith('insufficient_evidence_documents:') ||
    normalized.startsWith('historical_') ||
    normalized.startsWith('case_not_ready_for_filing_status:')
  );
}

export function evaluateCaseEligibility(
  context: EligibilityContext,
  options?: {
    confidenceThreshold?: number;
    minEvidenceDocuments?: number;
  }
): FilingEligibilityResult {
  const disputeCase = context.disputeCase || {};
  const detectionResult = context.detectionResult || {};
  const filingStatus = normalize(disputeCase.filing_status);
  const status = normalize(disputeCase.status);
  const recoveryStatus = normalize(disputeCase.recovery_status);
  const billingStatus = normalize(disputeCase.billing_status);
  const claimType = normalize(disputeCase.case_type || detectionResult.anomaly_type || 'generic');
  const profile = resolveClaimProfile(claimType);
  const identifiers = collectIdentifiers(context);
  const trustworthyProductIds = identifiers.productIds.filter((value) => isTrustworthyProductIdentifier(value));
  const trustworthyOrderIds = identifiers.orderIds.filter((value) => isTrustworthyOrderIdentifier(value));
  const trustworthyShipmentIds = identifiers.shipmentIds.filter((value) => isTrustworthyShipmentIdentifier(value));
  const confidenceScore = getConfidenceScore(context);
  const reasons = new Set<string>();
  const evidenceDocuments = context.evidenceDocuments || [];
  const storedReasons = normalizeStoredReasons(disputeCase.block_reasons);

  for (const reason of storedReasons) {
    if (reason && !isAutoClearableStoredReason(reason)) reasons.add(reason);
  }

  const minimumEvidenceDocuments = Math.max(1, Number(options?.minEvidenceDocuments || 1));
  if (!context.linkedEvidenceCount || evidenceDocuments.length === 0) {
    reasons.add('missing_evidence_links');
  } else if (context.linkedEvidenceCount < minimumEvidenceDocuments) {
    reasons.add(`insufficient_evidence_documents:${context.linkedEvidenceCount}/${minimumEvidenceDocuments}`);
  }

  if (profile.requiresProductId) {
    if (!identifiers.productIds.length) {
      reasons.add('missing_product_identifier');
    } else if (!trustworthyProductIds.length) {
      reasons.add('missing_trustworthy_product_identifier');
    }
  }

  if (profile.requiresOrderId) {
    if (!identifiers.orderIds.length) {
      reasons.add('missing_order_identifier');
    } else if (!trustworthyOrderIds.length) {
      reasons.add('missing_trustworthy_order_identifier');
    }
  }

  if (profile.requiresShipmentId) {
    if (!identifiers.shipmentIds.length) {
      reasons.add('missing_shipment_identifier');
    } else if (!trustworthyShipmentIds.length) {
      reasons.add('missing_trustworthy_shipment_identifier');
    }
  }

  if (
    finalRequiredIdentifierMissing(profile, {
      trustworthyProductIds,
      trustworthyOrderIds,
      trustworthyShipmentIds
    })
  ) {
    reasons.add('missing_required_identifiers');
    reasons.add('awaiting_verified_identifiers');
  }

  if (!['pending', 'retrying', 'pending_approval', 'pending_safety_verification', 'blocked', 'failed'].includes(filingStatus)) {
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
  } else {
    const threshold = Number(options?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD);
    if (confidenceScore < threshold) {
      reasons.add(`confidence_below_threshold:${confidenceScore.toFixed(3)}/${threshold.toFixed(3)}`);
    }
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

  const finalReasons = Array.from(reasons);
  const proofSnapshot = buildProofSnapshot({
    profile,
    identifiers,
    reasons: finalReasons,
    evidenceDocuments,
    linkedEvidenceCount: context.linkedEvidenceCount
  });

  return {
    eligible: proofSnapshot.filingStrategy !== 'BLOCKED',
    reasons: finalReasons,
    confidenceScore,
    claimType: profile.key,
    proofSnapshot
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
  const disputeCase = context.disputeCase;
  const currentFilingStatus = normalize(disputeCase.filing_status);
  const storedReasons = normalizeStoredReasons(disputeCase.block_reasons);
  const claimType = normalize(disputeCase.case_type || context.detectionResult?.anomaly_type || 'generic');
  const confidenceScore = getConfidenceScore(context) ?? 0.5;
  const evidenceSnapshot = computeEvidenceStrengthSnapshot({
    evidenceDocuments: context.evidenceDocuments,
    linkedEvidenceCount: context.linkedEvidenceCount,
    matchConfidence: confidenceScore
  });
  const referenceDate = resolveReferenceDate(context, claimType);
  const profile = resolveClaimProfile(claimType);
  const ageDays = referenceDate
    ? (Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)
    : null;
  const daysUntilExpiry = ageDays !== null ? Math.max(0, profile.windowDays - ageDays) : null;
  const decisionProfile = await getAdaptiveDecisionProfile({
    tenantId,
    userId: disputeCase.seller_id,
    anomalyType: context.detectionResult?.anomaly_type || disputeCase.case_type || 'generic',
    claimAmount: toNumber(disputeCase.claim_amount) ?? toNumber(disputeCase.estimated_recovery_amount) ?? 0,
    confidenceScore,
    evidenceStrength: evidenceSnapshot.score,
    daysUntilExpiry
  });

  const result = evaluateCaseEligibility(context, {
    confidenceThreshold: decisionProfile.adaptiveConfidenceThreshold,
    minEvidenceDocuments: decisionProfile.minEvidenceDocuments
  });
  const reasons = new Set(result.reasons);

  if (decisionProfile.successProbability < decisionProfile.autoFileThreshold) {
    reasons.add(`historical_success_probability_below_threshold:${decisionProfile.successProbability.toFixed(3)}`);
  }

  if (
    decisionProfile.dominantRejectionCategory === 'MISSING_DOCUMENT' &&
    context.linkedEvidenceCount < decisionProfile.minEvidenceDocuments
  ) {
    reasons.add('historical_missing_document_risk');
  }

  if (
    decisionProfile.dominantRejectionCategory === 'INSUFFICIENT_EVIDENCE' &&
    evidenceSnapshot.score < 0.7
  ) {
    reasons.add('historical_insufficient_evidence_risk');
  }

  const finalReasons = Array.from(reasons);
  const finalProofSnapshot = buildProofSnapshot({
    profile,
    identifiers: collectIdentifiers(context),
    reasons: finalReasons,
    evidenceDocuments: context.evidenceDocuments,
    linkedEvidenceCount: context.linkedEvidenceCount
  });
  const evidenceAttachment = parseJsonObject(disputeCase.evidence_attachments);
  const finalFilingStrategy = finalProofSnapshot.filingStrategy;

  const updates: Record<string, any> = {
    eligible_to_file: finalFilingStrategy !== 'BLOCKED',
    block_reasons: finalReasons,
    estimated_recovery_amount: toNumber(disputeCase.estimated_recovery_amount) ?? toNumber(disputeCase.claim_amount) ?? 0,
    evidence_attachments: {
      ...evidenceAttachment,
      decision_intelligence: {
        success_probability: decisionProfile.successProbability,
        priority_score: decisionProfile.priorityScore,
        adaptive_confidence_threshold: decisionProfile.adaptiveConfidenceThreshold,
        auto_file_threshold: decisionProfile.autoFileThreshold,
        min_evidence_documents: decisionProfile.minEvidenceDocuments,
        evidence_strength: evidenceSnapshot.score,
        evidence_strength_label: evidenceSnapshot.label,
        dominant_rejection_category: decisionProfile.dominantRejectionCategory,
        filing_strategy: finalFilingStrategy,
        adaptive_strategy_hints: decisionProfile.filingStrategy,
        explanation_payload: finalProofSnapshot.explanationPayload,
        days_until_expiry: daysUntilExpiry,
        adjustments: decisionProfile.adjustments,
        signals: evidenceSnapshot.signals,
        proof_snapshot: finalProofSnapshot,
        filing_recommendation: finalProofSnapshot.filingRecommendation,
        evaluated_at: new Date().toISOString()
      }
    },
    updated_at: new Date().toISOString()
  };

  if (finalFilingStrategy === 'BLOCKED') {
    updates.last_error = finalProofSnapshot.explanationPayload.justification;
    if (['pending', 'retrying', 'blocked', 'failed', 'pending_approval', 'pending_safety_verification', ''].includes(currentFilingStatus)) {
      updates.filing_status = finalReasons.some((reason) => isIdentifierSafetyReason(reason))
        ? 'pending_safety_verification'
        : 'blocked';
    }
  } else {
    updates.last_error = finalFilingStrategy === 'SMART'
      ? finalProofSnapshot.explanationPayload.justification
      : null;
    if (['blocked', 'pending_approval', 'pending_safety_verification', 'failed', ''].includes(currentFilingStatus)) {
      updates.filing_status = 'pending';
    } else if (
      ['blocked', 'pending_approval', 'pending_safety_verification'].includes(currentFilingStatus) &&
      storedReasons.every(isAutoClearableStoredReason)
    ) {
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
    eligible: finalFilingStrategy !== 'BLOCKED',
    reasons: finalReasons,
    confidenceScore: result.confidenceScore,
    claimType: result.claimType,
    proofSnapshot: finalProofSnapshot,
    successProbability: decisionProfile.successProbability,
    priorityScore: decisionProfile.priorityScore,
    evidenceStrength: evidenceSnapshot.score,
    adaptiveConfidenceThreshold: decisionProfile.adaptiveConfidenceThreshold,
    decisionProfile,
    disputeCase: updatedCase,
    detectionResult: context.detectionResult,
    evidenceDocuments: context.evidenceDocuments
  };
}
