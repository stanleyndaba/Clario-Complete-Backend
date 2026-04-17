/**
 * Fee Detection Algorithms - "The Fee Auditor"
 * 
 * Phase 2, P1 Priority: Fee Overcharge Detection
 * Finds money lost to incorrectly calculated or overcharged fees.
 */

import { supabaseAdmin } from '../../../../database/supabaseClient';
import logger from '../../../../utils/logger';
import { relationExists, requireDetectionSourceType, resolveTenantId } from './shared/tenantUtils';
import { buildReviewAnomalyEvidence } from './shared/reviewAnomaly';

// ============================================================================
// Types
// ============================================================================

export type FeeAnomalyType =
    | 'weight_fee_overcharge'
    | 'fulfillment_fee_error'
    | 'storage_overcharge'
    | 'lts_overcharge'
    | 'commission_overcharge'
    | 'closing_fee_error'
    | 'referral_fee_error'
    | 'low_inventory_fee_error'
    | 'return_processing_fee_error'
    | 'inbound_placement_fee_error'
    | 'peak_fulfillment_surcharge_error'
    | 'size_tier_misclassification'
    | 'duplicate_fee_error'
    | 'fee_sign_polarity_review';

export type CohortState = 
    | 'OPEN_CHARGE' 
    | 'FULLY_REVERSED' 
    | 'PARTIALLY_CREDITED' 
    | 'REPLACED' 
    | 'DUPLICATE_CANDIDATE' 
    | 'NET_OVERCHARGED' 
    | 'NET_BALANCED' 
    | 'INSUFFICIENT_EVIDENCE';

export type EvidenceClass = 'STRICT_IDENTITY_MATCH' | 'STRICT_REFERENCE_MATCH' | 'SKU_IDENTITY_MATCH' | 'TEMPORAL_PROXIMITY_ONLY' | 'UNRESOLVED' | 'APPROVED_MAPPING_MATCH';
export type ReconstructionNote = string;

export interface FeeCohort {
    id: string;
    tenant_id: string;
    marketplace_id: string;
    fee_type: string;
    primary_id?: string; // order_id or shipment_id
    secondary_context?: string; // sku or asin
    events: FeeEvent[];
    gross_charges: number; // total negative amounts
    gross_credits: number; // total positive amounts
    net_value: number;
    state: CohortState;
    evidence_class: EvidenceClass;
    reconstruction_notes: string[];
}

export interface FeeEvent {
    id: string;
    seller_id: string;
    order_id?: string;
    shipment_id?: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    product_name?: string;
    fee_type: string;
    fee_amount: number;
    raw_amount?: number;
    raw_event_type?: string;
    reference_id?: string;
    currency: string;
    item_weight_oz?: number;
    item_length_in?: number;
    item_width_in?: number;
    item_height_in?: number;
    dimensional_weight_oz?: number;
    cubic_feet?: number;
    storage_month?: string;
    storage_type?: string;
    sale_price?: number;
    referral_rate?: number;
    expected_fee?: number;
    fee_date: string;
    marketplace_id?: string;
    created_at: string;
}

export interface ProductCatalog {
    sku: string;
    asin?: string;
    fnsku?: string;
    product_name?: string;
    weight_oz: number;
    length_in: number;
    width_in: number;
    height_in: number;
    size_tier: string;
    category?: string;
    referral_rate?: number;
    currency?: string;
    seller_tenure_days?: number;
    ipi_score?: number;
}

export interface FeeSyncedData {
    seller_id: string;
    sync_id: string;
    fee_events: FeeEvent[];
    product_catalog: ProductCatalog[];
}

export interface FeeDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: FeeAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: FeeOverchargeEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    sku?: string;
    asin?: string;
    product_name?: string;
    confidence_band?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface FeeOverchargeExplanation {
    cohort_id: string;
    fee_family: string;
    evidence_class?: string;
    valuation_owner: string;
    expected_fee: number;
    observed_fee: number;
    recoverable_delta: number;
    unit_identity_basis: string;
    linked_events: string[];
}

export interface FeeOverchargeEvidence {
    sku?: string;
    asin?: string;
    product_name?: string;
    fee_type: string;
    charged_amount: number;
    expected_amount: number;
    overcharge_amount: number;
    overcharge_percentage: number;
    calculation_method: string;
    calculation_inputs: Record<string, any>;
    billing_weight?: number;
    size_tier?: string;
    evidence_summary: string;
    fee_event_ids: string[];
    date_range?: { start: string; end: string };
    currency_match_mode?: 'exact' | 'converted' | 'mismatch';
    value_reconciliation_mode?: 'direct' | 'matched' | 'suppressed' | 'none';
    marketplace_physics_mode?: 'imperial' | 'metric' | 'verified';
    tenant_isolation_verified?: boolean;
    policy_basis?: string;
    tenure_mode?: 'verified' | 'unknown';
    qualification_mode?: 'verified' | 'unknown';
    placement_policy_mode?: 'verified' | 'inferred' | 'unknown';
    optimization_evidence_mode?: 'strong' | 'weak' | 'missing';
    // Round 3A Traceability
    evidence_class?: EvidenceClass;
    reversal_match_mode?: 'exact' | 'partial' | 'none';
    credit_reconciliation_mode?: 'matched' | 'unresolved' | 'none';
    duplicate_fingerprint_mode?: 'hashed_deterministic' | 'none';
    cohort_id?: string;
    schedule_version?: string;
    effective_date_mode?: string;
    explanation?: FeeOverchargeExplanation;
    cohort_trace_graph?: string[];
    review_tier?: 'claim_candidate' | 'review_only' | 'monitoring';
    claim_readiness?: 'claim_ready' | 'not_claim_ready';
    recommended_action?: 'file_claim' | 'review' | 'monitor' | 'investigate';
    value_label?: 'estimated_recovery' | 'potential_exposure' | 'no_recovery_value';
    why_not_claim_ready?: string;
}

// ============================================================================
// Marketplace Configurations (Physics & Units)
// ============================================================================

export interface MarketplaceConfig {
    id: string;
    currency: string;
    unit_system: 'imperial' | 'metric';
    dim_factor: number;
    weight_unit: 'oz' | 'g';
    dim_unit: 'in' | 'cm';
}

const MARKETPLACE_CONFIGS: Record<string, MarketplaceConfig> = {
    'ATVPDKIKX0DER': { id: 'US', currency: 'USD', unit_system: 'imperial', dim_factor: 139, weight_unit: 'oz', dim_unit: 'in' },
    'A1F8U5RK5QF05G': { id: 'UK', currency: 'GBP', unit_system: 'metric', dim_factor: 5000, weight_unit: 'g', dim_unit: 'cm' },
    'A1PA6795UKMFR9': { id: 'DE', currency: 'EUR', unit_system: 'metric', dim_factor: 5000, weight_unit: 'g', dim_unit: 'cm' }
};

const DEFAULT_MARKETPLACE = 'ATVPDKIKX0DER';

// ============================================================================
// Fee Rate Tables (2024 & 2025 schedules)
// ============================================================================

