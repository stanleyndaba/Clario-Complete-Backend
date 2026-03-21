import { Router, Request, Response } from 'express';
import { getLogger } from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import { compositePdfService } from '../services/compositePdfService';
import { timelineService } from '../services/timelineService';
import { extractAgent10EntityIds } from '../utils/agent10Event';
import { notificationService } from '../notifications/services/notification_service';
import { NotificationChannel, NotificationPriority, NotificationType } from '../notifications/models/notification';
import recoveriesWorker from '../workers/recoveriesWorker';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const router = Router();
const logger = getLogger('RecoveryRoutes');

function getEvidenceDocumentCount(record: any, documents: any[]): number {
    if (Array.isArray(documents) && documents.length > 0) {
        return documents.length;
    }

    if (record?.evidence_attachments?.document_id) {
        return 1;
    }

    if (Array.isArray(record?.matched_document_ids)) {
        return record.matched_document_ids.length;
    }

    return 0;
}

function deriveNextStepContext(record: any, documents: any[]) {
    const status = String(record?.status || '').toLowerCase();
    const filingStatus = String(record?.filing_status || '').toLowerCase();
    const recoveryStatus = String(record?.recovery_status || '').toLowerCase();
    const billingStatus = String(record?.billing_status || '').toLowerCase();
    const rejectionCategory = record?.evidence_attachments?.rejection_category || null;
    const rejectionReason = record?.evidence_attachments?.raw_reason_text || null;
    const evidenceCount = getEvidenceDocumentCount(record, documents);
    const hasEvidence = evidenceCount > 0;

    if (billingStatus === 'completed') {
        return {
            key: 'billing_completed',
            title: 'Billing completed',
            description: 'Recovery payout has been reconciled and billing is complete.',
            generated: false
        };
    }

    if (billingStatus === 'pending' && recoveryStatus === 'reconciled') {
        return {
            key: 'billing_pending',
            title: 'Billing pending',
            description: 'Payout is reconciled. Billing is the next system step.',
            generated: false
        };
    }

    if (recoveryStatus === 'reconciled') {
        return {
            key: 'payout_reconciled',
            title: 'Payout reconciled',
            description: 'Funds were detected and reconciled against this case.',
            generated: false
        };
    }

    if (['rejected', 'denied'].includes(status) || rejectionCategory) {
        return {
            key: 'rejected_needs_review',
            title: 'Rejected and needs review',
            description: rejectionReason || 'Amazon rejected this case. Review the rejection reason before resubmitting.',
            generated: false
        };
    }

    if (status === 'approved') {
        return {
            key: 'approved_awaiting_payout',
            title: 'Approved and awaiting payout',
            description: 'Amazon approved the case. The system is now waiting for reimbursement to appear and reconcile.',
            generated: false
        };
    }

    if (['filed', 'submitted', 'resubmitted', 'filing'].includes(filingStatus) || ['submitted', 'under review', 'under_review', 'in_progress', 'processing'].includes(status)) {
        return {
            key: 'filed_awaiting_amazon',
            title: 'Filed and awaiting Amazon',
            description: 'The claim has been filed. The next update should come from Amazon status changes or payout detection.',
            generated: false
        };
    }

    if (!hasEvidence) {
        return {
            key: 'waiting_for_evidence',
            title: 'Waiting for evidence',
            description: 'Evidence is not attached yet. Matching or manual upload is needed before filing can proceed.',
            generated: false
        };
    }

    if (['pending', 'retrying'].includes(filingStatus) || ['pending', 'new', 'open', 'detected'].includes(status)) {
        return {
            key: 'queued_for_filing',
            title: 'Queued for filing',
            description: 'The case has evidence attached and is waiting for the filing workflow to act on it.',
            generated: false
        };
    }

    return {
        key: 'manual_review_required',
        title: 'Manual review required',
        description: 'This case needs operator review because the current backend state does not map cleanly to an automated next step.',
        generated: false
    };
}

