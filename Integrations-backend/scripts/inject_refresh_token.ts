import 'dotenv/config';
import tokenManager from '../src/utils/tokenManager';
import { supabaseAdmin, convertUserIdToUuid } from '../src/database/supabaseClient';
import logger from '../src/utils/logger';

async function injectToken() {
    const userId = 'demo-user';
    const dbUserId = convertUserIdToUuid(userId);
    const tenantId = '00000000-0000-0000-0000-000000000001';
    const provider = 'amazon';
    const refreshToken = 'Atzr|IwEBIACx3473EvrAnsixHkRlsd5FEe5xx0xIkgRmwi_IhHdJuA2241EahW6wzMleZ-Q5IcLXNplL7j9hT0VetAcjGDNjfMU2qDyx1rMrpYGp2nfNb1al-jQZ_Mz7Me25bqFI2JmcL3B5hL9IpFYVRVbruziCJIaz5TPTuQZMsRQ1CE13F_V8oxvLalD5Z88Spi5Z0l8p-zfER4ndll-4nejOol1sUpA8tPO2eSaZmnx2b8b_LuWBzebQvRZy_XKNFqKoHdGjY9jz9dSJg2ps3j1N1AjCJ4siqvABAidv3dVAGitSGPYnUQTpAoWywHBDQr1fNgu4m2M-YlFJgxlyx3CzFetR';

    console.log('🚀 Starting FINAL manual injection...');
    console.log('User ID:', userId);
    console.log('DB UUID:', dbUserId);
    console.log('Tenant ID:', tenantId);

    try {
        // 1. Ensure tenant exists
        console.log('Step 1: Upserting tenant record...');
        const { error: tenantError } = await supabaseAdmin
            .from('tenants')
            .upsert({
                id: tenantId,
                name: 'Demo Tenant',
                slug: 'default',
                plan: 'enterprise',
                status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });

        if (tenantError) throw new Error(`Tenant upsert failed: ${tenantError.message}`);
        console.log('✅ Tenant record ready.');

        // 2. Ensure user exists and linked to tenant
        console.log('Step 2: Upserting user record...');
        const { error: userError } = await supabaseAdmin
            .from('users')
            .upsert({
                id: dbUserId,
                email: 'demo@marginanalytics.com',
                tenant_id: tenantId,
                seller_id: 'DEMO_ZA_SELLER',
                amazon_seller_id: 'DEMO_ZA_SELLER',
                company_name: 'Margin Analytics Demo',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });

        if (userError) throw new Error(`User upsert failed: ${userError.message}`);
        console.log('✅ User record ready.');

        // 3. Inject token (using our newly multi-tenant aware saveToken!)
        console.log('Step 3: Injecting Amazon refresh token...');
        await tokenManager.saveToken(userId, provider, {
            accessToken: 'dummy_access_token_will_be_refreshed',
            refreshToken: refreshToken,
            expiresAt: new Date(Date.now() - 3600000)
        }, tenantId);

        console.log('\n🌟 SUCCESS: Amazon Sync Engine UNLOCKED.');
        console.log('The database is consistent and scanning is now possible.');
    } catch (error: any) {
        console.error('\n❌ FAILED:', error.message);
        process.exit(1);
    }
}

injectToken();
