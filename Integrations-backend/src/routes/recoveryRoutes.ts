import { Router, Request, Response } from 'express';
import { getLogger } from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';

const router = Router();
const logger = getLogger('RecoveryRoutes');

/**
 * GET /api/recoveries/:id
 * Get full details of a recovery/claim
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';

        logger.info('Fetching recovery details', { recoveryId: id, userId });

        // Try dispute_cases first (filed claims)
        let { data: disputeCase, error: caseError } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('id', id)
            .single();

        if (!disputeCase) {
            // Try by detection_result_id
            const { data: caseByDetection } = await supabaseAdmin
                .from('dispute_cases')
                .select('*')
                .eq('detection_result_id', id)
                .single();
            disputeCase = caseByDetection;
        }

        // If found in dispute_cases, return it
        if (disputeCase) {
            return res.json({
                id: disputeCase.id,
                title: disputeCase.case_type || 'Claim Details',
                status: disputeCase.status,
                guaranteedAmount: disputeCase.claim_amount || 0,
                expectedPayoutDate: disputeCase.expected_payout_date,
                createdDate: disputeCase.created_at,
                sku: disputeCase.sku || 'N/A',
                productName: disputeCase.case_type || 'Unknown Product',
                amazonCaseId: disputeCase.provider_case_id || disputeCase.amazon_case_id,
                currency: disputeCase.currency || 'USD',
                filing_status: disputeCase.filing_status,
                case_number: disputeCase.case_number,
            });
        }

        // Try detection_results (unfiled claims)
        const { data: detectionResult, error: detError } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('id', id)
            .single();

        if (detectionResult) {
            return res.json({
                id: detectionResult.id,
                title: detectionResult.anomaly_type || 'Claim Details',
                status: detectionResult.status || 'Open',
                guaranteedAmount: detectionResult.estimated_value || 0,
                expectedPayoutDate: null,
                createdDate: detectionResult.created_at || detectionResult.discovery_date,
                sku: detectionResult.sku || detectionResult.evidence?.sku || 'N/A',
                asin: detectionResult.asin || detectionResult.evidence?.asin,
                productName: detectionResult.anomaly_type || 'Unknown Product',
                currency: detectionResult.currency || 'USD',
                confidence_score: detectionResult.confidence_score,
            });
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
 * GET /api/recoveries/:id/events
 * Get timeline/audit trail for a specific claim/recovery
 * Returns all events related to the claim with linked documents
 */