const FBA_SCHEDULES = [
    {
        start: '2024-01-01T00:00:00Z',
        end: '2024-10-15T00:00:00Z',
        rates: {
            small_standard: { '0-4oz': 3.06, '4-8oz': 3.24, '8-12oz': 3.41, '12-16oz': 3.65 },
            large_standard: { '0-4oz': 3.72, '4-8oz': 3.94, '8-12oz': 4.10, '12-16oz': 4.58, '1-2lb': 5.23, '2-3lb': 5.51, '3lb+': 5.86 },
            small_oversize: { base: 9.61, perLb: 0.38 },
            medium_oversize: { base: 18.66, perLb: 0.38 },
            large_oversize: { base: 88.35, perLb: 0.80 },
            special_oversize: { base: 154.67, perLb: 0.80 },
        }
    },
    {
        start: '2024-10-15T00:00:00Z',
        end: '2025-01-01T00:00:00Z', // Aligned with scenario truth for Jan 1 start of base rates
        rates: {
            small_standard: { '0-4oz': 3.44, '4-8oz': 3.62, '8-12oz': 3.79, '12-16oz': 4.03 },
            large_standard: { '0-4oz': 4.10, '4-8oz': 4.32, '8-12oz': 4.48, '12-16oz': 5.15, '1-2lb': 5.80, '2-3lb': 6.08, '3lb+': 6.43 },
            small_oversize: { base: 11.86, perLb: 0.38 },
            medium_oversize: { base: 20.91, perLb: 0.38 },
            large_oversize: { base: 92.51, perLb: 0.80 },
            special_oversize: { base: 161.41, perLb: 0.80 },
        }
    },
    {
        start: '2025-01-01T00:00:00Z',
        end: '2099-12-31T23:59:59Z',
        rates: {
            small_standard: { '0-4oz': 3.22, '4-8oz': 3.40, '8-12oz': 3.58, '12-16oz': 3.77 },
            large_standard: { '0-4oz': 3.86, '4-8oz': 4.08, '8-12oz': 4.24, '12-16oz': 4.75, '1-2lb': 5.40, '2-3lb': 5.69, '3lb+': 6.10 },
            small_oversize: { base: 9.73, perLb: 0.42 },
            medium_oversize: { base: 19.05, perLb: 0.42 },
            large_oversize: { base: 89.98, perLb: 0.83 },
            special_oversize: { base: 158.49, perLb: 0.83 },
        }
    }
];

const STORAGE_SCHEDULES = {
    '2024': {
        standard: { 'jan-sep': 0.78, 'oct-dec': 2.40 },
        oversize: { 'jan-sep': 0.49, 'oct-dec': 1.20 },
        long_term: 6.90
    },
    '2025': {
        standard: { 'jan-sep': 0.87, 'oct-dec': 2.40 },
        oversize: { 'jan-sep': 0.56, 'oct-dec': 1.40 },
        long_term: 6.90
    }
};

const LOW_INVENTORY_FEE_2025 = { threshold_ipi: 450, fee_per_cubic_foot: 0.32 };
const RETURN_PROCESSING_Schedules = {
    '2025': {
        apparel: { small_standard: 2.12, large_standard: 3.15, oversize: 5.50 },
        standard: { small_standard: 1.85, large_standard: 2.75, oversize: 4.80 }
    }
};

const DEFAULT_REFERRAL_RATE = 0.15;

// ============================================================================
// Helper Functions
// ============================================================================

// Round 3A Constants
const REVERSAL_WINDOW_DAYS = 45;
const DUPLICATE_WINDOW_DAYS = 7;

const APPROVED_CROSS_TYPE_MAPPINGS: Record<string, string[]> = {
    'FBAPerUnitFulfillmentFee': ['FBAFulfillmentFeeReversal', 'Adjustment', 'FulfillmentFee'],
    'StorageFee': ['StorageFeeReversal', 'Adjustment', 'FBAStorageFee', 'FBA Storage Fee'],
    'Inbound Placement Service Fee': ['InboundPlacementReversal', 'Inbound Placement Service Fee-Adjustment', 'Placement-Adjustment'],
    'LowInventoryFee': ['LowInventoryFeeReversal'],
    'Commission': ['CommissionReversal', 'ReferralFee'],
    'ReturnProcessingFee': ['ReturnProcessingFeeReversal']
};

const getCanonicalType = (type: string): string => {
    for (const [canonical, variants] of Object.entries(APPROVED_CROSS_TYPE_MAPPINGS)) {
        if (canonical === type || variants.includes(type)) return canonical;
    }
    return type;
};

function getUnitIdentity(event: FeeEvent): string {
    if (event.order_id) return `ORD_${event.order_id}_${event.sku || 'nosku'}`;
    if (event.shipment_id) return `SHIP_${event.shipment_id}_${event.sku || 'nosku'}`;
    return `EVT_${event.id}`;
}

function getDuplicateIntentIdentity(event: FeeEvent): string {
    const type = getCanonicalType(event.fee_type);
    
    if (type === 'StorageFee' || type === 'FBAStorageFee') {
        const month = event.storage_month || event.fee_date.substring(0, 7);
        return `STORAGE_${event.seller_id}_${month}_${event.sku || 'nosku'}_${event.storage_type || 'standard'}`;
    }
    
    if (event.order_id) {
        return `ORD_FEE_${event.seller_id}_${event.order_id}_${type}_${event.sku || 'nosku'}_${Math.abs(event.fee_amount).toFixed(2)}`;
    }
    if (event.shipment_id) {
        return `SHIP_FEE_${event.seller_id}_${event.shipment_id}_${type}_${event.sku || 'nosku'}_${Math.abs(event.fee_amount).toFixed(2)}`;
    }
    
    return `ORPHAN_${event.seller_id}_${type}_${event.sku || 'nosku'}_${Math.abs(event.fee_amount).toFixed(2)}_${event.fee_date.split('T')[0]}`;
}

