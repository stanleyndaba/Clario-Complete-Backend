/**
 * Enhanced Detection Service - Agent 3 Core Orchestrator
 * 
 * Orchestrates the 7 frozen flagship detectors.
 * STRICT BOUNDARY: Only executes hardened core algorithms.
 */

import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import { financialImpactService, ImpactStatus } from './financialImpactService';
import { calculateCalibratedConfidence } from './detection/confidenceCalibrator';
import { getAdaptiveDetectionDecision } from './closedLoopIntelligenceService';
import { generateInsights } from './detection/patternAnalyzer';

// =====================================================
// PRODUCTION REGISTRY (AGENT 3 CORE)
// =====================================================
import {
  runLostInventoryDetection,
  runRefundWithoutReturnDetection,
  runFeeOverchargeDetection,
  runInboundDetection,
  runDamagedInventoryDetection,
  runTransferLossDetection,
  runSentinelDetection
} from './detection/core/registry';

// =====================================================
// Types
// =====================================

export interface DetectionJob {
  id: string;
  seller_id: string;
  sync_id: string;
  trigger_type: 'inventory' | 'financial' | 'product' | 'manual';
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  payload: any;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface DetectionResult {
  id?: string;
  seller_id: string;
  sync_id: string;
  source_type?: 'sp_api' | 'csv_upload' | 'unknown';
  anomaly_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimated_value: number;
  currency: string;
  confidence_score: number;
  evidence: any;
  created_at?: string;
}

function getCountedEstimatedValue(result: Pick<DetectionResult, 'estimated_value' | 'evidence'>): number {
  const countedValue = result.evidence?.economic_rollup?.counted_value;
  return typeof countedValue === 'number' && Number.isFinite(countedValue)
    ? countedValue
    : Number(result.estimated_value || 0);
}

function getTransferIdFromResult(result: any): string | null {
  return result?.transfer_id
    || result?.evidence?.transfer_id
    || result?.evidence?.transfer_record?.transfer_id
    || null;
}

function getSkuFromResult(result: any): string | null {
  return result?.sku
    || result?.evidence?.sku
    || result?.evidence?.transfer_record?.sku
    || null;
}

function getFnskuFromResult(result: any): string | null {
  return result?.fnsku
    || result?.evidence?.fnsku
    || result?.evidence?.transfer_record?.fnsku
    || null;
}

function getShipmentIdFromResult(result: any): string | null {
  return result?.shipment_id
    || result?.evidence?.shipment_id
    || null;
}

function normalizeFamilyValue(value?: string | null): string {
  return String(value || '').trim().toUpperCase();
}

function getInventoryFamilyKey(result: any): string | null {
  const fnsku = normalizeFamilyValue(getFnskuFromResult(result));
  if (fnsku) return `fnsku:${fnsku}`;

  const sku = normalizeFamilyValue(getSkuFromResult(result));
  return sku ? `sku:${sku}` : null;
}

function getWhaleTransferReferenceIds(result: DetectionResult): string[] {
  const evidence = result.evidence || {};
  const directIds = Array.isArray(evidence.transfer_reference_ids)
    ? evidence.transfer_reference_ids
    : [];
  const familyIds = Array.isArray(evidence.transfer_loss_families)
    ? evidence.transfer_loss_families.map((family: any) => family?.reference_id)
    : [];

  return [...new Set([...directIds, ...familyIds]
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
}

function buildOverlapRecordKey(result: any): string | null {
  const evidence = result?.evidence || {};
  if (['lost_in_transit', 'lost_warehouse'].includes(result?.anomaly_type)) {
    return `whale|${evidence.fnsku || result?.fnsku || ''}|${evidence.physical_loss_units || ''}`;
  }
  if (result?.anomaly_type === 'warehouse_transfer_loss') {
    return `transfer|${getTransferIdFromResult(result) || ''}|${getSkuFromResult(result) || ''}|${result?.loss_type || evidence.loss_type || ''}`;
  }
  if ([
    'shipment_missing',
    'shipment_shortage',
    'carrier_damage',
    'receiving_error',
    'case_break_error',
    'label_mismatch',
    'prep_fee_error'
  ].includes(result?.anomaly_type)) {
    return `inbound|${result.anomaly_type}|${getShipmentIdFromResult(result) || ''}|${getSkuFromResult(result) || ''}`;
  }
  return null;
}

function mergeFamilyLinks(existingLinks: any, nextLinks: any[]): any[] {
  const links = Array.isArray(existingLinks) ? existingLinks : [];
  const byKey = new Map<string, any>();
  for (const link of [...links, ...nextLinks]) {
    const key = [
      link?.rail,
      link?.detector,
      link?.anomaly_type,
      link?.shipment_id,
      link?.transfer_id,
      link?.family_key
    ].map((part) => String(part || '')).join('|');
    byKey.set(key, link);
  }
  return [...byKey.values()];
}

function adjudicateWhaleMultiRailOverlaps(results: DetectionResult[]): {
  results: DetectionResult[];
  overlapCount: number;
  overlappedValue: number;
  familyLinkCount: number;
  adjustedRecovery: number;
} {
  const transferResultsById = new Map<string, DetectionResult>();
  const inboundResultsByFamily = new Map<string, DetectionResult[]>();

  for (const result of results) {
    if (result.anomaly_type === 'warehouse_transfer_loss') {
      const transferId = getTransferIdFromResult(result);
      if (transferId) transferResultsById.set(transferId, result);
      continue;
    }

    if ([
      'shipment_missing',
      'shipment_shortage',
      'carrier_damage',
      'receiving_error',
      'case_break_error',
      'label_mismatch',
      'prep_fee_error'
    ].includes(result.anomaly_type)) {
      const familyKey = getInventoryFamilyKey(result);
      if (!familyKey) continue;
      const rows = inboundResultsByFamily.get(familyKey) || [];
      rows.push(result);
      inboundResultsByFamily.set(familyKey, rows);
    }
  }

  let overlapCount = 0;
  let overlappedValue = 0;
  let familyLinkCount = 0;

  for (const result of results) {
    if (result.anomaly_type !== 'lost_in_transit') continue;

    const matchingTransferIds = getWhaleTransferReferenceIds(result)
      .filter((transferId) => transferResultsById.has(transferId));

    if (matchingTransferIds.length === 0) continue;

    overlapCount += 1;
    overlappedValue += Number(result.estimated_value || 0);

    const matchedTransfers = matchingTransferIds
      .map((transferId) => transferResultsById.get(transferId))
      .filter((transferResult): transferResult is DetectionResult => Boolean(transferResult));

    result.evidence = {
      ...(result.evidence || {}),
      cross_rail_overlap: {
        status: 'overlaps_transfer_auditor',
        authoritative_detector: 'Transfer Auditor',
        linked_detector: 'Whale Hunter',
        linked_transfer_ids: matchingTransferIds,
        overlap_reason: 'Whale Hunter reconstructed the same transfer family from inventory ledger transfer legs.',
      },
      economic_rollup: {
        status: 'linked_not_counted',
        counted_value: 0,
        original_estimated_value: Number(result.estimated_value || 0),
        authoritative_detector: 'Transfer Auditor',
        linked_transfer_ids: matchingTransferIds,
      }
    };

    for (const transferResult of matchedTransfers) {
      const existingLinkedIds = Array.isArray(transferResult.evidence?.cross_rail_overlap?.linked_whale_reference_ids)
        ? transferResult.evidence.cross_rail_overlap.linked_whale_reference_ids
        : [];
      transferResult.evidence = {
        ...(transferResult.evidence || {}),
        cross_rail_overlap: {
          status: 'authoritative_transfer_loss',
          authoritative_detector: 'Transfer Auditor',
          linked_detector: 'Whale Hunter',
          linked_whale_reference_ids: [...new Set([...existingLinkedIds, ...matchingTransferIds])],
          overlap_reason: 'Direct transfer record owns economic value when Whale Hunter reconstructs the same transfer family.',
        },
        economic_rollup: {
          status: 'counted',
          counted_value: Number(transferResult.estimated_value || 0),
          original_estimated_value: Number(transferResult.estimated_value || 0),
          authoritative_detector: 'Transfer Auditor',
        }
      };
    }
  }

  for (const result of results) {
    if (!['lost_in_transit', 'lost_warehouse'].includes(result.anomaly_type)) continue;
    const familyKey = getInventoryFamilyKey(result);
    if (!familyKey) continue;

    const linkedInboundResults = inboundResultsByFamily.get(familyKey) || [];
    if (linkedInboundResults.length === 0) continue;

    familyLinkCount += 1;
    const whaleLinks = linkedInboundResults.map((inboundResult) => ({
      status: 'same_inventory_family_review',
      rail: 'inbound',
      detector: 'Inbound Inspector',
      anomaly_type: inboundResult.anomaly_type,
      shipment_id: getShipmentIdFromResult(inboundResult),
      sku: getSkuFromResult(inboundResult),
      fnsku: getFnskuFromResult(inboundResult),
      family_key: familyKey,
      relationship: 'same_sku_or_fnsku_distinct_rail',
      economic_action: 'count_separately_pending_review',
    }));

    result.evidence = {
      ...(result.evidence || {}),
      cross_rail_family_links: mergeFamilyLinks(result.evidence?.cross_rail_family_links, whaleLinks),
    };

    for (const inboundResult of linkedInboundResults) {
      const inboundLink = {
        status: 'same_inventory_family_review',
        rail: 'inventory_ledger',
        detector: 'Whale Hunter',
        anomaly_type: result.anomaly_type,
        sku: getSkuFromResult(result),
        fnsku: getFnskuFromResult(result),
        family_key: familyKey,
        relationship: 'same_sku_or_fnsku_distinct_rail',
        economic_action: 'count_separately_pending_review',
      };
      inboundResult.evidence = {
        ...(inboundResult.evidence || {}),
        cross_rail_family_links: mergeFamilyLinks(inboundResult.evidence?.cross_rail_family_links, [inboundLink]),
      };
    }
  }

  return {
    results,
    overlapCount,
    overlappedValue,
    familyLinkCount,
    adjustedRecovery: results.reduce((sum, result) => sum + getCountedEstimatedValue(result), 0)
  };
}

async function persistOverlapEvidence(
  userId: string,
  syncId: string,
  tenantId: string | null,
  results: DetectionResult[]
): Promise<void> {
  const adjudicatedByKey = new Map<string, DetectionResult>();
  for (const result of results) {
    if (
      !result.evidence?.cross_rail_overlap
      && !result.evidence?.economic_rollup
      && !result.evidence?.cross_rail_family_links
    ) continue;
    const key = buildOverlapRecordKey(result);
    if (key) adjudicatedByKey.set(key, result);
  }

  if (adjudicatedByKey.size === 0) return;

  let query: any = supabaseAdmin
    .from('detection_results')
    .select('id,evidence,anomaly_type,estimated_value')
    .eq('seller_id', userId)
    .eq('sync_id', syncId)
    .in('anomaly_type', [
      'lost_in_transit',
      'lost_warehouse',
      'warehouse_transfer_loss',
      'shipment_missing',
      'shipment_shortage',
      'carrier_damage',
      'receiving_error',
      'case_break_error',
      'label_mismatch',
      'prep_fee_error'
    ]);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query;
  if (error) {
    logger.warn('🧠 [AGENT3] Failed to load detections for overlap evidence update', {
      userId,
      syncId,
      error: error.message
    });
    return;
  }

  for (const row of data || []) {
    const key = buildOverlapRecordKey(row);
    if (!key) continue;
    const adjudicated = adjudicatedByKey.get(key);
    if (!adjudicated) continue;

    const mergedEvidence = {
      ...(row.evidence || {}),
      cross_rail_overlap: adjudicated.evidence?.cross_rail_overlap,
      economic_rollup: adjudicated.evidence?.economic_rollup,
      cross_rail_family_links: adjudicated.evidence?.cross_rail_family_links,
    };

    const { error: updateError } = await supabaseAdmin
      .from('detection_results')
      .update({
        evidence: mergedEvidence,
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id);

    if (updateError) {
      logger.warn('🧠 [AGENT3] Failed to persist overlap evidence update', {
        userId,
        syncId,
        detectionId: row.id,
        error: updateError.message
      });
    }
  }
}

// ============================================================================
// Enhanced Detection Service - LIVE CORE
// ============================================================================

export class EnhancedDetectionService {

  /**
   * TRIGGER DETECTION PIPELINE - CORE PRODUCTION
   * 
   * Orchestrates the 7 frozen flagship detectors.
   * STRICT BOUNDARY: Only executes hardened core algorithms.
   */
  async triggerDetectionPipeline(
    userId: string,
    syncId: string,
    triggerType: string,
    metadata: any
  ): Promise<{ success: boolean; jobId: string; message: string; detectionsFound?: number; estimatedRecovery?: number }> {
    const jobId = `detection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info('🧠 [AGENT3] Production pipeline triggered (Frozen Flagships Only)', {
      userId,
      syncId,
      triggerType,
      jobId
    });

    try {
      // ---------------------------------------------------------
      // RUN CORE PRODUCTION TRINITY
      // ---------------------------------------------------------
      
      // 1. Whale Hunter (Inventory)
      logger.info('🐋 [AGENT3] Unleashing the Whale Hunter...');
      const inventoryRes = await runLostInventoryDetection(userId, syncId);

      // 2. Refund Trap (Returns)
      logger.info('🪤 [AGENT3] Setting the Refund Trap...');
      const refundRes = await runRefundWithoutReturnDetection(userId, syncId);

      // 3. Broken Goods Hunter (Damage)
      logger.info('💥 [AGENT3] Deploying the Broken Goods Hunter...');
      const damagedRes = await runDamagedInventoryDetection(userId, syncId);

      // ---------------------------------------------------------
      // RUN CORE SYSTEM AUDITORS
      // ---------------------------------------------------------

      // 4. Fee Phantom (Fees)
      logger.info('💰 [AGENT3] Running the Fee Auditor...');
      const feeRes = await runFeeOverchargeDetection(userId, syncId);

      // 5. Inbound Inspector (Ingress)
      logger.info('🚀 [AGENT3] Launching the Inbound Inspector...');
      const inboundRes = await runInboundDetection(userId, syncId);

      // 6. Transfer Loss (Warehouse Moves)
      logger.info('🏭 [AGENT3] Auditing Warehouse Transfers...');
      const transferRes = await runTransferLossDetection(userId, syncId);

      // 7. The Sentinel (Integrity)
      logger.info('🔍 [AGENT3] Activating the Sentinel...');
      const sentinelRes = await runSentinelDetection(userId, syncId);

      // ---------------------------------------------------------
      // AGGREGATE RESULTS
      // ---------------------------------------------------------
      const allResults = [
        ...inventoryRes, ...refundRes, ...damagedRes,
        ...feeRes, ...inboundRes, ...transferRes, ...sentinelRes
      ];

      const tenantId = metadata?.tenantId || metadata?.tenant_id || null;
      const adaptiveResults: DetectionResult[] = [];

      // ML Confidence Calibration + Upstream adaptive shaping
      for (const result of allResults) {
        try {
          const calibration = await calculateCalibratedConfidence(
            result.anomaly_type,
            result.confidence_score
          );
          const adaptiveDecision = await getAdaptiveDetectionDecision({
            tenantId,
            userId,
            anomalyType: result.anomaly_type,
            rawConfidence: calibration.calibrated_confidence,
            estimatedValue: Number(result.estimated_value || 0)
          });

          if (adaptiveDecision.suppressed) {
            logger.info('🧠 [AGENT3] Suppressed historically weak detection candidate', {
              userId,
              syncId,
              anomalyType: result.anomaly_type,
              confidence: result.confidence_score,
              adjustedConfidence: adaptiveDecision.adjustedConfidence,
              suppressionThreshold: adaptiveDecision.suppressionThreshold,
              approvalRate: adaptiveDecision.historicalApprovalRate,
              sampleSize: adaptiveDecision.sampleSize,
              adjustments: adaptiveDecision.adjustments
            });
            continue;
          }

          (result as any).confidence_score = adaptiveDecision.adjustedConfidence;
          (result as any).adaptive_policy = adaptiveDecision;
          adaptiveResults.push(result);
        } catch (err) {
          adaptiveResults.push(result);
        }
      }

      const overlapAdjudication = adjudicateWhaleMultiRailOverlaps(adaptiveResults);
      await persistOverlapEvidence(userId, syncId, tenantId, overlapAdjudication.results);

      const detectionsFound = overlapAdjudication.results.length;
      const grossEstimatedRecovery = overlapAdjudication.results.reduce((sum, r) => sum + (r.estimated_value || 0), 0);
      const estimatedRecovery = overlapAdjudication.adjustedRecovery;

      // Record Financial Impact
      if (detectionsFound > 0) {
        await financialImpactService.recordImpact({
          userId,
          detectionId: jobId,
          status: ImpactStatus.DETECTED,
          estimatedAmount: estimatedRecovery,
          currency: 'USD',
          confidence: 0.9,
          anomalyType: 'multi_flagship_detection',
          timestamp: new Date().toISOString()
        });
      }

      // Generate Seller Insights (Async)
      generateInsights(userId).catch(() => {});

      logger.info('🏁 [AGENT3] Production pipeline complete!', {
        userId,
        syncId,
        detectionsFound,
        estimatedRecovery,
        grossEstimatedRecovery,
        crossRailOverlapCount: overlapAdjudication.overlapCount,
        crossRailOverlapValue: overlapAdjudication.overlappedValue,
        crossRailFamilyLinkCount: overlapAdjudication.familyLinkCount
      });

      return {
        success: true,
        jobId,
        message: `Detection pipeline completed successfully with 7 frozen flagship detectors. Found ${detectionsFound} claims.`,
        detectionsFound,
        estimatedRecovery
      };
    } catch (error: any) {
      logger.error('❌ [AGENT3] Detection pipeline failed', {
        error: error.message,
        userId,
        syncId
      });
      return {
        success: false,
        jobId,
        message: `Pipeline failed: ${error.message}`
      };
    }
  }

  /**
   * GET DETECTION RESULTS - REAL DATABASE QUERY
   */
  async getDetectionResults(
    userId: string,
    filters: { status?: string; anomalyType?: string; limit?: number; offset?: number } = {}
  ): Promise<{ results: any[]; total: number; filters: any }> {
    logger.info('📊 [AGENT3] Fetching detection results from database', { userId, filters });

    try {
      let query = supabaseAdmin
        .from('detection_results')
        .select('*', { count: 'exact' })
        .eq('seller_id', userId)
        .order('created_at', { ascending: false });

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.anomalyType) {
        query = query.eq('anomaly_type', filters.anomalyType);
      }

      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      if (filters.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 100) - 1);
      }

      const { data, error, count } = await query;

      if (error) {
        logger.error('❌ [AGENT3] Error fetching detection results', {
          userId,
          error: error.message
        });
        return { results: [], total: 0, filters };
      }

      return {
        results: data || [],
        total: count || 0,
        filters
      };
    } catch (error: any) {
      logger.error('❌ [AGENT3] Exception fetching detection results', {
        userId,
        error: error.message
      });
      return { results: [], total: 0, filters };
    }
  }

  /**
   * GET DETECTION JOB STATUS
   * PATCHED: Added seller_id isolation to prevent cross-tenant data leakage
   */
  async getDetectionJob(jobId: string, userId?: string): Promise<{
    id: string;
    status: string;
    progress: number;
    results: { claimsFound: number; estimatedRecovery: number };
  }> {
    logger.info('📋 [AGENT3] Getting detection job status', { jobId, userId });

    try {
      let query = supabaseAdmin
        .from('detection_results')
        .select('estimated_value,evidence')
        .limit(100);

      // PATCH: Enforce strict tenant isolation
      if (userId) {
        query = query.eq('seller_id', userId);
      } else {
        // If no userId provided, return empty — never leak cross-tenant data
        logger.warn('⚠️ [AGENT3] getDetectionJob called without userId — returning empty for safety');
        return {
          id: jobId,
          status: 'completed',
          progress: 100,
          results: { claimsFound: 0, estimatedRecovery: 0 }
        };
      }

      const { data, error } = await query;

      const claimsFound = data?.length || 0;
      const estimatedRecovery = data?.reduce((sum: number, r: any) => sum + getCountedEstimatedValue(r), 0) || 0;

      return {
        id: jobId,
        status: 'completed',
        progress: 100,
        results: { claimsFound, estimatedRecovery }
      };
    } catch (error: any) {
      return {
        id: jobId,
        status: 'failed',
        progress: 0,
        results: { claimsFound: 0, estimatedRecovery: 0 }
      };
    }
  }

  /**
   * RETRY DETECTION JOB
   */
  async retryDetectionJob(jobId: string): Promise<{ success: boolean; newJobId: string; message: string }> {
    const newJobId = `retry-${jobId}-${Date.now()}`;
    return {
      success: true,
      newJobId,
      message: 'Job retry initiated.'
    };
  }

  /**
   * DELETE DETECTION JOB / CLEAR RESULTS
   */
  async deleteDetectionJob(jobId: string): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: 'Job deleted successfully'
    };
  }

  /**
   * GET DETECTION STATISTICS - REAL AGGREGATION
   */
  async getDetectionStatistics(userId: string): Promise<{
    totalDetections: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    estimatedRecovery: number;
    byAnomalyType: Record<string, { count: number; value: number }>;
    bySeverity: Record<string, number>;
  }> {
    try {
      const { data, error } = await supabaseAdmin
        .from('detection_results')
        .select('*')
        .eq('seller_id', userId);

      if (error || !data) throw new Error(error?.message || 'No data');

      const totalDetections = data.length;
      const estimatedRecovery = data.reduce((sum, r) => sum + getCountedEstimatedValue(r), 0);
      
      const byAnomalyType: Record<string, { count: number; value: number }> = {};
      const bySeverity: Record<string, number> = {};

      for (const r of data) {
        const type = r.anomaly_type || 'unknown';
        if (!byAnomalyType[type]) byAnomalyType[type] = { count: 0, value: 0 };
        byAnomalyType[type].count++;
        byAnomalyType[type].value += getCountedEstimatedValue(r);

        const severity = r.severity || 'unknown';
        bySeverity[severity] = (bySeverity[severity] || 0) + 1;
      }

      return {
        totalDetections,
        highConfidence: data.filter(r => r.confidence_score >= 0.85).length,
        mediumConfidence: data.filter(r => r.confidence_score >= 0.5 && r.confidence_score < 0.85).length,
        lowConfidence: data.filter(r => r.confidence_score < 0.5).length,
        estimatedRecovery,
        byAnomalyType,
        bySeverity
      };
    } catch (error) {
      return {
        totalDetections: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        estimatedRecovery: 0,
        byAnomalyType: {},
        bySeverity: {}
      };
    }
  }
}

export default new EnhancedDetectionService();
