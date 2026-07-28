import crypto from 'crypto';
import config from '../config/env';
import { RECOVERY_WORKSPACE_ACTIVATION_PRODUCT } from '../config/paystackProducts';
import { convertUserIdToUuid, supabaseAdmin } from '../database/supabaseClient';
import auditRunService from './auditRunService';
import {
  createInitializedPayment,
  createWebhookEvent,
  getCurrentPaidActivationPayment,
  getLatestActivatedWorkspacePayment,
  getPaymentByReference,
  listTenantPaymentHistory,
  markPaymentFailed,
  markPaymentPending,
  markWebhookEventProcessed,
  PaymentRow,
  toCustomerSafePayment,
  updatePaystackInitializationData,
} from './paymentRepository';
import {
  computePaystackSignature,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from './paystackService';
import { applyVerifiedPaystackActivation } from './paymentActivationService';

function generateReference(): string {
  return `MGN-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function getCallbackUrl(): string {
  const callbackUrl = config.PAYSTACK_CALLBACK_URL?.trim();
  if (!callbackUrl) {
    throw new Error('PAYSTACK_CALLBACK_URL is not configured');
  }
  return callbackUrl;
}

function assertEligibleAudit(audit: any) {
  if (audit.activation_status === 'activated') {
    return;
  }

  if (!['completed', 'failed', 'created', 'amazon_connection_required', 'syncing', 'detecting'].includes(audit.status)) {
    throw new Error('Audit is not eligible for activation');
  }
}

async function ensureTenantMembership(userId: string, tenantId: string): Promise<void> {
  const safeUserId = convertUserIdToUuid(userId);
  const { data, error } = await supabaseAdmin
    .from('tenant_memberships')
    .select('id')
    .eq('user_id', safeUserId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate tenant membership: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Tenant membership required');
  }
}

function assertUserOwnsPayment(payment: PaymentRow, userId: string, tenantId?: string | null) {
  const safeUserId = convertUserIdToUuid(userId);
  if (payment.user_id !== safeUserId) {
    throw new Error('Payment not found');
  }
  if (tenantId && payment.tenant_id !== tenantId) {
    throw new Error('Payment not found');
  }
}

function pendingResponse(payment: PaymentRow) {
  return {
    success: true,
    payment: toCustomerSafePayment(payment),
    workspace: {
      activated: false,
      audit_run_id: payment.audit_run_id,
      activated_at: null,
    },
  };
}

class PaystackPaymentFlowService {
  async initializeCheckout(input: {
    userId: string;
    email?: string | null;
    auditRunId: string;
    tenantId?: string | null;
  }) {
    const audit = await auditRunService.getAudit(input.auditRunId, input.userId);
    const safeUserId = convertUserIdToUuid(input.userId);

    if (audit.user_id !== safeUserId) {
      throw new Error('Audit run not found');
    }
    if (input.tenantId && audit.tenant_id !== input.tenantId) {
      throw new Error('Audit run not found');
    }

    await ensureTenantMembership(input.userId, audit.tenant_id);
    assertEligibleAudit(audit);

    const existingPaid = await getCurrentPaidActivationPayment(audit.id);
    if (existingPaid) {
      return {
        success: true,
        already_paid: true,
        payment_id: existingPaid.id,
        reference: existingPaid.reference,
        authorization_url: null,
        access_code: null,
        workspace: {
          activated: true,
          audit_run_id: audit.id,
          activated_at: audit.activated_at || existingPaid.paid_at,
        },
      };
    }

    const reference = generateReference();
    const metadata = {
      internal_payment_reference: reference,
      audit_run_id: audit.id,
      tenant_id: audit.tenant_id,
      user_id: safeUserId,
      product_key: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.key,
    };

    const payment = await createInitializedPayment({
      reference,
      userId: safeUserId,
      tenantId: audit.tenant_id,
      auditRunId: audit.id,
      storeId: audit.store_id || null,
      productKey: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.key,
      amountSubunits: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.amountSubunits,
      currency: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.currency,
      metadata,
    });

    try {
      const initialized = await initializePaystackTransaction({
        email: input.email || 'customer@margin-finance.com',
        amountSubunits: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.amountSubunits,
        currency: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.currency,
        reference,
        callbackUrl: getCallbackUrl(),
        metadata: {
          ...metadata,
          payment_id: payment.id,
        },
      });

      const updated = await updatePaystackInitializationData({
        paymentId: payment.id,
        authorizationUrl: initialized.data.authorization_url,
        accessCode: initialized.data.access_code,
        providerResponse: initialized.safeResponse,
      });

      return {
        success: true,
        payment_id: updated.id,
        reference: updated.reference,
        authorization_url: updated.authorization_url,
        access_code: updated.access_code,
      };
    } catch (error: any) {
      await markPaymentFailed({
        paymentId: payment.id,
        providerStatus: 'initialize_failed',
        providerResponse: { message: error?.message || 'Paystack initialization failed' },
      });
      throw error;
    }
  }

  async verifyCheckout(input: { reference: string; userId: string; tenantId?: string | null }) {
    const payment = await getPaymentByReference(input.reference);
    if (!payment) {
      return { success: false, status: 404, message: 'Payment not found' };
    }

    assertUserOwnsPayment(payment, input.userId, input.tenantId);
    await ensureTenantMembership(input.userId, payment.tenant_id);

    const verified = await verifyPaystackTransaction(input.reference);
    const providerStatus = verified.data.status;

    if (providerStatus !== 'success') {
      const updated = providerStatus === 'pending'
        ? await markPaymentPending(payment.reference, verified.safeResponse)
        : await markPaymentFailed({
            reference: payment.reference,
            providerStatus,
            providerResponse: verified.safeResponse,
          });
      return pendingResponse(updated || payment);
    }

    const activation = await applyVerifiedPaystackActivation(payment.reference, verified.data, verified.safeResponse);
    return {
      success: true,
      payment: activation.payment,
      workspace: activation.workspace,
    };
  }

  async processWebhook(rawPayload: Record<string, any>, signatureHash: string) {
    const eventType = String(rawPayload?.event || '');
    const data = rawPayload?.data || {};
    const reference = typeof data?.reference === 'string' ? data.reference : null;
    const eventId = rawPayload?.id ? String(rawPayload.id) : data?.id ? `${eventType}:${String(data.id)}` : null;

    const { event, duplicate } = await createWebhookEvent({
      eventId,
      reference,
      eventType: eventType || 'unknown',
      signatureHash,
      payload: rawPayload,
    });

    if (duplicate) {
      return { success: true, duplicate: true };
    }

    if (eventType !== 'charge.success') {
      if (event) await markWebhookEventProcessed(event.id, 'ignored');
      return { success: true, ignored: true };
    }

    if (!reference) {
      if (event) await markWebhookEventProcessed(event.id, 'failed', 'Missing payment reference');
      return { success: true, ignored: true };
    }

    try {
      const payment = await getPaymentByReference(reference);
      if (!payment) {
        if (event) await markWebhookEventProcessed(event.id, 'ignored', 'Unknown payment reference');
        return { success: true, ignored: true };
      }

      const verified = await verifyPaystackTransaction(reference);
      if (verified.data.status !== 'success') {
        if (event) await markWebhookEventProcessed(event.id, 'ignored', `Provider status ${verified.data.status}`);
        return { success: true, ignored: true };
      }

      await applyVerifiedPaystackActivation(reference, verified.data, verified.safeResponse);
      if (event) await markWebhookEventProcessed(event.id, 'processed');
      return { success: true, processed: true };
    } catch (error: any) {
      if (event) await markWebhookEventProcessed(event.id, 'failed', error?.message || 'Webhook processing failed');
      throw error;
    }
  }

  async getWorkspaceStatus(tenantId: string) {
    const payments = await listTenantPaymentHistory(tenantId);
    const latestActivation = await getLatestActivatedWorkspacePayment(tenantId);

    return {
      product: {
        key: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.key,
        name: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.displayName,
        amount_subunits: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.amountSubunits,
        currency: RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.currency,
      },
      workspace: {
        activated: Boolean(latestActivation),
        activated_at: latestActivation?.paid_at || null,
        audit_run_id: latestActivation?.audit_run_id || null,
      },
      latest_payment: latestActivation ? toCustomerSafePayment(latestActivation) : null,
      payments: payments.map(toCustomerSafePayment),
    };
  }

  computeWebhookSignatureHash(rawBody: Buffer | string): string {
    return computePaystackSignature(rawBody);
  }
}

export const paystackPaymentFlowService = new PaystackPaymentFlowService();
export default paystackPaymentFlowService;