function buildGeneratedContext(record: any) {
    return {
        summaryLabel: 'Generated summary from backend case fields',
        strategyLabel: 'Generated strategy from backend case state',
        trustLabel: 'Generated risk guidance from backend case signals',
        generated: true,
        basedOn: {
            status: record?.status || null,
            filing_status: record?.filing_status || null,
            recovery_status: record?.recovery_status || null,
            billing_status: record?.billing_status || null,
            evidence_document_id: record?.evidence_attachments?.document_id || null
        }
    };
}

function buildCaseResponse(record: any, documents: any[], events: any[], objectType: 'case' | 'detection') {
    const requestedAmount = typeof record?.claim_amount === 'number'
        ? record.claim_amount
        : (typeof record?.estimated_value === 'number' ? record.estimated_value : 0);
    const approvedAmount = typeof record?.recovery_amount === 'number'
        ? record.recovery_amount
        : null;
    const actualPayoutAmount = typeof record?.actual_payout_amount === 'number'
        ? record.actual_payout_amount
        : null;
    const evidenceSummary = {
        matched_document_count: getEvidenceDocumentCount(record, documents),
        has_documents: getEvidenceDocumentCount(record, documents) > 0,
        match_type: record?.evidence_attachments?.match_type || null,
        match_confidence: record?.evidence_attachments?.match_confidence || null
    };

    return {
        id: record.id,
        object_type: objectType,
        dispute_case_id: objectType === 'case' ? record.id : null,
        detection_result_id: objectType === 'case' ? (record.detection_result_id || null) : record.id,
        title: record.case_type || record.anomaly_type || 'Claim Details',
        status: record.status || null,
        filing_status: record.filing_status || null,
        recovery_status: record.recovery_status || null,
        billing_status: record.billing_status || null,
        updated_at: record.updated_at || record.created_at || null,
        createdDate: record.created_at || record.discovery_date || null,
        expectedPayoutDate: record.expected_payout_date || null,
        sku: record.sku || record.evidence?.sku || 'N/A',
        asin: record.asin || record.evidence?.asin || null,
        productName: record.case_type || record.anomaly_type || 'Unknown Product',
        amazonCaseId: record.provider_case_id || record.amazon_case_id || null,
        currency: record.currency || 'USD',
        case_number: record.case_number || null,
        claim_number: record.claim_id || record.case_number || record.claim_number || null,
        seller_id: record.seller_id || null,
        user_id: record.user_id || null,
        store_name: record.store_name || null,
        prior_case_id: record.prior_case_id || null,
        warehouse: record.warehouse || null,
        facility: record.facility || record.evidence?.fulfillment_center || null,
        order_id: record.order_id || record.evidence?.order_id || null,
        units_lost: record.units_lost ?? record.quantity ?? null,
        units_is_verified: record.units_is_verified === true,
        unit_cost: record.unit_cost ?? null,
        confidence_score: typeof record.confidence_score === 'number' ? record.confidence_score : null,
        anomaly_type: record.anomaly_type || record.case_type || null,
        estimated_claim_value: objectType === 'detection'
            ? (typeof record.estimated_value === 'number' ? record.estimated_value : requestedAmount)
            : requestedAmount,
        requested_amount: requestedAmount,
        approved_amount: approvedAmount,
        actual_payout_amount: actualPayoutAmount,
        billed_amount: typeof record.billed_amount === 'number' ? record.billed_amount : null,
        documents,
        evidence_attachments: record.evidence_attachments || null,
        evidence: record.evidence || {},
        evidence_summary: evidenceSummary,
        rejection_category: record?.evidence_attachments?.rejection_category || null,
        rejection_reason: record?.evidence_attachments?.raw_reason_text || null,
        duplicate_blocked: record.filing_status === 'duplicate_blocked' || record.duplicate_blocked === true,
        generated_context: buildGeneratedContext(record),
        next_step_context: deriveNextStepContext(record, documents),
        events,
        ...generateCaseStrategy(record)
    };
}

/**
 * POST /api/recoveries/:id/process
 * Deterministically process payout detection + reconciliation for one approved case
 * Uses the same recoveries worker/service path as production approval handling.
 */
