import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import { classifyRejectionReason, RejectionCategory } from './rejectionClassifier';

export interface EvidenceStrengthSnapshot {
  score: number;
  label: 'weak' | 'moderate' | 'strong';
  linkedEvidenceCount: number;
  signals: string[];
  docTypes: string[];
}

export interface AdaptiveFilingStrategy {
  templateVariant: 'standard' | 'documentation_heavy';
  evidenceMode: 'standard' | 'enhanced';
  timing: 'standard' | 'expedite';
  autoFileRecommended: boolean;
  rationale: string[];
}

export interface AdaptiveDecisionProfile {
  successProbability: number;
  historicalApprovalRate: number | null;
  historicalRecoveryRate: number | null;
  sampleSize: number;
  evidenceStrength: number;
  evidenceStrengthLabel: EvidenceStrengthSnapshot['label'];
  adaptiveConfidenceThreshold: number;
  autoFileThreshold: number;
  minEvidenceDocuments: number;
  dominantRejectionCategory: RejectionCategory | null;
  priorityScore: number;
  filingStrategy: AdaptiveFilingStrategy;
  adjustments: string[];
}

interface AdaptiveDecisionInput {
  tenantId?: string | null;
  userId: string;
  anomalyType: string;
  claimAmount: number;
  confidenceScore: number;
  evidenceStrength: number;
  daysUntilExpiry?: number | null;
}

export interface AdaptiveDetectionDecision {
  adjustedConfidence: number;
  suppressionThreshold: number;
  historicalApprovalRate: number | null;
  sampleSize: number;
  suppressed: boolean;
  adjustments: string[];
}

export interface AdaptiveEvidenceDecision {
  adjustedConfidence: number;
  autoSubmitThreshold: number;
  smartPromptThreshold: number;
  successProbability: number;
  dominantRejectionCategory: RejectionCategory | null;
  route: 'auto_submit' | 'smart_prompt' | 'no_action';
  adjustments: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

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

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasUnitCostEvidence(document: any): boolean {
  const parsed = parseJsonObject(document?.parsed_metadata);
  const extracted = parseJsonObject(document?.extracted);
  const items = [
    ...(Array.isArray(parsed?.items) ? parsed.items : []),
    ...(Array.isArray(extracted?.items) ? extracted.items : [])
  ];

  return items.some((item: any) => {
    const unitCost = toNumber(item?.unit_cost ?? item?.unitPrice ?? item?.cost);
    return unitCost !== null && unitCost > 0;
  });
}

function resolveLabel(score: number): EvidenceStrengthSnapshot['label'] {
  if (score >= 0.8) return 'strong';
  if (score >= 0.55) return 'moderate';
  return 'weak';
}

export function computeEvidenceStrengthSnapshot(params: {
  evidenceDocuments: any[];
  linkedEvidenceCount: number;
  matchConfidence?: number | null;
}): EvidenceStrengthSnapshot {
  const documents = params.evidenceDocuments || [];
  const docTypes = Array.from(
    new Set(documents.map((document) => normalize(document?.doc_type)).filter(Boolean))
  );
  const signals: string[] = [];
  let score = 0.15;

  const linkedCount = Math.max(0, params.linkedEvidenceCount || 0);
  score += Math.min(0.24, linkedCount * 0.08);
  if (linkedCount > 0) signals.push(`linked_evidence:${linkedCount}`);

  if (docTypes.some((type) => ['invoice', 'po', 'purchase_order'].includes(type))) {
    score += 0.22;
    signals.push('cost_document');
  }

  if (docTypes.some((type) => ['shipping', 'proof_of_delivery', 'pod'].includes(type))) {
    score += 0.18;
    signals.push('shipping_or_delivery_proof');
  }

  if (docTypes.some((type) => ['inventory', 'reference', 'manifest'].includes(type))) {
    score += 0.12;
    signals.push('inventory_reference_proof');
  }

  if (documents.some((document) => hasUnitCostEvidence(document))) {
    score += 0.12;
    signals.push('unit_cost_proof');
  }

  const matchConfidence = clamp(toNumber(params.matchConfidence) ?? 0, 0, 1);
  if (matchConfidence > 0) {
    score += matchConfidence * 0.18;
    signals.push(`match_confidence:${matchConfidence.toFixed(2)}`);
  }

  const finalScore = clamp(score, 0.1, 0.99);
  return {
    score: finalScore,
    label: resolveLabel(finalScore),
    linkedEvidenceCount: linkedCount,
    signals,
    docTypes
  };
}

async function loadHistoricalOutcomes(params: {
  tenantId?: string | null;
  userId: string;
  anomalyType: string;
}): Promise<any[]> {
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from('detection_outcomes')
    .select(`
      actual_outcome,
      recovery_amount,
      estimated_value,
      approved_amount,
      evidence_strength,
      confidence_score_at_time,
      rejection_category,
      rejection_reason,
      outcome_recorded_at,
      created_at
    `)
    .eq('seller_id', params.userId)
    .eq('anomaly_type', params.anomalyType)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);

