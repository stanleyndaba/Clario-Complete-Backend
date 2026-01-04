/**
 * Cross-Entity Correlation Engine
 * 
 * Goes beyond single-report analysis by correlating data across:
 * - Orders ↔ Shipments ↔ Inventory ↔ Returns ↔ Fees ↔ Reimbursements
 * 
 * Purpose:
 * Find mismatches that single-report tools miss:
 * - Order shipped + return received + inventory not restocked + no reimbursement
 * - Inbound shipment received + inventory not added + no adjustment
 * - Fee charged + order canceled + fee not refunded
 * 
 * This is where the REAL money hides.
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CorrelationMismatch {
    mismatch_id: string;
    seller_id: string;
    mismatch_type:
    | 'order_return_inventory_gap'    // Return received, inventory not restocked
    | 'inbound_inventory_gap'         // Inbound received, inventory not added
    | 'fee_cancellation_gap'          // Fee charged, order canceled, no refund
    | 'reimbursement_chain_gap'       // Loss event → no reimbursement request
    | 'multi_entity_discrepancy';     // Complex multi-table mismatch

    entities_involved: Array<{
        entity_type: 'order' | 'shipment' | 'inventory' | 'return' | 'fee' | 'reimbursement';
        entity_id: string;
        entity_data: any;
    }>;

    gap_description: string;
    estimated_value: number;
    currency: string;
    confidence_score: number;
    discovery_date: Date;
}

export interface CorrelationDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: 'correlation_mismatch';
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: {
        mismatch_type: string;
        gap_description: string;
        entities_involved: any[];
        correlation_chain: string[];
    };
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
}

// ============================================================================
// Correlation Configuration
// ============================================================================

const LOOKBACK_DAYS = 90;
const MIN_VALUE_TO_REPORT = 10; // $10 minimum

// ============================================================================
// Helper Functions
// ============================================================================

function calculateDeadline(discoveryDate: Date): { deadline: Date; daysRemaining: number } {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);
    const daysRemaining = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

function calculateSeverity(value: number): 'low' | 'medium' | 'high' | 'critical' {
    if (value >= 500) return 'critical';
    if (value >= 100) return 'high';
    if (value >= 25) return 'medium';
    return 'low';
}

// ============================================================================
// Correlation Algorithms
// ============================================================================

/**
 * Correlate Orders → Returns → Inventory
 * 
 * Find: Returns that were received but never restocked
 */
