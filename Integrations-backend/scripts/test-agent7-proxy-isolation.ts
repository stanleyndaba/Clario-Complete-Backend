
// Set environment variables BEFORE any imports to ensure ProxyAssignmentService reads them
process.env.ENABLE_PROXY_ROUTING = 'true';
process.env.PROXY_USERNAME = 'test_user';
process.env.PROXY_PASSWORD = 'test_password';

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { createSellerHttpClient } from '../src/services/sellerHttpClient';
import proxyAssignmentService from '../src/services/proxyAssignmentService';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function testProxyIsolation() {
    console.log('\n🛡️ Agent 7 Hardening Audit: Proxy Isolation Verification (Retry)\n');
    console.log('='.repeat(70));

    const testSellerId = randomUUID();
    console.log(`📡 Using Test Seller: ${testSellerId}`);

    try {
        console.log('\n🛠️ Step 1: Requesting Proxy for Seller...');
        const httpClient = createSellerHttpClient(testSellerId);

        // This will trigger initialization
        await (httpClient as any).initialize();

        const isProxyUsed = httpClient.isUsingProxy();
        const proxyInfo = httpClient.getProxyInfo();

        console.log(`✅ Using Proxy: ${isProxyUsed ? 'YES' : 'NO'}`);
        if (isProxyUsed) {
            console.log(`✅ Proxy Session ID: ${proxyInfo.sessionId}`);
            console.log(`✅ Proxy Host: ${proxyInfo.host}`);
        } else {
            console.error('❌ Proxy NOT used even though routing enabled!');
        }

        // Verify deterministic session in ProxyAssignmentService
        console.log('\n🛠️ Step 2: Verifying Deterministic Session ID...');
        const config1 = await proxyAssignmentService.getProxyForSeller(testSellerId);
        const config2 = await proxyAssignmentService.getProxyForSeller(testSellerId);

        if (config1?.sessionId && config1.sessionId === config2?.sessionId) {
            console.log(`✅ Determinism Verified: Seller consistently uses Session ${config1.sessionId}`);
        } else {
            console.error(`❌ Determinism Failed: Seller got sessions ${config1?.sessionId} vs ${config2?.sessionId}`);
        }

        // Verify Isolation (Different seller gets different IP session)
        console.log('\n🛠️ Step 3: Verifying Multi-Tenant Isolation...');
        const otherSellerId = randomUUID();
        const otherConfig = await proxyAssignmentService.getProxyForSeller(otherSellerId);

        if (otherConfig?.sessionId && otherConfig.sessionId !== config1?.sessionId) {
            console.log(`✅ Isolation Verified: Other Seller uses different Session ${otherConfig.sessionId}`);
        } else {
            console.error(`❌ Isolation Failed: Both sellers sharing same session ${otherConfig?.sessionId}!`);
        }

    } finally {
        // Cleanup
        await supabaseAdmin.from('seller_proxy_assignments').delete().eq('seller_id', testSellerId);
        console.log('\n🧹 Cleanup complete.');
    }
}

testProxyIsolation().catch(console.error);
