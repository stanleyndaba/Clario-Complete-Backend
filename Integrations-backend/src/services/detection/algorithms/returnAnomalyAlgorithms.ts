/**
 * Return Anomaly Detection Algorithms
 * 
 * Detects money lost in the returns process where Amazon's handling is incorrect.
 * 
 * Coverage:
 * - Return received but not restocked (customer return never added back to inventory)
 * - Refund exceeds charge (customer refunded more than they paid)
 * - Canceled shipment still charged (shipment canceled but FBA fees applied)
 * - Destroyed without consent (item destroyed without seller approval)
 */

import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type ReturnAnomalyType =
    | 'return_not_restocked'
    | 'refund_exceeds_charge'
    | 'canceled_shipment_charged'
    | 'destroyed_without_consent';

export interface ReturnEvent {
    id: string;
    seller_id: string;
    amazon_order_id: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    quantity_returned: number;
    return_date: string;
    return_status: 'received' | 'pending' | 'reimbursed' | 'restocked';
    disposition?: string;
    currency: string;
    created_at: string;
}

export interface InventoryAdjustment {
    id: string;
    seller_id: string;
    sku: string;
    asin?: string;
    fnsku?: string;
    quantity_change: number;
    adjustment_type: 'return' | 'inbound' | 'removal' | 'adjustment' | 'destroyed';
    adjustment_date: string;
    order_id?: string;
}

export interface RefundEvent {
    id: string;
    seller_id: string;
    amazon_order_id: string;
    sku?: string;
    asin?: string;
    refund_amount: number;
    original_charge: number;
    currency: string;
    refund_date: string;
    refund_reason?: string;
}

export interface ShipmentEvent {
    id: string;
    seller_id: string;
    shipment_id: string;
    order_id?: string;
    sku?: string;
    status: 'shipped' | 'canceled' | 'delivered' | 'returned';
    fees_charged: number;
    currency: string;
    event_date: string;
}

export interface RemovalEvent {
    id: string;
    seller_id: string;
    sku: string;
    asin?: string;
    fnsku?: string;
    quantity: number;
    removal_type: 'return_to_seller' | 'disposal' | 'liquidation' | 'destroyed';
    seller_requested: boolean;
    event_date: string;
}

export interface ReturnSyncedData {
    seller_id: string;
    sync_id: string;
    return_events: ReturnEvent[];
    inventory_adjustments: InventoryAdjustment[];
    refund_events: RefundEvent[];
    shipment_events: ShipmentEvent[];
    removal_events: RemovalEvent[];
    product_costs: Map<string, number>;
}

export interface ReturnDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: ReturnAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: ReturnEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    sku?: string;
    asin?: string;
    order_id?: string;
}

