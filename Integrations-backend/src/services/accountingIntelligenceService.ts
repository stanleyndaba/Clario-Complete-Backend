import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';

export type AccountingProvider = 'quickbooks' | 'xero';
export type AccountingEvidenceState = 'available' | 'no_data' | 'unavailable';
export type CostConfidenceLevel = 'authoritative' | 'high' | 'medium' | 'low' | 'unresolved';
export type MappingMethod = 'exact_item_code' | 'exact_asin' | 'deterministic_identifier' | 'fuzzy_suggestion' | 'seller_manual';

export interface CanonicalAccountingArtifact {
  id: string;
  tenantId: string;
  provider: AccountingProvider;
  providerRecordId: string;
  recordType: string;
  transactionDate: Date | null;
  amount: number;
  currency: string | null;
  reference: string | null;
  description: string | null;
  counterpartyName: string | null;
  sourceId: string | null;
}

export interface CanonicalAccountingResult {
  state: AccountingEvidenceState;
  artifacts: CanonicalAccountingArtifact[];
  reason?: string;
  sourceId?: string;
}

interface AccountingRecordRow {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: AccountingProvider;
  provider_record_id: string;
  record_type: string;
  transaction_date: string | null;
  total_amount: number | string | null;
  currency: string | null;
  reference_number: string | null;
  memo: string | null;
  supplier_name: string | null;
  source_id: string | null;
  line_items: unknown;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
}

function normalizedText(value: unknown): string {
  return String(value || '').trim();
}

function extractLineItemCode(item: Record<string, unknown>): string | null {
  const candidate = item.itemCode || item.item_code || item.sku || item.itemId || item.item_id || item.code;
  const value = normalizedText(candidate);
  return value || null;
}

function extractLineItemName(item: Record<string, unknown>): string | null {
  const candidate = item.description || item.name || item.itemName || item.item_name;
  const value = normalizedText(candidate);
  return value || null;
}

function extractQuantity(item: Record<string, unknown>): number | null {
  const value = asNumber(item.quantity ?? item.qty ?? item.Qty);
  return value && value > 0 ? value : null;
}

function extractLineAmount(item: Record<string, unknown>): number | null {
  return asNumber(item.totalAmount ?? item.lineAmount ?? item.amount ?? item.Amount);
}

function classifyLineItem(item: Record<string, unknown>): 'inventory' | 'freight' | 'tax' | 'service' | 'overhead' | 'unrelated' | 'unknown' {
  const text = `${extractLineItemCode(item) || ''} ${extractLineItemName(item) || ''}`.toLowerCase();
  if (!text) return 'unknown';
  if (/freight|shipping|delivery|courier|transport/.test(text)) return 'freight';
  if (/vat|tax|duty|customs/.test(text)) return 'tax';
  if (/consult|service|subscription|software|legal|accounting/.test(text)) return 'service';
  if (/rent|utility|insurance|marketing|advertis/.test(text)) return 'overhead';
  if (/inventory|stock|product|sku|unit|item/.test(text)) return 'inventory';
  return 'unknown';
}

function confidenceForMapping(method: MappingMethod, status: string): CostConfidenceLevel {
  if (status !== 'confirmed') return 'unresolved';
  if (method === 'seller_manual') return 'authoritative';
  if (method === 'exact_item_code' || method === 'exact_asin') return 'high';
  if (method === 'deterministic_identifier') return 'medium';
  return 'low';
}

/**
 * Canonical accounting intelligence boundary.
 *
 * This service intentionally never calls a provider API. Provider adapters write
 * Phase-0 truth into accounting_records; all recovery, mapping, and cost logic
 * reads that canonical store so provider outages cannot fabricate business truth.
 */
export class AccountingIntelligenceService {
  private readonly db = supabaseAdmin || supabase;