router.get('/:id/events', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        // Support multiple auth methods: req.user, X-User-Id header, or demo-user fallback
        const userId = (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        logger.info('Fetching timeline events for recovery', { recoveryId: id, userId });

        // First, try to find in detection_results (claims)
        const { data: detectionResult, error: detError } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('id', id)
            .single();

        // If not found in detection_results, try dispute_cases
        let disputeCase: any = null;
        if (!detectionResult) {
            const { data: dispCase, error: caseError } = await supabaseAdmin
                .from('dispute_cases')
                .select('*')
                .eq('id', id)
                .single();
            disputeCase = dispCase;
        }

        // If neither found, return 404
        if (!detectionResult && !disputeCase) {
            logger.warn('Recovery not found in either table', { id, userId });
            return res.status(404).json({ error: 'Recovery not found' });
        }

        // Build timeline events from multiple sources
        const events: any[] = [];

        // 1. Get notifications related to this claim
        const { data: notifications } = await supabaseAdmin
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .or(`payload->>claim_id.eq.${id},payload->>case_id.eq.${id},payload->>dispute_id.eq.${id}`)
            .order('created_at', { ascending: false });

        if (notifications) {
            notifications.forEach((notif: any) => {
                events.push({
                    id: `notif-${notif.id}`,
                    type: notif.type,
                    status: mapNotificationTypeToStatus(notif.type),
                    at: notif.created_at,
                    claimId: id,
                    message: notif.message,
                    amount: notif.payload?.amount,
                    currency: notif.payload?.currency || 'USD',
                    docIds: notif.payload?.document_ids || []
                });
            });
        }

        // 2. Create events based on source (detection_results or dispute_cases)
        if (detectionResult) {
            // This is a detection result (claim not yet filed)
            events.push({
                id: `detection-${detectionResult.id}`,
                type: 'claim',
                status: detectionResult.status || 'detected',
                at: detectionResult.updated_at || detectionResult.created_at,
                claimId: id,
                message: getStatusMessage(detectionResult.status || 'detected', detectionResult.estimated_value),
                amount: detectionResult.estimated_value,
                currency: detectionResult.currency || 'USD',
                docIds: []
            });

            // Event for initial detection
            events.push({
                id: `detected-${detectionResult.id}`,
                type: 'claim',
                status: 'detected',
                at: detectionResult.created_at || detectionResult.discovery_date,
                claimId: id,
                message: `Claim detected: ${detectionResult.anomaly_type || 'Unknown type'} - ${formatCurrency(detectionResult.estimated_value || 0, detectionResult.currency || 'USD')}`,
                amount: detectionResult.estimated_value,
                currency: detectionResult.currency || 'USD',
                docIds: []
            });
        } else if (disputeCase) {
            // This is a dispute case (filed claim)
            if (disputeCase.status) {
                events.push({
                    id: `case-status-${disputeCase.id}`,
                    type: 'claim',
                    status: disputeCase.status,
                    at: disputeCase.updated_at || disputeCase.created_at,
                    claimId: id,
                    message: getStatusMessage(disputeCase.status, disputeCase.claim_amount),
                    amount: disputeCase.claim_amount,
                    currency: disputeCase.currency || 'USD',
                    docIds: []
                });
            }

            // Event for case creation
            events.push({
                id: `case-created-${disputeCase.id}`,
                type: 'claim',
                status: 'filed',
                at: disputeCase.created_at,
                claimId: id,
                message: `Claim filed for ${formatCurrency(disputeCase.claim_amount, disputeCase.currency)}`,
                amount: disputeCase.claim_amount,
                currency: disputeCase.currency || 'USD',
                docIds: []
            });
        }

        // 4. Get evidence/documents linked to this case
        const { data: evidence } = await supabaseAdmin
            .from('documents')
            .select('id, created_at, source, metadata')
            .eq('user_id', userId)
            .or(`metadata->>claim_id.eq.${id},metadata->>case_id.eq.${id},metadata->>dispute_id.eq.${id}`)
            .order('created_at', { ascending: false });

        if (evidence) {
            evidence.forEach((doc: any) => {
                events.push({
                    id: `evidence-${doc.id}`,
                    type: 'evidence',
                    status: 'uploaded',
                    at: doc.created_at,
                    claimId: id,
                    message: `Evidence uploaded from ${doc.source || 'unknown source'}`,
                    docIds: [doc.id]
                });
            });
        }

        // 5. Add refund/payment events if applicable
        if (disputeCase.status === 'approved' || disputeCase.status === 'paid') {
            events.push({
                id: `refund-approved-${disputeCase.id}`,
                type: 'refund',
                status: 'approved',
                at: disputeCase.updated_at || disputeCase.created_at,
                claimId: id,
                message: `Refund approved: ${formatCurrency(disputeCase.claim_amount, disputeCase.currency)}`,
                amount: disputeCase.claim_amount,
                currency: disputeCase.currency || 'USD',
                docIds: []
            });
        }

        if (disputeCase.status === 'paid') {
            const paidDate = disputeCase.paid_at || disputeCase.updated_at;
            events.push({
                id: `funds-deposited-${disputeCase.id}`,
                type: 'refund',
                status: 'deposited',
                at: paidDate,
                claimId: id,
                message: `Funds deposited: ${formatCurrency(disputeCase.claim_amount, disputeCase.currency)}`,
                amount: disputeCase.claim_amount,
                currency: disputeCase.currency || 'USD',
                docIds: []
            });
        }

        // Sort events by timestamp (most recent first)
        events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

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
        // Support multiple auth methods: req.user, X-User-Id header, or demo-user fallback
        const userId = (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { data: disputeCase, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('status, claim_amount, currency, updated_at')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (error || !disputeCase) {
            return res.status(404).json({ error: 'Recovery not found' });
        }

        return res.json({
            status: disputeCase.status,
            amount: disputeCase.claim_amount,
            currency: disputeCase.currency || 'USD',
            lastUpdated: disputeCase.updated_at
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

export default router;
