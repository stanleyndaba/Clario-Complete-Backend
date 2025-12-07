/**
 * Rejection Classifier Service
 * Layer 5: Auto-Audit & Error Classification
 * Parses Amazon rejection reasons, categorizes them, and feeds learning
 */

import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import rulesEngineService from './rulesEngineService';

export interface RejectionPattern {
    id: string;
    pattern_name: string;
    amazon_reason_text: string | null;
    amazon_reason_code: string | null;
    category: 'missing_evidence' | 'wrong_amount' | 'expired_claim' | 'duplicate_claim' | 'ineligible_item' | 'insufficient_proof' | 'wrong_format' | 'policy_violation' | 'other';
    subcategory: string | null;
    is_fixable: boolean;
    fix_action: string | null;
    required_evidence: string[] | null;
    occurrence_count: number;
    success_after_fix_rate: number | null;
    auto_update_rule: boolean;
    rule_update_applied: boolean;
}

export interface ClaimRejection {
    user_id: string;
    dispute_id?: string;
    amazon_case_id?: string;
    claim_type?: string;
    rejection_reason: string;
    rejection_pattern_id?: string;
    claim_amount?: number;
    currency?: string;
    evidence_provided?: string[];
    evidence_missing?: string[];
}

class RejectionClassifierService {
    // Keywords for pattern matching
    private categoryKeywords: Record<string, string[]> = {
        missing_evidence: ['proof', 'document', 'invoice', 'receipt', 'tracking', 'pod', 'delivery', 'required', 'provide', 'submit', 'missing'],
        wrong_amount: ['amount', 'mismatch', 'discrepancy', 'incorrect', 'does not match', 'value'],
        expired_claim: ['expired', 'deadline', 'too late', 'time limit', 'outside window', 'past due'],
        duplicate_claim: ['duplicate', 'already', 'previously', 'existing', 'same claim'],
        ineligible_item: ['ineligible', 'not eligible', 'cannot be claimed', 'policy', 'excluded'],
        insufficient_proof: ['insufficient', 'additional', 'more documentation', 'not enough', 'incomplete'],
        wrong_format: ['format', 'fnsku', 'asin', 'identifier', 'sku mismatch', 'barcode'],
        policy_violation: ['violation', 'policy', 'terms', 'prohibited', 'not allowed']
    };

    /**
     * Classify a rejection reason and store it
     */
    async classifyRejection(rejection: ClaimRejection): Promise<{
        pattern: RejectionPattern | null;
        isNew: boolean;
        isFixable: boolean;
        suggestedFix: string | null;
        requiredEvidence: string[];
    }> {
        try {
            const client = supabaseAdmin || supabase;
            const reasonLower = rejection.rejection_reason.toLowerCase();

            // Try to find existing pattern
            let pattern = await this.findMatchingPattern(reasonLower);
            let isNew = false;

            if (!pattern) {
                // Create new pattern
                const category = this.detectCategory(reasonLower);
                const { isFixable, suggestedFix, requiredEvidence } = this.analyzeFix(category, reasonLower);

                const patternName = this.generatePatternName(category, reasonLower);

                const { data, error } = await client
                    .from('rejection_patterns')
                    .insert({
                        pattern_name: patternName,
                        amazon_reason_text: rejection.rejection_reason,
                        category,
                        is_fixable: isFixable,
                        fix_action: suggestedFix,
                        required_evidence: requiredEvidence,
                        occurrence_count: 1
                    })
                    .select()
                    .single();

                if (error) {
                    logger.error('Error creating rejection pattern', { error: error.message });
                } else {
                    pattern = data;
                    isNew = true;
                    logger.info('🆕 [REJECTION CLASSIFIER] New pattern detected', { patternName, category });
                }
            } else {
                // Update occurrence count
                await client
                    .from('rejection_patterns')
                    .update({
                        occurrence_count: (pattern.occurrence_count || 0) + 1,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', pattern.id);
            }

            // Store the rejection
            await this.storeRejection(rejection, pattern?.id);

            // Check if pattern should trigger rule update
            if (pattern && pattern.occurrence_count >= 5 && pattern.auto_update_rule && !pattern.rule_update_applied) {
                await this.triggerRuleUpdate(pattern, rejection.claim_type);
            }

            return {
                pattern,
                isNew,
                isFixable: pattern?.is_fixable ?? false,
                suggestedFix: pattern?.fix_action ?? null,
                requiredEvidence: pattern?.required_evidence ?? []
            };
        } catch (error: any) {
            logger.error('Error classifying rejection', { error: error.message });
            return { pattern: null, isNew: false, isFixable: false, suggestedFix: null, requiredEvidence: [] };
        }
    }

    /**
     * Find matching pattern in database
     */
    private async findMatchingPattern(reasonText: string): Promise<RejectionPattern | null> {
        try {
            const client = supabaseAdmin || supabase;

            // Try exact match first
            const { data: exactMatch } = await client
                .from('rejection_patterns')
                .select('*')
                .ilike('amazon_reason_text', `%${reasonText.substring(0, 50)}%`)
                .limit(1)
                .maybeSingle();

            if (exactMatch) return exactMatch;

            // Try category + subcategory match
            const category = this.detectCategory(reasonText);
            const subcategory = this.detectSubcategory(category, reasonText);

            if (subcategory) {
                const { data: categoryMatch } = await client
                    .from('rejection_patterns')
                    .select('*')
                    .eq('category', category)
                    .eq('subcategory', subcategory)
                    .limit(1)
                    .maybeSingle();

                if (categoryMatch) return categoryMatch;
            }

            return null;
        } catch (error: any) {
            logger.error('Error finding matching pattern', { error: error.message });
            return null;
        }
    }

    /**
     * Detect category from rejection text
     */
    private detectCategory(text: string): RejectionPattern['category'] {
        const textLower = text.toLowerCase();

        for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
            const matches = keywords.filter(kw => textLower.includes(kw));
            if (matches.length >= 2) {
                return category as RejectionPattern['category'];
            }
        }

        // Default fallback based on single keyword
        for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
            if (keywords.some(kw => textLower.includes(kw))) {
                return category as RejectionPattern['category'];
            }
        }

        return 'other';
    }

