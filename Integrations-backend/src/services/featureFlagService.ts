/**
 * Feature Flag Service
 * Layer 6: Canary + Feature Flags for Gradual Rollout
 * Enables safe deployment of rule changes with A/B testing
 */

import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import crypto from 'crypto';

export interface FeatureFlag {
    id: string;
    flag_name: string;
    description: string | null;
    flag_type: 'rule_update' | 'threshold_change' | 'evidence_requirement' | 'feature' | 'experiment';
    is_enabled: boolean;
    rollout_percentage: number;
    target_users: string[] | null;
    exclude_users: string[] | null;
    conditions: Record<string, any>;
    payload: Record<string, any>;
    metrics: Record<string, any>;
    success_metric: string | null;
    success_threshold: number | null;
    auto_expand: boolean;
    created_by: string | null;
    expires_at: string | null;
}

export interface FlagEvaluation {
    flagName: string;
    enabled: boolean;
    reason: string;
    payload?: Record<string, any>;
}

class FeatureFlagService {
    private flagCache: Map<string, FeatureFlag> = new Map();
    private cacheExpiry: number = 60 * 1000; // 1 minute
    private lastCacheUpdate: number = 0;

    /**
     * Check if a flag is enabled for a user
     */
    async isEnabled(flagName: string, userId: string, context?: Record<string, any>): Promise<boolean> {
        const evaluation = await this.evaluate(flagName, userId, context);
        return evaluation.enabled;
    }

    /**
     * Evaluate a flag for a user with full details
     */
    async evaluate(flagName: string, userId: string, context?: Record<string, any>): Promise<FlagEvaluation> {
        try {
            const flag = await this.getFlag(flagName);

            if (!flag) {
                return { flagName, enabled: false, reason: 'flag_not_found' };
            }

            if (!flag.is_enabled) {
                await this.logEvaluation(flag.id, flagName, userId, false, 'flag_disabled');
                return { flagName, enabled: false, reason: 'flag_disabled' };
            }

            // Check expiry
            if (flag.expires_at && new Date(flag.expires_at) < new Date()) {
                await this.logEvaluation(flag.id, flagName, userId, false, 'flag_expired');
                return { flagName, enabled: false, reason: 'flag_expired' };
            }

            // Check exclude list
            if (flag.exclude_users?.includes(userId)) {
                await this.logEvaluation(flag.id, flagName, userId, false, 'user_excluded');
                return { flagName, enabled: false, reason: 'user_excluded' };
            }

            // Check target list (if specified, only target users get the flag)
            if (flag.target_users && flag.target_users.length > 0) {
                const isTargeted = flag.target_users.includes(userId);
                await this.logEvaluation(flag.id, flagName, userId, isTargeted, isTargeted ? 'user_targeted' : 'not_in_target_list');
                return {
                    flagName,
                    enabled: isTargeted,
                    reason: isTargeted ? 'user_targeted' : 'not_in_target_list',
                    payload: isTargeted ? flag.payload : undefined
                };
            }

            // Check additional conditions
            if (Object.keys(flag.conditions || {}).length > 0 && context) {
                if (!this.evaluateConditions(flag.conditions, context)) {
                    await this.logEvaluation(flag.id, flagName, userId, false, 'conditions_not_met');
                    return { flagName, enabled: false, reason: 'conditions_not_met' };
                }
            }

            // Percentage rollout using consistent hashing
            if (flag.rollout_percentage < 100) {
                const hash = this.hashUserForFlag(userId, flagName);
                const inRollout = hash < flag.rollout_percentage;
                await this.logEvaluation(flag.id, flagName, userId, inRollout, inRollout ? 'in_rollout' : 'outside_rollout');
                return {
                    flagName,
                    enabled: inRollout,
                    reason: inRollout ? 'in_rollout' : 'outside_rollout',
                    payload: inRollout ? flag.payload : undefined
                };
            }

            // Flag is enabled for all
            await this.logEvaluation(flag.id, flagName, userId, true, 'enabled_for_all');
            return { flagName, enabled: true, reason: 'enabled_for_all', payload: flag.payload };
        } catch (error: any) {
            logger.error('Error evaluating feature flag', { error: error.message, flagName, userId });
            return { flagName, enabled: false, reason: 'evaluation_error' };
        }
    }

