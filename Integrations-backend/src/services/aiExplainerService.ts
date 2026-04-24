import crypto from 'crypto';
import config from '../config/env';
import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { getRedisClient } from '../utils/redisClient';
import { getLogger } from '../utils/logger';
import amazonCaseThreadService from './amazonCaseThreadService';
import { evaluateCanonicalEvidenceTruth } from './canonicalEvidenceService';
import { enrichDetectionFinding } from './detectionFindingTruthService';

const logger = getLogger('AiExplainerService');

const DEMO_WORKSPACE_SLUG = 'demo-workspace';
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_CACHE_TTL_SECONDS = 60 * 30;

export const SOURCE_OF_TRUTH_NOTICE =
  "This explanation does not change the case status. Margin's backend records remain the source of truth.";

const SYSTEM_PROMPT = [
  "You are Margin's explanation layer. You explain verified backend data to Amazon sellers in plain English. You are not the source of truth. You must not invent amounts, evidence, Amazon policy text, deadlines, case outcomes, or filing readiness. If a field is missing, say it is not available. If the system has blocked filing, explain why using only the provided fields.",
  'Use plain seller-friendly language.',
  'Avoid legal certainty.',
  'Do not say guaranteed.',
  'Do not say Amazon will approve.',
  "Do not say the seller is owed money unless the backend truth explicitly supports that wording.",
  "Prefer phrasing like 'Margin found a possible recoverable issue' or 'Margin flagged this for review' when certainty is limited.",
  'If data is not available, say it is not available.',
  `Always return the exact source_of_truth_notice string: "${SOURCE_OF_TRUTH_NOTICE}"`,
].join(' ');

const EXPLANATION_RESPONSE_SCHEMA = {
  name: 'margin_explanation_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'summary',
      'why_it_matters',
      'what_margin_found',
      'current_status_explained',
      'what_is_missing',
      'what_happens_next',
      'confidence_note',
      'source_of_truth_notice',
    ],
    properties: {
      summary: { type: 'string', minLength: 1 },
      why_it_matters: { type: 'string', minLength: 1 },
      what_margin_found: { type: 'string', minLength: 1 },
      current_status_explained: { type: 'string', minLength: 1 },
      what_is_missing: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      what_happens_next: { type: 'string', minLength: 1 },
      confidence_note: { type: 'string', minLength: 1 },
      source_of_truth_notice: { type: 'string', minLength: 1 },
    },
  },
} as const;

const EVIDENCE_DOCUMENT_SELECT =
  'id, filename, doc_type, metadata, parsed_metadata, extracted, supplier_name, invoice_number, purchase_order_number, total_amount, currency, unit_manufacturing_cost';

type ExplainObjectType = 'case' | 'recovery' | 'finding';

export type MarginExplanation = {
  summary: string;
  why_it_matters: string;
  what_margin_found: string;
  current_status_explained: string;
  what_is_missing: string[];
  what_happens_next: string;
  confidence_note: string;
  source_of_truth_notice: string;
};

type ExplainRequestScope = {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  requestId: string;
};

type ExplainPromptTruth = {
  workspace: {
    tenant_slug: string;
  };
  object: {
    type: ExplainObjectType;
    entity_type: 'dispute_case' | 'detection';
    record_id: string;
    reference: string | null;
  };
  finding: {
    title: string | null;
    summary: string | null;
    event_label: string | null;
    evidence_summary: string | null;
    recoverability_reason: string | null;
    review_tier: string | null;
    claim_readiness: string | null;
    why_not_claim_ready: string | null;
    coverage_family: string | null;
  } | null;
  policy: {
    title: string | null;
    summary: string | null;
    verification_status: string | null;
    amazon_policy_rule: string | null;
    policy_window_rule: string | null;
    policy_window_start_event: string | null;
    required_evidence: string[];
  } | null;
  movement: {
    state: string | null;
    label: string | null;
    detail: string | null;
    next_action_label: string | null;
    filing_status: string | null;
    case_state: string | null;
    eligibility_status: string | null;
    block_reasons: string[];
  } | null;
  current_status: {
    status: string | null;
    recovery_status: string | null;
    billing_status: string | null;
    amazon_thread_linked: boolean | null;
  };
  amounts: {
    currency: string | null;
    estimated_amount: number | null;
    approved_amount: number | null;
    recovered_amount: number | null;
    value_label: string | null;
  };
  evidence: {
    matched_document_count: number;
    evidence_complete: boolean | null;
    document_labels: string[];
    missing_items: string[];
  };
  amazon_thread: {
    linked: boolean;
    message_count: number;
    last_activity_at: string | null;
    last_message_direction: string | null;
    last_message_status: string | null;
  } | null;
};

