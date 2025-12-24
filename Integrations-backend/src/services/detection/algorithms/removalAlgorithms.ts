/**
 * Removal & Disposal Detection Algorithms - "The Removal Tracker"
 * 
 * DISTINCT Detection Logic for Each Anomaly Type:
 * 1. removal_unfulfilled - Requested return, items never shipped back
 * 2. disposal_incomplete - Requested disposal, not all units processed
 * 3. removal_in_transit_lost - Removal shipped, never arrived at destination
 * 4. liquidation_undervalue - Liquidation paid less than expected
 * 5. removal_fee_overcharge - Charged more than standard removal fee
 * 
 * Each type has its OWN detection function with specific logic.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type RemovalAnomalyType =
    | 'removal_unfulfilled'
    | 'disposal_incomplete'
    | 'removal_in_transit_lost'
    | 'liquidation_undervalue'
    | 'removal_fee_overcharge';

export interface RemovalOrderDetail {
    id: string; seller_id: string; order_id: string;
    order_type: 'Return' | 'Disposal' | 'Liquidation';
    order_status: string; sku: string; fnsku?: string; asin?: string; product_name?: string;
    requested_quantity: number; shipped_quantity?: number; disposed_quantity?: number;
    cancelled_quantity?: number; liquidation_proceeds?: number; expected_liquidation?: number;
    request_date: string; completion_date?: string; ship_date?: string;
    removal_fee?: number; expected_fee?: number;
    tracking_id?: string; carrier?: string; destination_address?: string;
    created_at: string;
}

export interface RemovalSyncedData {
    seller_id: string; sync_id: string;
    removal_orders: RemovalOrderDetail[];
    reimbursement_events: Array<{ id: string; order_id?: string; sku?: string; reimbursement_amount: number }>;
}

export interface RemovalDetectionResult {
    seller_id: string; sync_id: string; anomaly_type: RemovalAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical'; estimated_value: number; currency: string;
    confidence_score: number; evidence: any; related_event_ids: string[];
    discovery_date: Date; deadline_date: Date; days_remaining: number;
    order_id: string; sku?: string; fnsku?: string; product_name?: string;
}

const daysBetween = (d1: Date, d2: Date) => Math.ceil(Math.abs(d2.getTime() - d1.getTime()) / 86400000);
const severity = (v: number): 'low' | 'medium' | 'high' | 'critical' => v >= 300 ? 'critical' : v >= 100 ? 'high' : v >= 30 ? 'medium' : 'low';

function buildReimbLookup(reimbs: any[]): Map<string, any[]> {
    const map = new Map<string, any[]>();
    for (const r of reimbs) { if (r.order_id) map.set(r.order_id, [...(map.get(r.order_id) || []), r]); }
    return map;
}

// ============================================================================
// 1. REMOVAL UNFULFILLED - Return requested but never shipped
// ============================================================================

/**
 * Detect Removal Unfulfilled
 * 
 * LOGIC: Order type = 'Return', status = 'Completed', but shipped_quantity = 0
 * RULE: You asked for items back, Amazon marked complete, but nothing shipped
 * CONFIDENCE: 90% (clear discrepancy - complete but 0 shipped)
 */
export function detectRemovalUnfulfilled(sellerId: string, syncId: string, data: RemovalSyncedData): RemovalDetectionResult[] {
    const results: RemovalDetectionResult[] = [];
    const now = new Date();
    const reimbByOrder = buildReimbLookup(data.reimbursement_events || []);

    for (const order of data.removal_orders || []) {
        if (order.order_type !== 'Return') continue;
        if (order.order_status?.toLowerCase() !== 'completed') continue;

        const daysSince = daysBetween(new Date(order.request_date), now);
        if (daysSince < 60) continue;

        const shippedQty = order.shipped_quantity || 0;
        if (shippedQty > 0) continue; // Something was shipped

        const missingQty = order.requested_quantity - (order.cancelled_quantity || 0);
        if (missingQty <= 0) continue;

        const reimbs = reimbByOrder.get(order.order_id) || [];
        if (reimbs.some(r => r.sku === order.sku)) continue;

        const value = missingQty * 18;
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'removal_unfulfilled',
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.90,
            evidence: {
                order_id: order.order_id, order_type: 'Return', sku: order.sku,
                requested: order.requested_quantity, shipped: 0, days_since: daysSince,
                summary: `Removal ${order.order_id}: Requested ${order.requested_quantity} units returned, NONE shipped. Status: Completed. ${daysSince} days since request.`
            },
            related_event_ids: [order.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            order_id: order.order_id, sku: order.sku, fnsku: order.fnsku, product_name: order.product_name
        });
    }
    return results;
}