router.post('/:id/process', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;

        const { data: disputeCase, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('id, seller_id, status, recovery_status, tenant_id')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        if (error || !disputeCase) {
            return res.status(404).json({
                success: false,
                error: 'Recovery case not found'
            });
        }

        const result = await recoveriesWorker.processRecoveryForCase(disputeCase.id, disputeCase.seller_id);

        if (!result) {
            return res.status(200).json({
                success: true,
                processed: false,
                status: disputeCase.status,
                recovery_status: disputeCase.recovery_status,
                message: disputeCase.status !== 'approved'
                    ? 'Case is not approved yet, so recovery processing was skipped.'
                    : 'No payout match was found yet for this approved case.'
            });
        }

        return res.status(200).json({
            success: true,
            processed: true,
            result
        });

    } catch (error: any) {
        logger.error('Error processing recovery for case', { error: error.message, stack: error.stack });
        return res.status(500).json({
            success: false,
            error: 'Failed to process recovery for case'
        });
    }
});

/**
 * GET /api/recoveries/:id
 * Get full details of a recovery/claim
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';
        const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;

        logger.info('Fetching recovery details', { recoveryId: id, userId, tenantId });

        // Try dispute_cases first (filed claims) — scoped by tenant
        let { data: disputeCase, error: caseError } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        if (!disputeCase) {
            // Try by detection_result_id
            const { data: caseByDetection } = await supabaseAdmin
                .from('dispute_cases')
                .select('*')
                .eq('detection_result_id', id)
                .eq('tenant_id', tenantId)
                .single();
            disputeCase = caseByDetection;
        }

        // If found in dispute_cases, return it
        if (disputeCase) {
            // Fetch linked documents for dispute case
            const { data: docLinks } = await supabaseAdmin
                .from('dispute_evidence_links')
                .select('evidence_document_id')
                .eq('dispute_case_id', disputeCase.id)
                .eq('tenant_id', tenantId);

            let documents: any[] = [];
            if (docLinks && docLinks.length > 0) {
                const docIds = docLinks.map(l => l.evidence_document_id);
                const { data: docs } = await supabaseAdmin
                    .from('evidence_documents')
                    .select('id, filename, doc_type, created_at, metadata, extracted')
                    .in('id', docIds)
                    .eq('tenant_id', tenantId);
                documents = docs || [];
            }
            // Also check evidence_attachments for document_id (set by matching flow)
            else if (disputeCase.evidence_attachments?.document_id) {
                const { data: matchedDoc } = await supabaseAdmin
                    .from('evidence_documents')
                    .select('id, filename, doc_type, created_at, metadata, extracted')
                    .eq('id', disputeCase.evidence_attachments.document_id)
                    .eq('tenant_id', tenantId)
                    .single();
                if (matchedDoc) {
                    documents = [{
                        ...matchedDoc,
                        matchConfidence: disputeCase.evidence_attachments?.match_confidence,
                        matchType: disputeCase.evidence_attachments?.match_type,
                        matchedFields: disputeCase.evidence_attachments?.matched_fields,
                    }];
                }
            }

            return res.json(buildCaseResponse(
                disputeCase,
                documents,
                await fetchEventsForRecovery(disputeCase.id, userId, tenantId),
                'case'
            ));
        }

        // Try detection_results (unfiled claims) — scoped by tenant
        const { data: detectionResult, error: detError } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        if (detectionResult) {
            // Fetch matched documents from detection result
            let documents: any[] = [];
            const matchedDocIds = detectionResult.matched_document_ids;
            if (matchedDocIds && Array.isArray(matchedDocIds) && matchedDocIds.length > 0) {
                const { data: docs } = await supabaseAdmin
                    .from('evidence_documents')
                    .select('id, filename, doc_type, created_at, metadata')
                    .in('id', matchedDocIds)
                    .eq('tenant_id', tenantId);
                documents = docs || [];
            }

            return res.json(buildCaseResponse(
                detectionResult,
                documents,
                await fetchEventsForRecovery(detectionResult.id, userId, tenantId),
                'detection'
            ));
        }

        // Not found
        logger.warn('Recovery not found', { id, userId });
        return res.status(404).json({ error: 'Recovery not found' });

    } catch (error: any) {
        logger.error('Error fetching recovery details', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch recovery details' });
    }
});

/**
 * POST /api/recoveries/:id/submit
 * Submit a claim for filing
 * Creates a dispute_case and updates detection_result status
 */
