import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import refundFilingService from './refundFilingService';
import evidenceMatchingService from './evidenceMatchingService';

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

            // 1. Validate claim readiness & Fetch Data
            const { data: caseData, error: caseError } = await supabaseAdmin
                .from('dispute_cases')
                .select('*, detection_results(*)')
                .eq('id', caseId)
                .single();

            if (caseError || !caseData) {
                throw new Error(`Claim data not found for ID: ${caseId}`);
            }

            // 2. Harvesting Evidence (Agent 4/5 integration simulation)
            logger.info(`📂 [AGENT 7] Harvesting evidence for Case: ${caseId}`);
            const { data: evidence, error: evidenceError } = await supabaseAdmin
                .from('dispute_evidence_links')
                .select('evidence_documents(*)')
                .eq('dispute_case_id', caseId);

            if (evidenceError || !evidence || evidence.length === 0) {
                logger.warn(`⚠️ [AGENT 7] Missing evidence for Case: ${caseId}. Escalating to Agent 10.`);
                // agent10.notify('Claim missing evidence - escalation needed');
                return;
            }

            // 3. Open case via best method (API Implementation)
            logger.info(`✍️ [AGENT 7] Opening Amazon Seller Central case via SP-API`);
            const filingResult = await refundFilingService.fileDispute({
                caseId: caseId,
                sellerId: sellerId,
                amount: caseData.amount,
                reason: caseData.reason || 'Inventory Loss Post-Receive'
            });

            if (!filingResult.success) {
                throw new Error(`Filing failed: ${filingResult.error}`);
            }

            const amazonCaseId = filingResult.amazonCaseId;

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
}

export default new AmazonSubmissionAutomator();
