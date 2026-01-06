#!/usr/bin/env ts-node

import { stripe } from '@/config/stripeConfig';
import config from '@/config/env';

const WEBHOOK_ENDPOINTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'transfer.paid',
  'transfer.failed',
  'account.updated',
];

async function registerWebhooks() {
  try {
    console.log('🔗 Registering Stripe webhooks...');
    
    const webhookUrl = process.env.WEBHOOK_URL || 'https://yourdomain.com/webhooks/stripe';
    
    for (const event of WEBHOOK_ENDPOINTS) {
      try {
        const webhook = await stripe.webhookEndpoints.create({
          url: webhookUrl,
          enabled_events: [event],
          metadata: {
            service: 'stripe-payments',
            environment: config.NODE_ENV,
          },
        });
        
        console.log(`✅ Registered webhook for ${event}: ${webhook.id}`);
      } catch (error: any) {
        if (error.code === 'resource_already_exists') {
          console.log(`⚠️  Webhook for ${event} already exists`);
        } else {
          console.error(`❌ Failed to register webhook for ${event}:`, error.message);
        }
      }
    }
    
    console.log('🎉 Webhook registration completed!');
  } catch (error) {
    console.error('❌ Error registering webhooks:', error);
    process.exit(1);
  }
}

// Run the script
registerWebhooks(); 