// ============================================================================
// 2. DISPOSAL INCOMPLETE - Disposal not fully processed
// ============================================================================

/**
 * Detect Disposal Incomplete
 * 
 * LOGIC: Order type = 'Disposal', status = 'Completed', disposed < requested
 * RULE: Asked to destroy X units, only Y destroyed, X-Y unaccounted for
 * CONFIDENCE: 85% (disposals have less tracking than returns)
 */
export function detectDisposalIncomplete(sellerId: string, syncId: string, data: RemovalSyncedData): RemovalDetectionResult[] {
    const results: RemovalDetectionResult[] = [];
    const now = new Date();
    const reimbByOrder = buildReimbLookup(data.reimbursement_events || []);

    for (const order of data.removal_orders || []) {
        if (order.order_type !== 'Disposal') continue;
        if (order.order_status?.toLowerCase() !== 'completed') continue;

        const daysSince = daysBetween(new Date(order.request_date), now);
        if (daysSince < 60) continue;

        const disposedQty = order.disposed_quantity || 0;
        const missingQty = order.requested_quantity - disposedQty - (order.cancelled_quantity || 0);
        if (missingQty <= 0) continue;

        const reimbs = reimbByOrder.get(order.order_id) || [];
        if (reimbs.some(r => r.sku === order.sku)) continue;

        const value = missingQty * 15; // Lower value since it was destined for disposal
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'disposal_incomplete',
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.85,
            evidence: {
                order_id: order.order_id, order_type: 'Disposal', sku: order.sku,
                requested: order.requested_quantity, disposed: disposedQty, missing: missingQty,
                summary: `Disposal ${order.order_id}: Requested ${order.requested_quantity} units destroyed, only ${disposedQty} processed. ${missingQty} units unaccounted.`
            },
            related_event_ids: [order.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            order_id: order.order_id, sku: order.sku, fnsku: order.fnsku, product_name: order.product_name
        });
    }
    return results;
}

// ============================================================================
// 3. REMOVAL IN TRANSIT LOST - Shipped but never arrived
// ============================================================================

/**
 * Detect Removal In Transit Lost
 * 
 * LOGIC: tracking_id exists, ship_date exists, but items never received
 * RULE: Amazon shipped it, carrier lost it - Amazon should reimburse
 * CONFIDENCE: 88% (needs tracking verification)
 */
export function detectRemovalInTransitLost(sellerId: string, syncId: string, data: RemovalSyncedData): RemovalDetectionResult[] {
    const results: RemovalDetectionResult[] = [];
    const now = new Date();

    for (const order of data.removal_orders || []) {
        if (order.order_type !== 'Return') continue;
        if (!order.tracking_id || !order.ship_date) continue;

        const daysSinceShip = daysBetween(new Date(order.ship_date), now);
        if (daysSinceShip < 30) continue; // Allow transit time
        if (daysSinceShip > 180) continue; // Too old

        // If status is still 'In Transit' or 'Shipped' after 30 days, likely lost
        const status = order.order_status?.toLowerCase();
        const isStuck = status === 'in transit' || status === 'shipped' || status === 'processing';
        if (!isStuck) continue;

        const shippedQty = order.shipped_quantity || order.requested_quantity;
        const value = shippedQty * 18;

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'removal_in_transit_lost',
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.88,
            evidence: {
                order_id: order.order_id, sku: order.sku, tracking: order.tracking_id,
                carrier: order.carrier, ship_date: order.ship_date, status: order.order_status,
                days_in_transit: daysSinceShip, quantity: shippedQty,
                summary: `Removal ${order.order_id}: Shipped ${daysSinceShip} days ago (${order.carrier}, ${order.tracking_id}) but status still "${order.order_status}". ${shippedQty} units likely lost in transit.`
            },
            related_event_ids: [order.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            order_id: order.order_id, sku: order.sku, fnsku: order.fnsku, product_name: order.product_name
        });
    }
    return results;
}

// ============================================================================
// 4. LIQUIDATION UNDERVALUE - Paid less than expected
// ============================================================================

/**
 * Detect Liquidation Undervalue
 * 
 * LOGIC: Order type = 'Liquidation', proceeds < expected threshold
 * RULE: Amazon's liquidation partner should pay fair market rate
 * CONFIDENCE: 75% (liquidation values are variable)
 */
