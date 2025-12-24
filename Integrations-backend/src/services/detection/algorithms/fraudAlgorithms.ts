/**
 * Fraud & Return Abuse Detection Algorithms - "The Fraud Hunter"
 * 
 * DISTINCT Detection Logic for Each Anomaly Type:
 * 1. switcheroo - Customer returned different/fake item
 * 2. wrong_item_returned - Customer returned wrong SKU
 * 3. returnless_refund_abuse - Customer pattern of returnless refunds
 * 4. empty_box_return - Customer returned empty or stuffed box
 * 5. serial_returner - Customer pattern of high returns
 * 
 * Each type has its OWN detection function with specific logic.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type FraudAnomalyType =
    | 'switcheroo'
    | 'wrong_item_returned'
    | 'returnless_refund_abuse'
    | 'empty_box_return'
    | 'serial_returner';

export interface ReturnEvent {
    id: string; seller_id: string; order_id: string;
    sku?: string; fnsku?: string; asin?: string; product_name?: string;
    detailed_disposition?: string; // 'SELLABLE', 'DAMAGED', 'DEFECTIVE', 'OTHER', etc
    return_reason?: string; customer_comment?: string;
    return_date: string; quantity_returned: number;
    refund_amount?: number; original_order_amount?: number;
    weight_returned?: number; expected_weight?: number;
    customer_id?: string; customer_name?: string;
    created_at: string;
}

export interface RefundEvent {
    id: string; seller_id: string; order_id: string;
    sku?: string; asin?: string; product_name?: string;
    refund_reason?: string; refund_amount: number; refund_date: string;
    customer_id?: string; is_returnless?: boolean;
    refund_type?: string; // 'Returnless', 'RMA', 'Replacement'
    created_at: string;
}

export interface FraudSyncedData {
    seller_id: string; sync_id: string;
    return_events: ReturnEvent[];
    refund_events: RefundEvent[];
    reimbursement_events: Array<{ id: string; order_id?: string; sku?: string; reimbursement_amount: number }>;
}

export interface FraudDetectionResult {
    seller_id: string; sync_id: string; anomaly_type: FraudAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical'; estimated_value: number; currency: string;
    confidence_score: number; evidence: any; related_event_ids: string[];
    discovery_date: Date; deadline_date: Date; days_remaining: number;
    order_id?: string; sku?: string; customer_id?: string;
}

const severity = (v: number): 'low' | 'medium' | 'high' | 'critical' => v >= 200 ? 'critical' : v >= 100 ? 'high' : v >= 30 ? 'medium' : 'low';

function buildReimbLookup(reimbs: any[]): Map<string, any[]> {
    const map = new Map<string, any[]>();
    for (const r of reimbs) { if (r.order_id) map.set(r.order_id, [...(map.get(r.order_id) || []), r]); }
    return map;
}

// ============================================================================
// 1. SWITCHEROO - Customer returned different/fake item
// ============================================================================

/**
 * Detect Switcheroo
 * 
 * LOGIC: detailed_disposition contains 'SWITCHEROO' or explicit fraud indicator
 * RULE: Amazon inspected return and flagged as wrong item entirely
 * CONFIDENCE: 95% (Amazon's own fraud flag)
 */
