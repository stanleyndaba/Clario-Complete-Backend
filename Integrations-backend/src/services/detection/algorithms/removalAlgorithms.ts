/**
 * Removal & Disposal Detection - "The Removal Tracker"
 * CLUSTER 2: Removal/Disposal Errors (5+ types)
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

export type RemovalAnomalyType = 'removal_unfulfilled' | 'disposal_error' | 'removal_order_lost' | 'removal_quantity_mismatch' | 'removal_fee_error';

export interface RemovalOrderDetail {
    id: string; seller_id: string; order_id: string;
    order_type: 'Return' | 'Disposal' | 'Liquidation';
    order_status: string; sku: string; fnsku?: string; asin?: string; product_name?: string;
    requested_quantity: number; shipped_quantity?: number; disposed_quantity?: number; cancelled_quantity?: number;
    request_date: string; completion_date?: string;
    removal_fee?: number; expected_fee?: number;
    created_at: string;
}

export interface RemovalSyncedData {
    seller_id: string; sync_id: string;
    removal_orders: RemovalOrderDetail[];
    reimbursement_events: Array<{ id: string; order_id?: string; sku?: string; reimbursement_amount: number; reimbursement_date: string }>;
}

export interface RemovalDetectionResult {
    seller_id: string; sync_id: string; anomaly_type: RemovalAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical'; estimated_value: number; currency: string;
    confidence_score: number; evidence: any; related_event_ids: string[];
    discovery_date: Date; deadline_date: Date; days_remaining: number;
    order_id: string; sku?: string; fnsku?: string; product_name?: string;
}

function daysBetween(d1: Date, d2: Date): number { return Math.ceil(Math.abs(d2.getTime() - d1.getTime()) / 86400000); }
function severity(v: number): 'low' | 'medium' | 'high' | 'critical' { return v >= 300 ? 'critical' : v >= 100 ? 'high' : v >= 30 ? 'medium' : 'low'; }

export function detectRemovalAnomalies(sellerId: string, syncId: string, data: RemovalSyncedData): RemovalDetectionResult[] {
    const results: RemovalDetectionResult[] = [];
    const now = new Date();
    const discoveryDate = new Date();
    const deadline = new Date(discoveryDate); deadline.setDate(deadline.getDate() + 60);
    const daysRemaining = Math.max(0, daysBetween(now, deadline));

    logger.info('🗑️ [REMOVAL] Starting detection', { sellerId, orders: data.removal_orders?.length || 0 });

    const reimbByOrder = new Map<string, any[]>();
    for (const r of data.reimbursement_events || []) { if (r.order_id) { reimbByOrder.set(r.order_id, [...(reimbByOrder.get(r.order_id) || []), r]); } }

    for (const order of data.removal_orders || []) {
        const daysSince = daysBetween(new Date(order.request_date), now);
        if (daysSince < 60) continue;

        const processed = order.order_type === 'Return' ? (order.shipped_quantity || 0) : (order.disposed_quantity || 0);
        const missing = order.requested_quantity - processed - (order.cancelled_quantity || 0);
        if (missing <= 0) continue;

        const reimbs = reimbByOrder.get(order.order_id) || [];
        if (reimbs.some(r => r.sku === order.sku)) continue;

        const anomalyType: RemovalAnomalyType = order.order_type === 'Return' && processed === 0 ? 'removal_unfulfilled' :
            order.order_type === 'Disposal' ? 'disposal_error' : 'removal_quantity_mismatch';

        const value = missing * 15;
        if (value < 10) continue;

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: anomalyType,
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.85,
            evidence: {
                order_id: order.order_id, requested: order.requested_quantity, processed, missing, days_since: daysSince,
                summary: `Removal ${order.order_id}: Requested ${order.requested_quantity}, processed ${processed}, missing ${missing}`
            },
            related_event_ids: [order.id], discovery_date: discoveryDate, deadline_date: deadline, days_remaining: daysRemaining,
            order_id: order.order_id, sku: order.sku, fnsku: order.fnsku, product_name: order.product_name
        });
    }

    logger.info('🗑️ [REMOVAL] Complete', { found: results.length, recovery: results.reduce((s, r) => s + r.estimated_value, 0) });
    return results;
}

export async function fetchRemovalOrders(sellerId: string): Promise<RemovalOrderDetail[]> {
    const { data } = await supabaseAdmin.from('removal_order_detail').select('*').eq('seller_id', sellerId).order('request_date', { ascending: false }).limit(500);
    return data || [];
}

export async function runRemovalDetection(sellerId: string, syncId: string): Promise<RemovalDetectionResult[]> {
    const [orders, reimbs] = await Promise.all([
        fetchRemovalOrders(sellerId),
        supabaseAdmin.from('reimbursement_events').select('*').eq('seller_id', sellerId).then(r => r.data || [])
    ]);
    return detectRemovalAnomalies(sellerId, syncId, { seller_id: sellerId, sync_id: syncId, removal_orders: orders, reimbursement_events: reimbs });
}

export async function storeRemovalResults(results: RemovalDetectionResult[]): Promise<void> {
    if (!results.length) return;
    await supabaseAdmin.from('detection_results').upsert(results.map(r => ({
        ...r, discovery_date: r.discovery_date.toISOString(), deadline_date: r.deadline_date.toISOString(), status: 'open', created_at: new Date().toISOString()
    })));
}

export default { detectRemovalAnomalies, fetchRemovalOrders, runRemovalDetection, storeRemovalResults };