export function reconstructFeeCohorts(data: FeeSyncedData): FeeCohort[] {
    const cohortsByGroup = new Map<string, FeeEvent[]>();
    const sellerId = data.seller_id;

    // Phase 31: Uniqueness-Guarded SKU Mapping
    const skuMap = new Map<string, Set<string>>();
    (data.fee_events || []).forEach(event => {
        if (event.seller_id !== sellerId) return;
        const marketplaceId = event.marketplace_id || DEFAULT_MARKETPLACE;
        const primaryId = event.shipment_id || event.order_id || 'unlinked';
        if (primaryId !== 'unlinked' && event.sku) {
            const mapKey = `${sellerId}:${marketplaceId}:${primaryId}`;
            const skus = skuMap.get(mapKey) || new Set<string>();
            skus.add(event.sku);
            skuMap.set(mapKey, skus);
        }
    });

    (data.fee_events || []).forEach(event => {
        if (event.seller_id !== sellerId) return; // Strict isolation

        const marketplaceId = event.marketplace_id || DEFAULT_MARKETPLACE;
        const config = MARKETPLACE_CONFIGS[marketplaceId] || MARKETPLACE_CONFIGS[DEFAULT_MARKETPLACE];
        
        // Currency Parity Guard (Round 2 Restoration)
        if (event.currency !== config.currency) return;

        const feeType = getCanonicalType(event.fee_type);
        const primaryId = event.shipment_id || event.order_id || 'unlinked'; 
        let secondaryContext = event.sku || event.asin || 'no_context';

        // Phase 31: Context Backfill
        if (secondaryContext === 'no_context' && primaryId !== 'unlinked') {
            const mapKey = `${sellerId}:${marketplaceId}:${primaryId}`;
            const candidateSkus = skuMap.get(mapKey);
            if (candidateSkus && candidateSkus.size === 1) {
                secondaryContext = Array.from(candidateSkus)[0];
            }
        }

        // Hierarchy: TenantID -> MarketplaceID -> FeeType (Canonical) -> PrimaryIdentityKey -> SecondaryIdentityContext
        const groupKey = `${sellerId}:${marketplaceId}:${feeType}:${primaryId}:${secondaryContext}`;
        
        const existing = cohortsByGroup.get(groupKey) || [];
        existing.push(event);
        cohortsByGroup.set(groupKey, existing);
    });

    const cohorts: FeeCohort[] = [];
    let cohortIdCounter = 1;

    for (const [groupKey, events] of cohortsByGroup) {
        // Sort events by date
        events.sort((a, b) => new Date(a.fee_date).getTime() - new Date(b.fee_date).getTime());

        const primaryId = groupKey.split(':')[3];
        const marketplaceId = groupKey.split(':')[1];
        const mapKey = `${sellerId}:${marketplaceId}:${primaryId}`;
        const isIdentityAmbiguous = primaryId !== 'unlinked' && (skuMap.get(mapKey)?.size || 0) > 1;
        const allowTemporalExemption = primaryId !== 'unlinked' && !isIdentityAmbiguous;

        // Temporal Windowing Logic
        // Partition events into temporal cohorts if they exceed the reconciliation window
        const eventPartitions: FeeEvent[][] = [];
        if (events.length > 0) {
            let currentPartition: FeeEvent[] = [events[0]];
            for (let i = 1; i < events.length; i++) {
                const prevTime = new Date(events[i-1].fee_date).getTime();
                const eventTime = new Date(events[i].fee_date).getTime();
                const gapDays = (eventTime - prevTime) / (1000 * 60 * 60 * 24);
                
                // Partition if the gap between consecutive events exceeds the window
                const window = REVERSAL_WINDOW_DAYS; 
                
                if (gapDays > window && !allowTemporalExemption) {
                    eventPartitions.push(currentPartition);
                    currentPartition = [events[i]];
                } else {
                    currentPartition.push(events[i]);
                }
            }
            eventPartitions.push(currentPartition);
        }

        for (const partition of eventPartitions) {
            let grossCharges = 0;
            let grossCredits = 0;
            const fingerprintCounts = new Map<string, number>();

            partition.forEach(e => {
                if (e.fee_amount < 0) grossCharges += Math.abs(e.fee_amount);
                else grossCredits += e.fee_amount;

                const fp = getDuplicateIntentIdentity(e);
                fingerprintCounts.set(fp, (fingerprintCounts.get(fp) || 0) + 1);
            });

        // Sign safety: Use raw netting to detect corrections properly
        const netValue = grossCharges - grossCredits;
        const primaryId = groupKey.split(':')[3];
        const secondaryContext = groupKey.split(':')[4];

        // Determine Evidence Class
        let evidenceClass: EvidenceClass = 'UNRESOLVED';
        if (primaryId !== 'unlinked' && secondaryContext !== 'no_context') {
            evidenceClass = 'STRICT_IDENTITY_MATCH';
            if (isIdentityAmbiguous) {
                // If the primary identity had ambiguous SKUs initially, downgrade certainty as a safety measure
                evidenceClass = 'UNRESOLVED'; 
            }
        }
        else if (primaryId !== 'unlinked') evidenceClass = 'STRICT_REFERENCE_MATCH';
        else if (secondaryContext !== 'no_context') {
            // Predicate-based SKU promotion
            const sku = secondaryContext;
            const sellers = new Set(partition.map(e => e.seller_id));
            const marketplaces = new Set(partition.map(e => e.marketplace_id));
            const feeType = partition[0].fee_type;
            const canonicalType = getCanonicalType(feeType);

            // 1. Local isolation: unique tenant/marketplace in partition
            const isIsolated = sellers.size === 1 && marketplaces.size === 1;

            // 2. No competing hard identities for this SKU/Type in the entire batch
            const hasHardCompetitors = data.fee_events.some(e => 
                e.seller_id === sellerId && 
                (e.shipment_id || e.order_id) && 
                e.sku === sku && 
                getCanonicalType(e.fee_type) === canonicalType
            );
            
            // 3. No cross-type ambiguity
            const isTypePure = partition.every(e => getCanonicalType(e.fee_type) === canonicalType);

            if (isIsolated && !hasHardCompetitors && isTypePure) {
                evidenceClass = 'SKU_IDENTITY_MATCH';
            }
        }
        else if (partition.length > 1) evidenceClass = 'TEMPORAL_PROXIMITY_ONLY';

        // Determine State
        let hasDuplicates = Array.from(fingerprintCounts.values()).some(count => count > 1);
        let state: CohortState = 'OPEN_CHARGE';
        if (Math.abs(netValue) < 0.01) state = 'NET_BALANCED';
        else if (grossCredits >= grossCharges) state = 'FULLY_REVERSED';
        else if (grossCredits > 0) state = 'PARTIALLY_CREDITED';
        else if (hasDuplicates) state = 'DUPLICATE_CANDIDATE';
        if (netValue > 0 && state === 'OPEN_CHARGE') state = 'NET_OVERCHARGED';

        cohorts.push({
            id: `cohort_${cohortIdCounter++}`,
            tenant_id: sellerId,
            marketplace_id: groupKey.split(':')[1],
            fee_type: groupKey.split(':')[2],
            primary_id: primaryId === 'unlinked' ? undefined : primaryId,
            secondary_context: secondaryContext === 'no_context' ? undefined : secondaryContext,
            events: partition,
            gross_charges: grossCharges,
            gross_credits: grossCredits,
            net_value: netValue,
            state,
            evidence_class: evidenceClass,
            reconstruction_notes: [
                `Reconstructed temporal cohort for ${groupKey.split(':')[2]}`,
                `Events: ${partition.length}, Evidence: ${evidenceClass}`,
                `Net Value: ${netValue.toFixed(2)}`
            ]
        });
    }
}

    // Cross-Type Reconciliation (Approved Mappings)
    // TODO: Implement cross-type merging if explicit deterministic evidence exists.
    // For now, hierarchy satisfies core grouping rules.

    return cohorts;
}

function getScheduleVersion(dateStr: string): '2024' | '2025' {
    const date = new Date(dateStr);
    return date.getFullYear() >= 2025 ? '2025' : '2024';
}

function calculateDeadline(discoveryDate: Date) {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);
    const daysRemaining = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

function calculateSeverity(overchargeAmount: number) {
    if (overchargeAmount >= 100) return 'critical';
    if (overchargeAmount >= 50) return 'high';
    if (overchargeAmount >= 10) return 'medium';
    return 'low';
}

function calculateDimensionalWeight(length: number, width: number, height: number, marketplaceId: string = DEFAULT_MARKETPLACE): number {
    const config = MARKETPLACE_CONFIGS[marketplaceId] || MARKETPLACE_CONFIGS[DEFAULT_MARKETPLACE];
    return (length * width * height) / config.dim_factor;
}

function getSizeTier(weight: number = 0, length: number = 0, width: number = 0, height: number = 0, marketplaceId: string = DEFAULT_MARKETPLACE): string {
    const config = MARKETPLACE_CONFIGS[marketplaceId] || MARKETPLACE_CONFIGS[DEFAULT_MARKETPLACE];
    
    if (config.unit_system === 'imperial') {
        const sorted = [(length || 0), (width || 0), (height || 0)].sort((a, b) => b - a);
        const [longest, median, shortest] = sorted;
        if (weight <= 15 && longest <= 15 && median <= 12 && shortest <= 0.75) return 'small_standard';
        if (weight <= 320 && longest <= 18 && median <= 14 && shortest <= 8) return 'large_standard';
        if (weight <= 1120 && longest <= 60 && median <= 30) return 'small_oversize';
        if (weight <= 2400 && longest <= 108) return 'medium_oversize';
        const girth = 2 * (median + shortest);
        if (weight <= 2400 && (longest + girth) <= 165) return 'large_oversize';
    } else {
        // Metric Logic (Unit Conversion Safety: OZ to G, IN to CM)
        // Catalog is always OZ/IN. Thresholds are G/CM.
        const weightG = weight * 28.35;
        const lengthCm = length * 2.54;
        
        if (weightG <= 450 && lengthCm <= 35) return 'small_standard';
        if (weightG <= 12000 && lengthCm <= 45) return 'large_standard';
        return 'small_oversize';
    }
    return 'special_oversize';
}

function getExpectedFulfillmentFee(weight: number, sizeTier: string, feeDate: string): number {
    const row = FBA_SCHEDULES.find(r => feeDate >= r.start && feeDate < r.end);
    if (!row) return 0;
    const schedule = row.rates;
    const weightOz = isNaN(weight) ? 0 : weight;
    const weightLb = weightOz / 16;
    
    // Standard Tiers
    if (sizeTier === 'small_standard') {
        const tiers = schedule.small_standard;
        if (weightOz <= 4) return tiers['0-4oz'];
        if (weightOz <= 8) return tiers['4-8oz'];
        if (weightOz <= 12) return tiers['8-12oz'];
        return tiers['12-16oz'];
    }
    if (sizeTier === 'large_standard') {
        const tiers = schedule.large_standard;
        if (weightOz <= 4) return tiers['0-4oz'];
        if (weightOz <= 8) return tiers['4-8oz'];
        if (weightOz <= 12) return tiers['8-12oz'];
        if (weightOz <= 16) return tiers['12-16oz'];
        if (weightOz <= 32) return tiers['1-2lb'];
        if (weightOz <= 48) return tiers['2-3lb'];
        const additionalOz = Math.max(0, weightOz - 48);
        return tiers['3lb+'] + Math.ceil(additionalOz / 4) * 0.16;
    }
    
    // Oversize Tiers
    const oversizeKey = sizeTier as keyof typeof schedule;
    const oversize = schedule[oversizeKey];
    if (oversize && typeof oversize === 'object' && 'base' in oversize) {
        return (oversize as any).base + (weightLb * (oversize as any).perLb);
    }
    
    return 0;
}

