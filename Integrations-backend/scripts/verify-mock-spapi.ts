
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Force "Real Truth" mode
process.env.USE_MOCK_SPAPI = 'true';
process.env.ENABLE_MOCK_SP_API = 'true'; // Just in case
process.env.USE_MOCK_DATA_GENERATOR = 'false'; // Redundant with my fix, but good practice

import { Agent2DataSyncService } from '../src/services/agent2DataSyncService';
import logger from '../src/utils/logger';

async function verifyMockSpapi() {
    console.log('🧪 Starting Verification: Real Truth (CSV Mock) Mode');
    console.log('---------------------------------------------------');
    console.log('Environment: USE_MOCK_SPAPI =', process.env.USE_MOCK_SPAPI);
    console.log('Target CSV Path:', path.resolve(__dirname, '../data/mock-spapi/financial_events.csv'));

    const agent2 = new Agent2DataSyncService();
    const userId = 'verification-test-user';

    try {
        console.log('\nRunning syncUserData...');
        const result = await agent2.syncUserData(userId);

        console.log('\n---------------------------------------------------');
        console.log('Sync Result Summary:');
        console.log('Success:', result.success);
        console.log('Is Mock (Random Generator):', result.isMock);
        // EXPECTED: isMock should be FALSE because my fix forces it to false so it calls "Real API" (which is now CSV)

        console.log('Claims Count:', result.summary.claimsCount);
        console.log('Orders Count:', result.summary.ordersCount);
        console.log('Inventory Count:', result.summary.inventoryCount);

        // Verify specific data points from my CSVs
        // financial_events.csv had 3 rows: $100, $50, $70.50
        // Total claims should be 3
        // One claim should be $100

        const hasHundredDollarClaim = result.normalized.claims.some((c: any) => c.amount === 100);
        console.log('\nData Verification:');
        console.log('Found $100 claim from CSV?', hasHundredDollarClaim ? '✅ YES' : '❌ NO');

        const totalClaims = result.normalized.claims.length;
        console.log(`Total claims found: ${totalClaims} (Expected: 3)`, totalClaims === 3 ? '✅' : '❌');

        if (result.success && !result.isMock && totalClaims === 3) {
            console.log('\n🎉 SUCCESS: "Real Truth" mode verified! System is reading from CSVs.');
        } else {
            console.error('\n⚠️ FAILURE: Verification failed.');
            if (result.isMock) console.error('  - System still thinks it is in Random Mock Mode.');
            if (totalClaims === 0) console.error('  - No claims found (CSVs not read?).');
        }

    } catch (error) {
        console.error('Verification crashed:', error);
    }
}

verifyMockSpapi();
