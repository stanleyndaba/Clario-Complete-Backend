/**
 * Refund Detection Algorithms - "The Refund Trap"
 * 
 * Phase 2, P0 Priority: Refund Without Return Detection
 * Finds money owed when customers got refunds but never returned the product.
 * 
 * Algorithm Logic:
 * 1. Scan all refund events
 * 2. Filter for refunds older than 45 days (Amazon's return window)
 * 3. Check if a return was ever scanned for this order
 * 4. Check if a reimbursement was already issued
 * 5. If Refund + No Return + No Reimbursement = TRAP SPRUNG 💰
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface RefundEvent {
    id: string;
    seller_id: string;
    order_id: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    product_name?: string;
    refund_amount: number;
    currency: string;
    refund_date: string;
    refund_reason?: string;
    quantity_refunded?: number;
    marketplace_id?: string;
    created_at: string;
}

export interface ReturnEvent {
    id: string;
    seller_id: string;
    order_id: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    return_date: string;
    return_status: string;  // 'received', 'pending', 'carrier_damaged', etc.
    quantity_returned?: number;
    disposition?: string;   // 'sellable', 'damaged', 'defective', etc.
    fulfillment_center_id?: string;
    created_at: string;
}

export interface ReimbursementEvent {
    id: string;
    seller_id: string;
    order_id?: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    reimbursement_amount: number;
    currency: string;
    reimbursement_date: string;
    reimbursement_type: string;  // 'REVERSAL', 'REFUND_COMMISSION', etc.
    reason_code?: string;
    created_at: string;
}

export interface RefundSyncedData {
    seller_id: string;
    sync_id: string;
    refund_events: RefundEvent[];
    return_events: ReturnEvent[];
    reimbursement_events: ReimbursementEvent[];
}

export interface RefundDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: 'refund_no_return';
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: RefundWithoutReturnEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    order_id: string;
    sku?: string;
    asin?: string;
    product_name?: string;
}

export interface RefundWithoutReturnEvidence {
    order_id: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // Refund details
    refund_date: string;
    refund_amount: number;
    refund_reason?: string;
    quantity_refunded: number;

    // The trap analysis
    days_since_refund: number;
    return_found: boolean;
    reimbursement_found: boolean;

    // Human-readable evidence
    evidence_summary: string;

    // IDs for audit trail
    refund_event_id: string;
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
 * Determine severity based on refund value
 */