// ============================================================================
// Main Detectors
// ============================================================================

export function detectFulfillmentFeeOvercharge(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    const catalogBySku = new Map<string, ProductCatalog>();
    (data.product_catalog || []).forEach(p => catalogBySku.set(p.sku, p));

    const cohorts = reconstructFeeCohorts(data);
    const fulfillmentCohorts = cohorts.filter(c => 
        c.fee_type.toLowerCase().includes('fulfillment') || 
        c.fee_type.toLowerCase().includes('fba')
    );

    fulfillmentCohorts.forEach(cohort => {
        // Safety Rule: No anomalies for proximity-only or unresolved cohorts
        if (cohort.evidence_class === 'TEMPORAL_PROXIMITY_ONLY' || cohort.evidence_class === 'UNRESOLVED') return;

        // Skip balanced or reversed cohorts
        if (cohort.state === 'NET_BALANCED' || cohort.state === 'FULLY_REVERSED') return;

        // Robust SKU Fallback
        let sku = cohort.secondary_context;
        if (!sku) {
            const eventWithSku = cohort.events.find(e => e.sku || e.asin);
            if (eventWithSku) sku = eventWithSku.sku || eventWithSku.asin;
        }
        if (!sku) return;

        const catalog = catalogBySku.get(sku);
        if (!catalog) return;

        const marketplaceId = cohort.marketplace_id;
        const config = MARKETPLACE_CONFIGS[marketplaceId] || MARKETPLACE_CONFIGS[DEFAULT_MARKETPLACE];
        const scheduleVersion = getScheduleVersion(cohort.events[0].fee_date);
        
        const derivedSizeTier = getSizeTier(catalog.weight_oz, catalog.length_in, catalog.width_in, catalog.height_in, marketplaceId);
        // Trust catalog.size_tier if dimensions are missing/partial to avoid defaulting to special_oversize or small_standard incorrectly
        const sizeTier = (catalog.length_in && catalog.width_in && catalog.height_in) ? derivedSizeTier : (catalog.size_tier || derivedSizeTier);
        
        // Compute dimensional weight in OZ. 
        // Metric config: dim_factor 5000 -> (cm^3 / 5000) = KG. KG * 35.274 = OZ.
        // Imperial config: dim_factor 139 -> (in^3 / 139) = LB. LB * 16 = OZ.
        const dimWeightVal = calculateDimensionalWeight(catalog.length_in, catalog.width_in, catalog.height_in, marketplaceId);
        let dimWeightOz = dimWeightVal * (config.unit_system === 'imperial' ? 16 : 35.274);
        
        if (sizeTier === 'large_standard' && catalog.weight_oz <= 16) {
            dimWeightOz = 0; 
        }
        
        const billingWeight = Math.max(catalog.weight_oz, dimWeightOz);
        const expectedFeePerUnit = getExpectedFulfillmentFee(billingWeight, sizeTier, cohort.events[0].fee_date);

        // Quantity Logic: use unique charge intents representing distinct units
        const unitBasisEvents = cohort.events.filter(e => e.fee_amount < 0);
        const uniqueUnitFingerprints = new Set(unitBasisEvents.map(e => getUnitIdentity(e)));
        const unitCount = uniqueUnitFingerprints.size;
        
        const avgChargedPerEvent = unitBasisEvents.length > 0 ? (cohort.net_value / unitBasisEvents.length) : 0;
        const rateErrorPerUnit = Math.max(0, avgChargedPerEvent - expectedFeePerUnit);
        const overchargeAmount = rateErrorPerUnit * unitCount;
        
        const totalExpected = expectedFeePerUnit * unitCount;
        const totalCharged = cohort.net_value;
        const overchargePercent = expectedFeePerUnit > 0 ? (rateErrorPerUnit / expectedFeePerUnit) : 0;

        if (overchargeAmount > 0.1 && overchargePercent > 0.05) {
            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: 'fulfillment_fee_error',
                severity: calculateSeverity(overchargeAmount),
                estimated_value: overchargeAmount,
                currency: config.currency,
                confidence_score: cohort.evidence_class === 'STRICT_IDENTITY_MATCH' ? 0.95 : 0.85,
                related_event_ids: cohort.events.map(e => e.id),
                discovery_date: discoveryDate,
                deadline_date: deadline,
                days_remaining: daysRemaining,
                evidence: {
                    fee_type: cohort.fee_type,
                    charged_amount: totalCharged,
                    expected_amount: totalExpected,
                    overcharge_amount: overchargeAmount,
                    overcharge_percentage: overchargePercent * 100,
                    size_tier: sizeTier,
                    billing_weight: billingWeight,
                    calculation_method: 'cohort_lifecycle_reconstruction',
                    calculation_inputs: { sku, sizeTier, billingWeight, cohort_state: cohort.state },
                    evidence_summary: `Overcharge of ${config.currency}${overchargeAmount.toFixed(2)} on ${cohort.fee_type} for SKU ${sku}.`,
                    fee_event_ids: cohort.events.map(e => e.id),
                    currency_match_mode: 'exact',
                    marketplace_physics_mode: 'verified',
                    tenant_isolation_verified: true,
                    schedule_version: scheduleVersion,
                    effective_date_mode: 'exact',
                    evidence_class: cohort.evidence_class,
                    cohort_id: cohort.id,
                    reversal_match_mode: cohort.gross_credits > 0 ? (cohort.net_value === 0 ? 'exact' : 'partial') : 'none'
                }
            });
        }
    });

    return results;
}

