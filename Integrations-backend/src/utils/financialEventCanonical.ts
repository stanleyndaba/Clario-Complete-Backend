import crypto from 'crypto';

export type FinancialEventSource = 'sp_api' | 'csv_upload';

export interface CanonicalFinancialClassification {
  eventType: string;
  eventSubtype: string;
  referenceType: string;
  isPayoutEvent: boolean;
}

export interface CanonicalFinancialEventSeed {
  sellerId: string;
  tenantId: string;
  storeId?: string | null;
  syncId?: string | null;
  source: FinancialEventSource;
  eventType: string;
  eventSubtype?: string | null;
  amount: number;
  currency?: string | null;
  eventDate?: string | Date | null;
  referenceId?: string | null;
  referenceType?: string | null;
  settlementId?: string | null;
  payoutBatchId?: string | null;
  amazonEventId?: string | null;
  amazonOrderId?: string | null;
  amazonSku?: string | null;
  sku?: string | null;
  asin?: string | null;
  description?: string | null;
  rawPayload?: any;
  metadata?: Record<string, any>;
  isPayoutEvent?: boolean;
}

function normalizeToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

export function parseCurrencyAmount(raw: any): { amount: number; currency: string } {
  if (raw && typeof raw === 'object') {
    if (raw.CurrencyAmount !== undefined || raw.currencyAmount !== undefined) {
      return {
        amount: Number(raw.CurrencyAmount ?? raw.currencyAmount ?? 0) || 0,
        currency: raw.CurrencyCode || raw.currencyCode || 'USD'
      };
    }

    if (raw.amount !== undefined || raw.value !== undefined) {
      return {
        amount: Number(raw.amount ?? raw.value ?? 0) || 0,
        currency: raw.currency || raw.currencyCode || 'USD'
      };
    }
  }

  if (raw === null || raw === undefined || raw === '') {
    return { amount: 0, currency: 'USD' };
  }

  return {
    amount: Number(raw) || 0,
    currency: 'USD'
  };
}

export function toIsoEventDate(value: any): string {
  if (!value) {
    return new Date().toISOString();
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

export function classifyFinancialEventType(rawType: any, description?: any): CanonicalFinancialClassification {
  const normalizedRaw = normalizeToken(String(rawType || description || 'adjustment'));
  const haystack = `${normalizedRaw} ${normalizeToken(description)}`;

  if (haystack.includes('reimburse') || haystack.includes('liquidation') || haystack.includes('compensation')) {
    return {
      eventType: 'reimbursement',
      eventSubtype: normalizedRaw,
      referenceType: 'reimbursement',
      isPayoutEvent: true
    };
  }

  if (haystack.includes('refund') || haystack.includes('chargeback') || haystack.includes('return')) {
    return {
      eventType: 'refund',
      eventSubtype: normalizedRaw,
      referenceType: 'refund',
      isPayoutEvent: false
    };
  }

  if (
    haystack.includes('fee') ||
    haystack.includes('referral') ||
    haystack.includes('storage') ||
    haystack.includes('fulfillment') ||
    haystack.includes('commission') ||
    haystack.includes('service')
  ) {
    return {
      eventType: 'fee',
      eventSubtype: normalizedRaw,
      referenceType: 'fee',
      isPayoutEvent: false
    };
  }

  if (
    haystack.includes('settlement') ||
    haystack.includes('disbursement') ||
    haystack.includes('transfer') ||
    haystack.includes('payment') ||
    haystack.includes('deposit')
  ) {
    return {
      eventType: 'settlement',
      eventSubtype: normalizedRaw,
      referenceType: 'settlement',
      isPayoutEvent: true
    };
  }

  return {
    eventType: normalizedRaw || 'adjustment',
    eventSubtype: normalizedRaw || 'adjustment',
    referenceType: 'financial_event',
    isPayoutEvent: false
  };
}

function buildFallbackAmazonEventId(seed: CanonicalFinancialEventSeed): string {
  const fingerprint = [
    seed.source,
    normalizeToken(seed.eventType),
    normalizeToken(seed.eventSubtype),
    seed.referenceId || seed.settlementId || seed.amazonOrderId || seed.amazonSku || seed.sku || seed.asin || 'unknown',
    Number(seed.amount || 0).toFixed(2),
    toIsoEventDate(seed.eventDate)
  ].join('|');

  return crypto.createHash('sha1').update(fingerprint).digest('hex');
}

export function buildCanonicalFinancialEventRow(seed: CanonicalFinancialEventSeed): any {
  const amount = Number(seed.amount || 0);
  const now = new Date().toISOString();
  const eventType = normalizeToken(seed.eventType);
  const eventSubtype = normalizeToken(seed.eventSubtype || seed.eventType);
  const referenceType = normalizeToken(seed.referenceType || eventType);
  const amazonEventId = seed.amazonEventId || buildFallbackAmazonEventId(seed);
  const rawPayload = seed.rawPayload || {};

  return {
    seller_id: seed.sellerId,
    tenant_id: seed.tenantId,
    store_id: seed.storeId || null,
    sync_id: seed.syncId || null,
    source: seed.source,
    event_type: eventType,
    event_subtype: eventSubtype,
    amount,
    currency: seed.currency || 'USD',
    raw_payload: {
      ...rawPayload,
      _canonical: {
        reference_id: seed.referenceId || null,
        reference_type: referenceType,
        settlement_id: seed.settlementId || null,
        payout_batch_id: seed.payoutBatchId || null,
        amazon_event_id: amazonEventId,
        event_type: eventType,
        event_subtype: eventSubtype,
        is_payout_event: Boolean(seed.isPayoutEvent)
      },
      ...(seed.metadata ? { _metadata: seed.metadata } : {})
    },
    amazon_event_id: amazonEventId,
    amazon_order_id: seed.amazonOrderId || null,
    amazon_sku: seed.amazonSku || seed.sku || null,
    sku: seed.sku || seed.amazonSku || null,
    asin: seed.asin || null,
    description: seed.description || null,
    event_date: toIsoEventDate(seed.eventDate),
    reference_id: seed.referenceId || null,
    reference_type: referenceType,
    settlement_id: seed.settlementId || null,
    payout_batch_id: seed.payoutBatchId || null,
    is_payout_event: Boolean(seed.isPayoutEvent),
    created_at: now,
    updated_at: now
  };
}