type ExplainPromptContext = {
  objectType: ExplainObjectType;
  objectId: string;
  versionHash: string;
  truth: ExplainPromptTruth;
};

type CachedExplanationEnvelope = {
  explanation: MarginExplanation;
  meta: {
    cached: true;
    model: string;
    object_type: ExplainObjectType;
    object_id: string;
    request_id: string;
  };
};

class AiExplainerError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const memoryCache = new Map<string, { expiresAt: number; value: CachedExplanationEnvelope }>();

const isObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
};

const numberValue = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
};

const normalizeString = (value: unknown): string | null => clean(value);

const toOptionalPositiveAmount = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const parseJsonObject = (value: any): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isObject(value) ? value : {};
};

const titleCase = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());

const hashText = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (!isObject(value)) {
    return JSON.stringify(value);
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const buildRequestFingerprint = (tenantId: string, userId: string) =>
  hashText(`${tenantId}:${convertUserIdToUuid(userId)}`).slice(0, 24);

function addEvidenceDocumentId(ids: Set<string>, value: unknown) {
  const text = clean(value);
  if (text) ids.add(text);
}

function collectEvidenceDocumentIds(value: any, ids: Set<string> = new Set()): Set<string> {
  if (!value) return ids;

  if (typeof value === 'string') {
    try {
      return collectEvidenceDocumentIds(JSON.parse(value), ids);
    } catch {
      return ids;
    }
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectEvidenceDocumentIds(entry, ids));
    return ids;
  }

  if (!isObject(value)) {
    return ids;
  }

  Object.entries(value).forEach(([key, rawValue]) => {
    const normalizedKey = key.toLowerCase();
    const singleIdField = ['document_id', 'documentid', 'evidence_document_id', 'evidencedocumentid'];
    const multiIdField = ['document_ids', 'documentids', 'evidence_document_ids', 'evidencedocumentids'];

    if (singleIdField.includes(normalizedKey)) {
      addEvidenceDocumentId(ids, rawValue);
      return;
    }

    if (multiIdField.includes(normalizedKey)) {
      if (Array.isArray(rawValue)) {
        rawValue.forEach((entry) => addEvidenceDocumentId(ids, entry));
      } else {
        addEvidenceDocumentId(ids, rawValue);
      }
      return;
    }

    if (
      normalizedKey.includes('document')
      || normalizedKey.includes('attachment')
      || normalizedKey.includes('evidence')
    ) {
      collectEvidenceDocumentIds(rawValue, ids);
    }
  });

  return ids;
}

function sanitizeDocumentLabel(document: any, fallbackIndex: number): string {
  const metadata = parseJsonObject(document?.metadata);
  const parsed = parseJsonObject(document?.parsed_metadata);
  const extracted = parseJsonObject(document?.extracted);
  const typeLabel = clean(document?.doc_type) || clean(metadata?.doc_type) || clean(metadata?.document_type);

  const explicitCategory = clean(metadata?.document_category)
    || clean(parsed?.document_type)
    || clean(extracted?.document_type);
  const label = explicitCategory || typeLabel || 'evidence document';
  return `${titleCase(label)} ${fallbackIndex + 1}`;
}

async function fetchLinkedEvidenceDocumentsForDispute(disputeCase: any, tenantId: string): Promise<any[]> {
  if (!disputeCase?.id || !tenantId) return [];

  const documentIds = collectEvidenceDocumentIds(disputeCase?.evidence_attachments);

  const { data: docLinks } = await supabaseAdmin
    .from('dispute_evidence_links')
    .select('evidence_document_id')
    .eq('dispute_case_id', disputeCase.id)
    .eq('tenant_id', tenantId);

  (docLinks || []).forEach((row: any) => addEvidenceDocumentId(documentIds, row?.evidence_document_id));

  const ids = Array.from(documentIds);
  if (!ids.length) return [];

  const { data: documents } = await supabaseAdmin
    .from('evidence_documents')
    .select(EVIDENCE_DOCUMENT_SELECT)
    .eq('tenant_id', tenantId)
    .in('id', ids);

  return documents || [];
}