async function correlateOrderReturnInventory(sellerId: string): Promise<CorrelationMismatch[]> {
    const mismatches: CorrelationMismatch[] = [];
    const lookbackDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Get returns received in the period
        const { data: returns, error: returnError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('event_type', 'return')
            .gte('event_date', lookbackDate)
            .limit(1000);

        if (returnError || !returns?.length) return mismatches;

        // Get inventory adjustments
        const { data: inventoryAdj, error: invError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .in('event_type', ['inventory_adjustment', 'inventory_add', 'inventory_received'])
            .gte('event_date', lookbackDate)
            .limit(5000);

        if (invError) return mismatches;

        const inventoryAdjustments = inventoryAdj || [];

        // For each return, check if there's a matching inventory addition
        for (const returnEvent of returns) {
            const returnDate = new Date(returnEvent.event_date);
            const sevenDaysLater = new Date(returnDate);
            sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

            const hasInventoryAdd = inventoryAdjustments.some(adj => {
                const adjDate = new Date(adj.event_date);
                const skuMatch = adj.amazon_sku === returnEvent.amazon_sku ||
                    adj.asin === returnEvent.asin;
                const dateMatch = adjDate >= returnDate && adjDate <= sevenDaysLater;
                const isAddition = (adj.quantity || 0) > 0;
                return skuMatch && dateMatch && isAddition;
            });

            if (!hasInventoryAdd) {
                const estimatedValue = Math.abs(returnEvent.amount || 0) || 15; // Default $15 per unit

                if (estimatedValue >= MIN_VALUE_TO_REPORT) {
                    mismatches.push({
                        mismatch_id: `corr_ori_${returnEvent.id}`,
                        seller_id: sellerId,
                        mismatch_type: 'order_return_inventory_gap',
                        entities_involved: [
                            { entity_type: 'return', entity_id: returnEvent.id, entity_data: returnEvent }
                        ],
                        gap_description: `Return received on ${returnEvent.event_date} for ${returnEvent.amazon_sku || returnEvent.asin} but no inventory restock within 7 days`,
                        estimated_value: estimatedValue,
                        currency: returnEvent.currency || 'USD',
                        confidence_score: 0.80,
                        discovery_date: new Date()
                    });
                }
            }
        }

        logger.info('[CORRELATION] Order-Return-Inventory correlation complete', {
            sellerId,
            returnsChecked: returns.length,
            gapsFound: mismatches.length
        });

    } catch (error: any) {
        logger.error('[CORRELATION] Error in ORI correlation', { sellerId, error: error.message });
    }

    return mismatches;
}

/**
 * Correlate Inbound Shipments → Inventory
 * 
 * Find: Inbound shipments received but inventory not properly added
 */
async function correlateInboundInventory(sellerId: string): Promise<CorrelationMismatch[]> {
    const mismatches: CorrelationMismatch[] = [];
    const lookbackDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Get inbound shipment events
        const { data: inboundEvents, error: inboundError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .in('event_type', ['inbound_received', 'shipment_received'])
            .gte('event_date', lookbackDate)
            .limit(500);

        if (inboundError || !inboundEvents?.length) return mismatches;

        // Get inventory ledger entries
        const { data: inventoryLedger, error: ledgerError } = await supabaseAdmin
            .from('inventory_ledger')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('event_type', 'receipts')
            .gte('event_date', lookbackDate)
            .limit(2000);

        if (ledgerError) return mismatches;

        const ledgerEntries = inventoryLedger || [];

        for (const inbound of inboundEvents) {
            const inboundDate = new Date(inbound.event_date);
            const fiveDaysLater = new Date(inboundDate);
            fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);

            const expectedQty = inbound.quantity || 0;
            if (expectedQty <= 0) continue;

            // Find matching inventory receipts
            const matchingReceipts = ledgerEntries.filter(entry => {
                const entryDate = new Date(entry.event_date);
                const skuMatch = entry.sku === inbound.amazon_sku || entry.fnsku === inbound.fnsku;
                const dateMatch = entryDate >= inboundDate && entryDate <= fiveDaysLater;
                return skuMatch && dateMatch;
            });

            const receivedQty = matchingReceipts.reduce((sum, r) => sum + (r.quantity || 0), 0);
            const qtyGap = expectedQty - receivedQty;

            if (qtyGap >= 5) { // At least 5 units missing
                const unitCost = inbound.unit_cost || inbound.amount / expectedQty || 15;
                const estimatedValue = qtyGap * unitCost;

                if (estimatedValue >= MIN_VALUE_TO_REPORT) {
                    mismatches.push({
                        mismatch_id: `corr_ii_${inbound.id}`,
                        seller_id: sellerId,
                        mismatch_type: 'inbound_inventory_gap',
                        entities_involved: [
                            { entity_type: 'shipment', entity_id: inbound.id, entity_data: inbound },
                            ...matchingReceipts.map(r => ({ entity_type: 'inventory' as const, entity_id: r.id, entity_data: r }))
                        ],
                        gap_description: `Inbound shipment on ${inbound.event_date} expected ${expectedQty} units but only ${receivedQty} added to inventory (${qtyGap} units missing)`,
                        estimated_value: estimatedValue,
                        currency: inbound.currency || 'USD',
                        confidence_score: 0.85,
                        discovery_date: new Date()
                    });
                }
            }
        }

        logger.info('[CORRELATION] Inbound-Inventory correlation complete', {
            sellerId,
            inboundChecked: inboundEvents.length,
            gapsFound: mismatches.length
        });

    } catch (error: any) {
        logger.error('[CORRELATION] Error in II correlation', { sellerId, error: error.message });
    }

    return mismatches;
}

/**
 * Correlate Fees → Cancellations
 * 
 * Find: Fees charged on orders that were later canceled
 */
