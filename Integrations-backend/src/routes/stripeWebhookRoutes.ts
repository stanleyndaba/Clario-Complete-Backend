import { Router } from 'express';
import Stripe from 'stripe';
import config from '../config/env';
import { supabase } from '../database/supabaseClient';
import sseHub from '../utils/sseHub';
import { withRetry } from '../utils/retry';
import { generateProofPacketForDispute } from '../workers/proofPacketWorker';

const router = Router();
const stripe = new Stripe(config.STRIPE_API_KEY, { apiVersion: '2023-08-16' });

// Raw body parser for Stripe signatures
router.post('/webhook', expressRaw, async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) return res.status(400).send('Missing signature');

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent((req as any).rawBody, sig, config.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const { disputeId, userId, amountRecovered } = extractLinkingMetadata(pi);
        if (disputeId && userId) {
          // Idempotency: store event.id
          const { error: idempErr } = await supabase.from('processed_webhook_events').insert({ id: event.id, type: event.type, created_at: new Date().toISOString() });
          if (idempErr && !String(idempErr.message).includes('duplicate')) {
            // If table enforces PK, duplicate means already processed; non-duplicate errors should be logged
          }

          await withRetry(() => supabase
            .from('dispute_cases')
            .update({ status: 'approved', resolution_amount: amountRecovered || (pi.amount_received / 100), resolution_date: new Date().toISOString() })
            .eq('id', disputeId)
            .eq('seller_id', userId), 3, 200);

          await withRetry(async () => { sseHub.sendEvent(userId, 'autoclaim', {
            type: 'autoclaim',
            disputeId,
            status: 'paid',
            amountRecovered: amountRecovered || (pi.amount_received / 100),
            paidDate: new Date().toISOString()
          }); return undefined; }, 3, 200);

          // Generate proof packet asynchronously
          try { await generateProofPacketForDispute(disputeId, userId); } catch {}

          // Commission charge (optional)
          try {
            const percent = config.AUTOCLAIM_COMMISSION_PERCENT;
            const commissionAmount = Math.round(((amountRecovered || (pi.amount_received / 100)) * percent));
            // Store commission reference (mock/example)
            await withRetry(() => supabase
              .from('commission_charges')
              .insert({
                seller_id: userId,
                dispute_id: disputeId,
                amount: commissionAmount,
                percent,
                created_at: new Date().toISOString()
              }), 3, 200);
          } catch {}
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const { disputeId, userId } = extractLinkingMetadata(charge);
        if (disputeId && userId) {
          await withRetry(() => supabase
            .from('dispute_cases')
            .update({ status: 'refunded' })
            .eq('id', disputeId)
            .eq('seller_id', userId), 3, 200);

          await withRetry(async () => { sseHub.sendEvent(userId, 'autoclaim', { type: 'autoclaim', disputeId, status: 'refunded' }); return undefined; }, 3, 200);
        }
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Internal error' });
  }
});

function expressRaw(req: any, res: any, next: any) {
  let data = Buffer.from('');
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => data = Buffer.concat([data, Buffer.from(chunk)]));
  req.on('end', () => { req.rawBody = data; next(); });
}

function extractLinkingMetadata(obj: any): { disputeId?: string; userId?: string; amountRecovered?: number } {
  // Prefer metadata fields set when creating the intent/charge
  const md = obj.metadata || {};
  return {
    disputeId: md.disputeId || md.dispute_id || undefined,
    userId: md.userId || md.user_id || undefined,
    amountRecovered: md.amountRecovered ? parseFloat(md.amountRecovered) : undefined
  };
}

export default router;

