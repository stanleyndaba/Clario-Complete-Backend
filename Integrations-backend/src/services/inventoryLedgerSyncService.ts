/**
 * Inventory Ledger Sync Service
 * 
 * Syncs historical inventory events from Amazon SP-API to the inventory_ledger table.
 * Uses GET_LEDGER_DETAIL_VIEW_DATA report for event-level inventory data.
 * 
 * This is CRITICAL for inventory detection algorithms:
 * - detectLostInventory (needs event history)
 * - detectDamagedInventory (needs disposition/reason)
 * - Reconciliation between inbound shipments and received quantities
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';

export interface InventoryLedgerEvent {
    seller_id: string;
    event_date: string;
    fnsku: string;
    asin: string;
    sku: string;
    title?: string;
    event_type: string;         // Receipts, Shipments, CustomerReturns, Adjustments, etc.
    reference_id?: string;
    quantity: number;
    fulfillment_center?: string;
    disposition?: string;        // SELLABLE, DEFECTIVE, CUSTOMER_DAMAGED, etc.
    reason_code?: string;        // Damage reason, adjustment reason
    country?: string;
}

class InventoryLedgerSyncService {

    /**
     * Sync inventory ledger from Amazon SP-API
     * Uses GET_LEDGER_DETAIL_VIEW_DATA report
     */
    async syncInventoryLedger(
        userId: string,
        startDate?: Date,
        endDate?: Date,
        storeId?: string
    ): Promise<{ success: boolean; count: number; message: string }> {
        try {
            logger.info('📋 [INVENTORY LEDGER] Starting sync', { userId, storeId });

            // Check if using mock SP-API
            if (process.env.USE_MOCK_SPAPI === 'true') {
                logger.info('📋 [INVENTORY LEDGER] Using mock data', { userId });
                return this.syncMockLedger(userId);
            }

            const { spApiReportService } = await import('./spApiReportService');

            const reportStart = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Default 90 days
            const reportEnd = endDate || new Date();

            const records = await spApiReportService.requestAndDownloadReport(
                userId,
                'GET_LEDGER_DETAIL_VIEW_DATA',
                reportStart,
                reportEnd,
                storeId
            );

            if (records.length === 0) {
                logger.warn('📋 [INVENTORY LEDGER] Report returned 0 records', { userId });
                return { success: true, count: 0, message: 'No inventory ledger data in report' };
            }

            // Convert report records
            const ledgerEvents = this.convertReportRecords(records, userId);

            // Save to database
            await this.saveLedgerToDatabase(userId, ledgerEvents);

            logger.info(`📋 [INVENTORY LEDGER] Synced ${ledgerEvents.length} ledger events`, { userId });

            return {
                success: true,
                count: ledgerEvents.length,
                message: `Synced ${ledgerEvents.length} inventory ledger events from SP-API`
            };
        } catch (error: any) {
            logger.error('📋 [INVENTORY LEDGER] Failed', { userId, error: error.message });

            await logAuditEvent({
                event_type: 'inventory_ledger_sync_failed',
                user_id: userId,
                metadata: { error: error.message },
                severity: 'high'
            });

            return {
                success: false,
                count: 0,
                message: `Inventory ledger sync failed: ${error.message}`
            };
        }
    }

    /**
     * Convert TSV report records to InventoryLedgerEvent format
     * 
     * GET_LEDGER_DETAIL_VIEW_DATA columns:
     * Date, FNSKU, ASIN, MSKU, Title, Event Type, Reference ID,
     * Quantity, Fulfillment Center, Disposition, Reason, Country
     */
    private convertReportRecords(records: Record<string, string>[], userId: string): InventoryLedgerEvent[] {
        return records
            .filter(r => (r['FNSKU'] || r['fnsku']) && (r['Event Type'] || r['event_type'] || r['event-type']))
            .map(record => ({
                seller_id: userId,
                event_date: record['Date'] || record['date'] || new Date().toISOString(),
                fnsku: record['FNSKU'] || record['fnsku'] || '',
                asin: record['ASIN'] || record['asin'] || '',
                sku: record['MSKU'] || record['msku'] || record['sku'] || '',
                title: record['Title'] || record['title'] || undefined,
                event_type: record['Event Type'] || record['event_type'] || record['event-type'] || 'Unknown',
                reference_id: record['Reference ID'] || record['reference_id'] || record['reference-id'] || undefined,
                quantity: parseInt(record['Quantity'] || record['quantity'] || '0', 10),
                fulfillment_center: record['Fulfillment Center'] || record['fulfillment_center'] || record['fulfillment-center'] || undefined,
                disposition: record['Disposition'] || record['disposition'] || undefined,
                reason_code: record['Reason'] || record['reason'] || record['reason_code'] || undefined,
                country: record['Country'] || record['country'] || undefined
            }));
    }

    /**
     * Generate mock ledger data for demo mode
     */
    private async syncMockLedger(userId: string): Promise<{ success: boolean; count: number; message: string }> {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;

        const mockEvents: InventoryLedgerEvent[] = [
            { seller_id: userId, event_date: new Date(now - 30 * day).toISOString(), fnsku: 'FN-DEMO-001', asin: 'B0DEMO001', sku: 'DEMO-SKU-001', event_type: 'Receipts', quantity: 100, fulfillment_center: 'PHX7', disposition: 'SELLABLE', reference_id: 'FBA-SHIP-001' },
            { seller_id: userId, event_date: new Date(now - 25 * day).toISOString(), fnsku: 'FN-DEMO-001', asin: 'B0DEMO001', sku: 'DEMO-SKU-001', event_type: 'Shipments', quantity: -15, fulfillment_center: 'PHX7', disposition: 'SELLABLE', reference_id: 'ORD-001' },
            { seller_id: userId, event_date: new Date(now - 20 * day).toISOString(), fnsku: 'FN-DEMO-001', asin: 'B0DEMO001', sku: 'DEMO-SKU-001', event_type: 'Adjustments', quantity: -3, fulfillment_center: 'PHX7', disposition: 'DEFECTIVE', reason_code: 'Damaged by Amazon', reference_id: 'ADJ-001' },
            { seller_id: userId, event_date: new Date(now - 15 * day).toISOString(), fnsku: 'FN-DEMO-002', asin: 'B0DEMO002', sku: 'DEMO-SKU-002', event_type: 'Receipts', quantity: 50, fulfillment_center: 'BFI4', disposition: 'SELLABLE', reference_id: 'FBA-SHIP-002' },
            { seller_id: userId, event_date: new Date(now - 10 * day).toISOString(), fnsku: 'FN-DEMO-002', asin: 'B0DEMO002', sku: 'DEMO-SKU-002', event_type: 'CustomerReturns', quantity: 2, fulfillment_center: 'BFI4', disposition: 'CUSTOMER_DAMAGED', reason_code: 'Item defective', reference_id: 'RET-001' },
            { seller_id: userId, event_date: new Date(now - 5 * day).toISOString(), fnsku: 'FN-DEMO-003', asin: 'B0DEMO003', sku: 'DEMO-SKU-003', event_type: 'Adjustments', quantity: -1, fulfillment_center: 'PHX7', disposition: 'SELLABLE', reason_code: 'Lost in warehouse', reference_id: 'ADJ-002' },
        ];

        await this.saveLedgerToDatabase(userId, mockEvents);
        return { success: true, count: mockEvents.length, message: `Synced ${mockEvents.length} mock inventory ledger events` };
    }

    /**
     * Save ledger events to database with upsert
     */
    private async saveLedgerToDatabase(userId: string, events: InventoryLedgerEvent[]): Promise<void> {
        if (events.length === 0) return;

        if (typeof supabase.from !== 'function') {
            logger.warn('Demo mode: Inventory ledger save skipped', { userId });
            return;
        }

        const toInsert = events.map(event => ({
            seller_id: event.seller_id,
            event_date: event.event_date,
            fnsku: event.fnsku,
            asin: event.asin,
            sku: event.sku,
            title: event.title || null,
            event_type: event.event_type,
            reference_id: event.reference_id || null,
            quantity: event.quantity,
            fulfillment_center: event.fulfillment_center || null,
            disposition: event.disposition || null,
            reason_code: event.reason_code || null,
            country: event.country || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));

        // Upsert on composite key to avoid duplicates
        const { error } = await supabase
            .from('inventory_ledger')
            .upsert(toInsert, {
                onConflict: 'seller_id,event_date,fnsku,event_type,reference_id',
                ignoreDuplicates: false
            });

        if (error) {
            // If upsert fails (e.g., missing unique constraint), fall back to insert with conflict check
            logger.warn('📋 [INVENTORY LEDGER] Upsert failed, trying insert with dedup', { error: error.message });

            // Batch insert, skip conflicts
            const { error: insertError } = await supabase
                .from('inventory_ledger')
                .insert(toInsert);

            if (insertError && !insertError.message.includes('duplicate')) {
                throw new Error(`Inventory ledger save failed: ${insertError.message}`);
            }
        }

        logger.info('📋 [INVENTORY LEDGER] Saved to database', { userId, count: toInsert.length });

        await logAuditEvent({
            event_type: 'inventory_ledger_synced',
            user_id: userId,
            metadata: { count: toInsert.length },
            severity: 'low'
        });
    }
}

export const inventoryLedgerSyncService = new InventoryLedgerSyncService();
export default inventoryLedgerSyncService;
