import { supabaseAdmin } from '../../../../../database/supabaseClient';
import logger from '../../../../../utils/logger';

import { resolveTenantId } from './tenantUtils';

export type DetectorUnitValueType = 'COGS' | 'SELLING_PRICE' | 'REIMBURSEMENT_RATE';

export type DetectorUnitValueSource =
    | 'TRANSFER_UNIT_VALUE'
    | 'CURRENT_EVENT_UNIT_VALUE'
    | 'LEDGER_AVERAGE_SALES_PRICE'
    | 'LEDGER_UNIT_COST'
    | 'HISTORICAL_REIMBURSEMENT'
    | 'DEFAULT_FALLBACK';

export interface ValuationCandidate {
    source: DetectorUnitValueSource;
    value: number;
    confidence: number;
    basis: string;
    observedAt?: string | null;
    currency?: string | null;
}

export interface SellerValuationContext {
    bySku: Map<string, ValuationCandidate[]>;
    byFnsku: Map<string, ValuationCandidate[]>;
    byAsin: Map<string, ValuationCandidate[]>;
}

export interface DetectorUnitValueResult {
    value: number;
    source: DetectorUnitValueSource;
    confidence: number;
    basis: string;
    valueType: DetectorUnitValueType;
}

export interface ResolveDetectorUnitValueOptions {
    sku?: string;
    fnsku?: string;
    asin?: string;
    eventDate?: string;
    valueType: DetectorUnitValueType;
    valuationContext?: SellerValuationContext;
    localCandidates?: ValuationCandidate[];
    fallbackValue?: number;
    fallbackBasis?: string;
}

const VALUE_TYPE_PRIORITY: Record<DetectorUnitValueType, DetectorUnitValueSource[]> = {
    REIMBURSEMENT_RATE: [
        'TRANSFER_UNIT_VALUE',
        'CURRENT_EVENT_UNIT_VALUE',
        'LEDGER_AVERAGE_SALES_PRICE',
        'HISTORICAL_REIMBURSEMENT',
        'LEDGER_UNIT_COST',
        'DEFAULT_FALLBACK',
    ],
    SELLING_PRICE: [
        'LEDGER_AVERAGE_SALES_PRICE',
        'TRANSFER_UNIT_VALUE',
        'CURRENT_EVENT_UNIT_VALUE',
        'HISTORICAL_REIMBURSEMENT',
        'LEDGER_UNIT_COST',
        'DEFAULT_FALLBACK',
    ],
    COGS: [
        'LEDGER_UNIT_COST',
        'CURRENT_EVENT_UNIT_VALUE',
        'TRANSFER_UNIT_VALUE',
        'LEDGER_AVERAGE_SALES_PRICE',
        'HISTORICAL_REIMBURSEMENT',
        'DEFAULT_FALLBACK',
    ],
};

const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const valuationContextCache = new Map<string, { expiresAt: number; context: SellerValuationContext }>();

function createEmptyContext(): SellerValuationContext {
    return {
        bySku: new Map<string, ValuationCandidate[]>(),
        byFnsku: new Map<string, ValuationCandidate[]>(),
        byAsin: new Map<string, ValuationCandidate[]>(),
    };
}