router.post('/:id/submit', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).userId || (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';
        const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;

        logger.info('Submitting claim', { claimId: id, userId, tenantId });

        // First, check if this is a dispute_case that already exists
        const { data: existingCase, error: caseError } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        if (existingCase && !caseError) {
            // Update existing dispute_case status to submitted
            const { error: updateError } = await supabaseAdmin
                .from('dispute_cases')
                .update({
                    status: 'Submitted',
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .eq('tenant_id', tenantId);

            if (updateError) {
                logger.error('Error updating dispute case status', { id, error: updateError.message });
                return res.status(500).json({ success: false, error: 'Failed to submit case' });
            }

            logger.info('Case submitted successfully', { id, status: 'Submitted' });
            return res.json({
                success: true,
                message: 'Case submitted successfully',
                caseId: id,
                status: 'Submitted'
            });
        }

        // Next, try to get from detection_results
        let detectionResult: any = null;
        let claimRecord: any = null;

        const { data: detResult, error: detError } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        if (detResult && !detError) {
            detectionResult = detResult;
        } else {
            // Not in detection_results, check claims table
            const { data: claimResult, error: claimError } = await supabaseAdmin
                .from('claims')
                .select('*')
                .eq('claim_id', id)
                .single();

            if (claimResult && !claimError) {
                claimRecord = claimResult;
            } else {
                // Also try by id column
                const { data: claimById } = await supabaseAdmin
                    .from('claims')
                    .select('*')
                    .eq('id', id)
                    .single();

                if (claimById) {
                    claimRecord = claimById;
                }
            }
        }

        if (!detectionResult && !claimRecord) {
            logger.warn('Claim not found for submission', { id, userId });
            return res.status(404).json({ success: false, error: 'Claim not found' });
        }

        // Use detection result if available, otherwise use claim record
        const sourceRecord = detectionResult || claimRecord;
        const detectionId = detectionResult?.id || claimRecord?.reference_id || id;

        // Check if already submitted (dispute_case exists)
        const { data: alreadySubmittedCase } = await supabaseAdmin
            .from('dispute_cases')
            .select('id, status')
            .or(`detection_result_id.eq.${detectionId},claim_id.eq.${id}`)
            .single();

        if (alreadySubmittedCase) {
            logger.info('Claim already submitted', { id, existingCaseId: alreadySubmittedCase.id });
            return res.json({
                success: true,
                message: 'Claim already submitted',
                caseId: existingCase.id,
                status: existingCase.status
            });
        }

        // Create dispute_case record
        const caseNumber = `LI-${new Date().getFullYear().toString().slice(-2)}${(new Date().getMonth() + 1).toString().padStart(2, '0')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

        const disputeCase = {
            seller_id: userId,
            tenant_id: tenantId,
            detection_result_id: detectionId,
            claim_id: sourceRecord.claim_id || id,
            claim_amount: sourceRecord.estimated_value || sourceRecord.amount || 0,
            currency: sourceRecord.currency || 'USD',
            status: 'submitted',
            filing_status: 'filed',
            case_type: sourceRecord.anomaly_type || sourceRecord.claim_type || 'unknown',
            case_number: caseNumber,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: newCase, error: insertError } = await supabaseAdmin
            .from('dispute_cases')
            .insert(disputeCase)
            .select()
            .single();

        if (insertError) {
            logger.error('Failed to create dispute case', { error: insertError.message, id });
            return res.status(500).json({ success: false, error: 'Failed to submit claim' });
        }

        // Update detection_result status to 'filed'
        await supabaseAdmin
            .from('detection_results')
            .update({ status: 'filed', updated_at: new Date().toISOString() })
            .eq('id', detectionId);

        // Log submission event to timeline
        const claimAmount = sourceRecord.estimated_value || sourceRecord.amount || 0;
        await timelineService.addEvent({
            claimId: detectionId,
            action: 'auto_submitted',
            description: `Claim submitted to Amazon. Case #${caseNumber}`,
            amount: claimAmount,
            table: 'detection_results'
        });

        // Create persisted + live notification for the user
        try {
            await notificationService.createNotification({
                user_id: userId,
                tenant_id: tenantId,
                type: NotificationType.CASE_FILED,
                title: `Submitted Claim ${caseNumber}`,
                message: `Claim ${caseNumber} submitted for ${formatCurrency(detectionResult.estimated_value || 0, detectionResult.currency || 'USD')}`,
                priority: NotificationPriority.HIGH,
                channel: NotificationChannel.BOTH,
                payload: {
                    detection_id: id,
                    dispute_case_id: newCase.id,
                    case_number: caseNumber,
                    amount: detectionResult.estimated_value,
                    currency: detectionResult.currency || 'USD'
                },
                immediate: true
            });
        } catch (notifError) {
            logger.warn('Failed to create notification', { error: notifError });
        }

        logger.info('Claim submitted successfully', {
            claimId: id,
            caseId: newCase.id,
            caseNumber,
            amount: detectionResult.estimated_value
        });

        return res.json({
            success: true,
            message: 'Claim submitted successfully',
            caseId: newCase.id,
            caseNumber,
            status: 'submitted',
            amount: detectionResult.estimated_value,
            currency: detectionResult.currency || 'USD'
        });

    } catch (error: any) {
        logger.error('Error submitting claim', { error: error.message, stack: error.stack });
        return res.status(500).json({ success: false, error: 'Failed to submit claim' });
    }
});