async function correlateFeesCancellations(sellerId: string): Promise<CorrelationMismatch[]> {
    const mismatches: CorrelationMismatch[] = [];
    const lookbackDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Get fee events
        const { data: feeEvents, error: feeError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .in('event_type', ['fba_fee', 'fulfillment_fee', 'service_fee'])
            .gte('event_date', lookbackDate)
            .limit(2000);

        if (feeError || !feeEvents?.length) return mismatches;

        // Get cancellation events
        const { data: cancellations, error: cancelError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .in('event_type', ['order_canceled', 'cancellation', 'order_cancelled'])
            .gte('event_date', lookbackDate)
            .limit(1000);

        if (cancelError || !cancellations?.length) return mismatches;

        // Build a map of canceled order IDs
        const canceledOrderIds = new Set(cancellations.map(c => c.amazon_order_id).filter(Boolean));

        // Find fees for canceled orders without refunds
        const feesForCanceledOrders = feeEvents.filter(fee =>
            fee.amazon_order_id && canceledOrderIds.has(fee.amazon_order_id)
        );

        // Check if fees were refunded
        const { data: feeRefunds, error: refundError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .in('event_type', ['fee_refund', 'fee_reversal', 'fee_credit'])
            .gte('event_date', lookbackDate)
            .limit(1000);

        const refundedOrderIds = new Set((feeRefunds || []).map(r => r.amazon_order_id).filter(Boolean));

        for (const fee of feesForCanceledOrders) {
            if (refundedOrderIds.has(fee.amazon_order_id)) continue; // Already refunded

            const feeAmount = Math.abs(fee.amount || 0);
            if (feeAmount < MIN_VALUE_TO_REPORT) continue;

            mismatches.push({
                mismatch_id: `corr_fc_${fee.id}`,
                seller_id: sellerId,
                mismatch_type: 'fee_cancellation_gap',
                entities_involved: [
                    { entity_type: 'fee', entity_id: fee.id, entity_data: fee },
                    { entity_type: 'order', entity_id: fee.amazon_order_id, entity_data: { order_id: fee.amazon_order_id, status: 'canceled' } }
                ],
                gap_description: `Fee of $${feeAmount.toFixed(2)} charged on order ${fee.amazon_order_id} which was canceled but fee was not refunded`,
                estimated_value: feeAmount,
                currency: fee.currency || 'USD',
                confidence_score: 0.90,
                discovery_date: new Date()
            });
        }

        logger.info('[CORRELATION] Fee-Cancellation correlation complete', {
            sellerId,
            feesChecked: feeEvents.length,
            cancellationsFound: cancellations.length,
            gapsFound: mismatches.length
        });

    } catch (error: any) {
        logger.error('[CORRELATION] Error in FC correlation', { sellerId, error: error.message });
    }

    return mismatches;
}

/**
 * Correlate Loss Events → Reimbursement Requests
 * 
 * Find: Loss/damage events that never had a reimbursement request filed
 */
async function correlateLossReimbursement(sellerId: string): Promise<CorrelationMismatch[]> {
    const mismatches: CorrelationMismatch[] = [];
    const lookbackDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Get loss events (damaged, lost, disposed)
        const { data: lossEvents, error: lossError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .in('event_type', ['damaged', 'lost', 'disposed', 'destroyed', 'warehouse_damage', 'warehouse_lost'])
            .gte('event_date', lookbackDate)
            .limit(500);

        if (lossError || !lossEvents?.length) return mismatches;

        // Get reimbursement cases
        const { data: reimbursementCases, error: reimbError } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('created_at', lookbackDate)
            .limit(1000);

        if (reimbError) return mismatches;

        const cases = reimbursementCases || [];

        for (const loss of lossEvents) {
            // Check if there's a case for this loss
            const hasCase = cases.some(c => {
                const evidenceMatch = c.evidence?.order_id === loss.amazon_order_id ||
                    c.evidence?.sku === loss.amazon_sku ||
                    c.evidence?.asin === loss.asin;
                const lossDate = new Date(loss.event_date);
                const caseDate = new Date(c.created_at);
                const timeMatch = caseDate >= lossDate;
                return evidenceMatch && timeMatch;
            });

            if (!hasCase) {
                const estimatedValue = Math.abs(loss.amount || 0) || 15;
                if (estimatedValue < MIN_VALUE_TO_REPORT) continue;

                mismatches.push({
                    mismatch_id: `corr_lr_${loss.id}`,
                    seller_id: sellerId,
                    mismatch_type: 'reimbursement_chain_gap',
                    entities_involved: [
                        { entity_type: 'inventory', entity_id: loss.id, entity_data: loss }
                    ],
                    gap_description: `Loss event on ${loss.event_date} (${loss.event_type}) for ${loss.amazon_sku || loss.asin} has no matching reimbursement case`,
                    estimated_value: estimatedValue,
                    currency: loss.currency || 'USD',
                    confidence_score: 0.75,
                    discovery_date: new Date()
                });
            }
        }

        logger.info('[CORRELATION] Loss-Reimbursement correlation complete', {
            sellerId,
            lossEventsChecked: lossEvents.length,
            gapsFound: mismatches.length
        });

    } catch (error: any) {
        logger.error('[CORRELATION] Error in LR correlation', { sellerId, error: error.message });
    }

    return mismatches;
}

// ============================================================================
// Main Correlation Runner
// ============================================================================

/**
 * Run all cross-entity correlations
 */
export async function runAllCorrelations(
    sellerId: string,
    syncId: string
): Promise<CorrelationDetectionResult[]> {
    logger.info('[CORRELATION] Starting cross-entity correlation engine', { sellerId, syncId });

    const [oriMismatches, iiMismatches, fcMismatches, lrMismatches] = await Promise.all([
        correlateOrderReturnInventory(sellerId),
        correlateInboundInventory(sellerId),
        correlateFeesCancellations(sellerId),
        correlateLossReimbursement(sellerId)
    ]);

    const allMismatches = [...oriMismatches, ...iiMismatches, ...fcMismatches, ...lrMismatches];

    // Convert to detection results
    const results: CorrelationDetectionResult[] = allMismatches.map(m => {
        const { deadline, daysRemaining } = calculateDeadline(m.discovery_date);

        return {
            seller_id: m.seller_id,
            sync_id: syncId,
            anomaly_type: 'correlation_mismatch' as const,
            severity: calculateSeverity(m.estimated_value),
            estimated_value: m.estimated_value,
            currency: m.currency,
            confidence_score: m.confidence_score,
            evidence: {
                mismatch_type: m.mismatch_type,
                gap_description: m.gap_description,
                entities_involved: m.entities_involved,
                correlation_chain: m.entities_involved.map(e => e.entity_type)
            },
            related_event_ids: m.entities_involved.map(e => e.entity_id),
            discovery_date: m.discovery_date,
            deadline_date: deadline,
            days_remaining: daysRemaining
        };
    });

    logger.info('[CORRELATION] Correlation engine complete', {
        sellerId,
        syncId,
        totalMismatches: results.length,
        totalValue: results.reduce((s, r) => s + r.estimated_value, 0),
        byType: {
            ori: oriMismatches.length,
            ii: iiMismatches.length,
            fc: fcMismatches.length,
            lr: lrMismatches.length
        }
    });

    return results;
}

/**
 * Store correlation results
 */
export async function storeCorrelationResults(results: CorrelationDetectionResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: r.anomaly_type,
            severity: r.severity,
            estimated_value: r.estimated_value,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: r.evidence,
            related_event_ids: r.related_event_ids,
            discovery_date: r.discovery_date.toISOString(),
            deadline_date: r.deadline_date.toISOString(),
            days_remaining: r.days_remaining,
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('[CORRELATION] Failed to store results', { error: error.message });
        } else {
            logger.info('[CORRELATION] Results stored', { count: records.length });
        }

    } catch (error: any) {
        logger.error('[CORRELATION] Error storing results', { error: error.message });
    }
}

export default {
    runAllCorrelations,
    storeCorrelationResults,
    correlateOrderReturnInventory,
    correlateInboundInventory,
    correlateFeesCancellations,
    correlateLossReimbursement
};
