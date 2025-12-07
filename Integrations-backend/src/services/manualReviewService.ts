/**
 * Manual Review Service
 * Layer 7: Human-in-the-Loop Backstop
 * Flags cases for human review, records analyst corrections, feeds back to learning
 */

import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import agentEventLogger, { AgentType, EventType } from './agentEventLogger';
import rulesEngineService from './rulesEngineService';

export interface ManualReviewItem {
    id: string;
    user_id: string;
    dispute_id: string | null;
    amazon_case_id: string | null;
    review_type: 'repeated_rejection' | 'low_confidence' | 'new_pattern' | 'edge_case' | 'escalation' | 'quality_check';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    status: 'pending' | 'assigned' | 'in_review' | 'completed' | 'archived';
    assigned_to: string | null;
    context: Record<string, any>;
    rejection_history: any[];
    analyst_notes: string | null;
    analyst_correction: Record<string, any> | null;
    correction_type: 'rule_update' | 'evidence_mapping' | 'threshold_adjustment' | 'new_pattern' | 'no_action' | 'escalate' | null;
    fed_back_to_learning: boolean;
}

export interface AnalystCorrection {
    review_id: string;
    analyst_id: string;
    correction_type: string;
    before_state: Record<string, any>;
    after_state: Record<string, any>;
    reasoning: string;
    impact_assessment: string | null;
}

class ManualReviewService {
    /**
     * Add a case to the manual review queue
     */
    async addToReviewQueue(
        userId: string,
        reviewType: ManualReviewItem['review_type'],
        context: Record<string, any>,
        options?: {
            disputeId?: string;
            amazonCaseId?: string;
            priority?: ManualReviewItem['priority'];
            rejectionHistory?: any[];
        }
    ): Promise<string | null> {
        try {
            const client = supabaseAdmin || supabase;

            // Check if already in queue
            const { data: existing } = await client
                .from('manual_review_queue')
                .select('id')
                .eq('user_id', userId)
                .eq('dispute_id', options?.disputeId)
                .eq('status', 'pending')
                .maybeSingle();

            if (existing) {
                logger.debug('Review item already in queue', { existingId: existing.id });
                return existing.id;
            }

            // Determine priority based on review type
            let priority = options?.priority || 'normal';
            if (reviewType === 'repeated_rejection' && (options?.rejectionHistory?.length || 0) >= 3) {
                priority = 'high';
            }
            if (reviewType === 'escalation') {
                priority = 'urgent';
            }

            const { data, error } = await client
                .from('manual_review_queue')
                .insert({
                    user_id: userId,
                    dispute_id: options?.disputeId,
                    amazon_case_id: options?.amazonCaseId,
                    review_type: reviewType,
                    priority,
                    status: 'pending',
                    context,
                    rejection_history: options?.rejectionHistory || [],
                    created_at: new Date().toISOString()
                })
                .select('id')
                .single();

            if (error) {
                logger.error('Error adding to review queue', { error: error.message });
                return null;
            }

            logger.info('👨‍💼 [MANUAL REVIEW] Case added to review queue', {
                reviewId: data.id,
                userId,
                reviewType,
                priority
            });

            return data.id;
        } catch (error: any) {
            logger.error('Error in addToReviewQueue', { error: error.message });
            return null;
        }
    }

    /**
     * Flag case for review due to repeated rejections
     */
    async flagForRepeatedRejection(
        userId: string,
        disputeId: string,
        rejectionHistory: any[],
        amazonCaseId?: string
    ): Promise<string | null> {
        return this.addToReviewQueue(userId, 'repeated_rejection', {
            rejection_count: rejectionHistory.length,
            last_rejection: rejectionHistory[rejectionHistory.length - 1],
            patterns_detected: this.detectPatterns(rejectionHistory)
        }, {
            disputeId,
            amazonCaseId,
            rejectionHistory,
            priority: rejectionHistory.length >= 5 ? 'urgent' : 'high'
        });
    }

    /**
     * Flag case for review due to low confidence
     */
    async flagForLowConfidence(
        userId: string,
        disputeId: string,
        confidence: number,
        matchDetails: Record<string, any>
    ): Promise<string | null> {
        return this.addToReviewQueue(userId, 'low_confidence', {
            confidence,
            match_details: matchDetails,
            reason: `Match confidence (${(confidence * 100).toFixed(1)}%) below review threshold`
        }, {
            disputeId,
            priority: confidence < 0.3 ? 'high' : 'normal'
        });
    }

