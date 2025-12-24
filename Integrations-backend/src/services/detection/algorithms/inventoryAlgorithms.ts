/**
 * Inventory Detection Algorithms - "The Whale Hunter"
 * 
 * Phase 2, P0 Priority: Lost Inventory Detection
 * This is the single most valuable detection algorithm - finds lost warehouse money.
 * 
 * Algorithm Logic:
 * 1. Group inventory events by FNSKU
 * 2. Calculate Input (Receipts + Adjustments + Returns)
 * 3. Calculate Output (Shipments + Removals)
 * 4. CalculatedStock = Input - Output
 * 5. Compare vs EndingWarehouseBalance
 * 6. If CalculatedStock > EndingWarehouseBalance = LOST INVENTORY
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type InventoryEventType =
    | 'Receipt'           // Inbound shipment received
    | 'Shipment'          // Outbound order shipped
    | 'Adjustment'        // Manual inventory adjustment
    | 'Return'            // Customer return
    | 'Removal'           // Removal order
    | 'Disposal'          // Disposed inventory
    | 'Transfer'          // FC-to-FC transfer
    | 'Snapshot';         // Inventory snapshot

export interface InventoryLedgerEvent {
    id: string;
    seller_id: string;
    fnsku: string;
    sku?: string;
    asin?: string;
    product_name?: string;
    event_type: InventoryEventType;
    quantity: number;
    quantity_direction: 'in' | 'out';
    warehouse_balance?: number;      // Ending balance from snapshot
    event_date: string;
    fulfillment_center_id?: string;
    reference_id?: string;           // Shipment ID, Order ID, etc.
    unit_cost?: number;              // Estimated cost per unit
    average_sales_price?: number;    // Average selling price
    created_at: string;
}

export interface SyncedData {
    seller_id: string;
    sync_id: string;
    inventory_ledger: InventoryLedgerEvent[];
    financial_events?: any[];
    orders?: any[];
}

export interface DetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: 'lost_warehouse' | 'damaged_warehouse' | 'lost_inbound' | 'damaged_inbound';
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: LostInventoryEvidence;
    related_event_ids?: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    fnsku: string;
    sku?: string;
    asin?: string;
    product_name?: string;
}

export interface LostInventoryEvidence {
    fnsku: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // The calculation breakdown
    total_receipts: number;
    total_adjustments: number;
    total_returns: number;
    total_input: number;

    total_shipments: number;
    total_removals: number;
    total_output: number;

    calculated_stock: number;
    ending_warehouse_balance: number;
    discrepancy: number;

    // Value calculation
    average_sales_price: number;
    estimated_recovery_value: number;

    // Supporting data
    event_ids: string[];
    date_range: {
        start: string;
        end: string;
    };
    fulfillment_centers: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate 60-day deadline from discovery date
 */
function calculateDeadline(discoveryDate: Date): { deadline: Date; daysRemaining: number } {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);

    const now = new Date();
    const diffTime = deadline.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

/**
 * Determine severity based on discrepancy value
 */
function calculateSeverity(estimatedValue: number): 'low' | 'medium' | 'high' | 'critical' {
    if (estimatedValue >= 1000) return 'critical';
    if (estimatedValue >= 500) return 'high';
    if (estimatedValue >= 100) return 'medium';
    return 'low';
}

/**
 * Group inventory events by FNSKU
 */
function groupByFnsku(events: InventoryLedgerEvent[]): Map<string, InventoryLedgerEvent[]> {
    const grouped = new Map<string, InventoryLedgerEvent[]>();

    for (const event of events) {
        if (!event.fnsku) continue;

        const existing = grouped.get(event.fnsku) || [];
        existing.push(event);
        grouped.set(event.fnsku, existing);
    }

    return grouped;
}

// ============================================================================
// Main Detection Algorithm - "The Whale"
// ============================================================================

/**
 * Detect Lost Inventory - The "Whale" Algorithm
 * 
 * This is the P0 priority detection that finds the most money.
 * 
 * Formula:
 *   Input = Receipts + Adjustments + Returns
 *   Output = Shipments + Removals
 *   CalculatedStock = Input - Output
 *   
 * If CalculatedStock > EndingWarehouseBalance:
 *   → Lost Inventory Detected
 *   → Recovery Value = Discrepancy × Average Sales Price
 */