function calculateSeverity(refundAmount: number): 'low' | 'medium' | 'high' | 'critical' {
    if (refundAmount >= 200) return 'critical';
    if (refundAmount >= 100) return 'high';
    if (refundAmount >= 25) return 'medium';
    return 'low';
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================================
// Main Detection Algorithm - "The Refund Trap"
// ============================================================================

/**
 * Detect Refund Without Return - The "Refund Trap" Algorithm
 * 
 * This P0 algorithm finds cases where:
 * - Customer got a refund
 * - 45+ days have passed (Amazon's return window expired)
 * - No return was ever scanned
 * - No reimbursement was issued
 * 
 * = SELLER IS OWED MONEY
 * 
 * Confidence:
 * - > 60 days since refund: 95%
 * - 45-60 days since refund: 75%
 */
export function detectRefundWithoutReturn(
    sellerId: string,
    syncId: string,
    data: RefundSyncedData
): RefundDetectionResult[] {
    const results: RefundDetectionResult[] = [];
    const discoveryDate = new Date();
    const now = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('🪤 [REFUND TRAP] Starting Refund Without Return Detection', {
        sellerId,
        syncId,
        refundCount: data.refund_events?.length || 0,
        returnCount: data.return_events?.length || 0,
        reimbursementCount: data.reimbursement_events?.length || 0
    });

    if (!data.refund_events || data.refund_events.length === 0) {
        logger.warn('🪤 [REFUND TRAP] No refund events found', { sellerId, syncId });
        return results;
    }

    // Create lookup maps for fast searching
    const returnsByOrderId = new Map<string, ReturnEvent[]>();
    for (const ret of (data.return_events || [])) {
        if (!ret.order_id) continue;
        const existing = returnsByOrderId.get(ret.order_id) || [];
        existing.push(ret);
        returnsByOrderId.set(ret.order_id, existing);
    }

    const reimbursementsByOrderId = new Map<string, ReimbursementEvent[]>();
    for (const reimb of (data.reimbursement_events || [])) {
        if (!reimb.order_id) continue;
        const existing = reimbursementsByOrderId.get(reimb.order_id) || [];
        existing.push(reimb);
        reimbursementsByOrderId.set(reimb.order_id, existing);
    }

    // Process each refund
    for (const refund of data.refund_events) {
        const refundDate = new Date(refund.refund_date);
        const daysSinceRefund = daysBetween(refundDate, now);

        // THE 45-DAY RULE: Skip refunds that are too recent
        // Amazon allows 45 days for returns, so we can't claim before then
        if (daysSinceRefund < 45) {
            continue;
        }

        // Check for return on this order
        const returns = returnsByOrderId.get(refund.order_id) || [];
        const matchingReturn = returns.find(ret => {
            // Match by order_id, and optionally by SKU if available
            if (refund.sku && ret.sku) {
                return ret.sku === refund.sku;
            }
            return true; // If no SKU, any return for this order counts
        });

        const returnFound = !!matchingReturn;

        // Check for reimbursement on this order
        const reimbursements = reimbursementsByOrderId.get(refund.order_id) || [];
        const matchingReimbursement = reimbursements.find(reimb => {
            // Match by order_id, and optionally by SKU if available
            if (refund.sku && reimb.sku) {
                return reimb.sku === refund.sku;
            }
            return true; // If no SKU, any reimbursement for this order counts
        });

        const reimbursementFound = !!matchingReimbursement;

        // THE TRAP: Refund exists + No Return + No Reimbursement = ANOMALY
        if (returnFound || reimbursementFound) {
            // Not an anomaly - either product was returned or we got reimbursed
            continue;
        }

        // 🪤 TRAP SPRUNG! This is money owed to the seller

        // Calculate confidence based on age
        // > 60 days: 95% confidence (very confident return window is closed)
        // 45-60 days: 75% confidence (return window just closed)
        const confidenceScore = daysSinceRefund > 60 ? 0.95 : 0.75;

        // Skip tiny refunds (less than $3)
        if (refund.refund_amount < 3) {
            continue;
        }

        // Build human-readable evidence summary
        const evidenceSummary = `Refunded $${refund.refund_amount.toFixed(2)} on ${refundDate.toLocaleDateString()
            }, no return scan found after ${daysSinceRefund} days. ` +
            `Return window (45 days) has expired. Customer kept product and refund.`;

        // Build evidence object
        const evidence: RefundWithoutReturnEvidence = {
            order_id: refund.order_id,
            sku: refund.sku,
            asin: refund.asin,
            product_name: refund.product_name,

            refund_date: refund.refund_date,
            refund_amount: refund.refund_amount,
            refund_reason: refund.refund_reason,
            quantity_refunded: refund.quantity_refunded || 1,

            days_since_refund: daysSinceRefund,
            return_found: returnFound,
            reimbursement_found: reimbursementFound,

            evidence_summary: evidenceSummary,
            refund_event_id: refund.id
        };

        // Create detection result
        const result: RefundDetectionResult = {
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: 'refund_no_return',
            severity: calculateSeverity(refund.refund_amount),
            estimated_value: refund.refund_amount,
            currency: refund.currency || 'USD',
            confidence_score: confidenceScore,
            evidence,
            related_event_ids: [refund.order_id || refund.id],
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            order_id: refund.order_id,
            sku: refund.sku,
            asin: refund.asin,
            product_name: refund.product_name
        };

        results.push(result);

        logger.info('🪤 [REFUND TRAP] Trapped! Refund without return detected', {
            orderId: refund.order_id,
            refundAmount: refund.refund_amount,
            daysSinceRefund,
            confidence: confidenceScore,
            severity: result.severity
        });
    }

    logger.info('🪤 [REFUND TRAP] Detection complete', {
        sellerId,
        syncId,
        detectionsFound: results.length,
        totalEstimatedRecovery: results.reduce((sum, r) => sum + r.estimated_value, 0)
    });

    return results;
}

// ============================================================================
// Database Integration - Fetch Refund/Return/Reimbursement Data
// ============================================================================

/**
 * Fetch refund events from database
 * 
 * ADAPTER: Agent 2 stores refunds in the settlements table with transaction_type = 'fee' 
 * or in orders as refund-related records. We extract from settlements.
 */
export async function fetchRefundEvents(
    sellerId: string,
    options?: { startDate?: string; endDate?: string; limit?: number }
): Promise<RefundEvent[]> {
    try {
        logger.info('🪤 [REFUND TRAP] Fetching refund events from settlements table', { sellerId });

        // Refunds are typically negative amounts in settlements or have specific transaction types
        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .in('transaction_type', ['refund', 'fee', 'shipment_fee'])
            .order('settlement_date', { ascending: false });

        if (error) {
            logger.error('🪤 [REFUND TRAP] Error fetching settlements', { sellerId, error: error.message });
            return [];
        }

        // Transform settlements into refund events
        const refundEvents: RefundEvent[] = (data || [])
            .filter(s => s.amount < 0 || s.transaction_type === 'refund')
            .map(settlement => ({
                id: settlement.id || settlement.settlement_id,
                seller_id: sellerId,
                order_id: settlement.order_id || '',
                sku: settlement.metadata?.sku,
                asin: settlement.metadata?.asin,
                refund_amount: Math.abs(settlement.amount || 0),
                currency: settlement.currency || 'USD',
                refund_date: settlement.settlement_date,
                refund_reason: settlement.metadata?.reason || 'Customer Refund',
                created_at: settlement.created_at
            }));

        logger.info('🪤 [REFUND TRAP] Extracted refund events', { count: refundEvents.length });
        return refundEvents;
    } catch (err: any) {
        logger.error('🪤 [REFUND TRAP] Exception fetching refund events', { sellerId, error: err.message });
        return [];
    }
}

/**
 * Fetch return events from database
 * 
 * ADAPTER: Uses Agent 2's 'returns' table directly
 */
export async function fetchReturnEvents(
    sellerId: string,
    options?: { startDate?: string; limit?: number }
): Promise<ReturnEvent[]> {
    try {
        logger.info('🪤 [REFUND TRAP] Fetching return events from returns table', { sellerId });

        let query = supabaseAdmin
            .from('returns')
            .select('*')
            .eq('user_id', sellerId)
            .order('returned_date', { ascending: false });

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('🪤 [REFUND TRAP] Error fetching returns', { sellerId, error: error.message });
            return [];
        }

        // Transform returns to ReturnEvent format
        const returnEvents: ReturnEvent[] = (data || []).map(ret => ({
            id: ret.id || ret.return_id,
            seller_id: sellerId,
            order_id: ret.order_id || '',
            sku: ret.items?.[0]?.sku,
            asin: ret.items?.[0]?.asin,
            return_date: ret.returned_date,
            return_status: ret.status || 'received',
            quantity_returned: ret.items?.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0) || 1,
            disposition: ret.metadata?.disposition,
            fulfillment_center_id: ret.metadata?.fulfillmentCenterId,
            created_at: ret.created_at
        }));

        logger.info('🪤 [REFUND TRAP] Fetched return events', { count: returnEvents.length });
        return returnEvents;
    } catch (err: any) {
        logger.error('🪤 [REFUND TRAP] Exception fetching return events', { sellerId, error: err.message });
        return [];
    }
}