  if (params.tenantId) {
    query = query.eq('tenant_id', params.tenantId);
  }

  const { data, error } = await query;

  if (error) {
    logger.warn('[CLIS] Failed to load historical outcomes', {
      tenantId: params.tenantId,
      userId: params.userId,
      anomalyType: params.anomalyType,
      error: error.message
    });
    return [];
  }

  return data || [];
}

function resolveDominantRejectionCategory(outcomes: any[]): RejectionCategory | null {
  const counts = new Map<RejectionCategory, number>();

  for (const outcome of outcomes) {
    if (normalize(outcome?.actual_outcome) !== 'rejected') continue;
    const rawCategory = String(outcome?.rejection_category || '').trim();
    const category = (rawCategory || classifyRejectionReason(String(outcome?.rejection_reason || ''))) as RejectionCategory;
    counts.set(category, (counts.get(category) || 0) + 1);
  }

  let winner: RejectionCategory | null = null;
  let winnerCount = 0;
  for (const [category, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = category;
      winnerCount = count;
    }
  }

  return winnerCount > 0 ? winner : null;
}

export async function getAdaptiveDecisionProfile(input: AdaptiveDecisionInput): Promise<AdaptiveDecisionProfile> {
  const adjustments: string[] = [];
  const historicalOutcomes = await loadHistoricalOutcomes(input);
  const resolvedOutcomes = historicalOutcomes.filter((row) => normalize(row.actual_outcome) !== 'pending');
  const positiveOutcomes = resolvedOutcomes.filter((row) => ['approved', 'partial'].includes(normalize(row.actual_outcome)));

  const sampleSize = resolvedOutcomes.length;
  const historicalApprovalRate = sampleSize > 0 ? positiveOutcomes.length / sampleSize : null;
  const historicalRecoveryRate = positiveOutcomes.length > 0
    ? positiveOutcomes.reduce((sum, row) => {
        const approvedAmount = toNumber(row.approved_amount) ?? toNumber(row.recovery_amount) ?? 0;
        const estimatedValue = Math.max(toNumber(row.estimated_value) ?? approvedAmount, 1);
        return sum + clamp(approvedAmount / estimatedValue, 0, 1);
      }, 0) / positiveOutcomes.length
    : null;

  const dominantRejectionCategory = resolveDominantRejectionCategory(resolvedOutcomes);

  let adaptiveConfidenceThreshold = Number(
    process.env.AGENT7_CONFIDENCE_THRESHOLD ||
    process.env.EVIDENCE_CONFIDENCE_AUTO ||
    '0.85'
  );

  let minEvidenceDocuments = 1;
  let autoFileThreshold = 0.58;

  if (sampleSize >= 5 && historicalApprovalRate !== null) {
    if (historicalApprovalRate < 0.45) {
      adaptiveConfidenceThreshold += 0.08;
      autoFileThreshold += 0.08;
      adjustments.push('approval_rate_low');
    } else if (historicalApprovalRate < 0.6) {
      adaptiveConfidenceThreshold += 0.04;
      autoFileThreshold += 0.04;
      adjustments.push('approval_rate_softened');
    } else if (historicalApprovalRate >= 0.82) {
      adaptiveConfidenceThreshold -= 0.05;
      autoFileThreshold -= 0.04;
      adjustments.push('approval_rate_high');
    }
  }

  if (dominantRejectionCategory === 'MISSING_DOCUMENT') {
    minEvidenceDocuments = Math.max(minEvidenceDocuments, 2);
    adaptiveConfidenceThreshold += 0.03;
    autoFileThreshold += 0.04;
    adjustments.push('missing_document_feedback');
  }

  if (dominantRejectionCategory === 'INSUFFICIENT_EVIDENCE') {
    minEvidenceDocuments = Math.max(minEvidenceDocuments, 2);
    adaptiveConfidenceThreshold += 0.02;
    autoFileThreshold += 0.03;
    adjustments.push('insufficient_evidence_feedback');
  }

  if (dominantRejectionCategory === 'INVALID_CLAIM') {
    adaptiveConfidenceThreshold += 0.05;
    autoFileThreshold += 0.06;
    adjustments.push('invalid_claim_feedback');
  }

  if (input.daysUntilExpiry !== null && input.daysUntilExpiry !== undefined && input.daysUntilExpiry <= 14) {
    adjustments.push('deadline_pressure');
  }

  adaptiveConfidenceThreshold = clamp(adaptiveConfidenceThreshold, 0.55, 0.97);
  autoFileThreshold = clamp(autoFileThreshold, 0.45, 0.9);

  const approvalComponent = historicalApprovalRate ?? input.confidenceScore;
  const recoveryComponent = historicalRecoveryRate ?? 0.5;
  let successProbability = (
    input.confidenceScore * 0.45 +
    approvalComponent * 0.25 +
    input.evidenceStrength * 0.2 +
    recoveryComponent * 0.1
  );

  if (input.claimAmount > 500) {
    successProbability -= 0.04;
    adjustments.push('high_value_penalty');
  }

  if (input.claimAmount < 25) {
    successProbability -= 0.1;
    adjustments.push('low_value_penalty');
  }

  if (input.daysUntilExpiry !== null && input.daysUntilExpiry !== undefined && input.daysUntilExpiry <= 7) {
    successProbability += 0.03;
  }

  successProbability = clamp(successProbability, 0.05, 0.99);

  let urgencyMultiplier = 1;
  if (input.daysUntilExpiry !== null && input.daysUntilExpiry !== undefined) {
    if (input.daysUntilExpiry <= 7) urgencyMultiplier = 1.45;
    else if (input.daysUntilExpiry <= 14) urgencyMultiplier = 1.25;
    else if (input.daysUntilExpiry <= 30) urgencyMultiplier = 1.1;
  }

  const priorityScore = Number((successProbability * Math.max(input.claimAmount, 1) * urgencyMultiplier).toFixed(2));
  const autoFileRecommended = successProbability >= autoFileThreshold;

  const rationale = [
    `success_probability:${successProbability.toFixed(3)}`,
    `priority_score:${priorityScore.toFixed(2)}`
  ];

  if (dominantRejectionCategory) {
    rationale.push(`dominant_rejection:${dominantRejectionCategory}`);
  }

  const filingStrategy: AdaptiveFilingStrategy = {
    templateVariant: ['MISSING_DOCUMENT', 'INSUFFICIENT_EVIDENCE'].includes(String(dominantRejectionCategory))
      ? 'documentation_heavy'
      : 'standard',
    evidenceMode: minEvidenceDocuments > 1 ? 'enhanced' : 'standard',
    timing: urgencyMultiplier > 1.15 ? 'expedite' : 'standard',
    autoFileRecommended,
    rationale
  };

  return {
    successProbability,
    historicalApprovalRate,
    historicalRecoveryRate,
    sampleSize,
    evidenceStrength: input.evidenceStrength,
    evidenceStrengthLabel: resolveLabel(input.evidenceStrength),
    adaptiveConfidenceThreshold,
    autoFileThreshold,
    minEvidenceDocuments,
    dominantRejectionCategory,
    priorityScore,
    filingStrategy,
    adjustments
  };
}

