import { supabaseAdmin } from '../database/supabaseClient';

type FinancialContext = {
  input_id: string;
  dispute_case_id: string | null;
  detection_result_id: string | null;
  tenant_id: string;
  store_id: string | null;
  seller_id: string | null;
  case_number: string | null;
  claim_number: string | null;
  amazon_case_id: string | null;
  order_id: string | null;
  sku: string | null;
  asin: string | null;
  currency: string;
  requested_amount: number | null;
  approved_amount: number | null;
};

type FinancialTruthEvent = {
  event_id: string;
  event_type: string | null;
  event_subtype: string | null;
  amount: number;
  currency: string;
  event_date: string | null;
  reference_id: string | null;
  settlement_id: string | null;
  payout_batch_id: string | null;
  amazon_event_id: string | null;
  amazon_order_id: string | null;
  sku: string | null;
  asin: string | null;
  source: string | null;
  raw_payload: Record<string, any> | null;
  linked_detection_result_id: string | null;
  linked_dispute_case_id: string | null;
};

type FinancialTruthSummary = {
  input_id: string;
  dispute_case_id: string | null;
  detection_result_id: string | null;
  requested_amount: number | null;
  approved_amount: number | null;
  verified_paid_amount: number;
  outstanding_amount: number | null;
  variance_amount: number | null;
  payout_status: 'not_paid' | 'partially_paid' | 'paid';
  financial_event_count: number;
  reimbursement_event_count: number;
  settlement_event_count: number;
  latest_event_date: string | null;
  proof_of_payment: {
    amount: number;
    currency: string;
    event_date: string | null;
    reference_id: string | null;
    settlement_id: string | null;
    payout_batch_id: string | null;
    source: string | null;
  } | null;
  source_types: string[];
};

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function toOptionalAmount(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function dedupeById<T extends { id?: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const row of rows) {
    const id = String(row?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(row);
  }
  return output;
}

function normalizeEventType(value: unknown): string {
  return normalize(value).replace(/\s+/g, '_');
}

function isReimbursementEvent(row: any): boolean {
  const eventType = normalizeEventType(row?.event_type);
  return eventType.includes('reimbursement');
}

function isSettlementEvent(row: any): boolean {
  const eventType = normalizeEventType(row?.event_type);
  return eventType.includes('settlement') || row?.is_payout_event === true;
}

function extractComparableSku(row: any): string {
  return normalize(row?.sku || row?.amazon_sku || row?.raw_payload?.SellerSKU || row?.raw_payload?.seller_sku);
}

function extractComparableAsin(row: any): string {
  return normalize(row?.asin || row?.raw_payload?.ASIN || row?.raw_payload?.asin);
}

function buildReferenceSet(context: FinancialContext): Set<string> {
  return new Set(
    [
      context.dispute_case_id,
      context.detection_result_id,
      context.case_number,
      context.claim_number,
      context.amazon_case_id,
      context.order_id
    ]
      .map((value) => normalize(value))
      .filter(Boolean)
  );
}

function isMissingColumnError(error?: any): boolean {
  if (!error) return false;
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  return String(error.code || '') === '42703' ||
    String(error.code || '') === 'PGRST204' ||
    message.includes('does not exist') ||
    message.includes('could not find');
}

function parseMissingColumn(error?: any): string | null {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  const quoted = message.match(/'([^']+)' column/i);
  if (quoted?.[1]) return quoted[1];
  const doubleQuoted = message.match(/column\s+(?:[a-z0-9_]+\.)?"([^"]+)"/i);
  if (doubleQuoted?.[1]) return doubleQuoted[1];
  const unquoted = message.match(/column\s+(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s+does not exist/i);
  if (unquoted?.[1]) return unquoted[1];
  return null;
}

async function selectRowsWithSchemaFallback(
  table: string,
  columns: string[],
  configure: (query: any) => any
): Promise<any[]> {
  const omitted = new Set<string>();
  const client = supabaseAdmin as any;

  for (let attempt = 0; attempt <= columns.length; attempt += 1) {
    const selectedColumns = columns.filter((column) => !omitted.has(column));
    const { data, error } = await configure(
      client
        .from(table)
        .select(selectedColumns.join(', '))
    );

    if (!error) return data || [];

    const missingColumn = parseMissingColumn(error);
    if (missingColumn && columns.includes(missingColumn)) {
      omitted.add(missingColumn);
      continue;
    }

    throw error;
  }

  return [];
}