/**
 * Fetch reimbursement events from database
 * 
 * ADAPTER: Uses Agent 2's 'settlements' table filtered by transaction_type = 'reimbursement'
 */
export async function fetchReimbursementEvents(
    sellerId: string,
    options?: { startDate?: string; limit?: number }
): Promise<ReimbursementEvent[]> {
    try {
        logger.info('🪤 [REFUND TRAP] Fetching reimbursements from settlements table', { sellerId });

        let query = supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .eq('transaction_type', 'reimbursement')
            .order('settlement_date', { ascending: false });

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('🪤 [REFUND TRAP] Error fetching reimbursements', { sellerId, error: error.message });
            return [];
        }

        // Transform settlements to ReimbursementEvent format
        const reimbursementEvents: ReimbursementEvent[] = (data || []).map(settlement => ({
            id: settlement.id || settlement.settlement_id,
            seller_id: sellerId,
            order_id: settlement.order_id,
            sku: settlement.metadata?.sku,
            asin: settlement.metadata?.asin,
            reimbursement_amount: settlement.amount || 0,
            currency: settlement.currency || 'USD',
            reimbursement_date: settlement.settlement_date,
            reimbursement_type: settlement.metadata?.adjustmentType || 'REIMBURSEMENT',
            reason_code: settlement.metadata?.reason,
            created_at: settlement.created_at
        }));

        logger.info('🪤 [REFUND TRAP] Fetched reimbursement events', { count: reimbursementEvents.length });
        return reimbursementEvents;
    } catch (err: any) {
        logger.error('🪤 [REFUND TRAP] Exception fetching reimbursement events', { sellerId, error: err.message });
        return [];
    }
}

