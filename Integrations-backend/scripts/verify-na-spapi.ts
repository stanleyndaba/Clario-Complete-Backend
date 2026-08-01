import axios from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function verifySPAPIConnection() {
    console.log('🚀 [AGENT 7] STARTING LIVE-FIRE CONNECTION PROFILER (NA)');

    // 1. Map Environment Variables
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
    const refreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN || process.env.AMAZON_REFRESH_TOKEN;
    const endpoint = 'https://sellingpartnerapi-na.amazon.com';

    try {
        // 2. LWA Access Token Exchange
        console.log('[PROFILER] Exchanging Refresh Token for LWA Access Token...');
        const lwaResponse = await axios.post('https://api.amazon.com/auth/o2/token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken!,
                client_id: clientId!,
                client_secret: clientSecret!
            }),
            { headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 15_000 }
        );
        const lwaAccessToken = lwaResponse.data.access_token;
        console.log('✅ [PROFILER] LWA Exchange Successful');

        // 3. SP-API Request (LWA-only auth — no STS/SigV4 needed)
        console.log('[PROFILER] Handshaking with getMarketplaceParticipations...');

        const response = await axios.get(`${endpoint}/sellers/v1/marketplaceParticipations`, {
            headers: {
                'Authorization': `Bearer ${lwaAccessToken}`,
                'x-amz-access-token': lwaAccessToken,
                'user-agent': 'Margin/Agent7/1.0 (Language=TypeScript)',
                'content-type': 'application/json'
            },
            timeout: 20_000
        });
        
        console.log('🔥 [PROFILER] LIVE-FIRE STATUS: 100% SUCCESS');
        console.log('--------------------------------------------------');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('--------------------------------------------------');

    } catch (error: any) {
        console.error('❌ [PROFILER] CONNECTION FAILED');
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
        process.exit(1);
    }
}

verifySPAPIConnection();