export function detectStorageFeeOvercharge(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    const cohorts = reconstructFeeCohorts(data);
    const storageCohorts = cohorts.filter(c => 
        c.fee_type.toLowerCase().includes('storage')
    );

    storageCohorts.forEach(cohort => {
        // Storage fees are account/SKU level; accept SKU_IDENTITY_MATCH
        if (cohort.evidence_class === 'TEMPORAL_PROXIMITY_ONLY' || cohort.evidence_class === 'UNRESOLVED') return;

        // Skip balanced or reversed cohorts
        if (cohort.state === 'NET_BALANCED' || cohort.state === 'FULLY_REVERSED') return;

        const marketplaceId = cohort.marketplace_id;
        const config = MARKETPLACE_CONFIGS[marketplaceId] || MARKETPLACE_CONFIGS[DEFAULT_MARKETPLACE];
        const feeDate = cohort.events[0].fee_date;
        const scheduleVersion = getScheduleVersion(feeDate);
        const schedule = STORAGE_SCHEDULES[scheduleVersion];

        const month = feeDate.substring(0, 7);
        const period = month.split('-')[1] >= '10' ? 'oct-dec' : 'jan-sep';
        
        // Use average cu.ft from the cohort events
        const totalCubicFeet = cohort.events.reduce((sum, e) => sum + (e.cubic_feet || 0), 0);
        if (totalCubicFeet === 0) return;

        // Logic for rate selection (simplified for Round 3A focus on cohorts)
        let rate = schedule.standard[period];
        if (cohort.events[0].storage_type === 'long_term') {
            rate = schedule.long_term;
        } else if (cohort.events[0].storage_type === 'oversize') {
            rate = schedule.oversize[period];
        }

        // Storage Quantity: Billed volume/month basis
        const uniqueMonths = new Set(cohort.events.map(e => e.storage_month || e.fee_date.substring(0, 7)));
        const avgCubicFeet = totalCubicFeet / Math.max(1, cohort.events.length);
        const avgChargedPerEvent = cohort.events.length > 0 ? (cohort.net_value / cohort.events.length) : 0;
        const expectedFeePerEvent = rate * avgCubicFeet;
        const rateErrorPerEvent = Math.max(0, avgChargedPerEvent - expectedFeePerEvent);
        
        // For storage, the baseline intended unit is the unique month
        const overchargeAmount = rateErrorPerEvent * uniqueMonths.size;
        
        const totalExpected = expectedFeePerEvent * uniqueMonths.size;
        const totalCharged = cohort.net_value;
        const overchargePercent = expectedFeePerEvent > 0 ? (rateErrorPerEvent / expectedFeePerEvent) : 0;

        // Verify volume if dimensions are present (Secondary Support)
        const product = (data.product_catalog || []).find(p => p.sku === cohort.secondary_context);
        let volumeMismatchExplanation = '';
        if (product && product.length_in && product.width_in && product.height_in) {
            const expectedCuFt = (product.length_in * product.width_in * product.height_in) / 1728;
            const actualCuFt = totalCubicFeet / Math.max(1, cohort.events.length);
            if (Math.abs(actualCuFt - expectedCuFt) / expectedCuFt > 0.2) {
                volumeMismatchExplanation = `Catalog volume (${expectedCuFt.toFixed(2)} cu.ft) differs from measured volume (${actualCuFt.toFixed(2)} cu.ft). `;
            }
        }

        if (overchargeAmount > 1.0 && overchargePercent > 0.05) {
            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: 'storage_overcharge',
                severity: calculateSeverity(overchargeAmount),
                estimated_value: overchargeAmount,
                currency: config.currency,
                confidence_score: 0.95,
                related_event_ids: cohort.events.map(e => e.id),
                discovery_date: discoveryDate,
                deadline_date: deadline,
                days_remaining: daysRemaining,
                evidence: {
                    fee_type: cohort.fee_type,
                    charged_amount: totalCharged,
                    expected_amount: totalExpected,
                    overcharge_amount: overchargeAmount,
                    overcharge_percentage: overchargePercent * 100,
                    calculation_method: 'cubic_feet_rate', calculation_inputs: { month, totalCubicFeet },
                    evidence_summary: volumeMismatchExplanation + `Rate: ${rate}/cu.ft. Expected: ${totalExpected.toFixed(2)}, Charged: ${totalCharged.toFixed(2)}.`,
                    fee_event_ids: cohort.events.map(e => e.id),
                    currency_match_mode: 'exact',
                    value_reconciliation_mode: 'direct',
                    tenant_isolation_verified: true,
                    schedule_version: scheduleVersion,
                    effective_date_mode: 'exact',
                    evidence_class: cohort.evidence_class,
                    cohort_id: cohort.id
                }
            });
        }
    });

    return results;
}

export function detectCommissionOvercharge(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    const catalogBySku = new Map<string, ProductCatalog>();
    (data.product_catalog || []).forEach(p => catalogBySku.set(p.sku, p));

    (data.fee_events || []).forEach(fee => {
        if (fee.seller_id !== sellerId) return;
        if (!fee.fee_type.toLowerCase().includes('commission') && !fee.fee_type.toLowerCase().includes('referral')) return;
        if (!fee.sale_price || fee.sale_price <= 0) return;

        const catalog = fee.sku ? catalogBySku.get(fee.sku) : undefined;
        const rate = fee.referral_rate || catalog?.referral_rate || DEFAULT_REFERRAL_RATE;
        const expected = fee.sale_price * rate;
        const charged = Math.abs(fee.fee_amount);
        const overcharge = charged - expected;

        if (overcharge > 0.5 && (overcharge / expected) > 0.05) {
            results.push({
                seller_id: sellerId, sync_id: syncId, anomaly_type: 'commission_overcharge',
                severity: calculateSeverity(overcharge), estimated_value: overcharge,
                currency: fee.currency || 'USD', confidence_score: 0.8, related_event_ids: [fee.id],
                discovery_date: discoveryDate, deadline_date: deadline, days_remaining: daysRemaining,
                sku: fee.sku, asin: fee.asin, product_name: fee.product_name,
                evidence: {
                    sku: fee.sku, fee_type: 'Referral Fee', charged_amount: charged, expected_amount: expected,
                    overcharge_amount: overcharge, overcharge_percentage: (overcharge / expected) * 100,
                    calculation_method: 'sale_price_rate', calculation_inputs: { sale_price: fee.sale_price, rate },
                    evidence_summary: `Commission overcharge of $${overcharge.toFixed(2)}.`,
                    fee_event_ids: [fee.id], tenant_isolation_verified: true,
                    evidence_class: 'STRICT_REFERENCE_MATCH'
                }
            });
        }
    });
    return results;
}

// Hardened 2025 detectors
export function detectLowInventoryFeeOvercharge(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);
    const catalogBySku = new Map<string, ProductCatalog>();
    (data.product_catalog || []).forEach(p => catalogBySku.set(p.sku, p));
    
    const cohorts = reconstructFeeCohorts(data);
    const lifCohorts = cohorts.filter(c => 
        c.fee_type.toLowerCase().includes('low_inventory') || 
        c.fee_type.toLowerCase().includes('low-inventory')
    );

    lifCohorts.forEach(cohort => {
        // Low Inventory fees are SKU level; accept SKU_IDENTITY_MATCH
        if (cohort.evidence_class === 'TEMPORAL_PROXIMITY_ONLY' || cohort.evidence_class === 'UNRESOLVED') return;
        if (cohort.state === 'NET_BALANCED' || cohort.state === 'FULLY_REVERSED') return;

        const sku = cohort.secondary_context;
        const catalog = sku ? catalogBySku.get(sku) : undefined;
        
        // Use metadata from first event
        const fee = cohort.events[0];
        const ipi = (fee as any).ipi_score ?? (fee as any).metadata?.ipi; 
        const tenureDays = (fee as any).seller_tenure_days ?? catalog?.seller_tenure_days;
        
        const marketplaceId = cohort.marketplace_id;
        const config = MARKETPLACE_CONFIGS[marketplaceId] || MARKETPLACE_CONFIGS[DEFAULT_MARKETPLACE];
        const charged = cohort.net_value; 
        let expected = charged;
        let overcharge = 0;
        let policyBasis = 'Standard 2025 Policy';
        let tenureMode: 'verified' | 'unknown' = (tenureDays !== undefined) ? 'verified' : 'unknown';
        let qualificationMode: 'verified' | 'unknown' = (ipi !== undefined) ? 'verified' : 'unknown';

        if (ipi !== undefined && ipi > 450) {
            expected = 0;
            overcharge = charged;
            policyBasis = 'IPI Exemption (> 450)';
        } else if (tenureDays !== undefined && tenureDays < 90) {
            expected = 0;
            overcharge = charged;
            policyBasis = 'New Seller Exemption (< 90 days)';
        }

        if (overcharge > 0) {
            results.push({
                seller_id: sellerId, sync_id: syncId, anomaly_type: 'return_processing_fee_error',
                severity: 'low', estimated_value: overcharge, currency: config.currency,
                confidence_score: (qualificationMode === 'verified' || tenureMode === 'verified') ? 0.9 : 0.65, 
                related_event_ids: cohort.events.map(e => e.id), discovery_date: discoveryDate,
                deadline_date: deadline, days_remaining: daysRemaining, sku,
                evidence: { 
                    sku, fee_type: cohort.fee_type, charged_amount: charged, expected_amount: expected, 
                    overcharge_amount: overcharge, overcharge_percentage: (overcharge/charged)*100, 
                    calculation_method: 'cohort_lifecycle_reconstruction', 
                    calculation_inputs: { ipi, tenureDays, cohort_state: cohort.state }, 
                    evidence_summary: `Low-inventory fee overcharge: ${policyBasis}.`, 
                    fee_event_ids: cohort.events.map(e => e.id), policy_basis: policyBasis,
                    tenure_mode: tenureMode, qualification_mode: qualificationMode,
                    schedule_version: '2025', effective_date_mode: 'exact',
                    evidence_class: cohort.evidence_class, cohort_id: cohort.id
                }
            });
        }
    });
    return results;
}

