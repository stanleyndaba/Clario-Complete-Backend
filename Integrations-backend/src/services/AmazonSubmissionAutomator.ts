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

function parseStringOrNull(value: any): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
}
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import refundFilingService from './refundFilingService';
import { evaluateAndPersistCaseEligibility } from './agent7EligibilityService';
import {
    isAgent7UnpaidFilingOverrideEnabled,
    recordAgent7UnpaidFilingOverride
} from './agent7UnpaidFilingOverride';

/**
 * Enhanced Agent 7: Automated Amazon Interface Handler
 * Manages the full lifecycle of a claim submission from validation to handoff.
 */
export class AmazonSubmissionAutomator {
    private async resolveSubmissionAttemptNumber(caseId: string): Promise<number> {
        const { data, error } = await supabaseAdmin
            .from('dispute_submissions')
            .select('attempt_number')
            .eq('dispute_id', caseId)
            .order('attempt_number', { ascending: false })
            .limit(1);

        if (error) {
            throw error;
        }

        const lastAttempt = Number(data?.[0]?.attempt_number || 0);
        return lastAttempt + 1;
    }

    private async markSubmissionStateDivergence(
        caseId: string,
        sellerId: string,
        tenantId: string,
        message: string
    ): Promise<void> {
        const timestamp = new Date().toISOString();

        await supabaseAdmin
            .from('dispute_cases')
            .update({
                filing_status: 'failed',
                eligible_to_file: false,
                block_reasons: ['submission_state_divergence'],
                last_error: message,
                updated_at: timestamp
            })
            .eq('id', caseId)
            .eq('tenant_id', tenantId);

        await supabaseAdmin
            .from('refund_filing_errors')
            .insert({
                user_id: sellerId,
                dispute_id: caseId,
                error_type: 'submission_state_divergence',
                error_message: message,
                metadata: {
                    tenant_id: tenantId
                },
                created_at: timestamp
            });
    }

    private async resolveInternalUserIdForSeller(sellerId: string): Promise<string> {
        const { data: directUser } = await supabaseAdmin
            .from('users')
            .select('id')
            .or(`id.eq.${sellerId},amazon_seller_id.eq.${sellerId},seller_id.eq.${sellerId}`)
            .limit(1)
            .maybeSingle();

        const { data: mapping } = await supabaseAdmin
            .from('v1_seller_identity_map')
            .select('user_id')
            .eq('merchant_token', sellerId)
            .maybeSingle();

        if (directUser?.id) {
            if (mapping?.user_id && mapping.user_id !== directUser.id) {
                logger.warn('[AGENT 7] Seller identity map diverges from live seller binding; preferring direct user match', {
                    sellerId,
                    mappedUserId: mapping.user_id,
                    directUserId: directUser.id
                });
            }

            return directUser.id;
        }

        if (mapping?.user_id) {
            return mapping.user_id;
        }

        const { data: user } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('amazon_seller_id', sellerId)
            .maybeSingle();

        if (user?.id) {
            return user.id;
        }

        throw new Error(`[AGENT 7 FATAL] Identity Mapping Missing: Seller ${sellerId} is not mapped to any internal user.`);
    }

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
            const internalUserId = await this.enforcePaywall(caseId, sellerId, caseInfo.tenant_id);

            const eligibilitySnapshot = await evaluateAndPersistCaseEligibility(caseId, caseInfo.tenant_id);
            if (!eligibilitySnapshot.eligible) {
                throw new Error(`[AGENT 7 BLOCKED] Case ${caseId} is not eligible to file: ${eligibilitySnapshot.reasons.join(', ')}`);
            }

            const submissionAttempts = await this.resolveSubmissionAttemptNumber(caseId);

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
                .select('id, filing_status, idempotency_key, claim_amount, currency, case_type, tenant_id, detection_result_id, estimated_recovery_amount');

