import { Router } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import { format } from 'date-fns';

const router = Router();

// POST /api/export-claims
router.post('/', async (req, res) => {
    try {
        const tenantId = req.headers['x-tenant-id'] as string;
        // In this implementation, the backend gets the tenantId and sellerId.
        // If the frontend does not send sellerId but the backend has tenant context, we need to extract it.
        // For simplicity we extract sellerId from the body as requested by the user.
        let { sellerId } = req.body || {};

        if (!tenantId && !sellerId) {
            return res.status(400).json({ success: false, error: 'Tenant context or sellerId is required' });
        }

        logger.info(`[EXPORT] Initiating batch claim export for tenant: ${tenantId || 'unknown'}, seller: ${sellerId || 'all'}`);

        // Query Supabase for pending claims
        let query = supabaseAdmin
            .from('detection_results')
            .select('*')
            .in('status', ['pending', 'found', 'unsubmitted'])
            .order('discovery_date', { ascending: false });

        if (tenantId) {
            query = query.eq('tenant_id', tenantId);
        }
        if (sellerId) {
            query = query.eq('seller_id', sellerId);
        }

        const { data: claims, error } = await query;

        if (error) {
            logger.error('[EXPORT] Error fetching claims from Supabase:', error);
            return res.status(500).json({ success: false, error: 'Database query failed' });
        }

        if (!claims || claims.length === 0) {
            logger.info(`[EXPORT] No pending claims found for seller: ${sellerId}`);
            // Return an empty CSV with just headers instead of 404
            const headersLine = 'Amazon Order ID,FNSKU,Discrepancy Type,Estimated Owed (USD),Date of Event\n';
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="Margin_Claim_Batch_${sellerId}_${format(new Date(), 'yyyy-MM-dd')}.csv"`);
            return res.send(headersLine);
        }

        // Amazon-compatible strict headers
        const headers = ['Amazon Order ID', 'FNSKU', 'Discrepancy Type', 'Estimated Owed (USD)', 'Date of Event'];

        const sanitizeValue = (val: any) => {
            if (val === null || val === undefined) return '';
            const str = String(val).replace(/"/g, '""');
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                return `"${str}"`;
            }
            return str;
        };

        const rows = claims.map((claim: any) => {
            const evidence = claim.evidence || {};
            const orderId = evidence.order_id || claim.sync_id || '';
            const fnsku = evidence.fnsku || claim.sku || '';
            const discrepancyType = (claim.anomaly_type || '').replace(/_/g, ' ').toUpperCase();

            // Format currency without the $ sign for Amazon CSV standard, just raw numbers or formatted properly
            const estOwed = typeof claim.estimated_value === 'number'
                ? claim.estimated_value.toFixed(2)
                : '';

            // Format date YYYY-MM-DD
            const eventDateStr = claim.discovery_date || claim.created_at;
            const eventDate = eventDateStr ? format(new Date(eventDateStr), 'yyyy-MM-dd') : '';

            return [
                sanitizeValue(orderId),
                sanitizeValue(fnsku),
                sanitizeValue(discrepancyType),
                sanitizeValue(estOwed),
                sanitizeValue(eventDate)
            ].join(',');
        });

        const csvContent = [headers.join(','), ...rows].join('\n');

        const filename = `Margin_Claim_Batch_${sellerId}_${format(new Date(), 'yyyy-MM-dd')}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        logger.info(`[EXPORT] Successfully generated CSV with ${claims.length} claims for seller: ${sellerId}`);
        res.send(csvContent);

    } catch (err: any) {
        logger.error(`[EXPORT] Internal server error: ${err.message}`, err);
        res.status(500).json({ success: false, error: 'Internal server error during export' });
    }
});

export default router;
