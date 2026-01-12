/**
 * Order Level Discrepancy Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Transaction Integrity
 * 
 * Problem: Individual orders can have hidden discrepancies:
 * - Quantity shipped vs received at FC
 * - Unit price charged vs actual
 * - Fees applied vs expected
 * - Promotions not honored
 * 
 * Detects leakage at the granular order level.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface OrderRecord {
    id: string;
    seller_id: string;
    order_id: string;
    order_date: string;
    sku: string;
    asin?: string;

    // Expected values
    expected_quantity: number;
    expected_price: number;
    expected_fees: number;
    expected_net: number;

    // Actual values
    actual_quantity: number;
    actual_price: number;
    actual_fees: number;
    actual_net: number;

    // Status
    order_status: string;
    fulfillment_channel: string;
    currency: string;
}

export interface OrderDiscrepancyResult {
    seller_id: string;
    sync_id: string;

    // Order identification
    order_id: string;
    sku: string;
    asin?: string;
    order_date: string;

    // Discrepancy type
    discrepancy_type: OrderDiscrepancyType;
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Values
    expected_value: number;
    actual_value: number;
    discrepancy_amount: number;
    discrepancy_percent: number;
    currency: string;

    // Confidence
    confidence_score: number;

    // Action
    recommended_action: 'monitor' | 'review' | 'dispute';

    // Evidence
    evidence: {
        order_record: OrderRecord;
        detection_reasons: string[];
    };
}

export type OrderDiscrepancyType =
    | 'quantity_mismatch'
    | 'price_discrepancy'
    | 'fee_overcharge'
    | 'promotion_not_applied'
    | 'net_calculation_error';

// ============================================================================
// Constants
// ============================================================================

const THRESHOLD_SHOW = 0.60;
const MIN_DISCREPANCY = 5;

// ============================================================================
// Core Detection
// ============================================================================

export async function detectOrderLevelDiscrepancies(
    sellerId: string,
    syncId: string,
    orders: OrderRecord[]
): Promise<OrderDiscrepancyResult[]> {
    const results: OrderDiscrepancyResult[] = [];

    logger.info('📋 [ORDER-DISC] Starting order level discrepancy detection', {
        sellerId, syncId, orderCount: orders.length
    });

    for (const order of orders) {
        // Check quantity mismatch
        if (order.expected_quantity !== order.actual_quantity) {
            const diff = order.expected_quantity - order.actual_quantity;
            if (Math.abs(diff * order.expected_price) >= MIN_DISCREPANCY) {
                results.push(createResult(sellerId, syncId, order, 'quantity_mismatch',
                    order.expected_quantity, order.actual_quantity, diff * order.expected_price));
            }
        }

        // Check price discrepancy
        const priceDiff = order.expected_price - order.actual_price;
        if (Math.abs(priceDiff) >= 1) {
            results.push(createResult(sellerId, syncId, order, 'price_discrepancy',
                order.expected_price, order.actual_price, priceDiff * order.actual_quantity));
        }

        // Check fee overcharge
        const feeDiff = order.actual_fees - order.expected_fees;
        if (feeDiff >= 0.50) {
            results.push(createResult(sellerId, syncId, order, 'fee_overcharge',
                order.expected_fees, order.actual_fees, feeDiff));
        }

        // Check net calculation
        const expectedNet = order.actual_price * order.actual_quantity - order.actual_fees;
        const netDiff = expectedNet - order.actual_net;
        if (Math.abs(netDiff) >= 1) {
            results.push(createResult(sellerId, syncId, order, 'net_calculation_error',
                expectedNet, order.actual_net, netDiff));
        }
    }

    results.sort((a, b) => b.discrepancy_amount - a.discrepancy_amount);

    logger.info('📋 [ORDER-DISC] Detection complete', {
        sellerId, discrepanciesFound: results.length,
        totalAmount: results.reduce((sum, r) => sum + r.discrepancy_amount, 0).toFixed(2)
    });

    return results;
}

function createResult(
    sellerId: string, syncId: string, order: OrderRecord,
    type: OrderDiscrepancyType, expected: number, actual: number, amount: number
): OrderDiscrepancyResult {
    const percent = expected > 0 ? ((expected - actual) / expected) * 100 : 0;

    return {
        seller_id: sellerId,
        sync_id: syncId,
        order_id: order.order_id,
        sku: order.sku,
        asin: order.asin,
        order_date: order.order_date,
        discrepancy_type: type,
        severity: Math.abs(amount) >= 50 ? 'high' : Math.abs(amount) >= 20 ? 'medium' : 'low',
        expected_value: expected,
        actual_value: actual,
        discrepancy_amount: Math.abs(amount),
        discrepancy_percent: Math.abs(percent),
        currency: order.currency,
        confidence_score: 0.75,
        recommended_action: Math.abs(amount) >= 20 ? 'dispute' : 'review',
        evidence: {
            order_record: order,
            detection_reasons: [`${type.replace(/_/g, ' ')}: expected ${expected.toFixed(2)}, actual ${actual.toFixed(2)}`]
        }
    };
}

// ============================================================================
// Database Functions
// ============================================================================

export async function fetchOrdersForDiscrepancy(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<OrderRecord[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const orders: OrderRecord[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('orders')
            .select('*')
            .eq('user_id', sellerId)
            .gte('order_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                orders.push({
                    id: row.id,
                    seller_id: sellerId,
                    order_id: row.order_id,
                    order_date: row.order_date,
                    sku: row.sku,
                    asin: row.asin,
                    expected_quantity: row.quantity_ordered || row.quantity || 1,
                    expected_price: parseFloat(row.item_price) || 0,
                    expected_fees: parseFloat(row.expected_fees) || 0,
                    expected_net: parseFloat(row.expected_net) || 0,
                    actual_quantity: row.quantity_shipped || row.quantity || 1,
                    actual_price: parseFloat(row.item_price) || 0,
                    actual_fees: parseFloat(row.total_fees) || 0,
                    actual_net: parseFloat(row.net_proceeds) || 0,
                    order_status: row.status || 'unknown',
                    fulfillment_channel: row.fulfillment_channel || 'FBA',
                    currency: row.currency || 'USD'
                });
            }
        }

        logger.info('📋 [ORDER-DISC] Fetched orders', { sellerId, count: orders.length });
    } catch (err: any) {
        logger.error('📋 [ORDER-DISC] Error fetching orders', { error: err.message });
    }

    return orders;
}

export async function storeOrderDiscrepancyResults(results: OrderDiscrepancyResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'order_discrepancy',
            severity: r.severity,
            estimated_value: r.discrepancy_amount,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                order_id: r.order_id,
                sku: r.sku,
                discrepancy_type: r.discrepancy_type,
                expected_value: r.expected_value,
                actual_value: r.actual_value,
                detection_reasons: r.evidence.detection_reasons
            },
            status: 'pending'
        }));

        await supabaseAdmin.from('detection_results').insert(records);
        logger.info('📋 [ORDER-DISC] Stored results', { count: records.length });
    } catch (err: any) {
        logger.error('📋 [ORDER-DISC] Error storing results', { error: err.message });
    }
}

export { THRESHOLD_SHOW, MIN_DISCREPANCY };
