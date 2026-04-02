import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import {
  BillingInvoiceRow,
  PaymentConfirmationSource,
} from './subscriptionBillingTruthService';

const CONFIRMABLE_SUBSCRIPTION_STATUSES = new Set([
  'draft',
  'pending',
  'scheduled',
  'pending_payment_method',
  'sent',
]);

export type ConfirmSubscriptionInvoicePaymentParams = {
  tenantId: string;
  invoiceId: string;
  confirmedByUserId: string;
  confirmationSource?: Extract<PaymentConfirmationSource, 'manual_dashboard' | 'manual_api'>;
  confirmationNote?: string | null;
};

export type ConfirmSubscriptionInvoicePaymentResult = {
  alreadyConfirmed: boolean;
  invoice: BillingInvoiceRow;
};

function normalizeConfirmationNote(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 1000) : null;
}

function parseMetadata(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, any>) };
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, any>) };
      }
    } catch {
      return {};
    }
  }

  return {};
}

async function findInvoiceByIdOrInvoiceId(tenantId: string, invoiceId: string): Promise<BillingInvoiceRow | null> {
  const queries: Array<{ column: 'id' | 'invoice_id'; value: string }> = [
    { column: 'id', value: invoiceId },
    { column: 'invoice_id', value: invoiceId },
  ];

  for (const query of queries) {
    const { data, error } = await supabaseAdmin
      .from('billing_invoices')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq(query.column, query.value)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (data) {
      return data as BillingInvoiceRow;
    }
  }

  return null;
}

export function canConfirmSubscriptionInvoicePayment(invoice: Pick<BillingInvoiceRow, 'invoice_model' | 'invoice_type' | 'status'>): boolean {
  if (invoice.invoice_model !== 'subscription') return false;
  if (invoice.invoice_type !== 'subscription_invoice') return false;
  return CONFIRMABLE_SUBSCRIPTION_STATUSES.has(String(invoice.status || '').toLowerCase());
}

export async function confirmSubscriptionInvoicePayment(
  params: ConfirmSubscriptionInvoicePaymentParams
): Promise<ConfirmSubscriptionInvoicePaymentResult> {
  const confirmationSource = params.confirmationSource || 'manual_dashboard';
  const confirmationNote = normalizeConfirmationNote(params.confirmationNote);
  const invoice = await findInvoiceByIdOrInvoiceId(params.tenantId, params.invoiceId);

  if (!invoice) {
    throw new Error('Subscription invoice not found');
  }

  if (invoice.invoice_model !== 'subscription' || invoice.invoice_type !== 'subscription_invoice') {
    throw new Error('Only active subscription invoices can be manually confirmed');
  }

  if (String(invoice.status || '').toLowerCase() === 'paid') {
    return {
      alreadyConfirmed: true,
      invoice,
    };
  }

  if (!canConfirmSubscriptionInvoicePayment(invoice)) {
    throw new Error(`Invoice status ${invoice.status || 'unknown'} cannot be confirmed as paid`);
  }

  const confirmedAt = new Date().toISOString();
  const metadata = parseMetadata(invoice.metadata);
  const nextConfirmation = {
    confirmed_at: confirmedAt,
    source: confirmationSource,
    confirmed_by_user_id: params.confirmedByUserId,
    note: confirmationNote,
  };
  const existingHistory = Array.isArray(metadata.payment_confirmation_history)
    ? metadata.payment_confirmation_history
    : [];

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('billing_invoices')
    .update({
      status: 'paid',
      amount_charged_cents: invoice.amount_charged_cents ?? invoice.billing_amount_cents,
      paid_at: confirmedAt,
      payment_confirmation_source: confirmationSource,
      payment_confirmed_by_user_id: params.confirmedByUserId,
      payment_confirmation_note: confirmationNote,
      metadata: {
        ...metadata,
        payment_confirmation: nextConfirmation,
        payment_confirmation_history: [...existingHistory, nextConfirmation],
      },
      updated_at: confirmedAt,
    })
    .eq('id', invoice.id)
    .select('*')
    .single();

  if (updateError || !updated) {
    throw new Error(updateError?.message || 'Failed to confirm subscription invoice payment');
  }

  logger.info('[BILLING] Subscription invoice payment confirmed', {
    invoiceId: invoice.invoice_id,
    tenantId: params.tenantId,
    confirmedByUserId: params.confirmedByUserId,
    confirmationSource,
  });

  return {
    alreadyConfirmed: false,
    invoice: updated as BillingInvoiceRow,
  };
}

export default {
  canConfirmSubscriptionInvoicePayment,
  confirmSubscriptionInvoicePayment,
};