  async getCanonicalArtifacts(
    tenantId: string,
    provider: AccountingProvider,
    userId?: string
  ): Promise<CanonicalAccountingResult> {
    let sourceQuery = this.db
      .from('evidence_sources')
      .select('id, accounting_read_status, accounting_record_count')
      .eq('tenant_id', tenantId)
      .eq('provider', provider);
    if (userId) sourceQuery = sourceQuery.eq('user_id', convertUserIdToUuid(userId));
    const { data: source, error: sourceError } = await sourceQuery.maybeSingle();

    if (sourceError) {
      logger.error('Unable to read accounting source health', { tenantId, provider, error: sourceError.message });
      return { state: 'unavailable', artifacts: [], reason: 'ACCOUNTING_EVIDENCE_UNAVAILABLE' };
    }

    const sourceStatus = String(source?.accounting_read_status || '').trim();
    if (!source || ['failed', 'reconnect_required', 'pending', ''].includes(sourceStatus)) {
      return {
        state: 'unavailable',
        artifacts: [],
        sourceId: source?.id,
        reason: sourceStatus === 'reconnect_required' ? 'ACCOUNTING_RECONNECT_REQUIRED' : 'ACCOUNTING_EVIDENCE_UNAVAILABLE'
      };
    }

    if (sourceStatus === 'no_data') {
      return { state: 'no_data', artifacts: [], sourceId: source.id, reason: 'ACCOUNTING_EVIDENCE_NO_DATA' };
    }

    const { data, error } = await this.db
      .from('accounting_records')
      .select('id, tenant_id, user_id, provider, provider_record_id, record_type, transaction_date, total_amount, currency, reference_number, memo, supplier_name, source_id, line_items')
      .eq('tenant_id', tenantId)
      .eq('provider', provider)
      .eq('source_id', source.id)
      .order('transaction_date', { ascending: false });

    if (error) {
      logger.error('Unable to read canonical accounting evidence', { tenantId, provider, error: error.message });
      return { state: 'unavailable', artifacts: [], sourceId: source.id, reason: 'ACCOUNTING_EVIDENCE_UNAVAILABLE' };
    }

    const artifacts = ((data || []) as AccountingRecordRow[]).map((record) => ({
      id: record.id,
      tenantId: record.tenant_id,
      provider: record.provider,
      providerRecordId: record.provider_record_id,
      recordType: record.record_type,
      transactionDate: record.transaction_date ? new Date(record.transaction_date) : null,
      amount: asNumber(record.total_amount) || 0,
      currency: record.currency,
      reference: record.reference_number,
      description: record.memo,
      counterpartyName: record.supplier_name,
      sourceId: record.source_id
    }));

    if (!artifacts.length) {
      return { state: 'no_data', artifacts: [], sourceId: source.id, reason: 'ACCOUNTING_EVIDENCE_NO_DATA' };
    }

    return { state: 'available', artifacts, sourceId: source.id };
  }

  /**
   * Converts persisted accounting rows into evidence rows. This is idempotent and
   * preserves the original line item as provenance rather than mutating raw truth.
   */
  async materializeEvidenceForRecord(record: AccountingRecordRow): Promise<number> {
    const lines = asArray(record.line_items);
    const evidenceLines = lines.length ? lines : [{}];
    const payload = evidenceLines.map((line, lineItemIndex) => ({
      tenant_id: record.tenant_id,
      accounting_record_id: record.id,
      source_id: record.source_id,
      provider: record.provider,
      provider_record_id: record.provider_record_id,
      provider_record_type: record.record_type,
      supplier_name: record.supplier_name,
      reference_number: record.reference_number,
      transaction_date: record.transaction_date,
      currency: record.currency,
      total_amount: extractLineAmount(line) ?? asNumber(record.total_amount),
      line_item_index: lineItemIndex,
      line_item_reference: extractLineItemCode(line),
      line_item: line,
      document_available: false,
      provenance: {
        accounting_record_id: record.id,
        provider: record.provider,
        provider_record_id: record.provider_record_id,
        source_id: record.source_id,
        synchronized_from: 'accounting_records'
      }
    }));

    const { error } = await this.db
      .from('accounting_evidence')
      .upsert(payload, { onConflict: 'accounting_record_id,line_item_index' });
    if (error) throw new Error(`ACCOUNTING_EVIDENCE_MATERIALIZE_FAILED:${error.message}`);
    return payload.length;
  }

