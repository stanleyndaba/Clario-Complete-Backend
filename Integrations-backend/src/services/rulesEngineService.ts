/**
 * Rules Engine Service
 * Layer 2: Hot-updatable claim rules stored in database
 * No code changes needed to update rules - just update DB
 */

import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface ClaimRule {
    id: string;
    rule_name: string;
    claim_type: string;
    rule_type: 'detection' | 'validation' | 'evidence_requirement' | 'threshold' | 'filing' | 'deadline';
    conditions: Record<string, any>;
    actions: Record<string, any>;
    priority: number;
    is_active: boolean;
    version: number;
    effective_from: string;
    effective_until: string | null;
}

export interface EvidenceMapping {
    id: string;
    claim_type: string;
    evidence_type: string;
    requirement_level: 'mandatory' | 'recommended' | 'optional' | 'conditional';
    conditions: Record<string, any>;
    weight: number;
    description: string;
    amazon_field_name: string | null;
    is_active: boolean;
}

class RulesEngineService {
    private rulesCache: Map<string, ClaimRule[]> = new Map();
    private evidenceCache: Map<string, EvidenceMapping[]> = new Map();
    private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes
    private lastCacheUpdate: number = 0;

    /**
     * Get all active rules for a claim type
     */
    async getClaimRules(claimType: string, ruleType?: string): Promise<ClaimRule[]> {
        try {
            // Check cache
            if (this.isCacheValid() && this.rulesCache.has(claimType)) {
                const cached = this.rulesCache.get(claimType)!;
                if (ruleType) {
                    return cached.filter(r => r.rule_type === ruleType);
                }
                return cached;
            }

            const client = supabaseAdmin || supabase;
            let query = client
                .from('claim_rules')
                .select('*')
                .eq('claim_type', claimType)
                .eq('is_active', true)
                .order('priority', { ascending: false });

            if (ruleType) {
                query = query.eq('rule_type', ruleType);
            }

            // Filter by effective dates
            const now = new Date().toISOString();
            query = query
                .lte('effective_from', now)
                .or(`effective_until.is.null,effective_until.gte.${now}`);

            const { data, error } = await query;

            if (error) {
                logger.error('Error fetching claim rules', { error: error.message, claimType });
                return [];
            }

            // Update cache
            this.rulesCache.set(claimType, data || []);
            this.lastCacheUpdate = Date.now();

            return data || [];
        } catch (error: any) {
            logger.error('Error in getClaimRules', { error: error.message, claimType });
            return [];
        }
    }

    /**
     * Get all rules (for a full refresh)
     */
    async getAllRules(): Promise<ClaimRule[]> {
        try {
            const client = supabaseAdmin || supabase;
            const now = new Date().toISOString();

            const { data, error } = await client
                .from('claim_rules')
                .select('*')
                .eq('is_active', true)
                .lte('effective_from', now)
                .or(`effective_until.is.null,effective_until.gte.${now}`)
                .order('priority', { ascending: false });

            if (error) {
                logger.error('Error fetching all claim rules', { error: error.message });
                return [];
            }

            return data || [];
        } catch (error: any) {
            logger.error('Error in getAllRules', { error: error.message });
            return [];
        }
    }

    /**
     * Update a rule (hot-update without code change)
     */
    async updateRule(
        ruleId: string,
        updates: Partial<Pick<ClaimRule, 'conditions' | 'actions' | 'priority' | 'is_active'>>,
        updatedBy?: string
    ): Promise<boolean> {
        try {
            const client = supabaseAdmin || supabase;

            // Get current version
            const { data: current } = await client
                .from('claim_rules')
                .select('version')
                .eq('id', ruleId)
                .single();

            const newVersion = (current?.version || 0) + 1;

            const { error } = await client
                .from('claim_rules')
                .update({
                    ...updates,
                    version: newVersion,
                    updated_by: updatedBy,
                    updated_at: new Date().toISOString()
                })
                .eq('id', ruleId);

            if (error) {
                logger.error('Error updating claim rule', { error: error.message, ruleId });
                return false;
            }

            // Invalidate cache
            this.invalidateCache();

            logger.info('🔧 [RULES ENGINE] Rule updated', { ruleId, updates, newVersion });
            return true;
        } catch (error: any) {
            logger.error('Error in updateRule', { error: error.message, ruleId });
            return false;
        }
    }

