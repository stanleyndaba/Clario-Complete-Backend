import crypto from 'crypto';

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
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import refundFilingService from './refundFilingService';
import { evaluateAndPersistCaseEligibility } from './agent7EligibilityService';

/**
 * Enhanced Agent 7: Automated Amazon Interface Handler
 * Manages the full lifecycle of a claim submission from validation to handoff.
 */
export class AmazonSubmissionAutomator {
    /**
     * Executes the full submission protocol for a dispute case.
     */
    async executeFullSubmission(caseId: string, sellerId: string) {
        try {
            // Fetch case number for forensic logging
            const { data: caseInfo } = await supabaseAdmin
                .from('dispute_cases')
                .select('case_number, tenant_id')
                .eq('id', caseId)
                .single();
            
            const caseNum = caseInfo?.case_number || caseId;
            logger.info(`[AGENT 7] Transmitting claim ${caseNum} to Seller Central for seller ${sellerId}.`);
            logger.info(`🚀 [AGENT 7] STARTING FULL SUBMISSION PROTOCOL`, { caseId, sellerId });

            if (!caseInfo?.tenant_id) {
                throw new Error(`[AGENT 7 FATAL] Missing tenant context for case ${caseId}`);
            }

            // 0. FINANCIAL SENTRY: Pre-Flight Payment Verification
            // Must occur BEFORE the database lock.
            const isAuthorized = await this.enforcePaywall(caseId, sellerId);
            if (!isAuthorized) {
                throw new Error(`[AGENT 7 FATAL] Financial Sentry: Paywall check failed. Seller: ${sellerId}`);
            }

            const eligibilitySnapshot = await evaluateAndPersistCaseEligibility(caseId, caseInfo.tenant_id);
            if (!eligibilitySnapshot.eligible) {
                throw new Error(`[AGENT 7 BLOCKED] Case ${caseId} is not eligible to file: ${eligibilitySnapshot.reasons.join(', ')}`);
            }

            // 1. ATOMIC LOCK: 'pending' -> 'submitting'
            // This prevents race conditions where multiple workers pick up the same claim.
            const { data: lockData, error: lockError } = await supabaseAdmin
                .from('dispute_cases')
                .update({ 
                    filing_status: 'submitting',
                    last_error: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', caseId)
                .eq('tenant_id', caseInfo.tenant_id)
                .eq('eligible_to_file', true)
                .in('filing_status', ['pending', 'retrying'])
                .select('id, filing_status, submission_attempts, idempotency_key, claim_amount, currency, case_type, tenant_id, detection_result_id, estimated_recovery_amount');

            if (lockError || !lockData || lockData.length === 0) {
                throw new Error(`[AGENT 7 FATAL] Atomic Lock Failed: Case ${caseId} already processed or not in 'pending' state.`);
            }

            const activeCase = lockData[0];
            const submissionAttempts = (activeCase.submission_attempts || 0) + 1;

            // 2. IDEMPOTENCY KEY GENERATION
            // Deterministic hash ensures same claim + same seller = same key for Amazon SP-API
            const idempotencyKey = crypto.createHash('sha256')
                .update(`v1_filing_${caseId}_${sellerId}`)
                .digest('hex');

            // Save the key before the API call to ensure we can reconcile after a crash.
            const { error: keyUpdateError } = await supabaseAdmin
                .from('dispute_cases')
                .update({ 
                    idempotency_key: idempotencyKey,
                    submission_attempts: submissionAttempts 
                })
                .eq('id', caseId);

            if (keyUpdateError) {
                // Check for unique constraint violation (idempotency_key)
                if ((keyUpdateError as any).code === '23505') {
                    logger.warn(`[FORTRESS] Idempotency Key collision for ${caseId}. Redirecting to Ghost Hunt.`);
                    return this.reconcileGhost(caseId, sellerId, idempotencyKey);
                }
                throw keyUpdateError;
            }

            // 3. Harvesting Evidence (Agent 4/5 integration simulation)
            logger.info(`📂 [AGENT 7] Harvesting evidence for Case: ${caseId}`);
            const { data: evidence, error: evidenceError } = await supabaseAdmin
                .from('dispute_evidence_links')
                .select('evidence_documents(*)')
                .eq('dispute_case_id', caseId);

            if (evidenceError || !evidence || evidence.length === 0) {
                logger.warn(`⚠️ [AGENT 7] Missing evidence for Case: ${caseId}. Escalating to Agent 10.`);
                await supabaseAdmin
                    .from('dispute_cases')
                    .update({
                        filing_status: 'blocked',
                        eligible_to_file: false,
                        block_reasons: ['missing_evidence_links'],
                        last_error: 'No evidence linked to case',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', caseId)
                    .eq('tenant_id', caseInfo.tenant_id);
                throw new Error(`[AGENT 7 FATAL] Harvesting Failed: No evidence linked to Case ${caseId}`);
            }

            // 4. Open case via SP-API Implementation
            logger.info(`✍️ [AGENT 7] Opening Amazon Seller Central case via SP-API`);

            const evidenceDocumentIds = evidence
                .map((link: any) => link.evidence_documents?.id)
                .filter(Boolean);

            const detectionEvidence = eligibilitySnapshot.detectionResult?.evidence || {};
            const evidenceAttachments = parseJsonObject((eligibilitySnapshot as any)?.disputeCase?.evidence_attachments);
            const decisionIntelligence = evidenceAttachments?.decision_intelligence || {};
            const filingStrategy = decisionIntelligence?.filing_strategy || {};

            const filingResult = await refundFilingService.fileDispute({
                dispute_id: caseId,
                user_id: sellerId,
                order_id: detectionEvidence.order_id || '',
                shipment_id: detectionEvidence.shipment_id || detectionEvidence.fba_shipment_id || undefined,
                asin: detectionEvidence.asin || undefined,
                sku: detectionEvidence.sku || undefined,
                claim_type: activeCase.case_type || eligibilitySnapshot.claimType || 'inventory_loss',
                amount_claimed: parseFloat((activeCase.estimated_recovery_amount ?? activeCase.claim_amount ?? 0).toString()),
                currency: activeCase.currency || 'USD',
                evidence_document_ids: evidenceDocumentIds,
                confidence_score: eligibilitySnapshot.confidenceScore ?? 0,
                // Pass the idempotency key to the service
                metadata: {
                    idempotency_key: idempotencyKey,
                    quantity: detectionEvidence.quantity || detectionEvidence.units || 1,
                    success_probability: decisionIntelligence?.success_probability ?? null,
                    priority_score: decisionIntelligence?.priority_score ?? null,
                    adaptive_confidence_threshold: decisionIntelligence?.adaptive_confidence_threshold ?? null,
                    strategy_hints: [
                        filingStrategy?.templateVariant,
                        filingStrategy?.evidenceMode,
                        filingStrategy?.timing
                    ].filter(Boolean),
                    filing_strategy: filingStrategy
                }
            });

            if (!filingResult.success) {
                await supabaseAdmin
                    .from('dispute_cases')
                    .update({
                        filing_status: 'failed',
                        last_error: filingResult.error_message || 'Filing failed',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', caseId)
                    .eq('tenant_id', caseInfo.tenant_id);
                throw new Error(`Filing failed: ${filingResult.error_message}`);
            }

            // --- CHAOS HOOK: SIGKILL SIMULATION ---
            if (process.env.SIMULATE_EXIT_AFTER_SUBMIT === 'true') {
                logger.warn('[CHAOS] SIMULATE_EXIT_AFTER_SUBMIT active. Killing process now.');
                process.exit(1);
            }
            // --------------------------------------

            const amazonCaseId = filingResult.amazon_case_id;


            // 4. Update tracking info
            await this.updateClaimWithCaseInfo(caseId, sellerId, caseInfo.tenant_id, filingResult, submissionAttempts);

            // 5. Handoff to monitoring (Agent 8)
            logger.info(`✅ [AGENT 7] Handoff and complete. Case: ${amazonCaseId}`);
            return amazonCaseId;

        } catch (err: any) {
            logger.error(`❌ [AGENT 7] Submission Protocol Failure`, { error: err.message });
            // agent10.notifyFallback(caseId);
            throw err;
        }
    }

    private async updateClaimWithCaseInfo(caseId: string, sellerId: string, tenantId: string, result: Awaited<ReturnType<typeof refundFilingService.fileDispute>>, submissionAttempts: number) {
        const timestamp = new Date().toISOString();
        const amazonCaseId = result.amazon_case_id || null;

        const { error: submissionError } = await supabaseAdmin
            .from('dispute_submissions')
            .insert({
                dispute_id: caseId,
                tenant_id: tenantId,
                user_id: sellerId,
                submission_id: result.submission_id || amazonCaseId,
                amazon_case_id: amazonCaseId,
                status: result.status,
                created_at: timestamp,
                updated_at: timestamp
            });

        if (submissionError) {
            await supabaseAdmin
                .from('dispute_cases')
                .update({
                    filing_status: 'failed',
                    last_error: `Failed to persist submission ledger: ${submissionError.message}`,
                    updated_at: timestamp
                })
                .eq('id', caseId)
                .eq('tenant_id', tenantId);

            throw submissionError;
        }

        const { error: disputeUpdateError } = await supabaseAdmin
            .from('dispute_cases')
            .update({
                amazon_case_id: amazonCaseId,
                filing_status: 'filed',
                submission_date: timestamp,
                last_submission_attempt: timestamp,
                submission_attempts: submissionAttempts,
                last_error: null,
                eligible_to_file: true,
                block_reasons: []
            })
            .eq('id', caseId)
            .eq('tenant_id', tenantId);

        if (disputeUpdateError) {
            throw disputeUpdateError;
        }

        // Sync with claims table (frontend)
        const { error: claimSyncError } = await supabaseAdmin
            .from('claims')
            .update({
                amazon_case_id: amazonCaseId,
                status: 'filed',
                last_submission_attempt: timestamp,
                submission_attempts: submissionAttempts
            })
            .match({ reference_id: caseId }); // Assuming reference_id maps to caseId

        if (claimSyncError) {
            logger.warn('[AGENT 7] Failed to sync claims table after filing', {
                caseId,
                error: claimSyncError.message
            });
        }
    }

    /**
     * Financial Sentry: Patched Zero-Trust Financial Gate
     * Maps Amazon Merchant Token -> User ID -> Payment Status
     */
    private async enforcePaywall(caseId: string, sellerId: string): Promise<boolean> {
        try {
            // 1. RELATIONAL SYNC: Map Amazon Merchant Token to internal userId
            const { data: mapping, error: mapError } = await supabaseAdmin
                .from('v1_seller_identity_map')
                .select('user_id')
                .eq('merchant_token', sellerId)
                .single();

            if (mapError || !mapping) {
                logger.error(`❌ [IDENTITY] Unmapped seller attempt: ${sellerId}. Gate Closed.`);
                throw new Error(`[AGENT 7 FATAL] Identity Mapping Missing: Seller ${sellerId} is not mapped to any user_id in v1_seller_identity_map.`);
            }

            const userId = mapping.user_id;

            // 2. FINANCIAL GUARD: Check payment status for the mapped userId
            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select('is_paid_beta')
                .eq('id', userId)
                .single();

            if (error || !user?.is_paid_beta) {
                logger.error(`🚨 [SECURITY] Unauthorized filing attempt for unpaid user: ${userId}`, { caseId });

                // Move claim to terminal 'payment_required' state
                await supabaseAdmin
                    .from('dispute_cases')
                    .update({ 
                        filing_status: 'payment_required',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', caseId);

                throw new Error(`[AGENT 7 FATAL] Security Violation: Mapped user ${userId} is not a paid beta user.`);
            }

            return true; // Authorized
        } catch (err: any) {
            logger.error(`❌ [AGENT 7] Paywall Check Error: ${err.message}`);
            return false;
        }
    }

    /**
     * Ghost Hunt Reconciliation Logic
     * Handles idempotency collisions by checking if the case already exists on Amazon.
     */
    public async reconcileGhost(caseId: string, sellerId: string, idempotencyKey: string) {
        logger.info(`🔍 [FORTRESS] Ghost Hunt initiated for case: ${caseId}`);

        const amazonCase = await refundFilingService.findCaseByIdempotencyKey(sellerId, idempotencyKey);

        if (amazonCase) {
            logger.info(`✅ [FORTRESS] Amazon match found! Recovered Case ID: ${amazonCase.id}`);
            const { data: existingCase, error: caseLookupError } = await supabaseAdmin
                .from('dispute_cases')
                .select('tenant_id, submission_attempts')
                .eq('id', caseId)
                .single();

            if (caseLookupError || !existingCase?.tenant_id) {
                throw caseLookupError || new Error(`Missing tenant context for recovered case ${caseId}`);
            }

            await this.updateClaimWithCaseInfo(
                caseId,
                sellerId,
                existingCase.tenant_id,
                {
                    success: true,
                    status: 'submitted',
                    submission_id: amazonCase.id,
                    amazon_case_id: amazonCase.id
                },
                Number(existingCase.submission_attempts || 1)
            );
            return amazonCase.id;
        } else {
            logger.warn(`⚠️ [FORTRESS] No Amazon match found for key: ${idempotencyKey}. Reverting to pending.`);
            await supabaseAdmin
                .from('dispute_cases')
                .update({ 
                    filing_status: 'pending',
                    updated_at: new Date().toISOString()
                })
                .eq('id', caseId);
            return null;
        }
    }
}

export default new AmazonSubmissionAutomator();
