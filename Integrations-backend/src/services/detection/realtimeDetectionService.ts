/**
 * Real-time Detection Service
 * 
 * Phase 4: Real-time Streaming
 * 
 * Subscribes to Supabase Realtime on key tables and triggers
 * instant detection when relevant events occur.
 * 
 * Flow: Event arrives → Mini-detection runs → Alert if urgent
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';
import { RealtimeChannel } from '@supabase/supabase-js';

// Import detection algorithms for mini-detection runs
import { detectLostInventory } from './algorithms/inventoryAlgorithms';
import { detectRefundWithoutReturn } from './algorithms/refundAlgorithms';
import { detectDamagedInventory } from './algorithms/damagedAlgorithms';
import { calculateCalibratedConfidence } from './confidenceCalibrator';

// ============================================================================
// Types
// ============================================================================

export interface RealtimeDetectionEvent {
    table: string;
    event_type: 'INSERT' | 'UPDATE' | 'DELETE';
    row: any;
    timestamp: Date;
}

export interface RealtimeAlert {
    id: string;
    seller_id: string;
    anomaly_type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    message: string;
    detected_at: Date;
    source_event: RealtimeDetectionEvent;
    delivered: boolean;
}

export interface RealtimeSubscription {
    table: string;
    channel: RealtimeChannel;
    handler: (event: RealtimeDetectionEvent) => Promise<void>;
    active: boolean;
}

// ============================================================================
// State
// ============================================================================

let subscriptions: Map<string, RealtimeSubscription> = new Map();
let alertQueue: RealtimeAlert[] = [];
let isRunning = false;
let alertCallback: ((alert: RealtimeAlert) => void) | null = null;

// ============================================================================
// Core Real-time Detection
// ============================================================================

/**
 * Start real-time detection for a seller
 * Subscribes to relevant tables and triggers instant detection
 */
export async function startRealtimeDetection(
    sellerId: string,
    onAlert?: (alert: RealtimeAlert) => void
): Promise<boolean> {
    if (isRunning) {
        logger.warn('⚡ [REALTIME] Already running', { sellerId });
        return false;
    }

    logger.info('⚡ [REALTIME] Starting real-time detection', { sellerId });
    alertCallback = onAlert || null;

    try {
        // Subscribe to key tables
        await subscribeToTable('inventory_ledger', sellerId, handleInventoryEvent);
        await subscribeToTable('refund_events', sellerId, handleRefundEvent);
        await subscribeToTable('reimbursement_events', sellerId, handleReimbursementEvent);
        await subscribeToTable('return_events', sellerId, handleReturnEvent);
        await subscribeToTable('inbound_shipment_items', sellerId, handleShipmentEvent);

        isRunning = true;
        logger.info('⚡ [REALTIME] All subscriptions active', {
            sellerId,
            tableCount: subscriptions.size
        });

        return true;
    } catch (err: any) {
        logger.error('⚡ [REALTIME] Failed to start', { error: err.message });
        await stopRealtimeDetection();
        return false;
    }
}

/**
 * Stop all real-time detection
 */
export async function stopRealtimeDetection(): Promise<void> {
    logger.info('⚡ [REALTIME] Stopping real-time detection');

    for (const [table, sub] of subscriptions) {
        try {
            await supabaseAdmin.removeChannel(sub.channel);
            logger.info('⚡ [REALTIME] Unsubscribed from', { table });
        } catch (err) {
            logger.warn('⚡ [REALTIME] Error unsubscribing', { table });
        }
    }

    subscriptions.clear();
    isRunning = false;
    alertCallback = null;
}

/**
 * Subscribe to a specific table for a seller
 */
async function subscribeToTable(
    table: string,
    sellerId: string,
    handler: (event: RealtimeDetectionEvent) => Promise<void>
): Promise<void> {
    const channelName = `realtime-${table}-${sellerId}`;

    const channel = supabaseAdmin
        .channel(channelName)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: table,
                filter: `seller_id=eq.${sellerId}`
            },
            async (payload) => {
                const event: RealtimeDetectionEvent = {
                    table,
                    event_type: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
                    row: payload.new || payload.old,
                    timestamp: new Date()
                };

                logger.info('⚡ [REALTIME] Event received', {
                    table,
                    eventType: event.event_type,
                    rowId: event.row?.id
                });

                try {
                    await handler(event);
                } catch (err: any) {
                    logger.error('⚡ [REALTIME] Handler error', {
                        table,
                        error: err.message
                    });
                }
            }
        )
        .subscribe((status) => {
            logger.info('⚡ [REALTIME] Subscription status', { table, status });
        });

    subscriptions.set(table, {
        table,
        channel,
        handler,
        active: true
    });
}

