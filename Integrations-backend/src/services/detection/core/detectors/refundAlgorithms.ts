/**
 * Refund Detection Algorithms - "The Refund Trap"
 * 
 * Flagship 5: Refund Without Return Detection
 * Finds money owed when customers got refunds but never returned the product.
 * 
 * Hardening Round 1:
 * - Unit-level reconciliation (Broke the Boolean Return Wall)
 * - Status-aware return filtering (Pending/Maturity logic)
 * - Currency-safe shortfall math
 */

import { supabaseAdmin } from '../../../../database/supabaseClient';
import logger from '../../../../utils/logger';
import { resolveTenantId } from './shared/tenantUtils';

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
    reimbursement_type: string;
    quantity_reimbursed?: number;
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

    // Reconciliation results
    returned_units: number;
    damaged_units: number;
    reimbursed_units: number;
    reimbursed_value: number;
    unresolved_units: number;
    shortfall_delta: number;

    // Metadata for traceability
    return_status_mode: 'precise' | 'fallback' | 'exception';
    damaged_return_mode: 'none' | 'unreimbursed' | 'reimbursed';
    currency_match_mode: 'parity' | 'mismatch' | 'none';
    value_reconciliation_mode: 'unit_weighted' | 'scalar_shortfall';
    ownership_mode: 'claim_direct' | 'monitor_reimb' | 'none';

    // The trap analysis
    days_since_refund: number;
    return_found: boolean;
    reimbursement_found: boolean;
    total_reimbursed: number;

    evidence_summary: string;
    refund_event_id: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateDeadline(discoveryDate: Date): { deadline: Date; daysRemaining: number } {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);
    const now = new Date();
    const diffTime = deadline.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

function calculateSeverity(amount: number): 'low' | 'medium' | 'high' | 'critical' {
    if (amount >= 200) return 'critical';
    if (amount >= 100) return 'high';
    if (amount >= 25) return 'medium';
    return 'low';
}

function daysBetween(date1: Date, date2: Date): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================================
// Main Detection Algorithm
// ============================================================================