            if (lockError || !lockData || lockData.length === 0) {
                throw new Error(`[AGENT 7 FATAL] Atomic Lock Failed: Case ${caseId} already processed or not in 'pending' state.`);
            }

            const activeCase = lockData[0];

            // 2. IDEMPOTENCY KEY GENERATION
            // Deterministic hash ensures same claim + same seller = same key for Amazon SP-API
            const idempotencyKey = crypto.createHash('sha256')
                .update(`v1_filing_${caseId}_${sellerId}`)
                .digest('hex');

            // Save the key before the API call to ensure we can reconcile after a crash.
            const { error: keyUpdateError } = await supabaseAdmin
                .from('dispute_cases')
                .update({ 
                    idempotency_key: idempotencyKey
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

            // 3. Harvesting Evidence (durable Agent 4/5 handoff)
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

            // 4. Open case via the real Seller Central submission channel
            logger.info(`✍️ [AGENT 7] Opening Amazon Seller Central case via browser submission channel`);

            const evidenceDocumentIds = evidence
                .map((link: any) => link.evidence_documents?.id)
                .filter(Boolean);

            const detectionEvidence = eligibilitySnapshot.detectionResult?.evidence || {};
            const evidenceAttachments = parseJsonObject((eligibilitySnapshot as any)?.disputeCase?.evidence_attachments);
            const decisionIntelligence = evidenceAttachments?.decision_intelligence || {};
            const proofSnapshot = decisionIntelligence?.proof_snapshot || null;
            const filingStrategy = decisionIntelligence?.filing_strategy || 'AUTO';
            const adaptiveStrategyHints = decisionIntelligence?.adaptive_strategy_hints || {};
            const explanationPayload = decisionIntelligence?.explanation_payload || proofSnapshot?.explanationPayload || null;
            const fnskuCandidates = [
                detectionEvidence.fnsku,
                evidenceAttachments?.fnsku,
                ...(Array.isArray(proofSnapshot?.matchedIdentifiers?.productIds) ? proofSnapshot.matchedIdentifiers.productIds : [])
            ]
                .map((value: any) => String(value || '').trim())
                .filter(Boolean);
            const fnsku = fnskuCandidates.find((value) => /^[XB][A-Z0-9]{9,}$/i.test(value)) || fnskuCandidates[0] || undefined;

            if (!proofSnapshot) {
                await supabaseAdmin
                    .from('dispute_cases')
                    .update({
                        filing_status: 'blocked',
                        eligible_to_file: false,
                        block_reasons: ['missing_proof_snapshot'],
                        last_error: 'Proof snapshot missing at submission time',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', caseId)
                    .eq('tenant_id', caseInfo.tenant_id);
                throw new Error(`[AGENT 7 BLOCKED] Missing proof snapshot for case ${caseId}`);
            }

            if (proofSnapshot.filingStrategy === 'BLOCKED') {
                await supabaseAdmin
                    .from('dispute_cases')
                    .update({
                        filing_status: 'blocked',
                        eligible_to_file: false,
                        block_reasons: ['proof_snapshot_not_filing_ready'],
                        last_error: explanationPayload?.justification || `Proof snapshot recommends ${proofSnapshot.filingRecommendation}`,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', caseId)
                    .eq('tenant_id', caseInfo.tenant_id);
                throw new Error(`[AGENT 7 BLOCKED] Proof snapshot is blocked for case ${caseId}`);
            }

            const filingResult = await refundFilingService.fileDispute({
                dispute_id: caseId,
                user_id: internalUserId,
                seller_id: sellerId,
                tenant_id: caseInfo.tenant_id,
                order_id: detectionEvidence.order_id || '',
                shipment_id: detectionEvidence.shipment_id || detectionEvidence.fba_shipment_id || undefined,
                asin: detectionEvidence.asin || undefined,
                sku: detectionEvidence.sku || undefined,
                fnsku,
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
                    fnsku: fnsku || null,
                    proof_snapshot: proofSnapshot,
                    explanation_payload: explanationPayload,
                    strategy_hints: [
                        adaptiveStrategyHints?.templateVariant,
                        adaptiveStrategyHints?.evidenceMode,
                        adaptiveStrategyHints?.timing
                    ].filter(Boolean),
                    filing_strategy: filingStrategy
                }
            });

            if (!filingResult.success) {
                await supabaseAdmin
                    .from('dispute_cases')
                    .update({
                        filing_status: filingResult.status === 'blocked' ? 'blocked' : filingResult.status === 'retrying' ? 'retrying' : 'failed',
                        last_error: filingResult.last_error || filingResult.error_message || 'Filing failed',
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
            await this.updateClaimWithCaseInfo(caseId, sellerId, internalUserId, caseInfo.tenant_id, filingResult, submissionAttempts);

            // 5. Handoff to monitoring (Agent 8)
            logger.info(`✅ [AGENT 7] Handoff and complete. Case: ${amazonCaseId}`);
            return amazonCaseId;

        } catch (err: any) {
            logger.error(`❌ [AGENT 7] Submission Protocol Failure`, { error: err.message });
            // agent10.notifyFallback(caseId);
            throw err;
        }
    }

    private async updateClaimWithCaseInfo(
        caseId: string,
        sellerId: string,
        internalUserId: string,
        tenantId: string,
        result: Awaited<ReturnType<typeof refundFilingService.fileDispute>>,
        submissionAttempts: number
    ) {
        const timestamp = result.response_received_at || new Date().toISOString();
        const amazonCaseId = result.amazon_case_id || null;
        const externalReference = result.external_reference || amazonCaseId || null;
        const submissionId = result.submission_id || externalReference;
        const requestSummary = parseJsonObject(result.request_summary);
        const responseSummary = parseJsonObject(result.response_summary);
        const rawTrace = parseJsonObject(responseSummary.raw_response_or_trace);
        const transcriptSnapshot =
            parseStringOrNull(responseSummary.transcript_snapshot) ||
            parseStringOrNull(rawTrace.transcript_snapshot);
        const popupUrl =
            parseStringOrNull(responseSummary.popup_url) ||
            parseStringOrNull(rawTrace.popup_url) ||
            parseStringOrNull(rawTrace.popupUrl);
        const contactRequestId =
            parseStringOrNull(responseSummary.contact_request_id) ||
            parseStringOrNull(rawTrace.contact_request_id) ||
            parseStringOrNull(rawTrace.contactRequestId);
        const supportHeader =
            parseStringOrNull(responseSummary.support_header) ||
            parseStringOrNull(rawTrace.support_header);
        const screenshotPath =
            parseStringOrNull(responseSummary.screenshot_path) ||
            parseStringOrNull(rawTrace.screenshot_path) ||
            parseStringOrNull(rawTrace.screenshot);
        const chatSurface = Boolean(
            responseSummary.chat_surface ??
            rawTrace.chat_surface
        );
        const composerDetected = Boolean(
            responseSummary.composer_detected ??
            rawTrace.composer_detected
        );
        const submissionMetadata = {
            popup_url: popupUrl,
            case_id: externalReference,
            contact_request_id: contactRequestId,
            support_header: supportHeader,
            transcript_snapshot: transcriptSnapshot,
            screenshot_path: screenshotPath,
            chat_surface: chatSurface,
            composer_detected: composerDetected,
            initial_message_visible: transcriptSnapshot ? /me sent at|hello,|margin analytics has joined the chat/i.test(transcriptSnapshot) : false,
            source_surface: 'seller_central_chat_popup'
        };

        if (!result.authoritative_proof || !externalReference) {
            throw new Error('Agent 7 refused to mark the claim filed because no authoritative external submission proof was returned.');
        }

        const ledgerRow = {
            dispute_id: caseId,
            tenant_id: tenantId,
            user_id: internalUserId,
            seller_id: sellerId,
            submission_id: submissionId,
            amazon_case_id: amazonCaseId,
            external_reference: externalReference,
            idempotency_key: result.idempotency_key || null,
            request_started_at: result.request_started_at || timestamp,
            response_received_at: result.response_received_at || timestamp,
            submission_channel: result.submission_channel || 'seller_central_chat',
            request_summary: requestSummary,
            response_summary: responseSummary,
            attachment_manifest: result.attachment_manifest || [],
            outcome: result.outcome || result.status || 'submitted',
            status: result.status,
            last_error: null,
            attempt_number: submissionAttempts,
            submission_timestamp: timestamp,
            metadata: submissionMetadata,
            created_at: timestamp,
            updated_at: timestamp
        };

        const { error: submissionError } = await supabaseAdmin
            .from('dispute_submissions')
            .upsert(ledgerRow, {
                onConflict: 'tenant_id,dispute_id,idempotency_key'
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
                provider_case_id: externalReference,
                filing_status: 'filed',
                status: 'submitted',
                submission_date: timestamp,
                last_error: null,
                eligible_to_file: true,
                block_reasons: []
            })
            .eq('id', caseId)
            .eq('tenant_id', tenantId);

        if (disputeUpdateError) {
            const divergenceMessage = `Amazon submission persisted as ${submissionId || 'unknown'} but dispute case update failed: ${disputeUpdateError.message}`;
            await this.markSubmissionStateDivergence(caseId, sellerId, tenantId, divergenceMessage);
            throw new Error(divergenceMessage);
        }

        const { error: claimSyncError } = await supabaseAdmin
            .from('claims')
            .update({
                status: 'submitted',
                submitted_at: timestamp,
                metadata: {
                    amazon_case_id: amazonCaseId,
                    provider_case_id: externalReference,
                    submission_id: submissionId
                }
            })
            .match({ reference_id: caseId });

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
    private async enforcePaywall(caseId: string, sellerId: string, tenantId: string): Promise<string> {
        try {
            const userId = await this.resolveInternalUserIdForSeller(sellerId);

            // 2. FINANCIAL GUARD: Check payment status for the mapped userId
            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select('is_paid_beta')
                .eq('id', userId)
                .single();

            if (error || !user) {
                throw new Error(`[AGENT 7 FATAL] Could not resolve billing state for mapped user ${userId}.`);
            }

            if (!user?.is_paid_beta && isAgent7UnpaidFilingOverrideEnabled()) {
                await recordAgent7UnpaidFilingOverride({
                    tenantId,
                    disputeId: caseId,
                    userId,
                    sellerId,
                    stage: 'submission_gate'
                });
                return userId;
            }

            if (!user?.is_paid_beta) {
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

            return userId;
        } catch (err: any) {
            logger.error(`❌ [AGENT 7] Paywall Check Error: ${err.message}`);
            throw err;
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
            const internalUserId = await this.resolveInternalUserIdForSeller(sellerId);
            const { data: existingCase, error: caseLookupError } = await supabaseAdmin
                .from('dispute_cases')
                .select('tenant_id')
                .eq('id', caseId)
                .single();

            if (caseLookupError || !existingCase?.tenant_id) {
                throw caseLookupError || new Error(`Missing tenant context for recovered case ${caseId}`);
            }

            await this.updateClaimWithCaseInfo(
                caseId,
                sellerId,
                internalUserId,
                existingCase.tenant_id,
                {
                    success: true,
                    status: 'submitted',
                    submission_id: amazonCase.id,
                    amazon_case_id: amazonCase.id,
                    external_reference: amazonCase.id,
                    authoritative_proof: true,
                    outcome: 'submitted',
                    submission_channel: 'seller_central_chat',
                    idempotency_key: idempotencyKey
                },
                await this.resolveSubmissionAttemptNumber(caseId)
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