    /**
     * Detect subcategory for more specific classification
     */
    private detectSubcategory(category: string, text: string): string | null {
        const textLower = text.toLowerCase();

        const subcategories: Record<string, Record<string, string[]>> = {
            missing_evidence: {
                pod: ['proof of delivery', 'pod', 'delivery proof'],
                invoice: ['invoice', 'purchase order', 'receipt'],
                tracking: ['tracking', 'shipment', 'carrier'],
                vat: ['vat', 'tax id', 'tax document'],
                photo: ['photo', 'image', 'picture']
            },
            wrong_amount: {
                mismatch: ['mismatch', 'does not match'],
                calculation: ['calculate', 'incorrect amount']
            },
            wrong_format: {
                identifier: ['fnsku', 'asin', 'sku', 'barcode'],
                date: ['date format', 'invalid date']
            }
        };

        const catSubcats = subcategories[category];
        if (!catSubcats) return null;

        for (const [subcat, keywords] of Object.entries(catSubcats)) {
            if (keywords.some(kw => textLower.includes(kw))) {
                return subcat;
            }
        }

        return null;
    }

    /**
     * Analyze if the rejection is fixable and how
     */
    private analyzeFix(category: string, text: string): {
        isFixable: boolean;
        suggestedFix: string | null;
        requiredEvidence: string[];
    } {
        const fixes: Record<string, { isFixable: boolean; fix: string; evidence: string[] }> = {
            missing_evidence: {
                isFixable: true,
                fix: 'Upload the required documentation',
                evidence: this.extractRequiredEvidence(text)
            },
            wrong_amount: {
                isFixable: true,
                fix: 'Review and correct the claim amount based on documentation',
                evidence: ['invoice']
            },
            insufficient_proof: {
                isFixable: true,
                fix: 'Provide additional supporting documentation',
                evidence: ['invoice', 'pod', 'tracking']
            },
            wrong_format: {
                isFixable: true,
                fix: 'Verify identifiers (FNSKU, ASIN, SKU) match on all documents',
                evidence: ['invoice']
            },
            expired_claim: {
                isFixable: false,
                fix: 'Claim cannot be fixed - deadline has passed',
                evidence: []
            },
            duplicate_claim: {
                isFixable: false,
                fix: 'Review existing claims for duplicates',
                evidence: []
            },
            ineligible_item: {
                isFixable: false,
                fix: 'Item is not eligible under current policy',
                evidence: []
            },
            policy_violation: {
                isFixable: false,
                fix: 'Claim violates Amazon policy',
                evidence: []
            },
            other: {
                isFixable: true,
                fix: 'Review rejection reason and provide additional information',
                evidence: []
            }
        };

        const fixInfo = fixes[category] || fixes['other'];
        return {
            isFixable: fixInfo.isFixable,
            suggestedFix: fixInfo.fix,
            requiredEvidence: fixInfo.evidence
        };
    }