export function detectRefundWithoutReturn(
    sellerId: string,
    syncId: string,
    data: RefundSyncedData
): RefundDetectionResult[] {
    const results: RefundDetectionResult[] = [];
    const discoveryDate = new Date();
    const now = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('🪤 [REFUND TRAP] Starting Hardened Detection Run', { sellerId, syncId });

    if (!data.refund_events || data.refund_events.length === 0) return results;

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

    for (const refund of data.refund_events) {
        const refundDate = new Date(refund.refund_date);
        const daysSinceRefund = daysBetween(refundDate, now);
        
        // Maturity Window: 45 days
        if (daysSinceRefund < 45) continue;

        const quantityRefunded = refund.quantity_refunded || 1;
        const returns = returnsByOrderId.get(refund.order_id) || [];
        
        // Status-Aware Return Reconciliation
        let returnStatusMode: RefundWithoutReturnEvidence['return_status_mode'] = 'precise';
        let totalDamagedQty = 0;
        let oldestDamagedReturnAge = 0;

        const totalReturnedQty = returns
            .filter(ret => {
                // SKU isolation: only filter out if BOTH have SKUs and they mismatch
                if (refund.sku && ret.sku && ret.sku !== refund.sku) return false;
                
                // Status-Aware Return Reconciliation (Optimistic for precision)
                const status = ret.return_status?.toLowerCase();
                const disposition = ret.disposition?.toLowerCase();
                const arrivalAge = daysBetween(new Date(ret.return_date), now);

                // 1. Amazon Fault (Carrier Damage / Damaged) - Check priority disposition first
                if (status === 'carrier_damaged' || disposition === 'carrier_damaged' || disposition === 'damaged') {
                    returnStatusMode = 'exception';
                    const qty = ret.quantity_returned || 1;
                    totalDamagedQty += qty;
                    oldestDamagedReturnAge = Math.max(oldestDamagedReturnAge, arrivalAge);
                    return false; // This is a trap! Amazon fault.
                }

                // 2. Definite Recoveries or Missing Metadata (assume received if record exists)
                if (!status || status === 'received' || disposition === 'sellable' || disposition === 'defective' || disposition === 'customer_damaged') return true;

                // 3. Pending Maturity (60-day limit)
                if (status === 'pending') {
                    if (arrivalAge > 60) return false; // Abandoned pending
                    return true;
                }

                return false;
            })
            .reduce((sum, ret) => sum + (ret.quantity_returned || 1), 0);

        // Reimbursement Reconciliation with Currency Safety
        const reimbursements = reimbursementsByOrderId.get(refund.order_id) || [];
        let currencyMismatchDetected = false;
        
        const matchingReimbs = reimbursements.filter(reimb => {
            if (refund.sku && reimb.sku && reimb.sku !== refund.sku) return false;
            if (reimb.currency && refund.currency && reimb.currency !== refund.currency) {
                currencyMismatchDetected = true;
            }
            return true;
        });

        const currencyMatchMode: RefundWithoutReturnEvidence['currency_match_mode'] = currencyMismatchDetected ? 'mismatch' : 'parity';
        const totalReimbursedQty = matchingReimbs.reduce((sum, r) => sum + (r.quantity_reimbursed || 0), 0);
        const totalReimbursedValue = matchingReimbs.reduce((sum, r) => sum + (r.reimbursement_amount || 0), 0);

        // Reconciliation Math
        const unresolvedUnits = Math.max(0, quantityRefunded - totalReturnedQty - totalReimbursedQty);
        const unitPrice = refund.refund_amount / quantityRefunded;
        
        // Final Shortfall calculation
        let shortfallValue = 0;
        let reconMode: RefundWithoutReturnEvidence['value_reconciliation_mode'] = 'unit_weighted';

        if (currencyMatchMode === 'mismatch') {
            shortfallValue = unresolvedUnits * unitPrice;
        } else {
            // High-fidelity value netting (TRUST DOLLARS OVER METADATA)
            const valueShortfall = refund.refund_amount - totalReimbursedValue - (totalReturnedQty * unitPrice);
            shortfallValue = Math.max(0, valueShortfall);
            
            if (shortfallValue > (unresolvedUnits * unitPrice) + 0.1) {
                reconMode = 'scalar_shortfall';
            }
        }

        // Ownership & Damaged Return Maturity Handling
        let ownershipMode: RefundWithoutReturnEvidence['ownership_mode'] = 'none';
        let damagedReturnMode: RefundWithoutReturnEvidence['damaged_return_mode'] = 'none';

        if (totalDamagedQty > 0) {
            damagedReturnMode = totalReimbursedQty >= totalDamagedQty ? 'reimbursed' : 'unreimbursed';
            
            if (damagedReturnMode === 'unreimbursed') {
                // Maturity check: only claim if received > 30 days ago
                if (oldestDamagedReturnAge > 30) {
                    ownershipMode = 'claim_direct';
                } else {
                    ownershipMode = 'monitor_reimb';
                    // Suppress from value if not mature to maintain 100% precision
                    shortfallValue = Math.max(0, shortfallValue - (totalDamagedQty * unitPrice));
                }
            }
        }

        if (ownershipMode === 'none' && unresolvedUnits > 0) {
            ownershipMode = 'claim_direct';
        }

        // Precision Suppression: If no money is missing, it's not a trap.
        if (shortfallValue <= 0.05) continue;

        const evidence: RefundWithoutReturnEvidence = {
            order_id: refund.order_id,
            sku: refund.sku, asin: refund.asin, product_name: refund.product_name,
            refund_date: refund.refund_date,
            refund_amount: refund.refund_amount,
            quantity_refunded: quantityRefunded,
            returned_units: totalReturnedQty,
            damaged_units: totalDamagedQty,
            reimbursed_units: totalReimbursedQty,
            reimbursed_value: totalReimbursedValue,
            unresolved_units: unresolvedUnits,
            shortfall_delta: shortfallValue,
            return_status_mode: returnStatusMode,
            damaged_return_mode: damagedReturnMode,
            currency_match_mode: currencyMatchMode,
            value_reconciliation_mode: reconMode,
            ownership_mode: ownershipMode,
            days_since_refund: daysSinceRefund,
            return_found: totalReturnedQty > 0 || totalDamagedQty > 0,
            reimbursement_found: totalReimbursedValue > 0,
            total_reimbursed: totalReimbursedValue,
            refund_event_id: refund.id,
            evidence_summary: `Refunded ${quantityRefunded} units ($${refund.refund_amount.toFixed(2)}). ` +
                `Reconciled: ${totalReturnedQty} clean, ${totalDamagedQty} damaged, ${totalReimbursedQty} reimbursed. ` +
                `Ownership: ${ownershipMode}. Unresolved: ${unresolvedUnits} units worth $${shortfallValue.toFixed(2)}.`
        };

        results.push({
            seller_id: sellerId, sync_id: syncId,
            anomaly_type: 'refund_no_return',
            severity: calculateSeverity(shortfallValue),
            estimated_value: shortfallValue,
            currency: refund.currency || 'USD',
            confidence_score: daysSinceRefund > 60 ? 0.95 : 0.75,
            evidence,
            related_event_ids: [refund.id],
            discovery_date: discoveryDate, 
            deadline_date: deadline, 
            days_remaining: daysRemaining,
            order_id: refund.order_id, sku: refund.sku
        });
    }

    return results;
}

