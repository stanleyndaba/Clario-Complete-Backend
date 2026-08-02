import crypto from 'crypto';
import config from '../config/env';
import { RECOVER_ONCE_PRODUCT, RECOVER_ONCE_QUOTE_AMOUNTS } from '../config/paystackProducts';
import { convertUserIdToUuid, supabaseAdmin } from '../database/supabaseClient';
import auditRunService from './auditRunService';
import {
  createInitializedPayment,
  createWebhookEvent,
  getPaymentByReference,
  markPaymentFailed,
  markPaymentPaid,
  markPaymentPending,
  markWebhookEventProcessed,
  toCustomerSafePayment,
  updatePaystackInitializationData,
} from './paymentRepository';
import {
  computePaystackSignature,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from './paystackService';

type QuoteStatus =
  | 'available'
  | 'accepted'
  | 'paid'
  | 'expired'
  | 'manual_review_required'
  | 'unavailable'
  | 'cancelled';

type QuoteRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  audit_run_id: string;
  currency: 'ZAR';
  amount_subunits: number | null;
  status: QuoteStatus;
  estimated_recoverable_subunits: number;
  workload_score: number;
  included_opportunity_count: number;
  calculation: Record<string, unknown>;
  scope_snapshot: Record<string, unknown>;
  scope_hash: string;
  manual_review_reason: string | null;
  generated_at: string;
  expires_at: string;
  accepted_at: string | null;
  paid_at: string | null;
  payment_id: string | null;
  payment_reference: string | null;
};

type OpportunityRow = {
  id?: string;
  estimated_value?: number | string | null;
  evidence?: any;
  anomaly_type?: string | null;
  coverage_family?: string | null;
  detector_key?: string | null;
  claim_readiness?: string | null;
};

const PRODUCT = RECOVER_ONCE_PRODUCT;
const QUOTE_EXPIRY_DAYS = 14;

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function getCallbackUrl(): string {
  const callbackUrl = config.PAYSTACK_CALLBACK_URL?.trim();
  if (!callbackUrl) throw new Error('PAYSTACK_CALLBACK_URL is not configured');
  return callbackUrl;
}

