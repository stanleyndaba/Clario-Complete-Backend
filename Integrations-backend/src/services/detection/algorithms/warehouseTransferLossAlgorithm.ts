/**
 * Warehouse Transfer Loss Detection Algorithm
 * 
 * Agent 3: Discovery Agent - FC Transfer Integrity
 * 
 * Problem: Inventory transferred between Amazon FCs can disappear:
 * - Units sent but not received
 * - Partial deliveries
 * - Long-pending transfers
 * - Lost in transit between warehouses
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface TransferRecord {
    id: string;
    seller_id: string;
    transfer_id: string;
    sku: string;
    asin?: string;
    fnsku?: string;

    // Transfer details
    source_fc: string;
    destination_fc: string;
    transfer_date: string;
    expected_arrival_date?: string;
    actual_arrival_date?: string;

    // Quantities
    quantity_sent: number;
    quantity_received: number;
    quantity_missing: number;

    // Status
    transfer_status: 'pending' | 'in_transit' | 'received' | 'partial' | 'lost';
    days_in_transit: number;

    // Value
    unit_value: number;
    currency: string;
}

export interface TransferLossResult {
    seller_id: string;
    sync_id: string;

    transfer_id: string;
    sku: string;
    asin?: string;

    // Loss details
    loss_type: 'partial_loss' | 'total_loss' | 'excessive_delay' | 'pending_too_long';
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Quantities
    quantity_sent: number;
    quantity_received: number;
    quantity_lost: number;
    loss_percent: number;

    // Financial
    loss_value: number;
    currency: string;

    // Transfer info
    source_fc: string;
    destination_fc: string;
    days_in_transit: number;

    // Confidence
    confidence_score: number;

    // Action
    recommended_action: 'monitor' | 'investigate' | 'file_claim';

    evidence: {
        transfer_record: TransferRecord;
        detection_reasons: string[];
    };
}

// ============================================================================
// Constants
// ============================================================================

const MAX_TRANSIT_DAYS = 14; // Flag if > 14 days
const THRESHOLD_SHOW = 0.60;
const MIN_LOSS_VALUE = 10;

// ============================================================================
// Core Detection
// ============================================================================

export async function detectWarehouseTransferLoss(
    sellerId: string,
    syncId: string,
    transfers: TransferRecord[]
): Promise<TransferLossResult[]> {
    const results: TransferLossResult[] = [];

    logger.info('🏭 [TRANSFER-LOSS] Starting warehouse transfer loss detection', {
        sellerId, syncId, transferCount: transfers.length
    });

    for (const transfer of transfers) {
        const lossValue = transfer.quantity_missing * transfer.unit_value;

        // Check for actual loss
        if (transfer.quantity_missing > 0 && lossValue >= MIN_LOSS_VALUE) {
            const isTotal = transfer.quantity_received === 0;

            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                transfer_id: transfer.transfer_id,
                sku: transfer.sku,
                asin: transfer.asin,
                loss_type: isTotal ? 'total_loss' : 'partial_loss',
                severity: lossValue >= 100 ? 'critical' : lossValue >= 50 ? 'high' : 'medium',
                quantity_sent: transfer.quantity_sent,
                quantity_received: transfer.quantity_received,
                quantity_lost: transfer.quantity_missing,
                loss_percent: (transfer.quantity_missing / transfer.quantity_sent) * 100,
                loss_value: lossValue,
                currency: transfer.currency,
                source_fc: transfer.source_fc,
                destination_fc: transfer.destination_fc,
                days_in_transit: transfer.days_in_transit,
                confidence_score: 0.80,
                recommended_action: lossValue >= 50 ? 'file_claim' : 'investigate',
                evidence: {
                    transfer_record: transfer,
                    detection_reasons: [
                        `${transfer.quantity_missing} units missing from transfer`,
                        `Sent: ${transfer.quantity_sent}, Received: ${transfer.quantity_received}`,
                        `Route: ${transfer.source_fc} → ${transfer.destination_fc}`
                    ]
                }
            });
        }

        // Check for excessive delay
        if (transfer.days_in_transit > MAX_TRANSIT_DAYS &&
            transfer.transfer_status === 'in_transit') {
            const potentialLoss = transfer.quantity_sent * transfer.unit_value;

            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                transfer_id: transfer.transfer_id,
                sku: transfer.sku,
                asin: transfer.asin,
                loss_type: 'excessive_delay',
                severity: transfer.days_in_transit > 30 ? 'high' : 'medium',
                quantity_sent: transfer.quantity_sent,
                quantity_received: 0,
                quantity_lost: transfer.quantity_sent, // Potentially all lost
                loss_percent: 100,
                loss_value: potentialLoss,
                currency: transfer.currency,
                source_fc: transfer.source_fc,
                destination_fc: transfer.destination_fc,
                days_in_transit: transfer.days_in_transit,
                confidence_score: 0.65,
                recommended_action: 'investigate',
                evidence: {
                    transfer_record: transfer,
                    detection_reasons: [
                        `Transfer pending for ${transfer.days_in_transit} days (max: ${MAX_TRANSIT_DAYS})`,
                        `Potential at-risk value: $${potentialLoss.toFixed(2)}`
                    ]
                }
            });
        }
    }

    results.sort((a, b) => b.loss_value - a.loss_value);

    logger.info('🏭 [TRANSFER-LOSS] Detection complete', {
        sellerId, lossesFound: results.length,
        totalLoss: results.reduce((sum, r) => sum + r.loss_value, 0).toFixed(2)
    });

    return results;
}

// ============================================================================
// Database Functions
// ============================================================================

export async function fetchTransferRecords(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<TransferRecord[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const transfers: TransferRecord[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('inventory_transfers')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('transfer_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                const sent = row.quantity_sent || 0;
                const received = row.quantity_received || 0;
                const transferDate = new Date(row.transfer_date);
                const daysInTransit = Math.floor((Date.now() - transferDate.getTime()) / (1000 * 60 * 60 * 24));

                transfers.push({
                    id: row.id,
                    seller_id: sellerId,
                    transfer_id: row.transfer_id,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    source_fc: row.source_fc || 'Unknown',
                    destination_fc: row.destination_fc || 'Unknown',
                    transfer_date: row.transfer_date,
                    expected_arrival_date: row.expected_arrival_date,
                    actual_arrival_date: row.actual_arrival_date,
                    quantity_sent: sent,
                    quantity_received: received,
                    quantity_missing: Math.max(0, sent - received),
                    transfer_status: row.status || 'pending',
                    days_in_transit: daysInTransit,
                    unit_value: parseFloat(row.unit_value) || 15,
                    currency: row.currency || 'USD'
                });
            }
        }

        logger.info('🏭 [TRANSFER-LOSS] Fetched transfers', { sellerId, count: transfers.length });
    } catch (err: any) {
        logger.error('🏭 [TRANSFER-LOSS] Error fetching transfers', { error: err.message });
    }

    return transfers;
}

export async function storeTransferLossResults(results: TransferLossResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'warehouse_transfer_loss',
            severity: r.severity,
            estimated_value: r.loss_value,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                transfer_id: r.transfer_id,
                sku: r.sku,
                loss_type: r.loss_type,
                quantity_sent: r.quantity_sent,
                quantity_received: r.quantity_received,
                quantity_lost: r.quantity_lost,
                source_fc: r.source_fc,
                destination_fc: r.destination_fc,
                days_in_transit: r.days_in_transit,
                detection_reasons: r.evidence.detection_reasons
            },
            status: 'pending'
        }));

        await supabaseAdmin.from('detection_results').insert(records);
        logger.info('🏭 [TRANSFER-LOSS] Stored results', { count: records.length });
    } catch (err: any) {
        logger.error('🏭 [TRANSFER-LOSS] Error storing results', { error: err.message });
    }
}

export { MAX_TRANSIT_DAYS, THRESHOLD_SHOW, MIN_LOSS_VALUE };