export function detectReturnProcessingFeeOvercharge(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);
    const catalogBySku = new Map<string, ProductCatalog>();
    (data.product_catalog || []).forEach(p => catalogBySku.set(p.sku, p));

    const cohorts = reconstructFeeCohorts(data);
    const rpfCohorts = cohorts.filter(c => 
        c.fee_type.toLowerCase().includes('return_processing') || 
        c.fee_type.toLowerCase().includes('return processing')
    );

    rpfCohorts.forEach(cohort => {
        if (cohort.evidence_class === 'TEMPORAL_PROXIMITY_ONLY' || cohort.evidence_class === 'UNRESOLVED') return;
        if (cohort.state === 'NET_BALANCED' || cohort.state === 'FULLY_REVERSED') return;

        const sku = cohort.secondary_context || '';
        const catalog = catalogBySku.get(sku);
        const marketplaceId = cohort.marketplace_id;
        const config = MARKETPLACE_CONFIGS[marketplaceId] || MARKETPLACE_CONFIGS[DEFAULT_MARKETPLACE];
        
        let expectedPerUnit = 0;
        let policyBasis = 'Standard Return Processing';
        let sizeTier = 'unknown';
        
        if (catalog) {
            sizeTier = (catalog.length_in && catalog.width_in && catalog.height_in)
                ? getSizeTier(catalog.weight_oz, catalog.length_in, catalog.width_in, catalog.height_in, marketplaceId)
                : (catalog.size_tier || 'large_standard');
            const isApparel = catalog.category?.toLowerCase().includes('apparel') || catalog.category?.toLowerCase().includes('clothing');
            const isMedia = catalog.category?.toLowerCase().includes('books') || catalog.category?.toLowerCase().includes('media');
            
            if (isMedia) {
                expectedPerUnit = 0; 
                policyBasis = 'Category Exemption (Books/Media)';
            } else {
                const catSchedule = isApparel ? RETURN_PROCESSING_Schedules['2025'].apparel : RETURN_PROCESSING_Schedules['2025'].standard;
                if (sizeTier.includes('oversize')) expectedPerUnit = catSchedule.oversize;
                else if (sizeTier === 'large_standard') expectedPerUnit = catSchedule.large_standard;
                else expectedPerUnit = catSchedule.small_standard;
                policyBasis = `${isApparel ? 'Apparel' : 'Standard'} Category (${sizeTier})`;
            }
        } else {
            expectedPerUnit = cohort.net_value / cohort.events.length; // Assume correct if unknown
            policyBasis = 'Unknown SKU: Policy verification suppressed';
        }

        // Return Quantity: unique physical returns basis
        const returnBasisEvents = cohort.events.filter(e => e.fee_amount < 0);
        const uniqueReturnFingerprints = new Set(returnBasisEvents.map(e => getUnitIdentity(e)));
        const returnCount = uniqueReturnFingerprints.size;
        
        const avgChargedPerEvent = returnBasisEvents.length > 0 ? (cohort.net_value / returnBasisEvents.length) : 0;
        const rateErrorPerUnit = Math.max(0, avgChargedPerEvent - expectedPerUnit);
        const overchargeAmount = rateErrorPerUnit * returnCount;

        const totalExpected = expectedPerUnit * returnCount;
        const totalCharged = cohort.net_value;
        const overchargePercent = expectedPerUnit > 0 ? (rateErrorPerUnit / expectedPerUnit) : 0;

        if (overchargeAmount > 0.1 && overchargePercent > 0.05) {
            results.push({
                seller_id: sellerId, sync_id: syncId, anomaly_type: 'return_processing_fee_error',
                severity: 'low', estimated_value: overchargeAmount, currency: config.currency,
                confidence_score: 0.85, related_event_ids: cohort.events.map(e => e.id),
                discovery_date: discoveryDate, deadline_date: deadline, days_remaining: daysRemaining, sku,
                evidence: {
                    sku, fee_type: cohort.fee_type, charged_amount: totalCharged, expected_amount: totalExpected,
                    overcharge_amount: overchargeAmount, overcharge_percentage: overchargePercent * 100,
                    size_tier: sizeTier,
                    calculation_method: 'cohort_lifecycle_reconstruction',
                    calculation_inputs: { sku, sizeTier, policyBasis, cohort_state: cohort.state },
                    evidence_summary: `Return processing overcharge: ${policyBasis}.`,
                    fee_event_ids: cohort.events.map(e => e.id), tenant_isolation_verified: true,
                    schedule_version: '2025', effective_date_mode: 'exact',
                    evidence_class: cohort.evidence_class, cohort_id: cohort.id
                }
            });
        }
    });
    return results;
}

export function detectInboundPlacementFeeOvercharge(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    const cohorts = reconstructFeeCohorts(data);
    const ipfCohorts = cohorts.filter(c => 
        c.fee_type.toLowerCase().includes('inbound') || 
        c.fee_type.toLowerCase().includes('placement')
    );

    ipfCohorts.forEach(cohort => {
        // Inbound placement requires Shipment ID link
        if (cohort.evidence_class === 'SKU_IDENTITY_MATCH' || cohort.evidence_class === 'TEMPORAL_PROXIMITY_ONLY' || cohort.evidence_class === 'UNRESOLVED') return;
        if (cohort.state === 'NET_BALANCED' || cohort.state === 'FULLY_REVERSED') return;

        const fee = cohort.events[0];
        const marketplaceId = cohort.marketplace_id;
        const config = MARKETPLACE_CONFIGS[marketplaceId] || MARKETPLACE_CONFIGS[DEFAULT_MARKETPLACE];
        
        const isOptimized = (fee as any).is_optimized_shipment ?? (fee as any).metadata?.is_optimized;
        const shipmentId = cohort.primary_id;
        
        let expected = cohort.net_value;
        let overcharge = 0;
        let evidenceMode: 'strong' | 'weak' | 'missing' = (isOptimized !== undefined) ? 'strong' : 'missing';
        let policyMode: 'verified' | 'inferred' | 'unknown' = (isOptimized !== undefined) ? 'verified' : 'unknown';

        if (isOptimized === true) {
            expected = 0;
            overcharge = cohort.net_value;
        }

        if (overcharge > 5.0) {
            results.push({
                seller_id: sellerId, sync_id: syncId, anomaly_type: 'inbound_placement_fee_error',
                severity: calculateSeverity(overcharge), estimated_value: overcharge, currency: config.currency,
                confidence_score: evidenceMode === 'strong' ? 0.95 : 0.6,
                related_event_ids: cohort.events.map(e => e.id), discovery_date: discoveryDate,
                deadline_date: deadline, days_remaining: daysRemaining,
                evidence: {
                    fee_type: cohort.fee_type, charged_amount: cohort.net_value, expected_amount: expected,
                    overcharge_amount: overcharge, overcharge_percentage: (overcharge / cohort.net_value) * 100,
                    calculation_method: 'cohort_lifecycle_reconstruction',
                    calculation_inputs: { shipmentId, isOptimized, cohort_state: cohort.state },
                    evidence_summary: `Inbound placement fee for optimized shipment ${shipmentId}.`,
                    fee_event_ids: cohort.events.map(e => e.id), tenant_isolation_verified: true,
                    placement_policy_mode: policyMode, optimization_evidence_mode: evidenceMode,
                    schedule_version: '2025', effective_date_mode: 'exact',
                    evidence_class: cohort.evidence_class, cohort_id: cohort.id
                }
            });
        }
    });
    return results;
}

