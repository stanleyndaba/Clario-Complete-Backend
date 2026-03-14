import { Request, Response } from 'express';
import paypalService from '../services/paypalService';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

/**
 * AGENT 7: Payment & Lifecycle Controller
 * Manages the transition from unpaid "Radar" state to paid "Execution" state.
 */
export const handlePaypalWebhook = async (req: Request, res: Response) => {
  const body = req.body;
  const headers = req.headers;
  const eventType = body.event_type;

  logger.info(`🔔 [PAYPAL WEBHOOK] Received event: ${eventType}`);

  // 1. SIGNATURE VERIFICATION (GUARD MODE)
  // Ensures the request actually came from PayPal and wasn't spoofed.
  const isVerified = await paypalService.verifyWebhookSignature(headers, body);
  
  if (!isVerified) {
    logger.error('🚨 [SECURITY] PayPal Webhook Signature verification failed! Potential spoofing attempt.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. EVENT FILTER: Only process APPROVED or COMPLETED checkout orders
  // Using both common event types for maximum reliability.
  const authorizedEvents = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.SALE.COMPLETED'];
  if (!authorizedEvents.includes(eventType)) {
    return res.status(200).send('Event Ignored');
  }

  try {
    // 3. ZERO-TRUST VALIDATION (THE PENNY PURGE)
    // Extract transaction details based on specific event resource structure
    const resource = body.resource;
    let amount: string | undefined;
    let currency: string | undefined;
    let customId: string | undefined;

    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      // CHECKOUT.ORDER.APPROVED structure
      amount = resource?.purchase_units?.[0]?.amount?.value;
      currency = resource?.purchase_units?.[0]?.amount?.currency_code;
      customId = resource?.purchase_units?.[0]?.custom_id;
    } else {
      // PAYMENT.SALE.COMPLETED structure
      amount = resource?.amount?.total;
      currency = resource?.amount?.currency;
      customId = resource?.custom_id;
    }

    if (amount !== '99.00' || currency !== 'USD') {
      logger.error('🚨 [SECURITY] PENNY HACKER DETECTED! Illegal amount/currency.', {
        amount,
        currency,
        customId
      });
      // Return 200 to stop PayPal retries, but do NOT process.
      return res.status(200).send('Fraud Attempt Logged');
    }

    // 4. IDENTITY RESOLUTION
    if (!customId || customId === 'anonymous') {
      logger.error('❌ [IDENTITY] Missing or anonymous custom_id in PayPal payload.', {
        customId
      });
      return res.status(200).send('Identity Resolution Failed');
    }

    logger.info(`⛓️ [FORTRESS] Verified payment for User: ${customId}. Initiating Paywall Lift.`);

    // 5. ATOMIC STATE TRANSITION
    // Update the profile/user table to grant "Agent 7" filing powers.
    const { error } = await supabaseAdmin
      .from('users')
      .update({ 
        is_paid_beta: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', customId);

    if (error) {
      logger.error(`❌ [DATABASE] Failed to lift paywall for ${customId}`, { error: error.message });
      // Return 500 so PayPal retries this specific critical update.
      return res.status(500).send('Update Failed');
    }

    logger.info(`✅ [FORTRESS] Agent 7 officially UNLOCKED for User: ${customId}.`);
    res.status(200).send('Verified & Unlocked');

  } catch (err: any) {
    logger.error(`❌ [WEBHOOK ERROR] Fatal processing error: ${err.message}`);
    res.status(500).send('Internal Processing error');
  }
};
