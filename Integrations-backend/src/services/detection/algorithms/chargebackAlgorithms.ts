/**
 * Chargeback Detection Algorithms - "The Dispute Defender"
 * 
 * Phase 2, P2 Priority: Chargeback and Dispute Detection
 * Finds money lost to undefended chargebacks, A-to-Z claims, and SAFE-T issues.
 * 
 * Covers:
 * - Chargebacks (credit card disputes)
 * - A-to-Z Guarantee Claims
 * - SAFE-T Claims (seller-at-fault transactions)
 * - INR (Item Not Received) claims with delivery proof
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type DisputeAnomalyType =
    | 'chargeback'
    | 'atoz_claim'
    | 'safet_claim'
    | 'inr_claim'
    | 'undefended_dispute';

export interface ChargebackEvent {
    id: string;
    seller_id: string;
    order_id: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // Chargeback details
    chargeback_type: 'credit_card' | 'atoz' | 'safet' | 'inr' | 'other';
    chargeback_amount: number;
    currency: string;
    chargeback_date: string;
    chargeback_reason?: string;

    // Status
    status: 'open' | 'won' | 'lost' | 'expired' | 'pending_response';
    response_deadline?: string;

    // Seller response
    seller_responded: boolean;
    response_date?: string;
    response_type?: string;

    // Order details
    order_date?: string;
    shipped_date?: string;
    delivered_date?: string;
    delivery_confirmed: boolean;

    // Evidence available
    has_tracking: boolean;
    has_pod: boolean;  // Proof of Delivery
    has_signature: boolean;

    created_at: string;
}

export interface DeliveryRecord {
    id: string;
    order_id: string;
    tracking_number?: string;
    carrier?: string;
    shipped_date?: string;
    delivered_date?: string;
    delivery_status: 'pending' | 'in_transit' | 'delivered' | 'returned' | 'lost';
    delivery_confirmed: boolean;
    signature_confirmed: boolean;
    pod_available: boolean;
    recipient_name?: string;
}

export interface DisputeSyncedData {
    seller_id: string;
    sync_id: string;
    chargeback_events: ChargebackEvent[];
    delivery_records: DeliveryRecord[];
}

export interface DisputeDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: DisputeAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: DisputeEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    order_id: string;
    sku?: string;
    asin?: string;
    product_name?: string;
    action_required: string;
}

export interface DisputeEvidence {
    order_id: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // Dispute details
    dispute_type: string;
    dispute_amount: number;
    dispute_date: string;
    dispute_reason?: string;

    // Defense opportunity
    defense_available: boolean;
    defense_reason: string;
    response_deadline?: string;
    days_to_respond?: number;

    // Delivery proof
    has_tracking: boolean;
    has_pod: boolean;
    has_signature: boolean;
    delivered_date?: string;
    carrier?: string;

    // Human-readable
    evidence_summary: string;
    recommended_action: string;

    // IDs
    chargeback_event_id: string;
    delivery_record_id?: string;
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
    if (amount >= 30) return 'medium';
    return 'low';
}

function daysBetween(date1: Date, date2: Date): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================================
// Main Detection Algorithms
// ============================================================================

/**
 * Detect Defensible Chargebacks
 * 
 * Finds chargebacks that can potentially be won because:
 * - Delivery was confirmed (with tracking/POD)
 * - Response deadline hasn't passed
 * - Seller hasn't responded yet
 */
