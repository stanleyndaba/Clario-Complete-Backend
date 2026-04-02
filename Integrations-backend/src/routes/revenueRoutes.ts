/**
 * Revenue Routes
 * 
 * Legacy revenue routes retained for historical reimbursement data only.
 *  - Scan Gmail for reimbursement emails
 *  - View / confirm / dispute reimbursement matches
 *  - View historical legacy commission invoices
 *  - Payment method CRUD (card on file)
 *  - Legacy revenue dashboard metrics
 */

import { Router, Request, Response } from 'express';
import { reimbursementMatcherService } from '../services/reimbursementMatcherService';
import { commissionInvoiceService } from '../services/commissionInvoiceService';
import * as paymentController from '../controllers/paymentController';
import logger from '../utils/logger';

const router = Router();

// Helper to get seller ID from request
const getSellerId = (req: Request): string => {
    return (
        (req.headers['x-user-id'] as string) ||
        (req as any).userId ||
        'demo-user'
    );
};

// ════════════════════════════════════════════════════════════════════
// REIMBURSEMENT MATCHING
// ════════════════════════════════════════════════════════════════════

/**
 * POST /api/revenue/scan-reimbursements
 * Trigger a Gmail scan for Amazon reimbursement notification emails.
 */
router.post('/scan-reimbursements', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const { maxResults, afterDate } = req.body;

        const result = await reimbursementMatcherService.scanGmailForReimbursements(sellerId, {
            maxResults: maxResults || 100,
            afterDate
        });

        res.json({
            success: result.success,
            data: result
        });
    } catch (error: any) {
        logger.error('[REVENUE ROUTE] scan-reimbursements error', { error: error?.message });
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * GET /api/revenue/reimbursement-matches
 * List reimbursement matches for the seller.
 */
router.get('/reimbursement-matches', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const status = req.query.status as string | undefined;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const result = await reimbursementMatcherService.getMatchesForSeller(sellerId, {
            status,
            limit,
            offset
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * PATCH /api/revenue/reimbursement-matches/:id
 * Confirm or dispute a reimbursement match.
 * Body: { action: 'confirm' | 'dispute', reason?: string }
 */
router.patch('/reimbursement-matches/:id', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const matchId = req.params.id;
        const { action, reason } = req.body;

        if (!['confirm', 'dispute'].includes(action)) {
            return res.status(400).json({ success: false, error: 'action must be "confirm" or "dispute"' });
        }

        const { supabase } = await import('../database/supabaseClient');

        const newStatus = action === 'confirm' ? 'confirmed' : 'disputed';

        const { error } = await supabase
            .from('reimbursement_matches')
            .update({
                status: newStatus,
                source_metadata: supabase.rpc ? undefined : undefined // keep existing
            })
            .eq('id', matchId)
            .eq('seller_id', sellerId);

        if (error) {
            return res.status(500).json({ success: false, error: error.message });
        }

        res.json({ success: true, status: newStatus });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * POST /api/revenue/reimbursement-matches/manual
 * Manually add a reimbursement match (not from Gmail scan).
 */
router.post('/reimbursement-matches/manual', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const { amount, currency, reimbursementDate, caseId, orderId, asin, notes } = req.body;

        if (!amount || !reimbursementDate) {
            return res.status(400).json({ success: false, error: 'amount and reimbursementDate are required' });
        }

        const matchId = await reimbursementMatcherService.createManualMatch(sellerId, {
            amount: Number(amount),
            currency,
            reimbursementDate,
            caseId,
            orderId,
            asin,
            notes
        });

        res.json({ success: !!matchId, data: { id: matchId } });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

// ════════════════════════════════════════════════════════════════════
// INVOICES
// ════════════════════════════════════════════════════════════════════

/**
 * POST /api/revenue/invoices/generate
 * Generate a commission invoice for a billing period.
 * Body: { periodStart, periodEnd, commissionRate? }
 */
router.post('/invoices/generate', async (req: Request, res: Response) => {
    res.status(410).json({
        success: false,
        error: 'Legacy commission invoice generation is disabled. Margin now uses flat subscription billing only.'
    });
});

/**
 * GET /api/revenue/invoices
 */
router.get('/invoices', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const status = req.query.status as string | undefined;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const result = await commissionInvoiceService.getInvoicesForSeller(sellerId, { status, limit, offset });
        res.json({
            success: true,
            data: result,
            legacy: true,
            billing_model: 'flat_subscription',
            note: 'These invoices are historical legacy recovery-fee records only.'
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * GET /api/revenue/invoices/:id
 */
router.get('/invoices/:id', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const invoice = await commissionInvoiceService.getInvoiceDetail(req.params.id, sellerId);

        if (!invoice) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }

        res.json({
            success: true,
            data: invoice,
            legacy: true,
            billing_model: 'flat_subscription',
            note: 'This invoice is a historical legacy recovery-fee record.'
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * POST /api/revenue/invoices/:id/finalize
 */
router.post('/invoices/:id/finalize', async (req: Request, res: Response) => {
    res.status(410).json({
        success: false,
        error: 'Legacy commission invoice finalization is disabled. Margin now uses flat subscription billing only.'
    });
});

/**
 * POST /api/revenue/invoices/:id/dispute
 * Body: { reimbursementMatchId, reason }
 */
router.post('/invoices/:id/dispute', async (req: Request, res: Response) => {
    res.status(410).json({
        success: false,
        error: 'Legacy commission invoice disputes are disabled. Margin now uses flat subscription billing only.'
    });
});


// ════════════════════════════════════════════════════════════════════
// METRICS
// ════════════════════════════════════════════════════════════════════

/**
 * GET /api/revenue/metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
    res.json({
        success: true,
        data: null,
        legacy: true,
        billing_model: 'flat_subscription',
        note: 'Legacy commission metrics are no longer active billing truth under the subscription model.'
    });
});

// ════════════════════════════════════════════════════════════════════
// PAYPAL VAULTING (AUTO-CHARGE)
// ════════════════════════════════════════════════════════════════════

/**
 * POST /api/revenue/vault/setup
 * Get a setup token for PayPal Vaulting
 */
router.post('/vault/setup', paymentController.getVaultSetupToken);

/**
 * POST /api/revenue/vault/finalize
 * Exchange setup token for payment token and save to user
 */
router.post('/vault/finalize', paymentController.finalizeVaulting);

export default router;