/**
 * Run full refund without return detection for a seller
 */
export async function runRefundWithoutReturnDetection(
    sellerId: string,
    syncId: string
): Promise<RefundDetectionResult[]> {
    logger.info('🪤 [REFUND TRAP] Starting full detection run', { sellerId, syncId });

    // Fetch all data from database - look at last 120 days to catch 45+ day old refunds
    const lookbackDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();

    const [refundEvents, returnEvents, reimbursementEvents] = await Promise.all([
        fetchRefundEvents(sellerId, { startDate: lookbackDate }),
        fetchReturnEvents(sellerId, { startDate: lookbackDate }),
        fetchReimbursementEvents(sellerId, { startDate: lookbackDate })
    ]);

    logger.info('🪤 [REFUND TRAP] Data fetched', {
        sellerId,
        refunds: refundEvents.length,
        returns: returnEvents.length,
        reimbursements: reimbursementEvents.length
    });

    if (refundEvents.length === 0) {
        logger.warn('🪤 [REFUND TRAP] No refund events found', { sellerId });
        return [];
    }

    // Build synced data object
    const syncedData: RefundSyncedData = {
        seller_id: sellerId,
        sync_id: syncId,
        refund_events: refundEvents,
        return_events: returnEvents,
        reimbursement_events: reimbursementEvents
    };

    // Run detection
    return detectRefundWithoutReturn(sellerId, syncId, syncedData);
}

/**
 * Store refund detection results in database
 */
export async function storeRefundDetectionResults(results: RefundDetectionResult[]): Promise<void> {
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
            logger.error('🪤 [REFUND TRAP] Error storing detection results', {
                error: error.message,
                count: results.length
            });
        } else {
            logger.info('🪤 [REFUND TRAP] Detection results stored', {
                count: results.length
            });
        }
    } catch (err: any) {
        logger.error('🪤 [REFUND TRAP] Exception storing detection results', {
            error: err.message
        });
    }
}

// ============================================================================
// Exports
// ============================================================================

export default {
    detectRefundWithoutReturn,
    fetchRefundEvents,
    fetchReturnEvents,
    fetchReimbursementEvents,
    runRefundWithoutReturnDetection,
    storeRefundDetectionResults
};