function normalizeIdentity(value: string | null | undefined): string {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function addCandidate(index: Map<string, ValuationCandidate[]>, key: string | null | undefined, candidate: ValuationCandidate) {
    const normalized = normalizeIdentity(key);
    if (!normalized || !(candidate.value > 0)) return;
    const bucket = index.get(normalized) || [];
    bucket.push(candidate);
    index.set(normalized, bucket);
}

function sortByRelevance(candidates: ValuationCandidate[], eventDate?: string): ValuationCandidate[] {
    const targetTime = eventDate ? Date.parse(eventDate) : NaN;
    return [...candidates].sort((a, b) => {
        const aTime = a.observedAt ? Date.parse(a.observedAt) : NaN;
        const bTime = b.observedAt ? Date.parse(b.observedAt) : NaN;
        const aDiff = Number.isFinite(targetTime) && Number.isFinite(aTime) ? Math.abs(targetTime - aTime) : Number.POSITIVE_INFINITY;
        const bDiff = Number.isFinite(targetTime) && Number.isFinite(bTime) ? Math.abs(targetTime - bTime) : Number.POSITIVE_INFINITY;
        if (aDiff !== bDiff) return aDiff - bDiff;
        if (a.confidence !== b.confidence) return b.confidence - a.confidence;
        return b.value - a.value;
    });
}

function collectContextCandidates(
    context: SellerValuationContext | undefined,
    identity: Pick<ResolveDetectorUnitValueOptions, 'sku' | 'fnsku' | 'asin'>
): ValuationCandidate[] {
    if (!context) return [];
    const seen = new Set<string>();
    const combined: ValuationCandidate[] = [];
    const buckets = [
        context.byFnsku.get(normalizeIdentity(identity.fnsku)),
        context.bySku.get(normalizeIdentity(identity.sku)),
        context.byAsin.get(normalizeIdentity(identity.asin)),
    ];

    for (const bucket of buckets) {
        for (const candidate of bucket || []) {
            const fingerprint = `${candidate.source}|${candidate.value}|${candidate.basis}|${candidate.observedAt || ''}`;
            if (seen.has(fingerprint)) continue;
            seen.add(fingerprint);
            combined.push(candidate);
        }
    }

    return combined;
}

async function queryTableSafely<T = any>(
    table: string,
    selectColumns: string,
    filters: Record<string, string>
): Promise<T[]> {
    try {
        let query = supabaseAdmin.from(table).select(selectColumns);
        for (const [column, value] of Object.entries(filters)) {
            query = query.eq(column as any, value as any);
        }
        const { data, error } = await query.limit(1000);
        if (error) {
            logger.warn('Valuation context query failed', { table, error: error.message });
            return [];
        }
        return (data || []) as T[];
    } catch (error: any) {
        logger.warn('Valuation context query threw', { table, error: error?.message || 'Unknown error' });
        return [];
    }
}

export async function buildSellerValuationContext(
    sellerId: string,
    syncId?: string
): Promise<SellerValuationContext> {
    const cacheKey = `${sellerId}|${syncId || 'no-sync'}`;
    const cached = valuationContextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.context;
    }

    const tenantId = await resolveTenantId(sellerId);
    const context = createEmptyContext();
    const syncFilters = syncId ? { sync_id: syncId } : {};

    const [transfers, liveLedger, legacyLedger] = await Promise.all([
        queryTableSafely<any>('inventory_transfers', 'sku,fnsku,asin,unit_value,transfer_date,currency', {
            tenant_id: tenantId,
            seller_id: sellerId,
            ...syncFilters,
        }),
        queryTableSafely<any>('inventory_ledger_events', 'sku,fnsku,asin,unit_cost,average_sales_price,event_date', {
            tenant_id: tenantId,
            user_id: sellerId,
            ...syncFilters,
        }),
        queryTableSafely<any>('inventory_ledger', 'sku,fnsku,asin,event_date', {
            tenant_id: tenantId,
            seller_id: sellerId,
        }),
    ]);

    for (const row of transfers) {
        const candidate: ValuationCandidate = {
            source: 'TRANSFER_UNIT_VALUE',
            value: Number(row.unit_value || 0),
            confidence: 0.98,
            basis: `Transfer unit value from ${row.transfer_date || 'unknown date'}`,
            observedAt: row.transfer_date || null,
            currency: row.currency || 'USD',
        };
        addCandidate(context.bySku, row.sku, candidate);
        addCandidate(context.byFnsku, row.fnsku, candidate);
        addCandidate(context.byAsin, row.asin, candidate);
    }

    const ledgerRows = [
        ...liveLedger.map((row) => ({
            sku: row.sku,
            fnsku: row.fnsku,
            asin: row.asin,
            unit_cost: row.unit_cost,
            average_sales_price: row.average_sales_price,
            event_date: row.event_date,
        })),
        ...legacyLedger.map((row) => ({
            sku: row.sku,
            fnsku: row.fnsku,
            asin: row.asin,
            unit_cost: 0,
            average_sales_price: 0,
            event_date: row.event_date,
        })),
    ];

    for (const row of ledgerRows) {
        const averageSalesPrice = Number(row.average_sales_price || 0);
        const unitCost = Number(row.unit_cost || 0);
        if (averageSalesPrice > 0) {
            const candidate: ValuationCandidate = {
                source: 'LEDGER_AVERAGE_SALES_PRICE',
                value: averageSalesPrice,
                confidence: 0.93,
                basis: `Ledger average sales price from ${row.event_date || 'unknown date'}`,
                observedAt: row.event_date || null,
                currency: 'USD',
            };
            addCandidate(context.bySku, row.sku, candidate);
            addCandidate(context.byFnsku, row.fnsku, candidate);
            addCandidate(context.byAsin, row.asin, candidate);
        }
        if (unitCost > 0) {
            const candidate: ValuationCandidate = {
                source: 'LEDGER_UNIT_COST',
                value: unitCost,
                confidence: 0.88,
                basis: `Ledger unit cost from ${row.event_date || 'unknown date'}`,
                observedAt: row.event_date || null,
                currency: 'USD',
            };
            addCandidate(context.bySku, row.sku, candidate);
            addCandidate(context.byFnsku, row.fnsku, candidate);
            addCandidate(context.byAsin, row.asin, candidate);
        }
    }

    valuationContextCache.set(cacheKey, {
        expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS,
        context,
    });

    return context;
}

export function getUnitValue(options: ResolveDetectorUnitValueOptions): DetectorUnitValueResult {
    const candidates = [
        ...(options.localCandidates || []).filter((candidate) => candidate.value > 0),
        ...collectContextCandidates(options.valuationContext, options),
    ];

    for (const source of VALUE_TYPE_PRIORITY[options.valueType]) {
        const matching = candidates.filter((candidate) => candidate.source === source);
        if (matching.length === 0) continue;
        const best = sortByRelevance(matching, options.eventDate)[0];
        return {
            value: best.value,
            source: best.source,
            confidence: best.confidence,
            basis: best.basis,
            valueType: options.valueType,
        };
    }

    return {
        value: options.fallbackValue || 20,
        source: 'DEFAULT_FALLBACK',
        confidence: 0.55,
        basis: options.fallbackBasis || `Shared ${options.valueType.toLowerCase()} fallback`,
        valueType: options.valueType,
    };
}