    /**
     * Get a flag by name
     */
    async getFlag(flagName: string): Promise<FeatureFlag | null> {
        try {
            // Check cache
            if (this.isCacheValid() && this.flagCache.has(flagName)) {
                return this.flagCache.get(flagName)!;
            }

            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from('feature_flags')
                .select('*')
                .eq('flag_name', flagName)
                .maybeSingle();

            if (error) {
                logger.error('Error fetching feature flag', { error: error.message, flagName });
                return null;
            }

            if (data) {
                this.flagCache.set(flagName, data);
                this.lastCacheUpdate = Date.now();
            }

            return data;
        } catch (error: any) {
            logger.error('Error in getFlag', { error: error.message, flagName });
            return null;
        }
    }

    /**
     * Get all active flags
     */
    async getAllFlags(): Promise<FeatureFlag[]> {
        try {
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from('feature_flags')
                .select('*')
                .eq('is_enabled', true);

            if (error) {
                logger.error('Error fetching all feature flags', { error: error.message });
                return [];
            }

            return data || [];
        } catch (error: any) {
            logger.error('Error in getAllFlags', { error: error.message });
            return [];
        }
    }

    /**
     * Create a new feature flag
     */
    async createFlag(flag: Partial<FeatureFlag>): Promise<string | null> {
        try {
            const client = supabaseAdmin || supabase;

            const { data, error } = await client
                .from('feature_flags')
                .insert({
                    flag_name: flag.flag_name,
                    description: flag.description,
                    flag_type: flag.flag_type || 'feature',
                    is_enabled: flag.is_enabled ?? false,
                    rollout_percentage: flag.rollout_percentage ?? 0,
                    target_users: flag.target_users,
                    exclude_users: flag.exclude_users,
                    conditions: flag.conditions || {},
                    payload: flag.payload || {},
                    metrics: flag.metrics || {},
                    success_metric: flag.success_metric,
                    success_threshold: flag.success_threshold,
                    auto_expand: flag.auto_expand ?? false,
                    created_by: flag.created_by,
                    expires_at: flag.expires_at
                })
                .select('id')
                .single();

            if (error) {
                logger.error('Error creating feature flag', { error: error.message });
                return null;
            }

            this.invalidateCache();
            logger.info('🚩 [FEATURE FLAGS] Created new flag', { flagName: flag.flag_name });
            return data.id;
        } catch (error: any) {
            logger.error('Error in createFlag', { error: error.message });
            return null;
        }
    }

    /**
     * Update flag rollout percentage
     */
    async updateRollout(flagName: string, percentage: number): Promise<boolean> {
        try {
            const client = supabaseAdmin || supabase;

            const { error } = await client
                .from('feature_flags')
                .update({
                    rollout_percentage: Math.min(100, Math.max(0, percentage)),
                    updated_at: new Date().toISOString()
                })
                .eq('flag_name', flagName);

            if (error) {
                logger.error('Error updating flag rollout', { error: error.message, flagName });
                return false;
            }

            this.invalidateCache();
            logger.info('🚩 [FEATURE FLAGS] Updated rollout', { flagName, percentage });
            return true;
        } catch (error: any) {
            logger.error('Error in updateRollout', { error: error.message, flagName });
            return false;
        }
    }

    /**
     * Enable/disable a flag
     */
    async setEnabled(flagName: string, enabled: boolean): Promise<boolean> {
        try {
            const client = supabaseAdmin || supabase;

            const { error } = await client
                .from('feature_flags')
                .update({
                    is_enabled: enabled,
                    updated_at: new Date().toISOString()
                })
                .eq('flag_name', flagName);

            if (error) {
                logger.error('Error updating flag status', { error: error.message, flagName });
                return false;
            }

            this.invalidateCache();
            logger.info('🚩 [FEATURE FLAGS] Flag status updated', { flagName, enabled });
            return true;
        } catch (error: any) {
            logger.error('Error in setEnabled', { error: error.message, flagName });
            return false;
        }
    }