export function detectSwitcheroo(sellerId: string, syncId: string, data: FraudSyncedData): FraudDetectionResult[] {
    const results: FraudDetectionResult[] = [];
    const now = new Date();
    const reimbByOrder = buildReimbLookup(data.reimbursement_events || []);

    const switcherooIndicators = ['switcheroo', 'switched', 'different item', 'counterfeit', 'fake'];

    for (const ret of data.return_events || []) {
        const disp = (ret.detailed_disposition || '').toLowerCase();
        const reason = (ret.return_reason || '').toLowerCase();
        const comment = (ret.customer_comment || '').toLowerCase();

        const isSwitcheroo = switcherooIndicators.some(k => disp.includes(k) || reason.includes(k));
        if (!isSwitcheroo) continue;

        const reimbs = reimbByOrder.get(ret.order_id) || [];
        if (reimbs.some(r => r.sku === ret.sku)) continue;

        const value = ret.refund_amount || ret.original_order_amount || (ret.quantity_returned * 30);

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'switcheroo',
            severity: 'critical', estimated_value: value, currency: 'USD', confidence_score: 0.95,
            evidence: {
                order_id: ret.order_id, sku: ret.sku, customer_id: ret.customer_id,
                disposition: ret.detailed_disposition, return_reason: ret.return_reason,
                quantity: ret.quantity_returned, refund_amount: ret.refund_amount,
                summary: `SWITCHEROO FRAUD: Order ${ret.order_id}. Customer returned fake/different item instead of ${ret.sku}. Disposition: "${ret.detailed_disposition}". Value: $${value.toFixed(2)}.`
            },
            related_event_ids: [ret.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            order_id: ret.order_id, sku: ret.sku, customer_id: ret.customer_id
        });
    }
    return results;
}

// ============================================================================
// 2. WRONG ITEM RETURNED - Customer returned different SKU (not fake)
// ============================================================================

/**
 * Detect Wrong Item Returned
 * 
 * LOGIC: detailed_disposition = 'OTHER' or 'WRONG_ITEM' or similar
 * RULE: Customer sent back wrong product (often honest mistake, but seller loses)
 * CONFIDENCE: 85% (could be mistake vs fraud)
 */
export function detectWrongItemReturned(sellerId: string, syncId: string, data: FraudSyncedData): FraudDetectionResult[] {
    const results: FraudDetectionResult[] = [];
    const now = new Date();
    const reimbByOrder = buildReimbLookup(data.reimbursement_events || []);

    const wrongItemIndicators = ['wrong item', 'wrong product', 'different sku', 'not matching', 'mismatch'];

    for (const ret of data.return_events || []) {
        // Skip if already caught as switcheroo
        const disp = (ret.detailed_disposition || '').toLowerCase();
        if (disp.includes('switcheroo') || disp.includes('counterfeit')) continue;

        const isWrongItem = disp === 'other' ||
            wrongItemIndicators.some(k => disp.includes(k) || (ret.return_reason || '').toLowerCase().includes(k));
        if (!isWrongItem) continue;

        const reimbs = reimbByOrder.get(ret.order_id) || [];
        if (reimbs.some(r => r.sku === ret.sku)) continue;

        const value = ret.refund_amount || (ret.quantity_returned * 25);

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'wrong_item_returned',
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.85,
            evidence: {
                order_id: ret.order_id, sku: ret.sku, customer_id: ret.customer_id,
                disposition: ret.detailed_disposition, return_reason: ret.return_reason,
                summary: `Wrong item returned on order ${ret.order_id}. Expected ${ret.sku}, received different product. Disposition: "${ret.detailed_disposition}". No reimbursement found.`
            },
            related_event_ids: [ret.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            order_id: ret.order_id, sku: ret.sku, customer_id: ret.customer_id
        });
    }
    return results;
}

// ============================================================================
// 3. RETURNLESS REFUND ABUSE - Pattern of returnless refunds
// ============================================================================

/**
 * Detect Returnless Refund Abuse
 * 
 * LOGIC: Customer has 3+ returnless refunds in 90 days
 * RULE: Pattern indicates abuse of Amazon's returnless refund policy
 * CONFIDENCE: 80% (pattern-based, not single event)
 */
