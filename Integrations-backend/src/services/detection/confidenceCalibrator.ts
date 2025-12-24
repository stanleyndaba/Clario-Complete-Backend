/**
 * Confidence Calibrator Service
 * 
 * Phase 3: ML & Pattern Recognition
 * 
 * Uses historical outcome data to adjust confidence scores:
 * - Tracks approval rates per anomaly type
 * - Adjusts raw confidence based on actual success rates
 * - Provides calibrated scores that reflect real-world accuracy
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface AnomalyTypeAccuracy {
    anomaly_type: string;
    total_claims: number;
    approved_count: number;
    rejected_count: number;
    partial_count: number;
    pending_count: number;
    approval_rate: number;           // 0-100
    avg_predicted_confidence: number; // 0-100
    avg_recovery_percentage: number;
    avg_days_to_resolution: number;
    total_recovered: number;
}

export interface ConfidenceCalibrationResult {
    raw_confidence: number;          // Original algorithm confidence (0-1)
    calibrated_confidence: number;   // Adjusted based on historical data (0-1)
    calibration_factor: number;      // Multiplier applied
    historical_approval_rate: number; // What % of this type gets approved
    sample_size: number;             // How many outcomes we're basing this on
    confidence_interval: 'high' | 'medium' | 'low'; // How much we trust this calibration
}

export interface OutcomeRecord {
    detection_result_id: string;
    seller_id: string;
    anomaly_type: string;
    predicted_confidence: number;
    estimated_value: number;
    actual_outcome: 'approved' | 'rejected' | 'partial' | 'pending' | 'expired';
    recovery_amount: number;
    amazon_case_id?: string;
    claim_filed_date?: Date;
    resolution_date?: Date;
    notes?: string;
}

// ============================================================================
// Calibration Cache
// ============================================================================

// Cache accuracy data to avoid constant DB queries
let accuracyCache: Map<string, AnomalyTypeAccuracy> = new Map();
let cacheLastUpdated: Date | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Core Calibration Functions
// ============================================================================

/**
 * Get accuracy metrics for all anomaly types
 * Uses caching to minimize DB load
 */
export async function getAnomalyTypeAccuracies(): Promise<Map<string, AnomalyTypeAccuracy>> {
    // Check cache freshness
    if (cacheLastUpdated && (Date.now() - cacheLastUpdated.getTime()) < CACHE_TTL_MS) {
        return accuracyCache;
    }

    logger.info('🧠 [CALIBRATOR] Refreshing accuracy cache from database');

    try {
        // Query the analytics view we created
        const { data, error } = await supabaseAdmin
            .from('anomaly_type_accuracy')
            .select('*');

        if (error) {
            logger.error('🧠 [CALIBRATOR] Error fetching accuracy data', { error: error.message });
            return accuracyCache; // Return stale cache on error
        }

        // Update cache
        accuracyCache = new Map();
        for (const row of data || []) {
            accuracyCache.set(row.anomaly_type, {
                anomaly_type: row.anomaly_type,
                total_claims: parseInt(row.total_claims) || 0,
                approved_count: parseInt(row.approved_count) || 0,
                rejected_count: parseInt(row.rejected_count) || 0,
                partial_count: parseInt(row.partial_count) || 0,
                pending_count: parseInt(row.pending_count) || 0,
                approval_rate: parseFloat(row.approval_rate) || 0,
                avg_predicted_confidence: parseFloat(row.avg_predicted_confidence) || 0,
                avg_recovery_percentage: parseFloat(row.avg_recovery_percentage) || 0,
                avg_days_to_resolution: parseFloat(row.avg_days_to_resolution) || 0,
                total_recovered: parseFloat(row.total_recovered) || 0
            });
        }

        cacheLastUpdated = new Date();
        logger.info('🧠 [CALIBRATOR] Cache updated', { types: accuracyCache.size });

        return accuracyCache;
    } catch (err: any) {
        logger.error('🧠 [CALIBRATOR] Exception fetching accuracy data', { error: err.message });
        return accuracyCache;
    }
}