class RecoveryFinancialTruthService {
  private async loadContexts(tenantId: string, caseIds: string[]): Promise<FinancialContext[]> {
    const requestedIds = Array.from(new Set(caseIds.map((value) => String(value || '').trim()).filter(Boolean)));
    if (!requestedIds.length) {
      return [];
    }

    const disputeColumns = [
      'id',
      'detection_result_id',
      'tenant_id',
      'store_id',
      'seller_id',
      'case_number',
      'claim_id',
      'amazon_case_id',
      'order_id',
      'sku',
      'asin',
      'currency',
      'claim_amount',
      'approved_amount'
    ];
    const detectionColumns = [
      'id',
      'tenant_id',
      'store_id',
      'seller_id',
      'order_id',
      'sku',
      'asin',
      'currency',
      'estimated_value'
    ];

    const [disputeByIdRows, disputeByDetectionRows, directDetectionsRows] = await Promise.all([
      selectRowsWithSchemaFallback('dispute_cases', disputeColumns, (query) =>
        query.eq('tenant_id', tenantId).in('id', requestedIds)
      ),
      selectRowsWithSchemaFallback('dispute_cases', disputeColumns, (query) =>
        query.eq('tenant_id', tenantId).in('detection_result_id', requestedIds)
      ),
      selectRowsWithSchemaFallback('detection_results', detectionColumns, (query) =>
        query.eq('tenant_id', tenantId).in('id', requestedIds)
      )
    ]);

    const disputeRows = dedupeById([...disputeByIdRows, ...disputeByDetectionRows]);
    const directDetections = dedupeById(directDetectionsRows as any[]) as any[];

    const linkedDetectionIds = disputeRows
      .map((row: any) => String(row?.detection_result_id || '').trim())
      .filter(Boolean);

    const missingDetectionIds = linkedDetectionIds.filter((id) => !directDetections.some((row: any) => String(row?.id || '').trim() === id));
    const linkedDetections = missingDetectionIds.length
      ? await selectRowsWithSchemaFallback('detection_results', detectionColumns, (query) =>
          query.eq('tenant_id', tenantId).in('id', missingDetectionIds)
        )
      : [];

    const detectionById = new Map<string, any>();
    for (const row of [...directDetections, ...(dedupeById(linkedDetections as any[]) as any[])]) {
      detectionById.set(String(row.id), row);
    }

    const contexts: FinancialContext[] = [];

    for (const record of disputeRows) {
      const detection = record.detection_result_id ? detectionById.get(String(record.detection_result_id)) : null;
      contexts.push({
        input_id: requestedIds.includes(String(record.id)) ? String(record.id) : String(record.detection_result_id || record.id),
        dispute_case_id: String(record.id),
        detection_result_id: record.detection_result_id || null,
        tenant_id: tenantId,
        store_id: record.store_id || detection?.store_id || null,
        seller_id: record.seller_id || detection?.seller_id || null,
        case_number: record.case_number || null,
        claim_number: record.claim_id || null,
        amazon_case_id: record.amazon_case_id || null,
        order_id: record.order_id || detection?.order_id || null,
        sku: record.sku || detection?.sku || null,
        asin: record.asin || detection?.asin || null,
        currency: record.currency || detection?.currency || 'USD',
        requested_amount: toOptionalAmount(record.claim_amount),
        approved_amount: toOptionalAmount(record.approved_amount)
      });
    }

    for (const detection of directDetections) {
      const alreadyCovered = contexts.some((context) => context.detection_result_id === detection.id || context.dispute_case_id === detection.id);
      if (alreadyCovered) continue;
      contexts.push({
        input_id: String(detection.id),
        dispute_case_id: null,
        detection_result_id: String(detection.id),
        tenant_id: tenantId,
        store_id: detection.store_id || null,
        seller_id: detection.seller_id || null,
        case_number: null,
        claim_number: null,
        amazon_case_id: null,
        order_id: detection.order_id || null,
        sku: detection.sku || null,
        asin: detection.asin || null,
        currency: detection.currency || 'USD',
        requested_amount: toOptionalAmount(detection.estimated_value),
        approved_amount: null
      });
    }

    return contexts;
  }