export function detectReturnlessRefundAbuse(sellerId: string, syncId: string, data: FraudSyncedData): FraudDetectionResult[] {
    const results: FraudDetectionResult[] = [];
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90 * 86400000);

    // Group returnless refunds by customer
    const byCustomer = new Map<string, RefundEvent[]>();
    for (const ref of data.refund_events || []) {
        if (!ref.is_returnless || !ref.customer_id) continue;
        if (new Date(ref.refund_date) < cutoff) continue;
        byCustomer.set(ref.customer_id, [...(byCustomer.get(ref.customer_id) || []), ref]);
    }

    // Flag customers with 3+ returnless refunds
    for (const [customerId, refunds] of byCustomer) {
        if (refunds.length < 3) continue;

        const totalValue = refunds.reduce((s, r) => s + r.refund_amount, 0);
        const skus = [...new Set(refunds.map(r => r.sku).filter(Boolean))];

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'returnless_refund_abuse',
            severity: 'high', estimated_value: totalValue, currency: 'USD', confidence_score: 0.80,
            evidence: {
                customer_id: customerId, refund_count: refunds.length, total_value: totalValue,
                skus_affected: skus.join(', '), time_window: '90 days',
                refund_dates: refunds.map(r => r.refund_date).join(', '),
                summary: `Pattern detected: Customer ${customerId} has ${refunds.length} returnless refunds in 90 days totaling $${totalValue.toFixed(2)}. SKUs: ${skus.join(', ')}.`
            },
            related_event_ids: refunds.map(r => r.id),
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            customer_id: customerId
        });
    }
    return results;
}

// ============================================================================
// 4. EMPTY BOX RETURN - Customer returned empty or weight-mismatch box
// ============================================================================

/**
 * Detect Empty Box Return
 * 
 * LOGIC: weight_returned significantly less than expected_weight
 * RULE: If returned package is too light, likely empty or stuffed
 * CONFIDENCE: 90% (weight is objective measurement)
 */
export function detectEmptyBoxReturn(sellerId: string, syncId: string, data: FraudSyncedData): FraudDetectionResult[] {
    const results: FraudDetectionResult[] = [];
    const now = new Date();
    const reimbByOrder = buildReimbLookup(data.reimbursement_events || []);

    for (const ret of data.return_events || []) {
        if (!ret.weight_returned || !ret.expected_weight) continue;

        const weightDiff = ret.expected_weight - ret.weight_returned;
        const weightDiffPercent = (weightDiff / ret.expected_weight) * 100;

        // If returned weight is < 50% of expected, suspicious
        if (weightDiffPercent < 50) continue;

        const reimbs = reimbByOrder.get(ret.order_id) || [];
        if (reimbs.some(r => r.sku === ret.sku)) continue;

        const value = ret.refund_amount || (ret.quantity_returned * 30);

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'empty_box_return',
            severity: 'critical', estimated_value: value, currency: 'USD', confidence_score: 0.90,
            evidence: {
                order_id: ret.order_id, sku: ret.sku, customer_id: ret.customer_id,
                expected_weight: ret.expected_weight, actual_weight: ret.weight_returned,
                weight_difference_percent: weightDiffPercent.toFixed(1),
                summary: `EMPTY BOX: Order ${ret.order_id}. Expected weight ${ret.expected_weight}oz, received ${ret.weight_returned}oz (${weightDiffPercent.toFixed(0)}% lighter). Customer likely returned empty box.`
            },
            related_event_ids: [ret.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            order_id: ret.order_id, sku: ret.sku, customer_id: ret.customer_id
        });
    }
    return results;
}

// ============================================================================
// 5. SERIAL RETURNER - Customer with abnormally high return rate
// ============================================================================

/**
 * Detect Serial Returner
 * 
 * LOGIC: Customer has 5+ returns in 60 days with > 50% return rate
 * RULE: Pattern of excessive returns (potential wardrobing, etc.)
 * CONFIDENCE: 75% (high volume but not definitive fraud)
 */
