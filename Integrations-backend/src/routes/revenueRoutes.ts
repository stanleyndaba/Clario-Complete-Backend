/**
 * Revenue Routes
 * 
 * API endpoints for the reimbursement-based revenue system:
 *  - Scan Gmail for reimbursement emails
 *  - View / confirm / dispute reimbursement matches
 *  - Generate and manage commission invoices
 *  - Payment method CRUD (card on file)
 *  - Revenue dashboard metrics
 */

import { Router, Request, Response } from 'express';
import { reimbursementMatcherService } from '../services/reimbursementMatcherService';
import { commissionInvoiceService } from '../services/commissionInvoiceService';
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
    try {
        const sellerId = getSellerId(req);
        const { periodStart, periodEnd, commissionRate } = req.body;

        if (!periodStart || !periodEnd) {
            return res.status(400).json({ success: false, error: 'periodStart and periodEnd are required' });
        }

        const result = await commissionInvoiceService.generateInvoice(
            sellerId,
            periodStart,
            periodEnd,
            { commissionRate }
        );

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
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
        res.json({ success: true, data: result });
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

        res.json({ success: true, data: invoice });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * POST /api/revenue/invoices/:id/finalize
 */
router.post('/invoices/:id/finalize', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const result = await commissionInvoiceService.finalizeInvoice(req.params.id, sellerId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * POST /api/revenue/invoices/:id/dispute
 * Body: { reimbursementMatchId, reason }
 */
router.post('/invoices/:id/dispute', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const { reimbursementMatchId, reason } = req.body;

        if (!reimbursementMatchId || !reason) {
            return res.status(400).json({ success: false, error: 'reimbursementMatchId and reason are required' });
        }

        const result = await commissionInvoiceService.disputeLineItem(
            req.params.id,
            reimbursementMatchId,
            sellerId,
            reason
        );

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

// ════════════════════════════════════════════════════════════════════
// PAYMENT METHODS
// ════════════════════════════════════════════════════════════════════

/**
 * GET /api/revenue/payment-methods
 */
router.get('/payment-methods', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const methods = await commissionInvoiceService.getPaymentMethods(sellerId);
        res.json({ success: true, data: methods });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * POST /api/revenue/payment-methods
 * Body: { cardBrand, cardLastFour, cardExpMonth, cardExpYear, cardholderName?, billingEmail?, setDefault? }
 */
router.post('/payment-methods', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const { cardBrand, cardLastFour, cardExpMonth, cardExpYear, cardholderName, billingEmail, setDefault } = req.body;

        if (!cardBrand || !cardLastFour || !cardExpMonth || !cardExpYear) {
            return res.status(400).json({
                success: false,
                error: 'cardBrand, cardLastFour, cardExpMonth, and cardExpYear are required'
            });
        }

        const result = await commissionInvoiceService.addPaymentMethod(sellerId, {
            cardBrand,
            cardLastFour,
            cardExpMonth: Number(cardExpMonth),
            cardExpYear: Number(cardExpYear),
            cardholderName,
            billingEmail,
            setDefault
        });

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * DELETE /api/revenue/payment-methods/:id
 */
router.delete('/payment-methods/:id', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const result = await commissionInvoiceService.removePaymentMethod(req.params.id, sellerId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

/**
 * PATCH /api/revenue/payment-methods/:id/default
 */
router.patch('/payment-methods/:id/default', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const result = await commissionInvoiceService.setDefaultPaymentMethod(req.params.id, sellerId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

// ════════════════════════════════════════════════════════════════════
// METRICS
// ════════════════════════════════════════════════════════════════════

/**
 * GET /api/revenue/metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
    try {
        const sellerId = getSellerId(req);
        const metrics = await commissionInvoiceService.getRevenueMetrics(sellerId);
        res.json({ success: true, data: metrics });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message });
    }
});

export default router;