export function detectDuplicateFees(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    const cohorts = reconstructFeeCohorts(data);
    const duplicateCandidates = cohorts.filter(c => c.state === 'DUPLICATE_CANDIDATE' || c.state === 'NET_OVERCHARGED' || c.state === 'OPEN_CHARGE');

    duplicateCandidates.forEach(cohort => {
        // Evaluate internal duplicates via fingerprinting
        // Duplicates require a hard ID to avoid proximity-only false positives
        if (cohort.evidence_class === 'SKU_IDENTITY_MATCH' || cohort.evidence_class === 'TEMPORAL_PROXIMITY_ONLY' || cohort.evidence_class === 'UNRESOLVED') return;
        const fingerprintMap = new Map<string, FeeEvent[]>();
        cohort.events.forEach(e => {
            const fp = getDuplicateIntentIdentity(e);
            const existing = fingerprintMap.get(fp) || [];
            existing.push(e);
            fingerprintMap.set(fp, existing);
        });

        for (const [fp, group] of fingerprintMap) {
            if (group.length > 1) {
                let validGroup = group;
                const isAdjustment = group.some(e => e.fee_type === 'Adjustment');
                
                if (isAdjustment) {
                    const sorted = [...group].sort((a,b) => new Date(a.fee_date).getTime() - new Date(b.fee_date).getTime());
                    const validEvents = [sorted[0]];
                    for (let i = 1; i < sorted.length; i++) {
                        const prev = new Date(sorted[i-1].fee_date).getTime();
                        const curr = new Date(sorted[i].fee_date).getTime();
                        if ((curr - prev) <= 7.0 * 24 * 60 * 60 * 1000) {
                            // Only count if it's within 7 days of the previous one
                            validEvents.push(sorted[i]);
                        }
                    }
                    if (validEvents.length < 2) continue;
                    validGroup = validEvents;
                }
                
                const duplicateValue = Math.abs(validGroup[0].fee_amount) * (validGroup.length - 1);
                
                results.push({
                    seller_id: sellerId,
                    sync_id: syncId,
                    anomaly_type: 'duplicate_fee_error',
                    severity: calculateSeverity(duplicateValue),
                    estimated_value: duplicateValue,
                    currency: group[0].currency || 'USD',
                    confidence_score: 0.98,
                    related_event_ids: group.map(e => e.id),
                    discovery_date: discoveryDate,
                    deadline_date: deadline,
                    days_remaining: daysRemaining,
                    evidence: {
                        fee_type: cohort.fee_type,
                        charged_amount: Math.abs(group[0].fee_amount) * group.length,
                        expected_amount: Math.abs(group[0].fee_amount),
                        overcharge_amount: duplicateValue,
                        overcharge_percentage: ((group.length - 1) / group.length) * 100,
                        calculation_method: 'deterministic_fingerprint_matching',
                        calculation_inputs: { fingerprint: fp, count: group.length },
                        evidence_summary: `Duplicate ${cohort.fee_type} detected via fingerprint matching.`,
                        fee_event_ids: group.map(e => e.id),
                        duplicate_fingerprint_mode: 'hashed_deterministic',
                        evidence_class: 'STRICT_IDENTITY_MATCH',
                        cohort_id: cohort.id
                    }
                });
            }
        }
    });

    return results;
}

export function detectAllFeeOvercharges(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    logger.info('💰 [FEE AUDITOR] Running all fee detection algorithms (Updated Round 3C)', { sellerId, syncId });
    
    const results = [
        ...detectFulfillmentFeeOvercharge(sellerId, syncId, data),
        ...detectStorageFeeOvercharge(sellerId, syncId, data),
        ...detectCommissionOvercharge(sellerId, syncId, data),
        ...detectLowInventoryFeeOvercharge(sellerId, syncId, data),
        ...detectReturnProcessingFeeOvercharge(sellerId, syncId, data),
        ...detectInboundPlacementFeeOvercharge(sellerId, syncId, data),
        ...detectDuplicateFees(sellerId, syncId, data)
    ];

    const reconciled = reconcileValuationOwnership(results);
    const reviewOnly = detectFeeSignPolarityReview(sellerId, syncId, data);
    return [...enrichWithObservability(reconciled, data), ...reviewOnly];
}

export function detectFeeSignPolarityReview(sellerId: string, syncId: string, data: FeeSyncedData): FeeDetectionResult[] {
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);
    const results: FeeDetectionResult[] = [];

    for (const event of data.fee_events || []) {
        if (event.raw_amount === undefined || event.raw_amount === null) continue;
        const rawAmount = Number(event.raw_amount);
        if (!Number.isFinite(rawAmount) || rawAmount <= 0) continue;

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: 'fee_sign_polarity_review',
            severity: rawAmount >= 100 ? 'high' : rawAmount >= 25 ? 'medium' : 'low',
            estimated_value: 0,
            currency: event.currency || 'USD',
            confidence_score: 0.68,
            related_event_ids: [event.id],
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            sku: event.sku,
            asin: event.asin,
            product_name: event.product_name,
            evidence: buildReviewAnomalyEvidence(
                'A fee row has a positive source amount. Margin keeps it as sign-polarity review before deciding whether it is a charge, reversal, or import-normalization issue.',
                {
                    detection_type: 'fee_sign_polarity_review',
                    fee_type: event.fee_type,
                    charged_amount: rawAmount,
                    expected_amount: 0,
                    overcharge_amount: 0,
                    overcharge_percentage: 0,
                    calculation_method: 'raw_fee_sign_polarity_check',
                    calculation_inputs: {
                        raw_amount: rawAmount,
                        normalized_fee_amount: event.fee_amount,
                        raw_event_type: event.raw_event_type,
                    },
                    evidence_summary: `Fee row ${event.id} has positive source amount $${rawAmount.toFixed(2)} before fee normalization.`,
                    fee_event_ids: [event.id],
                    reference_id: event.reference_id,
                    raw_amount: rawAmount,
                    normalized_fee_amount: event.fee_amount,
                    exposure_value: rawAmount,
                    value_label: 'potential_exposure',
                } as any,
            ) as any,
        });
    }

    return results;
}

/**
 * Enriches the final emitted anomalies with structured explanations,
 * trace graphs, and confidence bands, strictly isolated from detection logic.
 */
function enrichWithObservability(results: FeeDetectionResult[], data: FeeSyncedData): FeeDetectionResult[] {
    const eventLookup = new Map(data.fee_events.map(e => [e.id, e]));

    return results.map(result => {
        // 1. Confidence Band Mapping
        const evClass = result.evidence.evidence_class;
        let band: 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
        if (evClass === 'STRICT_REFERENCE_MATCH') band = 'HIGH';
        else if (evClass === 'STRICT_IDENTITY_MATCH' || evClass === 'SKU_IDENTITY_MATCH') band = 'MEDIUM';
        else if (evClass === 'APPROVED_MAPPING_MATCH') band = 'LOW';
        
        if (band) result.confidence_band = band;

        // 2. Explanation Object
        result.evidence.explanation = {
            cohort_id: result.evidence.cohort_id || 'unlinked',
            fee_family: result.anomaly_type,
            evidence_class: evClass,
            valuation_owner: result.anomaly_type === 'duplicate_fee_error' ? 'Duplicate Detector' : 'Rate Auditor',
            expected_fee: result.evidence.expected_amount,
            observed_fee: result.evidence.charged_amount,
            recoverable_delta: result.evidence.overcharge_amount,
            unit_identity_basis: result.evidence.calculation_method || 'unknown_unit_basis',
            linked_events: result.related_event_ids
        };

        // 3. Cohort Trace Graph
        const events = result.related_event_ids
            .map(id => eventLookup.get(id))
            .filter((e): e is FeeEvent => e !== undefined)
            .sort((a,b) => new Date(a.fee_date).getTime() - new Date(b.fee_date).getTime());
            
        result.evidence.cohort_trace_graph = events.map(e => {
            const dateStr = e.fee_date.substring(0, 10);
            const amtStr = e.fee_amount < 0 ? `-$${Math.abs(e.fee_amount).toFixed(2)}` : `+$${e.fee_amount.toFixed(2)}`;
            const typeStr = e.fee_amount < 0 ? (getCanonicalType(e.fee_type) === 'Adjustment' ? 'Adjustment(Charge)' : 'Charge') : 'Reversal/Credit';
            return `[${dateStr}] ${typeStr} (${e.fee_type}) ${amtStr}`;
        });

        return result;
    });
}

/**
 * Reconcile Valuation Ownership (Round 3C)
 * Ensures exactly one authoritative claim-value owner for each economic harm.
 */