export async function getAdaptiveDetectionDecision(input: {
  tenantId?: string | null;
  userId: string;
  anomalyType: string;
  rawConfidence: number;
  estimatedValue: number;
}): Promise<AdaptiveDetectionDecision> {
  const outcomes = await loadHistoricalOutcomes(input);
  const resolvedOutcomes = outcomes.filter((row) => normalize(row.actual_outcome) !== 'pending');
  const positiveOutcomes = resolvedOutcomes.filter((row) => ['approved', 'partial'].includes(normalize(row.actual_outcome)));
  const sampleSize = resolvedOutcomes.length;
  const historicalApprovalRate = sampleSize > 0 ? positiveOutcomes.length / sampleSize : null;

  let suppressionThreshold = 0.45;
  let adjustedConfidence = input.rawConfidence;
  const adjustments: string[] = [];

  if (sampleSize >= 5 && historicalApprovalRate !== null) {
    if (historicalApprovalRate < 0.35) {
      adjustedConfidence -= 0.12;
      suppressionThreshold = 0.62;
      adjustments.push('historically_low_yield');
    } else if (historicalApprovalRate < 0.5) {
      adjustedConfidence -= 0.06;
      suppressionThreshold = 0.54;
      adjustments.push('yield_penalty');
    } else if (historicalApprovalRate >= 0.8) {
      adjustedConfidence += 0.05;
      suppressionThreshold = 0.38;
      adjustments.push('yield_boost');
    }
  }

  if (input.estimatedValue < 25) {
    adjustedConfidence -= 0.03;
    adjustments.push('low_value_penalty');
  }

  adjustedConfidence = clamp(adjustedConfidence, 0.05, 0.99);
  const suppressed = sampleSize >= 8 && historicalApprovalRate !== null && historicalApprovalRate < 0.3 && adjustedConfidence < suppressionThreshold;

  return {
    adjustedConfidence,
    suppressionThreshold,
    historicalApprovalRate,
    sampleSize,
    suppressed,
    adjustments
  };
}