/**
 * POST /api/recoveries/:id/resubmit
 * Resubmit a claim with additional evidence
 */
router.post('/:id/resubmit', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).userId || (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';
        const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;

        logger.info('Resubmitting claim', { claimId: id, userId, tenantId });

        // Find the existing dispute_case — scoped by tenant
        let disputeCase = null;

        // Try by ID first
        const { data: caseById } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        if (caseById) {
            disputeCase = caseById;
        } else {
            // Try by detection_result_id
            const { data: caseByDetection } = await supabaseAdmin
                .from('dispute_cases')
                .select('*')
                .eq('detection_result_id', id)
                .eq('tenant_id', tenantId)
                .single();
            disputeCase = caseByDetection;
        }

        if (!disputeCase) {
            return res.status(404).json({ success: false, error: 'Case not found' });
        }

        // Update status to resubmitted
        const { error: updateError } = await supabaseAdmin
            .from('dispute_cases')
            .update({
                status: 'submitted',
                filing_status: 'resubmitted',
                retry_count: (disputeCase.retry_count || 0) + 1,
                updated_at: new Date().toISOString()
            })
            .eq('id', disputeCase.id)
            .eq('tenant_id', tenantId);

        if (updateError) {
            logger.error('Failed to update dispute case', { error: updateError.message });
            return res.status(500).json({ success: false, error: 'Failed to resubmit claim' });
        }

        logger.info('Claim resubmitted successfully', { caseId: disputeCase.id });

        return res.json({
            success: true,
            message: 'Claim resubmitted successfully',
            caseId: disputeCase.id,
            status: 'submitted'
        });

    } catch (error: any) {
        logger.error('Error resubmitting claim', { error: error.message });
        return res.status(500).json({ success: false, error: 'Failed to resubmit claim' });
    }
});

/**
 * GET /api/recoveries/:id/events
 * Get timeline/audit trail for a specific claim/recovery
 * Returns all events related to the claim with linked documents
 */
/**
 * Internal helper to fetch and aggregate events for a recovery
 */
function buildAgent10OrFilter(prefix: string, ids: string[]): string {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    const keys = [
        'entity_id',
        'dispute_case_id',
        'disputeId',
        'dispute_id',
        'case_id',
        'caseId',
        'detection_id',
        'claim_id',
        'claimId',
        'document_id',
        'documentId',
        'recovery_id',
        'recoveryId'
    ];

    return uniqueIds
        .flatMap((value) => keys.map((key) => `${prefix}->>${key}.eq.${value}`))
        .join(',');
}

function mapAgentEventTypeToTimelineStatus(eventType: string): string {
    const value = (eventType || '').toLowerCase();
    if (value.includes('billing')) return 'billing';
    if (value.includes('recovery')) return 'recovery';
    if (value.includes('matching')) return 'matched';
    if (value.includes('ingestion')) return 'evidence';
    if (value.includes('parsing')) return 'parsing';
    if (value.includes('filing')) return 'filed';
    return value || 'recorded';
}