// ============================================================================
// Event Handlers - Mini Detection Logic
// ============================================================================

/**
 * Handle inventory ledger changes
 * Look for damage/loss events that need immediate attention
 */
async function handleInventoryEvent(event: RealtimeDetectionEvent): Promise<void> {
    if (event.event_type !== 'INSERT') return;

    const row = event.row;
    const eventType = row.event_type?.toLowerCase();
    const reasonCode = row.reason_code?.toUpperCase();

    // Check for damage codes that Amazon is at fault for
    const amazonFaultCodes = ['E', 'M', 'Q', 'K', 'H'];
    const isDamaged = eventType === 'adjustment' &&
        (row.disposition === 'DAMAGED' || row.disposition === 'UNSELLABLE') &&
        amazonFaultCodes.includes(reasonCode);

    // Check for suspicious adjustments
    const isLoss = eventType === 'adjustment' &&
        row.quantity < 0 &&
        Math.abs(row.quantity) >= 5;

    if (isDamaged || isLoss) {
        const value = Math.abs(row.quantity || 1) * 20; // Estimate $20/unit

        await createAlert({
            seller_id: row.seller_id,
            anomaly_type: isDamaged ? 'damaged_warehouse' : 'lost_warehouse',
            severity: value >= 200 ? 'high' : 'medium',
            estimated_value: value,
            message: isDamaged
                ? `🚨 Amazon damaged ${Math.abs(row.quantity)} units of ${row.sku || 'unknown SKU'}. Reason: ${reasonCode}`
                : `🚨 ${Math.abs(row.quantity)} units of ${row.sku || 'unknown SKU'} marked as lost/adjusted`,
            source_event: event
        });
    }
}

/**
 * Handle refund events
 * Alert on high-value refunds that may need tracking
 */
async function handleRefundEvent(event: RealtimeDetectionEvent): Promise<void> {
    if (event.event_type !== 'INSERT') return;

    const row = event.row;
    const amount = row.refund_amount || 0;

    // Alert on high-value refunds (> $100)
    if (amount >= 100) {
        await createAlert({
            seller_id: row.seller_id,
            anomaly_type: 'refund_no_return',
            severity: amount >= 500 ? 'high' : 'medium',
            estimated_value: amount,
            message: `💰 High-value refund: $${amount.toFixed(2)} for order ${row.order_id}. Track return status.`,
            source_event: event
        });
    }
}

/**
 * Handle reimbursement events
 * Good news - track these to close out claims
 */
async function handleReimbursementEvent(event: RealtimeDetectionEvent): Promise<void> {
    if (event.event_type !== 'INSERT') return;

    const row = event.row;
    const amount = row.reimbursement_amount || 0;

    if (amount >= 50) {
        logger.info('⚡ [REALTIME] Reimbursement received!', {
            seller_id: row.seller_id,
            amount,
            reason: row.reason
        });

        // Could update related detection_results to 'resolved' status here
    }
}

/**
 * Handle return events
 * Alert on suspicious returns (wrong item, switcheroo)
 */
async function handleReturnEvent(event: RealtimeDetectionEvent): Promise<void> {
    if (event.event_type !== 'INSERT') return;

    const row = event.row;
    const disposition = row.detailed_disposition?.toUpperCase();

    const suspiciousDispositions = ['SWITCHEROO', 'WRONG_ITEM', 'OTHER'];
    if (suspiciousDispositions.includes(disposition)) {
        const value = row.refund_amount || 30;

        await createAlert({
            seller_id: row.seller_id,
            anomaly_type: disposition === 'SWITCHEROO' ? 'switcheroo' : 'wrong_item_returned',
            severity: 'high',
            estimated_value: value,
            message: `🕵️ Suspicious return detected: ${disposition} for order ${row.order_id}`,
            source_event: event
        });
    }
}

