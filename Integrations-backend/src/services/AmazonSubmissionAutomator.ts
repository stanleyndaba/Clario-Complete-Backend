import crypto from 'crypto';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import refundFilingService from './refundFilingService';

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
            logger.info(`🚀 [AGENT 7] STARTING FULL SUBMISSION PROTOCOL`, { caseId, sellerId });

            // 0. FINANCIAL SENTRY: Pre-Flight Payment Verification
            // Must occur BEFORE the database lock.
            const isAuthorized = await this.enforcePaywall(caseId, sellerId);
            if (!isAuthorized) {
                return; // Gate Closed
            }

            // 1. ATOMIC LOCK: 'pending' -> 'submitting'
            // This prevents race conditions where multiple workers pick up the same claim.
            const { data: lockData, error: lockError } = await supabaseAdmin
                .from('dispute_cases')
                .update({ 
                    filing_status: 'submitting',
                    updated_at: new Date().toISOString()
                })
                .match({ id: caseId, filing_status: 'pending' })
                .select('id, filing_status, submission_attempts, idempotency_key');

            if (lockError || !lockData || lockData.length === 0) {
                logger.info(`[FORTRESS] Claim ${caseId} already locked or processed. Exiting silently.`);
                return;
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
                await supabaseAdmin.from('dispute_cases').update({ filing_status: 'failed' }).eq('id', caseId);
                return;
            }

            // 4. Open case via SP-API Implementation
            logger.info(`✍️ [AGENT 7] Opening Amazon Seller Central case via SP-API`);

            const evidenceDocumentIds = evidence
                .map((link: any) => link.evidence_documents?.id)
                .filter(Boolean);

            const filingResult = await refundFilingService.fileDispute({
                dispute_id: caseId,
                user_id: sellerId,
                order_id: '', // Would be fetched from detection_results link normally
                claim_type: activeCase.case_type || 'inventory_loss',
                amount_claimed: parseFloat(activeCase.claim_amount?.toString() || '0'),
                currency: activeCase.currency || 'USD',
                evidence_document_ids: evidenceDocumentIds,
                confidence_score: 0.85,
                // Pass the idempotency key to the service
                metadata: { idempotency_key: idempotencyKey } 
            });

            if (!filingResult.success) {
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
            await this.updateClaimWithCaseInfo(caseId, amazonCaseId);

            // 5. Handoff to monitoring (Agent 8)
            logger.info(`✅ [AGENT 7] Handoff and complete. Case: ${amazonCaseId}`);
            return amazonCaseId;

        } catch (err: any) {
            logger.error(`❌ [AGENT 7] Submission Protocol Failure`, { error: err.message });
            // agent10.notifyFallback(caseId);
            throw err;
        }
    }

    private async updateClaimWithCaseInfo(caseId: string, amazonCaseId: string) {
        const timestamp = new Date().toISOString();

        // Update dispute_cases
        await supabaseAdmin
            .from('dispute_cases')
            .update({
                amazon_case_id: amazonCaseId,
                filing_status: 'filed',
                last_submission_attempt: timestamp,
                submission_attempts: 1 // In production, increment this
            })
            .eq('id', caseId);

        // Sync with claims table (frontend)
        await supabaseAdmin
            .from('claims')
            .update({
                amazon_case_id: amazonCaseId,
                status: 'filed',
                last_submission_attempt: timestamp,
                submission_attempts: 1
            })
            .match({ reference_id: caseId }); // Assuming reference_id maps to caseId
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
                return false;
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

                // In a real system, we would log to a dedicated security audit log here
                return false; 
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
            await this.updateClaimWithCaseInfo(caseId, amazonCase.id);
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