function eventBelongsToRecovery(
    ids: ReturnType<typeof extractAgent10EntityIds>,
    canonical: {
        disputeCaseId?: string;
        detectionId?: string;
    }
): boolean {
    if (canonical.disputeCaseId) {
        if (ids.disputeCaseId) {
            return ids.disputeCaseId === canonical.disputeCaseId;
        }
        if (ids.detectionId && canonical.detectionId) {
            return ids.detectionId === canonical.detectionId;
        }
        return false;
    }

    if (canonical.detectionId) {
        if (ids.disputeCaseId) {
            return false;
        }
        return ids.detectionId === canonical.detectionId;
    }

    return false;
}

function formatAgentEventMessage(event: any): string {
    const metadata = event.metadata || {};
    switch (event.event_type) {
        case 'matching_completed':
            return `Evidence matched with confidence ${metadata.confidence ?? 'unknown'}.`;
        case 'filing_completed':
        case 'case_approved':
            return `Claim filing status updated in Amazon.`;
        case 'recovery_detected':
        case 'recovery_reconciled':
            return `Recovery detected for ${formatCurrency(metadata.actualAmount || metadata.expectedAmount || 0, 'USD')}.`;
        case 'billing_completed':
            return `Billing recorded for ${formatCurrency(metadata.amountRecovered || 0, 'USD')}.`;
        case 'ingestion_completed':
            return `Evidence ingestion completed.`;
        default:
            return event.event_type || 'Event recorded';
    }
}

async function fetchEventsForRecovery(id: string, _userId: string, tenantId: string) {
    try {
        // First, try to find in detection_results (claims)
        const { data: directDetectionResult } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        let detectionResult: any = directDetectionResult;
        let disputeCase: any = null;

        if (detectionResult) {
            const { data: linkedCase } = await supabaseAdmin
                .from('dispute_cases')
                .select('*')
                .eq('detection_result_id', detectionResult.id)
                .eq('tenant_id', tenantId)
                .maybeSingle();
            disputeCase = linkedCase;
        } else {
            const { data: dispCase } = await supabaseAdmin
                .from('dispute_cases')
                .select('*')
                .eq('id', id)
                .eq('tenant_id', tenantId)
                .single();
            disputeCase = dispCase;

            if (disputeCase?.detection_result_id) {
                const { data: linkedDetection } = await supabaseAdmin
                    .from('detection_results')
                    .select('*')
                    .eq('id', disputeCase.detection_result_id)
                    .eq('tenant_id', tenantId)
                    .maybeSingle();
                detectionResult = linkedDetection;
            }
        }

        if (!detectionResult && !disputeCase) return [];

        const events: any[] = [];
        const canonical = {
            disputeCaseId: disputeCase?.id,
            detectionId: detectionResult?.id || disputeCase?.detection_result_id
        };
        const relatedIds = [
            id,
            detectionResult?.id,
            disputeCase?.id,
            disputeCase?.detection_result_id
        ].filter(Boolean) as string[];

        const notificationFilter = buildAgent10OrFilter('payload', relatedIds);
        const { data: notifications } = await supabaseAdmin
            .from('notifications')
            .select('*')
            .eq('tenant_id', tenantId)
            .or(notificationFilter)
            .order('created_at', { ascending: false });

        if (notifications) {
            notifications.forEach((notif: any) => {
                const ids = extractAgent10EntityIds(notif.payload || {});
                if (!eventBelongsToRecovery(ids, canonical)) {
                    return;
                }
                const docIds = [ids.documentId].filter(Boolean);
                events.push({
                    id: `notif-${notif.id}`,
                    type: 'notification',
                    status: mapNotificationTypeToStatus(notif.type),
                    at: notif.created_at,
                    claimId: ids.disputeCaseId || ids.detectionId || id,
                    message: notif.message,
                    amount: notif.payload?.amount || notif.payload?.approvedAmount || notif.payload?.claimAmount,
                    currency: notif.payload?.currency || 'USD',
                    docIds,
                    source: 'notification',
                    eventType: notif.payload?.event_type || notif.type
                });
            });
        }

        const agentEventFilter = buildAgent10OrFilter('metadata', relatedIds);
        const { data: agentEvents } = await supabaseAdmin
            .from('agent_events')
            .select('id, agent, event_type, created_at, metadata, tenant_id, user_id')
            .eq('tenant_id', tenantId)
            .or(agentEventFilter)
            .order('created_at', { ascending: false });

        if (agentEvents) {
            agentEvents.forEach((event: any) => {
                const ids = extractAgent10EntityIds(event.metadata || {});
                if (!eventBelongsToRecovery(ids, canonical)) {
                    return;
                }
                events.push({
                    id: `agent-${event.id}`,
                    type: 'agent_event',
                    status: mapAgentEventTypeToTimelineStatus(event.event_type),
                    at: event.created_at,
                    claimId: ids.disputeCaseId || ids.detectionId || id,
                    message: formatAgentEventMessage(event),
                    amount: event.metadata?.actualAmount || event.metadata?.amountRecovered || event.metadata?.expectedAmount,
                    currency: event.metadata?.currency || 'USD',
                    docIds: [ids.documentId].filter(Boolean),
                    source: 'agent_event',
                    eventType: event.event_type,
                    agentName: event.agent_name || event.agent
                });
            });
        }

        return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    } catch (e) {
        logger.error('Error fetching internal events', e);
        return [];
    }
}