/**
 * Calculate calibrated confidence for a detection
 * 
 * Calibration formula:
 * calibrated = raw_confidence * (historical_approval_rate / expected_approval_rate)
 * 
 * Where expected_approval_rate is based on the raw confidence
 * (e.g., 90% confidence should yield ~90% approval rate)
 */
export async function calculateCalibratedConfidence(
    anomalyType: string,
    rawConfidence: number
): Promise<ConfidenceCalibrationResult> {
    const accuracies = await getAnomalyTypeAccuracies();
    const typeAccuracy = accuracies.get(anomalyType);

    // If no historical data, return raw confidence
    if (!typeAccuracy || typeAccuracy.total_claims < 5) {
        return {
            raw_confidence: rawConfidence,
            calibrated_confidence: rawConfidence,
            calibration_factor: 1.0,
            historical_approval_rate: 0,
            sample_size: typeAccuracy?.total_claims || 0,
            confidence_interval: 'low'
        };
    }

    const historicalApprovalRate = typeAccuracy.approval_rate / 100; // Convert to 0-1
    const sampleSize = typeAccuracy.total_claims - typeAccuracy.pending_count;

    // Determine confidence interval based on sample size
    let confidenceInterval: 'high' | 'medium' | 'low';
    if (sampleSize >= 50) {
        confidenceInterval = 'high';
    } else if (sampleSize >= 20) {
        confidenceInterval = 'medium';
    } else {
        confidenceInterval = 'low';
    }

    // Calculate calibration factor
    // If we historically approve 70% but algorithm predicts 90%, we should scale down
    // If we historically approve 95% but algorithm predicts 80%, we can scale up (capped)
    const expectedRate = rawConfidence;
    let calibrationFactor: number;

    if (expectedRate > 0) {
        calibrationFactor = historicalApprovalRate / expectedRate;
        // Cap calibration factor to prevent extreme adjustments
        calibrationFactor = Math.max(0.5, Math.min(1.5, calibrationFactor));
    } else {
        calibrationFactor = 1.0;
    }

    // Apply calibration with sample size weighting
    // Small samples should have less influence
    const sampleWeight = Math.min(1.0, sampleSize / 50);
    const adjustedFactor = 1.0 + (calibrationFactor - 1.0) * sampleWeight;

    const calibratedConfidence = Math.min(0.99, Math.max(0.1, rawConfidence * adjustedFactor));

    return {
        raw_confidence: rawConfidence,
        calibrated_confidence: calibratedConfidence,
        calibration_factor: adjustedFactor,
        historical_approval_rate: historicalApprovalRate * 100,
        sample_size: sampleSize,
        confidence_interval: confidenceInterval
    };
}

/**
 * Calibrate multiple detections at once (batch processing)
 */
export async function calibrateBatch(
    detections: Array<{ anomaly_type: string; confidence_score: number }>
): Promise<Map<number, ConfidenceCalibrationResult>> {
    // Pre-load cache
    await getAnomalyTypeAccuracies();

    const results = new Map<number, ConfidenceCalibrationResult>();

    for (let i = 0; i < detections.length; i++) {
        const detection = detections[i];
        const calibration = await calculateCalibratedConfidence(
            detection.anomaly_type,
            detection.confidence_score
        );
        results.set(i, calibration);
    }

    return results;
}

// ============================================================================
// Outcome Recording
// ============================================================================

/**
 * Record a claim outcome (for learning)
 */