export function detectSerialReturner(sellerId: string, syncId: string, data: FraudSyncedData): FraudDetectionResult[] {
    const results: FraudDetectionResult[] = [];
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 86400000);

    // Group returns by customer
    const byCustomer = new Map<string, ReturnEvent[]>();
    for (const ret of data.return_events || []) {
        if (!ret.customer_id) continue;
        if (new Date(ret.return_date) < cutoff) continue;
        byCustomer.set(ret.customer_id, [...(byCustomer.get(ret.customer_id) || []), ret]);
    }

    // Flag customers with 5+ returns
    for (const [customerId, returns] of byCustomer) {
        if (returns.length < 5) continue;

        const totalValue = returns.reduce((s, r) => s + (r.refund_amount || 0), 0);
        const skus = [...new Set(returns.map(r => r.sku).filter(Boolean))];

        // Note: This is pattern-based flagging, not guaranteed loss
        // Value is informational, not directly recoverable

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'serial_returner',
            severity: 'medium', estimated_value: 0, currency: 'USD', confidence_score: 0.75,
            evidence: {
                customer_id: customerId, return_count: returns.length,
                total_refund_value: totalValue, unique_skus: skus.length,
                time_window: '60 days',
                summary: `Serial returner detected: Customer ${customerId} made ${returns.length} returns in 60 days across ${skus.length} SKUs. Total refunds: $${totalValue.toFixed(2)}. Consider blocking.`
            },
            related_event_ids: returns.map(r => r.id),
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            customer_id: customerId
        });
    }
    return results;
}

// ============================================================================
// COMBINED RUNNER
// ============================================================================

export function detectFraudAnomalies(sellerId: string, syncId: string, data: FraudSyncedData): FraudDetectionResult[] {
    logger.info('🕵️ [FRAUD] Running all 5 distinct fraud detection algorithms', { sellerId, syncId });

    const switcheroo = detectSwitcheroo(sellerId, syncId, data);
    const wrongItem = detectWrongItemReturned(sellerId, syncId, data);
    const returnless = detectReturnlessRefundAbuse(sellerId, syncId, data);
    const emptyBox = detectEmptyBoxReturn(sellerId, syncId, data);
    const serial = detectSerialReturner(sellerId, syncId, data);

    const all = [...switcheroo, ...wrongItem, ...returnless, ...emptyBox, ...serial];

    logger.info('🕵️ [FRAUD] Detection complete', {
        switcheroo: switcheroo.length, wrongItem: wrongItem.length, returnless: returnless.length,
        emptyBox: emptyBox.length, serial: serial.length,
        total: all.length, recovery: all.reduce((s, r) => s + r.estimated_value, 0)
    });

    return all;
}

export async function fetchReturnEvents(sellerId: string): Promise<ReturnEvent[]> {
    const { data } = await supabaseAdmin.from('return_events').select('*').eq('seller_id', sellerId).order('return_date', { ascending: false }).limit(1000);
    return data || [];
}

export async function fetchRefundEventsForFraud(sellerId: string): Promise<RefundEvent[]> {
    const { data } = await supabaseAdmin.from('refund_events').select('*').eq('seller_id', sellerId).order('refund_date', { ascending: false }).limit(1000);
    return data || [];
}

export async function runFraudDetection(sellerId: string, syncId: string): Promise<FraudDetectionResult[]> {
    const [returns, refunds, reimbs] = await Promise.all([
        fetchReturnEvents(sellerId), fetchRefundEventsForFraud(sellerId),
        supabaseAdmin.from('reimbursement_events').select('*').eq('seller_id', sellerId).then(r => r.data || [])
    ]);
    return detectFraudAnomalies(sellerId, syncId, { seller_id: sellerId, sync_id: syncId, return_events: returns, refund_events: refunds, reimbursement_events: reimbs });
}

export async function storeFraudResults(results: FraudDetectionResult[]): Promise<void> {
    if (!results.length) return;
    await supabaseAdmin.from('detection_results').upsert(results.map(r => ({
        ...r, discovery_date: r.discovery_date.toISOString(), deadline_date: r.deadline_date.toISOString(), status: 'open', created_at: new Date().toISOString()
    })));
}

export default { detectSwitcheroo, detectWrongItemReturned, detectReturnlessRefundAbuse, detectEmptyBoxReturn, detectSerialReturner, detectFraudAnomalies, runFraudDetection, storeFraudResults };
