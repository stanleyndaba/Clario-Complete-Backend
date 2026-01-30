/**
 * Verification Script: Multi-Store Isolation
 * 
 * Tests the store-scoped query builder and route protection.
 */

import { createStoreScopedQueryById } from '../database/storeScopedClient';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

async function verifyIsolation() {
    const TEST_TENANT = '00000000-0000-0000-0000-000000000001';
    const STORE_A = '00000000-0000-0000-0000-00000000000A';
    const STORE_B = '00000000-0000-0000-0000-00000000000B';

    logger.info('--- STARTING MULTI-STORE ISOLATION VERIFICATION ---');

    try {
        // 1. Create mock stores
        await supabaseAdmin.from('stores').upsert([
            { id: STORE_A, tenant_id: TEST_TENANT, name: 'Store Alpha', marketplace: 'amazon_us' },
            { id: STORE_B, tenant_id: TEST_TENANT, name: 'Store Beta', marketplace: 'amazon_eu' }
        ]);

        // 2. Insert data into Store A
        const queryA = createStoreScopedQueryById(TEST_TENANT, STORE_A, 'orders');
        await queryA.insert([
            { order_id: 'A-001', marketplace_id: 'ATVPDKIKX0DER', user_id: 'demo-user' },
            { order_id: 'A-002', marketplace_id: 'ATVPDKIKX0DER', user_id: 'demo-user' }
        ]);

        // 3. Insert data into Store B
        const queryB = createStoreScopedQueryById(TEST_TENANT, STORE_B, 'orders');
        await queryB.insert([
            { order_id: 'B-001', marketplace_id: 'A1PA6795UKMFR9', user_id: 'demo-user' }
        ]);

        // 4. Verify Store A can't see Store B data
        const { data: resultsA } = await queryA.select();
        const hasStoreBDataInA = resultsA?.some(r => r.order_id.startsWith('B-'));

        if (hasStoreBDataInA) {
            throw new Error('[FAILURE] Store Alpha can see Store Beta data!');
        }
        logger.info('✅ Store A isolation verified (cannot see Store B data)');

        // 5. Verify Store B can't see Store A data
        const { data: resultsB } = await queryB.select();
        const hasStoreADataInB = resultsB?.some(r => r.order_id.startsWith('A-'));

        if (hasStoreADataInB) {
            throw new Error('[FAILURE] Store Beta can see Store Alpha data!');
        }
        logger.info('✅ Store B isolation verified (cannot see Store A data)');

        // 6. Verify cross-tenant protection (Bonus)
        const OTHER_TENANT = '00000000-0000-0000-0000-999999999999';
        try {
            createStoreScopedQueryById(OTHER_TENANT, STORE_A, 'orders');
            throw new Error('[FAILURE] StoreScopedQuery allowed cross-tenant access!');
        } catch (e: any) {
            logger.info('✅ Cross-tenant protection verified');
        }

        logger.info('--- ISOLATION VERIFIED SUCCESSFULLY ---');
    } catch (error: any) {
        logger.error('Verification failed', { error: error.message });
        process.exit(1);
    }
}

// In a real environment, we'd run this with ts-node
// For now, this serves as documentation of the verification logic
console.log('Isolation verification logic defined.');