// ============================================================================
// Data Fetchers
// ============================================================================

export async function fetchRefundEvents(sellerId: string, options?: { startDate?: string }): Promise<RefundEvent[]> {
    const tenantId = await resolveTenantId(sellerId);
    const { data, error } = await supabaseAdmin.from('settlements')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', sellerId)
        .in('transaction_type', ['refund', 'fee'])
        .filter('amount', 'lt', 0);
    
    if (error) return [];
    return data.map(s => ({
        id: s.id, seller_id: sellerId, order_id: s.order_id || '',
        sku: s.metadata?.sku, asin: s.metadata?.asin,
        refund_amount: Math.abs(s.amount), currency: s.currency || 'USD',
        refund_date: s.settlement_date, created_at: s.created_at,
        quantity_refunded: s.metadata?.quantity || 1
    }));
}

export async function fetchReturnEvents(sellerId: string, options?: { startDate?: string }): Promise<ReturnEvent[]> {
    const tenantId = await resolveTenantId(sellerId);
    const { data, error } = await supabaseAdmin.from('returns')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', sellerId);
    
    if (error) return [];
    return data.map(r => ({
        id: r.id, seller_id: sellerId, order_id: r.order_id || '',
        sku: r.items?.[0]?.sku, asin: r.items?.[0]?.asin,
        return_date: r.returned_date, return_status: r.status || 'received',
        quantity_returned: r.items?.[0]?.quantity || 1,
        disposition: r.metadata?.disposition, created_at: r.created_at
    }));
}

export async function fetchReimbursementEvents(sellerId: string, options?: { startDate?: string }): Promise<ReimbursementEvent[]> {
    const tenantId = await resolveTenantId(sellerId);
    const { data, error } = await supabaseAdmin.from('settlements')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', sellerId)
        .eq('transaction_type', 'reimbursement');
    
    if (error) return [];
    return data.map(s => ({
        id: s.id, seller_id: sellerId, order_id: s.order_id,
        sku: s.metadata?.sku, reimbursement_amount: s.amount || 0,
        currency: s.currency || 'USD', reimbursement_date: s.settlement_date,
        reimbursement_type: s.metadata?.adjustmentType || 'REIMBURSEMENT',
        quantity_reimbursed: s.metadata?.quantity || 0,
        created_at: s.created_at
    }));
}

export async function runRefundWithoutReturnDetection(sellerId: string, syncId: string): Promise<RefundDetectionResult[]> {
    const lookback = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const [refunds, returns, reimbs] = await Promise.all([
        fetchRefundEvents(sellerId, { startDate: lookback }),
        fetchReturnEvents(sellerId, { startDate: lookback }),
        fetchReimbursementEvents(sellerId, { startDate: lookback })
    ]);
    const results = await detectRefundWithoutReturn(sellerId, syncId, { 
        seller_id: sellerId, 
        sync_id: syncId, 
        refund_events: refunds, 
        return_events: returns, 
        reimbursement_events: reimbs 
    });
    
    if (results.length > 0) {
        await storeRefundDetectionResults(results);
    }
    
    return results;
}

export async function storeRefundDetectionResults(results: RefundDetectionResult[]): Promise<void> {
    if (results.length === 0) return;
    const tenantId = await resolveTenantId(results[0].seller_id);
    const records = results.map(r => ({
        seller_id: r.seller_id, sync_id: r.sync_id, anomaly_type: r.anomaly_type,
        severity: r.severity, estimated_value: r.estimated_value, currency: r.currency,
        confidence_score: r.confidence_score, evidence: r.evidence, related_event_ids: r.related_event_ids,
        discovery_date: r.discovery_date.toISOString(), deadline_date: r.deadline_date.toISOString(),
        days_remaining: r.days_remaining, tenant_id: tenantId, status: 'detected',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }));
    await supabaseAdmin.from('detection_results').upsert(records, { onConflict: 'seller_id,sync_id,anomaly_type' });
}

export default {
    detectRefundWithoutReturn,
    runRefundWithoutReturnDetection,
    storeRefundDetectionResults
};