function reconcileValuationOwnership(results: FeeDetectionResult[]): FeeDetectionResult[] {
    const reconciled: FeeDetectionResult[] = [];
    const cohortOwnershipMap = new Map<string, FeeDetectionResult[]>();

    results.forEach(r => {
        const cohortId = r.evidence.cohort_id || 'unlinked';
        const existing = cohortOwnershipMap.get(cohortId) || [];
        existing.push(r);
        cohortOwnershipMap.set(cohortId, existing);
    });

    for (const [cohortId, cohortResults] of cohortOwnershipMap) {
        if (cohortId === 'unlinked') {
            reconciled.push(...cohortResults);
            continue;
        }

        // Rule 1: Duplicate detection owns value for repeated posting
        const dupeResult = cohortResults.find(r => r.anomaly_type === 'duplicate_fee_error');
        // Rule 2: Auditor owns value for wrong expected fee
        const auditorResult = cohortResults.find(r => r.anomaly_type !== 'duplicate_fee_error' && r.anomaly_type !== 'size_tier_misclassification');
        
        if (dupeResult && auditorResult) {
            // Split Ownership: Dupe owns redundant rows, Auditor owns rate error on the base
            // Total harm is already correctly computed by each if they use the new unitBasis logic.
            reconciled.push(dupeResult);
            reconciled.push(auditorResult);
        } else {
            reconciled.push(...cohortResults);
        }
    }

    return reconciled;
}

export async function fetchFeeEvents(sellerId: string, options?: { startDate?: string; limit?: number; syncId?: string }) {
    const tenantId = await resolveTenantId(sellerId);

    if (await relationExists('fee_events')) {
        let query: any = supabaseAdmin
            .from('fee_events')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('seller_id', sellerId)
            .order('fee_date', { ascending: false });
        if (options?.syncId) query = query.eq('sync_id', options.syncId);
        if (options?.startDate) query = query.gte('fee_date', options.startDate);
        if (options?.limit) query = query.limit(options.limit);
        const { data, error } = await query;
        if (!error) {
            return data || [];
        }
        if (options?.syncId) {
            logger.warn('💰 [FEE] Scoped fee_events read failed, falling back to sync-scoped financial_events only', {
                sellerId,
                syncId: options.syncId,
                error: error.message
            });
        } else {
            return [];
        }
    }

    if (!(await relationExists('financial_events'))) {
        return [];
    }

    let query = supabaseAdmin
        .from('financial_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('seller_id', sellerId)
        .eq('event_type', 'fee')
        .order('event_date', { ascending: false });
    if (options?.syncId) query = query.eq('sync_id', options.syncId);
    if (options?.startDate) query = query.gte('event_date', options.startDate);
    if (options?.limit) query = query.limit(options.limit);
    const { data } = await query;
    return (data || []).map((row: any) => ({
        id: row.id,
        seller_id: sellerId,
        order_id: row.amazon_order_id || undefined,
        shipment_id: row.shipment_id || row.raw_payload?.ShipmentId || undefined,
        sku: row.sku || row.amazon_sku || undefined,
        asin: row.asin || row.raw_payload?.ASIN || undefined,
        fnsku: row.fnsku || row.raw_payload?.FNSKU || undefined,
        product_name: row.product_name || undefined,
        fee_type: row.description || row.raw_payload?.FeeType || 'Fee',
        fee_amount: Number(row.amount || 0) * -1,
        raw_amount: Number(row.amount || 0),
        raw_event_type: row.event_subtype || row.raw_payload?.EventType || row.event_type,
        reference_id: row.reference_id || row.amazon_event_id || row.raw_payload?.ReferenceId,
        currency: row.currency || 'USD',
        item_weight_oz: row.raw_payload?.weight_oz,
        item_length_in: row.raw_payload?.length_in,
        item_width_in: row.raw_payload?.width_in,
        item_height_in: row.raw_payload?.height_in,
        dimensional_weight_oz: row.raw_payload?.dimensional_weight_oz,
        cubic_feet: row.raw_payload?.cubic_feet,
        storage_month: row.raw_payload?.storage_month,
        storage_type: row.raw_payload?.storage_type,
        sale_price: row.raw_payload?.sale_price,
        referral_rate: row.raw_payload?.referral_rate,
        expected_fee: row.raw_payload?.expected_fee,
        fee_date: row.event_date,
        marketplace_id: row.marketplace_id || DEFAULT_MARKETPLACE,
        created_at: row.created_at,
    }));
}

const PRODUCT_CATALOG_SCOPE_POLICY = 'historical_catalog_unavailable_for_sync_scoped_runs';

export async function fetchProductCatalog(sellerId: string, syncId?: string) {
    if (!(await relationExists('product_catalog'))) {
        return [];
    }
    if (syncId) {
        logger.warn('💰 [FEE] Product catalog is seller-wide only; excluding it from sync-scoped detection input', {
            sellerId,
            syncId,
            scopePolicy: PRODUCT_CATALOG_SCOPE_POLICY
        });
        return [];
    }
    const { data } = await supabaseAdmin.from('product_catalog').select('*').eq('seller_id', sellerId);
    return data || [];
}

export type FeeDetectionPersistenceResult = {
    success: boolean;
    attemptedCount: number;
    persistedCount: number;
    error?: string;
};

export async function runFeeOverchargeDetection(sellerId: string, syncId: string) {
    const lookback = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const [events, catalog] = await Promise.all([
        fetchFeeEvents(sellerId, { startDate: lookback, syncId }),
        fetchProductCatalog(sellerId, syncId)
    ]);
    const results = await detectAllFeeOvercharges(sellerId, syncId, { seller_id: sellerId, sync_id: syncId, fee_events: events, product_catalog: catalog });
    
    if (results.length > 0) {
        const persistence = await storeFeeDetectionResults(results);
        if (!persistence.success) {
            throw new Error(persistence.error || 'Fee detection persistence failed');
        }
    }
    
    return results;
}

export async function storeFeeDetectionResults(results: FeeDetectionResult[]): Promise<FeeDetectionPersistenceResult> {
    if (results.length === 0) {
        return { success: true, attemptedCount: 0, persistedCount: 0 };
    }
    const tenantId = await resolveTenantId(results[0].seller_id);
    const sourceType = await requireDetectionSourceType(tenantId, results[0].seller_id, results[0].sync_id);
    const records = results.map(r => ({
        seller_id: r.seller_id,
        sync_id: r.sync_id,
        anomaly_type: r.anomaly_type,
        severity: r.severity,
        estimated_value: r.estimated_value,
        currency: r.currency,
        confidence_score: r.confidence_score,
        evidence: {
            ...r.evidence,
            sku: r.evidence?.sku ?? r.sku,
            asin: r.evidence?.asin ?? r.asin,
            product_name: r.evidence?.product_name ?? r.product_name,
        },
        related_event_ids: r.related_event_ids,
        discovery_date: r.discovery_date.toISOString(),
        deadline_date: r.deadline_date.toISOString(),
        days_remaining: r.days_remaining,
        tenant_id: tenantId,
        source_type: sourceType,
        status: 'detected',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabaseAdmin
        .from('detection_results')
        .insert(records)
        .select('id, anomaly_type');

    if (error) {
        const message = `Fee detection persistence failed: ${error.message}`;
        logger.error('❌ [FEE] Detection persistence failed', {
            sellerId: results[0].seller_id,
            syncId: results[0].sync_id,
            attemptedCount: records.length,
            anomalyTypes: records.map(record => record.anomaly_type),
            error: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
        });

        return {
            success: false,
            attemptedCount: records.length,
            persistedCount: 0,
            error: message,
        };
    }

    const persistedCount = Array.isArray(data) ? data.length : records.length;
    logger.info('✅ [FEE] Detection results persisted', {
        sellerId: results[0].seller_id,
        syncId: results[0].sync_id,
        attemptedCount: records.length,
        persistedCount,
        anomalyTypes: records.map(record => record.anomaly_type),
    });

    return {
        success: true,
        attemptedCount: records.length,
        persistedCount,
    };
}

export default {
    detectFulfillmentFeeOvercharge, detectStorageFeeOvercharge, detectCommissionOvercharge,
    detectAllFeeOvercharges, detectFeeSignPolarityReview, fetchFeeEvents, fetchProductCatalog, runFeeOverchargeDetection, storeFeeDetectionResults
};