/**
 * Dynamically generates a recovery strategy and protection protocol based on case data
 */
function generateCaseStrategy(record: any) {
    const caseType = (record.anomaly_type || record.claim_type || record.case_type || '').toLowerCase();
    const evidence = record.evidence || {};

    const isFee = caseType.includes('fee') || caseType.includes('overcharge') || caseType.includes('dimension');
    const isLost = caseType.includes('lost') || caseType.includes('missing') || caseType.includes('shipment');
    const isDamaged = caseType.includes('damaged') || caseType.includes('carrier');
    const isRefund = caseType.includes('refund') || caseType.includes('return');

    const playbook: any = {
        title: "Autonomous Strategy",
        council: [
            { id: 'filing', agent: 'Agent 7', status: record.status === 'filed' ? 'SETTLED' : 'ACTIVE' },
            { id: 'recovery', agent: 'Agent 8', status: 'MONITORING' },
            { id: 'ledger', agent: 'Agent 9', status: 'SYNCHRONIZING' },
            { id: 'learning', agent: 'Agent 11', status: 'OBSERVING' }
        ],
        steps: []
    };

    const protocol: string[] = [];

    if (isFee) {
        playbook.steps = [
            `Audit dimensions for ASIN ${record.asin || evidence.asin}`,
            `Normalize catalog cubic data`,
            `Apply for overcharge settlement`
        ];
        protocol.push(`Real-time dimension monitoring active`);
        protocol.push(`Auto-flagging future overcharge events`);
    } else if (isLost) {
        playbook.steps = [
            `Verify FC ${evidence.fulfillment_center || 'Warehouse'} incoming record`,
            `Confirm 'Patient Zero' via Inventory Ledger`,
            `Initiate settlement window (Est. 48h)`
        ];
        protocol.push(`FC discrepancy shielding activated`);
        protocol.push(`Inbound accuracy learning protocol enabled`);
    } else if (isDamaged) {
        playbook.steps = [
            `Extract carrier handling proof`,
            `Verify FC damage classification`,
            `Process carrier-liability reimbursement`
        ];
        protocol.push(`Carrier risk assessment updated`);
        protocol.push(`Packaging requirement optimization`);
    } else if (isRefund) {
        playbook.steps = [
            `Validate return tracking for Order ${evidence.order_id || 'ID'}`,
            `Confirm 'Switcheroo' vs Missed Return`,
            `Lodge RFS (Refund at First Scan) dispute`
        ];
        protocol.push(`Customer return abuse monitoring enabled`);
        protocol.push(`Predictive refund risk shielding active`);
    } else {
        playbook.steps = [
            `Analyze case documentation artifacts`,
            `Substantiate claim with cross-audit data`,
            `Monitor Amazon response window`
        ];
        protocol.push(`Global discrepancy monitoring active`);
        protocol.push(`Pattern-based system optimization`);
    }

    return { playbook, protection_protocol: protocol };
}