export async function recordOutcome(outcome: OutcomeRecord): Promise<boolean> {
    try {
        const { error } = await supabaseAdmin
            .from('detection_outcomes')
            .insert({
                detection_result_id: outcome.detection_result_id,
                seller_id: outcome.seller_id,
                anomaly_type: outcome.anomaly_type,
                predicted_confidence: outcome.predicted_confidence,
                estimated_value: outcome.estimated_value,
                actual_outcome: outcome.actual_outcome,
                recovery_amount: outcome.recovery_amount,
                amazon_case_id: outcome.amazon_case_id,
                claim_filed_date: outcome.claim_filed_date?.toISOString(),
                resolution_date: outcome.resolution_date?.toISOString(),
                notes: outcome.notes
            });

        if (error) {
            logger.error('🧠 [CALIBRATOR] Error recording outcome', { error: error.message });
            return false;
        }

        // Invalidate cache so next calibration uses fresh data
        cacheLastUpdated = null;

        logger.info('🧠 [CALIBRATOR] Outcome recorded', {
            anomalyType: outcome.anomaly_type,
            outcome: outcome.actual_outcome,
            recovery: outcome.recovery_amount
        });

        return true;
    } catch (err: any) {
        logger.error('🧠 [CALIBRATOR] Exception recording outcome', { error: err.message });
        return false;
    }
}

/**
 * Update an existing outcome (e.g., when claim is resolved)
 */
export async function updateOutcome(
    detectionResultId: string,
    updates: Partial<OutcomeRecord>
): Promise<boolean> {
    try {
        const updateData: any = {};
        if (updates.actual_outcome) updateData.actual_outcome = updates.actual_outcome;
        if (updates.recovery_amount !== undefined) updateData.recovery_amount = updates.recovery_amount;
        if (updates.amazon_case_id) updateData.amazon_case_id = updates.amazon_case_id;
        if (updates.resolution_date) updateData.resolution_date = updates.resolution_date.toISOString();
        if (updates.notes) updateData.notes = updates.notes;

        const { error } = await supabaseAdmin
            .from('detection_outcomes')
            .update(updateData)
            .eq('detection_result_id', detectionResultId);

        if (error) {
            logger.error('🧠 [CALIBRATOR] Error updating outcome', { error: error.message });
            return false;
        }

        cacheLastUpdated = null;
        return true;
    } catch (err: any) {
        logger.error('🧠 [CALIBRATOR] Exception updating outcome', { error: err.message });
        return false;
    }
}

// ============================================================================
// Analytics & Insights
// ============================================================================

/**
 * Get summary statistics for ML dashboard
 */
export async function getCalibrationStats(): Promise<{
    total_outcomes: number;
    overall_approval_rate: number;
    total_recovered: number;
    avg_days_to_resolution: number;
    top_performing_types: AnomalyTypeAccuracy[];
    underperforming_types: AnomalyTypeAccuracy[];
}> {
    const accuracies = await getAnomalyTypeAccuracies();
    const types = Array.from(accuracies.values());

    const totalOutcomes = types.reduce((s, t) => s + t.total_claims, 0);
    const totalApproved = types.reduce((s, t) => s + t.approved_count + t.partial_count, 0);
    const totalResolved = types.reduce((s, t) => s + t.total_claims - t.pending_count, 0);
    const totalRecovered = types.reduce((s, t) => s + t.total_recovered, 0);
    const avgDays = types.reduce((s, t) => s + t.avg_days_to_resolution * t.total_claims, 0) / Math.max(totalOutcomes, 1);

    // Sort by approval rate
    const sorted = types.filter(t => t.total_claims >= 5).sort((a, b) => b.approval_rate - a.approval_rate);

    return {
        total_outcomes: totalOutcomes,
        overall_approval_rate: totalResolved > 0 ? (totalApproved / totalResolved) * 100 : 0,
        total_recovered: totalRecovered,
        avg_days_to_resolution: avgDays,
        top_performing_types: sorted.slice(0, 5),
        underperforming_types: sorted.slice(-5).reverse()
    };
}

/**
 * Force cache refresh (for testing/admin)
 */
export function invalidateCache(): void {
    cacheLastUpdated = null;
    accuracyCache.clear();
    logger.info('🧠 [CALIBRATOR] Cache invalidated');
}

// ============================================================================
// Exports
// ============================================================================

export default {
    getAnomalyTypeAccuracies,
    calculateCalibratedConfidence,
    calibrateBatch,
    recordOutcome,
    updateOutcome,
    getCalibrationStats,
    invalidateCache
};