    /**
     * Extract required evidence types from rejection text
     */
    private extractRequiredEvidence(text: string): string[] {
        const textLower = text.toLowerCase();
        const evidence: string[] = [];

        if (textLower.includes('invoice') || textLower.includes('receipt')) evidence.push('invoice');
        if (textLower.includes('proof of delivery') || textLower.includes('pod')) evidence.push('pod');
        if (textLower.includes('tracking')) evidence.push('tracking');
        if (textLower.includes('photo') || textLower.includes('image')) evidence.push('photo');
        if (textLower.includes('vat') || textLower.includes('tax')) evidence.push('vat_document');

        return evidence.length > 0 ? evidence : ['invoice']; // Default to invoice
    }

    /**
     * Generate a unique pattern name
     */
    private generatePatternName(category: string, text: string): string {
        const timestamp = Date.now().toString(36);
        const shortText = text.substring(0, 20).replace(/[^a-z0-9]/gi, '_');
        return `${category}_${shortText}_${timestamp}`;
    }

    /**
     * Store rejection in database
     */
    private async storeRejection(rejection: ClaimRejection, patternId?: string): Promise<void> {
        try {
            const client = supabaseAdmin || supabase;

            await client.from('claim_rejections').insert({
                user_id: rejection.user_id,
                dispute_id: rejection.dispute_id,
                amazon_case_id: rejection.amazon_case_id,
                claim_type: rejection.claim_type,
                rejection_reason: rejection.rejection_reason,
                rejection_pattern_id: patternId,
                claim_amount: rejection.claim_amount,
                currency: rejection.currency || 'USD',
                evidence_provided: rejection.evidence_provided,
                evidence_missing: rejection.evidence_missing,
                created_at: new Date().toISOString()
            });
        } catch (error: any) {
            logger.error('Error storing rejection', { error: error.message });
        }
    }

    /**
     * Trigger automatic rule update from pattern
     */
    private async triggerRuleUpdate(pattern: RejectionPattern, claimType?: string): Promise<void> {
        if (!claimType || !pattern.required_evidence?.length) return;

        try {
            await rulesEngineService.applyRuleFromRejection(
                pattern.id,
                claimType,
                pattern.required_evidence
            );

            logger.info('📈 [REJECTION CLASSIFIER] Auto-triggered rule update', {
                patternId: pattern.id,
                patternName: pattern.pattern_name,
                claimType,
                requiredEvidence: pattern.required_evidence
            });
        } catch (error: any) {
            logger.error('Error triggering rule update', { error: error.message });
        }
    }

    /**
     * Get top rejection reasons for a user
     */
    async getTopRejectionReasons(userId: string, limit: number = 10): Promise<any[]> {
        try {
            const client = supabaseAdmin || supabase;

            const { data, error } = await client
                .from('rejection_patterns')
                .select('*')
                .order('occurrence_count', { ascending: false })
                .limit(limit);

            if (error) {
                logger.error('Error fetching top rejections', { error: error.message });
                return [];
            }

            return data || [];
        } catch (error: any) {
            logger.error('Error in getTopRejectionReasons', { error: error.message });
            return [];
        }
    }

    /**
     * Get rejection statistics
     */
    async getRejectionStats(userId: string, days: number = 30): Promise<{
        total: number;
        byCategory: Record<string, number>;
        fixableRate: number;
        topPatterns: RejectionPattern[];
    }> {
        try {
            const client = supabaseAdmin || supabase;
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

            // Get rejections for user
            const { data: rejections, error } = await client
                .from('claim_rejections')
                .select('*, rejection_patterns(*)')
                .eq('user_id', userId)
                .gte('created_at', since);

            if (error || !rejections) {
                return { total: 0, byCategory: {}, fixableRate: 0, topPatterns: [] };
            }

            const byCategory: Record<string, number> = {};
            let fixableCount = 0;

            for (const r of rejections) {
                const cat = r.rejection_patterns?.category || 'other';
                byCategory[cat] = (byCategory[cat] || 0) + 1;
                if (r.rejection_patterns?.is_fixable) fixableCount++;
            }

            const topPatterns = await this.getTopRejectionReasons(userId, 5);

            return {
                total: rejections.length,
                byCategory,
                fixableRate: rejections.length > 0 ? fixableCount / rejections.length : 0,
                topPatterns
            };
        } catch (error: any) {
            logger.error('Error getting rejection stats', { error: error.message });
            return { total: 0, byCategory: {}, fixableRate: 0, topPatterns: [] };
        }
    }
}

export const rejectionClassifierService = new RejectionClassifierService();
export default rejectionClassifierService;