  async materializeEvidenceForProvider(tenantId: string, provider: AccountingProvider): Promise<number> {
    const { data, error } = await this.db
      .from('accounting_records')
      .select('id, tenant_id, user_id, provider, provider_record_id, record_type, transaction_date, total_amount, currency, reference_number, memo, supplier_name, source_id, line_items')
      .eq('tenant_id', tenantId)
      .eq('provider', provider);
    if (error) throw new Error(`ACCOUNTING_RECORD_READ_FAILED:${error.message}`);

    let count = 0;
    for (const record of (data || []) as AccountingRecordRow[]) {
      count += await this.materializeEvidenceForRecord(record);
    }
    return count;
  }

  async listMappingCandidates(tenantId: string, provider?: AccountingProvider): Promise<Array<Record<string, unknown>>> {
    let query = this.db
      .from('accounting_evidence')
      .select('id, provider, provider_record_id, provider_record_type, supplier_name, reference_number, transaction_date, currency, total_amount, line_item_index, line_item_reference, line_item, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'available')
      .order('transaction_date', { ascending: false })
      .limit(500);
    if (provider) query = query.eq('provider', provider);
    const { data, error } = await query;
    if (error) throw new Error(`ACCOUNTING_EVIDENCE_READ_FAILED:${error.message}`);

    const evidence = data || [];
    const evidenceIds = evidence.map((row: any) => row.id);
    const { data: mappings, error: mappingError } = evidenceIds.length
      ? await this.db.from('accounting_sku_mappings').select('*').eq('tenant_id', tenantId).in('evidence_id', evidenceIds).order('version', { ascending: false })
      : { data: [], error: null };
    if (mappingError) throw new Error(`ACCOUNTING_MAPPING_READ_FAILED:${mappingError.message}`);

    const latestByEvidence = new Map<string, any>();
    for (const mapping of mappings || []) {
      if (!latestByEvidence.has(mapping.evidence_id)) latestByEvidence.set(mapping.evidence_id, mapping);
    }

    return evidence.map((row: any) => {
      const line = (row.line_item || {}) as Record<string, unknown>;
      const existing = latestByEvidence.get(row.id);
      return {
        evidenceId: row.id,
        provider: row.provider,
        providerRecordId: row.provider_record_id,
        supplierName: row.supplier_name,
        referenceNumber: row.reference_number,
        transactionDate: row.transaction_date,
        currency: row.currency,
        totalAmount: row.total_amount,
        lineItemCode: row.line_item_reference || extractLineItemCode(line),
        lineItemName: extractLineItemName(line),
        quantity: extractQuantity(line),
        classification: classifyLineItem(line),
        mapping: existing ? this.safeMapping(existing) : null
      };
    });
  }

  async createSellerMapping(input: {
    tenantId: string;
    actorUserId: string;
    evidenceId: string;
    sku: string;
    asin?: string | null;
    fnsku?: string | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }): Promise<Record<string, unknown>> {
    const { data: evidence, error: evidenceError } = await this.db
      .from('accounting_evidence')
      .select('id, tenant_id, provider, line_item_reference, line_item')
      .eq('id', input.evidenceId)
      .eq('tenant_id', input.tenantId)
      .maybeSingle();
    if (evidenceError || !evidence) throw new Error('ACCOUNTING_EVIDENCE_NOT_FOUND');

    const { data: prior } = await this.db
      .from('accounting_sku_mappings')
      .select('id, version')
      .eq('tenant_id', input.tenantId)
      .eq('evidence_id', input.evidenceId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prior?.id) {
      const { error: supersedeError } = await this.db
        .from('accounting_sku_mappings')
        .update({ status: 'superseded', updated_at: new Date().toISOString() })
        .eq('id', prior.id)
        .eq('tenant_id', input.tenantId);
      if (supersedeError) throw new Error(`ACCOUNTING_MAPPING_SUPERSEDE_FAILED:${supersedeError.message}`);
    }

    const line = (evidence.line_item || {}) as Record<string, unknown>;
    const payload = {
      tenant_id: input.tenantId,
      provider: evidence.provider,
      provider_item_code: evidence.line_item_reference || extractLineItemCode(line),
      provider_item_name: extractLineItemName(line),
      sku: input.sku.trim(),
      asin: input.asin || null,
      fnsku: input.fnsku || null,
      mapping_method: 'seller_manual' as MappingMethod,
      confidence_level: 'authoritative' as CostConfidenceLevel,
      confidence_score: 1,
      status: 'confirmed',
      effective_from: input.effectiveFrom || null,
      effective_to: input.effectiveTo || null,
      seller_override: true,
      created_by: input.actorUserId,
      reviewed_by: input.actorUserId,
      reviewed_at: new Date().toISOString(),
      evidence_id: input.evidenceId,
      version: Number(prior?.version || 0) + 1,
      supersedes_mapping_id: prior?.id || null
    };

    const { data: mapping, error } = await this.db.from('accounting_sku_mappings').insert(payload).select('*').single();
    if (error || !mapping) throw new Error(`ACCOUNTING_MAPPING_CREATE_FAILED:${error?.message || 'unknown'}`);

    await this.deriveProductCostFromMapping(input.tenantId, mapping.id);
    return this.safeMapping(mapping);
  }

  async deriveProductCostFromMapping(tenantId: string, mappingId: string): Promise<{ created: boolean; reason?: string }> {
    const { data: mapping, error: mappingError } = await this.db
      .from('accounting_sku_mappings')
      .select('*, accounting_evidence(*)')
      .eq('id', mappingId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (mappingError || !mapping) throw new Error('ACCOUNTING_MAPPING_NOT_FOUND');
    if (mapping.status !== 'confirmed') return { created: false, reason: 'MAPPING_NOT_CONFIRMED' };

    const evidence = mapping.accounting_evidence as any;
    const line = (evidence?.line_item || {}) as Record<string, unknown>;
    const quantity = extractQuantity(line);
    const total = extractLineAmount(line) ?? asNumber(evidence?.total_amount);
    const classification = classifyLineItem(line);
    if (!quantity || !total || total < 0) return { created: false, reason: 'QUANTITY_OR_AMOUNT_UNRESOLVED' };
    if (classification !== 'inventory') return { created: false, reason: `NON_INVENTORY_${classification.toUpperCase()}` };

    const unitCost = total / quantity;
    const sourceReference = `${evidence.provider}:${evidence.provider_record_id}:${evidence.line_item_index ?? 0}`;
    const confidenceLevel = confidenceForMapping(mapping.mapping_method as MappingMethod, mapping.status);
    const costPayload = {
      seller_id: String(mapping.created_by || ''),
      tenant_id: tenantId,
      sku: mapping.sku,
      asin: mapping.asin || null,
      fnsku: mapping.fnsku || null,
      product_name: extractLineItemName(line),
      cogs_value: unitCost,
      cost_currency: evidence.currency || 'USD',
      source: 'accounting_integration',
      source_reference: sourceReference,
      effective_date_start: mapping.effective_from || evidence.transaction_date || null,
      effective_date_end: mapping.effective_to || null,
      confidence_score: mapping.confidence_score,
      created_by: mapping.created_by || null,
      accounting_evidence_id: evidence.id,
      accounting_mapping_id: mapping.id,
      cost_classification: classification,
      confidence_level: confidenceLevel,
      source_provenance: {
        provider: evidence.provider,
        provider_record_id: evidence.provider_record_id,
        accounting_evidence_id: evidence.id,
        accounting_mapping_id: mapping.id,
        quantity,
        line_item_index: evidence.line_item_index
      },
      source_quantity: quantity,
      pack_size: 1,
      is_authoritative: confidenceLevel === 'authoritative'
    };

    const { data: existing, error: existingError } = await this.db
      .from('product_costs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('source_reference', sourceReference)
      .maybeSingle();
    if (existingError) throw new Error(`PRODUCT_COST_LOOKUP_FAILED:${existingError.message}`);

    const result = existing?.id
      ? await this.db.from('product_costs').update({ ...costPayload, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('tenant_id', tenantId)
      : await this.db.from('product_costs').insert(costPayload);
    if (result.error) throw new Error(`PRODUCT_COST_DERIVATION_FAILED:${result.error.message}`);
    return { created: true };
  }

  async getEffectiveProductCost(tenantId: string, sku: string, at: Date): Promise<Record<string, unknown> | null> {
    const date = at.toISOString().slice(0, 10);
    const { data, error } = await this.db
      .from('product_costs')
      .select('id, sku, asin, fnsku, cogs_value, cost_currency, source, effective_date_start, effective_date_end, confidence_score, confidence_level, is_authoritative, source_provenance, accounting_evidence_id, accounting_mapping_id')
      .eq('tenant_id', tenantId)
      .eq('sku', sku)
      .lte('effective_date_start', date)
      .or(`effective_date_end.is.null,effective_date_end.gte.${date}`)
      .order('is_authoritative', { ascending: false })
      .order('confidence_score', { ascending: false })
      .order('effective_date_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`EFFECTIVE_PRODUCT_COST_LOOKUP_FAILED:${error.message}`);
    return data || null;
  }

  async getCoverage(tenantId: string, provider?: AccountingProvider): Promise<Record<string, unknown>> {
    const providerFilter = (query: any) => provider ? query.eq('provider', provider) : query;
    const [{ count: recordCount, error: recordError }, { count: evidenceCount, error: evidenceError }, { count: mappedCount, error: mappedError }, { count: authoritativeCostCount, error: costError }, { data: sources, error: sourceError }] = await Promise.all([
      providerFilter(this.db.from('accounting_records').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)),
      providerFilter(this.db.from('accounting_evidence').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)),
      providerFilter(this.db.from('accounting_sku_mappings').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'confirmed')),
      this.db.from('product_costs').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('source', 'accounting_integration').eq('is_authoritative', true),
      providerFilter(this.db.from('evidence_sources').select('provider, accounting_read_status, accounting_last_read_at, accounting_record_count, accounting_organisation_id, accounting_organisation_name').eq('tenant_id', tenantId).in('provider', ['quickbooks', 'xero']))
    ]);
    const error = recordError || evidenceError || mappedError || costError || sourceError;
    if (error) throw new Error(`ACCOUNTING_COVERAGE_READ_FAILED:${error.message}`);
    return {
      records: recordCount || 0,
      evidence: evidenceCount || 0,
      confirmedMappings: mappedCount || 0,
      authoritativeCosts: authoritativeCostCount || 0,
      sources: sources || []
    };
  }

  private safeMapping(mapping: any): Record<string, unknown> {
    return {
      id: mapping.id,
      provider: mapping.provider,
      providerItemCode: mapping.provider_item_code,
      providerItemName: mapping.provider_item_name,
      sku: mapping.sku,
      asin: mapping.asin,
      fnsku: mapping.fnsku,
      mappingMethod: mapping.mapping_method,
      confidenceLevel: mapping.confidence_level,
      confidenceScore: mapping.confidence_score,
      status: mapping.status,
      effectiveFrom: mapping.effective_from,
      effectiveTo: mapping.effective_to,
      sellerOverride: mapping.seller_override,
      reviewedAt: mapping.reviewed_at,
      evidenceId: mapping.evidence_id,
      version: mapping.version,
      createdAt: mapping.created_at,
      updatedAt: mapping.updated_at
    };
  }
}

export const accountingIntelligenceService = new AccountingIntelligenceService();