    /**
     * Detect patterns in rejection history
     */
    private detectPatterns(rejections: any[]): string[] {
        const patterns: string[] = [];
        const reasons = rejections.map(r => r.reason?.toLowerCase() || '');

        // Check for same reason repeated
        const reasonCounts: Record<string, number> = {};
        for (const reason of reasons) {
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        }

        for (const [reason, count] of Object.entries(reasonCounts)) {
            if (count >= 2) {
                patterns.push(`Repeated: ${reason.substring(0, 50)}...`);
            }
        }

        // Check for evidence-related rejections
        if (reasons.some(r => r.includes('evidence') || r.includes('proof') || r.includes('document'))) {
            patterns.push('Evidence-related issues');
        }

        return patterns;
    }

    /**
     * Get pending review items
     */
    async getPendingReviews(options?: {
        priority?: string;
        reviewType?: string;
        limit?: number;
    }): Promise<ManualReviewItem[]> {
        try {
            const client = supabaseAdmin || supabase;

            let query = client
                .from('manual_review_queue')
                .select('*')
                .eq('status', 'pending')
                .order('priority', { ascending: false })
                .order('created_at', { ascending: true });

            if (options?.priority) {
                query = query.eq('priority', options.priority);
            }
            if (options?.reviewType) {
                query = query.eq('review_type', options.reviewType);
            }
            if (options?.limit) {
                query = query.limit(options.limit);
            }

            const { data, error } = await query;

            if (error) {
                logger.error('Error fetching pending reviews', { error: error.message });
                return [];
            }

            return data || [];
        } catch (error: any) {
            logger.error('Error in getPendingReviews', { error: error.message });
            return [];
        }
    }

    /**
     * Assign review to analyst
     */
    async assignReview(reviewId: string, analystId: string): Promise<boolean> {
        try {
            const client = supabaseAdmin || supabase;

            const { error } = await client
                .from('manual_review_queue')
                .update({
                    status: 'assigned',
                    assigned_to: analystId,
                    updated_at: new Date().toISOString()
                })
                .eq('id', reviewId);

            if (error) {
                logger.error('Error assigning review', { error: error.message, reviewId });
                return false;
            }

            logger.info('👨‍💼 [MANUAL REVIEW] Review assigned', { reviewId, analystId });
            return true;
        } catch (error: any) {
            logger.error('Error in assignReview', { error: error.message });
            return false;
        }
    }