export function detectLiquidationUndervalue(sellerId: string, syncId: string, data: RemovalSyncedData): RemovalDetectionResult[] {
    const results: RemovalDetectionResult[] = [];
    const now = new Date();

    for (const order of data.removal_orders || []) {
        if (order.order_type !== 'Liquidation') continue;
        if (order.order_status?.toLowerCase() !== 'completed') continue;
        if (!order.liquidation_proceeds || !order.expected_liquidation) continue;

        const underpayment = order.expected_liquidation - order.liquidation_proceeds;
        if (underpayment <= 5) continue; // Threshold

        const underpayPercent = (underpayment / order.expected_liquidation) * 100;
        if (underpayPercent < 30) continue; // Only flag significant underpayments

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'liquidation_undervalue',
            severity: severity(underpayment), estimated_value: underpayment, currency: 'USD', confidence_score: 0.75,
            evidence: {
                order_id: order.order_id, sku: order.sku,
                expected: order.expected_liquidation, received: order.liquidation_proceeds,
                underpayment, underpay_percent: underpayPercent.toFixed(1),
                summary: `Liquidation ${order.order_id}: Expected $${order.expected_liquidation.toFixed(2)}, received $${order.liquidation_proceeds.toFixed(2)}. Underpaid by $${underpayment.toFixed(2)} (${underpayPercent.toFixed(1)}%).`
            },
            related_event_ids: [order.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            order_id: order.order_id, sku: order.sku, fnsku: order.fnsku, product_name: order.product_name
        });
    }
    return results;
}

// ============================================================================
// 5. REMOVAL FEE OVERCHARGE - Charged more than standard fee
// ============================================================================

/**
 * Detect Removal Fee Overcharge
 * 
 * LOGIC: removal_fee > expected_fee (standard rates)
 * RULE: Amazon has published removal fee rates; shouldn't exceed
 * CONFIDENCE: 90% (fee schedule is public)
 */
export function detectRemovalFeeOvercharge(sellerId: string, syncId: string, data: RemovalSyncedData): RemovalDetectionResult[] {
    const results: RemovalDetectionResult[] = [];
    const now = new Date();

    // Standard removal fees (2024)
    const STANDARD_REMOVAL_FEE = 0.97; // per unit
    const STANDARD_DISPOSAL_FEE = 0.35; // per unit

    for (const order of data.removal_orders || []) {
        if (!order.removal_fee || order.removal_fee <= 0) continue;

        const qty = order.requested_quantity || 1;
        const expectedFee = order.order_type === 'Disposal'
            ? qty * STANDARD_DISPOSAL_FEE
            : qty * STANDARD_REMOVAL_FEE;

        const overcharge = order.removal_fee - expectedFee;
        if (overcharge <= 0.50) continue; // Threshold

        const overchargePercent = (overcharge / expectedFee) * 100;
        if (overchargePercent < 20) continue; // Only flag significant overcharges

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'removal_fee_overcharge',
            severity: 'low', estimated_value: overcharge, currency: 'USD', confidence_score: 0.90,
            evidence: {
                order_id: order.order_id, order_type: order.order_type, sku: order.sku,
                quantity: qty, charged: order.removal_fee, expected: expectedFee, overcharge,
                summary: `Removal ${order.order_id}: Charged $${order.removal_fee.toFixed(2)} for ${qty} units, expected $${expectedFee.toFixed(2)}. Overcharged $${overcharge.toFixed(2)}.`
            },
            related_event_ids: [order.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            order_id: order.order_id, sku: order.sku, fnsku: order.fnsku, product_name: order.product_name
        });
    }
    return results;
}

// ============================================================================
// COMBINED RUNNER
// ============================================================================

export function detectRemovalAnomalies(sellerId: string, syncId: string, data: RemovalSyncedData): RemovalDetectionResult[] {
    logger.info('🗑️ [REMOVAL] Running all 5 distinct removal detection algorithms', { sellerId, syncId });

    const unfulfilled = detectRemovalUnfulfilled(sellerId, syncId, data);
    const disposalIncomplete = detectDisposalIncomplete(sellerId, syncId, data);
    const inTransitLost = detectRemovalInTransitLost(sellerId, syncId, data);
    const liquidation = detectLiquidationUndervalue(sellerId, syncId, data);
    const feeOvercharge = detectRemovalFeeOvercharge(sellerId, syncId, data);

    const all = [...unfulfilled, ...disposalIncomplete, ...inTransitLost, ...liquidation, ...feeOvercharge];

    logger.info('🗑️ [REMOVAL] Detection complete', {
        unfulfilled: unfulfilled.length, disposal: disposalIncomplete.length, lost: inTransitLost.length,
        liquidation: liquidation.length, fees: feeOvercharge.length,
        total: all.length, recovery: all.reduce((s, r) => s + r.estimated_value, 0)
    });

    return all;
}