    /**
     * Record metrics for a flag
     */
    async recordMetric(
        flagName: string,
        metricName: string,
        value: number,
        isControlGroup: boolean = false
    ): Promise<void> {
        try {
            const flag = await this.getFlag(flagName);
            if (!flag) return;

            const client = supabaseAdmin || supabase;

            await client.from('feature_flag_metrics').insert({
                flag_id: flag.id,
                flag_name: flagName,
                metric_name: metricName,
                metric_value: value,
                is_control_group: isControlGroup,
                period_start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24h
                period_end: new Date().toISOString()
            });

            // Check for auto-expansion
            if (flag.auto_expand && flag.success_metric === metricName && flag.success_threshold) {
                if (!isControlGroup && value >= flag.success_threshold) {
                    await this.autoExpand(flagName, flag.rollout_percentage);
                }
            }
        } catch (error: any) {
            logger.error('Error recording metric', { error: error.message, flagName, metricName });
        }
    }

    /**
     * Auto-expand rollout when success threshold is met
     */
    private async autoExpand(flagName: string, currentPercentage: number): Promise<void> {
        const expansionSteps = [10, 25, 50, 75, 100];
        const nextStep = expansionSteps.find(step => step > currentPercentage);

        if (nextStep) {
            await this.updateRollout(flagName, nextStep);
            logger.info('📈 [FEATURE FLAGS] Auto-expanded rollout', {
                flagName,
                from: currentPercentage,
                to: nextStep
            });
        }
    }

    /**
     * Get metrics for a flag
     */
    async getMetrics(flagName: string, days: number = 7): Promise<any[]> {
        try {
            const client = supabaseAdmin || supabase;
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

            const { data, error } = await client
                .from('feature_flag_metrics')
                .select('*')
                .eq('flag_name', flagName)
                .gte('created_at', since)
                .order('created_at', { ascending: false });

            if (error) {
                logger.error('Error fetching flag metrics', { error: error.message, flagName });
                return [];
            }

            return data || [];
        } catch (error: any) {
            logger.error('Error in getMetrics', { error: error.message, flagName });
            return [];
        }
    }

    /**
     * Log flag evaluation for analytics
     */
    private async logEvaluation(
        flagId: string,
        flagName: string,
        userId: string,
        evaluatedTo: boolean,
        reason: string
    ): Promise<void> {
        try {
            const client = supabaseAdmin || supabase;

            await client.from('feature_flag_evaluations').insert({
                flag_id: flagId,
                flag_name: flagName,
                user_id: userId,
                evaluated_to: evaluatedTo,
                reason
            });
        } catch (error: any) {
            // Silent fail - don't block for logging
            logger.debug('Failed to log flag evaluation', { error: error.message });
        }
    }

    /**
     * Consistent hash for user rollout
     * Same user always gets same result for same flag
     */
    private hashUserForFlag(userId: string, flagName: string): number {
        const hash = crypto
            .createHash('md5')
            .update(`${userId}:${flagName}`)
            .digest('hex');

        // Convert first 8 chars to number (0-100)
        const num = parseInt(hash.substring(0, 8), 16);
        return num % 100;
    }

    /**
     * Evaluate conditions against context
     */
    private evaluateConditions(conditions: Record<string, any>, context: Record<string, any>): boolean {
        for (const [key, value] of Object.entries(conditions)) {
            if (context[key] !== value) {
                return false;
            }
        }
        return true;
    }

    /**
     * Cache management
     */
    private isCacheValid(): boolean {
        return Date.now() - this.lastCacheUpdate < this.cacheExpiry;
    }

    invalidateCache(): void {
        this.flagCache.clear();
        this.lastCacheUpdate = 0;
    }
}

export const featureFlagService = new FeatureFlagService();
export default featureFlagService;
