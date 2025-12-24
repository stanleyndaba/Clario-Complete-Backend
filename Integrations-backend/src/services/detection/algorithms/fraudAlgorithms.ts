/**
 * Fraud & Fulfillment Error Detection - "The Fraud Hunter"
 * CLUSTER 3: FBA Fraud & Fulfillment Errors (8+ types)
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

export type FraudAnomalyType = 'customer_return_fraud' | 'switcheroo' | 'wrong_item_returned' | 'returnless_refund_abuse' | 'wrong_asin_shipped' | 'weight_manipulation';

export interface ReturnEvent {
    id: string; seller_id: string; order_id: string; sku?: string; fnsku?: string; asin?: string;
    detailed_disposition?: string; // 'SWITCHEROO', 'WRONG_ITEM', 'DEFECTIVE', etc.
    return_date: string; quantity_returned: number; refund_amount?: number;
    customer_id?: string; created_at: string;
}

export interface RefundEvent {
    id: string; seller_id: string; order_id: string; sku?: string;
    refund_reason?: string; refund_amount: number; refund_date: string;
    customer_id?: string; is_returnless?: boolean;
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

function severity(v: number): 'low' | 'medium' | 'high' | 'critical' { return v >= 200 ? 'critical' : v >= 100 ? 'high' : v >= 30 ? 'medium' : 'low'; }

export function detectFraudAnomalies(sellerId: string, syncId: string, data: FraudSyncedData): FraudDetectionResult[] {
    const results: FraudDetectionResult[] = [];
    const now = new Date();
    const discoveryDate = new Date();
    const deadline = new Date(discoveryDate); deadline.setDate(deadline.getDate() + 60);
    const daysRemaining = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 86400000));

    logger.info('🕵️ [FRAUD] Starting detection', { sellerId, returns: data.return_events?.length, refunds: data.refund_events?.length });

    const reimbByOrder = new Map<string, any[]>();
    for (const r of data.reimbursement_events || []) { if (r.order_id) reimbByOrder.set(r.order_id, [...(reimbByOrder.get(r.order_id) || []), r]); }

    // 1. Wrong Item Returns / Switcheroo
    for (const ret of data.return_events || []) {
        const disp = ret.detailed_disposition?.toUpperCase();
        if (!['SWITCHEROO', 'WRONG_ITEM', 'OTHER'].includes(disp || '')) continue;

        const reimbs = reimbByOrder.get(ret.order_id) || [];
        if (reimbs.some(r => r.sku === ret.sku)) continue;

        const value = ret.refund_amount || (ret.quantity_returned * 25);
        if (value < 15) continue;

        const anomalyType: FraudAnomalyType = disp === 'SWITCHEROO' ? 'switcheroo' : 'wrong_item_returned';

        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: anomalyType,
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.90,
            evidence: {
                order_id: ret.order_id, disposition: disp, quantity: ret.quantity_returned,
                summary: `Return ${ret.order_id}: Disposition ${disp}. Customer returned wrong/fake item. No reimbursement found.`
            },
            related_event_ids: [ret.id], discovery_date: discoveryDate, deadline_date: deadline, days_remaining: daysRemaining,
            order_id: ret.order_id, sku: ret.sku, customer_id: ret.customer_id
        });
    }

    // 2. Returnless Refund Abuse (frequency check)
    const returnlessPerCustomer = new Map<string, RefundEvent[]>();
    for (const ref of data.refund_events || []) {
        if (!ref.is_returnless || !ref.customer_id) continue;
        returnlessPerCustomer.set(ref.customer_id, [...(returnlessPerCustomer.get(ref.customer_id) || []), ref]);
    }

    for (const [customerId, refunds] of returnlessPerCustomer) {
        const last90 = refunds.filter(r => (now.getTime() - new Date(r.refund_date).getTime()) < 90 * 86400000);
        if (last90.length < 3) continue; // Threshold: 3+ in 90 days

        const totalValue = last90.reduce((s, r) => s + r.refund_amount, 0);
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'returnless_refund_abuse',
            severity: 'high', estimated_value: totalValue, currency: 'USD', confidence_score: 0.80,
            evidence: {
                customer_id: customerId, refund_count: last90.length, total_value: totalValue,
                summary: `Customer ${customerId} has ${last90.length} returnless refunds in 90 days totaling $${totalValue.toFixed(2)}. Possible abuse.`
            },
            related_event_ids: last90.map(r => r.id), discovery_date: discoveryDate, deadline_date: deadline, days_remaining: daysRemaining,
            customer_id: customerId
        });
    }

    logger.info('🕵️ [FRAUD] Complete', { found: results.length, recovery: results.reduce((s, r) => s + r.estimated_value, 0) });
    return results;
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
        fetchReturnEvents(sellerId),
        fetchRefundEventsForFraud(sellerId),
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

export default { detectFraudAnomalies, fetchReturnEvents, fetchRefundEventsForFraud, runFraudDetection, storeFraudResults };