function generateReference(): string {
  return `MGN-RO-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function getCountedValue(row: OpportunityRow): number {
  const countedValue = row?.evidence?.economic_rollup?.counted_value;
  const value = typeof countedValue === 'number' && Number.isFinite(countedValue)
    ? countedValue
    : Number(row?.estimated_value || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeCategory(row: OpportunityRow): string {
  return String(row.coverage_family || row.detector_key || row.anomaly_type || 'Recovery finding')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEvidenceReady(row: OpportunityRow): boolean {
  const readiness = String(row.claim_readiness || '').toLowerCase();
  if (readiness.includes('ready') || readiness.includes('complete')) return true;
  return row.evidence?.ready === true || row.evidence?.evidence_ready === true;
}

function estimateWorkload(rows: OpportunityRow[]): number {
  return rows.reduce((score, row) => {
    const text = [
      row.anomaly_type,
      row.coverage_family,
      row.detector_key,
      row.claim_readiness,
      JSON.stringify(row.evidence || {}),
    ].join(' ').toLowerCase();

    let next = score + 1;
    if (!isEvidenceReady(row)) next += 1;
    if (text.includes('appeal') || text.includes('rejection') || text.includes('response')) next += 2;
    if (text.includes('underpayment') || text.includes('reversal') || text.includes('settlement')) next += 1;
    return next;
  }, 0);
}

export function calculateRecoverOnceQuote(input: {
  opportunityCount: number;
  workloadScore: number;
  estimatedRecoverableSubunits: number;
}): { status: QuoteStatus; amountSubunits: number | null; reason?: string; tier?: string } {
  if (input.opportunityCount < 1 || input.estimatedRecoverableSubunits < 1) {
    return { status: 'unavailable', amountSubunits: null, reason: 'No actionable recovery scope is available yet' };
  }

  if (input.workloadScore >= 10 || input.opportunityCount > 9) {
    return { status: 'manual_review_required', amountSubunits: null, reason: 'Scope needs manual review before a fixed quote can be issued' };
  }

  const amountSubunits =
    input.workloadScore <= 2
      ? RECOVER_ONCE_QUOTE_AMOUNTS.light
      : input.workloadScore <= 5
        ? RECOVER_ONCE_QUOTE_AMOUNTS.standard
        : RECOVER_ONCE_QUOTE_AMOUNTS.complex;

  if (amountSubunits > input.estimatedRecoverableSubunits * 0.2) {
    return { status: 'manual_review_required', amountSubunits: null, reason: 'Scope needs manual review before a fixed quote can be issued' };
  }

  const tier = amountSubunits === RECOVER_ONCE_QUOTE_AMOUNTS.light
    ? 'light'
    : amountSubunits === RECOVER_ONCE_QUOTE_AMOUNTS.standard
      ? 'standard'
      : 'complex';
  return { status: 'available', amountSubunits, tier };
}

function toSafeQuote(row: QuoteRow) {
  return {
    id: row.id,
    status: row.status,
    currency: row.currency,
    amount_subunits: row.amount_subunits,
    display_amount: row.amount_subunits ? `R${Math.round(row.amount_subunits / 100).toLocaleString('en-ZA')}` : null,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at,
    paid_at: row.paid_at,
    included_opportunity_count: row.included_opportunity_count,
    estimated_recoverable_subunits: row.estimated_recoverable_subunits,
    manual_review_reason: row.manual_review_reason,
  };
}

function getEventReference(rawPayload: Record<string, any>): string | null {
  const data = rawPayload?.data || {};
  return typeof data?.reference === 'string' ? data.reference : null;
}

class RecoverOnceService {
  computeWebhookSignatureHash(rawBody: Buffer | string) {
    return computePaystackSignature(rawBody);
  }

  private async ensureTenantMembership(userId: string, tenantId: string): Promise<void> {
    const safeUserId = convertUserIdToUuid(userId);
    const { data, error } = await supabaseAdmin
      .from('tenant_memberships')
      .select('id')
      .eq('user_id', safeUserId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw new Error(`Failed to validate tenant membership: ${error.message}`);
    if (!data?.id) throw new Error('Tenant membership required');
  }

  private async loadOpportunities(audit: any): Promise<OpportunityRow[]> {
    if (!audit.sync_id) return [];
    const { data, error } = await supabaseAdmin
      .from('detection_results')
      .select('id, estimated_value, evidence, anomaly_type, coverage_family, detector_key, claim_readiness')
      .eq('seller_id', audit.user_id)
      .eq('tenant_id', audit.tenant_id)
      .eq('sync_id', audit.sync_id)
      .limit(500);

    if (error) throw new Error(`Failed to load audit opportunities: ${error.message}`);
    return (data || []).filter((row: OpportunityRow) => row.id && getCountedValue(row) > 0);
  }

  private buildScope(audit: any, rows: OpportunityRow[]) {
    const opportunities = rows.map((row) => ({
      id: row.id,
      category: normalizeCategory(row),
      estimated_value: getCountedValue(row),
      evidence_ready: isEvidenceReady(row),
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const estimatedRecoverableSubunits = Math.round(
      opportunities.reduce((sum, row) => sum + row.estimated_value, 0) * 100
    );
    const workloadScore = estimateWorkload(rows);
    const categories = Array.from(new Set(opportunities.map((row) => row.category))).slice(0, 8);
    const snapshot = {
      audit_run_id: audit.id,
      sync_id: audit.sync_id,
      generated_from: 'detection_results',
      opportunities,
      categories,
    };
    const scopeHash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    return { snapshot, scopeHash, workloadScore, estimatedRecoverableSubunits, categories };
  }

  private async getQuoteById(quoteId: string): Promise<QuoteRow | null> {
    const { data, error } = await supabaseAdmin
      .from('recover_once_quotes')
      .select('*')
      .eq('id', quoteId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load Recover Once quote: ${error.message}`);
    return data || null;
  }

  async generateOrResolveQuote(input: { auditRunId: string; userId: string; tenantId?: string | null }) {
    const audit = await auditRunService.getAudit(input.auditRunId, input.userId);
    const safeUserId = convertUserIdToUuid(input.userId);
    if (audit.user_id !== safeUserId) throw new Error('Audit run not found');
    if (input.tenantId && audit.tenant_id !== input.tenantId) throw new Error('Audit run not found');
    await this.ensureTenantMembership(input.userId, audit.tenant_id);

    if (audit.status !== 'completed') {
      throw new Error('Recover Once quotes require a completed audit');
    }

    const summary = audit.summary || {};
    const rows = await this.loadOpportunities(audit);
    const { snapshot, scopeHash, workloadScore, estimatedRecoverableSubunits } = this.buildScope(audit, rows);
    const quote = calculateRecoverOnceQuote({
      opportunityCount: rows.length,
      workloadScore,
      estimatedRecoverableSubunits,
    });

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('recover_once_quotes')
      .select('*')
      .eq('audit_run_id', audit.id)
      .eq('scope_hash', scopeHash)
      .in('status', ['available', 'accepted', 'paid', 'manual_review_required'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw new Error(`Failed to resolve Recover Once quote: ${existingError.message}`);
    if (existing && new Date(existing.expires_at) > new Date()) {
      return { success: true, quote: toSafeQuote(existing) };
    }

    const { data, error } = await supabaseAdmin
      .from('recover_once_quotes')
      .insert({
        tenant_id: audit.tenant_id,
        user_id: safeUserId,
        audit_run_id: audit.id,
        currency: PRODUCT.currency,
        amount_subunits: quote.amountSubunits,
        status: quote.status,
        estimated_recoverable_subunits: estimatedRecoverableSubunits,
        workload_score: workloadScore,
        included_opportunity_count: rows.length,
        calculation: {
          tier: quote.tier || null,
          formula_version: 'recover_once_v1',
          final_status: summary.finalStatus || null,
        },
        scope_snapshot: snapshot,
        scope_hash: scopeHash,
        manual_review_reason: quote.reason || null,
        expires_at: addDays(new Date(), QUOTE_EXPIRY_DAYS),
      })
      .select('*')
      .single();

    if (error || !data) throw new Error(`Failed to create Recover Once quote: ${error?.message || 'Unknown error'}`);
    return { success: true, quote: toSafeQuote(data) };
  }

  async acceptQuote(input: { quoteId: string; userId: string; tenantId?: string | null }) {
    const quote = await this.getQuoteById(input.quoteId);
    if (!quote) throw new Error('Recover Once quote not found');
    if (quote.user_id !== convertUserIdToUuid(input.userId)) throw new Error('Recover Once quote not found');
    if (input.tenantId && quote.tenant_id !== input.tenantId) throw new Error('Recover Once quote not found');
    await this.ensureTenantMembership(input.userId, quote.tenant_id);

    if (quote.status === 'paid') return { success: true, quote: toSafeQuote(quote) };
    if (!['available', 'accepted'].includes(quote.status)) throw new Error('Recover Once quote is not available');
    if (new Date(quote.expires_at) <= new Date()) throw new Error('Recover Once quote has expired');
    if (!quote.amount_subunits) throw new Error('Recover Once quote is not ready for checkout');

    if (quote.status === 'accepted') return { success: true, quote: toSafeQuote(quote) };

    const { data, error } = await supabaseAdmin
      .from('recover_once_quotes')
      .update({ status: 'accepted', accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', quote.id)
      .select('*')
      .single();

    if (error || !data) throw new Error(`Failed to accept Recover Once quote: ${error?.message || 'Unknown error'}`);
    return { success: true, quote: toSafeQuote(data) };
  }

  async getQuote(input: { quoteId: string; userId: string; tenantId?: string | null }) {
    const quote = await this.getQuoteById(input.quoteId);
    if (!quote) throw new Error('Recover Once quote not found');
    if (quote.user_id !== convertUserIdToUuid(input.userId)) throw new Error('Recover Once quote not found');
    if (input.tenantId && quote.tenant_id !== input.tenantId) throw new Error('Recover Once quote not found');
    await this.ensureTenantMembership(input.userId, quote.tenant_id);
    return { success: true, quote: toSafeQuote(quote) };
  }

  async initializeCheckout(input: { quoteId: string; userId: string; email?: string | null; tenantId?: string | null }) {
    const accepted = await this.acceptQuote(input);
    const quote = await this.getQuoteById(accepted.quote.id);
    if (!quote || !quote.amount_subunits) throw new Error('Recover Once quote is not ready for checkout');

    if (quote.payment_reference) {
      const existingPayment = await getPaymentByReference(quote.payment_reference);
      if (existingPayment?.authorization_url && ['initialized', 'redirected', 'pending'].includes(existingPayment.status)) {
        return {
          success: true,
          quote: toSafeQuote(quote),
          payment_id: existingPayment.id,
          reference: existingPayment.reference,
          authorization_url: existingPayment.authorization_url,
        };
      }
    }

    const reference = generateReference();
    const metadata = {
      internal_payment_reference: reference,
      product_key: PRODUCT.key,
      tenant_id: quote.tenant_id,
      user_id: quote.user_id,
      audit_run_id: quote.audit_run_id,
      recover_once_quote_id: quote.id,
    };
    const payment = await createInitializedPayment({
      reference,
      userId: quote.user_id,
      tenantId: quote.tenant_id,
      auditRunId: quote.audit_run_id,
      productKey: PRODUCT.key,
      amountSubunits: quote.amount_subunits,
      currency: quote.currency,
      metadata,
      paymentKind: 'recover_once',
    });

    const initialized = await initializePaystackTransaction({
      email: input.email || 'customer@margin-finance.com',
      amountSubunits: quote.amount_subunits,
      currency: quote.currency,
      reference,
      callbackUrl: getCallbackUrl(),
      metadata: { ...metadata, payment_id: payment.id },
    });

    const updatedPayment = await updatePaystackInitializationData({
      paymentId: payment.id,
      authorizationUrl: initialized.data.authorization_url,
      accessCode: initialized.data.access_code,
      providerResponse: initialized.safeResponse,
    });

    await supabaseAdmin
      .from('recover_once_quotes')
      .update({
        payment_id: updatedPayment.id,
        payment_reference: updatedPayment.reference,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quote.id);

    return {
      success: true,
      quote: toSafeQuote({ ...quote, payment_id: updatedPayment.id, payment_reference: updatedPayment.reference }),
      payment_id: updatedPayment.id,
      reference: updatedPayment.reference,
      authorization_url: initialized.data.authorization_url,
    };
  }

  private async createEngagement(quote: QuoteRow, payment: any) {
    const { data: existing } = await supabaseAdmin
      .from('recover_once_engagements')
      .select('*')
      .eq('quote_id', quote.id)
      .maybeSingle();
    if (existing) return existing;

    const { data, error } = await supabaseAdmin
      .from('recover_once_engagements')
      .insert({
        tenant_id: quote.tenant_id,
        user_id: quote.user_id,
        audit_run_id: quote.audit_run_id,
        quote_id: quote.id,
        payment_id: payment.id,
        status: 'active',
        scope_snapshot: quote.scope_snapshot,
      })
      .select('*')
      .single();

    if (error || !data) throw new Error(`Failed to create Recover Once engagement: ${error?.message || 'Unknown error'}`);
    return data;
  }

  async finalizeReference(reference: string) {
    const payment = await getPaymentByReference(reference);
    if (!payment || payment.product_key !== PRODUCT.key) {
      return { success: false, status: 404, message: 'Recover Once payment not found' };
    }

    const quote = payment.metadata?.recover_once_quote_id
      ? await this.getQuoteById(String(payment.metadata.recover_once_quote_id))
      : null;
    if (!quote) throw new Error('Recover Once quote not found');

    const verified = await verifyPaystackTransaction(reference);
    if (verified.data.status !== 'success') {
      const updated = verified.data.status === 'pending'
        ? await markPaymentPending(payment.reference, verified.safeResponse)
        : await markPaymentFailed({ reference: payment.reference, providerStatus: verified.data.status, providerResponse: verified.safeResponse });
      return { success: true, payment: toCustomerSafePayment(updated || payment), recover_once_pending: true };
    }

    if (Number(verified.data.amount) !== Number(payment.amount_subunits) || Number(verified.data.amount) !== Number(quote.amount_subunits)) {
      throw new Error('Paystack amount mismatch');
    }
    if (String(verified.data.currency || '').toUpperCase() !== payment.currency) {
      throw new Error('Paystack currency mismatch');
    }

    const paidPayment = await markPaymentPaid({
      reference,
      providerTransactionId: verified.data.id ? String(verified.data.id) : null,
      providerStatus: verified.data.status,
      paidAt: verified.data.paid_at || null,
      providerResponse: verified.safeResponse,
    });

    const paidAt = verified.data.paid_at || new Date().toISOString();
    const { data: paidQuote, error } = await supabaseAdmin
      .from('recover_once_quotes')
      .update({
        status: 'paid',
        paid_at: paidAt,
        payment_id: paidPayment.id,
        payment_reference: paidPayment.reference,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quote.id)
      .select('*')
      .single();
    if (error || !paidQuote) throw new Error(`Failed to mark Recover Once quote paid: ${error?.message || 'Unknown error'}`);

    const engagement = await this.createEngagement(paidQuote, paidPayment);
    return {
      success: true,
      payment: toCustomerSafePayment(paidPayment),
      quote: toSafeQuote(paidQuote),
      engagement: {
        id: engagement.id,
        status: engagement.status,
        audit_run_id: engagement.audit_run_id,
      },
    };
  }

  async verifyCheckout(input: { reference: string; userId: string; tenantId?: string | null }) {
    const payment = await getPaymentByReference(input.reference);
    if (!payment) return { success: false, status: 404, message: 'Recover Once payment not found' };
    if (payment.user_id !== convertUserIdToUuid(input.userId)) return { success: false, status: 404, message: 'Recover Once payment not found' };
    if (input.tenantId && payment.tenant_id !== input.tenantId) return { success: false, status: 404, message: 'Recover Once payment not found' };
    return this.finalizeReference(input.reference);
  }

  async processWebhook(rawPayload: Record<string, any>, signatureHash: string) {
    const eventType = String(rawPayload?.event || '');
    const reference = getEventReference(rawPayload);
    const data = rawPayload?.data || {};
    const eventId = rawPayload?.id ? String(rawPayload.id) : data?.id ? `${eventType}:${String(data.id)}` : null;

    const { event, duplicate } = await createWebhookEvent({
      eventId,
      reference,
      eventType: eventType || 'unknown',
      signatureHash,
      payload: rawPayload,
    });

    if (duplicate) return { success: true, duplicate: true };

    try {
      let result: Record<string, unknown> = { ignored: true };
      if (eventType === 'charge.success' && reference) {
        const finalized = await this.finalizeReference(reference);
        result = finalized.success ? { processed: true, engagement_created: Boolean((finalized as any).engagement?.id), reference } : finalized;
      }
      if (event) await markWebhookEventProcessed(event.id, result.ignored ? 'ignored' : 'processed');
      return { success: true, ...result };
    } catch (error: any) {
      if (event) await markWebhookEventProcessed(event.id, 'failed', error?.message || 'Webhook processing failed');
      throw error;
    }
  }
}

export default new RecoverOnceService();