router.get('/:id/events', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        // Support multiple auth methods: req.user, X-User-Id header, or demo-user fallback
        const userId = (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';
        const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        logger.info('Fetching timeline events for recovery', { recoveryId: id, userId, tenantId });

        const events = await fetchEventsForRecovery(id, userId, tenantId);

        logger.info('Timeline events retrieved successfully', {
            recoveryId: id,
            eventCount: events.length
        });

        return res.json(events);

    } catch (error: any) {
        logger.error('Error fetching timeline events', { error: error.message, stack: error.stack });
        return res.status(500).json({ error: 'Failed to fetch timeline events' });
    }
});

/**
 * GET /api/recoveries/:id/status
 * Get current status of a recovery/claim
 */
router.get('/:id/status', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;

        const { data: disputeCase, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('status, claim_amount, currency, updated_at')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        if (!error && disputeCase) {
            return res.json({
                status: disputeCase.status,
                amount: disputeCase.claim_amount,
                currency: disputeCase.currency || 'USD',
                lastUpdated: disputeCase.updated_at
            });
        }

        const { data: detectionResult, error: detectionError } = await supabaseAdmin
            .from('detection_results')
            .select('status, estimated_value, currency, updated_at, created_at')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        if (detectionError || !detectionResult) {
            return res.status(404).json({ error: 'Recovery not found' });
        }

        return res.json({
            status: detectionResult.status || 'Open',
            amount: detectionResult.estimated_value,
            currency: detectionResult.currency || 'USD',
            lastUpdated: detectionResult.updated_at || detectionResult.created_at
        });

    } catch (error: any) {
        logger.error('Error fetching recovery status', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch recovery status' });
    }
});

// Helper functions
function mapNotificationTypeToStatus(type: string): string {
    const typeToStatus: Record<string, string> = {
        'case_filed': 'filed',
        'claim_detected': 'detected',
        'refund_approved': 'approved',
        'funds_deposited': 'deposited',
        'evidence_found': 'verified',
        'payment_processed': 'paid',
        'integration_completed': 'synced',
        'discrepancy_found': 'flagged'
    };
    return typeToStatus[type] || 'pending';
}

function getStatusMessage(status: string, amount?: number): string {
    const currency = 'USD'; // Default currency
    const formattedAmount = amount ? formatCurrency(amount, currency) : '';

    const messages: Record<string, string> = {
        'pending': `Claim pending review ${formattedAmount ? `for ${formattedAmount}` : ''}`,
        'filed': `Claim filed ${formattedAmount ? `for ${formattedAmount}` : ''}`,
        'in_progress': `Claim in progress ${formattedAmount ? `for ${formattedAmount}` : ''}`,
        'approved': `Claim approved ${formattedAmount ? `- ${formattedAmount}` : ''}`,
        'paid': `Payment received ${formattedAmount ? `- ${formattedAmount}` : ''}`,
        'rejected': 'Claim rejected',
        'disputed': 'Claim under dispute',
        'closed': 'Claim closed'
    };

    return messages[status] || `Status: ${status}`;
}

function formatCurrency(amount: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount);
}

/**
 * GET /api/recoveries/:id/packet
 * Download a composite PDF evidence packet for a claim
 * Bundles: cover sheet + invoice (highlighted line items) + supporting docs
 */
router.get('/:id/packet', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).userId || (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';

        logger.info('Generating composite PDF packet', { claimId: id, userId });

        const { buffer, filename } = await compositePdfService.generateClaimPacket(id, userId);

        // Set headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);

        logger.info('Composite PDF generated and sent', { claimId: id, filename, sizeBytes: buffer.length });

        return res.send(buffer);

    } catch (error: any) {
        logger.error('Error generating composite PDF', { error: error.message });

        // Check for specific error types
        if (error.message?.includes('not found')) {
            return res.status(404).json({ error: 'Claim not found' });
        }
        if (error.message?.includes('Chrome') || error.message?.includes('Puppeteer')) {
            return res.status(503).json({
                error: 'PDF generation temporarily unavailable',
                message: 'The PDF generation service is not available. Please try again later.'
            });
        }

        return res.status(500).json({ error: 'Failed to generate PDF packet' });
    }
});

export default router;
