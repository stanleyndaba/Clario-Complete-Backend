import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const router = Router();

/**
 * AGENT 7: Zero-Trust PayPal Webhook Handler
 * Implements the "Penny Purge" and "Identity Relay" protocols.
 */
router.post('/paypal', async (req: Request, res: Response) => {
    const body = req.body;
    const { event_type, resource } = body;

    logger.info(`🔔 [PAYPAL WEBHOOK] Received event: ${event_type}`);

    // 1. EVENT FILTER: Only process completed sales
    if (event_type !== 'PAYMENT.SALE.COMPLETED') {
        return res.status(200).send('Event Ignored');
    }

    try {
        // 2. THE PENNY PURGE: Cryptographic Receipt Validation
        // Prevents bad actors from using 1-cent transactions to unlock the beta.
        const amount = resource?.amount?.total;
        const currency = resource?.amount?.currency;

        if (amount !== '99.00' || currency !== 'USD') {
            logger.error(`🚨 [SECURITY] PENNY HACKER DETECTED! Illegal amount/currency.`, {
                amount,
                currency,
                custom_id: resource?.custom_id
            });
            
            // We return 200 so PayPal stops retrying, but we do NOT unlock anything.
            return res.status(200).send('Fraud Attempt Logged');
        }

        // 3. THE IDENTITY RELAY: Extract internal User ID
        const userId = resource?.custom_id;
        if (!userId) {
            logger.error(`❌ [IDENTITY] Missing custom_id in PayPal webhook. Cannot map to user.`);
            return res.status(200).send('Missing ID');
        }

        logger.info(`⛓️ [FORTRESS] Verified payment for User: ${userId}. Unlocking Agent 7.`);

        // 4. THE PAYWALL LIFT: Atomic User State Transition
        const { error } = await supabaseAdmin
            .from('users')
            .update({ 
                is_paid_beta: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) {
            logger.error(`❌ [DATABASE] Failed to unlock user status for ${userId}`, { error: error.message });
            return res.status(500).send('Update Failed');
        }

        logger.info(`✅ [FORTRESS] User ${userId} successfully unlocked for Paid Beta.`);
        res.status(200).send('Verified');

    } catch (err: any) {
        logger.error(`❌ [WEBHOOK ERROR] Fatal processing error: ${err.message}`);
        res.status(500).send('Internal Error');
    }
});

export default router;