export async function getAdaptiveEvidenceDecision(input: {
  tenantId?: string | null;
  userId: string;
  anomalyType: string;
  baseConfidence: number;
  claimAmount: number;
  evidenceStrength: number;
}): Promise<AdaptiveEvidenceDecision> {
  const profile = await getAdaptiveDecisionProfile({
    tenantId: input.tenantId,
    userId: input.userId,
    anomalyType: input.anomalyType,
    claimAmount: input.claimAmount,
    confidenceScore: input.baseConfidence,
    evidenceStrength: input.evidenceStrength
  });

  let autoSubmitThreshold = 0.85;
  let smartPromptThreshold = 0.5;
  let adjustedConfidence = input.baseConfidence;
  const adjustments = [...profile.adjustments];

  if (profile.dominantRejectionCategory === 'MISSING_DOCUMENT') {
    autoSubmitThreshold += 0.05;
    smartPromptThreshold += 0.03;
    adjustments.push('document_heavy_threshold');
  }

  if (profile.dominantRejectionCategory === 'INSUFFICIENT_EVIDENCE') {
    autoSubmitThreshold += 0.04;
    smartPromptThreshold += 0.02;
    adjustments.push('evidence_penalty_threshold');
  }

  if ((profile.historicalApprovalRate ?? 0.6) < 0.45 && profile.sampleSize >= 5) {
    autoSubmitThreshold += 0.04;
    smartPromptThreshold += 0.03;
    adjustedConfidence -= 0.04;
    adjustments.push('low_approval_penalty');
  }

  if ((profile.historicalApprovalRate ?? 0) >= 0.8 && profile.sampleSize >= 8) {
    adjustedConfidence += 0.04;
    adjustments.push('high_approval_boost');
  }

  if (input.evidenceStrength < 0.6) {
    adjustedConfidence -= 0.06;
    adjustments.push('weak_evidence_penalty');
  }

  adjustedConfidence = clamp(adjustedConfidence, 0.05, 0.99);
  autoSubmitThreshold = clamp(autoSubmitThreshold, 0.78, 0.97);
  smartPromptThreshold = clamp(smartPromptThreshold, 0.45, 0.8);

  let route: 'auto_submit' | 'smart_prompt' | 'no_action' = 'no_action';
  if (adjustedConfidence >= autoSubmitThreshold) route = 'auto_submit';
  else if (adjustedConfidence >= smartPromptThreshold) route = 'smart_prompt';

  return {
    adjustedConfidence,
    autoSubmitThreshold,
    smartPromptThreshold,
    successProbability: profile.successProbability,
    dominantRejectionCategory: profile.dominantRejectionCategory,
    route,
    adjustments
  };
}