export function detectLostInventory(
    sellerId: string,
    syncId: string,
    data: SyncedData
): DetectionResult[] {
    const results: DetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('🐋 [WHALE] Starting Lost Inventory Detection', {
        sellerId,
        syncId,
        eventCount: data.inventory_ledger?.length || 0
    });

    if (!data.inventory_ledger || data.inventory_ledger.length === 0) {
        logger.warn('🐋 [WHALE] No inventory ledger events found', { sellerId, syncId });
        return results;
    }

    // Step 1: Group events by FNSKU
    const groupedEvents = groupByFnsku(data.inventory_ledger);

    logger.info('🐋 [WHALE] Grouped events by FNSKU', {
        uniqueFnskus: groupedEvents.size
    });

    // Step 2: Process each FNSKU group
    for (const [fnsku, events] of groupedEvents) {
        // Initialize accumulators
        let totalReceipts = 0;
        let totalAdjustments = 0;
        let totalReturns = 0;
        let totalShipments = 0;
        let totalRemovals = 0;
        let endingWarehouseBalance = 0;
        let hasSnapshotBalance = false;

        // Track metadata
        const eventIds: string[] = [];
        const fulfillmentCenters = new Set<string>();
        let latestSnapshotDate: Date | null = null;
        let sku: string | undefined;
        let asin: string | undefined;
        let productName: string | undefined;
        let averageSalesPrice = 0;
        let priceCount = 0;

        // Step 3: Calculate Input and Output
        for (const event of events) {
            eventIds.push(event.id);

            if (event.fulfillment_center_id) {
                fulfillmentCenters.add(event.fulfillment_center_id);
            }

            // Capture product metadata from any event
            if (!sku && event.sku) sku = event.sku;
            if (!asin && event.asin) asin = event.asin;
            if (!productName && event.product_name) productName = event.product_name;

            // Accumulate average sales price
            if (event.average_sales_price && event.average_sales_price > 0) {
                averageSalesPrice += event.average_sales_price;
                priceCount++;
            }

            // Categorize by event type
            switch (event.event_type) {
                case 'Receipt':
                    totalReceipts += Math.abs(event.quantity);
                    break;

                case 'Adjustment':
                    // Adjustments can be positive or negative
                    if (event.quantity_direction === 'in' || event.quantity > 0) {
                        totalAdjustments += Math.abs(event.quantity);
                    } else {
                        // Negative adjustment counts as output
                        totalRemovals += Math.abs(event.quantity);
                    }
                    break;

                case 'Return':
                    totalReturns += Math.abs(event.quantity);
                    break;

                case 'Shipment':
                    totalShipments += Math.abs(event.quantity);
                    break;

                case 'Removal':
                case 'Disposal':
                    totalRemovals += Math.abs(event.quantity);
                    break;

                case 'Snapshot':
                    // Get the latest snapshot balance
                    const eventDate = new Date(event.event_date);
                    if (!latestSnapshotDate || eventDate > latestSnapshotDate) {
                        latestSnapshotDate = eventDate;
                        endingWarehouseBalance = event.warehouse_balance || event.quantity || 0;
                        hasSnapshotBalance = true;
                    }
                    break;
            }
        }

        // Skip if no snapshot balance to compare against
        if (!hasSnapshotBalance) {
            continue;
        }

        // Step 4: Calculate the formula
        const totalInput = totalReceipts + totalAdjustments + totalReturns;
        const totalOutput = totalShipments + totalRemovals;
        const calculatedStock = totalInput - totalOutput;

        // Step 5: Detect discrepancy
        const discrepancy = calculatedStock - endingWarehouseBalance;

        // Only flag if calculated stock > actual balance (meaning inventory is LOST)
        if (discrepancy <= 0) {
            continue;
        }

        // Step 6: Calculate value
        const avgPrice = priceCount > 0 ? averageSalesPrice / priceCount : 15.00; // Default $15 if unknown
        const estimatedRecoveryValue = discrepancy * avgPrice;

        // Skip tiny discrepancies (less than $5 recovery)
        if (estimatedRecoveryValue < 5) {
            continue;
        }

        // Step 7: Calculate confidence
        // Higher confidence for larger discrepancies (more likely systematic issue)
        const confidenceScore = discrepancy > 5 ? 0.90 : 0.70;

        // Step 8: Build evidence object
        const evidence: LostInventoryEvidence = {
            fnsku,
            sku,
            asin,
            product_name: productName,

            total_receipts: totalReceipts,
            total_adjustments: totalAdjustments,
            total_returns: totalReturns,
            total_input: totalInput,

            total_shipments: totalShipments,
            total_removals: totalRemovals,
            total_output: totalOutput,

            calculated_stock: calculatedStock,
            ending_warehouse_balance: endingWarehouseBalance,
            discrepancy,

            average_sales_price: avgPrice,
            estimated_recovery_value: estimatedRecoveryValue,

            event_ids: eventIds,
            date_range: {
                start: events[0]?.event_date || discoveryDate.toISOString(),
                end: events[events.length - 1]?.event_date || discoveryDate.toISOString()
            },
            fulfillment_centers: Array.from(fulfillmentCenters)
        };

        // Step 9: Create detection result
        const result: DetectionResult = {
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: 'lost_warehouse',
            severity: calculateSeverity(estimatedRecoveryValue),
            estimated_value: estimatedRecoveryValue,
            currency: 'USD',
            confidence_score: confidenceScore,
            evidence,
            related_event_ids: eventIds,
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            fnsku,
            sku,
            asin,
            product_name: productName
        };

        results.push(result);

        logger.info('🐋 [WHALE] Lost inventory detected!', {
            fnsku,
            discrepancy,
            estimatedValue: estimatedRecoveryValue,
            confidence: confidenceScore,
            severity: result.severity
        });
    }

    logger.info('🐋 [WHALE] Detection complete', {
        sellerId,
        syncId,
        detectionsFound: results.length,
        totalEstimatedRecovery: results.reduce((sum, r) => sum + r.estimated_value, 0)
    });

    return results;
}