async function verifyTenantMembership(scope: ExplainRequestScope): Promise<void> {
  const userId = convertUserIdToUuid(scope.userId);
  const { data: membership, error } = await supabaseAdmin
    .from('tenant_memberships')
    .select('id')
    .eq('tenant_id', scope.tenantId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new AiExplainerError(500, 'TENANT_MEMBERSHIP_CHECK_FAILED', 'Failed to verify workspace access for AI explanation.');
  }

  if (!membership) {
    throw new AiExplainerError(403, 'TENANT_ACCESS_DENIED', 'You do not have access to this workspace explanation endpoint.');
  }
}

function ensureExplainerIsAvailable(scope: ExplainRequestScope): void {
  if (String(scope.tenantSlug).trim().toLowerCase() !== DEMO_WORKSPACE_SLUG) {
    throw new AiExplainerError(404, 'AI_EXPLAINER_NOT_ENABLED_FOR_TENANT', 'AI explanation is not enabled for this workspace yet.');
  }

  if (String(config.AI_EXPLAINER_ENABLED).trim().toLowerCase() !== 'true') {
    throw new AiExplainerError(503, 'AI_EXPLAINER_DISABLED', 'AI explanation is currently disabled.');
  }

  if (!clean(config.OPENAI_API_KEY)) {
    throw new AiExplainerError(503, 'AI_EXPLAINER_NOT_CONFIGURED', 'AI explanation is not configured on the backend.');
  }
}

async function readCachedExplanation(cacheKey: string): Promise<CachedExplanationEnvelope | null> {
  const memoryHit = memoryCache.get(cacheKey);
  if (memoryHit && memoryHit.expiresAt > Date.now()) {
    return memoryHit.value;
  }

  if (memoryHit) {
    memoryCache.delete(cacheKey);
  }

  try {
    const redisClient = await getRedisClient();
    const cached = await redisClient.get(cacheKey);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (!isObject(parsed) || !isObject(parsed.meta) || !isObject(parsed.explanation)) {
      return null;
    }
    return parsed as CachedExplanationEnvelope;
  } catch {
    return null;
  }
}

async function writeCachedExplanation(cacheKey: string, value: CachedExplanationEnvelope): Promise<void> {
  memoryCache.set(cacheKey, {
    expiresAt: Date.now() + DEFAULT_CACHE_TTL_SECONDS * 1000,
    value,
  });

  try {
    const redisClient = await getRedisClient();
    await redisClient.set(cacheKey, JSON.stringify(value), { EX: DEFAULT_CACHE_TTL_SECONDS });
  } catch {
    // Cache is best effort only.
  }
}

function parseChatCompletionText(payload: any): string {
  const direct = clean(payload?.choices?.[0]?.message?.content);
  if (direct) return direct;

  const contentParts = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(contentParts)) {
    const joined = contentParts
      .map((part: any) => clean(part?.text))
      .filter(Boolean)
      .join('\n');
    if (joined) return joined;
  }

  throw new AiExplainerError(502, 'AI_EXPLAINER_EMPTY_RESPONSE', 'AI explanation returned an empty response.');
}

function normalizeExplanation(payload: any): MarginExplanation {
  const rawMissing = Array.isArray(payload?.what_is_missing)
    ? payload.what_is_missing.map((item: unknown) => clean(item)).filter(Boolean) as string[]
    : [];

  return {
    summary: clean(payload?.summary) || 'Margin generated an explanation, but a short summary was not available.',
    why_it_matters: clean(payload?.why_it_matters) || 'Why this matters is not available from the explanation output.',
    what_margin_found: clean(payload?.what_margin_found) || 'What Margin found is not available from the explanation output.',
    current_status_explained: clean(payload?.current_status_explained) || 'Current status explanation is not available from the explanation output.',
    what_is_missing: rawMissing,
    what_happens_next: clean(payload?.what_happens_next) || 'What happens next is not available from the explanation output.',
    confidence_note: clean(payload?.confidence_note) || 'This explanation is limited to the backend fields available at the time it was generated.',
    source_of_truth_notice: SOURCE_OF_TRUTH_NOTICE,
  };
}