/**
 * Handle shipment events
 * Alert on shipment status changes that indicate problems
 */
async function handleShipmentEvent(event: RealtimeDetectionEvent): Promise<void> {
    if (event.event_type !== 'UPDATE') return;

    const row = event.row;
    const status = row.shipment_status?.toUpperCase();

    // Alert if shipment marked as ERROR or CANCELLED with items
    if ((status === 'ERROR' || status === 'CANCELLED') && row.quantity_shipped > 0) {
        const value = row.quantity_shipped * 18;

        await createAlert({
            seller_id: row.seller_id,
            anomaly_type: 'shipment_shortage',
            severity: 'high',
            estimated_value: value,
            message: `📦 Shipment ${row.shipment_id} marked ${status} with ${row.quantity_shipped} units shipped!`,
            source_event: event
        });
    }
}

// ============================================================================
// Alert Management
// ============================================================================

/**
 * Create and dispatch an alert
 */
async function createAlert(params: {
    seller_id: string;
    anomaly_type: string;
    severity: RealtimeAlert['severity'];
    estimated_value: number;
    message: string;
    source_event: RealtimeDetectionEvent;
}): Promise<void> {
    // Apply ML calibration to determine final severity
    const calibration = await calculateCalibratedConfidence(
        params.anomaly_type,
        params.severity === 'critical' ? 0.95 : params.severity === 'high' ? 0.85 : 0.75
    );

    const alert: RealtimeAlert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        seller_id: params.seller_id,
        anomaly_type: params.anomaly_type,
        severity: params.severity,
        estimated_value: params.estimated_value,
        message: params.message,
        detected_at: new Date(),
        source_event: params.source_event,
        delivered: false
    };

    // Add to queue
    alertQueue.push(alert);

    // Store in database for persistence
    try {
        await supabaseAdmin.from('realtime_alerts').insert({
            id: alert.id,
            seller_id: alert.seller_id,
            anomaly_type: alert.anomaly_type,
            severity: alert.severity,
            estimated_value: alert.estimated_value,
            message: alert.message,
            detected_at: alert.detected_at.toISOString(),
            source_table: alert.source_event.table,
            source_event_type: alert.source_event.event_type,
            delivered: false
        });
    } catch (err: any) {
        // Table may not exist yet, log and continue
        logger.warn('⚡ [REALTIME] Could not store alert', { error: err.message });
    }

    // Dispatch to callback if registered
    if (alertCallback) {
        try {
            alertCallback(alert);
            alert.delivered = true;
        } catch (err: any) {
            logger.error('⚡ [REALTIME] Alert callback failed', { error: err.message });
        }
    }

    logger.info('⚡ [REALTIME] ALERT CREATED', {
        id: alert.id,
        anomalyType: alert.anomaly_type,
        severity: alert.severity,
        value: alert.estimated_value,
        message: alert.message
    });
}

/**
 * Get pending alerts for a seller
 */
export function getPendingAlerts(sellerId?: string): RealtimeAlert[] {
    if (sellerId) {
        return alertQueue.filter(a => a.seller_id === sellerId && !a.delivered);
    }
    return alertQueue.filter(a => !a.delivered);
}

/**
 * Mark alert as delivered
 */
export function markAlertDelivered(alertId: string): void {
    const alert = alertQueue.find(a => a.id === alertId);
    if (alert) {
        alert.delivered = true;
    }
}

/**
 * Clear all alerts
 */
export function clearAlerts(): void {
    alertQueue = [];
}

// ============================================================================
// Status & Monitoring
// ============================================================================

/**
 * Get real-time detection status
 */
export function getRealtimeStatus(): {
    isRunning: boolean;
    subscriptions: string[];
    pendingAlerts: number;
    totalAlertsGenerated: number;
} {
    return {
        isRunning,
        subscriptions: Array.from(subscriptions.keys()),
        pendingAlerts: alertQueue.filter(a => !a.delivered).length,
        totalAlertsGenerated: alertQueue.length
    };
}

// ============================================================================
// Exports
// ============================================================================

export default {
    startRealtimeDetection,
    stopRealtimeDetection,
    getPendingAlerts,
    markAlertDelivered,
    clearAlerts,
    getRealtimeStatus
};