  private async queryFinancialEvents(tenantId: string, field: string, values: string[]): Promise<any[]> {
    const normalizedValues = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
    if (!normalizedValues.length) return [];
    const client = supabaseAdmin as any;
    const { data, error } = await client
      .from('financial_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .in(field, normalizedValues);
    if (error && isMissingColumnError(error)) return [];
    if (error) throw error;
    return data || [];
  }

  private async loadCandidateEvents(tenantId: string, contexts: FinancialContext[], explicitStoreId?: string | null): Promise<any[]> {
    const sellerIds = Array.from(new Set(contexts.map((context) => String(context.seller_id || '').trim()).filter(Boolean)));
    const orderIds = Array.from(new Set(contexts.map((context) => String(context.order_id || '').trim()).filter(Boolean)));
    const referenceIds = Array.from(
      new Set(
        contexts.flatMap((context) => [context.case_number, context.claim_number, context.amazon_case_id].map((value) => String(value || '').trim()).filter(Boolean))
      )
    );
    const skus = Array.from(new Set(contexts.map((context) => String(context.sku || '').trim()).filter(Boolean)));
    const asins = Array.from(new Set(contexts.map((context) => String(context.asin || '').trim()).filter(Boolean)));

    const queryResults = await Promise.all([
      this.queryFinancialEvents(tenantId, 'seller_id', sellerIds),
      this.queryFinancialEvents(tenantId, 'amazon_order_id', orderIds),
      this.queryFinancialEvents(tenantId, 'reference_id', referenceIds),
      this.queryFinancialEvents(tenantId, 'sku', skus),
      this.queryFinancialEvents(tenantId, 'amazon_sku', skus),
      this.queryFinancialEvents(tenantId, 'asin', asins)
    ]);

    const events = dedupeById(queryResults.flat());
    if (!explicitStoreId) {
      return events;
    }

    return events.filter((row: any) => {
      const eventStoreId = String(row?.store_id || '').trim();
      return !eventStoreId || eventStoreId === explicitStoreId;
    });
  }

  private matchEventToContext(event: any, context: FinancialContext): boolean {
    if (normalize(event?.tenant_id) !== normalize(context.tenant_id)) {
      return false;
    }

    if (context.seller_id && event?.seller_id && normalize(event.seller_id) !== normalize(context.seller_id)) {
      return false;
    }

    if (context.store_id && event?.store_id && normalize(event.store_id) !== normalize(context.store_id)) {
      return false;
    }

    const references = buildReferenceSet(context);
    let score = 0;

    if (context.order_id && normalize(event?.amazon_order_id) === normalize(context.order_id)) {
      score += 6;
    }

    if (context.sku && extractComparableSku(event) === normalize(context.sku)) {
      score += 3;
    }

    if (context.asin && extractComparableAsin(event) === normalize(context.asin)) {
      score += 3;
    }

    if (references.has(normalize(event?.reference_id))) {
      score += 4;
    }

    if (references.has(normalize(event?.amazon_event_id))) {
      score += 4;
    }

    return score >= 3;
  }

  private toTruthEvent(event: any, context: FinancialContext): FinancialTruthEvent {
    return {
      event_id: String(event.id),
      event_type: event.event_type || null,
      event_subtype: event.event_subtype || null,
      amount: toAmount(event.amount),
      currency: event.currency || context.currency || 'USD',
      event_date: event.event_date || null,
      reference_id: event.reference_id || null,
      settlement_id: event.settlement_id || null,
      payout_batch_id: event.payout_batch_id || null,
      amazon_event_id: event.amazon_event_id || null,
      amazon_order_id: event.amazon_order_id || null,
      sku: event.sku || event.amazon_sku || null,
      asin: event.asin || null,
      source: event.source || null,
      raw_payload: event.raw_payload || null,
      linked_detection_result_id: context.detection_result_id,
      linked_dispute_case_id: context.dispute_case_id
    };
  }

  private buildSummary(context: FinancialContext, events: FinancialTruthEvent[]): FinancialTruthSummary {
    const sortedEvents = [...events].sort((left, right) => new Date(right.event_date || 0).getTime() - new Date(left.event_date || 0).getTime());
    const reimbursementEvents = sortedEvents.filter((event) => isReimbursementEvent(event) && event.amount > 0);
    const settlementEvents = sortedEvents.filter((event) => isSettlementEvent(event));
    const verifiedPaidAmount = Number(reimbursementEvents.reduce((sum, event) => sum + toAmount(event.amount), 0).toFixed(2));
    const targetAmount = context.approved_amount ?? context.requested_amount;
    const outstandingAmount = targetAmount == null ? null : Number(Math.max(targetAmount - verifiedPaidAmount, 0).toFixed(2));
    const varianceAmount = targetAmount == null ? null : Number((verifiedPaidAmount - targetAmount).toFixed(2));
    const payoutStatus: 'not_paid' | 'partially_paid' | 'paid' =
      verifiedPaidAmount <= 0
        ? 'not_paid'
        : targetAmount != null && verifiedPaidAmount + 0.01 < targetAmount
          ? 'partially_paid'
          : 'paid';

    const proofEvent = reimbursementEvents.find((event) => event.settlement_id || event.payout_batch_id)
      || reimbursementEvents[0]
      || settlementEvents.find((event) => event.settlement_id || event.payout_batch_id)
      || settlementEvents[0]
      || null;

    return {
      input_id: context.input_id,
      dispute_case_id: context.dispute_case_id,
      detection_result_id: context.detection_result_id,
      requested_amount: context.requested_amount,
      approved_amount: context.approved_amount,
      verified_paid_amount: verifiedPaidAmount,
      outstanding_amount: outstandingAmount,
      variance_amount: varianceAmount,
      payout_status: payoutStatus,
      financial_event_count: sortedEvents.length,
      reimbursement_event_count: reimbursementEvents.length,
      settlement_event_count: settlementEvents.length,
      latest_event_date: sortedEvents[0]?.event_date || null,
      proof_of_payment: proofEvent
        ? {
            amount: proofEvent.amount,
            currency: proofEvent.currency,
            event_date: proofEvent.event_date,
            reference_id: proofEvent.reference_id,
            settlement_id: proofEvent.settlement_id,
            payout_batch_id: proofEvent.payout_batch_id,
            source: proofEvent.source
          }
        : null,
      source_types: Array.from(new Set(sortedEvents.map((event) => String(event.source || '').trim()).filter(Boolean)))
    };
  }

  async getFinancialTruth(params: { tenantId: string; caseIds: string[]; storeId?: string | null }): Promise<{
    summaries: FinancialTruthSummary[];
    eventsByInputId: Record<string, FinancialTruthEvent[]>;
  }> {
    const contexts = await this.loadContexts(params.tenantId, params.caseIds);
    if (!contexts.length) {
      return { summaries: [], eventsByInputId: {} };
    }

    const candidateEvents = await this.loadCandidateEvents(params.tenantId, contexts, params.storeId || null);
    const eventsByInputId: Record<string, FinancialTruthEvent[]> = {};
    const summaries: FinancialTruthSummary[] = [];

    for (const context of contexts) {
      const matchedEvents = candidateEvents
        .filter((event) => this.matchEventToContext(event, context))
        .map((event) => this.toTruthEvent(event, context))
        .sort((left, right) => new Date(right.event_date || 0).getTime() - new Date(left.event_date || 0).getTime());

      eventsByInputId[context.input_id] = matchedEvents;
      summaries.push(this.buildSummary(context, matchedEvents));
    }

    return { summaries, eventsByInputId };
  }
}

export const recoveryFinancialTruthService = new RecoveryFinancialTruthService();
export default recoveryFinancialTruthService;
