import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import crypto from 'crypto';

describe('paystackService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'margin_paystack_secret_for_tests';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
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

  it('initializes transactions with the backend Paystack plan code when provided', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: 'Authorization URL created',
        data: {
          authorization_url: 'https://checkout.paystack.com/test',
          access_code: 'access-code',
          reference: 'MGN-SUB-123',
        },
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { initializePaystackTransaction } = await import('../../src/services/paystackService');
    await initializePaystackTransaction({
      email: 'seller@example.com',
      amountSubunits: 179900,
      currency: 'ZAR',
      reference: 'MGN-SUB-123',
      callbackUrl: 'https://margin-finance.com/payment/success',
      planCode: 'PLN_margin_recovery_workspace',
      metadata: { tenant_id: 'tenant-1' },
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      amount: 179900,
      currency: 'ZAR',
      plan: 'PLN_margin_recovery_workspace',
    });
  });

  it('lists plan-filtered subscriptions through the server-side Paystack API without exposing the secret key', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: 'Subscriptions retrieved',
        data: [{
          subscription_code: 'SUB_provider_truth',
          status: 'active',
          customer: { customer_code: 'CUS_margin_customer' },
          plan: { plan_code: 'PLN_margin_recovery_workspace', amount: 179900, currency: 'ZAR', interval: 'monthly' },
        }],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { listPaystackSubscriptions } = await import('../../src/services/paystackService');
    const result = await listPaystackSubscriptions({ planId: 123 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].subscription_code).toBe('SUB_provider_truth');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/subscription?plan=123');
    expect(JSON.stringify(result.safeResponse)).not.toContain(process.env.PAYSTACK_SECRET_KEY!);
  });

  it('fetches a Paystack plan by code without exposing the secret key', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: 'Plan retrieved',
        data: {
          plan_code: 'PLN_margin_recovery_workspace',
          amount: 179900,
          currency: 'ZAR',
          interval: 'monthly',
        },
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchPaystackPlan } = await import('../../src/services/paystackService');
    const result = await fetchPaystackPlan('PLN_margin_recovery_workspace');

    expect(result.data).toMatchObject({
      plan_code: 'PLN_margin_recovery_workspace',
      amount: 179900,
      currency: 'ZAR',
      interval: 'monthly',
    });
    expect(JSON.stringify(result.safeResponse)).not.toContain(process.env.PAYSTACK_SECRET_KEY!);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/plan/PLN_margin_recovery_workspace');
  });
});