function buildCacheKey(scope: ExplainRequestScope, objectType: ExplainObjectType, objectId: string, versionHash: string): string {
  return [
    'ai_explain',
    scope.tenantId,
    config.AI_EXPLAINER_MODEL,
    objectType,
    objectId,
    versionHash,
  ].join(':');
}

function buildModelInput(context: ExplainPromptContext): string {
  return [
    `Explain this Margin ${context.objectType} using only the backend truth below.`,
    'Return concise seller-friendly prose in the required JSON schema.',
    'If a field is missing, say it is not available.',
    'Do not restate internal implementation details, table names, or mention the LLM.',
    'Backend truth:',
    JSON.stringify(context.truth, null, 2),
  ].join('\n\n');
}

async function callOpenAiExplanation(scope: ExplainRequestScope, context: ExplainPromptContext): Promise<MarginExplanation> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.AI_EXPLAINER_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.AI_EXPLAINER_MODEL,
        temperature: 0.2,
        store: false,
        max_completion_tokens: 700,
        safety_identifier: buildRequestFingerprint(scope.tenantId, scope.userId),
        response_format: {
          type: 'json_schema',
          json_schema: EXPLANATION_RESPONSE_SCHEMA,
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildModelInput(context) },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage =
        clean(payload?.error?.message)
        || clean(payload?.message)
        || `OpenAI request failed with status ${response.status}`;
      throw new AiExplainerError(502, 'AI_EXPLAINER_UPSTREAM_ERROR', errorMessage);
    }

    const text = parseChatCompletionText(payload);
    const parsed = JSON.parse(text);
    return normalizeExplanation(parsed);
  } catch (error: any) {
    if (error instanceof AiExplainerError) {
      throw error;
    }

    if (error?.name === 'AbortError') {
      throw new AiExplainerError(504, 'AI_EXPLAINER_TIMEOUT', 'AI explanation timed out before it could finish.');
    }

    throw new AiExplainerError(502, 'AI_EXPLAINER_REQUEST_FAILED', error?.message || 'AI explanation request failed.');
  } finally {
    clearTimeout(timeoutId);
    logger.info('AI explainer upstream attempt finished', {
      requestId: scope.requestId,
      tenantId: scope.tenantId,
      objectType: context.objectType,
      objectId: context.objectId,
      model: config.AI_EXPLAINER_MODEL,
      latencyMs: Date.now() - startedAt,
    });
  }
}