export function detectDefensibleChargebacks(
    sellerId: string,
    syncId: string,
    data: DisputeSyncedData
): DisputeDetectionResult[] {
    const results: DisputeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);
    const now = new Date();

    logger.info('🛡️ [DISPUTE DEFENDER] Starting Defensible Chargeback Detection', {
        sellerId,
        syncId,
        chargebackCount: data.chargeback_events?.length || 0,
        deliveryCount: data.delivery_records?.length || 0
    });

    // Build delivery lookup by order_id
    const deliveryByOrderId = new Map<string, DeliveryRecord>();
    for (const delivery of (data.delivery_records || [])) {
        deliveryByOrderId.set(delivery.order_id, delivery);
    }

    // Analyze each chargeback
    for (const chargeback of (data.chargeback_events || [])) {
        // Skip already won or responded chargebacks
        if (chargeback.status === 'won' || chargeback.seller_responded) {
            continue;
        }

        // Check if response deadline has passed
        if (chargeback.response_deadline) {
            const responseDeadline = new Date(chargeback.response_deadline);
            if (responseDeadline < now) {
                // Deadline passed - track as lost opportunity
                if (chargeback.status !== 'expired' && chargeback.status !== 'lost') {
                    const { deadline: recDeadline, daysRemaining: recDays } = calculateDeadline(discoveryDate);

                    // Check if we had evidence to defend
                    const delivery = deliveryByOrderId.get(chargeback.order_id);
                    const hadDefense = delivery?.delivery_confirmed ||
                        chargeback.has_pod ||
                        chargeback.has_tracking;

                    if (hadDefense) {
                        results.push({
                            seller_id: sellerId,
                            sync_id: syncId,
                            anomaly_type: 'undefended_dispute',
                            severity: calculateSeverity(chargeback.chargeback_amount),
                            estimated_value: chargeback.chargeback_amount,
                            currency: chargeback.currency || 'USD',
                            confidence_score: 0.70, // Lower confidence since deadline passed
                            evidence: {
                                order_id: chargeback.order_id,
                                sku: chargeback.sku,
                                asin: chargeback.asin,
                                product_name: chargeback.product_name,
                                dispute_type: chargeback.chargeback_type,
                                dispute_amount: chargeback.chargeback_amount,
                                dispute_date: chargeback.chargeback_date,
                                dispute_reason: chargeback.chargeback_reason,
                                defense_available: false,
                                defense_reason: 'Response deadline passed but delivery evidence was available',
                                response_deadline: chargeback.response_deadline,
                                has_tracking: chargeback.has_tracking || (delivery?.tracking_number != null),
                                has_pod: chargeback.has_pod || delivery?.pod_available || false,
                                has_signature: chargeback.has_signature || delivery?.signature_confirmed || false,
                                delivered_date: delivery?.delivered_date,
                                carrier: delivery?.carrier,
                                evidence_summary: `Chargeback for $${chargeback.chargeback_amount.toFixed(2)} on order ${chargeback.order_id} was not defended even though delivery evidence existed. Response deadline was ${chargeback.response_deadline}.`,
                                recommended_action: 'Appeal may still be possible. Contact Amazon Seller Support.',
                                chargeback_event_id: chargeback.id,
                                delivery_record_id: delivery?.id
                            },
                            related_event_ids: [chargeback.id],
                            discovery_date: discoveryDate,
                            deadline_date: recDeadline,
                            days_remaining: recDays,
                            order_id: chargeback.order_id,
                            sku: chargeback.sku,
                            asin: chargeback.asin,
                            product_name: chargeback.product_name,
                            action_required: 'Appeal if possible'
                        });
                    }
                }
                continue;
            }
        }

        // Check for defense evidence
        const delivery = deliveryByOrderId.get(chargeback.order_id);

        const hasTracking = chargeback.has_tracking || (delivery?.tracking_number != null);
        const hasPod = chargeback.has_pod || delivery?.pod_available || false;
        const hasSignature = chargeback.has_signature || delivery?.signature_confirmed || false;
        const wasDelivered = chargeback.delivery_confirmed || delivery?.delivery_confirmed || false;

        // Determine defense viability
        let defenseAvailable = false;
        let defenseReason = '';
        let confidenceScore = 0;

        if (chargeback.chargeback_type === 'inr' ||
            chargeback.chargeback_reason?.toLowerCase().includes('not received')) {
            // INR claim - need delivery proof
            if (wasDelivered && (hasPod || hasSignature)) {
                defenseAvailable = true;
                defenseReason = 'Item Not Received claim but delivery is confirmed with proof';
                confidenceScore = hasSignature ? 0.95 : 0.85;
            } else if (wasDelivered && hasTracking) {
                defenseAvailable = true;
                defenseReason = 'Item Not Received claim but tracking shows delivered';
                confidenceScore = 0.75;
            }
        } else if (chargeback.chargeback_type === 'atoz') {
            // A-to-Z claim
            if (wasDelivered && hasTracking) {
                defenseAvailable = true;
                defenseReason = 'A-to-Z claim can be defended with delivery confirmation';
                confidenceScore = hasPod ? 0.85 : 0.70;
            }
        } else if (chargeback.chargeback_type === 'credit_card') {
            // Credit card chargeback
            if (wasDelivered && (hasPod || hasSignature)) {
                defenseAvailable = true;
                defenseReason = 'Credit card chargeback with delivery proof available';
                confidenceScore = hasSignature ? 0.90 : 0.80;
            }
        }

        if (!defenseAvailable) {
            continue; // Can't defend this one
        }

        // Calculate days to respond
        let daysToRespond: number | undefined;
        if (chargeback.response_deadline) {
            const responseDeadline = new Date(chargeback.response_deadline);
            daysToRespond = daysBetween(now, responseDeadline);
        }

        // Determine recommended action
        let recommendedAction = 'Submit defense with delivery proof';
        if (hasSignature) {
            recommendedAction = 'Submit defense with signature confirmation - high win probability';
        } else if (hasPod) {
            recommendedAction = 'Submit defense with proof of delivery document';
        } else if (hasTracking) {
            recommendedAction = 'Submit defense with tracking confirmation - include screenshots';
        }

        if (daysToRespond && daysToRespond <= 3) {
            recommendedAction = `URGENT: ${recommendedAction}. Only ${daysToRespond} days left to respond!`;
        }

        const evidence: DisputeEvidence = {
            order_id: chargeback.order_id,
            sku: chargeback.sku,
            asin: chargeback.asin,
            product_name: chargeback.product_name,
            dispute_type: chargeback.chargeback_type,
            dispute_amount: chargeback.chargeback_amount,
            dispute_date: chargeback.chargeback_date,
            dispute_reason: chargeback.chargeback_reason,
            defense_available: defenseAvailable,
            defense_reason: defenseReason,
            response_deadline: chargeback.response_deadline,
            days_to_respond: daysToRespond,
            has_tracking: hasTracking,
            has_pod: hasPod,
            has_signature: hasSignature,
            delivered_date: delivery?.delivered_date || chargeback.delivered_date,
            carrier: delivery?.carrier,
            evidence_summary: `${chargeback.chargeback_type.toUpperCase()} for $${chargeback.chargeback_amount.toFixed(2)} on order ${chargeback.order_id}. ${defenseReason}.`,
            recommended_action: recommendedAction,
            chargeback_event_id: chargeback.id,
            delivery_record_id: delivery?.id
        };

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: chargeback.chargeback_type === 'atoz' ? 'atoz_claim' :
                chargeback.chargeback_type === 'safet' ? 'safet_claim' :
                    chargeback.chargeback_type === 'inr' ? 'inr_claim' : 'chargeback',
            severity: daysToRespond && daysToRespond <= 3 ? 'critical' : calculateSeverity(chargeback.chargeback_amount),
            estimated_value: chargeback.chargeback_amount,
            currency: chargeback.currency || 'USD',
            confidence_score: confidenceScore,
            evidence,
            related_event_ids: [chargeback.id],
            discovery_date: discoveryDate,
            deadline_date: new Date(chargeback.response_deadline || deadline),
            days_remaining: daysToRespond || daysRemaining,
            order_id: chargeback.order_id,
            sku: chargeback.sku,
            asin: chargeback.asin,
            product_name: chargeback.product_name,
            action_required: recommendedAction
        });

        logger.info('🛡️ [DISPUTE DEFENDER] Defensible chargeback detected!', {
            orderId: chargeback.order_id,
            type: chargeback.chargeback_type,
            amount: chargeback.chargeback_amount,
            daysToRespond,
            confidence: confidenceScore
        });
    }

    logger.info('🛡️ [DISPUTE DEFENDER] Detection complete', {
        sellerId,
        detectionsFound: results.length,
        totalRecovery: results.reduce((sum, r) => sum + r.estimated_value, 0)
    });

    return results;
}

