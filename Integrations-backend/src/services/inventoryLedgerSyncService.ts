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

import crypto from 'crypto';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';

export interface InventoryLedgerEvent {
    seller_id: string;
    user_id?: string;
    tenant_id?: string;
    store_id?: string;
    sync_id?: string;
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
    marketplace_id?: string;
    provider_event_type_raw?: string;
    raw_quantity?: number;
    event_datetime?: string;
    provider_store?: string;
    reconciled_quantity?: number | null;
    unreconciled_quantity?: number | null;
    provider_row_fingerprint?: string;
    raw_payload?: Record<string, any>;
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
        storeId?: string,
        tenantId?: string,
        syncId?: string,
        marketplaceId?: string
    ): Promise<{ success: boolean; count: number; message: string }> {
        try {
            logger.info('📋 [INVENTORY LEDGER] Starting sync', { userId, storeId });

            // Check if using mock SP-API
            if (process.env.USE_MOCK_SPAPI === 'true') {
                logger.info('📋 [INVENTORY LEDGER] Using mock data', { userId });
                return this.syncMockLedger(userId, tenantId, storeId, syncId);
            }

            const { spApiReportService } = await import('./spApiReportService');

            const reportStart = startDate || new Date(Date.now() - 540 * 24 * 60 * 60 * 1000); // 18 months
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
            const ledgerEvents = this.convertReportRecords(records, userId, tenantId, storeId, syncId, marketplaceId);

            // Save to database
            await this.saveLedgerToDatabase(userId, ledgerEvents, tenantId, storeId, syncId);

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
    private convertReportRecords(
        records: Record<string, string>[],
        userId: string,
        tenantId?: string,
        storeId?: string,
        syncId?: string,
        marketplaceId?: string
    ): InventoryLedgerEvent[] {
        return records
            .filter(r =>
                (r['FNSKU'] || r['fnsku']) &&
                (r['Event Type'] || r['event_type'] || r['event-type']) &&
                (r['Date'] || r['date'])
            )
            .map(record => {
                const rawEventType = record['Event Type'] || record['event_type'] || record['event-type'] || 'Unknown';
                const rawDate = record['Date'] || record['date'] || '';
                const rawDateTime = record['Date and Time'] || record['date_and_time'] || record['date-time'] || undefined;
                const rawQuantityText = record['Quantity'] || record['quantity'] || '0';
                const rawQuantity = Number.parseInt(rawQuantityText, 10);
                const quantity = Number.isFinite(rawQuantity) ? rawQuantity : 0;
                const fingerprint = this.buildProviderRowFingerprint({
                    tenantId,
                    userId,
                    storeId,
                    marketplaceId,
                    providerSource: 'amazon_inventory_ledger',
                    rawEventType,
                    rawDate,
                    rawDateTime,
                    fnsku: record['FNSKU'] || record['fnsku'] || '',
                    asin: record['ASIN'] || record['asin'] || '',
                    sku: record['MSKU'] || record['msku'] || record['sku'] || '',
                    referenceId: record['Reference ID'] || record['reference_id'] || record['reference-id'] || '',
                    rawQuantity: rawQuantityText,
                    fulfillmentCenter: record['Fulfillment Center'] || record['fulfillment_center'] || record['fulfillment-center'] || '',
                    country: record['Country'] || record['country'] || '',
                    disposition: record['Disposition'] || record['disposition'] || '',
                    reason: record['Reason'] || record['reason'] || record['reason_code'] || '',
                    reconciledQuantity: record['Reconciled Quantity'] || record['reconciled_quantity'] || '',
                    unreconciledQuantity: record['Unreconciled Quantity'] || record['unreconciled_quantity'] || '',
                    providerStore: record['Store'] || record['store'] || '',
                });

                return {
                    seller_id: userId,
                    user_id: userId,
                    tenant_id: tenantId,
                    store_id: storeId,
                    sync_id: syncId,
                    event_date: rawDate,
                    event_datetime: rawDateTime,
                    fnsku: record['FNSKU'] || record['fnsku'] || '',
                    asin: record['ASIN'] || record['asin'] || '',
                    sku: record['MSKU'] || record['msku'] || record['sku'] || '',
                    title: record['Title'] || record['title'] || undefined,
                    event_type: rawEventType,
                    provider_event_type_raw: rawEventType,
                    reference_id: record['Reference ID'] || record['reference_id'] || record['reference-id'] || undefined,
                    quantity,
                    raw_quantity: quantity,
                    fulfillment_center: record['Fulfillment Center'] || record['fulfillment_center'] || record['fulfillment-center'] || undefined,
                    disposition: record['Disposition'] || record['disposition'] || undefined,
                    reason_code: record['Reason'] || record['reason'] || record['reason_code'] || undefined,
                    country: record['Country'] || record['country'] || undefined,
                    marketplace_id: marketplaceId,
                    provider_store: record['Store'] || record['store'] || undefined,
                    reconciled_quantity: this.parseOptionalInteger(record['Reconciled Quantity'] || record['reconciled_quantity']),
                    unreconciled_quantity: this.parseOptionalInteger(record['Unreconciled Quantity'] || record['unreconciled_quantity']),
                    provider_row_fingerprint: fingerprint,
                    raw_payload: record
                };
            });
    }

    private parseOptionalInteger(value: unknown): number | null {
        if (value === undefined || value === null || String(value).trim() === '') return null;
        const parsed = Number.parseInt(String(value), 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    /**
     * Hash immutable provider facts and explicit scope only. Ingestion timestamps
     * are intentionally excluded so the same source row is idempotent on retry.
     */
    private buildProviderRowFingerprint(input: Record<string, unknown>): string {
        const canonical = Object.fromEntries(
            Object.entries(input).map(([key, value]) => [key, value === undefined || value === null ? '' : String(value).trim()])
        );
        return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    }

    /**
     * Generate mock ledger data for demo mode
     */
    private async syncMockLedger(
        userId: string,
        tenantId?: string,
        storeId?: string,
        syncId?: string
    ): Promise<{ success: boolean; count: number; message: string }> {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;

        const mockEvents: InventoryLedgerEvent[] = [
            { seller_id: userId, user_id: userId, tenant_id: tenantId, store_id: storeId, sync_id: syncId, event_date: new Date(now - 30 * day).toISOString(), fnsku: 'FN-DEMO-001', asin: 'B0DEMO001', sku: 'DEMO-SKU-001', event_type: 'Receipts', quantity: 100, fulfillment_center: 'PHX7', disposition: 'SELLABLE', reference_id: 'FBA-SHIP-001' },
            { seller_id: userId, user_id: userId, tenant_id: tenantId, store_id: storeId, sync_id: syncId, event_date: new Date(now - 25 * day).toISOString(), fnsku: 'FN-DEMO-001', asin: 'B0DEMO001', sku: 'DEMO-SKU-001', event_type: 'Shipments', quantity: -15, fulfillment_center: 'PHX7', disposition: 'SELLABLE', reference_id: 'ORD-001' },
            { seller_id: userId, user_id: userId, tenant_id: tenantId, store_id: storeId, sync_id: syncId, event_date: new Date(now - 20 * day).toISOString(), fnsku: 'FN-DEMO-001', asin: 'B0DEMO001', sku: 'DEMO-SKU-001', event_type: 'Adjustments', quantity: -3, fulfillment_center: 'PHX7', disposition: 'DEFECTIVE', reason_code: 'Damaged by Amazon', reference_id: 'ADJ-001' },
            { seller_id: userId, user_id: userId, tenant_id: tenantId, store_id: storeId, sync_id: syncId, event_date: new Date(now - 15 * day).toISOString(), fnsku: 'FN-DEMO-002', asin: 'B0DEMO002', sku: 'DEMO-SKU-002', event_type: 'Receipts', quantity: 50, fulfillment_center: 'BFI4', disposition: 'SELLABLE', reference_id: 'FBA-SHIP-002' },
            { seller_id: userId, user_id: userId, tenant_id: tenantId, store_id: storeId, sync_id: syncId, event_date: new Date(now - 10 * day).toISOString(), fnsku: 'FN-DEMO-002', asin: 'B0DEMO002', sku: 'DEMO-SKU-002', event_type: 'CustomerReturns', quantity: 2, fulfillment_center: 'BFI4', disposition: 'CUSTOMER_DAMAGED', reason_code: 'Item defective', reference_id: 'RET-001' },
            { seller_id: userId, user_id: userId, tenant_id: tenantId, store_id: storeId, sync_id: syncId, event_date: new Date(now - 5 * day).toISOString(), fnsku: 'FN-DEMO-003', asin: 'B0DEMO003', sku: 'DEMO-SKU-003', event_type: 'Adjustments', quantity: -1, fulfillment_center: 'PHX7', disposition: 'SELLABLE', reason_code: 'Lost in warehouse', reference_id: 'ADJ-002' },
        ];

        await this.saveLedgerToDatabase(userId, mockEvents, tenantId, storeId, syncId);
        return { success: true, count: mockEvents.length, message: `Synced ${mockEvents.length} mock inventory ledger events` };
    }

    /**
     * Save ledger events to database with upsert
     */
    private mapCanonicalEventType(rawType: string): { eventType: string; direction: 'in' | 'out' } {
        const normalized = String(rawType || '').toLowerCase();
        if (normalized.includes('receipt')) return { eventType: 'Receipt', direction: 'in' };
        if (normalized.includes('shipment')) return { eventType: 'Shipment', direction: 'out' };
        if (normalized.includes('return')) return { eventType: 'Return', direction: 'in' };
        if (normalized.includes('removal')) return { eventType: 'Removal', direction: 'out' };
        if (normalized.includes('disposal') || normalized.includes('disposed')) return { eventType: 'Disposal', direction: 'out' };
        if (normalized.includes('transfer')) return { eventType: 'Transfer', direction: 'out' };
        return { eventType: 'Adjustment', direction: 'out' };
    }

    private async saveLedgerToDatabase(
        userId: string,
        events: InventoryLedgerEvent[],
        tenantId?: string,
        storeId?: string,
        syncId?: string
    ): Promise<void> {
        if (events.length === 0) return;

        if (typeof supabase.from !== 'function') {
            logger.warn('Demo mode: Inventory ledger save skipped', { userId });
            return;
        }

        if (!tenantId) {
            throw new Error('tenantId is required to persist inventory ledger');
        }

        const providerRowsByFingerprint = new Map<string, InventoryLedgerEvent>();
        const nonProviderEvents: InventoryLedgerEvent[] = [];
        for (const event of events) {
            if (event.provider_row_fingerprint) {
                providerRowsByFingerprint.set(event.provider_row_fingerprint, event);
            } else {
                nonProviderEvents.push(event);
            }
        }
        // Exact provider duplicates share every immutable fingerprint fact and
        // are intentionally written once. Distinct provider rows have distinct
        // fingerprints and remain independently preserved.
        const persistableEvents = [...providerRowsByFingerprint.values(), ...nonProviderEvents];

        const toInsert = persistableEvents.map(event => ({
            seller_id: event.seller_id,
            tenant_id: tenantId,
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
            provider_event_type_raw: event.provider_event_type_raw || event.event_type,
            raw_quantity: event.raw_quantity ?? event.quantity,
            event_datetime: event.event_datetime || null,
            provider_store: event.provider_store || null,
            reconciled_quantity: event.reconciled_quantity ?? null,
            unreconciled_quantity: event.unreconciled_quantity ?? null,
            marketplace_id: event.marketplace_id || null,
            provider_row_fingerprint: event.provider_row_fingerprint || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));

        const ledgerEventRows = persistableEvents.map((event) => {
            const mapped = this.mapCanonicalEventType(event.event_type);
            // Compatibility-only Margin derivation. For WhseTransfers, this
            // sign-based direction is deliberately not treated as Amazon-proven
            // transfer-out/transfer-in evidence by the observation rail.
            const direction = mapped.eventType === 'Transfer'
                ? (event.quantity >= 0 ? 'in' : 'out')
                : (event.quantity >= 0 ? 'in' : mapped.direction);

            return {
                user_id: event.user_id || userId,
                tenant_id: tenantId,
                store_id: storeId || event.store_id || null,
                sync_id: syncId || event.sync_id || null,
                fnsku: event.fnsku,
                asin: event.asin || null,
                sku: event.sku || null,
                product_name: event.title || null,
                event_type: mapped.eventType,
                quantity: Math.abs(Number(event.quantity || 0)),
                quantity_direction: direction,
                warehouse_balance: null,
                event_date: event.event_date,
                fulfillment_center: event.fulfillment_center || null,
                disposition: event.disposition || null,
                reason: event.reason_code || null,
                reference_id: event.reference_id || null,
                unit_cost: null,
                average_sales_price: null,
                country: event.country || 'US',
                marketplace_id: event.marketplace_id || null,
                provider_event_type_raw: event.provider_event_type_raw || event.event_type,
                raw_quantity: event.raw_quantity ?? event.quantity,
                event_datetime: event.event_datetime || null,
                provider_store: event.provider_store || null,
                reconciled_quantity: event.reconciled_quantity ?? null,
                unreconciled_quantity: event.unreconciled_quantity ?? null,
                provider_row_fingerprint: event.provider_row_fingerprint || null,
                raw_payload: event.raw_payload || null,
                source: 'sp_api',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
        });

        const balanceByFnsku: Record<string, number> = {};
        for (const row of ledgerEventRows) {
            if (!balanceByFnsku[row.fnsku]) balanceByFnsku[row.fnsku] = 0;
            if (row.quantity_direction === 'in') {
                balanceByFnsku[row.fnsku] += row.quantity;
            } else {
                balanceByFnsku[row.fnsku] -= row.quantity;
            }
        }

        const snapshotDate = new Date().toISOString();
        for (const [fnsku, balance] of Object.entries(balanceByFnsku)) {
            const lastEvent = [...ledgerEventRows].reverse().find((row) => row.fnsku === fnsku);
            ledgerEventRows.push({
                user_id: lastEvent?.user_id || userId,
                tenant_id: tenantId,
                store_id: lastEvent?.store_id || storeId || null,
                sync_id: lastEvent?.sync_id || syncId || null,
                fnsku,
                asin: lastEvent?.asin || null,
                sku: lastEvent?.sku || null,
                product_name: lastEvent?.product_name || null,
                event_type: 'Snapshot',
                quantity: Math.max(0, balance),
                quantity_direction: 'in',
                warehouse_balance: Math.max(0, balance),
                event_date: snapshotDate,
                fulfillment_center: lastEvent?.fulfillment_center || null,
                disposition: 'SELLABLE',
                reason: 'SP-API ledger snapshot',
                reference_id: syncId || lastEvent?.reference_id || null,
                unit_cost: null,
                average_sales_price: null,
                country: lastEvent?.country || 'US',
                marketplace_id: lastEvent?.marketplace_id || null,
                provider_event_type_raw: 'Snapshot',
                raw_quantity: Math.max(0, balance),
                event_datetime: snapshotDate,
                provider_store: null,
                reconciled_quantity: null,
                unreconciled_quantity: null,
                provider_row_fingerprint: null,
                raw_payload: { type: 'calculated_snapshot', balance, fnsku },
                source: 'sp_api_snapshot',
                created_at: snapshotDate,
                updated_at: snapshotDate
            });
        }

        // Provider rows upsert only on their immutable fingerprint. This preserves
        // materially distinct same-day Ledger events that the legacy business key
        // could collapse (for example different FCs or raw quantities).
        const { error } = await supabase
            .from('inventory_ledger')
            .upsert(toInsert, {
                onConflict: 'tenant_id,seller_id,provider_row_fingerprint',
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

        const providerLedgerEventRows = ledgerEventRows.filter((row) => Boolean(row.provider_row_fingerprint));
        const calculatedSnapshotRows = ledgerEventRows.filter((row) => !row.provider_row_fingerprint);

        const { error: eventError } = providerLedgerEventRows.length
            ? await supabase
                .from('inventory_ledger_events')
                .upsert(providerLedgerEventRows, {
                    onConflict: 'tenant_id,user_id,provider_row_fingerprint',
                    ignoreDuplicates: false
                })
            : { error: null };

        if (!eventError && calculatedSnapshotRows.length) {
            // Legacy/snapshot rows retain a partial legacy uniqueness index. A
            // partial index is not a valid PostgREST upsert conflict target, so
            // use duplicate-tolerant insertion instead of reviving the former
            // collision-prone provider business key.
            const { error: snapshotError } = await supabase
                .from('inventory_ledger_events')
                .insert(calculatedSnapshotRows);
            if (snapshotError && !String(snapshotError.message || '').toLowerCase().includes('duplicate')) {
                throw new Error(`Inventory ledger snapshot save failed: ${snapshotError.message}`);
            }
        }

        if (eventError) {
            throw new Error(`Inventory ledger events save failed: ${eventError.message}`);
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