// ============================================================================
// Database Integration - Fetch Inventory Ledger
// ============================================================================

/**
 * Fetch inventory ledger events from database for a seller
 * 
 * ADAPTER: Since Agent 2 uses separate tables (orders, returns, shipments, settlements),
 * we build the inventory ledger by combining data from these tables.
 */
export async function fetchInventoryLedger(
    sellerId: string,
    options?: {
        startDate?: string;
        endDate?: string;
        limit?: number;
    }
): Promise<InventoryLedgerEvent[]> {
    const events: InventoryLedgerEvent[] = [];

    try {
        logger.info('🐋 [WHALE] Building inventory ledger from Agent 2 tables', { sellerId });

        // 1. Fetch shipments (inbound = Receipt, outbound = Shipment)
        const { data: shipments, error: shipmentsError } = await supabaseAdmin
            .from('shipments')
            .select('*')
            .eq('user_id', sellerId)
            .order('shipment_date', { ascending: true });

        if (!shipmentsError && shipments) {
            for (const shipment of shipments) {
                // Inbound shipments = Receipts
                if (shipment.shipment_type === 'INBOUND' || shipment.status?.includes('INBOUND')) {
                    events.push({
                        id: shipment.shipment_id || shipment.id,
                        seller_id: sellerId,
                        fnsku: shipment.fnsku || shipment.items?.[0]?.fnsku || 'UNKNOWN',
                        sku: shipment.sku || shipment.items?.[0]?.sku,
                        asin: shipment.asin || shipment.items?.[0]?.asin,
                        product_name: shipment.product_name,
                        event_type: 'Receipt',
                        quantity: shipment.quantity_received || shipment.quantity || 0,
                        quantity_direction: 'in',
                        event_date: shipment.shipment_date || shipment.created_at,
                        fulfillment_center_id: shipment.fulfillment_center_id || shipment.destination_fc,
                        reference_id: shipment.shipment_id,
                        created_at: shipment.created_at
                    });
                } else {
                    // Outbound = customer orders shipped
                    events.push({
                        id: shipment.shipment_id || shipment.id,
                        seller_id: sellerId,
                        fnsku: shipment.fnsku || shipment.items?.[0]?.fnsku || 'UNKNOWN',
                        sku: shipment.sku || shipment.items?.[0]?.sku,
                        asin: shipment.asin || shipment.items?.[0]?.asin,
                        product_name: shipment.product_name,
                        event_type: 'Shipment',
                        quantity: shipment.quantity_shipped || shipment.quantity || 0,
                        quantity_direction: 'out',
                        event_date: shipment.shipment_date || shipment.created_at,
                        fulfillment_center_id: shipment.fulfillment_center_id,
                        reference_id: shipment.order_id || shipment.shipment_id,
                        created_at: shipment.created_at
                    });
                }
            }
            logger.info('🐋 [WHALE] Processed shipments', { count: shipments.length });
        }

        // 2. Fetch returns (customer returns = inventory back in)
        const { data: returns, error: returnsError } = await supabaseAdmin
            .from('returns')
            .select('*')
            .eq('user_id', sellerId)
            .order('returned_date', { ascending: true });

        if (!returnsError && returns) {
            for (const returnData of returns) {
                const items = returnData.items || [];
                for (const item of items) {
                    events.push({
                        id: `return-${returnData.return_id}-${item.sku || 'item'}`,
                        seller_id: sellerId,
                        fnsku: item.fnsku || item.asin || 'UNKNOWN',
                        sku: item.sku,
                        asin: item.asin,
                        event_type: 'Return',
                        quantity: item.quantity || 1,
                        quantity_direction: 'in',
                        event_date: returnData.returned_date || returnData.created_at,
                        reference_id: returnData.order_id,
                        average_sales_price: item.refund_amount || returnData.refund_amount,
                        created_at: returnData.created_at
                    });
                }
            }
            logger.info('🐋 [WHALE] Processed returns', { count: returns.length });
        }

        // 3. Fetch orders (for tracking quantities sold)
        const { data: orders, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('*')
            .eq('user_id', sellerId)
            .eq('order_status', 'Shipped')
            .order('order_date', { ascending: true });

        if (!ordersError && orders) {
            for (const order of orders) {
                const items = order.items || [];
                for (const item of items) {
                    events.push({
                        id: `order-${order.order_id}-${item.sku || 'item'}`,
                        seller_id: sellerId,
                        fnsku: item.fnsku || item.asin || 'UNKNOWN',
                        sku: item.sku,
                        asin: item.asin,
                        product_name: item.title,
                        event_type: 'Shipment',
                        quantity: item.quantity || 1,
                        quantity_direction: 'out',
                        event_date: order.shipment_date || order.order_date,
                        reference_id: order.order_id,
                        average_sales_price: item.price,
                        created_at: order.created_at
                    });
                }
            }
            logger.info('🐋 [WHALE] Processed orders', { count: orders.length });
        }

        // 4. Fetch settlements for reimbursements/adjustments
        const { data: settlements, error: settlementsError } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .in('transaction_type', ['reimbursement', 'adjustment'])
            .order('settlement_date', { ascending: true });

        if (!settlementsError && settlements) {
            for (const settlement of settlements) {
                if (settlement.transaction_type === 'reimbursement') {
                    // Reimbursements don't directly affect inventory ledger
                    // but we track them for the reimbursement check in detection
                    continue;
                }

                events.push({
                    id: settlement.settlement_id || settlement.id,
                    seller_id: sellerId,
                    fnsku: settlement.metadata?.fnsku || 'UNKNOWN',
                    sku: settlement.metadata?.sku,
                    event_type: 'Adjustment',
                    quantity: settlement.amount > 0 ? 1 : -1,
                    quantity_direction: settlement.amount > 0 ? 'in' : 'out',
                    event_date: settlement.settlement_date,
                    reference_id: settlement.order_id,
                    created_at: settlement.created_at
                });
            }
            logger.info('🐋 [WHALE] Processed settlements', { count: settlements.length });
        }

        // Sort all events by date
        events.sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

        logger.info('🐋 [WHALE] Inventory ledger built', {
            sellerId,
            totalEvents: events.length
        });

        return events;
    } catch (err: any) {
        logger.error('🐋 [WHALE] Exception building inventory ledger', {
            sellerId,
            error: err.message
        });
        return [];
    }
}

/**
 * Run full lost inventory detection for a seller
 */
export async function runLostInventoryDetection(
    sellerId: string,
    syncId: string
): Promise<DetectionResult[]> {
    logger.info('🐋 [WHALE] Starting full detection run', { sellerId, syncId });

    // Fetch inventory ledger from database
    const inventoryLedger = await fetchInventoryLedger(sellerId, {
        // Look at last 90 days by default
        startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    });

    if (inventoryLedger.length === 0) {
        logger.warn('🐋 [WHALE] No inventory ledger data found', { sellerId });
        return [];
    }

    // Create SyncedData object
    const syncedData: SyncedData = {
        seller_id: sellerId,
        sync_id: syncId,
        inventory_ledger: inventoryLedger
    };

    // Run detection
    return detectLostInventory(sellerId, syncId, syncedData);
}

// ============================================================================
// Store Detection Results
// ============================================================================

/**
 * Store detection results in the detection_results table
 */
export async function storeDetectionResults(results: DetectionResult[]): Promise<void> {
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
            status: 'open',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .upsert(records, {
                onConflict: 'seller_id,sync_id,anomaly_type',
                ignoreDuplicates: false
            });

        if (error) {
            logger.error('🐋 [WHALE] Error storing detection results', {
                error: error.message,
                count: results.length
            });
        } else {
            logger.info('🐋 [WHALE] Detection results stored', {
                count: results.length
            });
        }
    } catch (err: any) {
        logger.error('🐋 [WHALE] Exception storing detection results', {
            error: err.message
        });
    }
}

// ============================================================================
// Exports
// ============================================================================

export default {
    detectLostInventory,
    fetchInventoryLedger,
    runLostInventoryDetection,
    storeDetectionResults
};