export interface ReturnEvidence {
    sku?: string;
    asin?: string;
    order_id?: string;
    anomaly_type: string;
    amount_lost: number;
    reason: string;
    evidence_summary: string;
    event_ids: string[];
    supporting_data?: Record<string, any>;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateDeadline(discoveryDate: Date): { deadline: Date; daysRemaining: number } {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);
    const daysRemaining = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

function calculateSeverity(lossAmount: number): 'low' | 'medium' | 'high' | 'critical' {
    if (lossAmount >= 500) return 'critical';
    if (lossAmount >= 100) return 'high';
    if (lossAmount >= 25) return 'medium';
    return 'low';
}

// ============================================================================
// Detection Algorithms
// ============================================================================

/**
 * Detect Return Not Restocked
 * 
 * Customer return was received by Amazon but never added back to inventory.
 * Common issue: return scanned but lost in warehouse, never sellable again.
 */
export function detectReturnNotRestocked(
    sellerId: string,
    syncId: string,
    data: ReturnSyncedData
): ReturnDetectionResult[] {
    const results: ReturnDetectionResult[] = [];

    // Look for returns with status 'received' that have no matching inventory adjustment
    for (const returnEvent of data.return_events) {
        if (returnEvent.return_status !== 'received' && returnEvent.return_status !== 'pending') {
            continue; // Already restocked or reimbursed
        }

        const returnDate = new Date(returnEvent.return_date);
        const sevenDaysLater = new Date(returnDate);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        // Check if there's a matching inventory adjustment
        const hasRestockAdjustment = data.inventory_adjustments.some(adj => {
            const adjDate = new Date(adj.adjustment_date);
            return adj.sku === returnEvent.sku &&
                adj.adjustment_type === 'return' &&
                adj.quantity_change > 0 &&
                adjDate >= returnDate &&
                adjDate <= sevenDaysLater;
        });

        if (!hasRestockAdjustment) {
            const itemCost = data.product_costs.get(returnEvent.sku || '') || 15; // Default $15
            const estimatedLoss = itemCost * returnEvent.quantity_returned;

            if (estimatedLoss >= 10) { // Minimum threshold
                const discoveryDate = new Date();
                const { deadline, daysRemaining } = calculateDeadline(returnDate);

                results.push({
                    seller_id: sellerId,
                    sync_id: syncId,
                    anomaly_type: 'return_not_restocked',
                    severity: calculateSeverity(estimatedLoss),
                    estimated_value: estimatedLoss,
                    currency: returnEvent.currency,
                    confidence_score: 0.85,
                    evidence: {
                        sku: returnEvent.sku,
                        asin: returnEvent.asin,
                        order_id: returnEvent.amazon_order_id,
                        anomaly_type: 'Return Not Restocked',
                        amount_lost: estimatedLoss,
                        reason: 'Customer return received but no inventory restock within 7 days',
                        evidence_summary: `Return of ${returnEvent.quantity_returned} units on ${returnEvent.return_date} never restocked (est. loss: $${estimatedLoss.toFixed(2)})`,
                        event_ids: [returnEvent.id],
                        supporting_data: {
                            return_date: returnEvent.return_date,
                            disposition: returnEvent.disposition,
                        },
                    },
                    related_event_ids: [returnEvent.id],
                    discovery_date: discoveryDate,
                    deadline_date: deadline,
                    days_remaining: daysRemaining,
                    sku: returnEvent.sku,
                    asin: returnEvent.asin,
                    order_id: returnEvent.amazon_order_id,
                });
            }
        }
    }

    logger.info(`[RETURN ANOMALY] Found ${results.length} returns not restocked`, {
        sellerId,
        syncId,
        count: results.length,
        totalValue: results.reduce((sum, r) => sum + r.estimated_value, 0),
    });

    return results;
}

/**
 * Detect Refund Exceeds Charge
 * 
 * Customer was refunded more than they originally paid.
 * Issue: system errors, promotional discounts applied incorrectly.
 */
export function detectRefundExceedsCharge(
    sellerId: string,
    syncId: string,
    data: ReturnSyncedData
): ReturnDetectionResult[] {
    const results: ReturnDetectionResult[] = [];

    for (const refund of data.refund_events) {
        if (refund.original_charge <= 0) continue; // No original charge data

        const overage = refund.refund_amount - refund.original_charge;
        const overagePct = (overage / refund.original_charge) * 100;

        // Flag if refund exceeds charge by more than 5%
        if (overagePct > 5 && overage >= 1) {
            const discoveryDate = new Date();
            const { deadline, daysRemaining } = calculateDeadline(new Date(refund.refund_date));

            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: 'refund_exceeds_charge',
                severity: calculateSeverity(overage),
                estimated_value: overage,
                currency: refund.currency,
                confidence_score: 0.90,
                evidence: {
                    sku: refund.sku,
                    asin: refund.asin,
                    order_id: refund.amazon_order_id,
                    anomaly_type: 'Refund Exceeds Charge',
                    amount_lost: overage,
                    reason: 'Customer refunded more than original charge amount',
                    evidence_summary: `Refunded $${refund.refund_amount.toFixed(2)} but original charge was $${refund.original_charge.toFixed(2)} (overpaid by $${overage.toFixed(2)})`,
                    event_ids: [refund.id],
                    supporting_data: {
                        refund_reason: refund.refund_reason,
                        overage_percentage: overagePct,
                    },
                },
                related_event_ids: [refund.id],
                discovery_date: discoveryDate,
                deadline_date: deadline,
                days_remaining: daysRemaining,
                sku: refund.sku,
                asin: refund.asin,
                order_id: refund.amazon_order_id,
            });
        }
    }

    logger.info(`[RETURN ANOMALY] Found ${results.length} refunds exceeding charges`, {
        sellerId,
        syncId,
        count: results.length,
        totalValue: results.reduce((sum, r) => sum + r.estimated_value, 0),
    });

    return results;
}

/**
 * Detect Canceled Shipment Still Charged
 * 
 * Shipment was canceled but FBA fees were still applied.
 */