/**
 * Detect A-to-Z Claims with Defense Opportunity
 * 
 * Specialized detection for Amazon A-to-Z Guarantee claims
 */
export function detectAtoZClaims(
    sellerId: string,
    syncId: string,
    data: DisputeSyncedData
): DisputeDetectionResult[] {
    // Filter to A-to-Z claims specifically
    const atozData: DisputeSyncedData = {
        seller_id: sellerId,
        sync_id: syncId,
        chargeback_events: (data.chargeback_events || []).filter(
            e => e.chargeback_type === 'atoz'
        ),
        delivery_records: data.delivery_records
    };

    return detectDefensibleChargebacks(sellerId, syncId, atozData);
}

// ============================================================================
// Database Integration
// ============================================================================

/**
 * Fetch chargeback events from database
 */
export async function fetchChargebackEvents(
    sellerId: string,
    options?: { startDate?: string; status?: string; limit?: number }
): Promise<ChargebackEvent[]> {
    try {
        let query = supabaseAdmin
            .from('chargeback_events')
            .select('*')
            .eq('seller_id', sellerId)
            .order('chargeback_date', { ascending: false });

        if (options?.startDate) {
            query = query.gte('chargeback_date', options.startDate);
        }

        if (options?.status) {
            query = query.eq('status', options.status);
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('🛡️ [DISPUTE DEFENDER] Error fetching chargeback events', {
                sellerId,
                error: error.message
            });
            return [];
        }

        return data || [];
    } catch (err: any) {
        logger.error('🛡️ [DISPUTE DEFENDER] Exception fetching chargeback events', {
            sellerId,
            error: err.message
        });
        return [];
    }
}