    /**
     * Create a new rule
     */
    async createRule(rule: Omit<ClaimRule, 'id' | 'version'>): Promise<string | null> {
        try {
            const client = supabaseAdmin || supabase;

            const { data, error } = await client
                .from('claim_rules')
                .insert({
                    ...rule,
                    version: 1,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select('id')
                .single();

            if (error) {
                logger.error('Error creating claim rule', { error: error.message });
                return null;
            }

            this.invalidateCache();
            logger.info('🔧 [RULES ENGINE] New rule created', { ruleId: data.id, ruleName: rule.rule_name });
            return data.id;
        } catch (error: any) {
            logger.error('Error in createRule', { error: error.message });
            return null;
        }
    }

    /**
     * Get evidence requirements for a claim type
     */
    async getEvidenceRequirements(claimType: string): Promise<EvidenceMapping[]> {
        try {
            // Check cache
            if (this.isCacheValid() && this.evidenceCache.has(claimType)) {
                return this.evidenceCache.get(claimType)!;
            }

            const client = supabaseAdmin || supabase;

            const { data, error } = await client
                .from('evidence_mappings')
                .select('*')
                .eq('claim_type', claimType)
                .eq('is_active', true)
                .order('weight', { ascending: false });

            if (error) {
                logger.error('Error fetching evidence mappings', { error: error.message, claimType });
                return [];
            }

            // Update cache
            this.evidenceCache.set(claimType, data || []);
            this.lastCacheUpdate = Date.now();

            return data || [];
        } catch (error: any) {
            logger.error('Error in getEvidenceRequirements', { error: error.message, claimType });
            return [];
        }
    }

    /**
     * Update evidence mapping (e.g., change weight or requirement level)
     */
    async updateEvidenceMapping(
        claimType: string,
        evidenceType: string,
        updates: Partial<Pick<EvidenceMapping, 'requirement_level' | 'weight' | 'conditions'>>
    ): Promise<boolean> {
        try {
            const client = supabaseAdmin || supabase;

            // Get current version
            const { data: current } = await client
                .from('evidence_mappings')
                .select('version')
                .eq('claim_type', claimType)
                .eq('evidence_type', evidenceType)
                .single();

            const newVersion = (current?.version || 0) + 1;

            const { error } = await client
                .from('evidence_mappings')
                .update({
                    ...updates,
                    version: newVersion,
                    updated_at: new Date().toISOString()
                })
                .eq('claim_type', claimType)
                .eq('evidence_type', evidenceType);

            if (error) {
                logger.error('Error updating evidence mapping', { error: error.message, claimType, evidenceType });
                return false;
            }

            this.invalidateCache();
            logger.info('🔧 [RULES ENGINE] Evidence mapping updated', { claimType, evidenceType, updates });
            return true;
        } catch (error: any) {
            logger.error('Error in updateEvidenceMapping', { error: error.message });
            return false;
        }
    }

    /**
     * Elevate evidence requirement (e.g., from recommended to mandatory)
     * Called by learning system when many rejections cite missing evidence
     */
    async elevateEvidenceRequirement(
        claimType: string,
        evidenceType: string,
        newLevel: 'mandatory' | 'recommended',
        reason?: string
    ): Promise<boolean> {
        const updated = await this.updateEvidenceMapping(claimType, evidenceType, {
            requirement_level: newLevel,
            weight: newLevel === 'mandatory' ? 1.00 : 0.85
        });

        if (updated) {
            logger.info('📈 [RULES ENGINE] Evidence requirement elevated', {
                claimType,
                evidenceType,
                newLevel,
                reason
            });
        }

        return updated;
    }

    /**
     * Apply rule from rejection pattern
     * Called when rejection patterns reach a threshold
     */
    async applyRuleFromRejection(
        rejectionPatternId: string,
        claimType: string,
        requiredEvidence: string[]
    ): Promise<boolean> {
        try {
            // For each required evidence, ensure it's at least recommended
            for (const evidenceType of requiredEvidence) {
                const existing = await this.getEvidenceRequirements(claimType);
                const mapping = existing.find(e => e.evidence_type === evidenceType);

                if (!mapping) {
                    // Create new mapping
                    const client = supabaseAdmin || supabase;
                    await client.from('evidence_mappings').insert({
                        claim_type: claimType,
                        evidence_type: evidenceType,
                        requirement_level: 'recommended',
                        weight: 0.75,
                        description: `Auto-added from rejection pattern ${rejectionPatternId}`
                    });
                } else if (mapping.requirement_level === 'optional') {
                    // Elevate to recommended
                    await this.elevateEvidenceRequirement(claimType, evidenceType, 'recommended',
                        `Elevated from rejection pattern ${rejectionPatternId}`);
                }
            }

            // Mark pattern as applied
            const client = supabaseAdmin || supabase;
            await client
                .from('rejection_patterns')
                .update({ rule_update_applied: true, updated_at: new Date().toISOString() })
                .eq('id', rejectionPatternId);

            logger.info('🔧 [RULES ENGINE] Rule applied from rejection pattern', {
                rejectionPatternId,
                claimType,
                requiredEvidence
            });

            return true;
        } catch (error: any) {
            logger.error('Error applying rule from rejection', { error: error.message });
            return false;
        }
    }

    /**
     * Evaluate claim against rules
     * Returns matched rules and recommended actions
     */
    async evaluateClaim(
        claimType: string,
        claimData: Record<string, any>
    ): Promise<{
        matchedRules: ClaimRule[];
        recommendedActions: Record<string, any>;
        requiredEvidence: string[];
        optionalEvidence: string[];
    }> {
        const matchedRules: ClaimRule[] = [];
        const recommendedActions: Record<string, any> = {};
        const requiredEvidence: string[] = [];
        const optionalEvidence: string[] = [];

        try {
            // Get all active rules for this claim type
            const rules = await this.getClaimRules(claimType);

            // Evaluate each rule
            for (const rule of rules) {
                if (this.evaluateConditions(rule.conditions, claimData)) {
                    matchedRules.push(rule);
                    Object.assign(recommendedActions, rule.actions);
                }
            }

            // Get evidence requirements
            const evidenceReqs = await this.getEvidenceRequirements(claimType);
            for (const req of evidenceReqs) {
                if (req.requirement_level === 'mandatory') {
                    requiredEvidence.push(req.evidence_type);
                } else if (req.requirement_level === 'recommended') {
                    optionalEvidence.push(req.evidence_type);
                }
            }

            return { matchedRules, recommendedActions, requiredEvidence, optionalEvidence };
        } catch (error: any) {
            logger.error('Error evaluating claim', { error: error.message, claimType });
            return { matchedRules, recommendedActions, requiredEvidence, optionalEvidence };
        }
    }

    /**
     * Simple condition evaluator
     */
    private evaluateConditions(conditions: Record<string, any>, data: Record<string, any>): boolean {
        if (!conditions || Object.keys(conditions).length === 0) {
            return true; // No conditions = always match
        }

        for (const [key, value] of Object.entries(conditions)) {
            if (key.endsWith('_min')) {
                const field = key.replace('_min', '');
                if ((data[field] ?? 0) < value) return false;
            } else if (key.endsWith('_max')) {
                const field = key.replace('_max', '');
                if ((data[field] ?? 0) > value) return false;
            } else if (typeof value === 'boolean') {
                if (data[key] !== value) return false;
            } else {
                if (data[key] !== value) return false;
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
        this.rulesCache.clear();
        this.evidenceCache.clear();
        this.lastCacheUpdate = 0;
        logger.debug('[RULES ENGINE] Cache invalidated');
    }
}

export const rulesEngineService = new RulesEngineService();
export default rulesEngineService;