    /**
     * Submit analyst correction
     */
    async submitCorrection(
        reviewId: string,
        analystId: string,
        correction: AnalystCorrection
    ): Promise<boolean> {
        try {
            const client = supabaseAdmin || supabase;

            // Store correction
            const { data: correctionData, error: correctionError } = await client
                .from('analyst_corrections')
                .insert({
                    review_id: reviewId,
                    analyst_id: analystId,
                    correction_type: correction.correction_type,
                    before_state: correction.before_state,
                    after_state: correction.after_state,
                    reasoning: correction.reasoning,
                    impact_assessment: correction.impact_assessment,
                    created_at: new Date().toISOString()
                })
                .select('id')
                .single();

            if (correctionError) {
                logger.error('Error storing correction', { error: correctionError.message });
                return false;
            }

            // Update review item
            const { error: updateError } = await client
                .from('manual_review_queue')
                .update({
                    status: 'completed',
                    analyst_correction: correction.after_state,
                    correction_type: correction.correction_type,
                    analyst_notes: correction.reasoning,
                    completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', reviewId);

            if (updateError) {
                logger.error('Error updating review', { error: updateError.message });
                return false;
            }

            logger.info('👨‍💼 [MANUAL REVIEW] Correction submitted', {
                reviewId,
                analystId,
                correctionType: correction.correction_type
            });

            // Apply correction and feed back to learning
            await this.applyCorrection(reviewId, correction);

            return true;
        } catch (error: any) {
            logger.error('Error in submitCorrection', { error: error.message });
            return false;
        }
    }

    /**
     * Apply correction and feed back to learning system
     */
    private async applyCorrection(reviewId: string, correction: AnalystCorrection): Promise<void> {
        const client = supabaseAdmin || supabase;

        try {
            switch (correction.correction_type) {
                case 'rule_update':
                    // Apply rule update through rules engine
                    if (correction.after_state.rule_id) {
                        await rulesEngineService.updateRule(
                            correction.after_state.rule_id,
                            correction.after_state.updates,
                            correction.analyst_id
                        );
                    }
                    break;

                case 'evidence_mapping':
                    // Update evidence mapping
                    if (correction.after_state.claim_type && correction.after_state.evidence_type) {
                        await rulesEngineService.updateEvidenceMapping(
                            correction.after_state.claim_type,
                            correction.after_state.evidence_type,
                            correction.after_state.updates
                        );
                    }
                    break;

                case 'new_pattern':
                    // Analyst identified new pattern - store for future matching
                    logger.info('👨‍💼 [MANUAL REVIEW] New pattern registered', {
                        pattern: correction.after_state.pattern
                    });
                    break;

                case 'threshold_adjustment':
                    // Log threshold adjustment for learning
                    logger.info('👨‍💼 [MANUAL REVIEW] Threshold adjustment logged', {
                        adjustment: correction.after_state
                    });
                    break;
            }

            // Mark correction as applied
            await client
                .from('analyst_corrections')
                .update({ was_applied: true, applied_at: new Date().toISOString() })
                .eq('review_id', reviewId);

            // Log to agent events for learning
            const eventId = await agentEventLogger.logEvent({
                userId: 'system',
                agent: AgentType.LEARNING,
                eventType: EventType.ANALYST_CORRECTION,
                success: true,
                metadata: {
                    review_id: reviewId,
                    correction_type: correction.correction_type,
                    reasoning: correction.reasoning,
                    before_state: correction.before_state,
                    after_state: correction.after_state
                }
            });

            // Update review to mark as fed back
            await client
                .from('manual_review_queue')
                .update({
                    fed_back_to_learning: true,
                    learning_event_id: eventId
                })
                .eq('id', reviewId);

            logger.info('👨‍💼 [MANUAL REVIEW] Correction applied and fed to learning', { reviewId });
        } catch (error: any) {
            logger.error('Error applying correction', { error: error.message, reviewId });
        }
    }

    /**
     * Get review statistics
     */
    async getReviewStats(): Promise<{
        pending: number;
        inReview: number;
        completed: number;
        byType: Record<string, number>;
        byPriority: Record<string, number>;
        avgResolutionTime: number | null;
    }> {
        try {
            const client = supabaseAdmin || supabase;

            const { data, error } = await client
                .from('manual_review_queue')
                .select('status, review_type, priority, created_at, completed_at');

            if (error || !data) {
                return {
                    pending: 0,
                    inReview: 0,
                    completed: 0,
                    byType: {},
                    byPriority: {},
                    avgResolutionTime: null
                };
            }

            const stats = {
                pending: 0,
                inReview: 0,
                completed: 0,
                byType: {} as Record<string, number>,
                byPriority: {} as Record<string, number>,
                avgResolutionTime: null as number | null
            };

            let totalResolutionTime = 0;
            let resolvedCount = 0;

            for (const item of data) {
                // By status
                if (item.status === 'pending') stats.pending++;
                else if (item.status === 'in_review' || item.status === 'assigned') stats.inReview++;
                else if (item.status === 'completed') stats.completed++;

                // By type
                stats.byType[item.review_type] = (stats.byType[item.review_type] || 0) + 1;

                // By priority
                stats.byPriority[item.priority] = (stats.byPriority[item.priority] || 0) + 1;

                // Resolution time
                if (item.completed_at && item.created_at) {
                    const resolutionTime = new Date(item.completed_at).getTime() - new Date(item.created_at).getTime();
                    totalResolutionTime += resolutionTime;
                    resolvedCount++;
                }
            }

            if (resolvedCount > 0) {
                stats.avgResolutionTime = totalResolutionTime / resolvedCount / (1000 * 60 * 60); // Hours
            }

            return stats;
        } catch (error: any) {
            logger.error('Error getting review stats', { error: error.message });
            return {
                pending: 0,
                inReview: 0,
                completed: 0,
                byType: {},
                byPriority: {},
                avgResolutionTime: null
            };
        }
    }
}

export const manualReviewService = new ManualReviewService();
export default manualReviewService;
