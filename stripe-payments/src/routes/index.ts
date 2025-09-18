import { Router } from 'express';
import { CheckoutController, connectAccountValidation, chargeCommissionValidation } from '@/controllers/checkoutController';
import { WebhookController } from '@/controllers/webhookController';
import { PayoutController, reconcileTransactionValidation, handleClawbackValidation, retryFailedTransactionValidation, cleanupOldDataValidation } from '@/controllers/payoutController';
import { verifyStripeWebhook, checkWebhookIdempotency, logWebhookEvent, validateWebhookEventType, stripeRawBody } from '@/middlewares/verifyStripeWebhook';
import { validateIdempotencyKeyMiddleware } from '@/utils/idempotency';
import { authenticateJWT, requireAdmin } from '@/middlewares/auth';
import { WEBHOOK_EVENTS } from '@/config/stripeConfig';

const router = Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'stripe-payments',
    version: '1.0.0',
  });
});

// API v1 routes
const apiV1Router = Router();

// Stripe Connect routes
apiV1Router.post('/stripe/connect', authenticateJWT, connectAccountValidation, CheckoutController.connectAccount);
apiV1Router.get('/stripe/status/:userId', authenticateJWT, CheckoutController.getAccountStatus);
apiV1Router.post('/stripe/create-customer-setup', authenticateJWT, CheckoutController.createCustomerAndSetupIntent);
apiV1Router.post('/stripe/get-or-create-customer', authenticateJWT, async (req, res) => {
  try {
    const { userId, email, name } = req.body as { userId: number; email: string; name?: string };
    if (!userId || !email) return res.status(400).json({ error: 'Missing userId/email' });
    const cid = await (await import('@/services/stripeService')).StripeService.createCustomer(userId, email, name);
    res.json({ success: true, data: { customerId: cid } });
  } catch (e: any) {
    res.status(500).json({ error: 'Internal error', message: e?.message || 'Failed' });
  }
});
apiV1Router.post('/stripe/create-subscription', authenticateJWT, CheckoutController.createSubscription);
apiV1Router.post('/stripe/cancel-subscription', authenticateJWT, CheckoutController.cancelSubscription);

// Commission charging (called by refund-engine)
apiV1Router.post('/stripe/charge-commission', authenticateJWT, validateIdempotencyKeyMiddleware, chargeCommissionValidation, CheckoutController.chargeCommission);

// Transaction routes
apiV1Router.get('/stripe/transactions/:userId', authenticateJWT, CheckoutController.listTransactions);
apiV1Router.get('/stripe/transactions/:transactionId', authenticateJWT, CheckoutController.getTransaction);

// Webhook routes
apiV1Router.post('/webhooks/stripe', 
  stripeRawBody,
  verifyStripeWebhook,
  checkWebhookIdempotency,
  logWebhookEvent,
  validateWebhookEventType([
    WEBHOOK_EVENTS.PAYMENT_INTENT_SUCCEEDED,
    WEBHOOK_EVENTS.PAYMENT_INTENT_FAILED,
    WEBHOOK_EVENTS.CHARGE_SUCCEEDED,
    WEBHOOK_EVENTS.CHARGE_FAILED,
    WEBHOOK_EVENTS.CHARGE_REFUNDED,
    WEBHOOK_EVENTS.INVOICE_FINALIZED,
    WEBHOOK_EVENTS.TRANSFER_PAID,
    WEBHOOK_EVENTS.TRANSFER_FAILED,
    WEBHOOK_EVENTS.ACCOUNT_UPDATED,
    WEBHOOK_EVENTS.SUBSCRIPTION_UPDATED,
    WEBHOOK_EVENTS.SUBSCRIPTION_DELETED,
    WEBHOOK_EVENTS.INVOICE_PAID,
    WEBHOOK_EVENTS.INVOICE_PAYMENT_FAILED,
  ]),
  WebhookController.handleWebhook
);

// Testing routes (development only)
apiV1Router.post('/stripe/simulate-payout', authenticateJWT, requireAdmin, WebhookController.simulatePayout);

// Reconciliation and admin routes
apiV1Router.post('/stripe/reconcile', authenticateJWT, requireAdmin, reconcileTransactionValidation, PayoutController.reconcileTransaction);
apiV1Router.post('/stripe/clawback', authenticateJWT, requireAdmin, handleClawbackValidation, PayoutController.handleClawback);
apiV1Router.get('/stripe/reconciliation-summary', authenticateJWT, requireAdmin, PayoutController.getReconciliationSummary);
apiV1Router.post('/stripe/process-reconciliations', authenticateJWT, requireAdmin, PayoutController.processAllPendingReconciliations);

// Queue and monitoring routes
apiV1Router.get('/stripe/queue-stats', authenticateJWT, requireAdmin, PayoutController.getQueueStats);
apiV1Router.get('/stripe/audit-trail/:transactionId', authenticateJWT, requireAdmin, PayoutController.getTransactionAuditTrail);
apiV1Router.get('/stripe/user-audit/:userId', authenticateJWT, requireAdmin, PayoutController.getUserAuditSummary);
apiV1Router.get('/stripe/unprocessed-webhooks', authenticateJWT, requireAdmin, PayoutController.getUnprocessedWebhookEvents);

// Admin operations
apiV1Router.post('/stripe/retry-transaction', authenticateJWT, requireAdmin, retryFailedTransactionValidation, PayoutController.retryFailedTransaction);
apiV1Router.post('/stripe/cleanup', authenticateJWT, requireAdmin, cleanupOldDataValidation, PayoutController.cleanupOldData);
apiV1Router.get('/stripe/idempotency-stats', authenticateJWT, requireAdmin, PayoutController.getIdempotencyStats);

// Mount API v1 routes
router.use('/api/v1', apiV1Router);

// Webhook endpoint (direct access)
router.post('/webhooks/stripe', 
  stripeRawBody,
  verifyStripeWebhook,
  checkWebhookIdempotency,
  logWebhookEvent,
  validateWebhookEventType([
    WEBHOOK_EVENTS.PAYMENT_INTENT_SUCCEEDED,
    WEBHOOK_EVENTS.PAYMENT_INTENT_FAILED,
    WEBHOOK_EVENTS.CHARGE_SUCCEEDED,
    WEBHOOK_EVENTS.CHARGE_FAILED,
    WEBHOOK_EVENTS.CHARGE_REFUNDED,
    WEBHOOK_EVENTS.INVOICE_FINALIZED,
    WEBHOOK_EVENTS.TRANSFER_PAID,
    WEBHOOK_EVENTS.TRANSFER_FAILED,
    WEBHOOK_EVENTS.ACCOUNT_UPDATED,
    WEBHOOK_EVENTS.SUBSCRIPTION_UPDATED,
    WEBHOOK_EVENTS.SUBSCRIPTION_DELETED,
    WEBHOOK_EVENTS.INVOICE_PAID,
    WEBHOOK_EVENTS.INVOICE_PAYMENT_FAILED,
  ]),
  WebhookController.handleWebhook
);

// 404 handler
router.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

export default router; 