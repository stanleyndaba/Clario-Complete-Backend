import { Router, Request, Response } from 'express';
import { getLogger } from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';

const router = Router();
const logger = getLogger('RecoveryRoutes');

/**
 * GET /api/recoveries/:id/events
 * Get timeline/audit trail for a specific claim/recovery
 * Returns all events related to the claim with linked documents
 */
router.get('/:id/events', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        logger.info('Fetching timeline events for recovery', { recoveryId: id, userId });

        // Get the dispute case to verify ownership
        const { data: disputeCase, error: caseError } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (caseError || !disputeCase) {
            logger.warn('Dispute case not found or unauthorized', { id, userId, error: caseError });
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

        // 2. Create events from dispute case status changes
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

        // 3. Create event for case creation
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
        const userId = (req as any).user?.id;

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