/**
 * Fetch Removal Orders
 * 
 * ADAPTER: Agent 2 doesn't have removal_order_detail. 
 * We extract removal orders from shipments with appropriate filters.
 */
export async function fetchRemovalOrders(sellerId: string): Promise<RemovalOrderDetail[]> {
    try {
        const { data, error } = await supabaseAdmin
            .from('shipments')
            .select('*')
            .eq('user_id', sellerId)
            .order('shipped_date', { ascending: false })
            .limit(500);

        if (error) {
            logger.error('🗑️ [REMOVAL] Error fetching shipments', { sellerId, error: error.message });
            return [];
        }

        // Filter for removal-type shipments (OUTBOUND from FBA back to seller)
        const removalOrders: RemovalOrderDetail[] = (data || [])
            .filter(s => s.shipment_type === 'REMOVAL' || s.shipment_type === 'DISPOSAL' ||
                s.status?.includes('REMOVAL') || s.metadata?.order_type)
            .map(s => ({
                id: s.id || s.shipment_id,
                seller_id: sellerId,
                order_id: s.shipment_id,
                order_type: (s.metadata?.order_type || s.shipment_type || 'Return') as 'Return' | 'Disposal' | 'Liquidation',
                order_status: s.status || 'unknown',
                sku: s.sku || s.items?.[0]?.sku || '',
                fnsku: s.fnsku || s.items?.[0]?.fnsku,
                asin: s.asin || s.items?.[0]?.asin,
                product_name: s.product_name,
                requested_quantity: s.quantity || 0,
                shipped_quantity: s.quantity_shipped,
                disposed_quantity: s.metadata?.disposed_quantity,
                cancelled_quantity: s.metadata?.cancelled_quantity,
                liquidation_proceeds: s.metadata?.liquidation_proceeds,
                expected_liquidation: s.metadata?.expected_liquidation,
                request_date: s.created_at,
                completion_date: s.metadata?.completion_date,
                ship_date: s.shipped_date,
                removal_fee: s.metadata?.removal_fee,
                expected_fee: s.metadata?.expected_fee,
                tracking_id: s.tracking_id,
                carrier: s.metadata?.carrier,
                destination_address: s.metadata?.destination_address,
                created_at: s.created_at
            }));

        logger.info('🗑️ [REMOVAL] Fetched removal orders', { count: removalOrders.length });
        return removalOrders;
    } catch (err: any) {
        logger.error('🗑️ [REMOVAL] Exception fetching removal orders', { sellerId, error: err.message });
        return [];
    }
}

export async function runRemovalDetection(sellerId: string, syncId: string): Promise<RemovalDetectionResult[]> {
    const [orders, settlementsData] = await Promise.all([
        fetchRemovalOrders(sellerId),
        supabaseAdmin.from('settlements').select('*').eq('user_id', sellerId).eq('transaction_type', 'reimbursement').then(r => r.data || [])
    ]);

    // Transform settlements to reimbursement format
    const reimbs = settlementsData.map((s: any) => ({
        id: s.id || s.settlement_id,
        order_id: s.order_id,
        sku: s.metadata?.sku,
        reimbursement_amount: s.amount || 0
    }));

    return detectRemovalAnomalies(sellerId, syncId, { seller_id: sellerId, sync_id: syncId, removal_orders: orders, reimbursement_events: reimbs });
}

export async function storeRemovalResults(results: RemovalDetectionResult[]): Promise<void> {
    if (!results.length) return;
    await supabaseAdmin.from('detection_results').upsert(results.map(r => ({
        ...r, discovery_date: r.discovery_date.toISOString(), deadline_date: r.deadline_date.toISOString(), status: 'open', created_at: new Date().toISOString()
    })));
}

export default { detectRemovalUnfulfilled, detectDisposalIncomplete, detectRemovalInTransitLost, detectLiquidationUndervalue, detectRemovalFeeOvercharge, detectRemovalAnomalies, runRemovalDetection, storeRemovalResults };
