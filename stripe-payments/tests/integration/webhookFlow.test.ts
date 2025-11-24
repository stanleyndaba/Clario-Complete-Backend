import request from 'supertest';
import app from '@/app';
import { prisma } from '@/prisma/client';
import { StripeService } from '@/services/stripeService';

// Mock Stripe service
jest.mock('@/services/stripeService');

describe('Webhook Flow Integration Tests', () => {
  beforeAll(async () => {
    // Clean up database
    await prisma.stripeTransaction.deleteMany();
    await prisma.stripeWebhookEvent.deleteMany();
    await prisma.transactionAudit.deleteMany();
    await prisma.idempotencyKey.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear all data before each test
    await prisma.stripeTransaction.deleteMany();
    await prisma.stripeWebhookEvent.deleteMany();
    await prisma.transactionAudit.deleteMany();
    await prisma.idempotencyKey.deleteMany();
  });

  describe('POST /api/v1/stripe/charge-commission', () => {
    it('should create a transaction and return success', async () => {
      const payload = {
        userId: 1,
        claimId: 123,
        amountRecoveredCents: 10000,
        currency: 'usd',
        idempotencyKey: 'test-key-123',
      };

      const response = await request(app)
        .post('/api/v1/stripe/charge-commission')
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'test-key-123')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.transactionId).toBeDefined();
      expect(response.body.data.status).toBe('pending');
      expect(response.body.data.platformFeeCents).toBe(2000);
      expect(response.body.data.sellerPayoutCents).toBe(8000);
    });

    it('should handle duplicate idempotency keys', async () => {
      const payload = {
        userId: 1,
        claimId: 123,
        amountRecoveredCents: 10000,
        currency: 'usd',
        idempotencyKey: 'test-key-456',
      };

      // First request
      const response1 = await request(app)
        .post('/api/v1/stripe/charge-commission')
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'test-key-456')
        .send(payload);

      expect(response1.status).toBe(200);

      // Second request with same idempotency key
      const response2 = await request(app)
        .post('/api/v1/stripe/charge-commission')
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'test-key-456')
        .send(payload);

      expect(response2.status).toBe(200);
      expect(response2.body.data.transactionId).toBe(response1.body.data.transactionId);
    });

    it('should reject invalid payload', async () => {
      const payload = {
        userId: 'invalid',
        amountRecoveredCents: -100,
        currency: 'invalid',
      };

      const response = await request(app)
        .post('/api/v1/stripe/charge-commission')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('POST /webhooks/stripe', () => {
    it('should process payment_intent.succeeded webhook', async () => {
      // Create a transaction first
      const transaction = await prisma.stripeTransaction.create({
        data: {
          userId: 1,
          claimId: 123,
          amountRecoveredCents: 10000,
          platformFeeCents: 2000,
          sellerPayoutCents: 8000,
          currency: 'usd',
          status: 'pending',
          stripePaymentIntentId: 'pi_test_123',
        },
      });

      // Mock webhook signature verification
      (StripeService.verifyWebhookSignature as jest.Mock).mockReturnValue({
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            metadata: {
              transactionId: transaction.id.toString(),
            },
            amount: 2000,
            currency: 'usd',
            status: 'succeeded',
            latest_charge: 'ch_test_123',
          },
        },
      });

      const webhookPayload = {
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            metadata: {
              transactionId: transaction.id.toString(),
            },
            amount: 2000,
            currency: 'usd',
            status: 'succeeded',
            latest_charge: 'ch_test_123',
          },
        },
      };

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 'valid_signature')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Check that transaction status was updated
      const updatedTransaction = await prisma.stripeTransaction.findUnique({
        where: { id: transaction.id },
      });

      expect(updatedTransaction?.status).toBe('charged');
    });

    it('should reject invalid webhook signature', async () => {
      (StripeService.verifyWebhookSignature as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 'invalid_signature')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid webhook signature');
    });

    it('should process charge.refunded webhook', async () => {
      // Pre-create a transaction with a charge id
      const transaction = await prisma.stripeTransaction.create({
        data: {
          userId: 1,
          claimId: 124,
          amountRecoveredCents: 10000,
          platformFeeCents: 2000,
          sellerPayoutCents: 8000,
          currency: 'usd',
          status: 'charged',
          stripeChargeId: 'ch_test_456',
        },
      });

      (StripeService.verifyWebhookSignature as jest.Mock).mockReturnValue({
        id: 'evt_test_refund_1',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_456',
            amount_refunded: 2000,
          },
        },
      });

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 'valid_signature')
        .send({});

      expect(response.status).toBe(200);

      const updated = await prisma.stripeTransaction.findUnique({ where: { id: transaction.id } });
      expect(updated?.status).toBe('refunded');
    });

    it('should store invoice on invoice.paid webhook', async () => {
      // Create customer mapping
      await prisma.stripeCustomer.create({
        data: {
          externalUserId: 'legacy-user-1',
          stripeCustomerId: 'cus_test_123',
          email: 'user@example.com',
        },
      });

      (StripeService.verifyWebhookSignature as jest.Mock).mockReturnValue({
        id: 'evt_test_invoice_paid',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test_123',
            customer: 'cus_test_123',
            status: 'paid',
            currency: 'usd',
            amount_due: 1000,
            amount_paid: 1000,
            hosted_invoice_url: 'https://stripe.com/invoice/in_test_123',
            invoice_pdf: 'https://stripe.com/invoice/in_test_123.pdf',
            payment_intent: 'pi_test_999',
            charge: 'ch_test_999',
            period_start: Math.floor(Date.now() / 1000) - 3600,
            period_end: Math.floor(Date.now() / 1000),
            status_transitions: { finalized_at: Math.floor(Date.now() / 1000) - 1800 },
            metadata: { plan: 'pro' },
          },
        },
      });

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 'valid_signature')
        .send({});

      expect(response.status).toBe(200);

      const invoice = await prisma.stripeInvoice.findUnique({ where: { stripeInvoiceId: 'in_test_123' } });
      expect(invoice).toBeTruthy();
      expect(invoice?.status).toBe('paid');
      expect(invoice?.amountPaidCents).toBe(1000);
      expect(invoice?.userId).toBe(1);
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('stripe-payments');
    });
  });

  describe('POST /api/v1/stripe/simulate-payout', () => {
    it('should simulate payout successfully', async () => {
      // Create a transaction
      const transaction = await prisma.stripeTransaction.create({
        data: {
          userId: 1,
          claimId: 123,
          amountRecoveredCents: 10000,
          platformFeeCents: 2000,
          sellerPayoutCents: 8000,
          currency: 'usd',
          status: 'pending',
          stripePaymentIntentId: 'pi_test_123',
        },
      });

      const payload = {
        transactionId: transaction.id,
        eventType: 'payment_intent.succeeded',
      };

      const response = await request(app)
        .post('/api/v1/stripe/simulate-payout')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Payout simulation completed');
    });

    it('should reject invalid transaction ID', async () => {
      const payload = {
        transactionId: 99999,
        eventType: 'payment_intent.succeeded',
      };

      const response = await request(app)
        .post('/api/v1/stripe/simulate-payout')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Transaction not found');
    });
  });
}); 