/**
 * Fetch delivery records from database
 */
export async function fetchDeliveryRecords(
    sellerId: string,
    options?: { startDate?: string; limit?: number }
): Promise<DeliveryRecord[]> {
    try {
        let query = supabaseAdmin
            .from('delivery_records')
            .select('*')
            .eq('seller_id', sellerId)
            .order('shipped_date', { ascending: false });

        if (options?.startDate) {
            query = query.gte('shipped_date', options.startDate);
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('🛡️ [DISPUTE DEFENDER] Error fetching delivery records', {
                sellerId,
                error: error.message
            });
            return [];
        }

        return data || [];
    } catch (err: any) {
        logger.error('🛡️ [DISPUTE DEFENDER] Exception fetching delivery records', {
            sellerId,
            error: err.message
        });
        return [];
    }
}

/**
 * Run full chargeback detection for a seller
 */
export async function runChargebackDetection(
    sellerId: string,
    syncId: string
): Promise<DisputeDetectionResult[]> {
    logger.info('🛡️ [DISPUTE DEFENDER] Starting full chargeback detection', { sellerId, syncId });

    const lookbackDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [chargebackEvents, deliveryRecords] = await Promise.all([
        fetchChargebackEvents(sellerId, { startDate: lookbackDate }),
        fetchDeliveryRecords(sellerId, { startDate: lookbackDate })
    ]);

    const syncedData: DisputeSyncedData = {
        seller_id: sellerId,
        sync_id: syncId,
        chargeback_events: chargebackEvents,
        delivery_records: deliveryRecords
    };

    return detectDefensibleChargebacks(sellerId, syncId, syncedData);
}

/**
 * Store dispute detection results
 */
export async function storeDisputeDetectionResults(results: DisputeDetectionResult[]): Promise<void> {
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
            action_required: r.action_required,
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
            logger.error('🛡️ [DISPUTE DEFENDER] Error storing dispute results', {
                error: error.message,
                count: results.length
            });
        } else {
            logger.info('🛡️ [DISPUTE DEFENDER] Dispute results stored', {
                count: results.length
            });
        }
    } catch (err: any) {
        logger.error('🛡️ [DISPUTE DEFENDER] Exception storing results', {
            error: err.message
        });
    }
}

// ============================================================================
// Exports
// ============================================================================

export default {
    detectDefensibleChargebacks,
    detectAtoZClaims,
    fetchChargebackEvents,
    fetchDeliveryRecords,
    runChargebackDetection,
    storeDisputeDetectionResults
};
