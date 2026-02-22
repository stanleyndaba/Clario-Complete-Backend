/**
 * Catalog Sync Service
 * 
 * Syncs product catalog data from Amazon SP-API to the product_catalog table.
 * Uses GET_MERCHANT_LISTINGS_ALL_DATA report for listings data.
 * 
 * This is CRITICAL for fee detection algorithms:
 * - detectFulfillmentFeeOvercharge (needs dimensions/weight)
 * - detectStorageFeeOvercharge (needs cubic feet)
 * - detectFeeMisclassification (needs size tier)
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';

export interface CatalogItem {
    seller_id: string;
    sku: string;
    asin: string;
    item_name: string;
    price?: number;
    quantity?: number;
    fulfillment_channel?: string;
    item_condition?: string;
    // Dimensions (may be populated from Catalog Items API later)
    length_cm?: number;
    width_cm?: number;
    height_cm?: number;
    weight_kg?: number;
    category?: string;
    size_tier?: string;
    last_synced: string;
}

class CatalogSyncService {

    /**
     * Sync product catalog from Amazon SP-API
     * Uses GET_MERCHANT_LISTINGS_ALL_DATA report
     */
    async syncCatalog(
        userId: string,
        storeId?: string
    ): Promise<{ success: boolean; count: number; message: string }> {
        try {
            logger.info('📦 [CATALOG SYNC] Starting catalog sync', { userId, storeId });

            // Check if using mock SP-API
            if (process.env.USE_MOCK_SPAPI === 'true') {
                logger.info('📦 [CATALOG SYNC] Using mock data for catalog', { userId });
                return this.syncMockCatalog(userId);
            }

            const { spApiReportService } = await import('./spApiReportService');

            // Request the listings report (no date range needed — it's a snapshot)
            const records = await spApiReportService.requestAndDownloadReport(
                userId,
                'GET_MERCHANT_LISTINGS_ALL_DATA',
                undefined, // No start date
                undefined, // No end date
                storeId
            );

            if (records.length === 0) {
                logger.warn('📦 [CATALOG SYNC] Report returned 0 records', { userId });
                return { success: true, count: 0, message: 'No catalog data in report' };
            }

            // Convert report records to CatalogItem format
            const catalogItems = this.convertReportRecords(records, userId);

            // Save to database
            await this.saveCatalogToDatabase(userId, catalogItems);

            logger.info(`📦 [CATALOG SYNC] Synced ${catalogItems.length} catalog items`, { userId });

            return {
                success: true,
                count: catalogItems.length,
                message: `Synced ${catalogItems.length} catalog items from SP-API`
            };
        } catch (error: any) {
            logger.error('📦 [CATALOG SYNC] Failed', { userId, error: error.message });

            await logAuditEvent({
                event_type: 'catalog_sync_failed',
                user_id: userId,
                metadata: { error: error.message },
                severity: 'high'
            });

            // Return empty on failure (non-blocking)
            return {
                success: false,
                count: 0,
                message: `Catalog sync failed: ${error.message}`
            };
        }
    }

    /**
     * Convert TSV report records to CatalogItem format
     * 
     * GET_MERCHANT_LISTINGS_ALL_DATA columns:
     * item-name, listing-id, seller-sku, price, quantity, open-date,
     * item-description, asin1, product-id-type, item-condition,
     * fulfillment-channel, item-note
     */
    private convertReportRecords(records: Record<string, string>[], userId: string): CatalogItem[] {
        return records
            .filter(r => (r['seller-sku'] || r['sku']) && (r['asin1'] || r['asin']))
            .map(record => ({
                seller_id: userId,
                sku: record['seller-sku'] || record['sku'] || '',
                asin: record['asin1'] || record['asin'] || '',
                item_name: record['item-name'] || record['product-name'] || '',
                price: parseFloat(record['price'] || '0') || undefined,
                quantity: parseInt(record['quantity'] || '0', 10) || undefined,
                fulfillment_channel: record['fulfillment-channel'] || record['fulfillment_channel'] || '',
                item_condition: record['item-condition'] || record['item_condition'] || '',
                // Dimensions not in listings report — populated separately via Catalog Items API
                length_cm: undefined,
                width_cm: undefined,
                height_cm: undefined,
                weight_kg: undefined,
                category: record['product-type'] || record['category'] || undefined,
                size_tier: undefined,
                last_synced: new Date().toISOString()
            }));
    }

    /**
     * Generate mock catalog data for demo mode
     */
    private async syncMockCatalog(userId: string): Promise<{ success: boolean; count: number; message: string }> {
        const mockItems: CatalogItem[] = [
            { seller_id: userId, sku: 'DEMO-SKU-001', asin: 'B0DEMO001', item_name: 'Demo Widget A', price: 24.99, quantity: 150, fulfillment_channel: 'AMAZON_NA', length_cm: 15, width_cm: 10, height_cm: 5, weight_kg: 0.3, category: 'Home', size_tier: 'STANDARD', last_synced: new Date().toISOString() },
            { seller_id: userId, sku: 'DEMO-SKU-002', asin: 'B0DEMO002', item_name: 'Demo Gadget B', price: 89.99, quantity: 75, fulfillment_channel: 'AMAZON_NA', length_cm: 30, width_cm: 20, height_cm: 15, weight_kg: 1.2, category: 'Electronics', size_tier: 'STANDARD', last_synced: new Date().toISOString() },
            { seller_id: userId, sku: 'DEMO-SKU-003', asin: 'B0DEMO003', item_name: 'Demo Large Item C', price: 199.99, quantity: 25, fulfillment_channel: 'AMAZON_NA', length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 5.5, category: 'Furniture', size_tier: 'OVERSIZE', last_synced: new Date().toISOString() },
        ];

        await this.saveCatalogToDatabase(userId, mockItems);
        return { success: true, count: mockItems.length, message: `Synced ${mockItems.length} mock catalog items` };
    }

    /**
     * Save catalog items to database with upsert
     */
    private async saveCatalogToDatabase(userId: string, items: CatalogItem[]): Promise<void> {
        if (items.length === 0) return;

        if (typeof supabase.from !== 'function') {
            logger.warn('Demo mode: Catalog save skipped', { userId });
            return;
        }

        const toInsert = items.map(item => ({
            seller_id: item.seller_id,
            sku: item.sku,
            asin: item.asin,
            item_name: item.item_name,
            price: item.price || null,
            quantity: item.quantity || null,
            fulfillment_channel: item.fulfillment_channel || null,
            item_condition: item.item_condition || null,
            length_cm: item.length_cm || null,
            width_cm: item.width_cm || null,
            height_cm: item.height_cm || null,
            weight_kg: item.weight_kg || null,
            category: item.category || null,
            size_tier: item.size_tier || null,
            last_synced: item.last_synced,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));

        // Upsert on (seller_id, sku) — update existing items, insert new ones
        const { error } = await supabase
            .from('product_catalog')
            .upsert(toInsert, {
                onConflict: 'seller_id,sku',
                ignoreDuplicates: false
            });

        if (error) {
            logger.error('📦 [CATALOG SYNC] Database upsert failed', { error: error.message, userId });
            throw new Error(`Catalog save failed: ${error.message}`);
        }

        logger.info('📦 [CATALOG SYNC] Saved to database', { userId, count: toInsert.length });

        await logAuditEvent({
            event_type: 'catalog_synced',
            user_id: userId,
            metadata: { count: toInsert.length },
            severity: 'low'
        });
    }
}

export const catalogSyncService = new CatalogSyncService();
export default catalogSyncService;
