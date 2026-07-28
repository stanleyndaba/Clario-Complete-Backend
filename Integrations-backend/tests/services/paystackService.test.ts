import { beforeEach, describe, expect, it } from '@jest/globals';
import crypto from 'crypto';

describe('paystackService', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_margin_paystack_secret_for_tests';
  });

  it('verifies Paystack webhook signatures with HMAC-SHA512', async () => {
    const { verifyPaystackWebhookSignature } = await import('../../src/services/paystackService');
    const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'MGN-123' } }));
    const signature = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(rawBody)
      .digest('hex');

    expect(verifyPaystackWebhookSignature(rawBody, signature)).toBe(true);
    expect(verifyPaystackWebhookSignature(rawBody, signature.replace(/^./, '0'))).toBe(false);
    expect(verifyPaystackWebhookSignature(rawBody, undefined)).toBe(false);
  });
});