async function buildFindingContext(scope: ExplainRequestScope, findingId: string): Promise<ExplainPromptContext> {
  const { data: finding, error } = await supabaseAdmin
    .from('detection_results')
    .select('*')
    .eq('tenant_id', scope.tenantId)
    .eq('id', findingId)
    .maybeSingle();

  if (error) {
    throw new AiExplainerError(500, 'FINDING_LOOKUP_FAILED', 'Failed to load the finding for AI explanation.');
  }

  if (!finding) {
    throw new AiExplainerError(404, 'FINDING_NOT_FOUND', 'Finding not found for this workspace.');
  }

  const { data: linkedCase } = await supabaseAdmin
    .from('dispute_cases')
    .select('id, case_number, status, filing_status, case_state, eligibility_status, block_reasons, amazon_case_id, provider_case_id, recovery_status, approved_amount, recovered_amount, actual_payout_amount, billing_status')
    .eq('tenant_id', scope.tenantId)
    .eq('detection_result_id', finding.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const enriched = enrichDetectionFinding(finding, linkedCase || null, { tenantSlug: scope.tenantSlug });
  const sellerSummary: Record<string, any> = isObject(enriched?.seller_summary) ? enriched.seller_summary : {};
  const policyBasis: Record<string, any> = isObject(enriched?.policy_basis) ? enriched.policy_basis : {};
  const filingMovement: Record<string, any> = isObject(enriched?.filing_movement) ? enriched.filing_movement : {};

  const promptTruth: ExplainPromptTruth = {
    workspace: {
      tenant_slug: scope.tenantSlug,
    },
    object: {
      type: 'finding',
      entity_type: 'detection',
      record_id: String(finding.id),
      reference: clean(finding.claim_number) || clean(finding.reference_id) || clean(finding.sync_id),
    },
    finding: {
      title: clean(sellerSummary.title) || clean(finding.anomaly_type),
      summary: clean(sellerSummary.summary),
      event_label: clean(sellerSummary.event_label),
      evidence_summary: clean(sellerSummary.evidence_summary),
      recoverability_reason: clean(sellerSummary.recoverability_reason),
      review_tier: clean(enriched.review_tier),
      claim_readiness: clean(enriched.claim_readiness),
      why_not_claim_ready: clean(enriched.why_not_claim_ready),
      coverage_family: clean(enriched.coverage_family),
    },
    policy: {
      title: clean(policyBasis.title),
      summary: clean(policyBasis.summary),
      verification_status: clean(policyBasis.verification_status),
      amazon_policy_rule: clean(policyBasis.amazon_policy_rule),
      policy_window_rule: clean(policyBasis?.policy_window?.rule),
      policy_window_start_event: clean(policyBasis?.policy_window?.start_event),
      required_evidence: Array.isArray(policyBasis.required_evidence)
        ? policyBasis.required_evidence.map((item: unknown) => clean(item)).filter(Boolean) as string[]
        : [],
    },
    movement: {
      state: clean(filingMovement.state),
      label: clean(filingMovement.label),
      detail: clean(filingMovement.detail),
      next_action_label: clean(filingMovement.next_action_label),
      filing_status: clean(filingMovement.filing_status),
      case_state: clean(filingMovement.case_state),
      eligibility_status: clean(filingMovement.eligibility_status),
      block_reasons: Array.isArray(filingMovement.block_reasons)
        ? filingMovement.block_reasons.map((item: unknown) => clean(item)).filter(Boolean) as string[]
        : [],
    },
    current_status: {
      status: clean(finding.status),
      recovery_status: clean(linkedCase?.recovery_status),
      billing_status: clean(linkedCase?.billing_status),
      amazon_thread_linked: Boolean(linkedCase?.amazon_case_id || linkedCase?.provider_case_id),
    },
    amounts: {
      currency: clean(finding.currency) || clean(linkedCase?.currency) || 'USD',
      estimated_amount: numberValue(finding.estimated_value),
      approved_amount: numberValue(linkedCase?.approved_amount),
      recovered_amount: numberValue(linkedCase?.recovered_amount ?? linkedCase?.actual_payout_amount),
      value_label: clean(enriched.value_label),
    },
    evidence: {
      matched_document_count: Array.isArray(finding.matched_document_ids) ? finding.matched_document_ids.length : 0,
      evidence_complete: null,
      document_labels: [],
      missing_items: Array.isArray(policyBasis.required_evidence)
        ? policyBasis.required_evidence.map((item: unknown) => clean(item)).filter(Boolean) as string[]
        : [],
    },
    amazon_thread: linkedCase
      ? {
          linked: Boolean(linkedCase?.amazon_case_id || linkedCase?.provider_case_id),
          message_count: 0,
          last_activity_at: null,
          last_message_direction: null,
          last_message_status: null,
        }
      : null,
  };

  return {
    objectType: 'finding',
    objectId: String(finding.id),
    versionHash: hashText(stableStringify(promptTruth)).slice(0, 16),
    truth: promptTruth,
  };
}

async function buildRecoveryContext(scope: ExplainRequestScope, lookupId: string, objectType: 'case' | 'recovery'): Promise<ExplainPromptContext> {
  let disputeCase: any | null = null;

  const directCaseLookup = await supabaseAdmin
    .from('dispute_cases')
    .select('*')
    .eq('tenant_id', scope.tenantId)
    .eq('id', lookupId)
    .maybeSingle();

  if (directCaseLookup.error) {
    throw new AiExplainerError(500, 'RECOVERY_LOOKUP_FAILED', 'Failed to load the recovery record for AI explanation.');
  }
  disputeCase = directCaseLookup.data || null;

  if (!disputeCase) {
    const detectionLinkedLookup = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('tenant_id', scope.tenantId)
      .eq('detection_result_id', lookupId)
      .maybeSingle();

    if (detectionLinkedLookup.error) {
      throw new AiExplainerError(500, 'RECOVERY_LOOKUP_FAILED', 'Failed to load the recovery record for AI explanation.');
    }

    disputeCase = detectionLinkedLookup.data || null;
  }

  let detection: any | null = null;
  if (disputeCase?.detection_result_id) {
    const detectionLookup = await supabaseAdmin
      .from('detection_results')
      .select('*')
      .eq('tenant_id', scope.tenantId)
      .eq('id', disputeCase.detection_result_id)
      .maybeSingle();

    if (!detectionLookup.error) {
      detection = detectionLookup.data || null;
    }
  }

  if (!disputeCase) {
    const detectionLookup = await supabaseAdmin
      .from('detection_results')
      .select('*')
      .eq('tenant_id', scope.tenantId)
      .eq('id', lookupId)
      .maybeSingle();

    if (detectionLookup.error) {
      throw new AiExplainerError(500, 'CASE_LOOKUP_FAILED', 'Failed to load the case for AI explanation.');
    }

    detection = detectionLookup.data || null;

    if (!detection) {
      throw new AiExplainerError(404, 'CASE_NOT_FOUND', 'Case not found for this workspace.');
    }

    const enrichedDetection = enrichDetectionFinding(detection, null, { tenantSlug: scope.tenantSlug });
    const sellerSummary: Record<string, any> = isObject(enrichedDetection.seller_summary) ? enrichedDetection.seller_summary : {};
    const policyBasis: Record<string, any> = isObject(enrichedDetection.policy_basis) ? enrichedDetection.policy_basis : {};
    const filingMovement: Record<string, any> = isObject(enrichedDetection.filing_movement) ? enrichedDetection.filing_movement : {};
    const matchedDocumentIds = Array.isArray(detection.matched_document_ids) ? detection.matched_document_ids : [];
    const documentLabels = matchedDocumentIds.length
      ? matchedDocumentIds.slice(0, 3).map((_id: string, index: number) => `Matched evidence document ${index + 1}`)
      : [];

    const promptTruth: ExplainPromptTruth = {
      workspace: {
        tenant_slug: scope.tenantSlug,
      },
      object: {
        type: objectType,
        entity_type: 'detection',
        record_id: String(detection.id),
        reference: clean(detection.claim_number) || clean(detection.reference_id) || clean(detection.sync_id),
      },
      finding: {
        title: clean(sellerSummary.title) || clean(detection.anomaly_type),
        summary: clean(sellerSummary.summary),
        event_label: clean(sellerSummary.event_label),
        evidence_summary: clean(sellerSummary.evidence_summary),
        recoverability_reason: clean(sellerSummary.recoverability_reason),
        review_tier: clean(enrichedDetection.review_tier),
        claim_readiness: clean(enrichedDetection.claim_readiness),
        why_not_claim_ready: clean(enrichedDetection.why_not_claim_ready),
        coverage_family: clean(enrichedDetection.coverage_family),
      },
      policy: {
        title: clean(policyBasis.title),
        summary: clean(policyBasis.summary),
        verification_status: clean(policyBasis.verification_status),
        amazon_policy_rule: clean(policyBasis.amazon_policy_rule),
        policy_window_rule: clean(policyBasis?.policy_window?.rule),
        policy_window_start_event: clean(policyBasis?.policy_window?.start_event),
        required_evidence: Array.isArray(policyBasis.required_evidence)
          ? policyBasis.required_evidence.map((item: unknown) => clean(item)).filter(Boolean) as string[]
          : [],
      },
      movement: {
        state: clean(filingMovement.state),
        label: clean(filingMovement.label),
        detail: clean(filingMovement.detail),
        next_action_label: clean(filingMovement.next_action_label),
        filing_status: clean(filingMovement.filing_status),
        case_state: clean(filingMovement.case_state),
        eligibility_status: clean(filingMovement.eligibility_status),
        block_reasons: Array.isArray(filingMovement.block_reasons)
          ? filingMovement.block_reasons.map((item: unknown) => clean(item)).filter(Boolean) as string[]
          : [],
      },
      current_status: {
        status: clean(detection.status),
        recovery_status: null,
        billing_status: null,
        amazon_thread_linked: false,
      },
      amounts: {
        currency: clean(detection.currency) || 'USD',
        estimated_amount: numberValue(detection.estimated_value),
        approved_amount: null,
        recovered_amount: null,
        value_label: clean(enrichedDetection.value_label),
      },
      evidence: {
        matched_document_count: matchedDocumentIds.length,
        evidence_complete: matchedDocumentIds.length > 0 ? null : false,
        document_labels: documentLabels,
        missing_items: clean(enrichedDetection.why_not_claim_ready)
          ? [String(enrichedDetection.why_not_claim_ready)]
          : [],
      },
      amazon_thread: null,
    };

    return {
      objectType,
      objectId: String(detection.id),
      versionHash: hashText(stableStringify(promptTruth)).slice(0, 16),
      truth: promptTruth,
    };
  }

  const linkedDocuments = await fetchLinkedEvidenceDocumentsForDispute(disputeCase, scope.tenantId);
  const evidenceTruth = evaluateCanonicalEvidenceTruth({
    disputeCase,
    linkedDocuments,
  });
  const caseMessages = await amazonCaseThreadService.listCaseMessages(scope.tenantId, disputeCase.id);
  const latestMessage = Array.isArray(caseMessages) && caseMessages.length > 0 ? caseMessages[caseMessages.length - 1] : null;
  const enrichedCaseFinding = detection
    ? enrichDetectionFinding(detection, disputeCase, { tenantSlug: scope.tenantSlug })
    : null;
  const sellerSummary: Record<string, any> = isObject(enrichedCaseFinding?.seller_summary) ? enrichedCaseFinding?.seller_summary : {};
  const policyBasis: Record<string, any> = isObject(enrichedCaseFinding?.policy_basis) ? enrichedCaseFinding?.policy_basis : {};
  const filingMovement: Record<string, any> = isObject(enrichedCaseFinding?.filing_movement) ? enrichedCaseFinding?.filing_movement : {};
  const documentLabels = linkedDocuments.slice(0, 3).map((document: any, index: number) => sanitizeDocumentLabel(document, index));

  const promptTruth: ExplainPromptTruth = {
    workspace: {
      tenant_slug: scope.tenantSlug,
    },
    object: {
      type: objectType,
      entity_type: 'dispute_case',
      record_id: String(disputeCase.id),
      reference: clean(disputeCase.case_number) || clean(disputeCase.provider_case_id) || clean(disputeCase.amazon_case_id),
    },
    finding: {
      title: clean(sellerSummary.title) || clean(disputeCase.case_type) || clean(detection?.anomaly_type),
      summary: clean(sellerSummary.summary) || clean(disputeCase.details),
      event_label: clean(sellerSummary.event_label),
      evidence_summary: clean(sellerSummary.evidence_summary),
      recoverability_reason: clean(sellerSummary.recoverability_reason),
      review_tier: clean(enrichedCaseFinding?.review_tier),
      claim_readiness: clean(enrichedCaseFinding?.claim_readiness),
      why_not_claim_ready: clean(enrichedCaseFinding?.why_not_claim_ready),
      coverage_family: clean(enrichedCaseFinding?.coverage_family),
    },
    policy: {
      title: clean(policyBasis.title),
      summary: clean(policyBasis.summary),
      verification_status: clean(policyBasis.verification_status),
      amazon_policy_rule: clean(policyBasis.amazon_policy_rule),
      policy_window_rule: clean(policyBasis?.policy_window?.rule),
      policy_window_start_event: clean(policyBasis?.policy_window?.start_event),
      required_evidence: Array.isArray(policyBasis.required_evidence)
        ? policyBasis.required_evidence.map((item: unknown) => clean(item)).filter(Boolean) as string[]
        : [],
    },
    movement: {
      state: clean(filingMovement.state) || clean(disputeCase.filing_status),
      label: clean(filingMovement.label) || clean(disputeCase.status),
      detail: clean(filingMovement.detail),
      next_action_label: clean(filingMovement.next_action_label),
      filing_status: clean(disputeCase.filing_status),
      case_state: clean(disputeCase.case_state),
      eligibility_status: clean(disputeCase.eligibility_status),
      block_reasons: Array.isArray(disputeCase.block_reasons)
        ? disputeCase.block_reasons.map((item: unknown) => clean(item)).filter(Boolean) as string[]
        : [],
    },
    current_status: {
      status: clean(disputeCase.status),
      recovery_status: clean(disputeCase.recovery_status),
      billing_status: clean(disputeCase.billing_status),
      amazon_thread_linked: Boolean(disputeCase.amazon_case_id || disputeCase.provider_case_id),
    },
    amounts: {
      currency: clean(disputeCase.currency) || clean(detection?.currency) || 'USD',
      estimated_amount: numberValue(disputeCase.claim_amount ?? detection?.estimated_value),
      approved_amount: numberValue(disputeCase.approved_amount),
      recovered_amount: numberValue(disputeCase.recovered_amount ?? disputeCase.actual_payout_amount),
      value_label: clean(enrichedCaseFinding?.value_label),
    },
    evidence: {
      matched_document_count: evidenceTruth.linkedDocumentCount,
      evidence_complete: evidenceTruth.isEvidenceComplete,
      document_labels: documentLabels,
      missing_items: Array.isArray(evidenceTruth.missingRequirements)
        ? evidenceTruth.missingRequirements.map((item: unknown) => clean(item)).filter(Boolean) as string[]
        : [],
    },
    amazon_thread: {
      linked: Boolean(disputeCase.amazon_case_id || disputeCase.provider_case_id),
      message_count: Array.isArray(caseMessages) ? caseMessages.length : 0,
      last_activity_at: clean(latestMessage?.created_at || latestMessage?.timestamp),
      last_message_direction: clean(latestMessage?.direction || latestMessage?.sender_role || latestMessage?.message_direction),
      last_message_status: clean(latestMessage?.status || latestMessage?.state),
    },
  };

  return {
    objectType,
    objectId: String(disputeCase.id),
    versionHash: hashText(stableStringify(promptTruth)).slice(0, 16),
    truth: promptTruth,
  };
}

async function explainObject(scope: ExplainRequestScope, context: ExplainPromptContext) {
  const cacheKey = buildCacheKey(scope, context.objectType, context.objectId, context.versionHash);
  const cached = await readCachedExplanation(cacheKey);

  if (cached) {
    logger.info('AI explainer cache hit', {
      requestId: scope.requestId,
      tenantId: scope.tenantId,
      objectType: context.objectType,
      objectId: context.objectId,
      model: config.AI_EXPLAINER_MODEL,
      cached: true,
    });
    return {
      explanation: cached.explanation,
      meta: {
        ...cached.meta,
        request_id: scope.requestId,
      },
    };
  }

  const explanation = await callOpenAiExplanation(scope, context);
  const cacheValue: CachedExplanationEnvelope = {
    explanation,
    meta: {
      cached: true,
      model: config.AI_EXPLAINER_MODEL,
      object_type: context.objectType,
      object_id: context.objectId,
      request_id: scope.requestId,
    },
  };
  await writeCachedExplanation(cacheKey, cacheValue);

  logger.info('AI explainer generated explanation', {
    requestId: scope.requestId,
    tenantId: scope.tenantId,
    objectType: context.objectType,
    objectId: context.objectId,
    model: config.AI_EXPLAINER_MODEL,
    cached: false,
  });

  return {
    explanation,
    meta: {
      cached: false,
      model: config.AI_EXPLAINER_MODEL,
      object_type: context.objectType,
      object_id: context.objectId,
      request_id: scope.requestId,
    },
  };
}

export async function prepareExplainScope(scope: ExplainRequestScope): Promise<void> {
  ensureExplainerIsAvailable(scope);
  await verifyTenantMembership(scope);
}

export async function explainFinding(scope: ExplainRequestScope, findingId: string) {
  const context = await buildFindingContext(scope, findingId);
  return explainObject(scope, context);
}

export async function explainCase(scope: ExplainRequestScope, caseId: string) {
  const context = await buildRecoveryContext(scope, caseId, 'case');
  return explainObject(scope, context);
}

export async function explainRecovery(scope: ExplainRequestScope, recoveryId: string) {
  const context = await buildRecoveryContext(scope, recoveryId, 'recovery');
  return explainObject(scope, context);
}

export function buildExplainScope(input: {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  requestId: string;
}): ExplainRequestScope {
  return {
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    userId: input.userId,
    requestId: input.requestId,
  };
}

export { AiExplainerError, DEMO_WORKSPACE_SLUG };
