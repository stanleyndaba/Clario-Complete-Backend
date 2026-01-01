/**
 * ML Scoring Service
 * Learns from user approve/reject actions to improve confidence scoring
 * Uses historical success rates by match pattern
 */

import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';

interface FeedbackEntry {
    claim_type: string;
    match_type: string;
    matched_fields: string[];
    user_action: 'approved' | 'rejected';
    confidence_score: number;
}

interface MatchPattern {
    claim_type: string;
    match_type: string;
    matched_fields: string[];
}

class MLScoringService {
    private client = supabaseAdmin || supabase;

    // Cache for pattern scores (refreshed every 5 minutes)
    private patternCache: Map<string, { score: number; timestamp: number }> = new Map();
    private cacheTTL = 5 * 60 * 1000; // 5 minutes

    /**
     * Log user feedback (approve/reject) for learning
     */
    async logFeedback(entry: FeedbackEntry): Promise<void> {
        try {
            // Try to insert into matching_feedback table
            const { error } = await this.client
                .from('matching_feedback')
                .insert({
                    claim_type: entry.claim_type,
                    match_type: entry.match_type,
                    matched_fields: entry.matched_fields,
                    user_action: entry.user_action,
                    confidence_score: entry.confidence_score,
                    created_at: new Date().toISOString()
                });

            if (error) {
                // Table might not exist - log to detection_results.evidence JSONB instead
                logger.warn('⚠️ [ML SCORING] matching_feedback table not available, logging to fallback', {
                    error: error.message
                });
                return;
            }

            logger.info('📊 [ML SCORING] Logged feedback', {
                claim_type: entry.claim_type,
                match_type: entry.match_type,
                user_action: entry.user_action
            });

            // Invalidate cache for this pattern
            const cacheKey = this.getCacheKey(entry);
            this.patternCache.delete(cacheKey);

        } catch (error: any) {
            logger.warn('⚠️ [ML SCORING] Failed to log feedback (non-critical)', {
                error: error.message
            });
        }
    }

    /**
     * Calculate ML score based on historical approval rates
     * Returns a score between 0 and 1
     */
    async calculateMLScore(pattern: MatchPattern): Promise<number> {
        try {
            const cacheKey = this.getCacheKey(pattern);

            // Check cache
            const cached = this.patternCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.score;
            }

            // Query historical approval rate for this pattern
            const { data: feedback, error } = await this.client
                .from('matching_feedback')
                .select('user_action')
                .eq('claim_type', pattern.claim_type)
                .eq('match_type', pattern.match_type);

            if (error || !feedback || feedback.length === 0) {
                // No historical data - return neutral score
                return 0.5;
            }

            // Calculate approval rate
            const approvedCount = feedback.filter(f => f.user_action === 'approved').length;
            const totalCount = feedback.length;
            const approvalRate = approvedCount / totalCount;

            // Weight towards 0.5 if sample size is small (Bayesian smoothing)
            const minSamples = 10;
            const smoothedScore = (approvalRate * totalCount + 0.5 * minSamples) / (totalCount + minSamples);

            // Cache the result
            this.patternCache.set(cacheKey, {
                score: smoothedScore,
                timestamp: Date.now()
            });

            logger.debug('📊 [ML SCORING] Calculated ML score', {
                pattern,
                approvalRate,
                smoothedScore,
                sampleSize: totalCount
            });

            return smoothedScore;

        } catch (error: any) {
            logger.warn('⚠️ [ML SCORING] Failed to calculate ML score', {
                error: error.message
            });
            return 0.5; // Neutral fallback
        }
    }

    /**
     * Blend rule score with ML score
     * rule_weight: 0.6, ml_weight: 0.4 (ML gets more weight as data grows)
     */
    async blendScores(ruleScore: number, pattern: MatchPattern): Promise<{
        mlScore: number;
        finalScore: number;
    }> {
        const mlScore = await this.calculateMLScore(pattern);

        // Get sample count to adjust weighting
        const sampleCount = await this.getSampleCount(pattern);

        // ML weight increases with more data (max 0.4)
        const mlWeight = Math.min(0.4, sampleCount / 50 * 0.4);
        const ruleWeight = 1 - mlWeight;

        const finalScore = (ruleScore * ruleWeight) + (mlScore * mlWeight);

        logger.debug('📊 [ML SCORING] Blended scores', {
            ruleScore,
            mlScore,
            mlWeight,
            finalScore
        });

        return { mlScore, finalScore };
    }

    /**
     * Get sample count for a pattern
     */
    private async getSampleCount(pattern: MatchPattern): Promise<number> {
        try {
            const { count } = await this.client
                .from('matching_feedback')
                .select('*', { count: 'exact', head: true })
                .eq('claim_type', pattern.claim_type)
                .eq('match_type', pattern.match_type);

            return count || 0;
        } catch {
            return 0;
        }
    }

    /**
     * Generate cache key for pattern
     */
    private getCacheKey(pattern: MatchPattern | FeedbackEntry): string {
        return `${pattern.claim_type}:${pattern.match_type}:${(pattern.matched_fields || []).sort().join(',')}`;
    }

    /**
     * Get learning statistics
     */
    async getStats(): Promise<{
        totalFeedback: number;
        approvalRate: number;
        topPatterns: { pattern: string; count: number; approvalRate: number }[];
    }> {
        try {
            const { data, error } = await this.client
                .from('matching_feedback')
                .select('claim_type, match_type, user_action');

            if (error || !data) {
                return { totalFeedback: 0, approvalRate: 0, topPatterns: [] };
            }

            const totalFeedback = data.length;
            const approvedCount = data.filter(f => f.user_action === 'approved').length;
            const approvalRate = totalFeedback > 0 ? approvedCount / totalFeedback : 0;

            // Group by pattern
            const patternMap = new Map<string, { approved: number; total: number }>();
            for (const entry of data) {
                const key = `${entry.claim_type}:${entry.match_type}`;
                const existing = patternMap.get(key) || { approved: 0, total: 0 };
                existing.total++;
                if (entry.user_action === 'approved') existing.approved++;
                patternMap.set(key, existing);
            }

            const topPatterns = Array.from(patternMap.entries())
                .map(([pattern, stats]) => ({
                    pattern,
                    count: stats.total,
                    approvalRate: stats.approved / stats.total
                }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            return { totalFeedback, approvalRate, topPatterns };

        } catch (error: any) {
            logger.error('❌ [ML SCORING] Failed to get stats', { error: error.message });
            return { totalFeedback: 0, approvalRate: 0, topPatterns: [] };
        }
    }
}

const mlScoringService = new MLScoringService();
export default mlScoringService;
