import { Router } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import { invoicePdfService } from '../services/invoicePdfService';

const router = Router();

// Get raw billing transactions
router.get('/transactions', async (req, res) => {
    try {
        const userId = req.query.userId as string || (req as any).userId;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'User ID required' });
        }

        const { data, error, count } = await supabaseAdmin
            .from('billing_transactions')
            .select('*', { count: 'exact' })
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const transactions = data.map(tx => ({
            id: tx.id,
            recovery_id: tx.recovery_id,
            amount: (tx.amount_recovered_cents || 0) / 100,
            platform_fee: (tx.platform_fee_cents || 0) / 100,
            seller_payout: (tx.seller_payout_cents || 0) / 100,
            status: tx.billing_status,
            created_at: tx.created_at
        }));

        res.json({
            success: true,
            transactions,
            total: count
        });
    } catch (error: any) {
        logger.error('Failed to fetch billing transactions', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get billing transactions (invoices)
router.get('/invoices', async (req, res) => {
    try {
        const userId = req.query.userId as string || (req as any).userId;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'User ID required' });
        }

        const { data, error, count } = await supabaseAdmin
            .from('billing_transactions')
            .select('*', { count: 'exact' })
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Map transactions to "invoices" format expected by frontend
        const invoices = data.map(tx => ({
            id: tx.id,
            invoice_id: tx.id, // Use transaction ID as invoice ID
            period_start: tx.created_at,
            period_end: tx.created_at, // Instant transaction
            total_amount: (tx.amount_recovered_cents || 0) / 100,
            platform_fee: (tx.platform_fee_cents || 0) / 100,
            commission: (tx.platform_fee_cents || 0) / 100,
            amount_charged: (tx.platform_fee_cents || 0) / 100,
            status: tx.billing_status === 'charged' ? 'Paid' : tx.billing_status,
            created_at: tx.created_at,
            recovery_claim_ids: [tx.recovery_id]
        }));

        res.json({
            success: true,
            invoices,
            total: count
        });
    } catch (error: any) {
        logger.error('Failed to fetch billing invoices', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get billing status summary
router.get('/status', async (req, res) => {
    try {
        const userId = req.query.userId as string || (req as any).userId;
        if (!userId) {
            return res.status(400).json({ success: false, error: 'User ID required' });
        }

        // Calculate totals
        const { data, error } = await supabaseAdmin
            .from('billing_transactions')
            .select('amount_recovered_cents, platform_fee_cents, billing_status')
            .eq('user_id', userId);

        if (error) throw error;

        const totalRecovered = data.reduce((sum, tx) => sum + (tx.amount_recovered_cents || 0), 0) / 100;
        const totalFees = data.reduce((sum, tx) => sum + (tx.platform_fee_cents || 0), 0) / 100;
        const pendingBilling = data
            .filter(tx => tx.billing_status === 'pending')
            .reduce((sum, tx) => sum + (tx.platform_fee_cents || 0), 0) / 100;

        res.json({
            success: true,
            status: {
                total_recovered: totalRecovered,
                total_fees: totalFees,
                pending_billing: pendingBilling
            }
        });

    } catch (error: any) {
        logger.error('Failed to fetch billing status', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Download invoice as PDF
router.get('/invoices/:invoiceId/pdf', async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const userId = req.query.userId as string || (req as any).userId;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'User ID required' });
        }

        if (!invoiceId) {
            return res.status(400).json({ success: false, error: 'Invoice ID required' });
        }

        logger.info('[BILLING] Generating PDF invoice', { invoiceId, userId });

        const pdfBuffer = await invoicePdfService.generateInvoicePdf(invoiceId, userId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);

    } catch (error: any) {
        logger.error('Failed to generate invoice PDF', { error: error.message, invoiceId: req.params.invoiceId });
        res.status(500).json({ success: false, error: 'Failed to generate invoice PDF' });
    }
});

export default router;