export function detectCanceledShipmentCharged(
    sellerId: string,
    syncId: string,
    data: ReturnSyncedData
): ReturnDetectionResult[] {
    const results: ReturnDetectionResult[] = [];

    for (const shipment of data.shipment_events) {
        if (shipment.status !== 'canceled') continue;
        if (shipment.fees_charged <= 0) continue; // No fees charged

        const discoveryDate = new Date();
        const { deadline, daysRemaining } = calculateDeadline(new Date(shipment.event_date));

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: 'canceled_shipment_charged',
            severity: calculateSeverity(shipment.fees_charged),
            estimated_value: shipment.fees_charged,
            currency: shipment.currency,
            confidence_score: 0.95,
            evidence: {
                sku: shipment.sku,
                order_id: shipment.order_id,
                anomaly_type: 'Canceled Shipment Charged',
                amount_lost: shipment.fees_charged,
                reason: 'FBA fees charged on a shipment that was canceled',
                evidence_summary: `Shipment ${shipment.shipment_id} was canceled but $${shipment.fees_charged.toFixed(2)} in fees were still charged`,
                event_ids: [shipment.id],
                supporting_data: {
                    shipment_id: shipment.shipment_id,
                    event_date: shipment.event_date,
                },
            },
            related_event_ids: [shipment.id],
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            sku: shipment.sku,
            order_id: shipment.order_id,
        });
    }

    logger.info(`[RETURN ANOMALY] Found ${results.length} canceled shipments with fees`, {
        sellerId,
        syncId,
        count: results.length,
    });

    return results;
}

/**
 * Detect Destroyed Without Consent
 * 
 * Item was destroyed by Amazon without seller approval/request.
 */
export function detectDestroyedWithoutConsent(
    sellerId: string,
    syncId: string,
    data: ReturnSyncedData
): ReturnDetectionResult[] {
    const results: ReturnDetectionResult[] = [];

    for (const removal of data.removal_events) {
        if (removal.removal_type !== 'destroyed' && removal.removal_type !== 'disposal') {
            continue;
        }

        if (removal.seller_requested) continue; // Seller requested destruction

        const itemCost = data.product_costs.get(removal.sku) || 15;
        const estimatedLoss = itemCost * removal.quantity;

        if (estimatedLoss >= 10) {
            const discoveryDate = new Date();
            const { deadline, daysRemaining } = calculateDeadline(new Date(removal.event_date));

            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: 'destroyed_without_consent',
                severity: calculateSeverity(estimatedLoss),
                estimated_value: estimatedLoss,
                currency: 'USD',
                confidence_score: 0.88,
                evidence: {
                    sku: removal.sku,
                    asin: removal.asin,
                    anomaly_type: 'Destroyed Without Consent',
                    amount_lost: estimatedLoss,
                    reason: 'Inventory destroyed by Amazon without seller request',
                    evidence_summary: `${removal.quantity} units of ${removal.sku} destroyed on ${removal.event_date} without seller approval`,
                    event_ids: [removal.id],
                    supporting_data: {
                        removal_type: removal.removal_type,
                        seller_requested: removal.seller_requested,
                    },
                },
                related_event_ids: [removal.id],
                discovery_date: discoveryDate,
                deadline_date: deadline,
                days_remaining: daysRemaining,
                sku: removal.sku,
                asin: removal.asin,
            });
        }
    }

    logger.info(`[RETURN ANOMALY] Found ${results.length} items destroyed without consent`, {
        sellerId,
        syncId,
        count: results.length,
    });

    return results;
}

// ============================================================================
// Combined Detection Runner
// ============================================================================

/**
 * Run all return anomaly detection algorithms
 */
export function detectAllReturnAnomalies(
    sellerId: string,
    syncId: string,
    data: ReturnSyncedData
): ReturnDetectionResult[] {
    logger.info(`[RETURN ANOMALY] Starting return audit for seller`, {
        sellerId,
        syncId,
        returnCount: data.return_events.length,
        refundCount: data.refund_events.length,
    });

    const results: ReturnDetectionResult[] = [
        ...detectReturnNotRestocked(sellerId, syncId, data),
        ...detectRefundExceedsCharge(sellerId, syncId, data),
        ...detectCanceledShipmentCharged(sellerId, syncId, data),
        ...detectDestroyedWithoutConsent(sellerId, syncId, data),
    ];

    logger.info(`[RETURN ANOMALY] Return audit complete`, {
        sellerId,
        syncId,
        totalAnomalies: results.length,
        totalValue: results.reduce((sum, r) => sum + r.estimated_value, 0),
        byType: {
            not_restocked: results.filter(r => r.anomaly_type === 'return_not_restocked').length,
            refund_exceeds: results.filter(r => r.anomaly_type === 'refund_exceeds_charge').length,
            canceled_charged: results.filter(r => r.anomaly_type === 'canceled_shipment_charged').length,
            destroyed: results.filter(r => r.anomaly_type === 'destroyed_without_consent').length,
        },
    });

    return results;
}

export default {
    detectReturnNotRestocked,
    detectRefundExceedsCharge,
    detectCanceledShipmentCharged,
    detectDestroyedWithoutConsent,
    detectAllReturnAnomalies,
};
